/**
 * XCode fork：账号额度/配额查看的共享模型（Qoder / CodeBuddy 通用）。
 *
 * 统计维度对齐 9router check_quota.sh（字段名 creditsRemaining，来自
 * providerConnections 表）：账号数 / 总额度 / 平均 / 最小 / 最大。这里把同一套
 * 维度搬到"实时查询上游"的形态上：每个账号一个 AccountQuotaSnapshot，批量结果
 * 附带 QuotaSummary。
 *
 * 设计约束（与 qoderAuth / codebuddyAuth 一致）：
 *  - 本模块会被 UI 拖进 renderer bundle（只取类型），因此必须同构：
 *    不能用 node:crypto / Buffer。
 *  - 上游没给出的数值一律是 null，绝不猜测成 0——"剩余额度为 0"和"查不到"
 *    是两件事，汇总统计只统计有数据的账号，失败账号单独计数。
 */

/** 支持额度查看的供应商。 */
export type QuotaProvider = "qoder" | "codebuddy";

/** 账号级额度快照（单账号查询的结构化结果）。 */
export interface AccountQuotaSnapshot {
  provider: QuotaProvider;
  region: "cn" | "intl";
  /** 账号标识（与账号列表一致：Qoder=user_id，CodeBuddy=Keycloak sub）。 */
  accountId: string;
  /** 账号显示名（列表回显用）。 */
  accountName: string;
  email?: string;
  /**
   * ok = 上游请求成功（字段可能缺失，见 remaining 的 null 语义）；
   * no_token = 账号缺少访问令牌（需重新登录）；
   * error = 上游请求失败（message 有人类可读原因）。
   */
  status: "ok" | "no_token" | "error";
  /** 剩余额度；null = 上游未给出（不可解释为 0）。 */
  remaining: number | null;
  /** 总额度；null = 上游未给出。 */
  total: number | null;
  /** 已用额度；能由 total - remaining 推出时尽力推导，否则 null。 */
  used: number | null;
  /** 套餐/计划名（Qoder plan_tier_name、CodeBuddy 资源包名等），可空。 */
  planName: string | null;
  /** 额度重置/周期结束时间（上游原样字符串，通常 RFC3339），可空。 */
  resetAt: string | null;
  /** 上游明确标记超额（Qoder isQuotaExceeded；CodeBuddy 恒 false）。 */
  exceeded: boolean;
  /** 失败原因（status=error 时非空）。 */
  error: string | null;
}

/** 批量汇总（对齐 9router check_quota.sh 的统计维度）。 */
export interface QuotaSummary {
  /** 纳入统计的账号数（有剩余额度数据的账号）。 */
  accountCount: number;
  /** 查询失败/无令牌的账号数（不计入额度统计）。 */
  failedCount: number;
  /** 总额剩余额度。 */
  totalRemaining: number;
  /** 平均剩余额度（accountCount 为 0 时 0）。 */
  averageRemaining: number;
  /** 最小剩余额度（accountCount 为 0 时 null）。 */
  minRemaining: number | null;
  /** 最大剩余额度（accountCount 为 0 时 null）。 */
  maxRemaining: number | null;
}

/** 批量查询结果：逐账号快照 + 汇总。 */
export interface QuotaBatchResult {
  results: AccountQuotaSnapshot[];
  summary: QuotaSummary;
}

/** 批量查询的默认并发上限（对齐 codebuddy2api getAccountStatus 的分片大小 4）。 */
export const QUOTA_BATCH_CONCURRENCY = 4;

/**
 * 限流并发映射：保持输入顺序，最多 limit 个任务在飞。
 * 批量查额度是纯读的上游查询，既要快又不能把上游打急——4 是 codebuddy2api
 * 实测采用的分片大小，这里沿用。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  // 按下标写入保持输入顺序；不用 new Array(n)（lint: no-new-array）。
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 汇总统计：只统计 status=ok 且 remaining 非 null 的账号。
 * 平均保留一位小数（与 check_quota.sh 的 toFixed(1) 一致）。
 */
export function summarizeQuotaSnapshots(
  snapshots: readonly AccountQuotaSnapshot[],
): QuotaSummary {
  const remainingValues = snapshots
    .filter((item) => item.status === "ok" && item.remaining !== null)
    .map((item) => item.remaining as number);
  const failedCount = snapshots.filter(
    (item) => item.status !== "ok" || item.remaining === null,
  ).length;
  const totalRemaining = remainingValues.reduce((sum, value) => sum + value, 0);
  return {
    accountCount: remainingValues.length,
    failedCount,
    totalRemaining,
    averageRemaining: remainingValues.length
      ? Number((totalRemaining / remainingValues.length).toFixed(1))
      : 0,
    minRemaining: remainingValues.length ? Math.min(...remainingValues) : null,
    maxRemaining: remainingValues.length ? Math.max(...remainingValues) : null,
  };
}
