import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { AccountRotationRetry } from "../src/model/account-rotation-retry.js";
import { AiSdkModelAdapterError } from "../src/model/errors.js";
import { ProviderBusinessError } from "../src/model/model-execution.js";
import { TerminalStreamChunkError } from "../src/model/runner-retry.js";

type Failover = {
  enabled: boolean;
  statusCodes: number[];
  providerCodes?: string[];
};

async function makeRetryWithFailover(failover: Failover): Promise<AccountRotationRetry> {
  const request = {
    refreshRuntimeHeadersBeforeAttempt: async () => ({
      headersApplied: true,
      requestAuth: { connectionId: "conn-1", accountFailover: failover },
    }),
  } as never;
  const model = {
    providerId: "account:zai-start-plan",
    modelId: "GLM-5.3",
  } as never;
  const retry = new AccountRotationRetry(request, model);
  const prepared = retry.prepareRequest(request);
  const refresh = (prepared as {
    refreshRuntimeHeadersBeforeAttempt: (input: unknown) => Promise<unknown>;
  }).refreshRuntimeHeadersBeforeAttempt;
  await refresh({ attempt: 1, providerId: "account:zai-start-plan", modelId: "GLM-5.3" });
  return retry;
}

function quotaError(): ProviderBusinessError {
  // 家族上游的真实形态：HTTP 200 + 响应体业务码 1005（额度耗尽）。
  return new ProviderBusinessError({
    providerCode: 1005,
    providerId: "account:zai-start-plan",
    providerKind: "openai-compatible",
    providerMessage: "exceed quota limit",
  });
}

/**
 * SSE 流内业务错误的真实形态：TerminalStreamChunkError 只复制 message，
 * 业务码在链底 APICallError 的 data/responseBody 里（dev 实测的错误形状）。
 */
function streamTerminalQuotaError(code: number | string): TerminalStreamChunkError {
  const apiError = new APICallError({
    message: "exceed quota limit",
    url: "https://api.z.ai/api/coding/paas/v4/chat/completions",
    requestBodyValues: {},
    statusCode: 200,
    responseBody: JSON.stringify({ error: { code, message: "exceed quota limit" } }),
    data: { error: { code, message: "exceed quota limit" } },
    isRetryable: false,
  });
  const adapterError = new AiSdkModelAdapterError("model_request_failed", "exceed quota limit", {
    cause: apiError,
    context: {},
  });
  return new TerminalStreamChunkError(adapterError);
}

describe("AccountRotationRetry.claim", () => {
  it("策略开启且业务码 1005 命中 → 换号", async () => {
    const retry = await makeRetryWithFailover({
      enabled: true,
      statusCodes: [],
      providerCodes: ["1005"],
    });
    expect(retry.claim(quotaError())).toBe(true);
    expect(retry.extraAttempts).toBe(1);
  });

  it("流内业务错误（TerminalStreamChunkError 包装链）也能提取业务码 1005 → 换号", async () => {
    const retry = await makeRetryWithFailover({
      enabled: true,
      statusCodes: [],
      providerCodes: ["1005"],
    });
    expect(retry.claim(streamTerminalQuotaError(1005))).toBe(true);
    expect(retry.extraAttempts).toBe(1);
  });

  it("流内业务错误但业务码不在策略集合（3008）→ 不换号", async () => {
    const retry = await makeRetryWithFailover({
      enabled: true,
      statusCodes: [],
      providerCodes: ["1005"],
    });
    expect(retry.claim(streamTerminalQuotaError(3008))).toBe(false);
    expect(retry.extraAttempts).toBe(0);
  });

  it("策略开启但业务码未命中（如并发 3008）→ 不换号", async () => {
    const retry = await makeRetryWithFailover({
      enabled: true,
      statusCodes: [],
      providerCodes: ["1005"],
    });
    const busy = new ProviderBusinessError({
      providerCode: 3008,
      providerId: "account:zai-start-plan",
      providerKind: "openai-compatible",
    });
    expect(retry.claim(busy)).toBe(false);
    expect(retry.extraAttempts).toBe(0);
  });

  it("策略关闭 → 永不换号", async () => {
    const retry = await makeRetryWithFailover({
      enabled: false,
      statusCodes: [429],
      providerCodes: ["1005"],
    });
    expect(retry.claim(quotaError())).toBe(false);
  });

  it("状态码命中仍然生效（api-key 型供应商路径不变）", async () => {
    const retry = await makeRetryWithFailover({
      enabled: true,
      statusCodes: [429],
    });
    const limited = new ProviderBusinessError({
      statusCode: 429,
      responseStatus: 429,
      providerId: "other:qoder",
      providerKind: "openai-compatible",
    });
    expect(retry.claim(limited)).toBe(true);
  });

  it("blocked（轮次已中止）→ 不换号", async () => {
    const retry = await makeRetryWithFailover({
      enabled: true,
      statusCodes: [],
      providerCodes: ["1005"],
    });
    expect(retry.claim(quotaError(), true)).toBe(false);
  });
});
