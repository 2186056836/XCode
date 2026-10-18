import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  describeCodeBuddyAccessToken,
  listCodeBuddyAccounts,
  type CodeBuddyAccountView,
  type CodeBuddyRegion,
} from "./codebuddyAuth.js";
import { providerFetch, codeBuddyProviderId } from "../providers/api/providerNetwork.js";
import {
  mapWithConcurrency,
  QUOTA_BATCH_CONCURRENCY,
  summarizeQuotaSnapshots,
  type AccountQuotaSnapshot,
  type QuotaBatchResult,
} from "./accountQuota.js";

/**
 * XCode fork：CodeBuddy 账号额度/配额查询（个人资源包 + 企业 seat 双路径）。
 *
 * 端点依据（全部来自 codebuddy2api-main/lib/server/domain/account-status.ts
 * 的实测实现，非猜测）：
 *
 *  1. 个人账号：POST {origin}/v2/billing/meter/get-user-resource
 *     body: { PageNumber:1, PageSize:100, ProductCode:'p_tcaca', Status:[0,3],
 *             PackageEndTimeRangeBegin/End }
 *     响应 Accounts[] 聚合 CycleCapacitySize/CapacitySize、
 *     CycleCapacityRemain/CapacityRemain、CycleCapacityUsed/CapacityUsed；
 *     扁平回退键 total/total_size/quota/TotalDosage、used/total_used、
 *     remaining/total_remain。
 *
 *  2. 企业 seat（enterprise_id 可解）：POST {origin}/v2/billing/meter/
 *     get-enterprise-user-usage，404/405 时回退无 /v2 前缀路径。
 *     响应 data.data || data，取 limitNum（总量）/ credit（已用）/
 *     cycleResetTime（重置时间）；limitNum 缺失视为"无有效 tenant meter"，
 *     落回个人资源查询（与参考实现一致，不把无上限渲染成 0 额度）。
 *
 * 域名：CN=copilot.tencent.com（XCode 登录区端点同域，也是 codebuddy2api
 * 的默认 CODEBUDDY_API_ENDPOINT），Intl=www.codebuddy.ai（codebuddy2api
 * public 环境默认值，也是 XCode intl 登录区同域）。请求头照搬参考实现
 * （X-IDE-* 系列 + CLI UA），X-User-Id 取登录令牌 JWT 的 sub（XCode 账号
 * id 即该 sub）。
 *
 * 同构约束：本模块会被 UI 拖进 renderer bundle（只取类型），因此不能用
 * node:crypto / Buffer；JWT 解码走 atob + TextDecoder（与 codebuddyAuth
 * 一致），网络走全局 fetch。实际执行发生在 host（RPC）。
 */

const FETCH_TIMEOUT_MS = 15_000;

/** 官方桌面端同款 UA（参考实现实抓；/v3/config 另有 12403 UA 校验与此无关）。 */
const BILLING_UA = "CLI/2.137.1 CodeBuddy/2.137.1";
const IDE_VERSION = "2.137.1";

const REGION_ORIGIN: Record<CodeBuddyRegion, string> = {
  cn: "https://copilot.tencent.com",
  intl: "https://www.codebuddy.ai",
};

const ENTERPRISE_USAGE_PATH = "/v2/billing/meter/get-enterprise-user-usage";
const ENTERPRISE_USAGE_FALLBACK_PATH = "/billing/meter/get-enterprise-user-usage";
const USER_RESOURCE_PATH = "/v2/billing/meter/get-user-resource";

/** 个人资源查询的固定 body（参考实现原值）。 */
const USER_RESOURCE_PAGINATION = {
  PageNumber: 1,
  PageSize: 100,
  ProductCode: "p_tcaca",
  Status: [0, 3],
} as const;

/** 企业 seat 的兜底窗口：约 100 年，与参考实现的 365*101 天一致。 */
const USER_RESOURCE_WINDOW_DAYS = 365 * 101;

