import type { ProviderApiType } from "@zcode/provider";
import type { UpstreamModelEntry, UpstreamModelListResult } from "@zcode/shared";
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

/**
 * 从常见响应形状提取模型 ID：{data:[{id}]}（OpenAI/Anthropic）、裸数组、{models:[...]}。
 * 同时 best-effort 提取每个模型的 contextWindow / maxOutputTokens 元数据；
 * 形状不认识返回 null（区别于空列表）。
 */
export function extractUpstreamModelIds(payload: unknown): {
  ids: string[];
  entries: UpstreamModelEntry[];
} | null {
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
    return isEmptyButRecognized ? { ids: [], entries: [] } : null;
  }
  const ids: string[] = [];
  const entries: UpstreamModelEntry[] = [];
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
    // 上游元数据 best-effort：各网关字段名不一（OpenRouter context_window /
    // vLLM max_model_len 等），只收录正整数；缺失即不覆盖系统默认。
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const nested = record.metadata as Record<string, unknown> | undefined;
      const pickInt = (...keys: string[]): number | undefined => {
        for (const key of keys) {
          const value = record[key] ?? nested?.[key];
          if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            return Math.round(value);
          }
        }
        return undefined;
      };
      const contextWindow = pickInt(
        "context_window",
        "max_model_len",
        "context_length",
        "max_context_length",
        "contextWindow",
      );
      const maxOutputTokens = pickInt(
        "max_output_tokens",
        "max_completion_tokens",
        "maxOutputTokens",
      );
      if (contextWindow !== undefined || maxOutputTokens !== undefined) {
        entries.push({
          id,
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
        });
      }
    }
    if (ids.length >= MAX_UPSTREAM_MODELS) break;
  }
  return { ids, entries };
}

// ---------------------------------------------------------------------------
// XCode fork：models.dev 元数据补齐（仅 OpenCode Zen 免费档）
//
// OpenCode 官方客户端的模型上下文/最大输出来自 models.dev 的 "opencode-zen"
// 目录（其自有 /models 端点不带这些字段）。导入时按模型 ID 从该目录补齐
// contextWindow / maxOutputTokens，使导入值与官方客户端显示一致。
// ---------------------------------------------------------------------------

const MODELS_DEV_API_URL = "https://models.dev/api.json";
// models.dev 上 OpenCode Zen 免费档所在目录的 key（注意不是 opencode-go）。
const MODELS_DEV_PROVIDER_ID = "opencode";
const MODELS_DEV_CACHE_TTL_MS = 60 * 60 * 1000;

interface ModelsDevModelLimit {
  context?: number;
  output?: number;
}

interface ModelsDevProvider {
  models?: Record<string, { limit?: ModelsDevModelLimit }>;
}

type ModelsDevDatabase = Record<string, ModelsDevProvider>;

let modelsDevCache: { at: number; db: ModelsDevDatabase } | null = null;

async function loadModelsDevDatabase(fetchImpl: typeof globalThis.fetch): Promise<ModelsDevDatabase | null> {
  if (modelsDevCache && Date.now() - modelsDevCache.at < MODELS_DEV_CACHE_TTL_MS) {
    return modelsDevCache.db;
  }
  try {
    const response = await fetchImpl(MODELS_DEV_API_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const db = parsed as ModelsDevDatabase;
    modelsDevCache = { at: Date.now(), db };
    return db;
  } catch (error) {
    log.warn(undefined, "models.dev metadata fetch failed (best-effort)", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 用 models.dev 的 opencode-zen 目录补齐缺失的 contextWindow / maxOutputTokens。 */
async function mergeModelsDevOpencodeZenEntries(
  ids: readonly string[],
  existing: readonly UpstreamModelEntry[],
  fetchImpl: typeof globalThis.fetch,
): Promise<UpstreamModelEntry[]> {
  const db = await loadModelsDevDatabase(fetchImpl);
  if (!db) return [...existing];
  const provider = db[MODELS_DEV_PROVIDER_ID];
  if (!provider?.models) return [...existing];

  const byId = new Map<string, UpstreamModelEntry>();
  for (const entry of existing) byId.set(entry.id, entry);
  for (const id of ids) {
    const upstream = provider.models[id]?.limit;
    if (!upstream) continue;
    const current = byId.get(id) ?? { id };
    const merged: UpstreamModelEntry = {
      id,
      contextWindow: current.contextWindow ?? (typeof upstream.context === "number" && upstream.context > 0 ? upstream.context : undefined),
      maxOutputTokens: current.maxOutputTokens ?? (typeof upstream.output === "number" && upstream.output > 0 ? upstream.output : undefined),
    };
    byId.set(id, merged);
  }
  return ids
    .map((id) => byId.get(id))
    .filter((entry): entry is UpstreamModelEntry => Boolean(entry));
}

export function createUpstreamModelListFetcher(deps: {
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): ProviderSettingsUpstreamModelsFetcher {  const timeoutMs = deps.timeoutMs ?? UPSTREAM_MODELS_TIMEOUT_MS;
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

    const extracted = extractUpstreamModelIds(payload);
    if (!extracted) {
      return {
        success: false,
        error: {
          code: "invalid-response",
          message: "Unrecognized response shape; expected { data: [{ id }] }, { models: [...] } or an array",
        },
      };
    }
    // XCode fork：OpenCode Zen 的 /models 不带上下文元数据，而官方客户端从 models.dev
    // 的 "opencode-zen" 目录读取真实 contextWindow/output。仅对 opencode.ai 系 baseUrl
    // 做 best-effort 补齐（models.dev 不可达时静默跳过，不影响导入）。
    let entries = extracted.entries;
    if (/opencode\.ai/i.test(input.baseUrl)) {
      entries = await mergeModelsDevOpencodeZenEntries(extracted.ids, entries, deps.fetch);
    }
    return {
      success: true,
      models: extracted.ids,
      ...(entries.length > 0 ? { entries } : {}),
    };
  };
}
