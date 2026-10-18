import type {
  QoderCheckinMachineIdentity,
  QoderCheckinOutcome,
} from "./qoderCheckin.js";
import { providerFetch, qoderProviderId } from "../providers/api/providerNetwork.js";

/**
 * XCode fork：Qoder 签到协议层（与账号入口/历史存储分离，便于维护）。
 *
 * 协议来自 qoder2api 抓包还原：
 *   1. GET  /sash/api/v1/me/campaigns                 → 找 CLAIMABLE 的
 *      actionType=CLAIM_BENEFIT 活动（每日 100 Credits）
 *   2. POST /sash/api/v1/me/campaigns/{campaignId}/claim → 领取（**空 body**）
 *   3. GET  /sash/api/v1/me/daily-check-in/status     → 只读统计补充
 *
 * 端点 host 按账号区域分流：国内 openapi.qoder.com.cn，国际 openapi.qoder.sh
 * （拿国际 token 打国内端点会 401 TOKEN_EXPIRE，必须按 region 路由）。
 *
 * **intl 路径完整性（2026-10-14 本机真实账号实测）**：
 *   - GET openapi.qoder.sh/sash/api/v1/me/campaigns → 200，campaigns 数组
 *     结构正常（与 cn 完全对称），但这两个国际号只有一条 VIEW_DETAILS 的
 *     Pro 订阅翻倍活动（act-20260901-493），**没有 CLAIM_BENEFIT**——
 *     即上游未给这些账号下发每日签到活动（账号侧灰度，需有一定使用记录）。
 *     此时应判 no_campaign，属正确行为而非本地 bug。
 *   - GET openapi.qoder.sh/api/v2/quota/usage 与 /api/v2/user/plan → 均
 *     200 且带回真实数据，证明 intl 端点可达、token 有效。
 *   - GET openapi.qoder.sh/sash/api/v1/me/daily-check-in/status → 404
 *     （该端点在 intl 从未部署，非错误，按无数据忽略）。
 *   - 负对照：intl token 打国内 host → 401 TOKEN_EXPIRE，证明 host 按
 *     region 分流是承重的，不能写死。
 *   一旦上游给某个 intl 账号下发 CLAIM_BENEFIT，本文件领取逻辑与 cn 完全
 *   对称，可直接领取，无需任何改动。
 *
 * 两条关键结论（上游实测，照做即可）：
 *   - **不走** daily-check-in/claim：该 legacy 端点已全局 DISABLED，却对未领取
 *     日也恒返回 409，会被误判成"已领取"而漏领；国际版更是直接 404。
 *     权威领取只走 campaigns（返回 grantId 可核验到账）。
 *   - **cosy-machinetoken 是服务端签发的设备令牌，不能自造**：客户端编造任何
 *     值都会被服务端判伪造，导致不下发 CLAIM_BENEFIT 签到活动。但"空值放行"
 *     只是 qoder2api（Go 参考实现）的兜底——它拿不到真实令牌所以选择不发。
 *     **XCode 持有真实令牌**：设备流登录时从 mi-token 接口取回三件套并随账号
 *     持久化（见 qoderAuth.beginQoderLogin / fetchMachineIdentity），因此这里
 *     优先发送账号绑定的真实 machineToken，与官方桌面端行为一致；账号确实
 *     没有该字段（早期登录态）才退化成不发送并记日志。
 *     ⚠️ 以后若改动这里，绝不可以用硬编码占位符冒充 machineToken —— 那正是
 *     会被服务端识别为伪造设备的写法。
 *   - 其余自造指纹（machineid / machinetype / machinecode / hostname / os）
 *     经 qoder2api 实测"取值均不影响活动下发"，故不发送，保持最小头集。
 *
 * 同构约束：本模块会被 UI 拖进 renderer bundle（只取类型），因此不能用
 * node:crypto / Buffer；网络走全局 fetch。实际执行发生在 host（RPC）。
 */

/** 签到/OpenAPI host 按区域分流（国际号打国内端点会 401 TOKEN_EXPIRE）。 */
const CHECKIN_HOST: Record<"cn" | "intl", string> = {
  cn: "openapi.qoder.com.cn",
  intl: "openapi.qoder.sh",
};

const REQUEST_TIMEOUT_MS = 30_000;

/** 每日活动默认积分（领取响应缺失金额时的兜底，与上游活动一致）。 */
const DEFAULT_DAILY_REWARD = 100;

interface QoderCampaign {
  campaignId: string;
  campaignKey: string;
  actionType: string;
  claimStatus: string;
  /** 窗口开始时间（Unix 秒）。 */
  startAt: number;
  endAt: number;
  benefit?: { kind?: string; amount?: number };
}

interface QoderDailyCheckinStatus {
  campaignKey?: string;
  status?: string;
  rewardCredits?: number;
  currentStreakDays?: number;
  totalClaimDays?: number;
  totalRewardCredits?: number;
}

