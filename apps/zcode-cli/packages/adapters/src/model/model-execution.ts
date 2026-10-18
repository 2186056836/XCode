/* eslint-disable max-lines -- AI SDK 模型执行装配集中维护 provider factory、鉴权和网络错误适配，拆分会让状态同步更脆弱。 */
// ============================================================
// Vercel AI SDK model execution
// ============================================================

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tmpdir } from "node:os";
import type { createModelRequestSecurityState } from "./request-security-edition/index.js";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import {
  compileModelOptionMaps,
  type CompiledModelOptionMaps,
  type ModelOptionValues,
} from "@zcode/model-option-map";
import {
  type Logger,
  type ModelId,
  type ModelProviderId,
  type ModelRequestAuth,
} from "@zcode/contracts";
import type { RegistryProviderConfig } from "@zcode/provider";
import { isOffReasoningLevel, mapReasoningEffortForOpenCode, withOpenRouterAttributionHeaders } from "@zcode/shared";
import { createAnthropicCompatFetch } from "./anthropic-stream-compat.js";
import { createOpenAIResponsesJsonCompatFetch } from "./openai-responses-json-compat.js";
import { createModelOptionMapFetch, type RawRequestBodyCapture } from "./model-option-map-fetch.js";
import { createNetworkProxyFetch } from "../network/proxy-fetch.js";
import {
  buildSignedQoderRequest,
  unwrapQoderSseStream,
  type QoderRequestIdentity,
} from "./qoderProtocol.js";
import { createOfficialCodingPlanGatewayFetch } from "./official-coding-plan-gateway.js";
import { normalizeModelTlsFailure } from "./failure-tls.js";
import { mergeModelRequestHeaders } from "./model-request-headers.js";

export type AiSdkProviderKind = "openai" | "anthropic" | "openai-compatible";

export type EnvRecord = Record<string, string | undefined>;

interface AiSdkProviderConfig {
  access: RegistryProviderConfig["access"];
  kind: AiSdkProviderKind;
  apiKey?: string;
  baseURL: string;
  headers?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  name?: string;
  requestProfile?: RegistryProviderConfig["requestProfile"];
}

export interface AiSdkModelExecutionConfig {
  /** 执行环境提供的默认来源信息，不属于 Provider 持久化配置。 */
  defaultHeaders?: Readonly<Record<string, string>>;
  env?: EnvRecord;
  network?: AiSdkNetworkConfig;
}

/** 1010 新增：请求安全状态（token 指纹防重放 / 项目 token 拒绝集）。
 *  用返回类型推导，避免在 shared 侧重复声明这个结构。 */
export interface AiSdkModelExecutionOptions {
  /** 1010 新增：请求安全状态（token 指纹防重放 / 项目 token 拒绝集）。 */
  requestSecurityState?: ReturnType<typeof createModelRequestSecurityState>;
  logger?: Logger;
  transport?: ProviderFetch;
}

export interface AiSdkNetworkConfig {
  caCertFile?: string;
  httpProxy?: string;
  noProxy?: string;
}

export interface AiSdkResolvedModel {
  baseURL?: string;
  headers?: Record<string, string>;
  providerId: ModelProviderId;
  modelId: ModelId;
  model: LanguageModel;
  providerKind: AiSdkProviderKind;
  providerOptions?: Record<string, unknown>;
  rawRequestBodyCapture?: RawRequestBodyCapture;
}

export interface AiSdkBoundModelResolution {
  readonly resolved: AiSdkResolvedModel;
  resolveRequest(input: {
    readonly options: ModelOptionValues;
    readonly requestAuth?: ModelRequestAuth;
  }): AiSdkResolvedModel;
}

type LanguageModelFactory = (modelId: string) => LanguageModel;
type ProviderFetch = typeof globalThis.fetch;
type ProviderCode = string | number;

export interface ProviderBusinessErrorFetchOptions {
  caCertFile?: string;
  env?: EnvRecord;
  providerId: string;
  providerKind: AiSdkProviderKind;
  fetch?: ProviderFetch;
  httpProxy?: string;
  noProxy?: string;
}

export interface ProviderBusinessErrorOptions {
  providerCode?: ProviderCode;
  providerId: string;
  providerKind: AiSdkProviderKind;
  providerMessage?: string;
  providerRequestId?: string;
  responseBodySummary?: Record<string, unknown>;
  responseHeaders?: Record<string, string>;
  responseStatus?: number;
  statusCode?: number;
}

export class ProviderBusinessError extends Error {
  readonly code = "PROVIDER_BUSINESS_ERROR";
  readonly isProviderBusinessError = true;
  readonly providerCode?: ProviderCode;
  readonly providerId: string;
  readonly providerKind: AiSdkProviderKind;
  readonly providerMessage?: string;
  readonly providerRequestId?: string;
  readonly responseBodySummary?: Record<string, unknown>;
  readonly responseHeaders?: Record<string, string>;
  readonly responseStatus?: number;
  readonly statusCode?: number;

  constructor(options: ProviderBusinessErrorOptions) {
    const providerMessage =
      normalizeProviderMessage(options.providerMessage) ?? "Provider returned a business error.";
    super(providerMessage);
    this.name = "ProviderBusinessError";
    this.providerCode = options.providerCode;
    this.providerId = options.providerId;
    this.providerKind = options.providerKind;
    this.providerMessage = providerMessage;
    this.providerRequestId = options.providerRequestId;
    this.responseBodySummary = options.responseBodySummary;
    this.responseHeaders = options.responseHeaders;
    this.responseStatus = options.responseStatus;
    this.statusCode = options.statusCode;
  }
}

export function isProviderBusinessError(error: unknown): error is ProviderBusinessError {
  if (error instanceof ProviderBusinessError) {
    return true;
  }

  const record = asRecord(error);
  return record?.isProviderBusinessError === true && record.name === "ProviderBusinessError";
}

const MAX_BUSINESS_ERROR_BODY_CHARS = 64_000;
const MAX_PROVIDER_MESSAGE_CHARS = 1_000;
const PROVIDER_BUSINESS_ERROR_BODY_CLEANUP_TIMEOUT_MS = 1_000;
const PROVIDER_BUSINESS_ERROR_WRAPPER_CODE = "PROVIDER_BUSINESS_ERROR";
const SSE_FRAME_SEPARATOR_PATTERN = /\r\n\r\n|\n\n|\r\r/;
const AUTHORIZATION_HEADER_NAME = "Authorization";

