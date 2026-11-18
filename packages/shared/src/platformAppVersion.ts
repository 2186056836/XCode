/**
 * 官方 ZCode 平台版本解析（发往 zcode.z.ai 的 `X-ZCode-App-Version` / `app_version`）。
 *
 * 平台按版本决定下发内容：营销投放 `marketing/touch` 实测 3.16.2 返回 0 条、
 * 3.17.2 返回 1 条（含 `claim_zcode_plan` 领取入口）。fork 的产品版本永远落后于
 * 官方，硬编码一处就会在官方发版后失效——所以这里**从官方自己的更新通道取**：
 *
 *   GET {origin}/api/v1/releases/electron/manifest?platform=windows-x86_64&channel=1
 *   → YAML `version: 3.17.2`
 *
 * 与官方 main 进程 ManifestUpdateProvider.getLatestVersion 同一来源、同一 query。
 * 取值后缓存 15 分钟（与官方客户端自动检查更新的节奏一致），失败保留上次成功值，
 * 再退回内置基线，绝不因为网络问题发出空版本头。
 */
import { DEFAULT_XCODE_ENDPOINT_ORIGIN, normalizeZCodeEndpointOrigin } from "./zcodeEndpoint.js";

/** 内置基线：官方 3.17.2（首个确认营销投放可用的版本）。仅当远端从未成功时为兜底。 */
const PLATFORM_APP_VERSION_BASELINE = "3.17.2";

/** 缓存有效期：15 分钟（官方自动检查更新的节奏）。 */
export const PLATFORM_APP_VERSION_TTL_MS = 15 * 60 * 1000;

/** manifest 请求超时：远端抖动不能拖住任何调用方。 */
const MANIFEST_TIMEOUT_MS = 8_000;

const RELEASE_CHANNEL_STABLE = "1";
const RELEASE_CHANNEL_PREVIEW = "3";

let cachedVersion: string = PLATFORM_APP_VERSION_BASELINE;
let cachedAt = 0;
let inFlight: Promise<string> | null = null;

/** 当前生效的官方平台版本（同步读，永远返回一个非空值）。 */
export function getPlatformAppVersion(): string {
  return cachedVersion;
}

/** 平台版本缓存年龄（ms），供日志/诊断使用。 */
export function getPlatformAppVersionAgeMs(now = Date.now()): number {
  return cachedAt === 0 ? Number.POSITIVE_INFINITY : now - cachedAt;
}

/** 官方发布通道 → manifest 的 channel 参数（官方 mapReleaseChannelToApiValue 同值）。 */
function resolveChannelValue(env: NodeJS.ProcessEnv): string {
  return (env.ZCODE_ENV ?? "").trim().toLowerCase() === "preview"
    ? RELEASE_CHANNEL_PREVIEW
    : RELEASE_CHANNEL_STABLE;
}

/** 官方 getElectronReleasePlatform 同式：windows-x86_64 / darwin-aarch64 … */
export function resolveReleasePlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch === "ia32" ? "x86" : arch;
  return `${os}-${cpu}`;
}

/** 从 manifest 的 YAML 文本里取 `version:`（只认顶层、只认语义化版本）。 */
export function parseManifestVersion(text: string): string | null {
  const match = /^version:\s*['"]?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)['"]?\s*$/m.exec(text);
  return match?.[1] ?? null;
}

/**
 * 拉一次官方 manifest 并解析版本号；失败返回 null（调用方保留旧值）。
 * 不抛异常：这是后台增强，不能影响任何主流程。
 */
export async function fetchLatestPlatformAppVersion(options?: {
  endpointOrigin?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;
  try {
    const origin = normalizeZCodeEndpointOrigin(
      options?.endpointOrigin?.trim() || DEFAULT_XCODE_ENDPOINT_ORIGIN,
    );
    const url = new URL(`${origin}/api/v1/releases/electron/manifest`);
    url.searchParams.set("platform", resolveReleasePlatformKey());
    url.searchParams.set("channel", resolveChannelValue(env));
    const response = await fetchImpl(url.href, {
      method: "GET",
      headers: {
        accept: "application/x-yaml,text/yaml,text/plain,*/*",
        "X-Platform": resolveReleasePlatformKey(),
        "X-Release-Channel": resolveChannelValue(env),
      },
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseManifestVersion(await response.text());
  } catch {
    return null;
  }
}

/**
 * 刷新缓存（并发合并：同一时刻只有一个请求）。
 * 成功后更新缓存与时间戳；失败保留旧值并返回旧值。
 */
export async function refreshPlatformAppVersion(options?: {
  endpointOrigin?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** 忽略 TTL 强制刷新。 */
  force?: boolean;
  now?: () => number;
}): Promise<string> {
  const now = options?.now ?? Date.now;
  if (!options?.force && now() - cachedAt < PLATFORM_APP_VERSION_TTL_MS) {
    return cachedVersion;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const latest = await fetchLatestPlatformAppVersion(options);
    if (latest) {
      cachedVersion = latest;
      cachedAt = now();
    }
    return cachedVersion;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * 启动后台定时刷新（每 15 分钟）。幂等：重复调用只保留一个定时器。
 * 立即拉一次（不 await），此后按 TTL 轮询；定时器 unref，不阻塞进程退出。
 */
let timer: ReturnType<typeof setInterval> | null = null;
export function startPlatformAppVersionRefresh(options?: {
  endpointOrigin?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
}): void {
  if (timer) return;
  const intervalMs = options?.intervalMs ?? PLATFORM_APP_VERSION_TTL_MS;
  void refreshPlatformAppVersion({ ...options, force: true });
  timer = setInterval(() => {
    void refreshPlatformAppVersion({ ...options, force: true });
  }, intervalMs);
  timer.unref?.();
}

/** 测试/停机用：清掉定时器与缓存。 */
export function stopPlatformAppVersionRefresh(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * 官方 ZCode 平台版本（兼容旧名）。取缓存值；尚未刷到时是内置基线。
 * @deprecated 新代码用 {@link getPlatformAppVersion} 表达语义，值相同。
 */
export const ZCODE_PLATFORM_APP_VERSION = PLATFORM_APP_VERSION_BASELINE;
