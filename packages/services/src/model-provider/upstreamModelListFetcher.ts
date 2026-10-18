import type { ProviderApiType } from "@zcode/provider";
import type { UpstreamModelEntry, UpstreamModelListResult } from "@zcode/shared";
import { isOffReasoningLevel, sortReasoningLevelsByIntensity } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { providerFetch } from "../providers/api/providerNetwork.js";
import { fetchQoderUpstreamModels, type QoderUpstreamRegion } from "./qoderUpstreamModels.js";
import { fetchCodeBuddyUpstreamModels } from "./codebuddyUpstreamModels.js";

/**
 * XCode fork：自定义供应商"从上游拉取模型列表"的 Host 侧 HTTP 实现。
 *
 * 与 testModelConnectivity 不同，拉取发生在模型保存之前，无法复用 Model 执行链，
 * 因此由 Host 直接发 GET {baseUrl}/models（OpenAI 兼容事实标准，Anthropic 官方
 * 也提供同形端点）。网络出口按 providerId 解析：配置了代理池的供应商走池
 * （见 providers/api/providerPoolFetch.ts），否则跟随全局代理状态。
 */

export interface UpstreamModelListRequest {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly apiType: ProviderApiType;
  readonly headers?: Readonly<Record<string, string>>;
  /** XCode fork：requestProfile=qoder 时走 COSY 签名的模型目录端点。 */
  readonly requestProfile?: string;
  /**
   * XCode fork：发起本次拉取的供应商 id，用于解析该供应商的代理池绑定。
   * 不传时退回 deps.fetch（= 全局代理链），保持既有测试装配与旧调用点行为不变。
   */
  readonly providerId?: string;
  /** XCode fork：对应账号 id（多账号供应商），用于账号级代理绑定。 */
  readonly accountId?: string;
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

/**
 * models.dev 的推理能力声明。实测（2026-10-12 抓 models.dev/api.json 的 `opencode` 目录）
 * 每个模型都有 `reasoning: boolean`，可选的 `reasoning_options` 是一个**数组**，
 * 元素形态互斥或并存：
 *   - `{type:"effort", values:[...]}`          —— 离散档位，这是我们要的
 *   - `{type:"toggle"}`                        —— 只有开/关两态（GLM/Kimi/Qwen 系）
 *   - `{type:"budget_tokens", min|max}`        —— 思考 token 预算，与档位正交
 *   - `[]` / `null`                            —— 有 thinking 但无可调档位 / 不支持 thinking
 * 只有 `effort` 形态能给出档位；`toggle` 形态回落到「关闭/启用」两档。
 */
interface ModelsDevReasoningOption {
  type?: string;
  values?: string[];
}

interface ModelsDevModel {
  limit?: ModelsDevModelLimit;
  reasoning?: boolean;
  reasoning_options?: ModelsDevReasoningOption[] | null;
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
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

/**
 * 从 models.dev 的推理声明里取出该模型的可选档位（已按强度升序）。
 *
 * 与 Qoder/CodeBuddy 不同，这里**上游没有为 OpenCode 提供档位端点**：
 * 实测 `opencode.ai/inference/v1/models` 的响应只有 `{id, object, created, owned_by}`，
 * 官方客户端的档位信息同样来自 models.dev，所以这是同一份上游事实、同一来源。
 *
 * 取值规则（依据 reasoning_options 的三种实测形态）：
 *   - `reasoning !== true`（trinity-large-preview-free / ling-2.6-flash-free）
 *     → 模型不支持思考，返回 undefined：让导入流程不写 reasoningLevel，
 *       思考强度选择器不出现，而不是给一个必然无效的档位表。
 *   - 出现 `{type:"effort", values:[...]}` → 用它的 values。这才是真正的动态档位来源
 *     （space-bunny-free = low/medium/high/xhigh/max、hy3-free = low/medium/high、
 *      fledge-alpha-free = low/high/max、kimi-k3 = 仅 max、exo-free = 仅 high）。
 *   - 只有 `{type:"toggle"}`（GLM-5 系 / Qwen3.8-Max / Kimi 系）
 *     → 上游只声明开关，映射成 `enabled` 一档 + 前端的 `disabled` 关闭档，
 *       与内置静态配置里这些模型的既有取值一致。
 *   - `[]`（minimax-m2.5 系 / mimo 系 / nemotron 系：有 thinking 但未声明任何可调项）
 *     → 同 toggle 处理：`enabled`。给一个上游没承诺的离散档位等于凭空发明。
 *
 * 排序走共享的 `sortReasoningLevelsByIntensity`：上游数组顺序不可信
 * （与 Qoder `Object.keys()` 同一个坑），不排序会把非单调序列写进 optionSpecs。
 */
export function extractModelsDevReasoningEfforts(model: ModelsDevModel | undefined): string[] | undefined {
  if (!model) return undefined;
  if (model.reasoning !== true) return undefined;
  const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : [];
  for (const option of options) {
    if (!option || option.type !== "effort" || !Array.isArray(option.values)) continue;
    const levels = option.values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !isOffReasoningLevel(value));
    if (levels.length > 0) return sortReasoningLevelsByIntensity(levels);
  }
  // 有 thinking 但只声明 toggle（或什么都没声明）：只给「启用」一档。
  return ["enabled"];
}

/**
 * 用 models.dev 的 opencode-zen 目录补齐缺失的 contextWindow / maxOutputTokens，
 * 并按模型给出各自的思考强度档位。
 */
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
    const upstreamModel = provider.models[id];
    // 档位与 limit 相互独立：只要该模型在目录里，就取它的档位（可能没有 limit）。
    const upstream = upstreamModel?.limit;
    const thinkingEfforts = extractModelsDevReasoningEfforts(upstreamModel);
    if (!upstream && !thinkingEfforts) continue;
    const current = byId.get(id) ?? { id };
    const merged: UpstreamModelEntry = {
      id,
      contextWindow: current.contextWindow ?? (typeof upstream?.context === "number" && upstream.context > 0 ? upstream.context : undefined),
      maxOutputTokens: current.maxOutputTokens ?? (typeof upstream?.output === "number" && upstream.output > 0 ? upstream.output : undefined),
      // XCode fork：思考强度档位按 models.dev 该模型自己的声明给出；
      // 显式 spread 省略 undefined，避免给「不支持思考」的模型写出空数组语义。
      ...(thinkingEfforts ? { thinkingEfforts } : {}),
    };
    byId.set(id, merged);
  }
  return ids
    .map((id) => byId.get(id))
    .filter((entry): entry is UpstreamModelEntry => Boolean(entry));
}

