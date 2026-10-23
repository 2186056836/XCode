import type { ModelRequestSecurityState } from "./request-security.js";
// ============================================================
// Vercel AI SDK model runner
// ============================================================

import {
  ModelErrorCode,
  ModelProtocolError,
  getCurrentModelInvocationContext,
} from "@zcode/contracts";
import type {
  Logger,
  Model,
  ModelOptions,
  ModelRequestAuth,
  ModelRequestDependencies,
  ModelRequestAuthSourceInput,
  ModelStatusSink,
  ModelStreamEvent,
  ModelTextResult,
} from "@zcode/contracts";
import type { RegistryModelConfig, RegistryProviderConfig } from "@zcode/provider";
import {
  AiSdkModelExecution,
  type AiSdkResolvedModel,
  type AiSdkNetworkConfig,
  type AiSdkModelExecutionConfig,
  type EnvRecord,
} from "./model-execution.js";
import {
  resolveAiSdkModelRetryOptions,
  type AiSdkModelRetryOptions,
  type ResolvedAiSdkModelRetryOptions,
} from "./retry-policy.js";
import { resolveRetryOptionsForBudget } from "./retry-budget.js";
import { DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS } from "./stream-idle-timeout.js";
import { runGenerateText } from "./runner-generate.js";
import { runStreamText } from "./runner-stream.js";
import { normalizeReasoningHistory } from "./reasoning-history-normalization.js";
import {
  defaultRuntime,
  type AiSdkModelRuntime,
  type AiSdkModelTextRequest,
  type ResolvedAiSdkModel,
} from "./runner-runtime.js";
import { resolveToolSearchCapability } from "./tool-search.js";
import { createModel, type ModelExecutionRequest } from "./model.js";
import { refreshOffPeakRequestAuth } from "./off-peak-request-auth.js";

export type { AiSdkModelRetryOptions } from "./retry-policy.js";
export type {
  AiSdkGenerateTextOptions,
  AiSdkGenerateTextResult,
  AiSdkModelRuntime,
  AiSdkModelTextRequest,
  AiSdkStreamTextOptions,
  AiSdkStreamTextResult,
} from "./runner-runtime.js";
export { normalizeUsage, toModelStreamEvent } from "./runner-normalization.js";

export interface AiSdkModelAdapterOptions {
  defaultHeaders?: AiSdkModelExecutionConfig["defaultHeaders"];
  requestSecurityState?: ModelRequestSecurityState;
  endpointRoutingPort?: import("@zcode/contracts").ProviderEndpointRoutingPort;
  network?: AiSdkNetworkConfig;
  runtime?: AiSdkModelRuntime;
  env?: EnvRecord;
  debugDir?: string;
  logger?: Logger;
  retry?: AiSdkModelRetryOptions;
  statusSink?: ModelStatusSink;
  streamIdleTimeoutMs?: number;
  modelIoFullRetentionEnabled?: boolean;
}

export interface CreateAiSdkModelOptions {
  providerId: string;
  modelId: string;
  providerConfig: RegistryProviderConfig;
  modelConfig: RegistryModelConfig;
  displayName?: string;
  options?: ModelOptions;
  requestDependencies?: ModelRequestDependencies;
}

export class AiSdkModelAdapter {
  private readonly execution: AiSdkModelExecution;
  private readonly runtime: AiSdkModelRuntime;
  private readonly env: EnvRecord;
  private readonly debugDir?: string;
  private readonly logger?: Logger;
  private readonly retry: ResolvedAiSdkModelRetryOptions;
  private statusSink?: ModelStatusSink;
  private readonly streamIdleTimeoutMs: number;
  private modelIoFullRetentionEnabled: boolean;

  constructor(options: AiSdkModelAdapterOptions) {
    this.execution = new AiSdkModelExecution(
      {
        defaultHeaders: options.defaultHeaders,
        ...(options.endpointRoutingPort
          ? { endpointRoutingPort: options.endpointRoutingPort }
          : {}),
        ...(options.network ? { network: options.network } : {}),
        ...(options.env ? { env: options.env } : {}),
      },
      {
        ...(options.requestSecurityState
          ? { requestSecurityState: options.requestSecurityState }
          : {}),
        ...(options.logger ? { logger: options.logger } : {}),
      },
    );
    this.runtime = options.runtime ?? defaultRuntime;
    this.env = options.env ?? process.env;
    this.debugDir = options.debugDir;
    this.logger = options.logger;
    this.retry = resolveAiSdkModelRetryOptions(options.retry, this.env);
    this.statusSink = options.statusSink;
    this.streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS;
    this.modelIoFullRetentionEnabled = options.modelIoFullRetentionEnabled ?? false;
  }

