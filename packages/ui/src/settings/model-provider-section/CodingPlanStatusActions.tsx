import { CodingPlanEntryButton } from "@/settings/CodingPlanEntryButton.js";
import { ArrowLeftIcon, Loader2Icon, RocketIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { CodingPlanBillingDiscount } from "@/settings/model-provider-section/CodingPlanBillingDiscount.js";
import type { CodingPlanLoginOptions } from "./codingPlanPricingCards.js";

export function CodingPlanStatusActions({
  providerName,
  isDisconnected,
  isUnavailable,
  isPurchased,
  loginLoading,
  loginButtonId,
  loginVisible,
  canDisconnectProvider,
  disconnectLoading,
  onLogin,
  onDisconnect,
}: {
  providerName: string;
  isDisconnected: boolean;
  isUnavailable: boolean;
  isPurchased: boolean;
  loginLoading?: boolean;
  loginButtonId: string;
  loginVisible: boolean;
  canDisconnectProvider: boolean;
  disconnectLoading?: boolean;
  onLogin?: (options?: CodingPlanLoginOptions) => void;
  onDisconnect?: () => void;
}) {
  const { intl } = useXCodeIntl();

  return (
    <div className="flex shrink-0 flex-wrap justify-start gap-2">
      {loginVisible && (isDisconnected || isUnavailable) && onLogin ? (
        <Button type="button" size="lg" onClick={() => onLogin()} disabled={loginLoading}>
          {loginLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {intl.formatMessage({ id: loginButtonId }, { provider: providerName })}
        </Button>
      ) : null}
      {canDisconnectProvider && onDisconnect && !isPurchased ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={disconnectLoading}
          onClick={onDisconnect}
        >
          {disconnectLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {intl.formatMessage({
            id: "settings.modelProvider.codingPlan.disconnect",
          })}
        </Button>
      ) : null}
    </div>
  );
}

export function CodingPlanUpgradeAction({
  loginLoading,
  upgradePlansVisible,
  actionLabelId = "settings.modelProvider.codingPlan.upgrade",
  onUpgradePlansVisibleChange,
}: {
  loginLoading?: boolean;
  upgradePlansVisible: boolean;
  actionLabelId?: string;
  onUpgradePlansVisibleChange: (visible: boolean) => void;
}) {
  const { intl } = useXCodeIntl();

  // 升级入口旁展示官方下发的活动/折扣徽标（client/configs 未下发则自动隐藏）。
  return (
    <div className="flex items-center gap-2">
      <CodingPlanBillingDiscount />
      <CodingPlanEntryButton
        bypassGate={upgradePlansVisible}
        type="button"
        size="lg"
        onClick={() => {
          // 购买/升级入口必须先打开面板，OAuth 失效恢复由面板在用户选择
          // plan/周期后处理，避免点击 Upgrade 直接跳登录导致用户看不到购买流程。
          onUpgradePlansVisibleChange(!upgradePlansVisible);
        }}
        disabled={loginLoading}
      >
        {loginLoading ? (
          // Upgrade 可能先触发 OAuth 业务 token 刷新。
          // 等待期间只有 disabled 没有 spinner，用户会误以为点击没有响应。
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : upgradePlansVisible ? (
          <ArrowLeftIcon className="size-3.5" />
        ) : (
          <RocketIcon className="size-3.5" />
        )}
        {intl.formatMessage({
          id: upgradePlansVisible ? "settings.modelProvider.codingPlan.cancelUpgrade" : actionLabelId,
        })}
      </CodingPlanEntryButton>
    </div>
  );
}
