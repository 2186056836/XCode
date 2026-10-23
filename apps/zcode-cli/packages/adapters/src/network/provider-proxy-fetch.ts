/**
 * 供应商级代理 fetch（agent 侧，Node-only）。
 *
 * 与 `proxy-fetch.ts`（全局 httpProxy）的关系复刻 9router 的优先级规则
 * （`const envProxyUrl = connectionProxyUrl ? null : envProxy`）：**绑定了池的连接独占出口**。
 * 该连接的请求只可能在「池里的那条代理」与「直连」之间二选一，
 * 绝不会因为池条目失效 / 命中 noProxy 而回落到全局代理。
 * 未绑定池的连接（含该账号当前没有任何绑定）原样交给 options.fetch
 * （= 全局代理链：配了全局代理就走它，没配就直连）。
 *
 * 为什么不用 undici 的 ProxyAgent：undici 只支持 http/https CONNECT 隧道，
 * socks5 会直接抛 InvalidArgumentError（undici 6.x：Invalid URL protocol）。本模块复用仓库既有的
 * `proxy-agent`（其 ProxyAgent 按 scheme 自动分派 http-proxy-agent / socks-proxy-agent，
 * 且 adapters 已直接依赖它），从而 http/https/socks4/socks5 全部可用。
 *
 * 连接级绑定：多账号供应商（Qoder / CodeBuddy）的账号身份在绑定模型时由
 * resolveProviderProxyAccountId 解析（Qoder 内部身份头 / CodeBuddy JWT 的 sub），
 * 结果作为 accountId 传入；该身份在 bindings 里有条目就用那一条代理，
 * 没有条目就是「未绑定」—— 出口跟随 XCode 全局代理状态（对齐 9router 连接级
 * proxyPoolId 为空时回落到 envProxy 的语义）。
 */
import http from "node:http";
import https from "node:https";
import { ProxyAgent } from "proxy-agent";
import {
  isProviderProxyBindingConfigured,
  proxyNoProxyMatches,
  resolveProviderProxyRoute,
  type ProviderProxyBinding,
} from "@zcode/shared";
import { loadTlsCaCertificates } from "./http-config.js";
import { readIncomingResponse, toWebResponse } from "./incoming-response.js";

export type ProviderProxyFetch = typeof globalThis.fetch;

export interface ProviderProxyFetchOptions {
  binding: ProviderProxyBinding | undefined;
  /** 供应商稳定标识；同时是无账号免费档 provider 级轮询游标的键。 */
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
  /**
   * 本次请求实际命中的池条目回调。
   *
   * 供应商级轮询在 fetch 时才挑池，记账层（core）拿不到结果；这里把真实命中的条目
   * 回传，让「使用详情」显示节点名而不是候选数量。直连/跟随全局时不回调。
   */
  onResolvedPool?: (entry: { id: string; name?: string }) => void;
}

const QODER_IDENTITY_USER_ID_HEADER = "x-qoder-internal-user-id";

/**
 * 解析当前请求所属的账号 id。
 *
 * - Qoder：内部身份头 `x-qoder-internal-user-id`（overlay 注入，见 model-execution 的
 *   readQoderIdentity；PAT 场景该头可能缺失，此时返回 undefined 走策略）。
 * - CodeBuddy：apiKey 是 JWT，`sub` 即账号 id。
 * - zai / bigmodel（Coding Plan 账号族）：headers/apiKey 里没有账号身份，调用方用宿主下发的
 *   `requestAuth.connectionId`（= accountRef）兜底，见 model-execution 的 AiSdkProviderConfig.accountId。
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
 * 包装 fetch：绑定命中时走池里那条代理，未绑定交给全局链，绑定但条目不可用时硬直连。
 *
 * 每次调用都重新解析（binding 与账号身份都是请求级的），因此改绑定/切账号无需重启。
 */
export function createProviderProxyFetch(options: ProviderProxyFetchOptions): ProviderProxyFetch {
  const binding = options.binding;
  // 一条绑定都没有：零开销交回全局代理链（未配全局即直连）。
  if (!isProviderProxyBindingConfigured(binding) || !binding) {
    return options.fetch;
  }
  const inheritFetch = options.fetch;
  // 懒加载 CA：只在真的要走代理/直连时才读盘，未配代理的供应商不付这次 IO。
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

  /**
   * 裸直连：自己的 node http/https + CA，**不经过全局代理链**。
   * 这是本模块所有「不走池」分支的唯一出口——配置了代理池的供应商在这里断掉与
   * 全局 httpProxy / XCODE_HTTP_PROXY 的一切联系。
   */
  const directFetch = async (
    input: Parameters<ProviderProxyFetch>[0],
    init?: Parameters<ProviderProxyFetch>[1],
  ): Promise<Response> =>
    performRequest(await normalizeRequest(input, init), { ca: getCaCertificates() });

  return async (input, init) => {
    const requestUrl = readRequestUrl(input);
    // 解析不出 URL / 非 http(s)：这条路本来就不该被代理，交回上层（全局链同样只是透传）。
    if (!requestUrl || (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:")) {
      return inheritFetch(input, init);
    }
    const route = resolveProviderProxyRoute({
      binding,
      accountId: options.accountId,
      // providerId 是供应商级轮询游标的键（无账号免费档走这一层）。
      providerId: options.providerId,
    });

    if (route.kind === "inherit") {
      // 未绑定池：出口跟随全局代理状态（连 noProxy 规则也交给全局链自己判）。
      return inheritFetch(input, init);
    }
    if (route.kind !== "pool") {
      // no-proxy：该连接绑定了池但条目不可用（停用 / URL 非法）—— 直连，绝不回落全局代理。
      return directFetch(input, init);
    }

    const { entry } = route;
    // 条目级 noProxy：命中就直连（同样是裸直连，不回落全局代理）。
    if (proxyNoProxyMatches(requestUrl.href, entry.noProxy)) {
      return directFetch(input, init);
    }
    // 真正经池出站才回报命中节点：noProxy 直连没有走这个池，记成它会误导排查。
    options.onResolvedPool?.({ id: entry.id, ...(entry.name ? { name: entry.name } : {}) });

    const request = await normalizeRequest(input, init);
    try {
      return await performRequest(request, {
        ca: getCaCertificates(),
        proxyUrl: entry.proxyUrl,
      });
    } catch (error) {
      if (entry.strictProxy) {
        throw new Error(
          `[ProviderProxy] Proxy required but failed (strictProxy=true): ${describeError(error)}`,
        );
      }
      // 非严格模式：代理建连失败时回退直连（对齐 9router proxyAwareFetch 的非 strict 分支）。
      // performRequest 只在拿到响应前 reject，且这里复用已归一化的请求（正文不会再被消费一次），
      // 因此不存在「已发出请求再补发一次」的重复写。
      return performRequest(request, { ca: getCaCertificates() });
    }
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
