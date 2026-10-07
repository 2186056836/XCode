import { createServiceLogger } from "../logger/serviceLogger.js";

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

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
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
  const envelope = await fetchJson(url, {
    method: "POST",
    headers: {
      ...baseHeaders(config),
      "Content-Type": "application/json",
      "X-No-Authorization": "true",
      "X-No-User-Id": "true",
    },
    body: "{}",
  });
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
    const envelope = await fetchJson(url, {
      method: "GET",
      headers: {
        ...baseHeaders(config),
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-No-Enterprise-Id": "true",
        "X-No-Department-Info": "true",
      },
    });
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
// 多账号存储（按 region 隔离）
// ---------------------------------------------------------------------------

export interface CodeBuddyAccount {
  /** 登录会话 state，作为账号稳定 id。 */
  readonly id: string;
  displayName: string;
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
  account: Omit<CodeBuddyAccount, "displayName"> & { displayName?: string },
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
