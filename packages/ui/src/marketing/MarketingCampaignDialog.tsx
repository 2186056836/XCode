import { useState } from "react";
import type {
  MarketingCampaignButton,
  MarketingHero,
  MarketingTextContent,
  MarketingTouchDelivery,
} from "@zcode/shared";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { MarketingHeroTicket } from "@/marketing/MarketingHeroTicket.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import type { MarketingTouchPhase } from "@/hooks/useMarketingTouchCampaign.js";

/**
 * Marketing Touch 领取弹窗（复刻官方 cloud-content-dialog / Atn 结构）。
 *
 * 官方没有独立"成功态"组件：领取成功后把 dialog 内容切到 success_popup 下发的
 * 内容（hero=星空票券动画、title=领取成功、buttons=模型设置/复制分享），复用同一
 * 结构。这里同样：非成功态渲染 campaign.dialog，成功态渲染 success* 字段。
 * 结构对齐官方：DialogContent p-0 border-0 gap-0（hero 全出血 aspect-[4/3]），
 * section(bg-popover) 居中列，胶囊按钮 h-10 min-w-32 rounded-full；
 * copy_text 点击后 2s 显示"已复制"。深浅色全部走主题 token（bg-popover 等）。
 */
export function MarketingCampaignDialog({
  delivery,
  pending,
  phase,
  error,
  successTitle,
  successDescription,
  successHero,
  successButtons,
  onClose,
  onButton,
}: {
  delivery: MarketingTouchDelivery;
  pending: boolean;
  phase: MarketingTouchPhase;
  error: string | null;
  successTitle: string | null;
  successDescription: MarketingTextContent | null;
  successHero: MarketingHero | null;
  successButtons: MarketingCampaignButton[];
  onClose: () => void;
  onButton: (delivery: MarketingTouchDelivery, button: MarketingCampaignButton) => void;
}) {
  const { intl } = useXCodeIntl();
  const [copiedActionId, setCopiedActionId] = useState<string | null>(null);
  const actions = delivery.campaign?.actions ?? {};
  const isClaimed = phase === "success";
  const hero = isClaimed ? successHero : delivery.campaign?.dialog?.hero;
  const title = isClaimed ? successTitle : delivery.campaign?.dialog?.title;
  const description = isClaimed
    ? successDescription
    : delivery.campaign?.dialog?.description ?? null;
  const buttons = isClaimed ? successButtons : delivery.campaign?.dialog?.buttons ?? [];

  // 富文本描述：html → dangerouslySetInnerHTML；plain/markdown → 文本节点。
  function renderDescription(content: MarketingTextContent | null | undefined): ReactNode {
    if (!content || !content.text.trim()) return null;
    if (content.format === "html") {
      return (
        <div
          className="text-center text-ui-base/relaxed text-foreground-subtle"
          dangerouslySetInnerHTML={{ __html: content.text }}
        />
      );
    }
    return (
      <div className="text-center text-ui-base/relaxed text-foreground-subtle">{content.text}</div>
    );
  }

  const handleButtonClick = (button: MarketingCampaignButton) => {
    onButton(delivery, button);
    if (actions[button.actionId]?.type === "copy_text") {
      setCopiedActionId(button.actionId);
      window.setTimeout(
        () => setCopiedActionId((cur) => (cur === button.actionId ? null : cur)),
        2_000,
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        overlayClassName={
          hero?.type === "interactive_bundle" ? "backdrop-filter-none!" : undefined
        }
        className="max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-2rem))] max-w-none gap-0 overflow-y-auto border-0 p-0 [&_[data-slot=dialog-close]]:rounded-full"
      >
        {hero ? (
          <div
            className="aspect-[4/3] w-full overflow-hidden rounded-t-2xl bg-surface"
            data-testid="cloud-dialog-hero-slot"
          >
            <MarketingHeroTicket hero={hero} />
          </div>
        ) : null}
        <section className="flex min-w-0 flex-col items-center gap-6 bg-popover px-6 py-7 text-center text-foreground">
          <div data-testid="cloud-dialog-status" className="flex w-full min-w-0 flex-col items-center gap-3">
            {title ? (
              <DialogTitle className="text-ui-xl font-semibold">{title}</DialogTitle>
            ) : (
              <DialogTitle className="sr-only">
                {intl.formatMessage({ id: "marketing.claimSuccessTitle" })}
              </DialogTitle>
            )}
            {renderDescription(description)}
          </div>
          {phase === "error" && error ? (
            <div role="alert" className="w-full text-ui-sm text-destructive">
              {error}
            </div>
          ) : null}
          {buttons.length > 0 ? (
            <div className="flex w-full flex-wrap items-center justify-center gap-2">
              {buttons.map((button) => (
                <Button
                  key={button.id}
                  type="button"
                  size="lg"
                  data-testid="cloud-dialog-action"
                  data-action-id={button.actionId}
                  variant={
                    button.variant === "primary"
                      ? "default"
                      : button.variant === "link"
                        ? "link"
                        : "outline"
                  }
                  disabled={pending}
                  className="h-10 min-w-32 max-w-full whitespace-normal rounded-full px-6 text-ui-base"
                  onClick={() => handleButtonClick(button)}
                >
                  <span className="min-w-0 break-words">
                    {copiedActionId === button.actionId
                      ? intl.formatMessage({ id: "marketing.copySucceeded" })
                      : button.label}
                  </span>
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      </DialogContent>
    </Dialog>
  );
}
