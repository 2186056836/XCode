import { createServiceLogger } from "../logger/serviceLogger.js";
import { providerFetch, qoderProviderId } from "../providers/api/providerNetwork.js";
import {
  listQoderAccounts,
  type QoderAuthRegion,
  type QoderAccountView,
} from "./qoderAuth.js";
import {
  mapWithConcurrency,
  QUOTA_BATCH_CONCURRENCY,
  summarizeQuotaSnapshots,
  type AccountQuotaSnapshot,
  type QuotaBatchResult,
} from "./accountQuota.js";

/**
 * XCode fork：Qoder 账号额度/配额查询（结构对齐 BigModel codingPlanEntitlement
 * 的查询-解析-归一模式，单账号 + 批量 + 汇总）。
 *
 * 端点依据（实机验证过，不是猜的）：
 *
 *  1. 国际版（intl）：openapi 上存在 Bearer-only 查询端点
 *       GET https://openapi.qoder.sh/api/v2/quota/usage
 *       Authorization: Bearer <accessToken>
 *     响应（取自 qoder2api-main/account/oauth.go FetchQuota 的实测解析）：
 *       {
 *         isQuotaExceeded: bool,
 *         expiresAt: <epoch>,
 *         userQuota:  { used, total, remaining, resetTime | reset_time },
 *         addOnQuota: { used, total, remaining, resetTime | reset_time }
 *       }
 *     同一端点国内版 openapi.qoder.com.cn 上**不存在**（COSY 网关专属），
 *     所以 cn 走网关路径（见 QoderGatewayQuotaReader）。
 *     套餐名另取 Bearer-only 的 GET /api/v2/user/plan（user_type /
 *     plan_tier_name，与 qoderAuth.queryQoderProStatus 同一端点）。
 *
 *  2. 国内版（cn）：COSY 网关 + 设备签名
 *       GET https://gateway.qoder.com.cn/algo/api/v2/quota/usage
 *     响应形状与上面一致（qoderUpstreamModels.fetchQoderProStatusViaGateway
 *     就是这么取的：userQuota.remaining / userQuota.total / isQuotaExceeded）。
 *     该请求必须带 COSY 签名（host-only，qoderUpstreamModels.ts 用 Buffer），
 *     因此这里不直接发请求，而是通过注入的 gateway reader 读取——
 *     facade 把 node.ts 已装配的 qoderProStatusGatewayFetcher 传进来。
 *
 * 同构约束：本模块会被 UI 拖进 renderer bundle（只取类型），因此不能用
 * node:crypto / Buffer；网络走全局 fetch。实际执行发生在 host（RPC）。
 */

const FETCH_TIMEOUT_MS = 15_000;

/** Bearer-only 的 quota/usage 端点（openapi，国际版实测可用；国内版不存在）。 */
const QUOTA_USAGE_URL: Record<QoderAuthRegion, string> = {
  cn: "https://openapi.qoder.com.cn/api/v2/quota/usage",
  intl: "https://openapi.qoder.sh/api/v2/quota/usage",
};

/** Bearer-only 的套餐端点（user_type / plan_tier_name）。 */
const USER_PLAN_URL: Record<QoderAuthRegion, string> = {
  cn: "https://openapi.qoder.com.cn/api/v2/user/plan",
  intl: "https://openapi.qoder.sh/api/v2/user/plan",
};

// 懒创建（与 qoderAuth 同理由：UI 会拖入本模块，顶层执行会崩）。
function logger() {
  return createServiceLogger("qoder-quota");
}

/**
 * cn 网关额度读取器（host-only 注入）。形状与 providerFacadeServices 的
 * QoderProStatusGatewayFetcher 兼容——node.ts 装配的 fetchQoderProStatusViaGateway
 * 直接可传。
 */
export interface QoderGatewayQuotaReader {
  (input: {
    region: "cn" | "intl";
    accessToken: string;
    userId: string;
    machineId: string;
  }): Promise<{
    isPro: boolean;
    userType: string;
    planTier: string;
    quotaRemaining?: number;
    quotaTotal?: number;
    isQuotaExceeded?: boolean;
  }>;
}

/** quota/usage 原始响应里的额度桶（userQuota / addOnQuota）。 */
interface QoderQuotaBucket {
  used?: number;
  total?: number;
  remaining?: number;
  resetTime?: string;
  reset_time?: string;
}