export interface CheckinHttpResponse {
  /** HTTP 状态码；网络失败为 0。 */
  status: number;
  /** 解析后的 JSON body（解析失败为 null）。 */
  body: unknown;
  /** 原始响应体（错误信息截断用）。 */
  raw: string;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 签到请求头（刻意最小化，但携带**真实** machinetoken）。
 *
 * 与 qoder2api（Go 参考实现）的差异：它拿不到服务端签发的真实设备令牌，
 * 自造值又会被判伪造导致不下发活动，只能整条不发；XCode 的设备流登录会从
 * mi-token 接口取回真实三件套并随账号持久化，所以这里优先发送账号绑定的
 * `cosy-machinetoken`（真实值），与官方桌面端行为一致。账号缺该字段时才
 * 退化成不发送（调用方记日志）。
 *
 * 其余自造指纹（machineid / machinetype / machinecode 等）经上游实测不影响
 * 活动下发，保持不发送，避免冗余。
 */
function checkinHeaders(
  deviceToken: string,
  machine?: QoderCheckinMachineIdentity,
): Record<string, string> {
  const machineToken = machine?.machineToken?.trim();
  return {
    authorization: `Bearer ${deviceToken}`,
    accept: "application/json",
    "accept-language": "zh-CN",
    "user-agent": "Qoder",
    "cosy-clienttype": "10",
    // 只有真实签发的 machineToken 才发送；没有就整条不发（空值上游反而放行）。
    ...(machineToken ? { "cosy-machinetoken": machineToken } : {}),
  };
}

/** 发送签到相关请求；POST claim 为空 body（抓包确认）。 */
async function doCheckinRequest(
  method: "GET" | "POST",
  path: string,
  deviceToken: string,
  host: string,
  machine?: QoderCheckinMachineIdentity,
  /** XCode fork：账号 id，用于账号级代理绑定；签到同属该供应商的登录链路。 */
  fetchImpl: typeof fetch = fetch,
): Promise<CheckinHttpResponse> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://${host}${path}`,
      {
        method,
        headers:
          method === "POST"
            ? { ...checkinHeaders(deviceToken, machine), origin: `https://${host}` }
            : checkinHeaders(deviceToken, machine),
      },
      fetchImpl,
    );
  } catch (error) {
    return {
      status: 0,
      body: null,
      raw: error instanceof Error ? error.message : String(error),
    };
  }
  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = null;
    }
  }
  return { status: response.status, body, raw };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseCampaign(value: unknown): QoderCampaign | null {
  const record = asRecord(value);
  if (!record) return null;
  const campaignId = asString(record.campaignId);
  if (!campaignId) return null;
  const benefit = asRecord(record.benefit);
  return {
    campaignId,
    campaignKey: asString(record.campaignKey),
    actionType: asString(record.actionType),
    claimStatus: asString(record.claimStatus),
    startAt: asNumber(record.startAt),
    endAt: asNumber(record.endAt),
    ...(benefit
      ? { benefit: { kind: asString(benefit.kind), amount: asNumber(benefit.amount) } }
      : {}),
  };
}

/**
 * 权威领取：campaigns 流程。
 * Step 1 查活动列表 → Step 2 对 CLAIMABLE 的 CLAIM_BENEFIT 活动空 body 领取。
 */
