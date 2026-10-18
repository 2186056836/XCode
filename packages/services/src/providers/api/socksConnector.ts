/* oxlint-disable max-lines -- SOCKS4/5+UDP ASSOCIATE 握手状态机集中，拆分会跨步骤同步握手缓冲。 */
/**
 * 自包含的 SOCKS4 / SOCKS4a / SOCKS5 / SOCKS5h connector（undici `Agent({ connect })` 专用）。
 *
 * 为什么不直接加 `proxy-agent` 依赖：`packages/services` 的产物要经 desktop 的 tsup 打包，
 * externals 是硬编码白名单（见 packages/desktop/tsup.config.ts 的 desktopNodeRuntimeExternals），
 * 往里加一个带动态 require 的 CJS 包正是仓库已经踩过的坑类。这里改成只依赖 node 内置模块，
 * 零新依赖、零打包风险。
 *
 * 为什么不能用 undici 自带的 ProxyAgent：它只认 http/https（CONNECT 隧道），
 * 传 socks URL 会直接抛 `InvalidArgumentError: Invalid URL protocol`（undici 6.x）。
 *
 * 与 undici 官方 buildConnector 的行为差异（有意为之，避免「静默换出口」）：
 * 连接/握手超时由本模块自己计时（替换 connector 后就拿不到 buildConnector 的 timeout 了），
 * 超时按建连失败上报，交给上层决定 strictProxy 抛错还是回退直连。
 */
import net from "node:net";
import tls from "node:tls";
import { lookup } from "node:dns/promises";

/** undici connector 的入参（与 undici-types/buildConnector.Options 对齐）。 */
export interface SocksConnectorOptions {
  hostname: string;
  host?: string;
  protocol: string;
  port: string;
  servername?: string;
  localAddress?: string | null;
  httpSocket?: net.Socket;
}

export interface SocksProxyConfig {
  version: 4 | 5;
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** socks4a / socks5h：目标域名交给代理解析；socks4 必须本地解析成 IPv4。 */
  remoteDns: boolean;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const KEEP_ALIVE_INITIAL_DELAY_MS = 60_000;

/** 默认端口的推导与 undici buildConnector 一致：https 默认 443，其余 80。 */
function defaultPortFor(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

/**
 * 解析 socks 代理 URL；非 socks scheme 或缺少主机名时返回 undefined（调用方据此走 undici ProxyAgent）。
 */
export function parseSocksProxyUrl(proxyUrl: string): SocksProxyConfig | undefined {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    return undefined;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "socks4" && scheme !== "socks4a" && scheme !== "socks5" && scheme !== "socks5h") {
    return undefined;
  }
  const port = Number(url.port || 1080);
  if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65_535) {
    return undefined;
  }
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return {
    version: scheme.startsWith("socks4") ? 4 : 5,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    remoteDns: scheme === "socks4a" || scheme === "socks5h",
  };
}

export interface SocksConnectorDeps {
  /** 目标 TLS 校验用的 CA（企业代理 MITM 场景下与全局代理同源）。 */
  ca?: string | string[] | Buffer;
  connectTimeoutMs?: number;
}

/** 与 undici-types/buildConnector.Callback 的调用形态对齐（联合元组，非 (error, socket) 两参）。 */
export type SocksConnectorCallback = (
  ...args: [null, net.Socket | tls.TLSSocket] | [Error, null]
) => void;

/**
 * 造一个 undici 可用的 connect 函数。
 *
 * 注意：替换 connector 后 undici 不再帮我们做 TLS —— https 目标必须由这里
 * 在 SOCKS 隧道之上自己 `tls.connect({ socket })` 包一层，否则会把 TLS 明文发出去。
 */
