import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  ModelUsageDetailsQueryInput,
  ModelUsageDetailsQueryResult,
  ModelUsageDetailsRow,
  UsageStatus,
} from "@zcode/contracts";
import type { SessionId } from "@zcode/contracts";

/**
 * 「使用详情」查询：model_usage 表的逐请求视图。
 *
 * 与 9router 的 `requestDetails` 表同语义，但 XCode 的 model_usage 字段更全
 * （provider/model/status/耗时/TTFT/tokens/缓存/错误），且不存请求响应正文——
 * 详情页只展示元数据，避免把会话内容泄露到设置页。
 */
export async function queryModelUsageDetails(
  db: DatabaseSync,
  input: ModelUsageDetailsQueryInput,
): Promise<ModelUsageDetailsQueryResult> {
  const page = Math.max(1, Math.trunc(input.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize) || 20));

  const conditions: string[] = [];
  const params: SQLInputValue[] = [];
  if (typeof input.since === "number") {
    conditions.push("started_at >= ?");
    params.push(input.since);
  }
  if (typeof input.until === "number") {
    conditions.push("started_at <= ?");
    params.push(input.until);
  }
  if (input.providerId) {
    conditions.push("provider_id = ?");
    params.push(input.providerId);
  }
  if (input.modelId) {
    conditions.push("model_id = ?");
    params.push(input.modelId);
  }
  if (input.sessionId) {
    conditions.push("session_id = ?");
    params.push(input.sessionId);
  }
  if (input.status) {
    conditions.push("status = ?");
    params.push(input.status);
  }
  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const countRow = db
    .prepare(`select count(*) as c from model_usage ${where}`)
    .get(...params) as { c: number } | undefined;
  const totalItems = countRow?.c ?? 0;
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      `select
         id,
         session_id as sessionId,
         turn_id as turnId,
         provider_id as providerId,
         model_id as modelId,
         variant as reasoningLevel,
         agent,
         mode,
         status,
         started_at as startedAt,
         completed_at as completedAt,
         duration_ms as durationMs,
         time_to_first_token_ms as timeToFirstTokenMs,
         finish_reason as finishReason,
         tool_call_count as toolCallCount,
         input_tokens as inputTokens,
         output_tokens as outputTokens,
         reasoning_tokens as reasoningTokens,
         cache_creation_input_tokens as cacheCreationInputTokens,
         cache_read_input_tokens as cacheReadInputTokens,
         computed_total_tokens as computedTotalTokens,
         retry_count as retryCount,
         context_exceeded as contextExceeded,
         error_type as errorType,
         error_code as errorCode,
         error_message as errorMessage,
         provider_metadata_json as providerMetadata
       from model_usage
       ${where}
       order by started_at desc, id desc
       limit ? offset ?`,
    )
    .all(...params, pageSize, offset) as Array<Record<string, unknown>>;

  const details: ModelUsageDetailsRow[] = rows.map((row) => ({
    id: String(row.id ?? ""),
    sessionId: String(row.sessionId ?? "") as SessionId,
    ...(row.turnId ? { turnId: String(row.turnId) } : {}),
    providerId: String(row.providerId ?? ""),
    modelId: String(row.modelId ?? ""),
    ...(row.reasoningLevel ? { reasoningLevel: String(row.reasoningLevel) } : {}),
    ...(row.agent ? { agent: String(row.agent) } : {}),
    ...(row.mode ? { mode: String(row.mode) } : {}),
    status: (row.status as UsageStatus) ?? "completed",
    startedAt: numberOr(row.startedAt, 0),
    ...(typeof row.completedAt === "number" ? { completedAt: row.completedAt } : {}),
    ...(typeof row.durationMs === "number" ? { durationMs: row.durationMs } : {}),
    ...(typeof row.timeToFirstTokenMs === "number"
      ? { timeToFirstTokenMs: row.timeToFirstTokenMs }
      : {}),
    ...(row.finishReason ? { finishReason: String(row.finishReason) } : {}),
    ...(typeof row.toolCallCount === "number" ? { toolCallCount: row.toolCallCount } : {}),
    ...(typeof row.inputTokens === "number" ? { inputTokens: row.inputTokens } : {}),
    ...(typeof row.outputTokens === "number" ? { outputTokens: row.outputTokens } : {}),
    ...(typeof row.reasoningTokens === "number" ? { reasoningTokens: row.reasoningTokens } : {}),
    ...(typeof row.cacheCreationInputTokens === "number"
      ? { cacheCreationInputTokens: row.cacheCreationInputTokens }
      : {}),
    ...(typeof row.cacheReadInputTokens === "number"
      ? { cacheReadInputTokens: row.cacheReadInputTokens }
      : {}),
    ...(typeof row.computedTotalTokens === "number"
      ? { computedTotalTokens: row.computedTotalTokens }
      : {}),
    ...(typeof row.retryCount === "number" ? { retryCount: row.retryCount } : {}),
    ...(typeof row.contextExceeded === "boolean" ? { contextExceeded: row.contextExceeded } : {}),
    ...(row.errorType ? { errorType: String(row.errorType) } : {}),
    ...(row.errorCode ? { errorCode: String(row.errorCode) } : {}),
    ...(row.errorMessage ? { errorMessage: String(row.errorMessage) } : {}),
    ...egressFields(row.providerMetadata),
  }));

  // 可选过滤值按同一时间窗内的全量取值，与当前过滤无关——
  // 否则用户选完 provider 后，provider 下拉会只剩自己。
  const facetConditions: string[] = [];
  const facetParams: SQLInputValue[] = [];
  if (typeof input.since === "number") {
    facetConditions.push("started_at >= ?");
    facetParams.push(input.since);
  }
  if (typeof input.until === "number") {
    facetConditions.push("started_at <= ?");
    facetParams.push(input.until);
  }
  const facetWhere =
    facetConditions.length > 0 ? `where ${facetConditions.join(" and ")}` : "";
  const providerRows = db
    .prepare(
      `select distinct provider_id as providerId from model_usage ${facetWhere} order by provider_id asc`,
    )
    .all(...facetParams) as Array<{ providerId: string | null }>;
  const modelRows = db
    .prepare(`select distinct model_id as modelId from model_usage ${facetWhere} order by model_id asc`)
    .all(...facetParams) as Array<{ modelId: string | null }>;

  return {
    details,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    providers: providerRows.map((row) => row.providerId ?? "").filter(Boolean),
    models: modelRows.map((row) => row.modelId ?? "").filter(Boolean),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 从 providerMetadata（JSON 列）里取账号与出口代理。
 *
 * 这两项由 host 选号时随 requestAuth 下发，core 记进 providerMetadata；
 * 早期记录没有这两个字段，缺失即「未绑定 / 跟随全局」。
 *
 * 注意：`provider_metadata_json` 是 TEXT 列，SQLite 读出来是**字符串**。之前这里只判对象，
 * 字符串一律被当成「没有元数据」，导致库里有 accountDisplayName / proxyDisplayName
 * 时「使用详情」仍显示 `--`。解析失败按缺省处理，不能让一条坏历史记录打挂整页。
 */
function egressFields(providerMetadata: unknown): Partial<ModelUsageDetailsRow> {
  const record = parseProviderMetadata(providerMetadata);
  if (!record) return {};
  const accountId = typeof record.accountId === "string" ? record.accountId : undefined;

  const accountDisplayName =
    typeof record.accountDisplayName === "string" ? record.accountDisplayName : undefined;
  const proxyPoolId = typeof record.proxyPoolId === "string" ? record.proxyPoolId : undefined;
  const proxyDisplayName =
    typeof record.proxyDisplayName === "string" ? record.proxyDisplayName : undefined;
  return {
    ...(accountId ? { accountId } : {}),
    ...(accountDisplayName ? { accountDisplayName } : {}),
    ...(proxyPoolId ? { proxyPoolId } : {}),
    ...(proxyDisplayName ? { proxyDisplayName } : {}),
  };
}

/** provider_metadata_json 可能是对象（内存路径）或 JSON 文本（SQLite TEXT 列）。 */
function parseProviderMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}
