import { describe, expect, it } from "vitest";

import { recordModelUsageFact } from "../src/runtime/methods/usage-observability.js";


/**
 * 使用详情的「错误码」列此前永远为空：适配器错误（AiSdkModelAdapterError）
 * 带 string code 但没有 type 属性，errorInfoFor 的 isCoreError 判否后走
 * instanceof Error 分支，把 code 丢掉——只剩网络事件的 reason（error_type）。
 * 这组用例把「带 code 的错误必须把 code 写进 usage 行」钉住。
 */

interface RecordedRow {
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
}

function fakeRuntimeWithStore(): {
  runtime: unknown;
  rows: RecordedRow[];
} {
  const rows: RecordedRow[] = [];
  const usageStore = {
    recordModelUsage: async (row: Record<string, unknown>) => {
      rows.push({
        errorType: row.errorType as string | undefined,
        errorCode: row.errorCode as string | undefined,
        errorMessage: row.errorMessage as string | undefined,
      });
    },
    upsertTurnUsage: async () => {},
    upsertToolUsage: async () => {},
    pruneUsage: async () => {},
  };
  const runtime = {
    sessionId: "sess_test",
    config: {},
    logger: undefined,
    sessionStore: usageStore,
    getLastModelRequestAuth: () => undefined,
    getLastResolvedEgress: () => undefined,
  };
  return { runtime, rows };
}

describe("recordModelUsageFact 错误码透传", () => {
  it("AiSdkModelAdapterError 的 code 写入 error_code", async () => {
    const { runtime, rows } = fakeRuntimeWithStore();
    // 与 AiSdkModelAdapterError 同形状：Error + string code、无 type 属性。
    const error = new Error("model concurrency limit exceeded");
    (error as { code?: string }).code = "model_rate_limited";
    error.name = "AiSdkModelAdapterError";
    await recordModelUsageFact(runtime as never, {
      assistantMessageId: undefined,
      attemptIndex: 0,
      error,
      events: [],
      model: { providerId: "account:zai-start-plan", modelId: "GLM-5.3", options: {} },
      querySource: "main_turn",
      startedAt: Date.now(),
      status: "error",
      traceContext: { traceId: "t", spanId: "s", turnId: "turn" },
    } as never);
    expect(rows[0]?.errorCode).toBe("model_rate_limited");
    expect(rows[0]?.errorMessage).toBe("model concurrency limit exceeded");
  });
});
