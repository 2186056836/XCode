/* oxlint-disable max-lines -- 登录轮询/多账号/会话恢复状态机集中维护，拆分会割裂登录事务。 */
import { createUuid } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { providerFetch, qoderProviderId } from "../providers/api/providerNetwork.js";

/**
 * XCode fork：Qoder 登录认证（自定义设备流）+ 多账号管理，协议对齐 9router
 * 的 qoder OAuth 实现：
 *   1. 本地生成 PKCE（S256）+ nonce + machine_id
 *   2. 用户在系统浏览器打开 {login}/device/selectAccounts?challenge=...&nonce=...&machine_id=...
 *   3. 轮询 GET {openApi}/api/v1/deviceToken/poll?nonce=...&verifier=...&challenge_method=S256
 *      （202/404 = 待授权；200 + token = 成功，令牌 `dt-...`，约 30 天）
 *   4. best-effort 拉 /api/v1/userinfo 补显示名/邮箱
 * 刷新端点对本流程返回 403（无效），令牌过期直接重登。
 *
 * 必须在 host（Node）侧执行（自定义 UA + 浏览器不允许的请求头）。
 * 注意：本模块会被 UI 拖进 renderer bundle（remoteServiceAccess → providerFacadeServices
 * → 这里），因此必须同构：不能用 node:crypto / Buffer，随机数走 WebCrypto，
 * SHA-256 走 globalThis.crypto.subtle（异步，故 beginQoderLogin 为 async）。
 * 多账号：登录成功即 upsert 进对应区域账号列表并激活，经 accountStore 持久化。
 */


export type QoderAuthRegion = "cn" | "intl";

interface QoderAuthEndpoints {
  deviceTokenUrl: string;
  userInfoUrl: string;
  loginUrl: string;
  /**
   * PRO **激活**端点（触发型，需 COSY 设备指纹复核）。
   * 它同时是查询接口，但频繁调用可能把已 PRO 的账号打回原等级，所以只用于
   * 激活路径且每次登录会话至多调一次。
   */
  userStatusUrl: string;
  /**
   * PRO **安全查询**端点（只 Bearer，无 COSY 头）。与 quotaUsageUrl / userInfoUrl
   * 综合判定 PRO 状态，不会触发等级变更——查询一律走这里。
   */
  userPlanUrl: string;
  quotaUsageUrl: string;
  /** 领 38max 活动试用额度（与 PRO 无关，非授予端点）。 */
  activityClaimUrl: string;
}

const REGION_ENDPOINTS: Record<QoderAuthRegion, QoderAuthEndpoints> = {
  cn: {
    deviceTokenUrl: "https://openapi.qoder.com.cn/api/v1/deviceToken/poll",
    userInfoUrl: "https://openapi.qoder.com.cn/api/v1/userinfo",
    loginUrl: "https://qoder.com.cn/device/selectAccounts",
    userStatusUrl: "https://openapi.qoder.com.cn/api/v3/user/status",
    userPlanUrl: "https://openapi.qoder.com.cn/api/v2/user/plan",
    quotaUsageUrl: "https://openapi.qoder.com.cn/api/v2/quota/usage",
    activityClaimUrl: "https://openapi.qoder.com.cn/api/v2/activity/claim",
  },
  intl: {
    // 国际版 openapi 主机是 .sh，不是 .com——.com 在网络上根本不可达
    // （连接直接失败），而 .sh 是 9router 实机跑生产的地址。
    deviceTokenUrl: "https://openapi.qoder.sh/api/v1/deviceToken/poll",
    userInfoUrl: "https://openapi.qoder.sh/api/v1/userinfo",
    loginUrl: "https://qoder.com/device/selectAccounts",
    userStatusUrl: "https://openapi.qoder.sh/api/v3/user/status",
    userPlanUrl: "https://openapi.qoder.sh/api/v2/user/plan",
    quotaUsageUrl: "https://openapi.qoder.sh/api/v2/quota/usage",
    activityClaimUrl: "https://openapi.qoder.sh/api/v2/activity/claim",
  },
};