interface QoderQuotaUsagePayload {
  isQuotaExceeded?: boolean;
  expiresAt?: number;
  userQuota?: QoderQuotaBucket | null;
  addOnQuota?: QoderQuotaBucket | null;
}

function pickFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bucketRemaining(bucket: QoderQuotaBucket | null | undefined): number | null {
  if (!bucket) return null;
  return pickFiniteNumber(bucket.remaining);
}

function bucketTotal(bucket: QoderQuotaBucket | null | undefined): number | null {
  if (!bucket) return null;
  return pickFiniteNumber(bucket.total);
}

function bucketUsed(bucket: QoderQuotaBucket | null | undefined): number | null {
  if (!bucket) return null;
  return pickFiniteNumber(bucket.used);
}

function bucketResetTime(bucket: QoderQuotaBucket | null | undefined): string | null {
  if (!bucket) return null;
  const direct = typeof bucket.resetTime === "string" ? bucket.resetTime.trim() : "";
  if (direct) return direct;
  const snake = typeof bucket.reset_time === "string" ? bucket.reset_time.trim() : "";
  return snake || null;
}

function addNullableNumbers(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

async function fetchJsonWithTimeout(
  url: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Qoder quota HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error("Qoder quota returned non-JSON response");
  }
}

/** 从 /api/v2/user/plan 读套餐名（best-effort，失败返回 null 不阻断额度）。 */
async function fetchPlanName(
  region: QoderAuthRegion,
  accessToken: string,
  accountId?: string,
): Promise<string | null> {
  try {
    const plan = await fetchJsonWithTimeout(
      USER_PLAN_URL[region],
      accessToken,
      providerFetch(qoderProviderId(region), accountId),
    );
    const planTier = typeof plan.plan_tier_name === "string" ? plan.plan_tier_name.trim() : "";
    if (planTier) return planTier;
    const userType = typeof plan.user_type === "string" ? plan.user_type.trim() : "";
    return userType || null;
  } catch {
    // 套餐名只是展示补充：取不到不影响额度本身。
    return null;
  }
}

/**
 * 国际版 Bearer-only 额度查询（openapi.sh）。
 * 剩余/总额 = userQuota + addOnQuota 两个桶相加（活动额度与基础额度是两份
 * 可消耗credit，qoder2api 的控制台也是分桶展示后合计）。
 */
export async function fetchQoderQuotaBearer(
  region: QoderAuthRegion,
  accessToken: string,
  accountId?: string,
): Promise<AccountQuotaSnapshot> {
  const payload = (await fetchJsonWithTimeout(
    QUOTA_USAGE_URL[region],
    accessToken,
    providerFetch(qoderProviderId(region), accountId),
  )) as unknown as QoderQuotaUsagePayload;
  const userQuota = payload.userQuota ?? null;
  const addonQuota = payload.addOnQuota ?? null;
  const remaining = addNullableNumbers(bucketRemaining(userQuota), bucketRemaining(addonQuota));
  const total = addNullableNumbers(bucketTotal(userQuota), bucketTotal(addonQuota));
  const used =
    remaining !== null && total !== null
      ? total - remaining
      : bucketUsed(userQuota) ?? bucketUsed(addonQuota);
  return {
    provider: "qoder",
    region,
    accountId: "",
    accountName: "",
    status: "ok",
    remaining,
    total,
    used,
    planName: null,
    resetAt: bucketResetTime(userQuota) ?? bucketResetTime(addonQuota),
    exceeded: payload.isQuotaExceeded === true,
    error: null,
  };
}

/** 把网关读取结果归一成 AccountQuotaSnapshot 的额度字段。 */
function snapshotFromGateway(input: {
  region: "cn" | "intl";
  gateway: Awaited<ReturnType<QoderGatewayQuotaReader>>;
}): Pick<
  AccountQuotaSnapshot,
  "status" | "remaining" | "total" | "used" | "planName" | "resetAt" | "exceeded" | "error"