  setModelIoFullRetentionEnabled(enabled: boolean): void {
    this.modelIoFullRetentionEnabled = enabled;
  }

  addStatusSink(sink: ModelStatusSink): void {
    const current = this.statusSink;
    if (!current || current === sink) {
      this.statusSink = sink;
      return;
    }
    this.statusSink = {
      async publish(event) {
        // 多个 sink 必须独立执行：任一 sink 失败不得连带影响其他 sink，
        // 也不能阻塞原有调用链。
        const results = await Promise.allSettled([
          Promise.resolve().then(() => current.publish(event)),
          Promise.resolve().then(() => sink.publish(event)),
        ]);
        const failed = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failed) throw failed.reason;
      },
    };
  }

  createModel(options: CreateAiSdkModelOptions): Model {
    const boundResolution = this.execution.bindModel({
      providerId: options.providerId,
      modelId: options.modelId,
      providerConfig: options.providerConfig,
      supportsJsonSchemaOutput: options.modelConfig.properties.supportsJsonSchemaOutput,
      optionSpecs: options.modelConfig.optionSpecs,
    });
    const properties = options.modelConfig.properties;
    const resolved = {
      ...boundResolution.resolved,
      properties,
      ...(options.providerConfig.access.type === "zhipu-account"
        ? { accountAccess: options.providerConfig.access }
        : {}),
    };
    const optionSpecs = options.modelConfig.optionSpecs;
    const toLegacyRequest = (request: ModelExecutionRequest): AiSdkModelTextRequest => {
      const context = getCurrentModelInvocationContext();
      const {
        refreshRuntimeHeadersBeforeAttempt: contextRefreshRuntimeHeadersBeforeAttempt,
        ...invocationContext
      } = context ?? {};
      const shouldAttachReasoningTelemetry = request.options.reasoningLevel !== undefined;
      const selectedReasoningLevel = request.options.reasoningLevel;
      const requestAuthDependency = options.requestDependencies?.requestAuth;
      // Bug 根因：加速卡（highspeed）与 Off-Peak 同为 Coding Plan 派生模式，本轮动态鉴权
      // （zcode JWT + Coding Plan 双 JWT + X-Highspeed-Card-ID，见 docs/highspeed/highspeed-card-spec.md
      // §2.2）经 modelExecution.requestAuth 下发到执行作用域 Source。若门禁只认 off-peak，highspeed
      // 会落到下面的账号 runtime-header 刷新分支，把整包 requestAuth（含卡 ID）丢弃，加速请求因缺卡 ID/
      // 错误鉴权被 /api/v1/highspeed 网关判 401。两种派生免签模式必须同样消费执行作用域 Source。
      const requestAuthRequired =
        options.providerConfig.access.type === "zhipu-account" &&
        (options.providerConfig.access.mode === "off-peak" ||
          options.providerConfig.access.mode === "highspeed");
      // 调用级 runtime header Port 只服务绑定完整 Account Access 的账号型 Model；
      // 普通 API-key Model 若也消费该 Port，会把静态鉴权误送到 Host 刷新并在请求前失败。
      // 派生模式保留执行作用域票据/卡身份；Off-Peak 的 PAT 仍逐请求向原账号 owner 刷新。
      // XCode fork：Qoder / CodeBuddy 是多账号供应商，但没有 execution-scope 鉴权源。
      // 把 host 的 per-attempt 回调接上，用它做账号轮询（host 返回选中账号的
      // apiKey + Qoder 身份头；失败换号由 AccountRotationRetry 驱动）。
      // 普通 api-key 供应商不接：host 没有可返回的材料，接了只会把静态鉴权误送刷新。
      // zai / bigmodel 的 Coding Plan 账号（zhipu-account）本来就走上面的 runtime-header
      // 分支，回调已在位，因此同样受账号轮询驱动；换号与否由 host 按请求判定。
      const accountRotationEligible =
        options.providerConfig.access.type !== "zhipu-account" &&
        (options.providerConfig.requestProfile === "qoder" ||
          options.providerConfig.requestProfile === "codebuddy") &&
        contextRefreshRuntimeHeadersBeforeAttempt !== undefined;
      const providerEgressEligible = shouldAttachProviderEgressRefresh({
        accessType: options.providerConfig.access.type,
        proxy: options.providerConfig.api?.proxy,
        hasRuntimeHeadersPort: contextRefreshRuntimeHeadersBeforeAttempt !== undefined,
      });
      const refreshRuntimeHeadersBeforeAttempt = requestAuthRequired
        ? async (input: ModelRequestAuthSourceInput) => {
            const requestAuth = await requestAuthDependency?.source?.resolve(input);
            if (!hasRequestAuth(requestAuth)) {
              throw new ModelProtocolError(
                ModelErrorCode.ModelRequestAuthMissing,
                `Model request auth is unavailable: ${resolved.providerId}/${resolved.modelId}`,
              );
            }
            const refreshedAuth =
              options.providerConfig.access.type === "zhipu-account" &&
              options.providerConfig.access.mode === "off-peak"
                ? await refreshOffPeakRequestAuth({
                    auth: requestAuth,
                    input,
                    accountAccess: options.providerConfig.access,
                    refresh: contextRefreshRuntimeHeadersBeforeAttempt,
                  })
                : requestAuth;
            return { headersApplied: true, requestAuth: refreshedAuth };
          }
        : options.providerConfig.access.type === "zhipu-account"
          ? (contextRefreshRuntimeHeadersBeforeAttempt ??
            (async () => {
              throw new ModelProtocolError(
                ModelErrorCode.ModelRequestAuthMissing,
                `Account model request auth is unavailable: ${resolved.providerId}/${resolved.modelId}`,
              );
            }))
          : accountRotationEligible || providerEgressEligible
            ? contextRefreshRuntimeHeadersBeforeAttempt
            : undefined;
      return {
        toolSearchEnabled: request.toolSearchEnabled,
        messages: request.messages,
        tools: request.tools,
        responseJsonSchema: request.responseJsonSchema,
        abortSignal: request.abortSignal,
        maxOutputTokens: request.options.maxOutputTokens,
        ...invocationContext,
        ...(shouldAttachReasoningTelemetry
          ? {
              modelCall: {
                ...invocationContext.modelCall,
                reasoning: {
                  ...invocationContext.modelCall?.reasoning,
                  // 过去按 none/off 等档位名称猜测 enabled/disabled，导致 Telemetry
                  // 把 Provider 方言当成统一语义。这里只记录请求实际选择的公开档位。
                  ...(selectedReasoningLevel ? { requestedLevel: selectedReasoningLevel } : {}),
                },
              },
            }
          : {}),
        ...(refreshRuntimeHeadersBeforeAttempt
          ? {
              refreshRuntimeHeadersBeforeAttempt: (input) =>
                refreshRuntimeHeadersBeforeAttempt({
                  ...input,
                  ...(options.providerConfig.access.type === "zhipu-account"
                    ? { accountAccess: options.providerConfig.access }
                    : {}),
                }),
            }
          : {}),
      };
    };
    const resolveForRequest = (
      request: AiSdkModelTextRequest,
      optionValues: Required<ModelOptions>,
    ): ((requestAuth?: ModelRequestAuth) => ResolvedAiSdkModel) => {
      const maxOutputTokens = requireMaxOutputTokens(optionValues);
      return request.refreshRuntimeHeadersBeforeAttempt
        ? (requestAuth) => ({
            ...assertSameBoundModel(
              resolved,
              boundResolution.resolveRequest({
                options: {
                  maxOutputTokens,
                  reasoningLevel: optionValues.reasoningLevel,
                },
                requestAuth,
              }),
            ),
            properties,
            ...(options.providerConfig.access.type === "zhipu-account"
              ? { accountAccess: options.providerConfig.access }
              : {}),
          })
        : () => ({
            ...boundResolution.resolveRequest({
              options: {
                maxOutputTokens,
                reasoningLevel: optionValues.reasoningLevel,
              },
            }),
            properties,
            ...(options.providerConfig.access.type === "zhipu-account"
              ? { accountAccess: options.providerConfig.access }
              : {}),
          });
    };
    return createModel({
      requestCapabilities: {
        toolSearch: resolveToolSearchCapability(
          options.providerConfig.api.type,
          options.providerConfig.access,
        ),
      },
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      displayName: options.displayName,
      properties,
      optionSpecs: {
        maxOutputTokens: optionSpecs.maxOutputTokens,
        reasoningLevel: optionSpecs.reasoningLevel,
      },
      options: options.options,
      executor: {
        generateText: (request) => {
          const legacyRequest = toLegacyRequest(request);
          return this.generateTextWithResolved(
            legacyRequest,
            resolved,
            resolveForRequest(legacyRequest, request.options),
          );
        },
        streamText: (request) => {
          const legacyRequest = toLegacyRequest(request);
          return this.streamTextWithResolved(
            legacyRequest,
            resolved,
            resolveForRequest(legacyRequest, request.options),
          );
        },
      },
    });
  }

  private generateTextWithResolved(
    request: AiSdkModelTextRequest,
    resolved: ResolvedAiSdkModel,
    resolveModel: () => ResolvedAiSdkModel,
  ): Promise<ModelTextResult> {
    const projectedRequest = projectRequestHistory(request, resolved);
    return runGenerateText({
      debugDir: this.debugDir,
      env: this.env,
      logger: this.logger,
      request: projectedRequest,
      resolveModel,
      resolved,
      retry: resolveRetryOptionsForBudget(this.retry, projectedRequest.modelRetryBudget),
      runtime: this.runtime,
      statusSink: this.statusSink,
      modelIoFullRetentionEnabled: this.modelIoFullRetentionEnabled,
    });
  }

  private async *streamTextWithResolved(
    request: AiSdkModelTextRequest,
    resolved: ResolvedAiSdkModel,
    resolveModel: () => ResolvedAiSdkModel,
  ): AsyncGenerator<ModelStreamEvent> {
    const projectedRequest = projectRequestHistory(request, resolved);
    yield* runStreamText({
      debugDir: this.debugDir,
      env: this.env,
      logger: this.logger,
      request: projectedRequest,
      resolveModel,
      resolved,
      // single-attempt 预算（带 selectionFallback 的执行作用域句柄）把 maxAttempts 收敛为 1。
      retry: resolveRetryOptionsForBudget(this.retry, projectedRequest.modelRetryBudget),
      runtime: this.runtime,
      statusSink: this.statusSink,
      streamIdleTimeoutMs: this.streamIdleTimeoutMs,
      modelIoFullRetentionEnabled: this.modelIoFullRetentionEnabled,
    });
  }
}