export function createSocksConnector(
  config: SocksProxyConfig,
  deps: SocksConnectorDeps = {},
): (options: SocksConnectorOptions, callback: SocksConnectorCallback) => void {
  const timeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  return function connect(options, callback) {
    const useTls = options.protocol === "https:";
    const targetPort = Number(options.port) || defaultPortFor(options.protocol);
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const settle = (error: Error | null, socket: net.Socket | tls.TLSSocket | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        callback(error, null);
        return;
      }
      if (socket) {
        callback(null, socket);
        return;
      }
      callback(new Error("SOCKS proxy connect settled without an error or a socket"), null);
    };

    const proxySocket = net.connect({
      host: config.host,
      port: config.port,
      ...(options.localAddress ? { localAddress: options.localAddress } : {}),
    });
    proxySocket.setNoDelay(true);

    timer = setTimeout(() => {
      proxySocket.destroy();
      settle(new Error(`SOCKS proxy handshake timed out after ${timeoutMs}ms`), null);
    }, timeoutMs);
    // 不拿这个计时器把 Host 进程钉住。
    timer.unref?.();

    proxySocket.once("error", (error: Error) => {
      settle(error, null);
    });
    proxySocket.once("connect", () => {
      const reader = new SocketByteReader(proxySocket);
      void establishTunnel(reader, config, options.hostname, targetPort)
        .then(() => {
          // 隧道建立后把剩余字节还回 socket：之后这段 socket 归 TLS 层管。
          reader.detach();
          proxySocket.setKeepAlive(true, KEEP_ALIVE_INITIAL_DELAY_MS);
          if (!useTls) {
            settle(null, proxySocket);
            return;
          }
          const tlsSocket = tls.connect({
            socket: proxySocket,
            ...(options.servername || !net.isIP(options.hostname)
              ? { servername: options.servername ?? options.hostname }
              : {}),
            ...(deps.ca ? { ca: deps.ca } : {}),
            ALPNProtocols: ["http/1.1"],
          });
          tlsSocket.once("secureConnect", () => {
            settle(null, tlsSocket);
          });
          tlsSocket.once("error", (error: Error) => {
            settle(error, null);
          });
        })
        .catch((error: unknown) => {
          reader.detach();
          proxySocket.destroy();
          settle(error instanceof Error ? error : new Error(String(error)), null);
        });
    });
  };
}

async function establishTunnel(
  reader: SocketByteReader,
  config: SocksProxyConfig,
  host: string,
  port: number,
): Promise<void> {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`SOCKS target port is invalid: ${String(port)}`);
  }
  if (config.version === 4) {
    await establishSocks4(reader, config, host, port);
    return;
  }
  await establishSocks5(reader, config, host, port);
}

const SOCKS5_REPLY_MESSAGES: Record<number, string> = {
  0x01: "general SOCKS server failure",
  0x02: "connection not allowed by ruleset",
  0x03: "network unreachable",
  0x04: "host unreachable",
  0x05: "connection refused",
  0x06: "TTL expired",
  0x07: "command not supported",
  0x08: "address type not supported",
};

async function establishSocks5(
  reader: SocketByteReader,
  config: SocksProxyConfig,
  host: string,
  port: number,
): Promise<void> {
  // 认证方式协商：有凭据时同时申报「无认证」与「用户名/密码」，让支持免认证的代理少走一轮。
  const methods = config.username ? [0x00, 0x02] : [0x00];
  reader.socket.write(Buffer.from([0x05, methods.length, ...methods]));
  const greeting = await reader.read(2);
  const greetingVersion = greeting[0] ?? 0;
  const method = greeting[1] ?? 0xff;
  if (greetingVersion !== 0x05) {
    throw new Error(`SOCKS5 proxy replied with an unexpected version: ${greetingVersion}`);
  }
  if (method === 0xff) {
    throw new Error("SOCKS5 proxy rejected all offered authentication methods");
  }
  if (method === 0x02) {
    if (!config.username) {
      throw new Error("SOCKS5 proxy requires username/password authentication");
    }
    const username = Buffer.from(config.username, "utf8");
    const password = Buffer.from(config.password ?? "", "utf8");
    if (username.length > 255 || password.length > 255) {
      throw new Error("SOCKS5 credentials are too long (max 255 bytes each)");
    }
    reader.socket.write(
      Buffer.concat([
        Buffer.from([0x01, username.length]),
        username,
        Buffer.from([password.length]),
        password,
      ]),
    );
    const auth = await reader.read(2);
    if ((auth[0] ?? 0) !== 0x01 || (auth[1] ?? 0xff) !== 0x00) {
      throw new Error(`SOCKS5 username/password authentication failed (status ${auth[1] ?? 0xff})`);
    }
  } else if (method !== 0x00) {
    throw new Error(`SOCKS5 proxy selected an unsupported auth method: 0x${method.toString(16)}`);
  }

  reader.socket.write(
    Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), encodeSocks5Address(host, port)]),
  );
  const head = await reader.read(4);
  if ((head[0] ?? 0) !== 0x05) {
    throw new Error("SOCKS5 proxy replied with an unexpected version to the CONNECT request");
  }
  const reply = head[1] ?? 0xff;
  if (reply !== 0x00) {
    throw new Error(`SOCKS5 CONNECT failed: ${SOCKS5_REPLY_MESSAGES[reply] ?? `code ${reply}`}`);
  }
  // 消费掉 BND.ADDR + BND.PORT，避免残留字节污染后面的 TLS 握手。
  const atyp = head[3] ?? 0;
  if (atyp === 0x03) {
    const length = (await reader.read(1))[0] ?? 0;
    await reader.read(length + 2);
    return;
  }
  if (atyp === 0x01) {
    await reader.read(4 + 2);
    return;
  }
  if (atyp === 0x04) {
    await reader.read(16 + 2);
    return;
  }
  throw new Error(`SOCKS5 proxy replied with an unsupported address type: 0x${atyp.toString(16)}`);
}