const FETCH_TIMEOUT_MS = 15_000;

// 与推理侧（qoderProtocol.ts）保持一致的客户端指纹，取自 IDE 实机抓包。
// PRO 激活的 ping/claim 会校验 cosy-version 与 clienttype，值不一致会被拒。
const QODER_IDE_VERSION = "1.32.2";
const QODER_CLIENT_TYPE = "0";
const QODER_MACHINE_OS = "x86_64_windows";
const QODER_MACHINE_TYPE = "945d1ba41479d5d140";

// 懒创建（与 codebuddyAuth 同理由：UI 会拖入本模块，顶层执行会崩）。
function logger() {
  return createServiceLogger("qoder-auth");
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64FromBytes(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index]!;
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return base64FromBytes(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const source = new Uint8Array(data.length);
  source.set(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source.buffer);
  return new Uint8Array(digest);
}

/**
 * XCode fork：出口由调用方按供应商/账号解析（配置了代理池的供应商走池，绕开全局代理）。
 * 默认值保留裸 fetch，供未装配 providerFetch 的场景（renderer / 单测）与设备指纹等
 * 非供应商端点使用。
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface QoderLoginSession {
  /** 轮询用 nonce（device_code 语义）。 */
  readonly nonce: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly codeVerifier: string;
  readonly machineId: string;
  /**
   * 官方 machine-info 三件套，在**发起轮询前**从 mi-token 接口取，与本账号
   * 一号一绑。machineId 决定 Cosy 签名与设备指纹，整个会话到后续请求恒定不变。
   */
  readonly machineToken?: string;
  readonly machineType?: string;
  readonly machineCode?: string;
  readonly expiresAt: number;
}

/**
 * 发起设备流：生成 PKCE/nonce/machineId 并拼出浏览器授权 URL。
 *
 * 设备标识三件套（machineToken / machineType / machineCode）在这里就取好——
 * 一个登录会话对应一套设备身份，从轮询开始到后续所有请求不再变，一号一绑。
 * 取不到不阻断登录（浏览器授权本身不校验），但会以字段缺失暴露给调用方，
 * 由其在写入 overlay 前补齐，避免签名层退化成逐请求随机设备。
 */
