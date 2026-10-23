/* eslint-disable max-lines -- AI SDK 模型执行装配集中维护 provider factory、鉴权和网络错误适配，拆分会让状态同步更脆弱。 */
// ============================================================
// Vercel AI SDK model execution
// ============================================================

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  applyBuildAgentSignature,
  mintSessionId,
  OPENCODE_FREE_USER_AGENT,
} from "./opencode-build-agent.js";
import type { createModelRequestSecurityState } from "./request-security-edition/index.js";
import type { ModelRequestSecurityPort } from "./request-security.js";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import {
  compileModelOptionMaps,
  type CompiledModelOptionMaps,
  type ModelOptionValues,
} from "@zcode/model-option-map";
import {
  getCurrentModelInvocationContext,
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
import { createNetworkProxyFetch, type NetworkProxyFetchOptions } from "../network/proxy-fetch.js";
import {
  createProviderProxyFetch,
  resolveProviderProxyAccountId,
} from "../network/provider-proxy-fetch.js";
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
  /**
   * XCode fork：本次请求实际使用的连接（账号）id，由 requestAuth 的 connectionId 合入
   * （见 applyModelRequestAuth）。
   *
   * Qoder / CodeBuddy 的账号身份本来就能从 headers / apiKey 反解，这里是给
   * **zhipu-account（zai / bigmodel Coding Plan）** 用的：它们的账号是宿主侧 OAuth 账号，
   * agent 侧没有可反解的身份，只有宿主轮询选中的 accountRef。
   */
  accountId?: string;
  /**
   * XCode fork：供应商级代理绑定（provider config 的 api.proxy）。
   * 只影响本供应商的模型请求，与全局 httpProxy 完全独立，未配置即直连。
   */
  proxy?: RegistryProviderConfig["api"]["proxy"];
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
  requestObservations?: ModelRequestSecurityPort;
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
    // 供应商级代理：包在 transport 之外、requestProfile 之内侧——
    // 代理只负责「这一跳走哪个出口」，不应看到 qoder 签名/opencode 指纹改写后的请求。
    const providerTransport = createProviderProxyFetch({
      binding: providerConfig.proxy ?? undefined,
      providerId,
      // 账号身份在 factory 创建时解析：per-account 的 requestAuth 已在此前合入
      // providerConfig（applyModelRequestAuth），此处拿到的就是该账号的准确值。
      // headers/apiKey 反解不到的供应商（zhipu-account）用宿主下发的 accountId 兜底。
      accountId:
        resolveProviderProxyAccountId({
          headers: providerConfig.headers,
          apiKey:
            providerConfig.access.type !== "zhipu-account"
              ? providerConfig.access.apiKey ?? undefined
              : undefined,
        }) ?? providerConfig.accountId,
      fetch: this.resolveProviderTransport(providerId),
      caCertFile: this.network.caCertFile,
      env: this.env,
      // 轮询在 fetch 时才挑池；把真实命中的节点回报给调用级上下文，
      // 记账层据此写具体池名，而不是候选数量。
      onResolvedPool: (entry) => {
        getCurrentModelInvocationContext()?.reportResolvedEgress?.({
          proxyPoolId: entry.id,
          ...(entry.name ? { proxyDisplayName: entry.name } : {}),
        });
      },
    });
    const profiledTransport = createUpstreamRequestProfileFetch({
      profile: providerConfig.requestProfile ?? undefined,
      kind: providerConfig.kind,
      headers: providerConfig.headers,
      baseUrl: providerConfig.baseURL,
      apiKey:
        providerConfig.access.type !== "zhipu-account"
          ? providerConfig.access.apiKey ?? undefined
          : undefined,
      fetch: providerTransport,
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
    // 供应商级代理绑定随 provider config 一起冻结进快照；请求期由
    // createProviderProxyFetch 按账号解析（该账号未绑定池就跟随全局代理），改绑定无需重启。
    ...(config.api.proxy == null ? {} : { proxy: config.api.proxy }),
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
    // zhipu-account 没有可反解的账号身份（见 AiSdkProviderConfig.accountId），
    // 连接级代理绑定只能靠宿主下发的 connectionId 命中。
    ...(requestAuth.connectionId ? { accountId: requestAuth.connectionId } : {}),
    ...(requestAuth.headers
      ? { headers: mergeModelRequestHeaders(providerConfig.headers, requestAuth.headers) }
      : {}),
  };
}

// ============================================================
// XCode fork：OpenCode 免费档请求画像（requestProfile = "opencode-free-tier"）
//
// OpenCode Zen 的免费模型带客户端闸门（403 FreeTierError "free tier can only
// be used from within OpenCode"）。
//
// 【2026-10-13 实测分层结论（60+ 组，均为 opencode.ai/zen/v1/chat/completions 直连）】
//
// 【对照组（重要，证明非网络/地区因素）】官方 CLI @opencode/cli-windows-x64@2.0.28
// （212MB，从 `curl -fsSL https://opencode.ai/v2/install | bash` 追 npm 包获得；
// 注意旧分发线 @opencode-ai/cli-windows-x64@1.18.18 只有 serve/api 外壳、没有
// run/models/auth，别拿错包）在本机匿名跑 `opencode run --model
// opencode/mimo-v2.6-flash-free "say hi"` **成功返回 "Hi"**。
//
// 【已抓到的官方真实请求形态】把 CLI 的 provider baseURL 指到本地捕获 server
// （HOME 沙箱隔离，未动用户真实配置），拿到它真实发出的 header 与 body：
//   authorization:      Bearer public          ← 确实就是 public
//   user-agent:         opencode/latest/2.0.28/cli   ← 四段式，非 opencode/1.x
//   x-opencode-client:  cli
//   x-opencode-project: <40位十六进制 项目 hash>
//   x-opencode-session / x-opencode-session-id / x-session-id / x-session-affinity:
//                       <同一个 ses_ id>        ← 四个 session 相关头同值
//   b3 / traceparent:   <同一条 trace id>
//   body:               ~22KB，含完整 agent system prompt（"You are an AI agent
//                       running in OpenCode, a coding agent harness..."）+ 工具定义
//
// 已逐一排除、确认**无效**的方向（都不放行）：
//   1. 版本号：opencode/1.18.31、1.19.0、完整 Electron UA、无 UA、
//      以及官方真实四段式 UA opencode/latest/2.0.28/cli —— 全部 403。
//   2. `Authorization: Bearer public` 的有无 —— 带与不带全部 403。
//   3. x-opencode-client：desktop / cli / web —— 全部 403。
//   4. session/request/project 的真实性：占位 ID 与**官方桌面端真实产生过的**
//      40 位 project id + 真实 session id —— 全部 403（2026-10-16 查明原因：
//      session 必须**每次新生**——占位值解码后 counter=4095、复用过的真实值
//      counter 也已 >63，全过不了闸门。别据此条判定「session 无关」）。
//   5. 模型选择：官方 410 提示的替代模型 mimo-v2.6-flash-free、官方日志里成功的
//      step-5-preview-free、space-bunny-free、ling-3.1-flash-free —— 全部 403。
//   6. **抓到的官方完整 header 集**（四段式 UA + x-opencode-client/project/session/
//      session-id + x-session-id + x-session-affinity + b3 + traceparent）整体照搬、
//      以及只带其中任一项的组合 —— 全部 403。说明闸门不在这批 header 上。
//
// 【2026-10-16 破解结论——上面「仍未排除」的方向已全部定位，勿再按旧结论改】
//   body 校验的真实形状：`tools` 必须**包含**那 11 个官方工具名（多带任意额外
//   工具没问题），system prompt **不作校验**——无 system、换成任意短文，实测均
//   200。header 校验的落点是 `x-opencode-session-id`：值必须合法（counter≤63 的
//   descending ID）——**缺失放行、占位/过期值必 403**（变体矩阵实测；其余三个
//   session 头任意值均不校验）。所以完整门禁 = UA(opencode/ 前缀) +
//   x-opencode-session-id(合法值) + tools 官方 11 名并集；匿名（Bearer public）
//   可直接访问，当日以本产品完整请求形态（四段式 UA + 全套 x-opencode-* 头 +
//   工具并集 + XCode 自有 system）直连实测 200，模型正常回复。
//   同日 dev 实测踩坑：包装层若只 mint x-opencode-session、其余照发配置占位值，
//   正好触发「x-opencode-session-id 存在且非法」→ 403（用户实测踩中，已修，
//   见 mergeOpenCodeSessionHeader 注释）。
//
// 【上游源码证据】官方桌面端 asar（node-DaUPSCrz.js）opencode provider 装载逻辑：
//     const hasKey = Boolean(process.env.OPENCODE_API_KEY || connected
//                            || item2.provider.request.body.apiKey);
//     if (!hasKey) provider9.request.body.apiKey = "public";
//     if (hasKey) return;
//     // 无 key 时继续把收费模型逐个 disable
// 【CLI 二进制交叉验证（1.18.18，历史，结论部分作废）】曾从官方
// @opencode-ai/cli-windows-x64 1.18.18 的 lildax.exe（127MB，**旧分发线**，见上
// 「别拿错包」）得出「官方不发 x-opencode-* 头」——该结论已被 2.0.28 真实抓包
// （四个 session 头同值，见上）推翻，session 头确为闸门要素之一。
// 从该分析保留下来仍有效的只有一条：`"public"` 是官方无 key 时的兜底值，本产品
// 的 `Bearer public` 与官方匿名路径一致，是正确的匿名凭证（上一轮曾误判为假凭证
// 删掉，已恢复）。
//
// 【hasKey 逻辑定位】官方 asar 里 hasKey = 环境变量 OPENCODE_API_KEY || connected
// || 请求体已有 apiKey；它只决定**客户端自己**往 body 写不写 `"public"`，属于
// 客户端行为，**不是服务端闸门**。服务端放行条件最终定位为：UA + 新 mint 的
// session + tools 官方 11 名并集（见上方 2026-10-16 结论）。
// 此前「匿名用不了」的误判根源是 session 头用了占位/事后复用的旧 ID——session 必须
// 按算法新生（counter≤63，见 opencode-build-agent.ts 的 mintSessionId），旧值
// （counter 已超限或过期）必 403。
//
// 【同机对照（历史）】官方桌面端在同机同网下用 mimo-v2.6-flash-free 成功
// （其 opencode.log 可见该模型 stream 成功且无 error），证明不是网络/地区问题，
// 而是服务端认客户端身份——身份要素最终定位为上述三项。
//
// 【2026-10-18 端点迁移（当前生效）】官方 CLI 1.19.0 已把 chat 端点迁到
//   https://opencode.ai/inference/openai/v1/chat/completions；旧 /zen/v1 走独立
//   额度桶，稳定返回 429 FreeUsageLimitError。新端点重跑闸门矩阵：UA /
//   session(counter≤63) / tools 11 名并集仍是放行条件；system prompt 仍**不校验**
//   （build-only、XCode 自有 system、两个 system 共存/任意顺序，四种组合全 200）。
//   模型目录改为 https://opencode.ai/inference/v1/models——`{baseUrl}/models`
//   现在是 404，host 侧 upstreamModelListFetcher 对该 profile 单独拼目录。
//
// 结论：**匿名（Bearer public）可直接访问 free 档**（2026-10-16 以本产品完整请求
// 形态直连实测 200）。真实 key 是可选的第二条路径：填 provider API Key 或设环境
// 变量 OPENCODE_API_KEY 亦可。需用 key 时注意 api.headers 里的 Authorization 优先
// 级更高、会覆盖 apiKey，应把 zcode-builtin.json 该 provider 的 Authorization 行
// 移除。
//
// 请求侧职责（与闸门无关，保持不变）：
//   1. 按模型钳制 reasoning_effort（normalizeOpenCodeReasoningFields）
//   2. 剥离 `thinking` 等不兼容字段，保留 reasoning_effort 通道
//   3. 模型档位来自 models.dev 的 reasoning_options
// ============================================================

type UpstreamRequestProfile = NonNullable<RegistryProviderConfig["requestProfile"]>;

/**
 * 把闸门所需的全套官方 header 合进请求头：UA（①）+ 4 个 session 头（②）+
 * 匿名凭证与其余 x-opencode-* 头。
 *
 * 【2026-10-16 mitm 实测（本地抓包 app 真实出站请求）三条硬事实】
 *   1. init.headers 里的 UA 是 AI SDK 的产品 UA
 *      （`XCode/3.15.2 ai-sdk/provider-utils/... runtime/node.js/...`），
 *      不以 opencode/ 开头 → 闸门①失败。旧守卫「UA 存在即不动」想保护的
 *      是配置里的官方 UA，但实际放过的恰是产品 UA——守卫必须按**前缀**判断。
 *   2. zcode-builtin.json 里 api.headers 配的 `Authorization: Bearer public`、
 *      x-opencode-client/project/request **全部没有到达请求层**（用户规则层的
 *      api.headers 反而到了），所以匿名凭证与官方头必须在这里补齐。
 *   3. session 头 4 个全 mint 成同一 fresh 值后仍 403，唯一剩余原因就是上述
 *      UA / Authorization——修掉后（见当天 devlog）实测 200。
 *
 * UA 以 opencode/ 开头才视为已配置官方形状；其余头缺失才补，避免覆盖
 * 显式配置过的值。
 */
function mergeOpenCodeSessionHeader(
  init: RequestInit | undefined,
  session: string,
): Record<string, string> {
  const base = readRequestHeaders(init?.headers);
  const uaKey = Object.keys(base).find((k) => k.toLowerCase() === "user-agent");
  if (!uaKey || !base[uaKey].startsWith("opencode/")) {
    if (uaKey) delete base[uaKey];
    base["User-Agent"] = OPENCODE_FREE_USER_AGENT;
  }
  base["x-opencode-session"] = session;
  base["x-opencode-session-id"] = session;
  base["x-session-id"] = session;
  base["x-session-affinity"] = session;
  setHeaderIfAbsent(base, "Authorization", "Bearer public");
  setHeaderIfAbsent(base, "x-opencode-client", "cli");
  setHeaderIfAbsent(base, "x-opencode-project", "global");
  // 官方形态是每请求一个 msg_<...>；旧实现发的是静态占位值。上游不校验该头，
  // 但固定值会让上游 trace 无法区分请求，这里沿用官方从 session 派生的写法。
  base["x-opencode-request"] = `msg_${session.slice(4, 18)}`;
  return base;
}

function setHeaderIfAbsent(headers: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!existing) headers[name] = value;
}