export class AiSdkModelExecution {
  private readonly env: EnvRecord;
  private readonly defaultHeaders: Record<string, string>;
  private readonly network: AiSdkNetworkConfig;
  private readonly logger?: Logger;
  private readonly baseTransport?: ProviderFetch;
  private readonly providerTransports = new Map<string, ProviderFetch>();

  constructor(config: AiSdkModelExecutionConfig = {}, options: AiSdkModelExecutionOptions = {}) {
    this.env = config.env ?? process.env;
    this.defaultHeaders = { ...config.defaultHeaders };
    this.network = { ...config.network };
    this.logger = options.logger;
    this.baseTransport = options.transport;
  }

  /**
   * 固定一个 Model 创建时使用的 Provider 静态事实。
   *
   * 请求期鉴权只覆盖 API Key 与 Header；Registry 后续热更新不会让已经创建的
   * Model 静默切换 Endpoint、协议、Provider Options 或 SDK Factory。
   */
  bindModel(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly providerConfig: RegistryProviderConfig;
    readonly supportsJsonSchemaOutput: boolean;
    readonly optionSpecs: {
      /** XCode fork：values 是该模型宣告的思考档位全集，OpenCode 画像按它钳制。 */
      readonly reasoningLevel: { readonly map: string; readonly values?: readonly string[] };
      readonly maxOutputTokens: { readonly map: string };
    };
  }): AiSdkBoundModelResolution {
    const snapshot = this.captureModelSnapshot(input);
    const optionMaps = compileModelOptionMaps(input.optionSpecs);
    return {
      // 这里只构造不执行请求的基础 Model；真正请求必须通过 resolveRequest 绑定完整 options。
      resolved: this.resolveSnapshot(snapshot, undefined, undefined, undefined),
      resolveRequest: ({ options, requestAuth }) =>
        this.resolveSnapshot(snapshot, requestAuth, optionMaps, options),
    };
  }

  private captureModelSnapshot(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly providerConfig: RegistryProviderConfig;
    readonly supportsJsonSchemaOutput: boolean;
    readonly optionSpecs?: {
      readonly reasoningLevel: { readonly values?: readonly string[] };
    };
  }): AiSdkModelSnapshot {
    const configuredProvider = toAiSdkProviderConfig(input.providerId, input.providerConfig);
    // 重构后模型 SDK 曾只接到用户 Header，漏掉版本和站点归因；在公共绑定边界恢复，
    // 不依赖签名成功，不给各业务重复补头，也不修改 Provider 或已绑定 Model 的配置。
    configuredProvider.headers = mergeModelRequestHeaders(
      withOpenRouterAttributionHeaders(this.defaultHeaders, configuredProvider.baseURL),
      configuredProvider.headers,
    );
    const apiKey = this.resolveApiKey(configuredProvider);
    return {
      providerConfig: {
        ...configuredProvider,
        ...(apiKey ? { apiKey } : {}),
        ...(configuredProvider.headers ? { headers: { ...configuredProvider.headers } } : {}),
        ...(configuredProvider.providerOptions
          ? { providerOptions: { ...configuredProvider.providerOptions } }
          : {}),
      },
      providerId: input.providerId as ModelProviderId,
      modelId: input.modelId as ModelId,
      supportsJsonSchemaOutput: input.supportsJsonSchemaOutput,
      // XCode fork：冻结该模型宣告的思考档位，请求期钳制要用（值域逐模型不同）。
      reasoningLevelValues: input.optionSpecs?.reasoningLevel.values,
    };
  }

  private resolveSnapshot(
    snapshot: AiSdkModelSnapshot,
    requestAuth: ModelRequestAuth | undefined,
    optionMaps: CompiledModelOptionMaps | undefined,
    optionValues: ModelOptionValues | undefined,
  ): AiSdkResolvedModel {
    const providerConfig = applyModelRequestAuth(snapshot.providerConfig, requestAuth);
    // Model 创建时的 Provider 事实必须被冻结在当前 binding 中。若按 providerId 缓存
    // factory，配置更新后创建的新 Model 会错误复用旧 Endpoint / Header / API Key。
    const rawRequestBodyCapture: RawRequestBodyCapture = {};
    const factory = this.createFactory(
      snapshot.providerId,
      providerConfig,
      optionMaps,
      optionValues,
      rawRequestBodyCapture,
      snapshot.supportsJsonSchemaOutput,
      snapshot.reasoningLevelValues,
    );
    return {
      baseURL: providerConfig.baseURL,
      headers: providerConfig.headers,
      providerId: snapshot.providerId,
      modelId: snapshot.modelId,
      model: factory(snapshot.modelId.toString()),
      providerKind: providerConfig.kind,
      providerOptions: providerConfig.providerOptions,
      rawRequestBodyCapture,
    };
  }

  private createFactory(
    providerId: string,
    providerConfig: AiSdkProviderConfig,
    optionMaps: CompiledModelOptionMaps | undefined,
    optionValues: ModelOptionValues | undefined,
    rawRequestBodyCapture: RawRequestBodyCapture,
    supportsJsonSchemaOutput: boolean,
    /** XCode fork：该模型宣告的思考档位全集，OpenCode 画像按它钳制。 */
    reasoningLevelValues: readonly string[] | undefined,
  ): LanguageModelFactory {
    const apiKey = this.resolveApiKey(providerConfig);
    const headers = providerConfig.headers;
    const providerTransport = this.resolveProviderTransport(providerId);
    const profiledTransport = createUpstreamRequestProfileFetch({
      profile: providerConfig.requestProfile ?? undefined,
      kind: providerConfig.kind,
      headers: providerConfig.headers,
      apiKey:
        providerConfig.access.type !== "zhipu-account"
          ? providerConfig.access.apiKey ?? undefined
          : undefined,
      fetch: providerTransport,
      // persona 注入是请求级开关：默认关闭，仅当供应商 headers 显式声明开启时启用。
      qoderInjectPersona: readQoderPersonaFlag(providerConfig.headers),
      reasoningLevelValues,
    });
    const fetch = createProviderBusinessErrorFetch({
      fetch: profiledTransport,
      providerId,
      providerKind: providerConfig.kind,
    });
    const optionFetch =
      optionMaps && optionValues
        ? createModelOptionMapFetch({
            capture: rawRequestBodyCapture,
            fetch,
            maps: optionMaps,
            values: optionValues,
          })
        : fetch;

    switch (providerConfig.kind) {
      case "openai": {
        const provider = createOpenAI({
          apiKey,
          baseURL: providerConfig.baseURL,
          fetch: createOpenAIResponsesJsonCompatFetch(optionFetch),
          headers,
        });
        return provider.responses as LanguageModelFactory;
      }

      case "anthropic": {
        const provider = createAnthropic({
          apiKey,
          baseURL: normalizeAnthropicBaseURL(providerConfig.baseURL),
          fetch: createAnthropicCompatFetch(optionFetch),
          headers: withAnthropicAuthorizationHeader(apiKey, headers),
        });
        return provider as LanguageModelFactory;
      }

      case "openai-compatible": {
        const provider = createOpenAICompatible<string, string, string, string>({
          name: providerConfig.name ?? providerId,
          baseURL: providerConfig.baseURL,
          apiKey,
          fetch: optionFetch,
          headers,
          // OpenAI Compatible 流式 usage 需要显式请求，Usage 是执行结果的一部分。
          includeUsage: true,
          // 缺少这一装配时 SDK 默认 false，会把已声明支持的 Schema 静默降为 JSON object。
          // 使用 binding 冻结的模型事实，不按供应商或实时 Registry 另查一套能力。
          supportsStructuredOutputs: supportsJsonSchemaOutput,
        });
        return provider as LanguageModelFactory;
      }
    }
  }

  private resolveApiKey(providerConfig: AiSdkProviderConfig): string | undefined {
    return providerConfig.apiKey;
  }

  private resolveProviderTransport(providerId: string): ProviderFetch {
    const current = this.providerTransports.get(providerId);
    if (current) {
      return current;
    }
    // 官方 Coding Plan 端点先替换为平台网关端点，再进入用户 HTTP 代理 fetch，
    // httpProxy / noProxy 按实际发送地址判定。
    const transport = createProviderTransportFetch({
      caCertFile: this.network.caCertFile,
      env: this.env,
      fetch: this.baseTransport,
      httpProxy: this.network.httpProxy,
      noProxy: this.network.noProxy,
    });
    this.providerTransports.set(providerId, transport);
    return transport;
  }
}

