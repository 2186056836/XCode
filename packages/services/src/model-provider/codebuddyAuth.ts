import { createServiceLogger } from "../logger/serviceLogger.js";
import { providerFetch, codeBuddyProviderId } from "../providers/api/providerNetwork.js";

/**
 * XCode fork：CodeBuddy 登录认证 + 多账号管理（CN/Intl 双区），协议对齐 9router
 * open-sse 的 codebuddy-cn / codebuddy-intl 实现：
 *   1. POST {stateUrl}?platform=... → { code:0, data:{ state, authUrl } }
 *   2. 用户在系统浏览器打开 authUrl 完成账号授权
 *   3. GET  {tokenUrl}?state=... 轮询：code 0 = 成功，code 11217 = 待授权
 *   4. 刷新：POST {refreshUrl}，头带 X-Refresh-Token
 *
 * 区别仅在端点域与身份头：CN=copilot.tencent.com/platform=CLI/X-IDE-Type CLI，
 * Intl=www.codebuddy.ai/platform=ide/X-IDE-Type IDE。聊天网关同为 OpenAI 兼容
 * /v2/chat/completions + reasoning_effort。
 *
 * 必须在 host（Node）侧执行：上游要求自定义 User-Agent，浏览器无法设置该头。
 * 多账号：登录成功即 upsert 进对应区域的账号列表并激活（id = 登录会话 state），
 * 列表经 accountStore 持久化（credentialService 按 region 分 key），重启后恢复。
 */

export type CodeBuddyRegion = "cn" | "intl";

interface CodeBuddyRegionConfig {
  readonly stateUrl: string;
  readonly tokenUrl: string;
  readonly refreshUrl: string;
  readonly domain: string;
  readonly userAgent: string;
  readonly platform: string;
  readonly ideType: string;
  readonly storeKey: string;
}

const REGION_CONFIGS: Record<CodeBuddyRegion, CodeBuddyRegionConfig> = {
  cn: {
    stateUrl: "https://copilot.tencent.com/v2/plugin/auth/state",
    tokenUrl: "https://copilot.tencent.com/v2/plugin/auth/token",
    refreshUrl: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
    domain: "copilot.tencent.com",
    userAgent: "CLI/2.108.1 CodeBuddy/2.108.1",
    platform: "CLI",
    ideType: "CLI",
    storeKey: "codebuddy:accounts:cn",
  },
  intl: {
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    domain: "www.codebuddy.ai",
    userAgent: "IDE/2.108.1 CodeBuddy/2.108.1",
    platform: "ide",
    ideType: "IDE",
    storeKey: "codebuddy:accounts:intl",
  },
};

function regionConfig(region: CodeBuddyRegion): CodeBuddyRegionConfig {
  return REGION_CONFIGS[region] ?? REGION_CONFIGS.cn;
}

// 浏览器 bundle 会拖入本模块（UI 引用服务类型时）；createServiceLogger 依赖
// Node 的 process，必须懒创建，不能在模块顶层执行。
function logger() {
  return createServiceLogger("codebuddy-auth");
}

const FETCH_TIMEOUT_MS = 15_000;

function baseHeaders(config: CodeBuddyRegionConfig): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": config.userAgent,
    "X-Requested-With": "XMLHttpRequest",
    "X-Domain": config.domain,
    "X-Product": "SaaS",
  };
}

export interface CodeBuddyLoginSession {
  readonly state: string;
  readonly authUrl: string;
}

export interface CodeBuddyPollPending {
  readonly status: "pending";
}

export interface CodeBuddyPollSuccess {
  readonly status: "ok";
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

export interface CodeBuddyPollFailed {
  readonly status: "failed";
  readonly message: string;
}

export type CodeBuddyPollResult = CodeBuddyPollPending | CodeBuddyPollSuccess | CodeBuddyPollFailed;

/** 出口由调用方按供应商解析（配了代理池走池，绕开全局代理）；默认保留裸 fetch。 */
async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CodeBuddy auth HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`CodeBuddy auth returned non-JSON response`);
  }
}

/** 发起登录：获取 state + authUrl（浏览器打开）。 */
export async function beginCodeBuddyLogin(region: CodeBuddyRegion): Promise<CodeBuddyLoginSession> {
  const config = regionConfig(region);
  const url = `${config.stateUrl}?platform=${config.platform}`;
  // 此刻账号尚未落库，无 accountId；按供应商策略选池条目。
  const envelope = await fetchJson(
    url,
    {
      method: "POST",
      headers: {
        ...baseHeaders(config),
        "Content-Type": "application/json",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
      },
      body: "{}",
    },
    providerFetch(codeBuddyProviderId(region)),
  );
  const data = envelope.data as { state?: string; authUrl?: string } | undefined;
  if (envelope.code !== 0 || !data?.state || !data?.authUrl) {
    throw new Error(`CodeBuddy state error: ${String(envelope.msg ?? "missing state/authUrl")}`);
  }
  return { state: data.state, authUrl: data.authUrl };
}

