/**
 * 代理连通性测试（services 层，Node-only）。
 *
 * 对齐 9router `testProxyUrl({ proxyUrl, testUrl, timeoutMs })`：
 * - 默认测试 URL https://www.google.com/generate_204（原实现用 https://google.com/，
 *   这里换成 204 端点：HEAD 请求无需下载正文，且 204 语义更明确地表示「隧道打通」）。
 * - 默认超时 8s，上限 30s。
 * - 返回 `{ ok, status, statusText, url, elapsedMs }` 或 `{ ok: false, error }`。
 * - 错误信息带 cause code（`err.cause?.code`），否则用户只会看到 "fetch failed"。
 *
 * 与 9router 的差异：undici 的 ProxyAgent 只支持 http/https 代理，socks5 会直接抛
 * InvalidArgumentError。这里对 socks* 走 socks-proxy-agent（仓库已有该依赖）建立隧道，
 * 再交给 undici 的 Agent 复用同一 socket 工厂，避免「测试通过但实际出口不支持 socks」的假阳性。
 */
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { validateProxyPoolUrl } from "@zcode/shared";

const DEFAULT_TEST_URL = "https://www.google.com/generate_204";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 30000;

export interface ProxyTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  elapsedMs?: number;
  error?: string;
}

export interface ProxyTestInput {
  proxyUrl: string;
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

/**
 * 真实发一次请求验证代理连通性。
 *
 * 用 HEAD 而非 GET：测试目的是「隧道能不能打通」，不需要正文；
 * 204 端点配合 HEAD 也不会因 3xx/正文大小产生噪音。
 */
export async function testProxyUrl(input: ProxyTestInput): Promise<ProxyTestResult> {
  const validated = validateProxyPoolUrl(input.proxyUrl);
  if (!validated.ok || !validated.normalizedUrl) {
    return { ok: false, error: `Invalid proxy URL: ${validated.error ?? "unknown"}` };
  }
  const normalizedProxyUrl = validated.normalizedUrl;
  const normalizedTestUrl = input.testUrl?.trim() || DEFAULT_TEST_URL;
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

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: { "User-Agent": "XCode" },
      });
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && error.name === "AbortError"
            ? `Proxy test timed out after ${timeoutMs}ms`
            : describeProxyTestError(error),
      };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close();
    } catch {
      // 关闭失败不影响测试结论；dispatcher 已无引用，交给 GC。
    }
  }
}

export const PROXY_TEST_DEFAULT_URL = DEFAULT_TEST_URL;
export const PROXY_TEST_DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
export const PROXY_TEST_MAX_TIMEOUT_MS = MAX_TIMEOUT_MS;