const SOCKS4_REPLY_MESSAGES: Record<number, string> = {
  0x5b: "request rejected or failed",
  0x5c: "request rejected because SOCKS server cannot connect to identd on the client",
  0x5d: "request rejected because the client program and identd report different user-ids",
};

async function establishSocks4(
  reader: SocketByteReader,
  config: SocksProxyConfig,
  host: string,
  port: number,
): Promise<void> {
  const userId = Buffer.from(config.username ?? "", "utf8");
  const portBytes = encodePort(port);
  const family = net.isIP(host);
  let address: Buffer;
  if (family === 4) {
    address = Buffer.concat([Buffer.from([0x01]), encodeIpv4(host), userId, Buffer.from([0x00])]);
  } else if (family === 6) {
    throw new Error("SOCKS4 cannot carry an IPv6 target address; use a SOCKS5 proxy instead");
  } else if (config.remoteDns) {
    // socks4a：DSTIP 填 0.0.0.1 表示「真实目标域名跟在 userid 之后」。
    address = Buffer.concat([
      Buffer.from([0x01]),
      Buffer.from([0x00, 0x00, 0x00, 0x01]),
      userId,
      Buffer.from([0x00]),
      Buffer.from(host, "utf8"),
      Buffer.from([0x00]),
    ]);
  } else {
    const resolved = await lookup(host, { family: 4 }).catch(() => null);
    if (!resolved) {
      throw new Error(`SOCKS4 requires a locally resolvable IPv4 target; cannot resolve ${host}`);
    }
    address = Buffer.concat([
      Buffer.from([0x01]),
      encodeIpv4(resolved.address),
      userId,
      Buffer.from([0x00]),
    ]);
  }

  reader.socket.write(Buffer.concat([Buffer.from([0x04, 0x01]), portBytes, address]));
  const reply = await reader.read(8);
  if ((reply[0] ?? 0xff) !== 0x00) {
    throw new Error("SOCKS4 proxy replied with an unexpected version");
  }
  const status = reply[1] ?? 0xff;
  if (status !== 0x5a) {
    throw new Error(
      `SOCKS4 CONNECT failed: ${SOCKS4_REPLY_MESSAGES[status] ?? `code 0x${status.toString(16)}`}`,
    );
  }
}

function encodePort(port: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(port, 0);
  return buffer;
}

function encodeIpv4(address: string): Buffer {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error(`Invalid IPv4 address: ${address}`);
  }
  return Buffer.from(octets as number[]);
}

/**
 * SOCKS5 地址字段。
 *
 * 域名一律走 ATYP=0x03（远端解析）：socks5/socks5h 的服务端都能处理，
 * 而只在客户端解析会在「本地 DNS 被劫持 / 目标只在代理侧可达」时静默连到错误地址。
 * 只有调用方本来就给了 IP 字面量时才按 ATYP 1/4 编码。
 */