/**
 * 无账号供应商是否要接入 host 的 per-attempt 回调。
 *
 * 背景：Qoder / CodeBuddy 靠 `requestProfile` 判定是否接入，OpenCode Free / Kilo Free
 * 这类免费供应商没有账号，但可以配 provider 级出口策略（轮询 / 随机）。不接入的话，
 * host 侧 `resolveConnectionEgress` 永远不会执行，「使用详情」只能显示「跟随全局」，
 * 看不出请求实际从哪个池出站。
 *
 * host 对这类供应商返回的 requestAuth 只带出口记账字段（没有 apiKey），adapter 拿到后
 * 仍用 provider config 的静态鉴权发请求，因此接入不会污染鉴权。
 */
export function shouldAttachProviderEgressRefresh(input: {
  accessType: string;
  proxy: { provider?: { pools?: readonly unknown[] } } | null | undefined;
  hasRuntimeHeadersPort: boolean;
}): boolean {
  if (!input.hasRuntimeHeadersPort) return false;
  // zhipu-account 的 Coding Plan 走独立的鉴权刷新分支，不需要这条补充判定。
  if (input.accessType === "zhipu-account") return false;
  const pools = input.proxy?.provider?.pools;
  return Array.isArray(pools) && pools.length > 0;
}

function requireMaxOutputTokens(options: ModelOptions): number {
  if (options.maxOutputTokens === undefined) {
    throw new ModelProtocolError(
      ModelErrorCode.InvalidModelRequest,
      "maxOutputTokens requires an explicit request value",
    );
  }
  return options.maxOutputTokens;
}

