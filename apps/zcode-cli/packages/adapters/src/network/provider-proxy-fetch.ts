/**
 * 供应商级代理 fetch（agent 侧，Node-only）。
 *
 * 与 `proxy-fetch.ts`（全局 httpProxy）完全独立：本模块只处理 provider config 里的
 * `api.proxy` 绑定，**不读取** XCODE_HTTP_PROXY / HTTP_PROXY 等全局代理来源，
 * 也不 fallback 到全局 httpProxy。未配置绑定的供应商直连，全局代理由 agent 子进程
 * 环境变量层与 Electron session 各自负责。
 *
 * 为什么不用 undici 的 ProxyAgent：undici 只支持 http/https CONNECT 隧道，
 * socks5 会直接抛 InvalidArgumentError。本模块复用仓库既有的 `proxy-agent`
 * （其 ProxyAgent 按 scheme 自动分派 http-proxy-agent / socks-proxy-agent，
 * 且 adapters 已直接依赖它），从而 http/https/socks4/socks5 全部可用。
 *
 * 账号级绑定：多账号供应商（Qoder / CodeBuddy）的账号身份在绑定模型时由
 * resolveProviderProxyAccountId 解析（Qoder 内部身份头 / CodeBuddy JWT 的 sub），
 * 结果作为 accountId 传入；命中 accountBindings 的账号固定用绑定的那条代理。
 */
import http from "node:http";
import https from "node:https";
import { ProxyAgent } from "proxy-agent";
import {
  pickProviderProxyEntry,
  proxyNoProxyMatches,
  type ProviderProxyBinding,
} from "@zcode/shared";
import { loadTlsCaCertificates } from "./http-config.js";
import { readIncomingResponse, toWebResponse } from "./incoming-response.js";

export type ProviderProxyFetch = typeof globalThis.fetch;

export interface ProviderProxyFetchOptions {
  binding: ProviderProxyBinding | undefined;
  /** 该供应商的稳定标识，用于 round-robin 计数隔离。 */
  providerId: string;
  /**
   * 本次请求所属的账号 id，由调用方在**绑定模型时**解析。
   *
   * 为什么不在 fetch 里逐请求解析：账号身份来自 providerConfig 的 headers/apiKey，
   * 而 per-account 的 requestAuth 已经在 createFactory 之前合入 providerConfig
   * （applyModelRequestAuth），所以创建 factory 时解析一次就是该账号的准确值；
   * 逐请求再去读 headers 反而会在 Qoder 分支剥离内部身份头之后失效。
   */
  accountId?: string;
  fetch: ProviderProxyFetch;
  /**
   * 自定义 CA 证书来源。供应商级代理走自己的 http/https agent，绕过了
   * proxy-fetch.ts 的 CA 装配，因此这里必须自己加载一次，否则「全局配了自定义 CA +
   * 供应商配了代理」的请求会因为拿不到根证书而 TLS 失败。
   */
  caCertFile?: string;
  env?: Record<string, string | undefined>;
}

/** round-robin 计数表：providerId → 上次用过的下标。进程内内存态，重启重置。 */
const rotationState = new Map<string, { index: number }>();

/** 仅供测试：清空轮询计数。 */
export function resetProviderProxyRotationState(): void {
  rotationState.clear();
}

const QODER_IDENTITY_USER_ID_HEADER = "x-qoder-internal-user-id";

/**
 * 解析当前请求所属的账号 id。
 *
 * - Qoder：内部身份头 `x-qoder-internal-user-id`（overlay 注入，见 model-execution 的
 *   readQoderIdentity；PAT 场景该头可能缺失，此时返回 undefined 走策略）。
 * - CodeBuddy：apiKey 是 JWT，`sub` 即账号 id。
 * - 其他供应商：无账号概念，返回 undefined。
 *
 * 只读不写：这里绝不修改 headers（剥离内部身份头仍由 model-execution 的
 * stripQoderIdentityHeaders 负责，两处职责不重叠）。
 */