/**
 * 把 OpenCode 免费档的旧 chat 端点迁移到官方新端点。
 *
 * old: https://opencode.ai/zen/v1/chat/completions
 * new: https://opencode.ai/inference/openai/v1/chat/completions
 *
 * baseUrl 由配置层提供（可能仍是 /zen/v1），profile wrapper 只在这里做
 * 一次改写：URL 含 `opencode.ai/zen/v1` 且以 /chat/completions 结尾就替换前缀。
 * responses 族（/inference/.../responses）不做端点迁移，但旧 zen 前缀一路
 * 映射到 inference 前缀，避免同一条 URL 落到旧额度桶。
 */
export function migrateOpenCodeFreeEndpoint(url: string): string {
  if (!url.includes("opencode.ai/zen/v1")) return url;
  return url.replace("opencode.ai/zen/v1", "opencode.ai/inference/openai/v1");
}

/** 把 init.headers 的三种形态（Headers / 二元组数组 / 普通对象）拍平成一个可变字面量。 */
function readRequestHeaders(headers: RequestInit["headers"]): Record<string, string> {
  const base: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      base[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) base[key] = value;
  } else if (headers && typeof headers === "object") {
    Object.assign(base, headers);
  }
  return base;
}

function requestUrlOf(request: string | URL | { url: string }): string {
  return typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
}