interface AiSdkModelSnapshot {
  readonly supportsJsonSchemaOutput: boolean;
  readonly providerConfig: AiSdkProviderConfig;
  readonly providerId: ModelProviderId;
  readonly modelId: ModelId;
  /** XCode fork：该模型宣告的思考档位全集（OpenCode 画像按它钳制）。 */
  readonly reasoningLevelValues?: readonly string[];
}

function toAiSdkProviderConfig(
  providerId: string,
  config: RegistryProviderConfig,
): AiSdkProviderConfig {
  const common = {
    ...(config.access.type !== "zhipu-account" && config.access.apiKey
      ? { apiKey: config.access.apiKey }
      : {}),
    baseURL: config.api.baseUrl,
    ...(config.api.headers ? { headers: { ...config.api.headers } } : {}),
    providerOptions: { apiFormat: config.api.type },
    access: config.access,
    requestProfile: config.requestProfile,
  };
  switch (config.api.type) {
    case "anthropic-messages":
      return { kind: "anthropic", ...common };
    case "openai-responses":
      return { kind: "openai", ...common };
    case "openai-chat-completions":
      return { kind: "openai-compatible", name: providerId, ...common };
  }
  throw new Error(`Unsupported Provider API type: ${String(config.api.type)}`);
}

function applyModelRequestAuth(
  providerConfig: AiSdkProviderConfig,
  requestAuth: ModelRequestAuth | undefined,
): AiSdkProviderConfig {
  if (!requestAuth) return providerConfig;
  return {
    ...providerConfig,
    ...(requestAuth.apiKey ? { apiKey: requestAuth.apiKey } : {}),
    ...(requestAuth.headers
      ? { headers: mergeModelRequestHeaders(providerConfig.headers, requestAuth.headers) }
      : {}),
  };
}

// ============================================================
// XCode fork：OpenCode 免费档请求画像（requestProfile = "opencode-free-tier"）
//
// OpenCode Zen 的免费模型带客户端闸门（403 FreeTierError "free tier can only
// be used from within OpenCode"）。实测（2026-10）最小通过配方：
//   1. 静态头（内置配置 api.headers 承载）：Authorization: Bearer public、
//      User-Agent: opencode/1.18.31、x-opencode-client: desktop、
//      x-opencode-session/request: 格式合法的占位 id、x-opencode-project: global；
//   2. 请求体必须携带小写 bash/glob/grep/read 四个指纹工具（chat 用嵌套
//      function 形状，responses 用扁平 {name} 形状）；
//   3. stream 必须为 true；responses 通道还需 store:false。
// 缺任一项都会被 403 拦截，这里在 fetch 层统一补齐。
// ============================================================

type UpstreamRequestProfile = NonNullable<RegistryProviderConfig["requestProfile"]>;

const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"] as const;

function fingerprintToolDescription(): string {
  return "This tool is currently unavailable and must not be used.";
}

function toolNameOf(tool: unknown): string {
  if (!tool || typeof tool !== "object") return "";
  const record = tool as Record<string, unknown>;
  if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
  const nested = record.function as Record<string, unknown> | undefined;
  if (nested && typeof nested.name === "string" && nested.name.trim()) {
    return nested.name.trim();
  }
  return "";
}

/**
 * 对齐 OpenCode 免费档指纹契约：上游只认小写 bash/glob/grep/read，且同一成员
 * 的大小写变体并存会被判重复。因此把客户端声明的大小写变体就地改名（如
 * `Bash`→`bash`；模型回调由工具注册表的小写回退解析回原工具），缺失成员补齐。
 */
function canonicalizeFingerprintTools(
  tools: unknown[],
  makeTool: (name: string) => unknown,
): void {
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    const existing = tools.find(
      (tool) => toolNameOf(tool).toLowerCase() === name && toolNameOf(tool) !== "",
    );
    if (existing !== undefined) {
      const current = toolNameOf(existing);
      if (current !== name) {
        const record = existing as Record<string, unknown>;
        if (typeof record.name === "string") record.name = name;
        else if (record.function && typeof record.function === "object") {
          (record.function as Record<string, unknown>).name = name;
        }
      }
      continue;
    }
    tools.push(makeTool(name));
  }
}

