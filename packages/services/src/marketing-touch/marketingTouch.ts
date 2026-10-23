import { ServiceChannels, type MarketingTouchSnapshot } from "@zcode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface IMarketingTouchService {
  /**
   * 拉取营销投放。
   *
   * `accountRef` 给定则用该账号自己的凭据与 Device-Mid 查询（一键领取按账号逐个查），
   * 缺席则用当前激活账号。服务端按凭据决定下发哪些投放，不传会把别的账号的投放
   * 当成目标账号的。
   */
  query(input: {
    locale: "zh-CN" | "en-US";
    accountRef?: string;
  }): Promise<MarketingTouchSnapshot & { scope: string }>;
  report(input: {
    locale: "zh-CN" | "en-US";
    scope: string;
    campaignId: string;
    actionType: "confirm" | "cancel";
  }): Promise<void>;
}
export const IMarketingTouchService = createServiceDescriptor<IMarketingTouchService>(
  ServiceChannels.MarketingTouch,
);