export async function beginQoderLogin(region: QoderAuthRegion): Promise<QoderLoginSession> {
  const verifier = base64UrlFromBytes(randomBytes(32));
  const challenge = base64UrlFromBytes(await sha256Bytes(new TextEncoder().encode(verifier)));
  const nonce = createUuid();
  const machineId = createUuid();
  const endpoints = REGION_ENDPOINTS[region];
  const params = new URLSearchParams({
    challenge,
    challenge_method: "S256",
    machine_id: machineId,
    nonce,
  });
  // 三件套在本会话开始前取一次，与该账号一号一绑。
  const machine = await fetchMachineIdentity(region).catch(() => null);
  if (!machine) {
    logger().warn(undefined, "Qoder 登录会话未能预取设备标识三件套", { region });
  }

  return {
    nonce,
    userCode: nonce.slice(0, 8).toUpperCase(),
    verificationUri: `${endpoints.loginUrl}?${params.toString()}`,
    codeVerifier: verifier,
    machineId,
    ...(machine
      ? {
          machineToken: machine.machineToken,
          machineType: machine.machineType,
          machineCode: machine.machineCode,
        }
      : {}),
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}

export interface QoderPollPending {
  readonly status: "pending";
}

export interface QoderPollSuccess {
  readonly status: "ok";
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly expiresAt: number;
}

export interface QoderPollFailed {
  readonly status: "failed";
  readonly message: string;
}

export type QoderPollResult = QoderPollPending | QoderPollSuccess | QoderPollFailed;

function parseExpiry(rawExpiresAt: unknown, rawExpiresIn: unknown): number {
  if (typeof rawExpiresAt === "number" && rawExpiresAt > Date.now()) return rawExpiresAt;
  if (typeof rawExpiresAt === "string") {
    const parsed = Number(rawExpiresAt);
    if (Number.isFinite(parsed) && parsed > Date.now()) return parsed;
  }
  if (typeof rawExpiresIn === "number" && rawExpiresIn > 0) {
    return Date.now() + rawExpiresIn * 1000;
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1000;
}

/** 连续网络失败多少次后如实报错（给瞬时抖动留一点余量）。 */
const MAX_NETWORK_FAILURES = 3;
let consecutiveNetworkFailures = 0;

/** 轮询一次授权结果。 */
export async function pollQoderLogin(
  region: QoderAuthRegion,
  nonce: string,
  codeVerifier: string,
): Promise<QoderPollResult> {
  if (!nonce || !codeVerifier) {
    return { status: "failed", message: "missing nonce/verifier" };
  }
  const endpoints = REGION_ENDPOINTS[region];
  const url = `${endpoints.deviceTokenUrl}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": "Go-http-client/2.0" },
      },
      // 此刻账号还没落库，没有 accountId 可用；按供应商策略选池条目。
      providerFetch(qoderProviderId(region)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 连续网络失败要如实上报，不能伪装成 pending —— 否则用户看到的是
    // "一直在转圈"，完全不知道是网络不通还是授权没完成。
    // 前几次给一次重试机会（授权瞬间可能有一次瞬时抖动）。
    consecutiveNetworkFailures += 1;
    logger().warn(undefined, "Qoder poll attempt failed", {
      consecutiveNetworkFailures,
      message,
    });
    if (consecutiveNetworkFailures >= MAX_NETWORK_FAILURES) {
      return {
        status: "failed",
        message: `无法连接 Qoder 授权服务（已重试 ${MAX_NETWORK_FAILURES} 次）：${message}`,
      };
    }
    return { status: "pending" };
  }
  consecutiveNetworkFailures = 0;
  // 202/404 = 已注册但用户未完成浏览器授权，继续轮询。
  if (response.status === 202 || response.status === 404) return { status: "pending" };

  const text = await response.text();
  if (!response.ok) {
    let message = `Qoder device token poll failed: HTTP ${response.status}`;
    try {
      const body = JSON.parse(text) as { message?: string };
      if (body.message) message = `Qoder device token poll failed: ${body.message}`;
    } catch {}
    return { status: "failed", message };
  }
  let body: { token?: string; refresh_token?: string; user_id?: string; expires_at?: unknown; expires_in?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return { status: "failed", message: "Qoder device token poll returned invalid JSON" };
  }
  if (!body.token) {
    return { status: "failed", message: "Qoder device token poll returned 200 but no token" };
  }

  let displayName = "";
  let email = "";
  let resolvedUserId = (body.user_id ?? "").trim();
  // best-effort 用户信息（失败不阻断登录），同时兜底 userId：
  // 执行链的 COSY 签名必须有 userId，上游偶尔不在 token 响应里给。
  try {
    const infoResponse = await fetchWithTimeout(
      endpoints.userInfoUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${body.token}`,
          "User-Agent": "Go-http-client/2.0",
        },
      },
      // 同上：账号尚未入库，走供应商策略。若上游已给 user_id，也能命中账号级绑定。
      providerFetch(qoderProviderId(region), resolvedUserId || undefined),
    );
    if (infoResponse.ok) {
      const info = (await infoResponse.json()) as {
        name?: string;
        nickname?: string;
        username?: string;
        email?: string;
        id?: string;
        user_id?: string;
      };
      displayName = (info.name ?? info.nickname ?? info.username ?? "").trim();
      email = (info.email ?? "").trim();
      resolvedUserId = (body.user_id ?? info.user_id ?? info.id ?? "").trim();
    }
  } catch {
    // userinfo 失败不阻断。
  }

  // 拿到 token 却拿不到 userId：账号能存下但执行链永远过不了 COSY 签名
  //（model-execution 要求 userId 非空）。这是不可用的登录态，如实报错，
  // 不要让用户以为登录成功了却在聊天时才失败。
  if (!resolvedUserId) {
    return {
      status: "failed",
      message: "Qoder 登录成功但未返回 userId，无法用于请求签名；请重新登录或改用访问令牌方式",
    };
  }

  return {
    status: "ok",
    accessToken: body.token,
    refreshToken: body.refresh_token ?? "",
    userId: resolvedUserId,
    displayName,
    email,
    expiresAt: parseExpiry(body.expires_at, body.expires_in),
  };
}