function appendChatFingerprintTools(body: Record<string, unknown>): void {
  const tools = Array.isArray(body.tools) ? [...body.tools] : [];
  canonicalizeFingerprintTools(tools, (name) => ({
    type: "function",
    function: {
      name,
      description: fingerprintToolDescription(),
      parameters: { type: "object", properties: {} },
    },
  }));
  body.tools = tools;
}

function appendResponsesFingerprintTools(body: Record<string, unknown>): void {
  const tools = Array.isArray(body.tools) ? [...body.tools] : [];
  canonicalizeFingerprintTools(tools, (name) => ({
    type: "function",
    name,
    description: fingerprintToolDescription(),
    parameters: { type: "object", properties: {} },
  }));
  body.tools = tools;
}

/**
 * 归一化 OpenCode 网关的推理字段：只保留**合法**的档位表达。
 *
 * XCode fork（2026-10-12 实测 `opencode.ai/zen/v1/chat/completions`）：本函数原先
 * 无条件 `delete body.reasoning_effort`，理由写的是「space-bunny-free 对
 * reasoning_effort 直接 400」。复测证明该结论只对**非法值**成立，对合法值不成立：
 *   space-bunny-free：reasoning_effort = minimal/low/medium/high/xhigh/max 全部 200，
 *                     仅 none / ultra / disabled / on 报 400。
 *   big-pickle（后端 sglang）：同样七个值全部 200，非法值回传 pydantic 原文
 *                     `literal['none','minimal','low','medium','high','xhigh','max']`。
 * 而真正承载档位语义的就是 reasoning_effort——同一模型上它随档位单调变化
 * （big-pickle 的 reasoning_content 分片数：none 0 / minimal 8 / low 16 / medium 19 /
 * high 31 / xhigh 11 / max 18）；`reasoning:{effort}` 在 space-bunny-free 上完全不生效
 * （low/high/max 一律 5 片，ultra/disabled 反而 0 片）。
 * 原实现把字段整个删掉，等于让「思考强度」选择器对 OpenCode 免费档完全失效——
 * 用户选了 high 与 disabled 发出的是同一个请求。
 *
 * 因此改为：按该模型**自己宣告的**档位集钳制后下发，表外值（关闭族 + 任何未知值）
 * 一律不发该字段（上游按自身默认思考），绝不原样透传一个会被 400 拒掉的值。
 * `thinking`（Anthropic 风格）仍整体剥离：它不是 OpenAI chat 契约的一部分。
 *
 * `supportedReasoningLevels` 是该模型 `optionSpecs.reasoningLevel.values`（去掉
 * 关闭档后的全集）。网关合法值域是**逐模型**的：space-bunny-free 目录档位
 * low/medium/high/xhigh/max，收 none 会 400；big-pickle 目录为空、收 none 正常。
 */
function normalizeOpenCodeReasoningFields(
  body: Record<string, unknown>,
  supportedReasoningLevels: readonly string[] | undefined,
): void {
  delete body.thinking;
  const effort = mapReasoningEffortForOpenCode(body.reasoning_effort, supportedReasoningLevels);
  if (effort) {
    body.reasoning_effort = effort;
  } else {
    delete body.reasoning_effort;
  }
  // reasoning:{effort}（Responses 风格）与 reasoning_effort 共用同一值域：
  // big-pickle 收到非法值会 400「invalid reasoning effort」。两处都要归一化，
  // 否则只修一半仍会被拒。
  const reasoning = body.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    const nested = reasoning as Record<string, unknown>;
    const nestedEffort = mapReasoningEffortForOpenCode(nested.effort, supportedReasoningLevels);
    if (nestedEffort) {
      nested.effort = nestedEffort;
    } else {
      delete nested.effort;
      if (Object.keys(nested).length === 0) delete body.reasoning;
    }
  }
}

/**
 * CodeBuddy 统一网关：所有模型（GLM/Kimi/DeepSeek 等）都走 OpenAI 风格的
 * reasoning_effort；thinking（Anthropic 风格）、enable_thinking、reasoning
 * （Responses 风格）不在其请求契约内，统一剥离，避免网关侧 invalid_request。
 */
// Qoder 内部身份头（登录成功时写入 provider headers，随请求上行前会被剥掉）。
const QODER_IDENTITY_USER_ID_HEADER = "x-qoder-internal-user-id";
const QODER_IDENTITY_MACHINE_ID_HEADER = "x-qoder-internal-machine-id";

/**
 * Qoder IDE persona 注入开关。默认关闭——注入会让模型自称 Qoder，与本产品
 * 身份冲突；仅在用户明确需要（怀疑账号被上游按 prompt 形状风控）时开启。
 * 走 provider headers 通道，用户可在供应商配置里直接改。
 */
const QODER_PERSONA_HEADER = "x-qoder-inject-persona";

function readQoderPersonaFlag(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== QODER_PERSONA_HEADER) continue;
    const normalized = String(value).trim().toLowerCase();
    return normalized === "1" || normalized === "true";
  }
  return false;
}

function readQoderIdentity(
  headers: Record<string, string> | undefined,
  accessToken: string | undefined,
): QoderRequestIdentity | null {
  if (!accessToken || !headers) return null;
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    lower.set(key.toLowerCase(), value);
  }
  const userId = lower.get(QODER_IDENTITY_USER_ID_HEADER) ?? "";
  // PAT（pt-）没有可预知的 userId——它要等运行时换成 job token 后从userinfo
  // 取回。这里放行，让 qoderProtocol 的 PAT 交换补齐；dt-/jt- 仍必须有
  // userId，缺失说明凭证没配全，直接短路比发出一个必然失败的签名请求更好。
  if (!userId && !accessToken.startsWith("pt-")) return null;
  // machineId 兜底放在这里（每请求一次的身份解析），而不是留在签名层的
  // `creds.machineId || randomUUID()`：后者每 HTTP 请求重跑一次，会让
  // Cosy-Machineid / Machinetoken 以及派生的 machinecode / hostname / clientip
  // 全部逐请求刷新——上游看到的是"一个账号一天内用了上千台机器"，比稳定的
  // 假指纹更像伪造客户端。此处按 userId 派生，取到的是每个账号恒定的值。
  const machineId =
    lower.get(QODER_IDENTITY_MACHINE_ID_HEADER) ?? (userId ? `qoder-local-${userId}` : "");
  return {
    accessToken,
    userId,
    machineId,
    name: "",
    email: "",
  };
}

