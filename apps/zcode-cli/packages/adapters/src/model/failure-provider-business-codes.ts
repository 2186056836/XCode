/* oxlint-disable max-lines -- 各 provider 的业务码行为语义必须集中登记在同一张表里，拆文件会让人漏看已有的码语义；待业务码引入 provider 维度后再按厂商拆分。 */
import {
  ModelErrorCode,
  ModelFailureReason as ModelFailureReasonValue,
  ModelRetryReason as ModelRetryReasonValue,
  type ModelErrorCode as ModelErrorCodeType,
  type ModelFailureReason,
  type ModelRetryReason,
} from "@zcode/contracts";
import { isNetworkFailure, isTimeoutFailure } from "./failure-inspection.js";
import type { ProviderBusinessError } from "./model-execution.js";

interface ProviderBusinessCodeMapping {
  code: ModelErrorCodeType;
  message?: string;
  reason: ModelFailureReason;
  retryReason: ModelRetryReason;
  retryable: boolean;
}

// 部分 OpenAI-compatible provider 会把可恢复的上游网络故障包装成业务码。
const PROVIDER_NETWORK_BUSINESS_CODES = new Set(["1234"]);
const PROVIDER_INTERNAL_NETWORK_MESSAGES = new Set([
  "500 internal network error",
  "internal network error",
  "internal network failure",
]);

const TERMINAL_RATE_LIMIT_MAPPING: ProviderBusinessCodeMapping = {
  code: ModelErrorCode.ModelRateLimited,
  reason: ModelFailureReasonValue.RateLimited,
  retryReason: ModelRetryReasonValue.RateLimited,
  retryable: false,
};
const TERMINAL_BUSINESS_MAPPING: ProviderBusinessCodeMapping = {
  code: ModelErrorCode.ModelRequestFailed,
  reason: ModelFailureReasonValue.Unknown,
  retryReason: ModelRetryReasonValue.NetworkError,
  retryable: false,
};
const RETRYABLE_RATE_LIMIT_MAPPING: ProviderBusinessCodeMapping = {
  code: ModelErrorCode.ModelRateLimited,
  reason: ModelFailureReasonValue.RateLimited,
  retryReason: ModelRetryReasonValue.RateLimited,
  retryable: true,
};
const RETRYABLE_OVERLOAD_MAPPING: ProviderBusinessCodeMapping = {
  code: ModelErrorCode.ModelRequestFailed,
  reason: ModelFailureReasonValue.ProviderOverloaded,
  retryReason: ModelRetryReasonValue.ProviderOverloaded,
  retryable: true,
};

const PROVIDER_BUSINESS_CODE_MAPPINGS = new Map<string, ProviderBusinessCodeMapping>([
  [
    "500",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.ServerError,
      retryReason: ModelRetryReasonValue.ServerError,
      retryable: true,
    },
  ],
  [
    "1006",
    {
      code: ModelErrorCode.ProviderNotConfigured,
      reason: ModelFailureReasonValue.AuthFailed,
      retryReason: ModelRetryReasonValue.AuthRefresh,
      retryable: false,
    },
  ],
  [
    "1005",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.InvalidRequest,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
    },
  ],
  [
    "3006",
    {
      code: ModelErrorCode.ModelNotFound,
      reason: ModelFailureReasonValue.InvalidRequest,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
    },
  ],
  [
    "3001",
    {
      code: ModelErrorCode.InvalidModelRequest,
      reason: ModelFailureReasonValue.InvalidRequest,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
    },
  ],
  [
    "3007",
    {
      code: ModelErrorCode.InvalidModelRequest,
      reason: ModelFailureReasonValue.AuthFailed,
      retryReason: ModelRetryReasonValue.AuthRefresh,
      retryable: false,
    },
  ],
  // 3008/3009/3010：并发上限，与配额耗尽 1005 类似但不走 refresh-quota，而是走升级横幅。
  [
    "3008",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: false,
    },
  ],
  [
    "3009",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: false,
    },
  ],
  // 3010：当前模型并发上限。保留为非自动重试的 rate limited，由 UI 引导切换模型或升级。
  [
    "3010",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: false,
    },
  ],
  // BigModel 文档里的恢复类错误需要显式入表；同时把 1261 标成超窗，
  // 长期配额、套餐权限、公平使用限制和 provider 明确终止型业务码则显式终止，避免 generic 429 兜底误重试。
  [
    "1120",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.ServerError,
      retryReason: ModelRetryReasonValue.ServerError,
      retryable: true,
    },
  ],
  [
    "1230",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.ServerError,
      retryReason: ModelRetryReasonValue.ServerError,
      retryable: true,
    },
  ],
  [
    "1234",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.NetworkError,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: true,
    },
  ],
  [
    "1261",
    {
      code: ModelErrorCode.ModelContextExceeded,
      reason: ModelFailureReasonValue.ContextExceeded,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
    },
  ],
  [
    "1113",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.Unknown,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
    },
  ],
  [
    "1302",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: true,
    },
  ],
  [
    "1303",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: true,
    },
  ],
  [
    "1305",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: true,
    },
  ],
  [
    "1304",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: false,
    },
  ],
  [
    "1308",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: false,
    },
  ],
  [
    "1309",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.Unknown,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
    },
  ],
  [
    "1310",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: false,
    },
  ],
  [
    "1311",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.Unknown,
      retryReason: ModelRetryReasonValue.NetworkError,
      retryable: false,
    },
  ],
  [
    "1312",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.ProviderOverloaded,
      retryReason: ModelRetryReasonValue.ProviderOverloaded,
      retryable: true,
    },
  ],
  [
    "1313",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: false,
    },
  ],
  [
    "3002",
    {
      code: ModelErrorCode.ModelRateLimited,
      reason: ModelFailureReasonValue.RateLimited,
      retryReason: ModelRetryReasonValue.RateLimited,
      retryable: true,
    },
  ],
  [
    "2007",
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReasonValue.ServerError,
      retryReason: ModelRetryReasonValue.ServerError,
      retryable: true,
    },
  ],
]);