// ---------------------------------------------------------------------------
// 多账号存储（按 region 隔离，key: qoder:accounts:{cn|intl}）
// ---------------------------------------------------------------------------

export interface QoderAccount {
  /** 稳定 id：userId 或 nonce。 */
  readonly id: string;
  displayName: string;
  email?: string;
  /** 本地生成的 uuid，随 Cosy-Machineid 上行；设备指纹由它确定性派生。 */
  machineId?: string;
  /**
   * 官方 machine-info 铸造的真实令牌（P1gA...）。激活 PRO 时 claim 接口会校验其
   * 真实性，伪造值会被判 "User is not eligible"，因此只能由外部注入、不能自造。
   */
  machineToken?: string;
  /** machine-info 产出的机器类型，参与 claim 的设备校验。 */
  machineType?: string;
  /** machine-info 同时产出的机器码，参与 claim 的设备校验。 */
  machineCode?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface QoderAccountView extends QoderAccount {
  readonly active: boolean;
}

interface QoderAccountStoreData {
  accounts: QoderAccount[];
  activeId: string | null;
}

export interface QoderAccountStore {
  load(key: string): Promise<string | null>;
  save(key: string, json: string): Promise<void>;
}

let accountStore: QoderAccountStore | null = null;
const loadedRegions = new Set<QoderAuthRegion>();
const regionStates = new Map<QoderAuthRegion, QoderAccountStoreData>();

/** node.ts 组装时注入持久化（credentialService，key 按 region 分）。 */
export function setQoderAccountStore(store: QoderAccountStore): void {
  accountStore = store;
}

function storeKey(region: QoderAuthRegion): string {
  return `qoder:accounts:${region}`;
}

async function ensureAccountsLoaded(region: QoderAuthRegion): Promise<void> {
  if (loadedRegions.has(region) || !accountStore) return;
  loadedRegions.add(region);
  try {
    const raw = await accountStore.load(storeKey(region));
    if (!raw) {
      regionStates.set(region, { accounts: [], activeId: null });
      return;
    }
    const parsed = JSON.parse(raw) as QoderAccountStoreData;
    if (Array.isArray(parsed.accounts)) {
      regionStates.set(region, {
        accounts: parsed.accounts,
        activeId: parsed.activeId ?? parsed.accounts[0]?.id ?? null,
      });
    }
  } catch (error) {
    logger().warn(undefined, "Qoder account store load failed", {
      region,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function persistAccounts(region: QoderAuthRegion): Promise<void> {
  if (!accountStore) return;
  const state = regionStates.get(region);
  if (!state) return;
  try {
    await accountStore.save(storeKey(region), JSON.stringify(state));
  } catch (error) {
    logger().warn(undefined, "Qoder account store save failed", {
      region,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function upsertQoderAccount(
  region: QoderAuthRegion,
  account: QoderAccount,
): Promise<QoderAccountView> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region) ?? { accounts: [], activeId: null };
  regionStates.set(region, state);
  const existingIndex = state.accounts.findIndex((item) => item.id === account.id);
  if (existingIndex >= 0) state.accounts[existingIndex] = account;
  else state.accounts.push(account);
  // 新登录**不自动顶掉**当前激活账号：用哪个账号由用户手动切换决定。仅当
  // 尚无激活账号（首次登录或账号全部被删）时才让新账号成为当前使用。
  if (!state.activeId || !state.accounts.some((item) => item.id === state.activeId)) {
    state.activeId = account.id;
  }
  await persistAccounts(region);
  return { ...account, active: account.id === state.activeId };
}

export async function listQoderAccounts(region: QoderAuthRegion): Promise<{
  accounts: QoderAccountView[];
  activeAccessToken: string | null;
  activeUserId: string | null;
  activeMachineId: string | null;
}> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region) ?? { accounts: [], activeId: null };
  const active = state.accounts.find((account) => account.id === state.activeId) ?? null;
  return {
    accounts: state.accounts.map((account) => ({
      ...account,
      active: account.id === state.activeId,
    })),
    activeAccessToken: active?.accessToken ?? null,
    activeUserId: active?.id ?? null,
    activeMachineId: active?.machineId ?? null,
  };
}

export async function switchQoderAccount(
  region: QoderAuthRegion,
  id: string,
): Promise<QoderAccountView | null> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region);
  const account = state?.accounts.find((item) => item.id === id);
  if (!state || !account) return null;
  state.activeId = id;
  await persistAccounts(region);
  return { ...account, active: true };
}

export async function removeQoderAccount(
  region: QoderAuthRegion,
  id: string,
): Promise<{ accounts: QoderAccountView[]; activeAccessToken: string | null }> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region);
  if (state) {
    state.accounts = state.accounts.filter((account) => account.id !== id);
    if (state.activeId === id) state.activeId = state.accounts[0]?.id ?? null;
    await persistAccounts(region);
  }
  return listQoderAccounts(region);
}

// ---------------------------------------------------------------------------
// PRO 激活（领取 38max 800 点活动试用点）
// ---------------------------------------------------------------------------

const ACTIVATION_CENTER_BASE: Record<QoderAuthRegion, string> = {
  cn: "https://center.qoder.com.cn",
  intl: "https://center.qoder.sh",
};

/** claim/status 端点校验的官方 IDE UA（国际版）。 */
const PRO_ELECTRON_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Qoder/0.14.1 Chrome/138.0.7204.251 " +
  "Electron/37.7.0 Safari/537.36";

/** CN 官方 IDE UA（抓包 2026-10-11：openapi user/status 实发值）。 */
const PRO_ELECTRON_UA_CN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) QoderCNIDE/1.32.2 Chrome/148.0.7778.97 " +
  "Electron/42.2.0 Safari/537.36";

