import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  msUntilNextTick,
  runAutoClaimTick,
  setAutoClaimSettingsStore,
} from "../src/marketing-touch/autoClaim.js";
import { setAutoActivityLogStore, listAutoActivity } from "../src/marketing-touch/autoClaimLog.js";

/**
 * 自动领取的调度语义（2026-11-17 回归）。
 *
 * 线上现象：手动领取正常，自动领取报 `fetch failed` / `captcha verify failed`，
 * 且「最近活动」里全是 failed，看不出区别。这组用例钉住三个修复点：
 *
 *  1. 服务端拒绝验证码时落成 `captcha-skipped`，与真正的失败分开；
 *  2. 验证码跳过计入本轮已处理，避免每 30 分钟重打上游；
 *  3. 已领取的账号留 `already` 记录，区分「没跑」与「跑过但跳过」。
 */

/** 内存版凭据存储，驱动 settings / activity 两个模块。 */
function createMemoryStore() {
  const map = new Map<string, string>();
  return {
    load: async (key: string) => map.get(key) ?? null,
    save: async (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function createDelegate(overrides: Record<string, unknown> = {}) {
  return {
    getPlans: vi.fn().mockResolvedValue({ plans: [] }),
    findClaimablePlanId: vi.fn().mockResolvedValue("plan-1"),
    claim: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as never;
}

const DUE_NOW = new Date("2026-11-17T12:00:00+08:00");

describe("runAutoClaimTick", () => {
  beforeEach(async () => {
    const store = createMemoryStore();
    setAutoClaimSettingsStore(store);
    setAutoActivityLogStore(store);
    // 启用一个账号，档期 00:00（全天都到点）
    await store.save(
      "marketing:claim:settings",
      JSON.stringify({ "zai:acct-1": { enabled: true, time: "00:00" } }),
    );
  });

  it("已领取的账号记为 already 并跳过", async () => {
    const delegate = createDelegate({
      getPlans: vi.fn().mockResolvedValue({ plans: [{ planId: "p1" }] }),
    });
    const claimed = await runAutoClaimTick(
      { delegate, listAccountRefs: async () => ["zai:acct-1"] },
      DUE_NOW,
    );

    expect(claimed).toEqual([]);
    expect(delegate.findClaimablePlanId).not.toHaveBeenCalled();
    const records = await listAutoActivity();
    expect(records.find((r) => r.status === "already")).toBeTruthy();
  });

  it("验证码被拒记为 captcha-skipped 并计入本轮已处理", async () => {
    const delegate = createDelegate({
      claim: vi.fn().mockResolvedValue({
        ok: false,
        requiresCaptcha: true,
        message: "captcha verify failed",
      }),
    });
    const claimed = await runAutoClaimTick(
      { delegate, listAccountRefs: async () => ["zai:acct-1"] },
      DUE_NOW,
    );

    const records = await listAutoActivity();
    expect(records.find((r) => r.status === "captcha-skipped")).toBeTruthy();
    // 计入本轮已处理：后台过不了滑块，重复打上游没有意义
    expect(claimed).toEqual(["zai:acct-1"]);
  });

  it("无可领取投放记 no-campaign 并计入已处理", async () => {
    const delegate = createDelegate({
      findClaimablePlanId: vi.fn().mockResolvedValue(null),
    });
    const claimed = await runAutoClaimTick(
      { delegate, listAccountRefs: async () => ["zai:acct-1"] },
      DUE_NOW,
    );

    const records = await listAutoActivity();
    expect(records.find((r) => r.status === "no-campaign")).toBeTruthy();
    expect(claimed).toEqual(["zai:acct-1"]);
  });

  it("真实失败记 failed 且不计入已处理（下个 tick 重试）", async () => {
    const delegate = createDelegate({
      claim: vi.fn().mockRejectedValue(new Error("fetch failed")),
    });
    const claimed = await runAutoClaimTick(
      { delegate, listAccountRefs: async () => ["zai:acct-1"] },
      DUE_NOW,
    );

    const records = await listAutoActivity();
    const failed = records.find((r) => r.status === "failed");
    expect(failed).toBeTruthy();
    expect(failed?.message).toContain("fetch failed");
    expect(claimed).toEqual([]);
  });

  it("成功领取记 claimed", async () => {
    const delegate = createDelegate();
    const claimed = await runAutoClaimTick(
      { delegate, listAccountRefs: async () => ["zai:acct-1"] },
      DUE_NOW,
    );

    const records = await listAutoActivity();
    expect(records.find((r) => r.status === "claimed")).toBeTruthy();
    expect(claimed).toEqual(["zai:acct-1"]);
  });

  it("未启用自动领取的账号完全不碰", async () => {
    const delegate = createDelegate();
    const claimed = await runAutoClaimTick(
      { delegate, listAccountRefs: async () => ["zai:other"] },
      DUE_NOW,
    );

    expect(claimed).toEqual([]);
    expect(delegate.getPlans).not.toHaveBeenCalled();
    expect(delegate.claim).not.toHaveBeenCalled();
  });
});

/**
 * 扫描网格必须锚在本地整点/半点。
 *
 * 旧实现用固定 30 分钟 interval，网格锚在进程启动时刻：dev 16:49 启动，
 * 网格落在 `:19:31 / :49:31`，用户设的 19:00 档期要 19:19:31 才被看到，
 * 与「根本没触发」在界面上无法区分（2026-11-17 实测）。
 */
describe("msUntilNextTick", () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 10, 17, h, m, s, 0);

  it("半点前 → 等到本半点", () => {
    // 19:14:42 → 19:30:00 + 5s
    expect(msUntilNextTick(at(19, 14, 42))).toBe(15 * 60_000 + 18_000 + 5_000);
  });

  it("半点后 → 等到下一个整点", () => {
    // 19:30:02 → 20:00:00 + 5s
    expect(msUntilNextTick(at(19, 30, 2))).toBe(29 * 60_000 + 58_000 + 5_000);
  });

  it("整点前最后一刻 → 等 10 秒 + 余量", () => {
    expect(msUntilNextTick(at(19, 59, 50))).toBe(15_000);
  });

  it("正落在整点 → 不重复触发，等下一个半点", () => {
    expect(msUntilNextTick(at(19, 0, 0))).toBe(30 * 60_000 + 5_000);
  });
});