/**
 * CodeBuddy 上游 host 判定（CN=copilot.tencent.com，Intl=www.codebuddy.ai）。
 * 只在 provider config 没声明 requestProfile 时兜底用：用户层 overlay 整块替换 api
 * 或旧内置配置缺字段时，靠 host 仍能把请求送进 CodeBuddy 画像。
 */
function isCodeBuddyUpstreamUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "copilot.tencent.com" || host.endsWith(".codebuddy.ai") || host === "codebuddy.ai";
  } catch {
    return false;
  }
}

/**
 * CodeBuddy 网关按客户端指纹放行：UA 必须形如 `IDE/2.x CodeBuddy/2.x`（Intl）或
 * `CLI/2.x CodeBuddy/2.x`（CN），且 X-Product / X-IDE-Type / X-IDE-Name /
 * x-requested-with / x-codebuddy-request 齐备；缺项实测回
 * `11128 request illegal`（/v3/config 侧同类 UA 校验是 `12403 check ua`）。
 * 这组头配在 zcode-builtin.json 的 api.headers 里，但用户层 overlay 曾整块替换
 * headers 把它们抹掉（见 ProviderApiConfig.overlay 的按键合并修复），所以这里
 * 按前缀兜底：UA 不是 CodeBuddy 形态就换回官方形态，其余指纹头缺失才补，不覆盖
 * 用户显式配置的值（与 opencode-free 画像的 UA 前缀守卫同构）。
 *
 * 顺带剥掉 x-qoder-* 头：那是 Qoder 目录的展示元数据，被模型导入功能误写进
 * 通用 api.headers 后会跟着请求发到 CodeBuddy，既是无意义的越界指纹，也没有
 * 任何上游语义。
 *
 * 11128 在 Intl /v2/chat/completions 上有两种含义，别混：
 *
 * ① `request illegal`（displayTips「渠道校验未通过 / 非官方客户端」）：UA 不是
 *    CodeBuddy 形态。用户层 overlay 曾整块替换 api.headers，把内置指纹头抹掉后
 *    出站变成 `User-Agent: XCode/<版本>`，这里就是那个 bug 的终点。
 * ② `first message is not system prompt`：messages[0] 不是 system。
 *
 * 2026-10-18 真机对照（stream:true，同一 token / URL / 模型）：system 开头 →
 * 200；user 开头 → 11128，UA 换成官方值或删掉都一样。会话三头（X-Conversation-
 * ID / Request-ID / Message-ID）经复测 **不是判别项**：全剥掉仍然 200。此前把它
 * 们当闸门是探针本身没带 system 造成的误判，保留只是对齐官方客户端形态和排障
 * 可读性。另注意非流式会先回 11101 `Non-stream ... not supported`，走不到 11128,
 * 所以验证闸门必须用 stream:true 探。
 */