function proElectronUa(region: QoderAuthRegion): string {
  return region === "cn" ? PRO_ELECTRON_UA_CN : PRO_ELECTRON_UA;
}

/**
 * mi-token 接口：machineToken 的下发方。Qoder 的 claim 接口会校验该令牌的
 * 真实性（官方 machine-info 铸造的 `P1gA...`），随机值一律返回
 * "User is not eligible"，因此本地不能自造，只能从接口取。
 * 未配置时激活不可用——UI 会提示，而不是发一个注定被拒的请求。
 *
 * 必须惰性读取：顶层读 process.env 会在 renderer（无 process）直接抛错，
 * 而本模块会被 UI 拖进 bundle。
 */
function readEnv(name: string): string {
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return (runtimeProcess?.env?.[name] ?? "").trim();
}

/**
 * mi-token 接口地址（按优先级）。登录取设备指纹与激活 PRO 都走它。
 * 主 qdmt，备 tele，主不通自动切备。可用 QODER_MI_TOKEN_URL 覆盖（多个用逗号分隔）。
 * 匿名调用每次只能取 1 个（count>1 返回 403），带 X-Api-Key 才能批量。
 */
const MI_TOKEN_DEFAULT_URLS = [
  "https://qdmt.869869869.xyz/generate",
  "https://tele.869869869.xyz/generate",
] as const;

