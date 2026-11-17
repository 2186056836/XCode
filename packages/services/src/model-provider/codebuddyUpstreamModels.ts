import { randomUUID } from "node:crypto";
import { sortReasoningLevelsByIntensity } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { describeCodeBuddyAccessToken } from "./codebuddyAuth.js";

/**
 * XCode fork：CodeBuddy 上游模型目录（host 侧专用）。
 *
 * CodeBuddy 两区（CN=copilot.tencent.com，Intl=www.codebuddy.ai）都没有
 * `{baseUrl}/models` 这类 OpenAI 列表端点（实测恒 404）；官方客户端的模型
 * 选择器数据来自 `GET {origin}/v3/config`：
 *   - `data.agents[]`：各 agent 的可用模型名单（选 tags 含 "default" 的 cli agent）；
 *   - `data.models[]`：完整注册表——可读名、credits 倍率、上下文档位
 *     （contextWindow.supportedLengths）、思考档位（reasoning.supportedEfforts）、
 *     上下文/输出上限。
 *
 * 请求必须带 `X-User-Id`（访问令牌 JWT 的 sub）与 `X-Request-ID`，其余头与
 * 聊天网关一致。返回形状与 Qoder 目录对齐（displayName/priceFactor/
 * contextTiers/thinkingEfforts），导入链路可直接复用。
 *
 * 本模块只被 upstreamModelListFetcher（host）引用，不进 renderer bundle，
 * 可放心使用 node:crypto。
 */

const log = createServiceLogger("codebuddy-upstream-models");

const CONFIG_PATH = "/v3/config";
const REQUEST_TIMEOUT_MS = 20_000;

// /v3/config 有 UA 校验（12403 "check ua"）：UA 里必须能解析出客户端版本。
// 更关键的是：**该端点对不同 UA 下发不同模型集合**（我们与 workbuddy2api 项目的
// 独立实测一致）：
//   - 桌面端 UA  → 主路，项目 chat 路径实际 UA，字段最全（含 trial/credits）
//   - IDE UA    → 独有 o4-mini / enhance-1.0 / auto-chat 等，**无 deepseek 系列**
//   - CLI UA    → 独有 deepseek-v4.1-flash（免费）/ -flash-sg / gpt-6-astra 等
// 单路必然缺模型（实测 Intl 桌面端 UA 拿不到免费 deepseek），因此并发三路取并集。
const UA_CN = "WorkBuddy/5.5.4 WorkBuddy/5.5.4 CLI/2.137.1";
const UA_INTL = "workbuddy-ai/5.7.6 workbuddy-ai/5.7.6 CLI/2.156.0";
const UA_IDE = "CodeBuddyIDE/4.12.0 CodeBuddy/4.12.0";
const UA_CLI = "CLI/2.63.2 CodeBuddy/2.63.2";

export interface CodeBuddyUpstreamModel {
  id: string;
  /** 上下文窗口：取 supportedLengths 最大档（与 Qoder 同规则），无档位时用 maxInputTokens。 */
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 官方可读名（"GLM-5.3" / "Fast"）。 */
  displayName?: string;
  /** credits 倍率（"x0.79" → 0.79；0 表示免费）。 */
  priceFactor?: number;
  /** 上下文档位（supportedLengths，升序）。 */
  contextTiers?: ReadonlyArray<{ name: string; tokenCount: number }>;
  /** 思考强度档位（reasoning.supportedEfforts）。 */
  thinkingEfforts?: ReadonlyArray<string>;
  /** 默认思考强度（reasoning.defaultEffort）。 */
  thinkingDefault?: string;
}

interface CodeBuddyConfigModelRecord {
  id?: unknown;
  name?: unknown;
  credits?: unknown;
  maxInputTokens?: unknown;
  maxOutputTokens?: unknown;
  contextWindow?: { supportedLengths?: unknown } | null;
  reasoning?: { supportedEfforts?: unknown; defaultEffort?: unknown } | null;
}

interface CodeBuddyConfigEnvelope {
  code?: unknown;
  msg?: unknown;
  data?: {
    agents?: Array<{ name?: unknown; tags?: unknown; models?: unknown }>;
    models?: CodeBuddyConfigModelRecord[];
    /**
     * 试用模型横幅：上游把「N 天免费试用」的模型放在这里，**不在 data.models /
     * agents[].models 里**（workbuddy2api 实测：global 侧 hy4-preview-f 只出现在此，
     * modelId=hy4-preview-f、targetModelId=hy4-preview、trialDays=14）。
     * 只读 data.models 会漏掉这批模型。
     */
    productFeaturesConfig?: {
      modelTrialBanner?: {
        banners?: Array<{ modelId?: unknown; targetModelId?: unknown; trialDays?: unknown }>;
      } | null;
    } | null;
  } | null;
}