const CODEBUDDY_FINGERPRINT_HEADERS: Record<"cn" | "intl", Record<string, string>> = {
  intl: {
    "User-Agent": "IDE/2.108.1 CodeBuddy/2.108.1",
    "X-Product": "SaaS",
    "X-IDE-Type": "IDE",
    "X-IDE-Name": "IDE",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  },
  cn: {
    "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
    "X-Product": "SaaS",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  },
};

/**
 * 会话头按官方语义分层：Conversation 在一段会话内稳定（每次装配 model factory 生成
 * 一个），Request / Message 每次请求各自新生成。上游 chat 端点不校验它们（2026-10-18
 * 复测），保留是为了与官方客户端形态一致、排障时上游 trace 能串起来。
 */
function ensureCodeBuddyConversationHeaders(
  headers: Record<string, string>,
  conversationId: string,
): void {
  setHeaderIfAbsent(headers, "X-Conversation-ID", conversationId);
  setHeaderIfAbsent(headers, "X-Conversation-Request-ID", randomUUID());
  setHeaderIfAbsent(headers, "X-Conversation-Message-ID", randomUUID());
}

function ensureCodeBuddyFingerprintHeaders(
  request: string | URL | { url: string },
  init: RequestInit | undefined,
  conversationId: string,
): RequestInit {
  const region = requestUrlOf(request).includes("copilot.tencent.com") ? "cn" : "intl";
  const headers = readRequestHeaders(init?.headers);
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith("x-qoder-")) delete headers[key];
  }

  const fingerprint = CODEBUDDY_FINGERPRINT_HEADERS[region];
  const uaKey = Object.keys(headers).find((k) => k.toLowerCase() === "user-agent");
  if (!uaKey || !headers[uaKey].includes("CodeBuddy/")) {
    if (uaKey) delete headers[uaKey];
    headers["User-Agent"] = fingerprint["User-Agent"];
  }
  for (const [name, value] of Object.entries(fingerprint)) {
    if (name !== "User-Agent") setHeaderIfAbsent(headers, name, value);
  }
  ensureCodeBuddyConversationHeaders(headers, conversationId);
  return { ...init, headers };
}

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
 * 已移除功能（「注入 Qoder IDE 身份」）的遗留键。存量配置里可能还留着它，
 * 出站前照旧摘掉，别把一条本地开关当普通 header 发给上游。
 */
