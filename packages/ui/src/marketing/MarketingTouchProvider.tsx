import { createContext, useContext, type ReactNode } from "react";
import type { MarketingTouchDelivery } from "@zcode/shared";
import { MarketingCampaignDialog } from "@/marketing/MarketingCampaignDialog.js";
import { useMarketingTouchCampaign } from "@/hooks/useMarketingTouchCampaign.js";

/**
 * Marketing Touch 顶部横幅提供者。
 *
 * 官方把 banner 资源位渲染在**左下角、账号/登录状态上方**（侧栏 footer 之上），
 * 而不是全局顶部。这里通过 context 把 banner 交给侧栏在 footer 上方渲染，
 * 弹窗（popup dialog）仍在根级全局渲染，保持居中层叠。
 */
export interface MarketingBannerContextValue {
  delivery: MarketingTouchDelivery | null;
  onOpen: (delivery: MarketingTouchDelivery) => void;
  onClose: () => void;
}

const MarketingBannerContext = createContext<MarketingBannerContextValue | null>(null);

export function useMarketingBanner(): MarketingBannerContextValue {
  const value = useContext(MarketingBannerContext);
  if (!value) {
    return { delivery: null, onOpen: () => {}, onClose: () => {} };
  }
  return value;
}

export function MarketingTouchProvider({ children }: { children: ReactNode }) {
  const campaign = useMarketingTouchCampaign();

  const bannerValue: MarketingBannerContextValue = {
    delivery: campaign.banner,
    // 官方交互：点击卡片直接触发领取（成功弹 success_popup 弹窗），无中间领取弹窗。
    onOpen: campaign.claimFromBanner,
    onClose: campaign.closeBanner,
  };

  return (
    <MarketingBannerContext.Provider value={bannerValue}>
      {children}
      {campaign.dialog ? (
        <MarketingCampaignDialog
          delivery={campaign.dialog}
          pending={campaign.pending}
          phase={campaign.phase}
          error={campaign.error}
          successTitle={campaign.successTitle}
          successDescription={campaign.successDescription}
          successHero={campaign.successHero}
          successButtons={campaign.successButtons}
          onClose={campaign.closeDialog}
          onButton={campaign.handleButton}
        />
      ) : null}
    </MarketingBannerContext.Provider>
  );
}