/** 上游 404/405 = 该 meter 端点未部署，走回退路径（参考实现的判定）。 */
function isNotFoundOrMethodMismatch(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.endsWith("returned 404") || error.message.endsWith("returned 405"))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 深度查找第一个命中的键值（参考实现 findValue：先本层后递归）。 */
function findValue(value: unknown, keys: readonly string[]): unknown {
  const record = asRecord(value);
  if (record) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    for (const nested of Object.values(record)) {
      const found = findValue(nested, keys);
      if (found !== undefined && found !== null) return found;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, keys);
      if (found !== undefined && found !== null) return found;
    }
  }
  return undefined;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toResetAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

// 懒创建（与 codebuddyAuth 同理由：UI 会拖入本模块，顶层执行会崩）。
function logger() {
  return createServiceLogger("codebuddy-quota");
}

/** 同构 base64url 解码 JWT payload（与 codebuddyAuth 同一手法）。 */
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payloadB64 = parts[1];
  if (!payloadB64) return null;
  try {
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return asRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * 企业/租户标识：优先登录令牌 JWT 里的声明（键名与参考实现从凭证数据里读的
 * enterprise_id/enterpriseId、tenant_id/tenantId 一致）。XCode 的账号存储
 * 不持久化这些字段（codebuddyAuth 只存令牌三件套），因此这里从令牌现场解析；
 * 解析不到即按个人账号走资源包查询——与参考实现"无 enterprise_id 走个人路径"
 * 的行为一致。
 */
function resolveEnterpriseContext(accessToken: string): {
  enterpriseId: string;
  tenantId: string;
} {
  const claims = decodeJwtClaims(accessToken);
  const read = (...keys: string[]): string => {
    for (const key of keys) {
      const value = claims?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
  };
  const enterpriseId = read("enterprise_id", "enterpriseId");
  const tenantId = read("tenant_id", "tenantId") || enterpriseId;
  return { enterpriseId, tenantId };
}

/** 参考实现 fetchJson：统一带上 IDE 身份头，非 2xx 抛 `<path> returned <status>`。 */
async function fetchBillingJson(
  region: CodeBuddyRegion,
  accessToken: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const origin = REGION_ORIGIN[region];
  const { enterpriseId, tenantId } = resolveEnterpriseContext(accessToken);
  const userId = describeCodeBuddyAccessToken(accessToken)?.sub ?? "";
  // 出口按供应商 + 账号解析：配了代理池的供应商走池，绕开全局代理。
  const fetchImpl = providerFetch(codeBuddyProviderId(region), userId || undefined);
  const response = await fetchImpl(new URL(path, origin), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Origin: origin,
      Referer: `${origin}/`,
      "User-Agent": BILLING_UA,
      "X-IDE-Name": "CLI",
      "X-IDE-Type": "CLI",
      "X-IDE-Version": IDE_VERSION,
      "X-Product": "SaaS",
      "X-Requested-With": "XMLHttpRequest",
      ...(userId ? { "X-User-Id": userId } : {}),
      ...(enterpriseId ? { "X-Enterprise-Id": enterpriseId } : {}),
      ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
      "X-Domain": new URL(origin).host,
    },
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

/** 个人资源查询 body（窗口 = 现在 → 约 100 年后，与参考实现同窗口）。 */
function buildUserResourceBody(): Record<string, unknown> {
  const now = new Date();
  const formatDate = (value: Date) => value.toISOString().slice(0, 19).replace("T", " ");
  return {
    ...USER_RESOURCE_PAGINATION,
    PackageEndTimeRangeBegin: formatDate(now),
    PackageEndTimeRangeEnd: formatDate(
      new Date(now.getTime() + USER_RESOURCE_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    ),
  };
}

/** tenant meter 响应外壳：`data.data || data || payload`（参考实现 unwrap）。 */
function unwrapEnterpriseUsage(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;
  const data = record.data;
  if (data === undefined || data === null) return payload;
  return asRecord(data)?.data ?? data;
}

interface EnterpriseCredits {
  remaining: number;
  total: number;
  used: number;
  resetAt: string | null;
}

function toEnterpriseCredits(payload: unknown): EnterpriseCredits | null {
  const usage = asRecord(unwrapEnterpriseUsage(payload));
  if (!usage) return null;
  // Number(null)/Number('') 都是 0：无上限的 tenant meter 不能读成 0 额度，
  // 直接交给个人资源查询（参考实现同一判断）。
  if (usage.limitNum === null || usage.limitNum === undefined || usage.limitNum === "") {
    return null;
  }
  const total = toNumberOrNull(usage.limitNum);
  if (total === null) return null;
  const used = toNumberOrNull(usage.credit) ?? 0;
  return {
    remaining: total - used,
    total,
    used,
    resetAt: toResetAt(usage.cycleResetTime),
  };
}

/** Accounts[] 聚合成 { total, used, remaining }（参考实现 normalizeQuotaPayload）。 */
function normalizeAccountsQuota(payload: unknown): { total: number; used: number; remaining: number } | null {
  const accounts = findValue(payload, ["Accounts"]);
  if (!Array.isArray(accounts)) return null;
  let total = 0;
  let used = 0;
  let remaining = 0;
  let hasValues = false;
  for (const account of accounts) {
    const size = toNumberOrNull(findValue(account, ["CycleCapacitySize", "CapacitySize"]));
    const accountRemaining = toNumberOrNull(
      findValue(account, ["CycleCapacityRemain", "CapacityRemain"]),
    );
    const accountUsed = toNumberOrNull(findValue(account, ["CycleCapacityUsed", "CapacityUsed"]));
    if (size !== null || accountRemaining !== null || accountUsed !== null) {
      hasValues = true;
      total += size ?? (accountRemaining ?? 0) + (accountUsed ?? 0);
      remaining += accountRemaining ?? 0;
      used += accountUsed ?? (size ?? 0) - (accountRemaining ?? 0);
    }
  }
  return hasValues ? { total, used, remaining } : null;
}

function planNameFromPayload(payload: unknown): string | null {
  const value = findValue(payload, [
    "plan",
    "planName",
    "userType",
    "PackageName",
    "editionName",
    "enterpriseName",
    "packageName",
  ]);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function resetAtFromPayload(payload: unknown): string | null {
  return toResetAt(
    findValue(payload, ["resetAt", "reset_at", "resetTime", "CycleEndTime"]),
  );
}

function snapshotBase(account: CodeBuddyAccountView, region: CodeBuddyRegion) {
  return {
    provider: "codebuddy" as const,
    region,
    accountId: account.id,
    accountName: account.displayName || account.id,
    ...(account.email ? { email: account.email } : {}),
  };
}

/** 账号令牌缺失/查询失败的统一快照（额度字段全 null，不上 guessed 值）。 */
function failedSnapshot(
  account: CodeBuddyAccountView,
  region: CodeBuddyRegion,
  status: "no_token" | "error",
  error: string | null,
): AccountQuotaSnapshot {
  return {
    ...snapshotBase(account, region),
    status,
    remaining: null,
    total: null,
    used: null,
    planName: null,
    resetAt: null,
    exceeded: false,
    error,
  };
}

/** 企业 seat 额度查询（404/405 回退无 /v2 前缀路径；无上限时返回 null）。 */
async function fetchEnterpriseCredits(
  region: CodeBuddyRegion,
  accessToken: string,
): Promise<{ credits: EnterpriseCredits; payload: unknown } | null> {
  let payload: unknown;
  try {
    payload = await fetchBillingJson(region, accessToken, ENTERPRISE_USAGE_PATH, {});
  } catch (error) {
    if (!isNotFoundOrMethodMismatch(error)) throw error;
    payload = await fetchBillingJson(region, accessToken, ENTERPRISE_USAGE_FALLBACK_PATH, {});
  }
  const credits = toEnterpriseCredits(payload);
  return credits ? { credits, payload } : null;
}

/**
 * 单账号额度查询。
 *
 * 企业 seat（令牌可解出 enterprise/tenant 标识）优先走 tenant meter；
 * 拿不到有效上限（limitNum 缺失）时落回个人资源查询——与参考实现
 * loadAccountStatus 的分支完全一致。
 */
export async function queryCodeBuddyAccountQuota(
  region: CodeBuddyRegion,
  accountId: string,
): Promise<AccountQuotaSnapshot> {
  const { accounts } = await listCodeBuddyAccounts(region);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return {
      provider: "codebuddy",
      region,
      accountId,
      accountName: accountId,
      status: "error",
      remaining: null,
      total: null,
      used: null,
      planName: null,
      resetAt: null,
      exceeded: false,
      error: "账号不存在或未登录，请先在账号列表登录",
    };
  }
  const accessToken = (account.accessToken ?? "").trim();
  if (!accessToken) {
    return failedSnapshot(account, region, "no_token", "无访问令牌（请重新登录账号）");
  }

  const { enterpriseId } = resolveEnterpriseContext(accessToken);
  if (enterpriseId) {
    try {
      const enterprise = await fetchEnterpriseCredits(region, accessToken);
      if (enterprise) {
        return {
          ...snapshotBase(account, region),
          status: "ok",
          remaining: enterprise.credits.remaining,
          total: enterprise.credits.total,
          used: enterprise.credits.used,
          planName: planNameFromPayload(enterprise.payload),
          resetAt: enterprise.credits.resetAt,
          exceeded: enterprise.credits.remaining <= 0,
          error: null,
        };
      }
      // tenant meter 无有效上限：落到个人资源查询（下面继续），不报错。
    } catch (error) {
      logger().warn(undefined, "CodeBuddy 企业 seat 额度查询失败，回退个人查询", {
        region,
        accountId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const payload = await fetchBillingJson(region, accessToken, USER_RESOURCE_PATH, buildUserResourceBody());
    const aggregated = normalizeAccountsQuota(payload);
    const total =
      aggregated?.total ??
      toNumberOrNull(findValue(payload, ["total", "total_size", "quota", "TotalDosage"]));
    const used =
      aggregated?.used ?? toNumberOrNull(findValue(payload, ["used", "total_used"]));
    const remaining =
      aggregated?.remaining ?? toNumberOrNull(findValue(payload, ["remaining", "total_remain"]));
    return {
      ...snapshotBase(account, region),
      status: "ok",
      remaining,
      total,
      used: used ?? (total !== null && remaining !== null ? total - remaining : null),
      planName: planNameFromPayload(payload),
      resetAt: resetAtFromPayload(payload),
      exceeded: false,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger().warn(undefined, "CodeBuddy 个人额度查询失败", { region, accountId, message });
    return failedSnapshot(account, region, "error", message);
  }
}

/**
 * 批量额度查询：遍历已登录账号，并发上限 4（对齐 codebuddy2api
 * getAccountStatus 的 `index += 4` 分片模式），返回逐账号快照 + 汇总统计
 * （账号数/总额/平均/最小/最大，对齐 9router check_quota.sh）。
 */
export async function queryCodeBuddyQuotaBatch(
  input: { regions?: readonly CodeBuddyRegion[] } = {},
): Promise<QuotaBatchResult> {
  const regions = input.regions?.length ? input.regions : (["cn", "intl"] as const);
  const accountEntries: Array<{ region: CodeBuddyRegion; account: CodeBuddyAccountView }> = [];
  for (const region of regions) {
    const { accounts } = await listCodeBuddyAccounts(region);
    for (const account of accounts) accountEntries.push({ region, account });
  }
  const results = await mapWithConcurrency(
    accountEntries,
    QUOTA_BATCH_CONCURRENCY,
    async ({ region, account }) => queryCodeBuddyAccountQuota(region, account.id),
  );
  return { results, summary: summarizeQuotaSnapshots(results) };
}