const LEGACY_QODER_PERSONA_HEADER = "x-qoder-inject-persona";

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
      lowered === LEGACY_QODER_PERSONA_HEADER
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * CodeBuddy 网关接受的 `reasoning_effort` 值域（2026-10-19 对 CN 端点
 * copilot.tencent.com 逐值实测：`none/low/minimal/medium/high/xhigh/max/ultra`
 * 200，其余一律 400 + 业务码 11133；Intl 同源值域）。
 *
 * 关键区别：`none` **是合法值**，而关闭族的别名（`disabled`/`off`/`no_think`…）
 * 全部 11133。所以「关闭思考」只能发 `none` 或干脆不发，绝不能把
 * `isOffReasoningLevel` 命中的原值透传——历史实现只删字段，遇到模型配置里
 * 写着 `disabled` 的上游模型（导入时就是这么写的）仍会把它拼进 map 结果。
 */
const CODEBUDDY_REASONING_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultra",
  "max",
]);

/** 关闭族 → 网关唯一认可的关闭值。 */
const CODEBUDDY_OFF_EFFORT = "none";

/**
 * 把任意档位值收敛到 CodeBuddy 合法值域。无法判定时返回 undefined（不发该字段），
 * 因为「不发」永远比「发一个会被 11133 拒绝的值」安全。
 */
