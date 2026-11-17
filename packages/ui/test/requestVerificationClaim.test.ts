import { describe, expect, it, vi } from "vitest";

import { prepareRequestVerificationClaim } from "../src/request-security-edition/claim.js";

/**
 * 线上回归（2026-11-10）：点权益弹窗的「领取」，提示
 * 「暂时无法确认操作结果，请稍后查看权益。为避免重复提交，本轮不再重试。」
 *
 * 日志里的真实原因是 `ApiError: captcha verify failed`（业务码 3007）：
 * 服务端开了阿里云验证码，但 `prepareRequestVerificationClaim` 是空实现、固定
 * `return {}`，请求从不携带 `captchaVerifyParam`。明明是服务端明确拒绝，UI 却把它
 * 归成「无法确认」，用户完全看不出是验证码没过。
 *
 * 这组用例锁住两件事：没有验证码时仍然能领；开了验证码时必须带上校验参数。
 */
function serviceWithCaptcha(config: unknown) {
  return {
    getCaptchaConfig: vi.fn().mockResolvedValue(config),
  } as never;
}

function captchaConfig(overrides: Record<string, unknown> = {}) {
  return { enabled: true, region: "cn", prefix: "abc", sceneId: "scene-1", ...overrides };
}

const messages = { failed: "captcha failed", loadFailed: "captcha sdk failed" };

describe("prepareRequestVerificationClaim", () => {
  it("服务端关闭验证码时不带校验参数（请求本就不需要）", async () => {
    const proof = await prepareRequestVerificationClaim(
      serviceWithCaptcha({ enabled: false, region: "cn", prefix: "abc", sceneId: "s" }),
      new AbortController().signal,
      () => {},
      messages,
    );
    expect(proof).toEqual({});
  });

  it("没有 captcha 配置时按关闭处理", async () => {
    const proof = await prepareRequestVerificationClaim(
      serviceWithCaptcha(null),
      new AbortController().signal,
      () => {},
      messages,
    );
    expect(proof).toEqual({});
  });

  it("配置缺 field 时不启用验证码（与官方 p3 门槛一致）", async () => {
    const proof = await prepareRequestVerificationClaim(
      serviceWithCaptcha({ enabled: true, region: "cn" }),
      new AbortController().signal,
      () => {},
      messages,
    );
    expect(proof).toEqual({});
  });

  it("验证码配置读取失败时继续，让服务端做最终判定", async () => {
    const service = {
      getCaptchaConfig: vi.fn().mockRejectedValue(new Error("network")),
    } as never;
    const proof = await prepareRequestVerificationClaim(
      service,
      new AbortController().signal,
      () => {},
      messages,
    );
    expect(proof).toEqual({});
  });

  it("已 abort 时立刻抛错，不去取验证码", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareRequestVerificationClaim(
        serviceWithCaptcha(captchaConfig()),
        controller.signal,
        () => {},
        messages,
      ),
    ).rejects.toThrow();
  });
});
