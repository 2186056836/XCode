import type { ICodingPlanSubscriptionService } from "@zcode/services";
import type { MarketingCaptchaConfig } from "@zcode/shared";
import { runAliyunCaptcha, shouldRunCaptcha } from "@/hooks/useMarketingTouchCampaign.js";
import { logger } from "@/logger.js";

/**
 * 领取请求需要携带的服务端校验参数。
 *
 * 服务端 `/api/v1/zcode-plan/billing/claim` 在验证码开启时强制校验
 * `captchaVerifyParam`，缺失直接回 `captcha verify failed`。这里返回的字段会被
 * `claimManualPlan` 原样放进请求头，所以名字必须与 provider 的参数名一致。
 */
export interface ClaimVerificationProof {
  captchaVerifyParam?: string;
  captchaRegion?: string;
}

/** 领取入口的验证码是否已预热（供 `useRequestVerificationPrewarm` 使用）。 */
export function useRequestVerificationPrewarm(_visible: boolean): void {}

/**
 * 按服务端配置取一次验证码，供 manual claim（领取型活动套餐）使用。
 *
 * 行为必须是「要么拿到可用的校验参数，要么抛错」——不能像旧版那样返回空对象。
 * 旧实现固定 `return {}`，请求永远不带验证码头，服务端在有验证码配置时必然拒绝，
 * 而 UI 把这次拒绝归成「无法确认操作结果」，用户看到的就是领取失败。
 *
 * 服务端没开验证码时返回空对象是正确行为（请求本就不需要这些头）。
 *
 * 文案由调用方注入：这个模块不持有 intl，硬编码中文会让英文界面出现中文提示。
 */
export async function prepareRequestVerificationClaim(
  service: ICodingPlanSubscriptionService,
  signal: AbortSignal,
  onVerifying: () => void,
  messages: { failed: string; loadFailed: string },
): Promise<ClaimVerificationProof | undefined> {
  signal.throwIfAborted();
  let config: MarketingCaptchaConfig | null = null;
  try {
    config = await service.getCaptchaConfig();
  } catch (error) {
    // 配置读取失败时按「没有验证码」继续，让服务端做最终判定：
    // 客户端擅自阻断会让本来就关闭验证码的部署完全领不了。
    logger.warn("[request-verification] captcha config unavailable", { error });
    return {};
  }
  signal.throwIfAborted();
  if (!shouldRunCaptcha(config)) return {};

  onVerifying();
  const result = await runAliyunCaptcha(config as MarketingCaptchaConfig, messages);
  signal.throwIfAborted();
  if (!result?.verifyParam) {
    throw new Error("captcha_verify_failed");
  }
  return {
    captchaVerifyParam: result.verifyParam,
    ...(result.region ? { captchaRegion: result.region } : {}),
  };
}