export function normalizeCodeBuddyReasoningEffort(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (CODEBUDDY_REASONING_EFFORTS.has(normalized)) return normalized;
  if (isOffReasoningLevel(normalized)) return CODEBUDDY_OFF_EFFORT;
  // 强度语义等价但拼写不同（如 extra-high / on / enabled）按 high 处理，
  // 与 reasoning-levels.ts 的秩表保持一致。
  if (normalized === "extra-high" || normalized === "extra_high") return "xhigh";
  if (normalized === "on" || normalized === "enable" || normalized === "enabled") return "high";
  if (normalized === "true") return "high";
  return undefined;
}

export function stripCodeBuddyIncompatibleReasoningFields(body: Record<string, unknown>): void {
  delete body.thinking;
  delete body.enable_thinking;
  delete body.reasoning;
  // 网关不接受任何 Anthropic / Responses 风格思考字段，只认 reasoning_effort。
  // 关闭档必须收敛成 `none`（合法）或整字段删除；透传 `disabled` 会 11133。
  const effort = body.reasoning_effort;
  if (effort === undefined) return;
  const normalized = normalizeCodeBuddyReasoningEffort(effort);
  if (normalized) {
    body.reasoning_effort = normalized;
  } else {
    delete body.reasoning_effort;
  }
}

/**
 * 上游硬约束：`messages[0]` 必须是 system，否则 400 / 11128
 * `first message is not system prompt`。产品主链路恒有 system（ContextBuilder
 * 必定产出 identity/env 块），但旁路调用（MCP sampling 无 systemPrompt、外部
 * 集成直接给 user 列表等）可能没有。这里只在缺失时补一条最小 system，不覆盖、
 * 不重排已有消息。
 */
function ensureCodeBuddyLeadingSystemMessage(body: Record<string, unknown>): void {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;
  const first = messages[0];
  if (first && typeof first === "object" && (first as { role?: unknown }).role === "system") {
    return;
  }
  messages.unshift({ role: "system", content: "You are a helpful coding assistant." });
}

function isEventStreamResponseLike(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/event-stream");
}

/**
 * CodeBuddy SSE 重写：剥掉空白 reasoning 与噪音键，保留思考的实时流式。
 *
 * 上游形态（实测 hy3 / deepseek-v4.1-flash）：
 *   - 思考阶段：连续多帧 `{reasoning_content:"思"}`；
 *   - 正文阶段：连续多帧 `{content:"答", reasoning_content:""}`；
 *   - 两阶段**不交替**（实测 228 帧纯思考 → 151 帧纯正文，同帧同时有两者为 0 帧）。
 *
 * 唯一的坑是正文帧恒带空 `reasoning_content`（`""` / `" "` / `"\n"` 都见过）。
 * AI SDK 的 openai-compatible 解析器用 `if (reasoningContent)` 判真：`" "` 和 `"\n"`
 * 都是 truthy，会让它在每个正文帧前开一次 reasoning 段、遇 `delta.content` 又立刻
 * 关掉，于是投影层把一段思考切成 N 张「思考 · 持续了几秒」卡片。
 *
 * 因此这里**只做删除**：空白 reasoning 一律剥掉，真实思考原样透传。
 * 不缓冲、不合并——上游本身已经是「一段思考 → 一段正文」，逐帧透传既能保持
 * 实时打字机效果，也不会产生多余分段。
 */