> {
  const { gateway } = input;
  const remaining =
    gateway.quotaRemaining !== undefined && Number.isFinite(gateway.quotaRemaining)
      ? gateway.quotaRemaining
      : null;
  const total =
    gateway.quotaTotal !== undefined && Number.isFinite(gateway.quotaTotal)
      ? gateway.quotaTotal
      : null;
  return {
    status: "ok",
    remaining,
    total,
    used: remaining !== null && total !== null ? total - remaining : null,
    // 网关不返回 resetTime，套餐名取 plan_tier_name → user_type。
    planName: (gateway.planTier || gateway.userType || "").trim() || null,
    resetAt: null,
    exceeded: gateway.isQuotaExceeded === true,
    error: null,
  };
}

function snapshotForAccountBase(account: QoderAccountView, region: QoderAuthRegion) {
  return {
    accountId: account.id,
    accountName: account.displayName || account.id,
    ...(account.email ? { email: account.email } : {}),
    region,
    provider: "qoder" as const,
  };
}

function emptySnapshot(
  account: QoderAccountView,
  region: QoderAuthRegion,
  status: "no_token" | "error",
  error: string | null,
): AccountQuotaSnapshot {
  return {
    ...snapshotForAccountBase(account, region),
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

/**
 * 单账号额度查询。
 *
 * cn：走注入的网关读取器（COSY 签名，host-only）；未注入 reader 时如实报
 * "当前环境未装配 Qoder 网关查询能力"，不发注定失败的请求。
 * intl：openapi Bearer-only 查询 + best-effort 套餐名。
 */
export async function queryQoderAccountQuota(
  region: QoderAuthRegion,
  accountId: string,
  options: { gateway?: QoderGatewayQuotaReader } = {},
): Promise<AccountQuotaSnapshot> {
  const { accounts } = await listQoderAccounts(region);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return {
      provider: "qoder",
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
    return emptySnapshot(account, region, "no_token", "无访问令牌（请重新登录账号）");
  }

  if (region === "cn") {
    if (!options.gateway) {
      return emptySnapshot(account, region, "error", "当前环境未装配 Qoder 网关查询能力");
    }
    try {
      const gateway = await options.gateway({
        region,
        accessToken,
        userId: account.id,
        machineId: account.machineId ?? "",
      });
      return { ...snapshotForAccountBase(account, region), ...snapshotFromGateway({ region, gateway }) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger().warn(undefined, "Qoder CN 网关额度查询失败", { accountId, message });
      return emptySnapshot(account, region, "error", message);
    }
  }

  try {
    const quota = await fetchQoderQuotaBearer(region, accessToken, account.id);
    const planName = await fetchPlanName(region, accessToken, account.id);
    // 顺序要紧：quota 的 accountId/accountName 是空串占位（该函数只认 token、
    // 不知道查的是哪个账号），必须让 snapshotForAccountBase 的身份字段覆盖它。
    // 反过来的话批量结果里所有账号 accountId 都是 ""，前端按 id 索引全部落空
    // （实测症状：汇总条有数据、账号行匹配不到额度）。
    return {
      ...quota,
      ...snapshotForAccountBase(account, region),
      planName: planName ?? quota.planName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger().warn(undefined, "Qoder 额度查询失败", { region, accountId, message });
    return emptySnapshot(account, region, "error", message);
  }
}

/**
 * 批量额度查询：遍历已登录账号，并发上限 4（对齐 codebuddy2api
 * getAccountStatus 的分片模式），返回逐账号快照 + 汇总统计
 * （账号数/总额/平均/最小/最大，对齐 9router check_quota.sh）。
 */
export async function queryQoderQuotaBatch(
  input: { regions?: readonly QoderAuthRegion[]; gateway?: QoderGatewayQuotaReader } = {},
): Promise<QuotaBatchResult> {
  const regions = input.regions?.length ? input.regions : (["cn", "intl"] as const);
  const accountEntries: Array<{ region: QoderAuthRegion; account: QoderAccountView }> = [];
  for (const region of regions) {
    const { accounts } = await listQoderAccounts(region);
    for (const account of accounts) accountEntries.push({ region, account });
  }
  const results = await mapWithConcurrency(
    accountEntries,
    QUOTA_BATCH_CONCURRENCY,
    async ({ region, account }) =>
      queryQoderAccountQuota(region, account.id, { gateway: input.gateway }),
  );
  return { results, summary: summarizeQuotaSnapshots(results) };
}