/**
 * XCode fork：Qoder 专用分支。COSY 签名需要 userId + machineId，它们由登录
 * 流程写进 provider headers（与执行链读的是同一组内部头）。
 */
async function fetchQoderCatalog(
  input: UpstreamModelListRequest,
  fetchImpl: typeof globalThis.fetch,
): Promise<UpstreamModelListResult> {
  const headers = input.headers ?? {};
  const pick = (name: string): string => {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) return String(value ?? "").trim();
    }
    return "";
  };
  const userId = pick("x-qoder-internal-user-id");
  const machineId = pick("x-qoder-internal-machine-id");
  const accessToken = (input.apiKey ?? "").trim();

  if (!accessToken) {
    return {
      success: false,
      error: { code: "auth", message: "尚未登录 Qoder 账号，无法拉取上游模型" },
    };
  }
  // PAT（pt-）没有可预知的 userId，要等运行时换成 job token 后才拿得到。
  if (!userId && !accessToken.startsWith("pt-")) {
    return {
      success: false,
      error: { code: "auth", message: "Qoder 凭证缺少用户标识，请重新登录账号" },
    };
  }

  const region: QoderUpstreamRegion = /qoder\.com\.cn/i.test(input.baseUrl) ? "cn" : "intl";
  const models = await fetchQoderUpstreamModels({
    region,
    accessToken,
    creds: { userId, authToken: accessToken, machineId },
    fetchImpl,
  });

  if (models.length === 0) {
    return {
      success: false,
      error: {
        code: "invalid-response",
        message: "Qoder 模型目录为空或请求失败（该端点要求 COSY 签名，失败多为凭证或网络问题）",
      },
    };
  }
  const entries: UpstreamModelEntry[] = models.map((model) => ({
    id: model.id,
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    // XCode fork：可读名与倍率透传给导入流程，最终写入 provider overlay。
    ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
    ...(model.priceFactor !== undefined ? { priceFactor: model.priceFactor } : {}),
    ...(model.contextTiers ? { contextTiers: model.contextTiers } : {}),
    ...(model.thinkingEfforts ? { thinkingEfforts: model.thinkingEfforts } : {}),
    ...(model.thinkingDefault !== undefined ? { thinkingDefault: model.thinkingDefault } : {}),
  }));
  return {
    success: true,
    models: models.map((model) => model.id),
    ...(entries.length > 0 ? { entries } : {}),
  };
}

