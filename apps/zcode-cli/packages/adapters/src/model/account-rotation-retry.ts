import type { Logger } from "@zcode/contracts";
import { inspectProviderFailure } from "./failure-classifier.js";
import {
  getHttpResponseStatus,
  unwrapRetryError,
} from "./failure-inspection.js";
import type { AiSdkModelTextRequest, ResolvedAiSdkModel } from "./runner-runtime.js";

/**
 * 账号轮询的 fallback 重试（对齐 9router 的 `excludeConnectionIds` 循环）。
 *
 * host 在每次 attempt 前通过 `refreshRuntimeHeadersBeforeAttempt` 选一条连接并返回
 * `requestAuth.connectionId`。本类负责：
 * 1. 把**已失败**的连接 id 与失败类型带进下一次回调；
 * 2. 在账号级失败（401/402/403/429）时额外申请一次重试，且不消耗普通重试预算。
 *
 * 只在 core 给多账号供应商挂上回调时生效：
 * - qoder / codebuddy（api-key 型多账号）：host 从 provider facade 的账号表选；
 * - zai / bigmodel（Coding Plan 账号族）：host 从 OAuth 账号表选，且只在「允许换号」的
 *   请求上选（见 zcodeAgentService 的 resolveRotatedAccountRef）。
 * zhipu-account 的**同账号** PAT 刷新仍走 AccountRequestRetry（发 expectedAccountScope，
 * host 见到它就不换号），两者按请求自然分离：先同账号刷新，刷新不动了才换号。
 */
const MAX_ROTATION_ATTEMPTS = 4;

/** 这些状态码说明「这条连接不可用」，换号有实际意义；其余失败换号只会放大消耗。 */
const ACCOUNT_SCOPED_STATUS = new Set([401, 402, 403, 429]);

export class AccountRotationRetry {
  #extraAttempts = 0;
  #excluded: string[] = [];
  #lastFailure: { statusCode?: number; providerErrorCode?: string; connectionId?: string } | undefined;
  #currentConnectionId: string | undefined;

  constructor(
    private readonly request: AiSdkModelTextRequest,
    private readonly model: ResolvedAiSdkModel,
    private readonly logger?: Logger,
  ) {}

  get extraAttempts(): number {
    return this.#extraAttempts;
  }

  prepareRequest(request: AiSdkModelTextRequest): AiSdkModelTextRequest {
    const refresh = request.refreshRuntimeHeadersBeforeAttempt;
    if (!refresh) return request;
    return {
      ...request,
      refreshRuntimeHeadersBeforeAttempt: async (input) => {
        const result = await refresh({
          ...input,
          ...(this.#excluded.length > 0
            ? { excludedConnectionIds: [...this.#excluded] }
            : {}),
          ...(this.#lastFailure ? { lastFailure: this.#lastFailure } : {}),
        });
        this.#currentConnectionId = result.requestAuth?.connectionId;
        // 失败信息只投递一次：下一次选择成功后清掉，避免 host 重复写锁。
        this.#lastFailure = undefined;
        return result;
      },
    };
  }

  claim(error: unknown, blocked = false): boolean {
    if (
      blocked ||
      this.#extraAttempts >= MAX_ROTATION_ATTEMPTS ||
      this.request.abortSignal?.aborted ||
      !this.request.refreshRuntimeHeadersBeforeAttempt
    ) {
      return false;
    }
    const inspection = inspectProviderFailure(unwrapRetryError(error));
    const status = getHttpResponseStatus(unwrapRetryError(error));
    if (!status || !ACCOUNT_SCOPED_STATUS.has(status)) {
      return false;
    }
    // 不知道是哪个连接失败就不能换号：否则 host 可能再次选中同一个账号，形成空转。
    const connectionId = this.#currentConnectionId;
    if (!connectionId) {
      return false;
    }
    if (!this.#excluded.includes(connectionId)) {
      this.#excluded.push(connectionId);
    }
    this.#lastFailure = {
      statusCode: status,
      ...(inspection.providerErrorCode
        ? { providerErrorCode: inspection.providerErrorCode }
        : {}),
      connectionId,
    };
    this.#currentConnectionId = undefined;
    this.#extraAttempts += 1;
    this.logger?.warn("Account-scoped failure; rotating to another connection", {
      event: "model.account_rotation.retry",
      providerId: String(this.model.providerId),
      modelId: String(this.model.modelId),
      traceId: this.request.traceContext?.traceId,
      connectionId,
      statusCode: status,
      providerErrorCode: inspection.providerErrorCode,
    });
    return true;
  }
}