export async function campaignsCheckin(
  deviceToken: string,
  region: "cn" | "intl",
  machine?: QoderCheckinMachineIdentity,
  accountId?: string,
): Promise<QoderCheckinOutcome> {
  const host = CHECKIN_HOST[region];
  const fetchImpl = providerFetch(qoderProviderId(region), accountId);
  const base: QoderCheckinOutcome = {
    status: "error",
    amount: 0,
    expiresAt: "",
    message: "",
    streakDays: 0,
    totalClaimDays: 0,
    totalRewardCredits: 0,
    rewardCredits: 0,
    windowDate: "",
  };

  const list = await doCheckinRequest(
    "GET",
    "/sash/api/v1/me/campaigns",
    deviceToken,
    host,
    machine,
    fetchImpl,
  );
  if (list.status !== 200) {
    return {
      ...base,
      message: `查询活动失败 HTTP ${list.status}: ${truncate(list.raw, 300)}`,
    };
  }
  const listBody = asRecord(list.body);
  const campaigns = Array.isArray(listBody?.campaigns) ? listBody.campaigns : [];
  const parsed = campaigns
    .map((item) => parseCampaign(item))
    .filter((item): item is QoderCampaign => item !== null);

  // 找可领取的 CLAIM_BENEFIT 活动，同时记窗口开始时间（本地历史按它记账）。
  let target: QoderCampaign | null = null;
  let benefitCampaign: QoderCampaign | null = null;
  let alreadyClaimed = false;
  for (const campaign of parsed) {
    if (campaign.actionType !== "CLAIM_BENEFIT") continue;
    benefitCampaign = campaign; // 任意状态，用于取窗口日期
    if (campaign.claimStatus === "CLAIMABLE") target = campaign;
    else if (campaign.claimStatus === "CLAIMED") alreadyClaimed = true;
  }

  const windowSource = target ?? benefitCampaign;
  // 窗口日期取活动 startAt 的**本地时区**日期（与 qoder2api 一致：
  // 每日窗口 10:00→次日 10:00，10:00 前领取仍记昨日窗口）。
  const windowDate =
    windowSource && windowSource.startAt > 0
      ? formatDay(new Date(windowSource.startAt * 1000))
      : "";

  if (!target) {
    // 无 CLAIM_BENEFIT 活动。要区分两种成因，避免用户误以为功能没实现：
    //   - 上游未给该账号下发签到活动（灰度，intl 常见；cn 也可能窗口未开）
    //   - 查询/领取失败走上面的 error 分支（HTTP 非 200），与此处不是一回事
    return alreadyClaimed
      ? {
          ...base,
          status: "already_claimed",
          message: windowHint(windowDate, "今日已领取"),
          windowDate,
        }
      : {
          ...base,
          status: "no_campaign",
          message:
            region === "intl"
              ? "暂无可用签到活动：国际版每日签到由上游按账号灰度发放，该账号暂未获得资格"
              : "暂无可用签到活动（上游未发放，每日 10:00 UTC+8 刷新，可稍后再试）",
          windowDate,
        };
  }

  // Step 2：领取（空 body）。
  const claim = await doCheckinRequest(
    "POST",
    `/sash/api/v1/me/campaigns/${encodeURIComponent(target.campaignId)}/claim`,
    deviceToken,
    host,
    machine,
    fetchImpl,
  );
  if (claim.status !== 200) {
    return {
      ...base,
      status: "error",
      message: `领取失败 HTTP ${claim.status}: ${truncate(claim.raw, 300)}`,
      windowDate,
    };
  }
  const claimBody = asRecord(claim.body);
  const status = asString(claimBody?.status);
  const benefit = asRecord(claimBody?.benefit);
  const amount = asNumber(benefit?.amount);
  const expiresAt = asString(claimBody?.expiresAt);

  if (status === "CLAIMED") {
    if (claimBody?.replayed === true) {
      return {
        ...base,
        status: "already_claimed",
        message: windowHint(windowDate, "今日已领取"),
        amount,
        expiresAt,
        windowDate,
      };
    }
    return {
      ...base,
      status: "claimed",
      amount,
      expiresAt,
      message: `领取成功 +${amount || DEFAULT_DAILY_REWARD} ${target.campaignKey || "Credits"}`,
      windowDate,
    };
  }
  return {
    ...base,
    status: "error",
    message: `未知领取状态: ${status || "(空)"}`,
    windowDate,
  };
}

/**
 * 只读补充 legacy daily-check-in 统计（**绝不通过它领取**：DISABLED 时
 * claim 恒 409 会误判已领取）。上游恢复后可作为 streak 的补充数据源。
 */
export async function readDailyCheckinStats(
  deviceToken: string,
  region: "cn" | "intl",
  machine?: QoderCheckinMachineIdentity,
  accountId?: string,
): Promise<QoderDailyCheckinStatus | null> {
  const host = CHECKIN_HOST[region];
  const response = await doCheckinRequest(
    "GET",
    "/sash/api/v1/me/daily-check-in/status",
    deviceToken,
    host,
    machine,
    providerFetch(qoderProviderId(region), accountId),
  );
  // 国际版该端点从未部署（404），国内恒 0/DISABLED——都不是错误。
  if (response.status !== 200) return null;
  const body = asRecord(response.body);
  if (!body) return null;
  return {
    campaignKey: asString(body.campaignKey),
    status: asString(body.status),
    rewardCredits: asNumber(body.rewardCredits),
    currentStreakDays: asNumber(body.currentStreakDays),
    totalClaimDays: asNumber(body.totalClaimDays),
    totalRewardCredits: asNumber(body.totalRewardCredits),
  };
}

/**
 * "已领取"提示：若当前窗口是上一日开的（10:00 前点击），明确告知新窗口
 * 开放时间，避免误以为没领到。与账号入口共用，故从这里导出。
 */
export function windowHint(windowDate: string, fallback: string): string {
  if (!windowDate) return fallback;
  if (windowDate === formatDay(new Date())) return fallback;
  const parsed = new Date(`${windowDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return fallback;
  const next = new Date(parsed.getTime() + 86_400_000);
  const mmdd = `${`${next.getMonth() + 1}`.padStart(2, "0")}-${`${next.getDate()}`.padStart(2, "0")}`;
  return `已领取 ${windowDate} 窗口额度（新窗口 ${mmdd} 10:00 开放）`;
}

/** 本地时区 YYYY-MM-DD。 */
export function formatDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