// 这些 code 均来自 provider 官方文档，且语义需要用户充值、调整套餐或等待长期额度重置。
// 只消费 AI SDK / 既有 ProviderBusinessError 已暴露的 code，不在这里解析厂商原始 response 字段。
// insufficient_quota 曾落入通用 429 重试；其终止语义不能再依赖 Retry-After 时长。
for (const code of [
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "exceeded_current_quota_error",
  "2056",
  "20097",
  "1316",
  "1317",
  "1318",
  "1319",
  "1320",
  "1321",
]) {
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, TERMINAL_RATE_LIMIT_MAPPING);
}

for (const code of ["1008", "1314", "1315"]) {
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, TERMINAL_BUSINESS_MAPPING);
}

for (const code of ["rate_limit_reached_error", "rate_limit_error"]) {
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, RETRYABLE_RATE_LIMIT_MAPPING);
}

for (const code of ["engine_overloaded_error", "overloaded_error"]) {
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, RETRYABLE_OVERLOAD_MAPPING);
}

// XCode fork: Qoder 业务码。
// Qoder 把失败藏在 HTTP 200 的 SSE 信封里（外层 statusCodeValue 常为 200，
// 真实错误在 body 的 {"error":{"code":...}}），由 qoderProtocol 提取后以标准
// SSE error 帧外抛。这里只登记**行为语义**（是否重试、归因到哪类失败），
// 不登记文案——错误文案一律保持上游原文。
for (const code of ["110", "112"]) {
  // 110 = 当日调用次数用尽（次日零点恢复）；112 = 账号可用额度见底。
  // 两者都要等长期额度重置，重试无意义。
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, TERMINAL_RATE_LIMIT_MAPPING);
}

for (const code of ["406", "416"]) {
  // 内容安全策略拒绝（intention_rejected）。换号、重试都会被同样拦下，
  // 属请求侧问题。
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, TERMINAL_BUSINESS_MAPPING);
}

// 排队/算力紧张，属可恢复的瞬时拥塞。
PROVIDER_BUSINESS_CODE_MAPPINGS.set("10605", RETRYABLE_RATE_LIMIT_MAPPING);

// XCode fork: Qoder 的 HTTP 状态语义码。
// 上游对限流/额度耗尽一律只报通用 `provider_error`（实测 429 +
// {"code":"provider_error","message":"All backends failed"}），语义全丢，
// 上层只能降级成 reason=unknown、retryable=false——用户看到的是一句
// 无从下手的 "All backends failed"。qoderProtocol 会把信封状态码映射成
// 下面这些标准码，这里登记其行为语义。
for (const code of ["rate_limit_exceeded", "rate_limit_error", "rate_limited"]) {
  // 429：模型级并发/配额限流。Qoder 实测同一账号换模型即可成功，
  // 属可恢复，标 retryable 让上层重试/降级而不是直接判死。
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, RETRYABLE_RATE_LIMIT_MAPPING);
}

for (const code of ["insufficient_quota", "quota_exceeded"]) {
  // 402/403：额度耗尽。要等计费周期重置，重试无意义。
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, TERMINAL_RATE_LIMIT_MAPPING);
}

PROVIDER_BUSINESS_CODE_MAPPINGS.set(
  "invalid_api_key",
  // 401：凭证过期。重试同样是 401，必须走重新登录（AuthRefresh 语义）。
  {
    code: ModelErrorCode.ModelRequestFailed,
    reason: ModelFailureReasonValue.AuthFailed,
    retryReason: ModelRetryReasonValue.AuthRefresh,
    retryable: false,
  },
);

