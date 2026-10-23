import type { RequestVerificationReason } from "@zcode/shared";
import { AsyncLocalStorage } from "node:async_hooks";
import type { XCodeProviderAccountAccess } from "@zcode/shared";
import type { ModelApiCallObservation } from "../telemetry/index.js";
import type { TraceContext } from "../tracing/tracer.js";
import type {
  ModelRequestAdmission,
  ModelRequestSessionType,
  ModelRetryBudget,
  ModelStatusSink,
  ModelStreamRecoveryStatus,
} from "./index.js";

/**
 * Runtime 与 Adapter 之间的调用级执行信息。
 *
 * 它不属于业务 ModelRequest，也不允许普通调用方据此改变 Provider 或模型身份。
 * Runtime 只在统一模型调用边界设置，Adapter 在同一异步调用链内读取。
 */
export interface ModelInvocationContext {
  metadata?: Record<string, unknown>;
  modelCall?: ModelApiCallObservation;
  modelRequestSessionType?: ModelRequestSessionType;
  /** 重试预算档位；runtime 按 taskType 决定，adapter 据此放宽瞬态失败的放弃条件。 */
  modelRetryBudget?: ModelRetryBudget;
  /** 准入端口；runtime 从 deps 带入，adapter 每次尝试先 acquire。 */
  modelRequestAdmission?: ModelRequestAdmission;
  statusSink?: ModelStatusSink;
  traceContext?: TraceContext;
  streamIdleTimeoutRetryNumber?: number;
  streamRecovery?: ModelStreamRecoveryStatus;
  preserveProviderStreamBoundaries?: boolean;
  /**
   * adapter 在真正发出请求时回报本次命中的出口节点。
   *
   * 供应商级轮询是 per-request 选择，只有 adapter 的 fetch 层知道这一次抽中了哪个池；
   * host 的 requestAuth 只能给候选快照。记账要显示真实节点名，必须由 adapter 回填。
   */
  reportResolvedEgress?: (egress: { proxyPoolId?: string; proxyDisplayName?: string }) => void;
  refreshRuntimeHeadersBeforeAttempt?: (input: {
    accountAccess?: XCodeProviderAccountAccess;
    expectedAccountScope?: string;
    rejectedProjectTokenFingerprint?: string;
    /** 本次逻辑请求里已经失败、不得再选的连接（账号）id。 */
    excludedConnectionIds?: readonly string[];
    /** 上一次失败的类型；host 用于写模型锁 / 判断是否换号。 */
    lastFailure?: { statusCode?: number; providerErrorCode?: string; connectionId?: string };
    attempt: number;
    reason?: RequestVerificationReason;
    abortSignal?: AbortSignal;
    providerId: string;
    modelId: string;
    traceContext?: TraceContext;
  }) => Promise<{
    headersApplied: boolean;
    requestAuth?: ModelRequestAuth;
  }>;
}

/** Adapter 为单个物理请求 attempt 使用的动态鉴权材料。 */
export interface ModelRequestAuth {
  accountScope?: string;
  /** 账号轮询：本次选中的连接（账号）id。 */
  connectionId?: string;
  /** 本次选中的账号显示名；「使用详情」按它区分多账号供应商的具体账号。 */
  accountDisplayName?: string;
  /** 本次请求的出口代理池 id 与显示名；未绑定时缺席（跟随全局代理状态）。 */
  proxyPoolId?: string;
  proxyDisplayName?: string;
  apiKey?: string;
  apiKeyId?: string;
  headers?: Record<string, string>;
  /**
   * 账号轮询的失败换号策略，由 host 随本次选号一起下发。
   * 缺席 = 不换号（默认）：请求出错直接报错，不偷偷消耗别的账号。
   */
  accountFailover?: {
    enabled: boolean;
    /** 只有这些状态码才换号；host 已按设置收敛过。 */
    statusCodes: number[];
  };
}

export interface ModelRequestAuthSourceInput {
  attempt: number;
  abortSignal?: AbortSignal;
  providerId: string;
  modelId: string;
  traceContext?: TraceContext;
}

/** Model 创建时绑定、在每个物理请求 attempt 前解析的执行作用域鉴权来源。 */
export interface ModelRequestAuthSource {
  resolve(input: ModelRequestAuthSourceInput): Promise<ModelRequestAuth | undefined>;
}

export interface ModelRequestDependencies {
  /** 属性存在表示当前 Model 必须取得请求级鉴权；Source 缺失同样 fail-closed。 */
  requestAuth?: {
    source?: ModelRequestAuthSource;
  };
}

const modelInvocationStorage = new AsyncLocalStorage<ModelInvocationContext>();

export function getCurrentModelInvocationContext(): ModelInvocationContext | undefined {
  return modelInvocationStorage.getStore();
}

export function runWithModelInvocationContext<T>(context: ModelInvocationContext, run: () => T): T {
  const result = modelInvocationStorage.run(context, run);
  if (!isAsyncIterable(result)) return result;

  const source = result;
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      return {
        next: (value?: unknown) =>
          modelInvocationStorage.run(context, () => iterator.next(value as never)),
        return: (value?: unknown) =>
          modelInvocationStorage.run(context, () =>
            iterator.return
              ? iterator.return(value as never)
              : Promise.resolve({ done: true, value }),
          ),
        throw: (error?: unknown) =>
          modelInvocationStorage.run(context, () =>
            iterator.throw ? iterator.throw(error) : Promise.reject(error),
          ),
      };
    },
  } as T;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  );
}