function miTokenConfig(): {
  urls: readonly string[];
  apiKey: string;
  timeoutMs: number;
} {
  const rawTimeout = Number(readEnv("QODER_MI_TOKEN_TIMEOUT_MS"));
  const override = readEnv("QODER_MI_TOKEN_URL");
  return {
    urls: override
      ? override.split(",").map((item) => item.trim()).filter(Boolean)
      : MI_TOKEN_DEFAULT_URLS,
    apiKey: readEnv("QODER_MI_TOKEN_API_KEY") || readEnv("QODER_MI_TOKEN_AUTH"),
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30_000,
  };
}

export interface QoderProActivationResult {
  ok: boolean;
  already: boolean;
  userType: string;
  claimed: boolean;
  message: string;
}

function proHeaders(input: {
  machineToken: string;
  machineType?: string;
  machineCode?: string;
  /**
   * 账号的 machineId（uuid）。ping 必须带——它建立 machineToken 与账号的绑定，
   * 绑定未建立时后续 claim 会被判"不可领取"。
   */
  machineId?: string;
}): Record<string, string> {
  return {
    accept: "application/json",
    "accept-encoding": "identity",
    "cosy-version": QODER_IDE_VERSION,
    ...(input.machineId ? { "cosy-machineid": input.machineId } : {}),
    "cosy-machinetoken": input.machineToken,
    "cosy-machinetype": input.machineType || QODER_MACHINE_TYPE,
    "cosy-machinecode": input.machineCode ?? "",
    "cosy-machineos": QODER_MACHINE_OS,
    "cosy-clienttype": QODER_CLIENT_TYPE,
    "user-agent": "Go-http-client/2.0",
  };
}

function isProfessional(userType: string): boolean {
  return userType.toLowerCase().includes("professional");
}

/**
 * 从 mi-token 接口取一套设备标识三件套。**不缓存**：该接口每次调用返回一套全新
 * 身份（实测连续三次全不同），跨登录缓存会让第二个登录的账号拿到与第一个完全
 * 相同的三件套——设备指纹一号一绑的前提是每号一份。单次请求 ~1-2s，无需复用。
 *
 * 端点契约：POST {url}，可选 `X-Api-Key`（有 key 才能批量，匿名限count=1）；
 * 响应为 `{ success, failed, tokens: [{ machineToken, machineType, machineCode }] }`。
 * 取不到返回 null，由调用方给出可读错误，而不是发一个注定被拒的 claim。
 */