for (const code of ["upstream_unavailable", "upstream_error"]) {
  // 5xx 网关故障：典型可恢复。
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, {
    code: ModelErrorCode.ModelRequestFailed,
    reason: ModelFailureReasonValue.ServerError,
    retryReason: ModelRetryReasonValue.ServerError,
    retryable: true,
  });
}

// XCode fork: CodeBuddy 业务码。
// CodeBuddy 网关（Intl=www.codebuddy.ai / CN=copilot.tencent.com）用 5 位数字业务码：
//   11128 = 网关判定请求非法（客户端指纹不匹配或缺头，实测 HTTP 400）；
//   12403 = UA 校验失败（UA 里必须能解析出客户端版本；/v3/config 与聊天网关共用该码）；
//   11217 = 待授权（登录轮询语义，落到请求层表示账号授权未完成）。
// 三者都不是可重试的瞬时故障：原样重发会被同样拒绝，登记为终止语义，避免上层把
// 重试预算/额度浪费在必然失败的请求上；同时把 400 以外的状态（12403/11217 也可能
// 以 200 信封或 403 返回）从通用分支里择出来——否则会被归因成 AuthFailed，
// 引导用户去做无效的重新登录。
const TERMINAL_CLIENT_REJECTION_MAPPING: ProviderBusinessCodeMapping = {
  code: ModelErrorCode.InvalidModelRequest,
  reason: ModelFailureReasonValue.InvalidRequest,
  retryReason: ModelRetryReasonValue.NetworkError,
  retryable: false,
};

for (const code of ["11128", "12403"]) {
  PROVIDER_BUSINESS_CODE_MAPPINGS.set(code, TERMINAL_CLIENT_REJECTION_MAPPING);
}

PROVIDER_BUSINESS_CODE_MAPPINGS.set("11217", {
  // 账号授权未完成：重试无用，必须重新登录并完成授权（AuthRefresh 语义）。
  code: ModelErrorCode.ProviderNotConfigured,
  reason: ModelFailureReasonValue.AuthFailed,
  retryReason: ModelRetryReasonValue.AuthRefresh,
  retryable: false,
});

export function getProviderBusinessCodeMapping(
  providerCode: string,
): ProviderBusinessCodeMapping | undefined {
  return PROVIDER_BUSINESS_CODE_MAPPINGS.get(providerCode);
}

export function isRetryableProviderBusinessNetworkFailure(
  error: ProviderBusinessError,
  providerCode: string | undefined,
): boolean {
  if (providerCode) {
    // AI SDK 的 SSE error chunk 会把底层 ECONNRESET 包进 ProviderBusinessError.providerCode。
    // 这本质仍是传输层断连，必须沿用网络错误重试语义，而不是落成 unknown。
    if (isNetworkFailure(providerCode)) {
      return true;
    }
    if (PROVIDER_NETWORK_BUSINESS_CODES.has(providerCode)) {
      return true;
    }

    const normalizedCode = providerCode.toLowerCase();
    if (normalizedCode === "network_error" || normalizedCode === "network_error_retryable") {
      return true;
    }
  }

  return isProviderBusinessInternalNetworkFailure(error);
}

export function isRetryableProviderBusinessTimeoutFailure(
  error: ProviderBusinessError,
  providerCode: string | undefined,
  statusCode?: number,
): boolean {
  // AI SDK/SSE error chunk 可能把底层 headers/body timeout 包进 ProviderBusinessError.providerCode。
  // 这类错误没有真正的 provider 业务语义，必须保留普通 timeout 的可重试语义。
  return isTimeoutFailure(
    error,
    providerCode,
    statusCode ?? error.statusCode ?? error.responseStatus,
  );
}

function isProviderBusinessInternalNetworkFailure(error: ProviderBusinessError): boolean {
  if (readResponseBodyErrorType(error.responseBodySummary) !== "api_error") {
    return false;
  }

  const normalizedMessage =
    normalizeProviderMessage(error.providerMessage) ??
    normalizeProviderMessage(error.message) ??
    normalizeProviderMessage(readResponseBodyErrorMessage(error.responseBodySummary));
  return normalizedMessage ? PROVIDER_INTERNAL_NETWORK_MESSAGES.has(normalizedMessage) : false;
}

function readResponseBodyErrorType(summary: unknown): string | undefined {
  return normalizeProviderMessage(asRecord(asRecord(summary).error).type);
}

function readResponseBodyErrorMessage(summary: unknown): string | undefined {
  return stringValue(asRecord(asRecord(summary).error).message);
}

function normalizeProviderMessage(value: unknown): string | undefined {
  const text = stringValue(value)?.trim().toLowerCase();
  return text && text.length > 0 ? text : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