function parseCreditsFactor(credits: unknown): number | undefined {
  if (typeof credits !== "string") return undefined;
  const match = /^x\s*(\d+(?:\.\d+)?)/.exec(credits.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function humanTokenCount(tokenCount: number): string {
  if (tokenCount >= 1_000_000) {
    const m = tokenCount / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(tokenCount / 1000)}K`;
}

function pickPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function pickEfforts(record: CodeBuddyConfigModelRecord): {
  efforts?: ReadonlyArray<string>;
  defaultEffort?: string;
} {
  const raw = record.reasoning?.supportedEfforts;
  if (!Array.isArray(raw)) return {};
  const efforts = raw.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  if (efforts.length === 0) return {};
  const defaultEffort =
    typeof record.reasoning?.defaultEffort === "string"
      ? record.reasoning.defaultEffort
      : undefined;
  // XCode fork：与 Qoder 同规则，按强度升序而非上游数组原序。
  return { efforts: sortReasoningLevelsByIntensity(efforts), ...(defaultEffort ? { defaultEffort } : {}) };
}

/** 从 Keycloak JWT 解出 sub 作为 X-User-Id；非 JWT 令牌返回空。 */
function resolveUserId(accessToken: string): string {
  return describeCodeBuddyAccessToken(accessToken)?.sub ?? "";
}

/** 单个 UA 路由的一次 /v3/config 探测结果。 */
interface CodeBuddyCatalogProbe {
  /** 该 UA 下 default agent 的可用模型 id（保序，已去重）。 */
  agentModelIds: string[];
  /** 模型注册表（id → 元数据）。 */
  registry: Map<string, CodeBuddyConfigModelRecord>;
}

/** 请求 /v3/config 并解析成 probe 结构；失败抛错（由调用方逐路容错）。 */
async function probeCodeBuddyCatalog(
  input: { fetchImpl: typeof globalThis.fetch; accessToken: string },
  url: string,
  origin: string,
  userAgent: string,
): Promise<CodeBuddyCatalogProbe> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": userAgent,
    "X-Product": "SaaS",
    "X-Requested-With": "XMLHttpRequest",
    "X-Domain": new URL(origin).host,
    // 身份事实来自令牌本身；sub 与官方客户端一致地回填 X-User-Id。
    "X-User-Id": resolveUserId(input.accessToken),
    "X-Request-ID": randomUUID().replaceAll("-", ""),
    Authorization: `Bearer ${input.accessToken}`,
  };

  const response = await input.fetchImpl(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CodeBuddy config HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  let envelope: CodeBuddyConfigEnvelope;
  try {
    envelope = JSON.parse(text) as CodeBuddyConfigEnvelope;
  } catch {
    throw new Error("CodeBuddy config returned non-JSON response");
  }
  if (envelope.code !== 0 || !envelope.data) {
    throw new Error(`CodeBuddy config error: ${String(envelope.msg ?? "unknown")}`);
  }

  // 官方客户端的模型选择器 = default agent 的可用名单；registry 只作元数据补齐。
  const agents = envelope.data.agents ?? [];
  const agent =
    agents.find((item) => Array.isArray(item.tags) && item.tags.includes("default")) ??
    agents.find((item) => item.name === "cli") ??
    agents[0];
  const agentModelIds: string[] = [];
  for (const id of Array.isArray(agent?.models) ? (agent.models as unknown[]) : []) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (!agentModelIds.includes(id)) agentModelIds.push(id);
  }

  const registry = new Map<string, CodeBuddyConfigModelRecord>();
  for (const record of envelope.data.models ?? []) {
    if (typeof record.id === "string" && record.id) registry.set(record.id, record);
  }

  // 试用横幅里的模型不在 models/agents 名单里，必须单独补进 registry 与名单，
  // 否则「N 天免费试用」的模型永远不会出现在导入列表（workbuddy2api 实测结论）。
  const trialBanners = envelope.data.productFeaturesConfig?.modelTrialBanner?.banners ?? [];
  for (const banner of Array.isArray(trialBanners) ? trialBanners : []) {
    const modelId = typeof banner?.modelId === "string" ? banner.modelId : undefined;
    if (!modelId) continue;
    if (!agentModelIds.includes(modelId)) agentModelIds.push(modelId);
    if (!registry.has(modelId)) {
      const targetModelId =
        typeof banner?.targetModelId === "string" ? banner.targetModelId : undefined;
      const target = targetModelId ? registry.get(targetModelId) : undefined;
      // 试用模型没有独立注册表条目时，借 target 模型的能力字段（名称/窗口/档位），
      // id 保持试用模型自己的，价格按免费处理（credits 缺失 → 0）。
      registry.set(modelId, {
        ...(target ?? {}),
        id: modelId,
        credits: "x0",
      });
    }
  }

  return { agentModelIds, registry };
}

/** probe → 对外模型条目（registry 无条目时输出裸 id）。 */
function toCodeBuddyUpstreamModel(
  id: string,
  record: CodeBuddyConfigModelRecord | undefined,
): CodeBuddyUpstreamModel {
  if (!record) return { id };
  const tiers = Array.isArray(record.contextWindow?.supportedLengths)
    ? (record.contextWindow?.supportedLengths as unknown[])
        .map((tokenCount) => pickPositiveInt(tokenCount))
        .filter((tokenCount): tokenCount is number => tokenCount !== undefined)
        .sort((x, y) => x - y)
    : [];
  const contextWindow = tiers.at(-1) ?? pickPositiveInt(record.maxInputTokens);
  const maxOutputTokens = pickPositiveInt(record.maxOutputTokens);
  const priceFactor = parseCreditsFactor(record.credits);
  const { efforts, defaultEffort } = pickEfforts(record);
  return {
    id,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(typeof record.name === "string" && record.name.trim()
      ? { displayName: record.name.trim() }
      : {}),
    ...(priceFactor !== undefined ? { priceFactor } : {}),
    ...(tiers.length > 0
      ? {
          contextTiers: tiers.map((tokenCount) => ({
            name: humanTokenCount(tokenCount),
            tokenCount,
          })),
        }
      : {}),
    ...(efforts ? { thinkingEfforts: efforts } : {}),
    ...(defaultEffort ? { thinkingDefault: defaultEffort } : {}),
  };
}

export async function fetchCodeBuddyUpstreamModels(input: {
  baseUrl: string;
  accessToken: string;
  fetchImpl: typeof globalThis.fetch;
}): Promise<CodeBuddyUpstreamModel[]> {
  const origin = new URL(input.baseUrl.trim()).origin;
  const url = `${origin}${CONFIG_PATH}`;
  const isCn = /copilot\.tencent\.com/i.test(origin);
  // 三路 UA 并发探测：桌面端为主路（字段最全），IDE/CLI 只补主路缺失的模型 id。
  // CN 侧官方只认桌面端 UA（workbuddy2api：CN 仍走单路），但多探两路无害且能兜住
  // 上游改版，失败仅 warn。
  const routes: Array<{ label: string; ua: string }> = [
    { label: "desktop-UA", ua: isCn ? UA_CN : UA_INTL },
    { label: "IDE-UA", ua: UA_IDE },
    { label: "CLI-UA", ua: UA_CLI },
  ];
  const results = await Promise.allSettled(
    routes.map((route) => probeCodeBuddyCatalog(input, url, origin, route.ua)),
  );

  const merged = new Map<string, CodeBuddyUpstreamModel>();
  let successCount = 0;
  let lastError: unknown;
  results.forEach((result, index) => {
    const label = routes[index]!.label;
    if (result.status === "rejected") {
      lastError = result.reason;
      log.warn(undefined, "CodeBuddy catalog route failed", {
        origin,
        route: label,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      return;
    }
    successCount += 1;
    const probe = result.value;
    // 主路（desktop）字段权威：先写入；后续路只补缺失 id。
    for (const id of probe.agentModelIds) {
      if (merged.has(id)) continue;
      merged.set(id, toCodeBuddyUpstreamModel(id, probe.registry.get(id)));
    }
  });


  if (successCount === 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CodeBuddy config failed on all routes: ${String(lastError ?? "unknown")}`);
  }

  const out = [...merged.values()];
  log.info(undefined, "CodeBuddy upstream model list fetched", {
    origin,
    models: out.length,
    routes: successCount,
  });
  return out;
}