function createCodeBuddySseRewriter(): {
  push(line: string): string[];
  flush(): string[];
} {
  const rewrite = (line: string): string[] => {
    if (!line.startsWith("data:")) return [line];
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return [line];
    try {
      const chunk = JSON.parse(payload) as Record<string, unknown>;
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      for (const choice of choices) {
        const delta = (choice as Record<string, unknown>)?.delta as
          | Record<string, unknown>
          | undefined;
        if (!delta) continue;
        // 空白思考不是内容，只是网关填充：删掉它，SDK 才不会为它开一段。
        if (
          typeof delta.reasoning_content === "string" &&
          !delta.reasoning_content.trim()
        ) {
          delete delta.reasoning_content;
        }
        if (delta.refusal === "") delete delta.refusal;
        if (delta.function_call === null) delete delta.function_call;
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length === 0) {
          delete delta.tool_calls;
        }
        if (delta.extra_fields === null) delete delta.extra_fields;
      }
      return [`data: ${JSON.stringify(chunk)}`];
    } catch {
      return [line];
    }
  };

  return {
    push(line) {
      return rewrite(line);
    },
    flush() {
      return [];
    },
  };
}

function rewriteCodeBuddySseStream(response: Response): Response {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const rewriter = createCodeBuddySseRewriter();
  // SSE 里相邻的 `data:` 行属于**同一个事件**，事件之间必须有一个空行。
  // 这里统一由输出侧补事件边界（每个事件写成 `data: ...\n\n`），输入里的空行直接丢弃。
  // 之前逐行 `out + "\n"` 会让相邻事件粘成同一个，AI SDK 报
  // `Unexpected non-whitespace character after JSON`。
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, lines: string[]) => {
    for (const line of lines) {
      controller.enqueue(encoder.encode(`${line}\n\n`));
    }
  };
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        emit(controller, rewriter.push(line));
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        emit(controller, rewriter.push(buffer));
      }
      emit(controller, rewriter.flush());
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
  /** 供应商 baseURL：仅在 requestProfile 缺失时用于按 host 兜底识别 CodeBuddy。 */
  baseUrl?: string;
  fetch: ProviderFetch;
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

  // CodeBuddy 画像：剥离非 OpenAI 风格推理字段 + 保住客户端指纹头，无流式改写以外
  // 的协议改造。
  //
  // XCode fork（2026-10-19）：画像不能只靠 provider config 的 `requestProfile`。
  // 个人层 overlay 曾整块替换 api（只剩 `{proxy:null}`），旧版本内置配置也出现过
  // CN 条目缺 requestProfile 的情况；一旦缺失，这里会整段跳过，症状是：
  //   1. 思考链被拆成一堆碎片（SSE 里的空白 reasoning 没人剥）；
  //   2. 关闭档 `reasoning_effort: "disabled"` 原样上行 → 400 + 11133。
  // 因此按上游 host 兜底识别：copilot.tencent.com（CN）/ codebuddy.ai（Intl）。
  const codebuddyProfile =
    input.profile === "codebuddy" ||
    (input.profile === undefined && isCodeBuddyUpstreamUrl(input.baseUrl));
  if (codebuddyProfile) {
    const codebuddyFetch = input.fetch;
    const conversationId = randomUUID();
    return async (request, init) => {
      const method = (init?.method ?? "POST").toUpperCase();
      const rawBody = init?.body;
      const fingerprintedInit = ensureCodeBuddyFingerprintHeaders(request, init, conversationId);
      if (method !== "POST" || typeof rawBody !== "string") {
        return codebuddyFetch(request, fingerprintedInit);
      }
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return codebuddyFetch(request, fingerprintedInit);
        }
        const body = parsed as Record<string, unknown>;
        stripCodeBuddyIncompatibleReasoningFields(body);
        ensureCodeBuddyLeadingSystemMessage(body);
        // XCODE_PROFILE_DEBUG=1：落盘出站体，用于定位 11133 这类「模型侧拒绝参数」
        // 的具体字段（上游只回一句 rejected by the model provider，不带 param）。
        if (process.env.XCODE_PROFILE_DEBUG === "1") {
          try {
            // 先写一行摘要再写正文：正文可能很长，按 20k 截断会切掉 reasoning_effort
            // 这类位于 messages 之后的字段，只看截断 JSON 会误判「没发」。
            const summary = {
              model: body.model,
              stream: body.stream,
              reasoning_effort: body.reasoning_effort,
              max_tokens: body.max_tokens,
              max_completion_tokens: body.max_completion_tokens,
              tool_choice: body.tool_choice,
              tools: Array.isArray(body.tools) ? body.tools.length : undefined,
              messages: Array.isArray(body.messages) ? body.messages.length : undefined,
            };
            appendFileSync(
              join(tmpdir(), "xcode-profile-debug.log"),
              `\n=== codebuddy request ${requestUrlOf(request)} ===\n${JSON.stringify(summary)}\n${JSON.stringify(body).slice(0, 20000)}\n`,
            );
            // 完整请求体逐条追加（JSONL），用于原样回放复现上游 400。
            appendFileSync(
              join(tmpdir(), "xcode-profile-debug-full.jsonl"),
              `${JSON.stringify({ url: requestUrlOf(request), body })}\n`,
            );
          } catch {
            // 诊断写入失败不能影响主链路。
          }
        }
        const response = await codebuddyFetch(request, {
          ...fingerprintedInit,
          body: JSON.stringify(body),
        });
        // 网关的 SSE chunk 恒带空的 reasoning_content（与正文逐 token 交替），
        // 解析端会把每次空思考当成一步导致回复碎裂；流式剥掉空键。
        if (isEventStreamResponseLike(response)) {
          return rewriteCodeBuddySseStream(response);
        }
        return response;
      } catch {
        return codebuddyFetch(request, fingerprintedInit);
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
    // OpenCode free 闸门第二层：本请求的 session ID（counter ≤ 63 的 descending ID）。
    // 每次请求新建一个，与真实客户端同分布；避免固定值被上游按指纹/频率识别。
    let session = mintSessionId();
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
    // 端点迁移（2026-10-18）：官方 CLI 已切到 /inference/openai/v1，旧 /zen/v1 稳定
    // 429。配置文件可能仍写 /zen/v1（本地源或远端刷新刷回），这里强制改写——
    // 否则配置层一个 semver 之外的字段就足以把免费档再次打回旧额度桶。
    const migratedUrl = migrateOpenCodeFreeEndpoint(url);
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
      // OpenCode free 档闸门第三层：请求形态必须命中 build agent 签名
      // （官方 system prompt + 11 工具 + tool_choice:auto），否则 403 FreeTierError。
      // 无 system 时才前置注入，避免覆盖产品自己的 prompt 体系。
      applyBuildAgentSignature(body);
    }
    const nextInit = { ...init, body: JSON.stringify(body), headers: mergeOpenCodeSessionHeader(init, session) };
    let response: Response;
    try {
      response = await baseFetch(migratedUrl, nextInit);
      // OpenCode free 闸门第二层：session 被拒时重新 mint 一个再试一次。
      if (response.status === 403 && url.includes("/chat/completions")) {
        try {
          const errorText = await response.clone().text();
          if (/FreeTierError/.test(errorText)) {
            session = mintSessionId();
            const retryInit = { ...nextInit, headers: mergeOpenCodeSessionHeader(init, session) };
            response = await baseFetch(migratedUrl, retryInit);
          }
        } catch {
          // 读错误体失败时不阻断，按原响应上抛。
        }
      }
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
  // 全局代理路径：错误归一化这一层不关心供应商级绑定，只认全局 httpProxy / noProxy。
  const baseFetch = createNetworkProxyFetch({
    caCertFile: options.caCertFile,
    env: options.env,
    fetch: options.fetch,
    httpProxy: options.httpProxy,
    noProxy: options.noProxy,
  });

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

/**
 * 模型请求出口：官方 Coding Plan 端点经 XCode 平台网关发送（做套餐权益校验等平台侧处理），
 * 其余 provider 直连；之后统一进入**全局** HTTP 代理 fetch，httpProxy / noProxy 按实际发送地址判定。
 * 官方端点与网关端点的对应关系见 official-coding-plan-gateway.ts。
 *
 * 注意：这里是**全局代理**路径（读 this.network.httpProxy），与供应商级代理池
 * createProviderProxyFetch（306 行那条，走 provider config 的 api.proxy）是两条独立链路，
 * 互不 fallback。全局没配就直连。
 */
function createProviderTransportFetch(options: NetworkProxyFetchOptions): ProviderFetch {
  return createOfficialCodingPlanGatewayFetch({
    env: options.env,
    fetch: createNetworkProxyFetch(options),
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