// 内部身份头不能上行（上游不需要，也会泄露本地身份信息）。
function stripQoderIdentityHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowered = key.toLowerCase();
    if (
      lowered === QODER_IDENTITY_USER_ID_HEADER ||
      lowered === QODER_IDENTITY_MACHINE_ID_HEADER ||
      lowered === QODER_PERSONA_HEADER
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function stripCodeBuddyIncompatibleReasoningFields(body: Record<string, unknown>): void {
  delete body.thinking;
  delete body.enable_thinking;
  delete body.reasoning;
  // 网关没有 "none" 档（与 Qoder 同规则）：禁用思考时 reasoning_effort 直接
  // 不发（对齐官方 CLI / 9router），发了会被 400 拒绝。
  //
  // XCode fork：原先只判 none/off，漏掉了模型配置里真实存在的关闭档位名
  // （导入上游模型时写入的是 "disabled"），它会被原样发出去并被网关拒绝。
  // 这里改为按关闭族整族剥离，而不是逐个枚举。
  const effort = body.reasoning_effort;
  if (typeof effort === "string" && isOffReasoningLevel(effort)) {
    delete body.reasoning_effort;
  }
}

function isEventStreamResponseLike(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/event-stream");
}

/** 清理 CodeBuddy SSE chunk：剥掉空 reasoning_content 与恒空的噪音键。 */
function cleanCodeBuddySseLine(line: string): string {
  if (!line.startsWith("data:")) return line;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return line;
  try {
    const chunk = JSON.parse(payload) as Record<string, unknown>;
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    for (const choice of choices) {
      const delta = (choice as Record<string, unknown>)?.delta as
        | Record<string, unknown>
        | undefined;
      if (!delta) continue;
      if (delta.reasoning_content === "") delete delta.reasoning_content;
      if (delta.refusal === "") delete delta.refusal;
      if (delta.function_call === null) delete delta.function_call;
      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length === 0) {
        delete delta.tool_calls;
      }
      if (delta.extra_fields === null) delete delta.extra_fields;
    }
    return `data: ${JSON.stringify(chunk)}`;
  } catch {
    return line;
  }
}

function rewriteCodeBuddySseStream(response: Response): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        controller.enqueue(encoder.encode(cleanCodeBuddySseLine(line) + "\n"));
      }
    },
    flush(controller) {
      if (buffer) controller.enqueue(encoder.encode(cleanCodeBuddySseLine(buffer)));
    },
  });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (!response.body) return response;
  return new Response(response.body.pipeThrough(stream), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 按 requestProfile 改写发往上游的 JSON 请求体；非目标画像、非 JSON POST
 * （如 models 拉取）原样透传。放在 transport 之后、业务错误适配之前，
 * 使 403 FreeTierError 仍能走统一的业务错误渲染。
 */
export function createUpstreamRequestProfileFetch(input: {
  profile: UpstreamRequestProfile | undefined;
  kind: AiSdkProviderKind;
  headers?: Record<string, string>;
  apiKey?: string;
  fetch: ProviderFetch;
  /** Qoder：是否注入官方 IDE 身份 persona（默认关闭，见 qoderProtocol）。 */
  qoderInjectPersona?: boolean;
  /** XCode fork：OpenCode 画像按该模型自己宣告的档位集钳制 reasoning_effort。 */
  reasoningLevelValues?: readonly string[];
}): ProviderFetch {
  // Qoder 画像：COSY 签名 + WAF 编码 + 信封解包（协议非 OpenAI 兼容，
  // 整个请求由 qoderProtocol 重建，AI SDK 的 model 仅承担消息结构化）。
  if (input.profile === "qoder") {
    const qoderFetch = input.fetch;
    return async (request, init) => {
      const method = (init?.method ?? "POST").toUpperCase();
      const rawBody = init?.body;
      if (method !== "POST" || typeof rawBody !== "string") {
        return qoderFetch(request, init);
      }
      let openAiBody: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return qoderFetch(request, init);
        }
        openAiBody = parsed as Record<string, unknown>;
      } catch {
        return qoderFetch(request, init);
      }
      const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
      const model = typeof openAiBody.model === "string" ? openAiBody.model : "";
      const identity = readQoderIdentity(input.headers, input.apiKey);
      if (!identity) {
        return new Response(
          JSON.stringify({ error: { message: "qoder credential missing user identity; reconnect the account" } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }
      const signed = await buildSignedQoderRequest({
        region: url.includes("qoder.com.cn") ? "cn" : "intl",
        model,
        openAiBody,
        identity,
        fetchImpl: qoderFetch,
        injectPersona: input.qoderInjectPersona === true,
      });
      const cleanedHeaders = stripQoderIdentityHeaders(input.headers);
      const response = await qoderFetch(signed.url, {
        method: "POST",
        headers: {
          ...cleanedHeaders,
          ...signed.cosyHeaders,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
          // 官方客户端不发 X-Model-Key / X-Model-Source——模型选择完全走编码后
          // payload 里的 model_config，这两个头本身就是非 IDE 特征。保留
          // Accept-Encoding: identity 是必须的：gzip 会触发 Qoder CDN 的签名校验失败。
          "Accept-Encoding": "identity",
          "x-model-name": "",
          "User-Agent": "Go-http-client/2.0",
        },
        body: new Uint8Array(signed.bodyBuf),
      });
      return unwrapQoderSseStream(response, model || signed.modelKey);
    };
  }

  // CodeBuddy 画像：仅剥离非 OpenAI 风格推理字段，无指纹/流式改写。
  if (input.profile === "codebuddy") {
    const codebuddyFetch = input.fetch;
    return async (request, init) => {
      const method = (init?.method ?? "POST").toUpperCase();
      const rawBody = init?.body;
      if (method !== "POST" || typeof rawBody !== "string") {
        return codebuddyFetch(request, init);
      }
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return codebuddyFetch(request, init);
        }
        const body = parsed as Record<string, unknown>;
        stripCodeBuddyIncompatibleReasoningFields(body);
        const response = await codebuddyFetch(request, { ...init, body: JSON.stringify(body) });
        // 网关的 SSE chunk 恒带空的 reasoning_content（与正文逐 token 交替），
        // 解析端会把每次空思考当成一步导致回复碎裂；流式剥掉空键。
        if (isEventStreamResponseLike(response)) {
          return rewriteCodeBuddySseStream(response);
        }
        return response;
      } catch {
        return codebuddyFetch(request, init);
      }
    };
  }
  if (input.profile !== "opencode-free-tier") return input.fetch;
  const baseFetch = input.fetch;
  // 临时诊断（XCODE_PROFILE_DEBUG=1 时落盘请求/错误响应，定位上游 400 拒绝字段）。
  const debugEnabled = process.env.XCODE_PROFILE_DEBUG === "1";
  const debugFile = debugEnabled
    ? join(tmpdir(), "xcode-profile-debug.log")
    : undefined;
  return async (request, init) => {
    const method = (init?.method ?? "POST").toUpperCase();
    const rawBody = init?.body;
    if (method !== "POST" || typeof rawBody !== "string") {
      return baseFetch(request, init);
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return baseFetch(request, init);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return baseFetch(request, init);
    }

    const url =
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url;
    if (url.endsWith("/responses")) {
      body.stream = true;
      body.store = false;
      normalizeOpenCodeReasoningFields(body, input.reasoningLevelValues);
      appendResponsesFingerprintTools(body);
      // muse-spark 上游要求 max_output_tokens >= 16，连通性探测只发 1 会被 400。
      if (
        typeof body.max_output_tokens === "number" &&
        body.max_output_tokens > 0 &&
        body.max_output_tokens < 16
      ) {
        body.max_output_tokens = 16;
      }
    } else {
      body.stream = true;
      normalizeOpenCodeReasoningFields(body, input.reasoningLevelValues);
      appendChatFingerprintTools(body);
    }
    const nextInit = { ...init, body: JSON.stringify(body) };
    let response: Response;
    try {
      response = await baseFetch(request, nextInit);
    } catch (error) {
      if (debugFile) {
        try {
          appendFileSync(
            debugFile,
            `${JSON.stringify({ at: new Date().toISOString(), url, phase: "fetch-throw", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), cause: error instanceof Error && error.cause ? String(error.cause).slice(0, 300) : undefined })}\n`,
          );
        } catch {
          // 转储失败不影响原错误上抛。
        }
      }
      throw error;
    }
    if (debugFile && !response.ok) {
      try {
        const errorText = await response.text();
        appendFileSync(
          debugFile,
          `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, request: body, response: errorText.slice(0, 6000) })}\n`,
        );
        return new Response(errorText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        // 转储失败不影响原响应透传。
      }
    }
    return response;
  };
}

function withAnthropicAuthorizationHeader(
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!apiKey || hasHeader(headers, AUTHORIZATION_HEADER_NAME)) {
    return headers;
  }

  // Anthropic 兼容网关会同时读取 x-api-key 和 Bearer Authorization；显式配置的 Authorization 保持优先。
  return {
    [AUTHORIZATION_HEADER_NAME]: `Bearer ${apiKey}`,
    ...headers,
  };
}

