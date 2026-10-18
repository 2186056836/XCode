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
// 用官方客户端实抓的同款 UA（CN=WorkBuddy 桌面端，Intl=workbuddy-ai）。
const UA_CN = "WorkBuddy/5.5.4 WorkBuddy/5.5.4 CLI/2.137.1";
const UA_INTL = "workbuddy-ai/5.7.6 workbuddy-ai/5.7.6 CLI/2.156.0";

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

export async function fetchCodeBuddyUpstreamModels(input: {
  baseUrl: string;
  accessToken: string;
  fetchImpl: typeof globalThis.fetch;
}): Promise<CodeBuddyUpstreamModel[]> {
  const origin = new URL(input.baseUrl.trim()).origin;
  const url = `${origin}${CONFIG_PATH}`;
  const isCn = /copilot\.tencent\.com/i.test(origin);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": isCn ? UA_CN : UA_INTL,
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
  const agentModelIds = Array.isArray(agent?.models)
    ? agent.models.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  if (agentModelIds.length === 0) {
    throw new Error("CodeBuddy config returned an empty agent model list");
  }

  const registry = new Map<string, CodeBuddyConfigModelRecord>();
  for (const record of envelope.data.models ?? []) {
    if (typeof record.id === "string" && record.id) registry.set(record.id, record);
  }

  const seen = new Set<string>();
  const out: CodeBuddyUpstreamModel[] = [];
  for (const id of agentModelIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const record = registry.get(id);
    if (!record) {
      out.push({ id });
      continue;
    }
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
    out.push({
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
    });
  }
  log.info(undefined, "CodeBuddy upstream model list fetched", {
    origin,
    models: out.length,
  });
  return out;
}
