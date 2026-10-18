/**
 * 连接级代理池出口（Host 侧，Node-only）。
 *
 * 与 agent 侧 `provider-proxy-fetch.ts` 是同一个规则的两套实现：agent 用 node http/https +
 * proxy-agent，Host 用 undici（已是本包声明依赖并已列入 desktop tsup externals）。
 *
 * 复刻的 9router 优先级规则（`const envProxyUrl = connectionProxyUrl ? null : envProxy`）：
 * **绑定了池的连接独占出口** —— 该连接的请求只可能在「池里那条代理」与「裸直连」之间二选一，
 * 绝不会因为池条目停用 / 命中 noProxy 而回落到 XCode 全局代理。
 * 未绑定的连接原样交给 inheritFetch（= 全局代理链：配了全局代理就走它，没配即直连）。
 *
 * 为什么 Host 侧必须自己也做一遍：Host 的供应商网络调用（上游模型列表、Qoder/CodeBuddy 的
 * 登录/签到/配额、平台 apiClient）都发生在 Electron main 之外，agent 子进程的代理配置
 * 管不到它们；而这些请求原本清一色走 hostApiNetworkTransport（= 全局代理），
 * 正是「全局代理会代理提供商相关请求」这个冲突的 Host 侧入口。
 */
import { readFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import {
  isProviderProxyBindingConfigured,
  proxyNoProxyMatches,
  resolveProviderProxyRoute,
  type ProviderProxyBinding,
} from "@zcode/shared";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { createSocksConnector, parseSocksProxyUrl } from "./socksConnector.js";

const log = createServiceLogger("provider-proxy");

export interface ProviderPoolFetchOptions {
  /**
   * 「跟随全局代理状态」的出口：该连接未绑定池时用它。
   * 生产装配传 hostApiNetworkTransport.fetch（配了全局代理就走它，没配即直连）。
   */
  inheritFetch: typeof fetch;
  /** 解析某供应商的代理绑定；未配置返回 undefined。 */
  resolveBinding(providerId: string): Promise<ProviderProxyBinding | undefined>;
  /** 全局 CA 证书路径（与全局代理链同源）：池代理与裸直连同样需要它做 MITM 信任。 */
  resolveCaCertPath?(): Promise<string | undefined>;
}

export interface ProviderPoolFetch {
  /**
   * 取某供应商（可指定账号）的出口 fetch。
   *
   * 每次调用都返回一个新闭包、并在请求时重新解析绑定，因此「改绑定 / 切账号 / 池条目增删」
   * 无需重启或重建上层对象。
   */
  fetchFor(providerId: string, accountId?: string): typeof fetch;
  /** 同步退出用：dispatcher 直接 destroy。 */
  dispose(): void;
  /** 等待式退出用：dispatcher close，等在途请求收口。 */
  disposeAndWait(): Promise<void>;
}

/** 单次请求的出口：与 shared 的 ProviderProxyRoute 同源，此处只做落地点区分。 */
type ResolvedExit =
  | { kind: "inherit" }
  | { kind: "direct" }
  | { kind: "pool"; proxyUrl: string; strictProxy: boolean };

export function createProviderPoolFetch(options: ProviderPoolFetchOptions): ProviderPoolFetch {
  const dispatchers = new Map<string, Promise<Dispatcher>>();
  const caCache = new Map<string, Promise<string[] | undefined>>();
  let disposed = false;
  let disposeMode: "close" | "destroy" | undefined;
  let disposePromise: Promise<void> | undefined;

  const getCaCertificates = async (): Promise<string[] | undefined> => {
    const caCertPath = await options.resolveCaCertPath?.().catch(() => undefined);
    if (!caCertPath) return undefined;
    let cached = caCache.get(caCertPath);
    if (!cached) {
      cached = readFile(caCertPath, "utf8")
        .then((customCa) => {
          // Node 的 tls.ca 是整份替换：只挂企业代理 CA 会让未被 MITM 重签的公网证书失去信任链。
          return [...rootCertificates, customCa];
        })
        .catch(() => undefined);
      caCache.set(caCertPath, cached);
    }
    return cached;
  };

  const getDispatcher = (key: string, create: () => Promise<Dispatcher>): Promise<Dispatcher> => {
    let promise = dispatchers.get(key);
    if (!promise) {
      const created = create();
      promise = created;
      dispatchers.set(key, created);
      created.catch(() => {
        // 临时 IO 失败只影响当前请求；清掉 rejected 缓存，避免同一路由被一次竞态永久锁死。
        if (dispatchers.get(key) === created) {
          dispatchers.delete(key);
        }
      });
    }
    return promise;
  };

  const createProxyDispatcher = async (proxyUrl: string): Promise<Dispatcher> => {
    const ca = await getCaCertificates();
    const socksConfig = parseSocksProxyUrl(proxyUrl);
    if (socksConfig) {
      return new Agent({
        connect: createSocksConnector(socksConfig, ca ? { ca } : {}),
      });
    }
    return new ProxyAgent({
      uri: proxyUrl,
      ...(ca ? { proxyTls: { ca }, requestTls: { ca } } : {}),
    });
  };

  const createDirectDispatcher = async (): Promise<Dispatcher> => {
    const ca = await getCaCertificates();
    return new Agent({ connect: ca ? { ca } : undefined });
  };

  const dispatch = async (
    request: MaterializedRequest,
    dispatcher: Promise<Dispatcher>,
  ): Promise<Response> => {
    const resolved = await dispatcher;
    if (disposed) {
      throw new Error("Provider proxy transport has been disposed");
    }
    return (await undiciFetch(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        ...(request.redirect ? { redirect: request.redirect } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        dispatcher: resolved,
      } as never,
    )) as unknown as Response;
  };

  const runDirect = async (request: MaterializedRequest): Promise<Response> =>
    dispatch(request, getDispatcher("direct", createDirectDispatcher));

  const fetchFor = (providerId: string, accountId?: string): typeof fetch =>
    async function providerPoolFetch(input, init) {
      const requestUrl = readRequestUrl(input);
      // 解析不出 URL / 非 http(s)：这条路本来就不该被代理，交回全局链（它同样只是透传）。
      if (!requestUrl || (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:")) {
        return options.inheritFetch(input, init);
      }

      let binding: ProviderProxyBinding | undefined;
      try {
        binding = await options.resolveBinding(providerId);
      } catch (error) {
        // 绑定读不到就不知道池是否适用 —— 退回改动前的行为（全局链），不静默把出口改成直连。
        log.warn("读取供应商代理绑定失败，本次请求回退全局代理链", {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
        return options.inheritFetch(input, init);
      }
      if (!isProviderProxyBindingConfigured(binding) || !binding) {
        return options.inheritFetch(input, init);
      }

      const route = resolveProviderProxyRoute({ binding, accountId, providerId });
      const exit = resolveExit(route, requestUrl);
      if (exit.kind === "inherit") {
        // 该连接未绑定池：出口跟随 XCode 全局代理状态。
        return options.inheritFetch(input, init);
      }

      // 只有真要自己发请求时才物化正文：inherit 分支保持原样透传，不额外缓冲请求体。
      const request = await materializeRequest(input, init);
      if (exit.kind === "direct") {
        // no-proxy / 命中 noProxy：直连，绝不回落全局代理。
        return runDirect(request);
      }

      try {
        return await dispatch(
          request,
          getDispatcher(`pool:${exit.proxyUrl}`, () => createProxyDispatcher(exit.proxyUrl)),
        );
      } catch (error) {
        if (exit.strictProxy) {
          throw new Error(
            `[ProviderProxy] Proxy required but failed (strictProxy=true): ${describeError(error)}`,
          );
        }
        // 非严格模式回退裸直连（对齐 9router proxyAwareFetch 的非 strict 分支）。
        // request 已完全物化（正文读成不可变体），不会重复消费请求体。
        return runDirect(request);
      }
    };

  const startDispose = (mode: "close" | "destroy"): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    disposeMode = mode;
    const pending = [...dispatchers.values()];
    dispatchers.clear();
    caCache.clear();
    disposePromise = Promise.allSettled(
      pending.map(async (dispatcherPromise) => {
        const dispatcher = await dispatcherPromise;
        if (disposeMode === "close") {
          await dispatcher.close();
        } else {
          await dispatcher.destroy();
        }
      }),
    ).then(() => undefined);
    return disposePromise;
  };

  return {
    fetchFor,
    dispose() {
      void startDispose("destroy");
    },
    disposeAndWait() {
      return startDispose("close");
    },
  };
}

function resolveExit(
  route: ReturnType<typeof resolveProviderProxyRoute>,
  requestUrl: URL,
): ResolvedExit {
  if (route.kind === "inherit") {
    return { kind: "inherit" };
  }
  if (route.kind !== "pool") {
    // no-proxy：这条连接绑了池但该池当前不可用 —— 直连，绝不回落全局代理。
    return { kind: "direct" };
  }
  // 条目级 noProxy（如内网模型网关）：语义与全局代理的绕过规则一致。
  if (proxyNoProxyMatches(requestUrl.href, route.entry.noProxy)) {
    return { kind: "direct" };
  }
  return {
    kind: "pool",
    proxyUrl: route.entry.proxyUrl,
    strictProxy: route.entry.strictProxy === true,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readRequestUrl(input: Parameters<typeof globalThis.fetch>[0]): URL | undefined {
  try {
    if (input instanceof URL) return input;
    if (typeof Request !== "undefined" && input instanceof Request) return new URL(input.url);
    return new URL(String(input));
  } catch {
    return undefined;
  }
}

/** 本包 tsconfig 不含 DOM lib，`BodyInit` 不是全局名；用 RequestInit 反查同一类型。 */
type FetchBody = NonNullable<RequestInit["body"]>;

interface MaterializedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: FetchBody;
  redirect?: RequestInit["redirect"];
  signal?: AbortSignal | null;
}

/**
 * 把 (input, init) 物化成「可重复发送」的形态。
 *
 * 为什么要物化：池代理建连失败要能回退直连再发一次。加上 Request 本身只能被消费一次，
 * 直接把原 init 传两次会在第二次拿到空正文（或 "body already used"）。
 * 代价是正文进内存 —— Host 侧这些调用（模型列表 / 登录 / 签到 / 配额 / 平台 API）都是小 JSON。
 */
async function materializeRequest(
  input: Parameters<typeof globalThis.fetch>[0],
  init: Parameters<typeof globalThis.fetch>[1],
): Promise<MaterializedRequest> {
  if (typeof Request !== "undefined" && input instanceof Request) {
    const overrideBody = init?.body;
    const rawBody =
      overrideBody !== undefined && overrideBody !== null
        ? overrideBody
        : input.body
          ? await input
              .clone()
              .arrayBuffer()
              .then((buffer) => (buffer.byteLength > 0 ? buffer : undefined))
          : undefined;
    return {
      url: input.url,
      method: (init?.method ?? input.method).toUpperCase(),
      headers: new Headers([...input.headers, ...new Headers(init?.headers ?? {})]),
      ...(await buildBody(rawBody)),
      ...(optionalInit(init?.redirect ?? input.redirect, (redirect) => ({ redirect })) ?? {}),
      signal: init?.signal ?? input.signal,
    };
  }
  const url = input instanceof URL ? input.href : String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const skipBody = method === "GET" || method === "HEAD";
  return {
    url,
    method,
    headers: new Headers(init?.headers ?? {}),
    ...(skipBody ? {} : await buildBody(init?.body)),
    ...(optionalInit(init?.redirect, (redirect) => ({ redirect })) ?? {}),
    signal: init?.signal ?? null,
  };
}

/** 只在值存在时展开可选字段，避免在 exactOptionalPropertyTypes 下塞进 undefined。 */
function optionalInit<T, R>(value: T | null | undefined, build: (value: T) => R): R | undefined {
  return value === undefined || value === null ? undefined : build(value);
}

async function buildBody(body: unknown): Promise<{ body?: FetchBody }> {
  if (body === undefined || body === null) return {};
  if (typeof body === "string" || body instanceof URLSearchParams) return { body };
  if (body instanceof ArrayBuffer) return { body };
  if (ArrayBuffer.isView(body)) return { body: body as unknown as FetchBody };
  if (typeof FormData !== "undefined" && body instanceof FormData) return { body };
  if (typeof Blob !== "undefined" && body instanceof Blob) return { body };
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { body: await new Response(body).arrayBuffer() };
  }
  const maybeNodeStream = body as { pipe?: unknown; on?: unknown };
  if (typeof maybeNodeStream.pipe === "function" && typeof maybeNodeStream.on === "function") {
    return { body: await readNodeStream(body as NodeJS.ReadableStream) };
  }
  return { body: body as FetchBody };
}

async function readNodeStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string | Uint8Array>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
