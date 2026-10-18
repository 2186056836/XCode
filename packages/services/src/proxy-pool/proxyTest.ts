/**
 * 代理连通性测试（services 层，Node-only）。
 *
 * 对齐 9router `testProxyUrl({ proxyUrl, testUrl, timeoutMs })`，但探针策略不同：
 *
 * - **多探针按序回退**，不是单一 google/generate_204。实测在多地出口（如悉尼）上
 *   google 系域名会被 reset，单一探针会把「代理可用」误报成失败。
 * - **GET 而非 HEAD**：HEAD 在部分 CDN 上被拒（实测 api.ipify.org 对 HEAD 返回 520），
 *   测试目的是「隧道能不能打通」，GET 的 204/200 语义同样明确且兼容性更好。
 * - 首个探针 api.ipify.org 会回显出口 IP，结果里的 `exitIp` 让用户一眼确认
 *   请求走的是哪条线路，而不是只看到「连通」。
 * - 默认超时 8s（单探针），上限 30s。
 * - 返回 `{ ok, status, statusText, url, elapsedMs, exitIp }` 或 `{ ok: false, error }`。
 * - 错误信息带 cause code（`err.cause?.code`），否则用户只会看到 "fetch failed"。
 *
 * 与 9router 的差异：undici 的 ProxyAgent 只支持 http/https 代理，socks5 会直接抛
 * InvalidArgumentError。这里对 socks* 走 socks-proxy-agent（仓库已有该依赖）建立隧道，
 * 再交给 undici 的 Agent 复用同一 socket 工厂，避免「测试通过但实际出口不支持 socks」的假阳性。
 */
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { validateProxyPoolUrl } from "@zcode/shared";

/**
 * 探针候选，按顺序尝试，任一成功即返回。
 *
 * 顺序依据：ipify 既能验证隧道又能回显出口 IP；gstatic/google 作为通用兜底
 * （对限定白名单的代理，Google 系通常是最后才可用的那一批）。
 */
const DEFAULT_TEST_TARGETS = [
  "https://api.ipify.org/",
  "https://www.gstatic.com/generate_204",
  "https://www.google.com/generate_204",
] as const;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 30000;

export interface ProxyTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  elapsedMs?: number;
  /** 探针回显的出口 IP（仅 ipify 类探针会给出）。 */
  exitIp?: string;
  error?: string;
}

export interface ProxyTestInput {
  proxyUrl: string;
  /** 显式指定探针时只测这一个，不再回退。 */
  testUrl?: string;
  timeoutMs?: number;
}

/**
 * 把底层错误压成一行可读文案，保留 cause code。
 *
 * undici 的 fetch 失败只给 "fetch failed"，真正的 ECONNREFUSED / ENOTFOUND /
 * CERT_HAS_EXPIRED 都在 `err.cause` 上；不展开的话用户无法区分「代理没开」和「证书不对」。
 */
function describeProxyTestError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }
  const base = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const causeCode = cause?.code ?? (error as { code?: string }).code;
  const causeMessage = cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }
  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }
  return base;
}

function isSocksProxy(proxyUrl: string): boolean {
  return /^socks(4|4a|5|5h)?:\/\//i.test(proxyUrl);
}

