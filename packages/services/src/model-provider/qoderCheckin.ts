import { createServiceLogger } from "../logger/serviceLogger.js";
import { listQoderAccounts, type QoderAuthRegion } from "./qoderAuth.js";
import {
  campaignsCheckin,
  formatDay,
  readDailyCheckinStats,
} from "./qoderCheckinProtocol.js";

/**
 * XCode fork：Qoder 每日签到（campaigns 流程）——账号入口 + 本地历史。
 *
 * 复用 qoderAuth 的账号体系（device token / machinetoken 都取账号持久化值，
 * 不另造存储），协议细节见 qoderCheckinProtocol.ts：
 *   GET /sash/api/v1/me/campaigns → POST .../campaigns/{id}/claim（空 body）
 *   → GET /sash/api/v1/me/daily-check-in/status（只读统计补充）
 * host 按账号区域分流（国内 openapi.qoder.com.cn / 国际 openapi.qoder.sh）。
 *
 * 关于 machinetoken：服务端签发的设备令牌不能自造（伪造值会导致不下发签到
 * 活动），"不发"只是 qoder2api 拿不到真实令牌时的兜底。XCode 设备流登录会
 * 从 mi-token 接口取回真实三件套并随账号持久化，因此签到优先带真实值上行，
 * 与官方桌面端一致；账号缺该字段才降级不发送。
 *
 * **intl 与 cn 完全对称，无死路**（2026-10-14 实测夯实）：host 由
 * CHECKIN_HOST[region] 派生、请求头/ campaigns 解析/ claim 路径拼接均不带
 * 区域特判。实测 intl  campaigns/quota/plan 三端点均 200 且 token 有效，
 * 只是上游未给现有国际账号下发 CLAIM_BENEFIT 活动（账号灰度），故显示
 * no_campaign；上游一旦下发，领取逻辑与 cn 一致直接可用。详见
 * qoderCheckinProtocol.ts 头部注释。
 *
 * 连续签到天数：上游 legacy streak 恒 0，由本地签到历史计算（按**活动窗口
 * startAt 日期**记账，而非自然日——每日窗口 10:00→次日 10:00，10:00 前领取
 * 仍记昨日窗口）。历史经凭证服务持久化（与 qoder:accounts:{region} 同一加密
 * 通道），key 为 qoder:checkin:history。
 *
 * 同构约束：本模块会被 UI 拖进 renderer bundle（只取类型），因此不能用
 * node:crypto / Buffer；网络走全局 fetch。实际执行发生在 host（RPC）。
 */

export type QoderCheckinRegion = QoderAuthRegion;

export type QoderCheckinStatus =
  | "claimed"
  | "already_claimed"
  | "no_campaign"
  | "no_token"
  | "error";

export interface QoderCheckinResult {
  /** 账号标识（user_id，与账号列表一致）。 */
  accountId: string;
  /** 账号显示名（列表回显用）。 */
  accountName: string;
  region: QoderCheckinRegion;
  status: QoderCheckinStatus;
  /** 本次领取积分（claimed 时来自响应；失败/已领取回落到已知值）。 */
  amount: number;
  /** 领取响应里的过期时间（原样透传，通常 RFC3339）。 */
  expiresAt: string;
  /** 人类可读的结果说明（含连续签到统计后缀）。 */
  message: string;
  /** 连续签到天数（本地历史计算；本地无记录时回落上游值）。 */
  streakDays: number;
  /** 累计签到天数。 */
  totalClaimDays: number;
  /** 累计奖励积分。 */
  totalRewardCredits: number;
  /** 每日签到奖励额（来自 daily-check-in/status，仅作展示）。 */
  rewardCredits: number;
  /** 本次领取对应的活动窗口日期（YYYY-MM-DD，取活动 startAt 本地时区）。 */
  windowDate: string;
}

/** 协议层产出（尚未填账号信息与本地统计的结果骨架）。 */
export interface QoderCheckinOutcome {
  status: QoderCheckinStatus;
  amount: number;
  expiresAt: string;
  message: string;
  streakDays: number;
  totalClaimDays: number;
  totalRewardCredits: number;
  rewardCredits: number;
  windowDate: string;
}