/** 轮询一次授权结果（pending / 成功 / 失败）。 */
export async function pollCodeBuddyLogin(
  region: CodeBuddyRegion,
  state: string,
): Promise<CodeBuddyPollResult> {
  const config = regionConfig(region);
  const url = `${config.tokenUrl}?state=${encodeURIComponent(state)}`;
  try {
    const envelope = await fetchJson(
      url,
      {
        method: "GET",
        headers: {
          ...baseHeaders(config),
          "X-No-Authorization": "true",
          "X-No-User-Id": "true",
          "X-No-Enterprise-Id": "true",
          "X-No-Department-Info": "true",
        },
      },
      providerFetch(codeBuddyProviderId(region)),
    );
    if (envelope.code === 11217) return { status: "pending" };
    const data = envelope.data as
      | { accessToken?: string; refreshToken?: string; expiresIn?: number }
      | undefined;
    if (envelope.code === 0 && data?.accessToken) {
      const expiresIn =
        typeof data.expiresIn === "number" && data.expiresIn > 0 ? data.expiresIn : 86_400;
      logger().info(undefined, "CodeBuddy login success", { region, expiresIn });
      return {
        status: "ok",
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? "",
        expiresAt: Date.now() + expiresIn * 1000,
      };
    }
    return { status: "failed", message: String(envelope.msg ?? "unknown error") };
  } catch (error) {
    // 轮询单次网络失败视为 pending，交给上层继续轮询直至超时。
    logger().warn(undefined, "CodeBuddy poll attempt failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { status: "pending" };
  }
}

// ---------------------------------------------------------------------------
// 令牌身份解析（Keycloak JWT；非 JWT 令牌返回 null）
// ---------------------------------------------------------------------------

export interface CodeBuddyTokenIdentity {
  /** Keycloak sub，跨重登录稳定。 */
  readonly sub: string;
  readonly displayName: string;
  readonly email: string;
  /** 企业席位标识（CN 侧令牌带 enterprise_id；个人账号是空串）。 */
  readonly enterpriseId: string;
  /** 租户标识；令牌没有独立 tenant 声明时与 enterpriseId 同值。 */
  readonly tenantId: string;
}

/** 从访问令牌解出账号身份：name > preferred_username > email 作为显示名。 */
export function describeCodeBuddyAccessToken(
  accessToken: string,
): CodeBuddyTokenIdentity | null {
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadB64 = parts[1];
    if (!payloadB64) return null;
    // 同构 base64url 解码（atob + TextDecoder），渲染端 bundle 也能安全引入本模块。
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) return null;
    const pick = (key: string): string => {
      const value = payload[key];
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "";
    };
    const displayName = pick("name") || pick("preferred_username") || pick("email");
    const enterpriseId = pick("enterprise_id") || pick("enterpriseId");
    return {
      sub,
      displayName,
      email: pick("email"),
      enterpriseId,
      tenantId: pick("tenant_id") || pick("tenantId") || enterpriseId,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 多账号存储（按 region 隔离）
// ---------------------------------------------------------------------------

export interface CodeBuddyAccount {
  /** 登录会话 state，作为账号稳定 id。 */
  readonly id: string;
  displayName: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface CodeBuddyAccountView extends CodeBuddyAccount {
  readonly active: boolean;
}

interface CodeBuddyAccountStoreData {
  accounts: CodeBuddyAccount[];
  activeId: string | null;
}

export interface CodeBuddyAccountStore {
  load(key: string): Promise<string | null>;
  save(key: string, json: string): Promise<void>;
}

let accountStore: CodeBuddyAccountStore | null = null;
const loadedRegions = new Set<CodeBuddyRegion>();
const regionStates = new Map<CodeBuddyRegion, CodeBuddyAccountStoreData>();

/** node.ts 组装时注入持久化（credentialService，key 按 region 分）。 */
export function setCodeBuddyAccountStore(store: CodeBuddyAccountStore): void {
  accountStore = store;
}

async function ensureAccountsLoaded(region: CodeBuddyRegion): Promise<void> {
  if (loadedRegions.has(region) || !accountStore) return;
  loadedRegions.add(region);
  const config = regionConfig(region);
  try {
    const raw = await accountStore.load(config.storeKey);
    if (!raw) {
      regionStates.set(region, { accounts: [], activeId: null });
      return;
    }
    const parsed = JSON.parse(raw) as CodeBuddyAccountStoreData;
    if (Array.isArray(parsed.accounts)) {
      regionStates.set(region, {
        accounts: parsed.accounts,
        activeId: parsed.activeId ?? parsed.accounts[0]?.id ?? null,
      });
    }
  } catch (error) {
    logger().warn(undefined, "CodeBuddy account store load failed", {
      region,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function persistAccounts(region: CodeBuddyRegion): Promise<void> {
  if (!accountStore) return;
  const state = regionStates.get(region);
  if (!state) return;
  try {
    await accountStore.save(regionConfig(region).storeKey, JSON.stringify(state));
  } catch (error) {
    logger().warn(undefined, "CodeBuddy account store save failed", {
      region,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function getActiveAccount(region: CodeBuddyRegion): CodeBuddyAccount | null {
  const state = regionStates.get(region);
  return state?.accounts.find((account) => account.id === state.activeId) ?? null;
}

const accountCounters = new Map<CodeBuddyRegion, number>();

export async function upsertCodeBuddyAccount(
  region: CodeBuddyRegion,
  account: Omit<CodeBuddyAccount, "displayName"> & { displayName?: string; email?: string },
): Promise<CodeBuddyAccountView> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region) ?? { accounts: [], activeId: null };
  regionStates.set(region, state);
  const existingIndex = state.accounts.findIndex((item) => item.id === account.id);
  const displayName =
    account.displayName?.trim() ||
    (existingIndex >= 0 ? state.accounts[existingIndex]?.displayName : undefined) ||
    `CodeBuddy 账号 ${(accountCounters.get(region) ?? 0) + 1}`;
  accountCounters.set(region, (accountCounters.get(region) ?? 0) + 1);
  const full: CodeBuddyAccount = { ...account, displayName };
  if (existingIndex >= 0) state.accounts[existingIndex] = full;
  else state.accounts.push(full);
  state.activeId = full.id;
  await persistAccounts(region);
  return { ...full, active: true };
}

export async function listCodeBuddyAccounts(region: CodeBuddyRegion): Promise<{
  accounts: CodeBuddyAccountView[];
  activeAccessToken: string | null;
}> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region) ?? { accounts: [], activeId: null };
  // 旧数据补身份：令牌可解 JWT 的账号回填显示名/邮箱（幂等，已有值不覆盖）。
  let enriched = false;
  for (const account of state.accounts) {
    if (account.email) continue;
    const identity = describeCodeBuddyAccessToken(account.accessToken);
    if (!identity) continue;
    account.email = identity.email || undefined;
    if (/^CodeBuddy( CN)?( 账号|)$/.test(account.displayName) && identity.displayName) {
      account.displayName = identity.displayName;
    }
    enriched = true;
  }
  if (enriched) await persistAccounts(region);
  return {
    accounts: state.accounts.map((account) => ({
      ...account,
      active: account.id === state.activeId,
    })),
    activeAccessToken:
      state.accounts.find((account) => account.id === state.activeId)?.accessToken ?? null,
  };
}

export async function switchCodeBuddyAccount(
  region: CodeBuddyRegion,
  id: string,
): Promise<CodeBuddyAccountView | null> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region);
  const account = state?.accounts.find((item) => item.id === id);
  if (!state || !account) return null;
  state.activeId = id;
  await persistAccounts(region);
  return { ...account, active: true };
}

/** 删除账号；若删除的是激活账号，自动激活剩余第一个并返回其令牌（供 overlay 回写）。 */
export async function removeCodeBuddyAccount(
  region: CodeBuddyRegion,
  id: string,
): Promise<{ accounts: CodeBuddyAccountView[]; activeAccessToken: string | null }> {
  await ensureAccountsLoaded(region);
  const state = regionStates.get(region);
  if (state) {
    state.accounts = state.accounts.filter((account) => account.id !== id);
    if (state.activeId === id) {
      state.activeId = state.accounts[0]?.id ?? null;
    }
    await persistAccounts(region);
  }
  return listCodeBuddyAccounts(region);
}

// ---------------------------------------------------------------------------
// 刷新
// ---------------------------------------------------------------------------

export interface CodeBuddyRefreshResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

/** 用 refreshToken 换新 accessToken；失败返回 null（需要重新登录）。 */
export async function refreshCodeBuddyToken(
  region: CodeBuddyRegion,
  refreshToken: string,
): Promise<CodeBuddyRefreshResult | null> {
  const config = regionConfig(region);
  try {
    const envelope = await fetchJson(config.refreshUrl, {
      method: "POST",
      headers: {
        ...baseHeaders(config),
        "Content-Type": "application/json",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
      },
      body: "{}",
    });
    const data = envelope.data as
      | { accessToken?: string; refreshToken?: string; expiresIn?: number }
      | undefined;
    if (envelope.code !== 0 || !data?.accessToken) {
      logger().warn(undefined, "CodeBuddy token refresh returned no token", {
        region,
        code: envelope.code,
        msg: envelope.msg,
      });
      return null;
    }
    const expiresIn =
      typeof data.expiresIn === "number" && data.expiresIn > 0 ? data.expiresIn : 86_400;
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  } catch (error) {
    logger().warn(undefined, "CodeBuddy token refresh failed", {
      region,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 刷新对应区域当前激活账号的令牌并更新列表；无账号/失败返回 null。 */
export async function refreshCodeBuddyStored(
  region: CodeBuddyRegion,
): Promise<CodeBuddyRefreshResult | null> {
  await ensureAccountsLoaded(region);
  const active = getActiveAccount(region);
  const refreshToken = active?.refreshToken;
  if (!refreshToken) return null;
  const result = await refreshCodeBuddyToken(region, refreshToken);
  if (!result) return null;
  if (active) {
    active.accessToken = result.accessToken;
    active.refreshToken = result.refreshToken;
    active.expiresAt = result.expiresAt;
    await persistAccounts(region);
  }
  return result;
}