function hasRequestAuth(
  requestAuth: ModelRequestAuth | undefined,
): requestAuth is ModelRequestAuth {
  if (requestAuth?.apiKey?.trim()) return true;
  return Object.values(requestAuth?.headers ?? {}).some((value) => value.trim().length > 0);
}

function assertSameBoundModel(
  bound: ResolvedAiSdkModel,
  refreshed: AiSdkResolvedModel,
): AiSdkResolvedModel {
  if (bound.providerId !== refreshed.providerId || bound.modelId !== refreshed.modelId) {
    throw new Error("Runtime header refresh changed the bound model identity.");
  }
  return refreshed;
}

function projectRequestHistory(
  request: AiSdkModelTextRequest,
  resolved: ResolvedAiSdkModel,
): AiSdkModelTextRequest {
  if (resolved.providerKind !== "anthropic") return request;

  // 结构归一化过去位于每次物理请求都会经过的 serializer，签名修复重试
  // 因而会再次删除上一轮刚补出的 assistant 占位并合并 user。逻辑请求入口只投影一次，
  // 后续 attempt 只能复用或从这份 request-local history 派生。
  const messages = normalizeReasoningHistory(request.messages, {
    providerId: resolved.providerId,
    modelId: resolved.modelId,
  });
  return messages === request.messages ? request : { ...request, messages };
}