export interface QoderCheckinStats {
  streakDays: number;
  totalClaimDays: number;
  totalRewardCredits: number;
  /** 最近若干条签到记录（新→旧），供 UI 展示。 */
  recent: Array<{ date: string; amount: number }>;
}

export interface QoderCheckinSummary {
  results: QoderCheckinResult[];
  /** status → 数量，例如 { claimed: 2, already_claimed: 1 }。 */
  summary: Record<string, number>;
}

/**
 * 账号绑定的设备身份（来自 qoderAuth 账号持久化，一号一绑）。
 * machineToken 是 mi-token 接口下发的**真实**设备令牌。
 */
export interface QoderCheckinMachineIdentity {
  machineToken?: string;
  machineType?: string;
  machineCode?: string;
  machineId?: string;
}

/** 每日活动默认积分（领取响应缺失金额时的兜底，与上游活动一致）。 */
const DEFAULT_DAILY_REWARD = 100;

// 懒创建（与 qoderAuth 同理由：UI 会拖入本模块，顶层执行会崩）。
function logger() {
  return createServiceLogger("qoder-checkin");
}

// ---------------------------------------------------------------------------
// 签到历史持久化（本地连续天数）
// ---------------------------------------------------------------------------

interface QoderCheckinRecord {
  /** 窗口日期 YYYY-MM-DD（取活动 startAt，不是自然日）。 */
  date: string;
  amount: number;
}

/** key: `${region}:${accountId}` → 签到记录（同日幂等）。 */
type QoderCheckinHistory = Record<string, QoderCheckinRecord[]>;

export interface QoderCheckinHistoryStore {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}

const HISTORY_STORE_KEY = "qoder:checkin:history";
/** 最近记录回显条数上限。 */
const RECENT_LIMIT = 30;

let historyStore: QoderCheckinHistoryStore | null = null;
let historyCache: QoderCheckinHistory | null = null;
/** 串行化 load/save，避免并发签到把历史写丢。 */
let historyWriteChain: Promise<void> = Promise.resolve();

/** node.ts 组装时注入持久化（credentialService，与账号列表同一加密通道）。 */
export function setQoderCheckinHistoryStore(store: QoderCheckinHistoryStore | null): void {
  historyStore = store;
  historyCache = null;
}

