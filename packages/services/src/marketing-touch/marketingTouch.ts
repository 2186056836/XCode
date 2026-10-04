import type {
  MarketingTouchReport,
  MarketingTouchResponse,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface MarketingTouchQuery {
  locale: string;
  /** 防缓存的序号，不传则由 host 生成时间戳。 */
  seq?: number;
  /** 按该账号的 per-account JWT 查询（一键领取）；缺省用当前激活账号镜像。 */
  accountRef?: string;
}

export interface IMarketingTouchService {
  /** 拉取当前账号可见的营销活动（banner / popup）。 */
  query(input: MarketingTouchQuery): Promise<MarketingTouchResponse>;
  /** 上报活动交互动作（曝光/点击/领取/关闭）。 */
  report(input: MarketingTouchReport): Promise<void>;
}

export const IMarketingTouchService = createServiceDescriptor<IMarketingTouchService>(
  ServiceChannels.MarketingTouch,
);
