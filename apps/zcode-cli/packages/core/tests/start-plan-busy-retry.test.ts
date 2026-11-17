import { describe, expect, it } from "vitest";
import {
  beginStartPlanBusyAdmissionRetryAttempt,
  getStartPlanBusyAdmissionRetryDelayMs,
} from "../src/runtime/methods/streaming-recovery.js";

function busyError(): Error {
  const error = new Error("model concurrency limit exceeded");
  (error as Error & { context?: unknown }).context = { providerCode: "3008" };
  return error;
}

function state(count: number): unknown {
  return { streamRecoveryRetryCount: count };
}

const START_PLAN_PROVIDER = "account:zai-start-plan";

describe("getStartPlanBusyAdmissionRetryDelayMs", () => {
  it("系统繁忙（3008）按共享 10 次预算取退避档：1s 起步", () => {
    expect(
      getStartPlanBusyAdmissionRetryDelayMs({
        error: busyError(),
        providerId: START_PLAN_PROVIDER,
        state: state(0) as never,
        turnNumber: 1,
      }),
    ).toBe(1_000);
  });

  it("计数被断流恢复消耗后从对应档继续，末档封顶 30s", () => {
    expect(
      getStartPlanBusyAdmissionRetryDelayMs({
        error: busyError(),
        providerId: START_PLAN_PROVIDER,
        state: state(5) as never,
        turnNumber: 1,
      }),
    ).toBe(20_000);
    expect(
      getStartPlanBusyAdmissionRetryDelayMs({
        error: busyError(),
        providerId: START_PLAN_PROVIDER,
        state: state(9) as never,
        turnNumber: 1,
      }),
    ).toBe(30_000);
  });

  it("预算耗尽（计数 ≥10）不再重试", () => {
    expect(
      getStartPlanBusyAdmissionRetryDelayMs({
        error: busyError(),
        providerId: START_PLAN_PROVIDER,
        state: state(10) as never,
        turnNumber: 1,
      }),
    ).toBeUndefined();
  });

  it("非系统繁忙错误 / 非套餐供应商 / 首轮不重试", () => {
    const plain = new Error("boom");
    expect(
      getStartPlanBusyAdmissionRetryDelayMs({
        error: plain,
        providerId: START_PLAN_PROVIDER,
        state: state(0) as never,
        turnNumber: 1,
      }),
    ).toBeUndefined();
    expect(
      getStartPlanBusyAdmissionRetryDelayMs({
        error: busyError(),
        providerId: "account:zai-individual-coding-plan",
        state: state(0) as never,
        turnNumber: 1,
      }),
    ).toBeUndefined();
    expect(
      getStartPlanBusyAdmissionRetryDelayMs({
        error: busyError(),
        providerId: START_PLAN_PROVIDER,
        state: state(0) as never,
        turnNumber: 0,
      }),
    ).toBeUndefined();
  });
});

describe("beginStartPlanBusyAdmissionRetryAttempt", () => {
  it("递增共享计数并以 10 为 maxRetries 上报", () => {
    const loop = { streamRecoveryRetryCount: 0 } as never as {
      streamRecoveryRetryCount: number;
    };
    const first = beginStartPlanBusyAdmissionRetryAttempt(loop);
    expect(first).toEqual({ retryNumber: 1, maxRetries: 10 });
    const second = beginStartPlanBusyAdmissionRetryAttempt(loop);
    expect(second.retryNumber).toBe(2);
    expect(loop.streamRecoveryRetryCount).toBe(2);
  });
});