function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  if (!headers) {
    return false;
  }
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
}

function normalizeAnthropicBaseURL(baseURL: string | undefined): string | undefined {
  const trimmed = baseURL?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/u, "");
    if (pathname.toLowerCase().endsWith("/v1")) {
      url.pathname = pathname;
      return url.href;
    }

    // Anthropic's AI SDK provider appends /messages to baseURL, so explicit
    // gateway roots must include the /v1 API prefix at the adapter boundary.
    url.pathname = `${pathname}/v1`;
    return url.href;
  } catch {
    const withoutTrailingSlash = trimmed.replace(/\/+$/u, "");
    return withoutTrailingSlash.toLowerCase().endsWith("/v1")
      ? withoutTrailingSlash
      : `${withoutTrailingSlash}/v1`;
  }
}

export function createProviderBusinessErrorFetch(
  options: ProviderBusinessErrorFetchOptions,
): ProviderFetch {
  const baseFetch = createProviderProxyFetch(options);

  return async (input, init) => {
    let response: Response;
    try {
      response = await baseFetch(input, init);
    } catch (error) {
      throw normalizeModelTlsFailure(error);
    }

    // zcode-plan 安全校验拒绝（3007）等场景返回 HTTP 403 + JSON，但未必带
    // Content-Type: application/json。若只在启发式命中时才读 body，fetch 会把 403 原样交给
    // AI SDK，流式请求可能以空 completion 结束，core 最终误报 suspicious empty。
    if (!response.ok) {
      const nonOkBusinessError = await detectProviderBusinessError(response, options);
      if (nonOkBusinessError) {
        await consumeBusinessErrorResponseBodyBestEffort(response);
        throw nonOkBusinessError;
      }
    }

    if (responseMayContainSseBusinessError(response)) {
      return createProviderBusinessErrorSseResponse(response, options);
    }

    const businessError = await detectProviderBusinessError(response, options);
    if (businessError) {
      await consumeBusinessErrorResponseBodyBestEffort(response);
      throw businessError;
    }
    return response;
  };
}

