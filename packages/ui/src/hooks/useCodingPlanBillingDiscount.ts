import { useCallback, useEffect, useState } from "react";
import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

// Host dist 类型仍按旧 ICodingPlanSubscriptionService 导出；getBillingDiscount 用局部断言补齐，
// 与账号管理页 OAuthAccountService 的处理方式一致，待 services dist 重新构建后可收敛。
interface CodingPlanBillingDiscountCapableService {
  getBillingDiscount?: () => Promise<CodingPlanBillingDiscountConfig | null>;
}

interface CodingPlanBillingDiscountState {
  /** 是否匹配官方「活跃」判定：至少一个 locale 的 badgeBody 存在。 */
  active: boolean;
  config: CodingPlanBillingDiscountConfig | null;
  loading: boolean;
}

/**
 * 读取官方 client/configs 下发的 Coding Plan 活动/折扣配置。
 *
 * 与官方组件语义一致：`getBillingDiscount` 不存在（旧 host）或返回空/非活跃时
 * 一律降级为不显示（active:false），绝不阻塞套餐卡片渲染。
 */
export function useCodingPlanBillingDiscount() {
  const services = useOptionalServices();
  const baseService = services?.codingPlanSubscriptionService;
  const service = (baseService as
    | (NonNullable<typeof baseService> & CodingPlanBillingDiscountCapableService)
    | undefined);
  const [state, setState] = useState<CodingPlanBillingDiscountState>(() => ({
    active: false,
    config: null,
    loading: Boolean(service && typeof service.getBillingDiscount === "function"),
  }));

  const refresh = useCallback(async () => {
    if (!service || typeof service.getBillingDiscount !== "function") {
      setState({ active: false, config: null, loading: false });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const config = await service.getBillingDiscount();
      setState({ active: Boolean(config), config, loading: false });
    } catch (error) {
      logger.warn("[CodingPlanBillingDiscount] 读取 Coding Plan 活动配置失败", error);
      setState({ active: false, config: null, loading: false });
    }
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { active: state.active, config: state.config, loading: state.loading, refresh };
}