export function resolveProviderProxyAccountId(input: {
  headers?: Record<string, string> | undefined;
  apiKey?: string | undefined;
}): string | undefined {
  if (input.headers) {
    for (const [key, value] of Object.entries(input.headers)) {
      if (key.toLowerCase() === QODER_IDENTITY_USER_ID_HEADER) {
        const trimmed = value.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
  }
  return readJwtSubject(input.apiKey);
}

/**
 * 取 JWT 的 `sub`（不做签名校验——只用于选代理，不参与任何鉴权判定）。
 *
 * 与 services 的 describeCodeBuddyAccessToken 同一解码路径，但不依赖 services 包
 * （adapters 不能依赖 services，否则 agent 侧会拖进 host 专用模块）。
 */
function readJwtSubject(token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parts = trimmed.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  const payload = parts[1];
  if (!payload) {
    return undefined;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const sub = (parsed as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.trim() ? sub.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 包装 fetch：命中绑定时按池条目选代理，未命中/无可用条目时原样直连。
 *
 * 每次调用都重新解析（binding 与账号身份都是请求级的），因此改绑定/切账号无需重启。
 */
export function createProviderProxyFetch(options: ProviderProxyFetchOptions): ProviderProxyFetch {
  const binding = options.binding;
  // 未启用或没有条目时零开销直连，不引入额外 request 包装。
  if (!binding?.enabled || !binding.entries?.length) {
    return options.fetch;
  }
  const directFetch = options.fetch;
  // 懒加载 CA：只在真的要走代理时才读盘，未配代理的供应商不付这次 IO。
  let caCertificates: Buffer | undefined;
  let caCertificatesLoaded = false;
  const getCaCertificates = (): Buffer | undefined => {
    if (!caCertificatesLoaded) {
      caCertificates = loadTlsCaCertificates({
        caCertFile: options.caCertFile,
        env: options.env,
      });
      caCertificatesLoaded = true;
    }
    return caCertificates;
  };

  return async (input, init) => {
    const requestUrl = readRequestUrl(input);
    if (!requestUrl || (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:")) {
      return directFetch(input, init);
    }
    // noProxy 命中的目标直连（如内网模型网关），与全局代理的绕过语义一致。
    if (proxyNoProxyMatches(requestUrl.href, binding.noProxy)) {
      return directFetch(input, init);
    }

    const state = rotationState.get(options.providerId) ?? { index: -1 };
    const rotation = { value: state.index };
    const entry = pickProviderProxyEntry({
      binding,
      accountId: options.accountId,
      rotation,
    });
    state.index = rotation.value;
    rotationState.set(options.providerId, state);

    if (!entry) {
      // 绑定开启但条目全部失效（被停用/删除/URL 非法）时直连，不让请求彻底失败。
      return directFetch(input, init);
    }

    const request = await normalizeRequest(input, init);
    return performRequest(request, {
      ca: getCaCertificates(),
      proxyUrl: entry.proxyUrl,
    });
  };
}

function readRequestUrl(input: Parameters<ProviderProxyFetch>[0]): URL | undefined {
  try {
    if (input instanceof URL) return input;
    if (input instanceof Request) return new URL(input.url);
    return new URL(String(input));
  } catch {
    return undefined;
  }
}

interface NormalizedRequest {
  body?: Buffer;
  headers: Headers;
  method: string;
  signal?: AbortSignal | null;
  url: URL;
}

async function normalizeRequest(
  input: Parameters<ProviderProxyFetch>[0],
  init: Parameters<ProviderProxyFetch>[1],
): Promise<NormalizedRequest> {
  const request = new Request(input, init);
  const method = request.method.toUpperCase();
  // GET/HEAD 没有正文；其余先读成 Buffer，才能交给 http.request 重复发送。
  const arrayBuffer =
    method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  return {
    body: arrayBuffer && arrayBuffer.byteLength > 0 ? Buffer.from(arrayBuffer) : undefined,
    headers: request.headers,
    method,
    signal: request.signal,
    url: new URL(request.url),
  };
}

/**
 * 用 node http/https + 指定 agent 发请求，并转成 web Response。
 *
 * 状态码表示不了的情况（<200 / >599）交给 toWebResponse 以普通 reject 失败，
 * 与 proxy-fetch.ts 的既有约定一致——不在这里抛同步异常打死 agent 进程。
 */
function performRequest(
  request: NormalizedRequest,
  options: { ca?: Buffer; proxyUrl?: string },
): Promise<Response> {
  const transport = request.url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const signal = request.signal ?? undefined;
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    let settled = false;
    let responseMessage: http.IncomingMessage | undefined;
    let clientRequest: http.ClientRequest | undefined;

    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
      clientRequest?.off("error", onRequestError);
      responseMessage?.off("close", cleanup);
      responseMessage?.off("error", onResponseError);
    };
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onRequestError = (error: Error): void => {
      rejectOnce(error);
    };
    const onResponseError = (): void => {
      // 正文流错误由 Readable.toWeb 传播给消费方；这里只防止 abort destroy 变成 unhandled。
    };
    const onAbort = (): void => {
      const error = abortReason(signal);
      responseMessage?.destroy(error);
      clientRequest?.destroy(error);
      rejectOnce(error);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    clientRequest = transport.request(
      {
        agent: createAgent(request.url, options),
        headers: headersToOutgoing(request.headers),
        hostname: request.url.hostname,
        method: request.method,
        path: `${request.url.pathname}${request.url.search}`,
        port: request.url.port || undefined,
        protocol: request.url.protocol,
      },
      (message) => {
        responseMessage = message;
        responseMessage.once("close", cleanup);
        responseMessage.once("error", onResponseError);
        let response: Response;
        try {
          response = toWebResponse(readIncomingResponse(message));
        } catch (error) {
          message.destroy();
          rejectOnce(error);
          return;
        }
        settled = true;
        resolve(response);
      },
    );

    clientRequest.once("error", onRequestError);
    clientRequest.end(request.body);
  });
}

function abortReason(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * 建 agent。proxy-agent 的 ProxyAgent 按代理 URL 的 scheme 分派底层 agent
 * （http/https → http(s)-proxy-agent，socks4/5 → socks-proxy-agent），
 * 因此这里不需要自己判断 scheme。
 */
function createAgent(
  url: URL,
  options: { ca?: Buffer; proxyUrl?: string },
): http.Agent | https.Agent | ProxyAgent {
  if (options.proxyUrl) {
    return new ProxyAgent({
      ca: options.ca,
      getProxyForUrl: () => options.proxyUrl ?? "",
      httpsAgent: options.ca ? new https.Agent({ ca: options.ca }) : undefined,
    }) as unknown as http.Agent;
  }
  if (url.protocol === "https:") {
    return new https.Agent({ ca: options.ca });
  }
  return new http.Agent();
}

function headersToOutgoing(headers: Headers): http.OutgoingHttpHeaders {
  const outgoing: http.OutgoingHttpHeaders = {};
  headers.forEach((value, key) => {
    outgoing[key] = value;
  });
  return outgoing;
}
