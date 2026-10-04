import type { ProviderApiType } from "@zcode/provider";
import type { UpstreamModelListResult } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";

/**
 * XCode fork：自定义供应商"从上游拉取模型列表"的 Host 侧 HTTP 实现。
 *
 * 与 testModelConnectivity 不同，拉取发生在模型保存之前，无法复用 Model 执行链，
 * 因此由 Host 直接发 GET {baseUrl}/models（OpenAI 兼容事实标准，Anthropic 官方
 * 也提供同形端点）。网络出口复用 hostApiNetworkTransport（自带代理与 CA 设置）。
 */

export interface UpstreamModelListRequest {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiType: ProviderApiType;
  readonly headers?: Readonly<Record<string, string>>;
}

export type ProviderSettingsUpstreamModelsFetcher = (
  input: UpstreamModelListRequest,
) => Promise<UpstreamModelListResult>;

const UPSTREAM_MODELS_TIMEOUT_MS = 15_000;
const ANTHROPIC_VERSION_HEADER = "2023-06-01";
const MAX_UPSTREAM_MODELS = 500;

const log = createServiceLogger("upstream-model-list");

/** 拼接 models 端点：去掉尾部斜杠；anthropic-messages 且未带 /v1 时补版本段。 */
export function resolveUpstreamModelsUrl(baseUrl: string, apiType: ProviderApiType): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (apiType === "anthropic-messages" && !/\/v\d+$/.test(trimmed)) {
    return `${trimmed}/v1/models`;
  }
  return `${trimmed}/models`;
}

function buildAuthHeaders(input: UpstreamModelListRequest): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.apiType === "anthropic-messages") {
    if (input.apiKey) headers["x-api-key"] = input.apiKey;
    headers["anthropic-version"] = ANTHROPIC_VERSION_HEADER;
  } else if (input.apiKey) {
    headers.Authorization = `Bearer ${input.apiKey}`;
  }
  // 供应商自定义 headers 优先级最高，允许覆盖上面推导的鉴权头。
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (typeof value === "string" && value.trim()) headers[key] = value;
  }
  return headers;
}

/** 从常见响应形状提取模型 ID：{data:[{id}]}（OpenAI/Anthropic）、裸数组、{models:[...]}。 */
export function extractUpstreamModelIds(payload: unknown): string[] | null {
  const candidates: unknown[] = (() => {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      if (Array.isArray(record.data)) return record.data;
      if (Array.isArray(record.models)) return record.models;
    }
    return [];
  })();
  if (candidates.length === 0) {
    // 形状不认识与空列表要区分：前者是 invalid-response，后者是正常空结果。
    const isEmptyButRecognized =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? "data" in (payload as object) || "models" in (payload as object)
        : Array.isArray(payload);
    return isEmptyButRecognized ? [] : null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    const id =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
          ? ((item as Record<string, unknown>).id as string).trim()
          : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_UPSTREAM_MODELS) break;
  }
  return ids;
}

export function createUpstreamModelListFetcher(deps: {
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): ProviderSettingsUpstreamModelsFetcher {
  const timeoutMs = deps.timeoutMs ?? UPSTREAM_MODELS_TIMEOUT_MS;
  return async (input) => {
    let url: string;
    try {
      url = resolveUpstreamModelsUrl(input.baseUrl, input.apiType);
      // 提前校验 URL 合法性，避免 fetch 抛出难以归类的 TypeError。
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          success: false,
          error: { code: "endpoint-unavailable", message: `Unsupported protocol: ${parsed.protocol}` },
        };
      }
    } catch {
      return {
        success: false,
        error: { code: "endpoint-unavailable", message: `Invalid base URL: ${input.baseUrl}` },
      };
    }

    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: "GET",
        headers: buildAuthHeaders(input),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof Error && error.name === "TimeoutError";
      const message = error instanceof Error ? error.message : String(error);
      log.warn(undefined, "upstream models request failed", { url, timeout: isTimeout });
      // 不把原始网络错误细节透传到 UI 之外，避免携带内部地址。
      return {
        success: false,
        error: {
          code: isTimeout ? "timeout" : "network",
          message: isTimeout ? `Request timed out after ${timeoutMs}ms` : message,
        },
      };
    }

    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "auth" : "server";
      return {
        success: false,
        error: { code, message: `Upstream responded ${response.status} ${response.statusText}` },
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        success: false,
        error: { code: "invalid-response", message: "Upstream response is not valid JSON" },
      };
    }

    const models = extractUpstreamModelIds(payload);
    if (!models) {
      return {
        success: false,
        error: {
          code: "invalid-response",
          message: "Unrecognized response shape; expected { data: [{ id }] }, { models: [...] } or an array",
        },
      };
    }
    return { success: true, models };
  };
}