async function consumeBusinessErrorResponseBodyBestEffort(response: Response): Promise<void> {
  const body = response.body;
  if (!body) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // 业务错误检测消费的是 response.clone()；只 cancel 原始 tee 分支时，
    // Undici 的 cancel Promise 完成也不保证连接已可复用，连续 429 仍会耗尽连接槽。
    // 已识别的业务错误体受 64KB 上限保护，完整消费原始分支后连接才能稳定复用；
    // 异常 stream 永不收敛时则由清理上限兜底，不能阻塞已经解析出的原始错误。
    await Promise.race([
      response.arrayBuffer().then(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, PROVIDER_BUSINESS_ERROR_BODY_CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // 清理失败不能覆盖已经解析出的 provider 原始错误。
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

interface ProviderProxyFetchOptions {
  caCertFile?: string;
  env?: EnvRecord;
  fetch?: ProviderFetch;
  httpProxy?: string;
  noProxy?: string;
}

function createProviderProxyFetch(options: ProviderProxyFetchOptions): ProviderFetch {
  // Node 的 global fetch 不会自动读取 HTTP_PROXY/http_proxy。
  // 模型 provider 和 MCP HTTP transport 都复用同一层 proxy-aware fetch，避免多套出口规则漂移。
  return createNetworkProxyFetch(options);
}

/**
 * 模型请求出口：官方 Coding Plan 端点经 XCode 平台网关发送（做套餐权益校验等平台侧处理），
 * 其余 provider 直连；之后统一进入用户 HTTP 代理 fetch，httpProxy / noProxy 按实际发送地址判定。
 * 官方端点与网关端点的对应关系见 official-coding-plan-gateway.ts。
 */
function createProviderTransportFetch(options: ProviderProxyFetchOptions): ProviderFetch {
  return createOfficialCodingPlanGatewayFetch({
    env: options.env,
    fetch: createProviderProxyFetch(options),
  });
}

async function detectProviderBusinessError(
  response: Response,
  options: ProviderBusinessErrorFetchOptions,
): Promise<ProviderBusinessError | undefined> {
  if (!responseMayContainBusinessJson(response)) {
    return undefined;
  }

  let body: unknown;
  try {
    const text = await readLimitedResponseText(response);
    if (text === undefined || text.trim().length === 0) {
      return undefined;
    }
    body = JSON.parse(text);
  } catch {
    return undefined;
  }

  const failure = readProviderBusinessFailureFromBody(body);
  if (!failure) {
    return undefined;
  }

  return new ProviderBusinessError({
    providerCode: failure.providerCode,
    providerId: options.providerId,
    providerKind: options.providerKind,
    providerMessage: failure.providerMessage,
    providerRequestId: failure.providerRequestId,
    responseBodySummary: failure.responseBodySummary,
    // fetch 层的 ProviderBusinessError 会绕过 APICallError；
    // 不保留响应头会导致 retry-after/retry-after-ms 在重试计算前丢失。
    responseHeaders: responseHeadersToRecord(response.headers),
    responseStatus: response.status,
    statusCode: failure.statusCode,
  });
}

/** 从 HTTP JSON body 解析 zcode-plan 等业务错误（供 failure-classifier 在 APICallError 路径复用）。 */
export function readProviderBusinessFailureFromBody(body: unknown):
  | {
      providerCode?: ProviderCode;
      providerMessage?: string;
      providerRequestId?: string;
      responseBodySummary: Record<string, unknown>;
      statusCode?: number;
    }
  | undefined {
  const record = asRecord(body);
  if (!record) {
    return undefined;
  }

  const errorRecord = asRecord(record.error);
  const providerCode =
    toProviderCode(record.providerCode) ??
    toProviderCode(errorRecord?.providerCode) ??
    toProviderCode(record.error_code) ??
    toProviderCode(errorRecord?.error_code) ??
    // 二次包装后的外层 code 是 XCode 自己的 PROVIDER_BUSINESS_ERROR，
    // 真实上游码在 providerCode；只有没有 providerCode 时才退回读取 code。
    toProviderCode(record.code) ??
    toProviderCode(errorRecord?.code);
  const providerMessage = readProviderMessage(record);
  const failedBySuccess = record.success === false;
  const failedByCode = isNonZeroProviderCode(providerCode);

  if (!failedBySuccess && !failedByCode) {
    return undefined;
  }

  return {
    providerCode,
    providerMessage,
    providerRequestId: readProviderRequestId(record),
    responseBodySummary: summarizeProviderBusinessBody(record),
    statusCode: providerCodeToStatusCode(providerCode),
  };
}

function responseMayContainBusinessJson(response: Response): boolean {
  // 非 2xx 一律尝试读 body 解析业务码（403/3007、429/3002 等），不依赖 Content-Type 猜测。
  if (!response.ok) {
    return true;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("event-stream")) {
    return false;
  }
  if (contentType.includes("json")) {
    return true;
  }

  const contentLength = parseContentLength(response.headers.get("content-length"));
  return contentLength !== undefined && contentLength <= MAX_BUSINESS_ERROR_BODY_CHARS;
}

async function readLimitedResponseText(response: Response): Promise<string | undefined> {
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > MAX_BUSINESS_ERROR_BODY_CHARS) {
    return undefined;
  }

  const clone = response.clone();
  if (!clone.body) {
    const text = await clone.text();
    return text.length > MAX_BUSINESS_ERROR_BODY_CHARS ? undefined : text;
  }

  const reader = clone.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        return text.length > MAX_BUSINESS_ERROR_BODY_CHARS ? undefined : text;
      }

      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > MAX_BUSINESS_ERROR_BODY_CHARS) {
        await reader.cancel();
        return undefined;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function responseMayContainSseBusinessError(response: Response): boolean {
  return (
    response.body !== null &&
    response.headers.get("content-type")?.toLowerCase().includes("event-stream") === true
  );
}

function responseHeadersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function createProviderBusinessErrorSseResponse(
  response: Response,
  options: ProviderBusinessErrorFetchOptions,
): Response {
  const body = response.body;
  if (!body) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const responseHeaders = responseHeadersToRecord(response.headers);

  return new Response(
    body.pipeThrough(
      createProviderBusinessErrorSseTransform(options, response.status, responseHeaders),
    ),
    {
      headers,
      status: response.status,
      statusText: response.statusText,
    },
  );
}

function createProviderBusinessErrorSseTransform(
  options: ProviderBusinessErrorFetchOptions,
  responseStatus: number,
  responseHeaders: Record<string, string>,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let streamFailed = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (streamFailed) {
        return;
      }

      pending += decoder.decode(chunk, { stream: true });
      pending = emitCompleteProviderBusinessSseFrames(
        pending,
        controller,
        encoder,
        options,
        responseStatus,
        responseHeaders,
        () => {
          streamFailed = true;
        },
      );
    },
    flush(controller) {
      if (streamFailed) {
        return;
      }

      pending += decoder.decode();
      pending = emitCompleteProviderBusinessSseFrames(
        pending,
        controller,
        encoder,
        options,
        responseStatus,
        responseHeaders,
        () => {
          streamFailed = true;
        },
      );
      if (!streamFailed && pending.length > 0) {
        emitProviderBusinessSseFrame(
          pending,
          "",
          controller,
          encoder,
          options,
          responseStatus,
          responseHeaders,
          () => {
            streamFailed = true;
          },
        );
      }
    },
  });
}

function emitCompleteProviderBusinessSseFrames(
  input: string,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  options: ProviderBusinessErrorFetchOptions,
  responseStatus: number,
  responseHeaders: Record<string, string>,
  markFailed: () => void,
): string {
  let pending = input;
  for (;;) {
    const match = SSE_FRAME_SEPARATOR_PATTERN.exec(pending);
    if (!match) {
      return pending;
    }

    const separator = match[0] ?? "";
    const frame = pending.slice(0, match.index);
    pending = pending.slice(match.index + separator.length);
    const emitted = emitProviderBusinessSseFrame(
      frame,
      separator,
      controller,
      encoder,
      options,
      responseStatus,
      responseHeaders,
      markFailed,
    );
    if (!emitted) {
      return "";
    }
  }
}