async function loadHistory(): Promise<QoderCheckinHistory> {
  if (historyCache) return historyCache;
  const empty: QoderCheckinHistory = {};
  if (!historyStore) {
    historyCache = empty;
    return empty;
  }
  try {
    const raw = await historyStore.load(HISTORY_STORE_KEY);
    if (!raw) {
      historyCache = empty;
      return empty;
    }
    const parsed = JSON.parse(raw) as QoderCheckinHistory;
    const normalized: QoderCheckinHistory = {};
    for (const [key, records] of Object.entries(parsed ?? {})) {
      if (!Array.isArray(records)) continue;
      normalized[key] = records.filter(
        (record): record is QoderCheckinRecord =>
          !!record && typeof record.date === "string" && Number.isFinite(record.amount),
      );
    }
    historyCache = normalized;
    return normalized;
  } catch (error) {
    logger().warn(undefined, "Qoder 签到历史读取失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    historyCache = empty;
    return empty;
  }
}

function saveHistory(history: QoderCheckinHistory): Promise<void> {
  historyCache = history;
  if (!historyStore) return Promise.resolve();
  const operation = historyWriteChain.then(async () => {
    try {
      await historyStore?.save(HISTORY_STORE_KEY, JSON.stringify(history));
    } catch (error) {
      logger().warn(undefined, "Qoder 签到历史写入失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  historyWriteChain = operation;
  return operation;
}

/**
 * 计算连续天数与累计：
 * streak —— 今天已领从今天起数；今天未领从昨天起数（当天未领不断链）。
 * 与 qoder2api 的 calcLocalStats 语义一致。
 */
function calcLocalStats(records: readonly QoderCheckinRecord[]): {
  streak: number;
  totalDays: number;
  totalCredits: number;
} {
  if (records.length === 0) return { streak: 0, totalDays: 0, totalCredits: 0 };
  const days = new Set<string>();
  let totalCredits = 0;
  for (const record of records) {
    days.add(record.date);
    totalCredits += record.amount || 0;
  }
  let cursor = new Date();
  if (!days.has(formatDay(cursor))) cursor = new Date(cursor.getTime() - 86_400_000);
  let streak = 0;
  while (days.has(formatDay(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return { streak, totalDays: records.length, totalCredits };
}

/** 记录某账号某窗口日期签到（同日幂等），返回最新本地统计。 */
async function recordCheckin(
  accountKey: string,
  date: string,
  amount: number,
): Promise<{ streak: number; totalDays: number; totalCredits: number }> {
  const history = await loadHistory();
  const records = history[accountKey] ?? [];
  const existing = records.find((record) => record.date === date);
  if (!existing) {
    history[accountKey] = [...records, { date, amount }];
    await saveHistory(history);
  } else if (!existing.amount && amount > 0) {
    // 早前版本只记了日期没记金额：补记。
    history[accountKey] = records.map((record) =>
      record.date === date ? { date, amount } : record,
    );
    await saveHistory(history);
  }
  return calcLocalStats(history[accountKey] ?? []);
}

// ---------------------------------------------------------------------------
// 账号级入口（复用 qoderAuth 账号列表，不另造存储）
// ---------------------------------------------------------------------------

function accountKeyOf(region: QoderCheckinRegion, accountId: string): string {
  return `${region}:${accountId}`;
}

function streakSuffix(result: {
  streakDays: number;
  totalClaimDays: number;
  totalRewardCredits: number;
}): string {
  if (result.streakDays <= 0 && result.totalClaimDays <= 0) return "";
  return `（连续 ${result.streakDays} 天 · 累计 ${result.totalClaimDays} 天 · 共 ${result.totalRewardCredits} 积分）`;
}

/** 用本地签到历史覆盖统计字段（本地数据比上游 legacy 更可信）。 */
function applyLocalStreak(
  outcome: QoderCheckinOutcome,
  stats: { streak: number; totalDays: number; totalCredits: number },
): void {
  // 本地有记录 → 以本地为准；本地无记录 → 保留上游读到的值。
  if (stats.totalDays > 0) {
    outcome.streakDays = stats.streak;
    outcome.totalClaimDays = stats.totalDays;
    outcome.totalRewardCredits = stats.totalCredits;
  }
}

/**
 * 单账号签到。
 *
 * 流程：账号列表取 device token + 真实 machinetoken → campaigns 领取 →
 * 只读补统计 → 本地历史记账（claimed / already_claimed 记当日窗口，
 * 其余只读统计）。
 */
export async function qoderCheckinAccount(
  region: QoderCheckinRegion,
  accountId: string,
): Promise<QoderCheckinResult> {
  const { accounts } = await listQoderAccounts(region);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return {
      accountId,
      accountName: accountId,
      region,
      status: "error",
      amount: 0,
      expiresAt: "",
      message: "账号不存在或未登录，请先在账号列表登录",
      streakDays: 0,
      totalClaimDays: 0,
      totalRewardCredits: 0,
      rewardCredits: 0,
      windowDate: "",
    };
  }

  const deviceToken = (account.accessToken ?? "").trim();
  if (!deviceToken) {
    return {
      accountId,
      accountName: account.displayName || accountId,
      region,
      status: "no_token",
      amount: 0,
      expiresAt: "",
      message: "无 device token（请重新登录账号）",
      streakDays: 0,
      totalClaimDays: 0,
      totalRewardCredits: 0,
      rewardCredits: 0,
      windowDate: "",
    };
  }

  // 设备身份取账号持久化的真实值（一号一绑）：machineToken 是 mi-token 接口
  // 下发的真实令牌，签到必须带；账号缺该字段（早期登录态）才不发送。
  const machine: QoderCheckinMachineIdentity = {
    machineToken: account.machineToken,
    machineType: account.machineType,
    machineCode: account.machineCode,
    machineId: account.machineId,
  };
  if (!machine.machineToken?.trim()) {
    logger().warn(undefined, "Qoder 账号缺少真实 machineToken，本次签到不带该头上行", {
      region,
      accountId,
    });
  }
  // 账号 id 一并下传：签到同属 Qoder 登录链路，出口应当与该账号的模型请求一致。
  const outcome = await campaignsCheckin(deviceToken, region, machine, accountId);

  // 只读补充 legacy 统计（DISABLED 时恒 0，不影响结果；上游恢复后可提供 streak）。
  const legacy = await readDailyCheckinStats(deviceToken, region, machine, accountId);
  if (legacy) {
    outcome.rewardCredits = legacy.rewardCredits ?? 0;
    if (legacy.currentStreakDays && legacy.currentStreakDays > outcome.streakDays) {
      outcome.streakDays = legacy.currentStreakDays;
    }
    if (legacy.totalClaimDays && legacy.totalClaimDays > outcome.totalClaimDays) {
      outcome.totalClaimDays = legacy.totalClaimDays;
    }
    if (legacy.totalRewardCredits && legacy.totalRewardCredits > outcome.totalRewardCredits) {
      outcome.totalRewardCredits = legacy.totalRewardCredits;
    }
  }

  // 本地历史记账：领取类结果记当日窗口；金额取响应 → legacy → 活动默认 100。
  const record = outcome.status === "claimed" || outcome.status === "already_claimed";
  const accountKey = accountKeyOf(region, accountId);
  if (record) {
    const amount = outcome.amount || outcome.rewardCredits || DEFAULT_DAILY_REWARD;
    const windowDate = outcome.windowDate || formatDay(new Date());
    applyLocalStreak(outcome, await recordCheckin(accountKey, windowDate, amount));
    // 回写窗口日期（campaigns 无 startAt 时上面兜底为今天）。
    outcome.windowDate = windowDate;
  } else {
    const history = await loadHistory();
    applyLocalStreak(outcome, calcLocalStats(history[accountKey] ?? []));
  }

  const suffix = streakSuffix(outcome);
  if (suffix) outcome.message += suffix;

  logger().info(undefined, "Qoder 签到完成", {
    region,
    accountId,
    status: outcome.status,
    amount: outcome.amount,
    streakDays: outcome.streakDays,
  });

  return {
    ...outcome,
    accountId,
    accountName: account.displayName || accountId,
    region,
  };
}

/**
 * 批量签到：遍历所有已登录 Qoder 账号。
 *
 * regions 默认 cn + intl 全量（同一实例可混管两区账号，host 按区域分流）。
 * 顺序执行，避免并发把上游打急。
 */
export async function qoderCheckinAll(
  input: { regions?: readonly QoderCheckinRegion[] } = {},
): Promise<QoderCheckinSummary> {
  const regions = input.regions?.length ? input.regions : (["cn", "intl"] as const);
  const results: QoderCheckinResult[] = [];
  for (const region of regions) {
    const { accounts } = await listQoderAccounts(region);
    for (const account of accounts) {
      const deviceToken = (account.accessToken ?? "").trim();
      if (!deviceToken) {
        results.push({
          accountId: account.id,
          accountName: account.displayName || account.id,
          region,
          status: "no_token",
          amount: 0,
          expiresAt: "",
          message: "无 device token，跳过（请重新登录账号）",
          streakDays: 0,
          totalClaimDays: 0,
          totalRewardCredits: 0,
          rewardCredits: 0,
          windowDate: "",
        });
        continue;
      }
      results.push(await qoderCheckinAccount(region, account.id));
    }
  }
  const summary: Record<string, number> = {};
  for (const result of results) summary[result.status] = (summary[result.status] ?? 0) + 1;
  return { results, summary };
}

/** 只读获取本地签到统计（不触发任何上游请求）。 */
export async function qoderCheckinStats(
  region: QoderCheckinRegion,
  accountId: string,
): Promise<QoderCheckinStats> {
  const history = await loadHistory();
  const records = history[accountKeyOf(region, accountId)] ?? [];
  const stats = calcLocalStats(records);
  const recent = [...records]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, RECENT_LIMIT)
    .map((record) => ({ date: record.date, amount: record.amount }));
  return {
    streakDays: stats.streak,
    totalClaimDays: stats.totalDays,
    totalRewardCredits: stats.totalCredits,
    recent,
  };
}