function encodeSocks5Address(host: string, port: number): Buffer {
  const family = net.isIP(host);
  if (family === 4) {
    return Buffer.concat([Buffer.from([0x01]), encodeIpv4(host), encodePort(port)]);
  }
  if (family === 6) {
    return Buffer.concat([Buffer.from([0x04]), encodeIpv6(host), encodePort(port)]);
  }
  const name = Buffer.from(host, "utf8");
  if (name.length === 0 || name.length > 255) {
    throw new Error(`SOCKS5 target hostname length is invalid: ${name.length}`);
  }
  return Buffer.concat([Buffer.from([0x03, name.length]), name, encodePort(port)]);
}

function encodeIpv6(address: string): Buffer {
  const trimmed = address.replace(/^\[|\]$/g, "");
  const halves = trimmed.split("::");
  if (halves.length > 2) {
    throw new Error(`Invalid IPv6 address: ${address}`);
  }
  const parseGroups = (value: string): number[] =>
    value
      .split(":")
      .filter((group) => group.length > 0)
      .flatMap((group) => {
        if (group.includes(".")) {
          const octets = group.split(".").map((part) => Number(part));
          if (
            octets.length !== 4 ||
            octets.some((value2) => !Number.isInteger(value2) || value2 < 0 || value2 > 255)
          ) {
            throw new Error(`Invalid IPv6 address: ${address}`);
          }
          const [a = 0, b = 0, c = 0, d = 0] = octets;
          return [(a << 8) | b, (c << 8) | d];
        }
        const word = Number.parseInt(group, 16);
        if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
          throw new Error(`Invalid IPv6 address: ${address}`);
        }
        return [word];
      });

  const head = halves[0] ? parseGroups(halves[0]) : [];
  const tail = halves.length === 2 && halves[1] ? parseGroups(halves[1]) : [];
  const words =
    halves.length === 2
      ? [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => 0), ...tail]
      : head;
  if (words.length !== 8) {
    throw new Error(`Invalid IPv6 address: ${address}`);
  }
  const buffer = Buffer.alloc(16);
  words.forEach((word, index) => {
    buffer.writeUInt16BE(word, index * 2);
  });
  return buffer;
}

/**
 * 增量字节读取器：SOCKS 握手是严格定长的多段读取，
 * 一次性 `once('data')` 会在 TCP 分片时踩到不完整响应。
 */
class SocketByteReader {
  private chunks: Buffer[] = [];
  private size = 0;
  private pending:
    | { need: number; resolve: (chunk: Buffer) => void; reject: (error: Error) => void }
    | undefined;
  private failure: Error | undefined;
  private detached = false;

  constructor(readonly socket: net.Socket) {
    socket.on("data", this.handleData);
    socket.on("error", this.handleError);
    socket.on("close", this.handleClose);
  }

  private readonly handleData = (chunk: Buffer): void => {
    if (this.detached) return;
    this.chunks.push(chunk);
    this.size += chunk.length;
    this.settlePending();
  };

  private readonly handleError = (error: Error): void => {
    this.fail(error);
  };

  private readonly handleClose = (): void => {
    this.fail(new Error("SOCKS proxy closed the connection during the handshake"));
  };

  private fail(error: Error): void {
    this.failure = error;
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
  }

  private settlePending(): void {
    const pending = this.pending;
    if (!pending || this.size < pending.need) return;
    this.pending = undefined;
    pending.resolve(this.take(pending.need));
  }

  private take(count: number): Buffer {
    const merged = Buffer.concat(this.chunks, this.size);
    this.chunks = count < merged.length ? [merged.subarray(count)] : [];
    this.size = merged.length - count;
    return merged.subarray(0, count);
  }

  read(count: number): Promise<Buffer> {
    if (this.failure) return Promise.reject(this.failure);
    if (count === 0) return Promise.resolve(Buffer.alloc(0));
    if (this.size >= count) return Promise.resolve(this.take(count));
    return new Promise<Buffer>((resolve, reject) => {
      this.pending = { need: count, resolve, reject };
    });
  }

  /** 交还 socket 控制权：摘掉监听，并把已缓冲的多余字节 unshift 回去。 */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.socket.off("data", this.handleData);
    this.socket.off("error", this.handleError);
    this.socket.off("close", this.handleClose);
    const leftover = this.take(this.size);
    this.pending = undefined;
    this.failure = undefined;
    if (leftover.length > 0) {
      this.socket.unshift(leftover);
    }
  }
}