/** 从单个 mi-token 端点取设备指纹；这个端点不可用时返回 null，由调用方切下一个。 */
async function fetchMachineIdentityFrom(
  url: string,
  apiKey: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  machineToken: string;
  machineType: string;
  machineCode: string;
} | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["X-Api-Key"] = apiKey;
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      logger().warn(undefined, "Qoder mi-token 接口返回非 2xx", { url, status: response.status });
      return null;
    }
    const data = (await response.json()) as {
      tokens?: Array<{ machineToken?: string; machineType?: string; machineCode?: string }>;
      machineToken?: string;
      machineType?: string;
      machineCode?: string;
    };
    // 该服务把结果裹在 tokens[] 里；同时兼容平铺格式以便换用其他服务。
    const entry = data.tokens?.[0] ?? data;
    if (!entry?.machineToken) {
      logger().warn(undefined, "Qoder mi-token 响应缺少 machineToken", { url });
      return null;
    }
    return {
      machineToken: entry.machineToken,
      machineType: entry.machineType || QODER_MACHINE_TYPE,
      machineCode: entry.machineCode ?? "",
    };
  } catch (error) {
    logger().warn(undefined, "Qoder mi-token 请求失败", {
      url,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取设备指纹三件套：按顺序试主端点，不通切备用。
 * 每个端点只试一次（无状态领取，重试同一台没意义；有效降级是换一台）。
 *
 * region 只用于解析出口（mi-token 服务本身是第三方，但仍属该供应商的登录链路，
 * 应当与该供应商的模型请求走同一个出口，否则代理池场景下会出现"登录通了、
 * 拿指纹不通"的半截故障）。
 */
async function fetchMachineIdentity(region?: QoderAuthRegion): Promise<{
  machineToken: string;
  machineType: string;
  machineCode: string;
} | null> {
  const { urls, apiKey, timeoutMs } = miTokenConfig();
  const fetchImpl = region ? providerFetch(qoderProviderId(region)) : fetch;
  for (const url of urls) {
    const identity = await fetchMachineIdentityFrom(url, apiKey, timeoutMs, fetchImpl);
    if (identity) return identity;
  }
  logger().warn(undefined, "Qoder mi-token 全部端点不可用", { urls });
  return null;
}

/**
 * **激活** PRO：GET /api/v3/user/status。
 *
 * 它既是触发端点（带上 COSY 设备指纹复核），也返回 userType。注意它同时是
 * 形态上的查询接口，但**每次都带设备复核，频繁调用可能把已 PRO 的账号打回
 * 原等级**。因此：
 *   - 只在激活路径调用，且每次激活会话至多两次（触发 + 触发后的复查）；
 *   - 单纯的"查一下这个号是不是 PRO"必须用 queryQoderProStatus()，不要用这个。
 */
async function triggerQoderPro(
  region: QoderAuthRegion,
  accessToken: string,
  machine: { machineToken: string; machineType: string; machineCode: string },
  accountId?: string,
): Promise<string> {
  try {
    const response = await fetchWithTimeout(
      REGION_ENDPOINTS[region].userStatusUrl,
      {
        method: "GET",
        headers: {
          ...proHeaders(machine),
          authorization: `Bearer ${accessToken}`,
          "user-agent": proElectronUa(region),
        },
      },
      providerFetch(qoderProviderId(region), accountId),
    );
    if (!response.ok) return "";
    const body = (await response.json()) as { userType?: string };
    return String(body.userType ?? "");
  } catch {
    return "";
  }
}

/**
 * **安全查询** PRO 状态（只带 Bearer，不触发任何等级变更）。
 *
 * 综合三个只读端点判定：
 *   - GET /api/v2/user/plan     → user_type / plan_tier_name
 *   - GET /api/v2/quota/usage    → userQuota.remaining / total、isQuotaExceeded
 *   - GET /api/v1/userinfo       → userType（profile 回显）
 *
 * 判定关键字取自 qoder_activator：professional / premium / trial / paid / pro。
 * 任一字段可失败（返回 {} 时按缺失参与判定），不因单端点失败影响结论。
 */
export async function queryQoderProStatus(
  region: QoderAuthRegion,
  accessToken: string,
  accountId?: string,
): Promise<{ isPro: boolean; userType: string; planTier: string }> {
  // 刻意不接收设备三件套：本端点只带 Bearer、不带 COSY 头，不需要也不应该触碰
  // 设备标识——那正是它不触发设备指纹复核的原因。
  //
  // 只查 /api/v2/user/plan 一个端点：它同时给 user_type 与 plan_tier_name，
  // 判"是不是 PRO"这两个字段足够。quota/usage 只讲剩余额度（不判档位），
  // userinfo.userType 是回显性质的冗余——列表刷新要的是布尔值，不需要它们。
  let plan: Record<string, unknown> = {};
  try {
    const response = await fetchWithTimeout(
      REGION_ENDPOINTS[region].userPlanUrl,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      },
      providerFetch(qoderProviderId(region), accountId),
    );
    if (response.ok) {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
        plan = body as Record<string, unknown>;
      }
    }
  } catch {
    // 查询是尽力而为：失败按"非 PRO"处理，不影响列表本身。
  }

  const userType = typeof plan.user_type === "string" ? plan.user_type : "";
  const planTier = typeof plan.plan_tier_name === "string" ? plan.plan_tier_name : "";
  const haystack = `${userType} ${planTier}`.toLowerCase();
  const isPro = ["professional", "premium", "trial", "paid", "pro"].some((key) =>
    haystack.includes(key),
  );

  return { isPro, userType, planTier };
}

/**
 * 激活指定账号的 PRO：两步，`ping` → `status`，顺序不可换。
 *
 *   1. `GET center.qoder.sh/algo/api/v1/ping` —— 用账号 machineId + machineToken
 *      建立二者的绑定。绑定未建立时随后的 status 会被判无效，因此这一步不可
 *      省略、不可换序。
 *   2. `GET /api/v3/user/status` —— 激活端点，返回授予后的 userType，PRO 是否
 *      到手只看它。
 *
 * 注意 user/status 带设备指纹复核，**只能调一次**；判断"当前是不是 PRO"请用
 * queryQoderProStatus()（只带 Bearer，不触发复核）。
 *
 * 有些账号就是拿不到 PRO（账号侧资格问题），这类情况如实返回失败，不粉饰。
 */
export async function activateQoderPro(
  region: QoderAuthRegion,
  id: string,
  options: { machineToken?: string; machineCode?: string } = {},
): Promise<QoderProActivationResult> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region);
  const account = state?.accounts.find((item) => item.id === id);
  if (!account) {
    return { ok: false, already: false, userType: "", claimed: false, message: "账号不存在或未登录" };
  }

  // machineToken / machineType / machineCode 全部取自 mi-token 接口（Qoder 校验其
  // 真实性，随机值会被判不可领取）。取不到就直接失败，不发任何后续请求。
  // 优先用该账号登录时绑定的设备三件套——PRO 激活必须与推理链路呈现**同一台
  // 设备**，否则同一账号在 ping/claim 与聊天请求上是两个身份。缺失才回退到
  // mi-token 接口补取（账号绑定的优先，不重新分配）。
  const supplied = options.machineToken?.trim() || account.machineToken?.trim() || "";
  const machine = supplied
    ? {
        machineToken: supplied,
        machineType: account.machineType || QODER_MACHINE_TYPE,
        machineCode: options.machineCode ?? account.machineCode ?? "",
      }
    : await fetchMachineIdentity(region);
  if (!machine) {
    return {
      ok: false,
      already: false,
      userType: "",
      claimed: false,
      message:
        "无法获取 machineToken：Qoder 要求官方 machine-info 生成的真实令牌（随机值会被判为不可领取）。"
        + "请检查网络，或用 QODER_MI_TOKEN_URL / QODER_MI_TOKEN_API_KEY 指定可用的 mi-token 服务",
    };
  }

  // 1. ping 绑定（不可省略、不可换序）：带上账号 machineId 与 machineToken 建立
  //    二者绑定，绑定未建立时随后的 status 会被判无效。
  if (account.machineId) {
    try {
      await fetchWithTimeout(
        `${ACTIVATION_CENTER_BASE[region]}/algo/api/v1/ping`,
        {
          method: "GET",
          headers: proHeaders({ ...machine, machineId: account.machineId }),
        },
        providerFetch(qoderProviderId(region), account.id),
      );
    } catch {
      // ping 失败不阻断：绑定可能在上一次激活时已建立。
    }
  }

  // 2. 触发 PRO：GET /api/v3/user/status（带设备指纹复核），返回授予后的 userType。
  const userType = await triggerQoderPro(region, account.accessToken, machine, account.id);
  const isPro = isProfessional(userType);
  return {
    ok: isPro,
    already: false,
    userType,
    claimed: false,
    message: isPro
      ? "PRO 激活成功"
      : `未能激活 PRO（当前 ${userType || "未知"}）。部分账号本身不具备 PRO 资格`,
  };
}