function emitProviderBusinessSseFrame(
  frame: string,
  separator: string,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  options: ProviderBusinessErrorFetchOptions,
  responseStatus: number,
  responseHeaders: Record<string, string>,
  markFailed: () => void,
): boolean {
  const failure = detectProviderBusinessSseFrameFailure(frame);
  if (failure) {
    // 部分 OpenAI-compatible provider 只在 HTTP 200 SSE error frame 中报告业务错误；
    // 同时保留原始响应头，保证限流场景的 retry-after 能进入后续重试退避。
    controller.error(
      new ProviderBusinessError({
        providerCode: failure.providerCode,
        providerId: options.providerId,
        providerKind: options.providerKind,
        providerMessage: failure.providerMessage,
        providerRequestId: failure.providerRequestId,
        responseBodySummary: failure.responseBodySummary,
        responseHeaders,
        responseStatus,
        statusCode: failure.statusCode,
      }),
    );
    markFailed();
    return false;
  }

  controller.enqueue(encoder.encode(`${frame}${separator}`));
  return true;
}

function detectProviderBusinessSseFrameFailure(frame: string):
  | {
      providerCode?: ProviderCode;
      providerMessage?: string;
      providerRequestId?: string;
      responseBodySummary: Record<string, unknown>;
      statusCode?: number;
    }
  | undefined {
  const sse = readSseFrame(frame);
  const data = sse.data?.trim();
  if (!data || data === "[DONE]") {
    return undefined;
  }

  const body = safeParseRecord(data);
  if (!body) {
    return undefined;
  }

  const businessFailure = readProviderBusinessFailureFromBody(body);
  if (businessFailure) {
    return {
      ...businessFailure,
      providerRequestId: readProviderRequestId(body),
    };
  }

  if (sse.event?.toLowerCase() !== "error") {
    return undefined;
  }

  const errorRecord = asRecord(body.error);
  const providerCode =
    toProviderCode(body.providerCode) ??
    toProviderCode(errorRecord?.providerCode) ??
    toProviderCode(body.error_code) ??
    toProviderCode(errorRecord?.error_code) ??
    // 包装码不能覆盖真实 providerCode。
    toProviderCode(body.code) ??
    toProviderCode(errorRecord?.code);

  return {
    providerCode,
    providerMessage: readProviderMessage(body),
    providerRequestId: readProviderRequestId(body),
    responseBodySummary: summarizeProviderBusinessBody(body),
    statusCode: providerCodeToStatusCode(providerCode),
  };
}

function readSseFrame(frame: string): { data?: string; event?: string } {
  const dataLines: string[] = [];
  let event: string | undefined;
  for (const rawLine of frame.split(/\r\n|\n|\r/)) {
    if (rawLine.startsWith("event:")) {
      event = trimSseFieldValue(rawLine.slice("event:".length));
      continue;
    }
    if (!rawLine.startsWith("data:")) {
      continue;
    }

    dataLines.push(trimSseFieldValue(rawLine.slice("data:".length)));
  }

  return {
    data: dataLines.length === 0 ? undefined : dataLines.join("\n"),
    event,
  };
}

function trimSseFieldValue(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value;
}

function safeParseRecord(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function isNonZeroProviderCode(value: ProviderCode | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value !== 0;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric !== 0 : true;
}

function providerCodeToStatusCode(value: ProviderCode | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const statusCode = Math.trunc(value);
    return isHttpStatusCode(statusCode) ? statusCode : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const statusCode = Number(normalized);
  return isHttpStatusCode(statusCode) ? statusCode : undefined;
}

function isHttpStatusCode(value: number): boolean {
  return Number.isInteger(value) && value >= 100 && value <= 599;
}

function toProviderCode(value: unknown): ProviderCode | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const normalized = value.trim();
    return normalized.toUpperCase() === PROVIDER_BUSINESS_ERROR_WRAPPER_CODE
      ? undefined
      : normalized;
  }
  return undefined;
}

function readProviderMessage(record: Record<string, unknown>): string | undefined {
  const errorRecord = asRecord(record.error);
  return (
    normalizeProviderMessage(record.msg) ??
    normalizeProviderMessage(record.message) ??
    normalizeProviderMessage(errorRecord?.msg) ??
    normalizeProviderMessage(errorRecord?.message) ??
    normalizeProviderMessage(record.error)
  );
}

function readProviderRequestId(record: Record<string, unknown>): string | undefined {
  const errorRecord = asRecord(record.error);
  return (
    normalizeProviderId(record.request_id) ??
    normalizeProviderId(record.requestId) ??
    normalizeProviderId(record.id) ??
    normalizeProviderId(errorRecord?.request_id) ??
    normalizeProviderId(errorRecord?.requestId) ??
    normalizeProviderId(errorRecord?.id)
  );
}

function normalizeProviderMessage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.length > MAX_PROVIDER_MESSAGE_CHARS
    ? `${normalized.slice(0, MAX_PROVIDER_MESSAGE_CHARS)}...`
    : normalized;
}

function normalizeProviderId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.length > MAX_PROVIDER_MESSAGE_CHARS
    ? `${normalized.slice(0, MAX_PROVIDER_MESSAGE_CHARS)}...`
    : normalized;
}

function summarizeProviderBusinessBody(record: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    keys: Object.keys(record).slice(0, 20),
  };

  copyScalar(record, summary, "success");
  copyScalar(record, summary, "code");
  copyScalar(record, summary, "error_code");
  copyScalar(record, summary, "msg");
  copyScalar(record, summary, "message");
  copyScalar(record, summary, "request_id");
  copyScalar(record, summary, "requestId");

  const errorRecord = asRecord(record.error);
  if (errorRecord) {
    const errorSummary: Record<string, unknown> = {
      keys: Object.keys(errorRecord).slice(0, 20),
    };
    copyScalar(errorRecord, errorSummary, "code");
    copyScalar(errorRecord, errorSummary, "error_code");
    copyScalar(errorRecord, errorSummary, "msg");
    copyScalar(errorRecord, errorSummary, "message");
    copyScalar(errorRecord, errorSummary, "request_id");
    copyScalar(errorRecord, errorSummary, "requestId");
    copyScalar(errorRecord, errorSummary, "type");
    summary.error = errorSummary;
  }

  return summary;
}

function copyScalar(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    target[key] = value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