/** 仅接受「整段正文就是一个 IP」的响应，避免把 HTML 错误页当成出口地址。 */
function extractExitIp(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 45) {
    return undefined;
  }
  if (!/^[0-9a-f.:]+$/i.test(trimmed) || !/[.:]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * 为 socks 代理建一个 undici Dispatcher。
 *
 * socks-proxy-agent 是 http.Agent 子类，undici 不接受；这里用它的 connect 能力手工
 * 建隧道再包成 undici Agent 的 connect 工厂——undici Agent 的 `connect` 选项接受一个
 * 返回 socket 的工厂函数，正好可以复用 socks 的握手结果。
 */
async function createSocksDispatcher(proxyUrl: string): Promise<Dispatcher> {
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  const socksAgent = new SocksProxyAgent(proxyUrl);
  const connector = (
    options: { hostname?: string; host?: string; port?: string | number; protocol?: string },
    callback: (error: Error | null, socket?: unknown) => void,
  ): void => {
    const host = options.hostname ?? options.host ?? "";
    const port = Number(options.port ?? (options.protocol === "https:" ? 443 : 80));
    // 借用 http.Agent 的 createConnection：socks-proxy-agent 已实现 connect(req, opts)，
    // 这里构造一个最小 req 形状即可（它只读 socket 与 opts 上的 host/port）。
    const fakeRequest = { destroy: () => {}, on: () => fakeRequest } as never;
    socksAgent
      .connect(fakeRequest, {
        host,
        port,
        protocol: options.protocol ?? "https:",
        secureEndpoint: options.protocol === "https:",
        servername: host,
      } as never)
      .then((socket) => callback(null, socket))
      .catch((error: Error) => callback(error));
  };
  return new Agent({ connect: connector as never });
}

/** 单次探针请求；失败/非 2xx 都返回结果对象，由调用方决定是否换下一个探针。 */
async function probeOnce(
  target: string,
  dispatcher: Dispatcher,
  timeoutMs: number,
): Promise<ProxyTestResult> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await undiciFetch(target, {
      method: "GET",
      dispatcher,
      signal: controller.signal,
      headers: { "User-Agent": "XCode" },
    });
    const body = await response.text().catch(() => "");
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: target,
      elapsedMs: Date.now() - startedAt,
      exitIp: extractExitIp(body),
    };
  } catch (error) {
    return {
      ok: false,
      url: target,
      elapsedMs: Date.now() - startedAt,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `Proxy test timed out after ${timeoutMs}ms`
          : describeProxyTestError(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 真实发一次请求验证代理连通性。
 *
 * 按 DEFAULT_TEST_TARGETS 顺序回退，任一探针拿到 2xx 即判定连通并返回；
 * 全部失败时返回最后一个失败结果（带它自己的 error/status，便于定位）。
 */
export async function testProxyUrl(input: ProxyTestInput): Promise<ProxyTestResult> {
  const validated = validateProxyPoolUrl(input.proxyUrl);
  if (!validated.ok || !validated.normalizedUrl) {
    return { ok: false, error: `Invalid proxy URL: ${validated.error ?? "unknown"}` };
  }
  const normalizedProxyUrl = validated.normalizedUrl;
  const explicitTestUrl = input.testUrl?.trim();
  const targets: readonly string[] = explicitTestUrl ? [explicitTestUrl] : DEFAULT_TEST_TARGETS;
  const timeoutMsRaw = Number(input.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher: Dispatcher | undefined;
  try {
    try {
      dispatcher = isSocksProxy(normalizedProxyUrl)
        ? await createSocksDispatcher(normalizedProxyUrl)
        : new ProxyAgent({ uri: normalizedProxyUrl });
    } catch (error) {
      return {
        ok: false,
        error: `Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let lastFailure: ProxyTestResult | undefined;
    for (const target of targets) {
      const result = await probeOnce(target, dispatcher, timeoutMs);
      if (result.ok) {
        return result;
      }
      lastFailure = result;
    }
    return lastFailure ?? { ok: false, error: "No proxy test target configured" };
  } finally {
    try {
      await dispatcher?.close();
    } catch {
      // 关闭失败不影响测试结论；dispatcher 已无引用，交给 GC。
    }
  }
}

export const PROXY_TEST_DEFAULT_URL = DEFAULT_TEST_TARGETS[0];
export const PROXY_TEST_DEFAULT_TARGETS = DEFAULT_TEST_TARGETS;
export const PROXY_TEST_DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
export const PROXY_TEST_MAX_TIMEOUT_MS = MAX_TIMEOUT_MS;
