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
 * 2. 在**用户开启换号**且命中所选状态码时额外申请一次重试，且不消耗普通重试预算。
 *    默认关闭：请求出错不会静默切到别的账号。
 *
 * 只在 core 给多账号供应商挂上回调时生效：
 * - qoder / codebuddy（api-key 型多账号）：host 从 provider facade 的账号表选；
 * - zai / bigmodel（Coding Plan 账号族）：host 从 OAuth 账号表选，且只在「允许换号」的
 *   请求上选（见 zcodeAgentService 的 resolveRotatedAccountRef）。
 * zhipu-account 的**同账号** PAT 刷新仍走 AccountRequestRetry（发 expectedAccountScope，
 * host 见到它就不换号），两者按请求自然分离：先同账号刷新，刷新不动了才换号。
 */
const MAX_ROTATION_ATTEMPTS = 4;


/**
 * 换号策略来自 host 随本次选号下发的 `requestAuth.accountFailover`：
 * - 缺席或 `enabled: false` → **永不换号**（默认）。请求出错就报错，不偷偷消耗
 *   用户导入的其他账号；
 * - `enabled: true` → 状态码命中 `statusCodes` **或** 业务码命中 `providerCodes`
 *   才换号。api-key 型供应商（Qoder / CodeBuddy）的错误是真实 HTTP 状态码，走
 *   `statusCodes`；zai / bigmodel 账号族把业务错误包在 HTTP 200 里（providerCode
 *   在响应体），只有额度耗尽 1005 下发在 `providerCodes` 里——额度按账号隔离，
 *   换号才有意义，其余错误（并发/鉴权/限流）应走重试而不是切号。
 *
 * 这里不内置任何触发白名单：策略唯一来源是 host，adapter 只做「命中就申请重试」。
 */

export class AccountRotationRetry {
  #extraAttempts = 0;
  #excluded: string[] = [];
  #lastFailure: { statusCode?: number; providerErrorCode?: string; connectionId?: string } | undefined;
  #currentConnectionId: string | undefined;
  #failover: {
    enabled: boolean;
    statusCodes: readonly number[];
    providerCodes?: readonly string[];
  } | undefined;

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
        // 策略随选号结果下发；每次 attempt 都可能变（用户刚改设置）。
        this.#failover = result.requestAuth?.accountFailover;
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
    const failover = this.#failover;
    // 默认不换号：策略缺席、显式关闭，或状态码/业务码都没命中，都直接失败。
    if (!failover?.enabled) {
      return false;
    }
    const inspection = inspectProviderFailure(unwrapRetryError(error));
    const status = getHttpResponseStatus(unwrapRetryError(error));
    const statusHit = status !== undefined && failover.statusCodes.includes(status);
    const providerCode = inspection.providerErrorCode;
    const providerCodeHit =
      providerCode !== undefined && (failover.providerCodes?.includes(providerCode) ?? false);
    if (!statusHit && !providerCodeHit) {
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