/**
 * XCode fork：CodeBuddy 专用分支。两区都没有 OpenAI 风格的模型列表端点，
 * 官方客户端从 `GET {origin}/v3/config` 取模型选择器数据（agents[].models
 * 为可用名单，models[] 为元数据注册表）。
 */
async function fetchCodeBuddyCatalog(
  input: UpstreamModelListRequest,
  fetchImpl: typeof globalThis.fetch,
): Promise<UpstreamModelListResult> {
  const accessToken = (input.apiKey ?? "").trim();
  if (!accessToken) {
    return {
      success: false,
      error: { code: "auth", message: "尚未登录 CodeBuddy 账号，无法拉取上游模型" },
    };
  }
  let models;
  try {
    models = await fetchCodeBuddyUpstreamModels({
      baseUrl: input.baseUrl,
      accessToken,
      fetchImpl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(undefined, "CodeBuddy upstream model list failed", { message });
    return { success: false, error: { code: "server", message } };
  }
  if (models.length === 0) {
    return {
      success: false,
      error: { code: "invalid-response", message: "CodeBuddy 模型目录为空" },
    };
  }
  const entries: UpstreamModelEntry[] = models.map((model) => ({
    id: model.id,
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
    ...(model.priceFactor !== undefined ? { priceFactor: model.priceFactor } : {}),
    ...(model.contextTiers ? { contextTiers: model.contextTiers } : {}),
    ...(model.thinkingEfforts ? { thinkingEfforts: [...model.thinkingEfforts] } : {}),
    ...(model.thinkingDefault !== undefined ? { thinkingDefault: model.thinkingDefault } : {}),
  }));
  return {
    success: true,
    models: models.map((model) => model.id),
    entries,
  };
}

export function createUpstreamModelListFetcher(deps: {
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}): ProviderSettingsUpstreamModelsFetcher {  const timeoutMs = deps.timeoutMs ?? UPSTREAM_MODELS_TIMEOUT_MS;
  return async (input) => {
    // XCode fork：优先按供应商解析出口（配置了代理池 → 只走池，绕开全局代理）。
    // 没带 providerId 的调用点（含既有测试装配）继续用注入的 deps.fetch。
    // 注意：models.dev 的补充元数据请求仍然用 deps.fetch——那不是供应商流量，
    // 应当跟随全局代理状态，不该占用供应商的池出口。
    const fetchImpl = input.providerId ? providerFetch(input.providerId, input.accountId) : deps.fetch;
    // XCode fork：Qoder 的模型目录不是 `{baseUrl}/models`，而是 COSY 签名的
    // `/algo/api/v2/model/list`。走通用分支会拼出 `.../algo/api/v2/models`——
    // 该端点不存在，恒 404。
    if (input.requestProfile === "qoder") {
      return fetchQoderCatalog(input, fetchImpl);
    }
    if (input.requestProfile === "codebuddy") {
      return fetchCodeBuddyCatalog(input, fetchImpl);
    }

    // XCode fork：OpenCode 免费档的 chat 端点已迁到 /inference/openai/v1，但模型
    // 目录仍在 /inference/v1/models（`{baseUrl}/models` 现在 404）。按 origin 拼。
    let openCodeFreeCatalogUrl: string | undefined;
    if (input.requestProfile === "opencode-free-tier") {
      try {
        openCodeFreeCatalogUrl = new URL("/inference/v1/models", input.baseUrl).toString();
      } catch {
        openCodeFreeCatalogUrl = undefined;
      }
    }

    let url: string;
    try {
      url = openCodeFreeCatalogUrl ?? resolveUpstreamModelsUrl(input.baseUrl, input.apiType);
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
      response = await fetchImpl(url, {
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
    // XCode fork：OpenCode Zen 的 /models 只回 {id, object, created, owned_by}，
    // 既不带上下文元数据也不带思考档位；而官方客户端的上下文与档位同样来自
    // models.dev 的 "opencode" 目录（实测抓包：/models 响应无 reasoning 字段，
    // models.dev/api.json 该目录每模型有 reasoning + reasoning_options）。
    // 因此这里不只补 contextWindow/output，还按模型给出 reasoning_options 里的档位。
    // 仅对 opencode.ai 系 baseUrl 生效（models.dev 不可达时静默跳过，不影响导入）。
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
