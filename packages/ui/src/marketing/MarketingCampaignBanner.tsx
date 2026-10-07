import { XIcon } from "lucide-react";
import type { MarketingTouchDelivery } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { MarketingHeroTicket } from "@/marketing/MarketingHeroTicket.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * Marketing Touch 横幅卡片（对齐官方 Wnn）。
 *
 * 官方把 banner 资源位渲染成 `h-24` 圆角可点击卡片，内部铺 `banner.background` 的 hero
 * （interactive_bundle 走 sandbox iframe 动画），右上角叠加关闭 X；点击打开领取弹窗。
 * hero 以非交互呈现（pointer-events-none），点击穿透到外层按钮；无 hero 时回退文字条。
 *
 * 作为流式卡片放在侧栏 footer 上方（左下角、登录状态之上），不带全局定位。
 */
export function MarketingCampaignBanner({
  delivery,
  onOpen,
  onClose,
}: {
  delivery: MarketingTouchDelivery;
  onOpen: (delivery: MarketingTouchDelivery) => void;
  onClose: () => void;
}) {
  const { intl } = useXCodeIntl();
  const background = delivery.banner?.background;
  const title = delivery.campaign?.dialog?.title?.trim();
  const description = delivery.campaign?.dialog?.description?.text?.trim();

  if (!background && !title && !description) {
    return null;
  }

  return (
    <div className="relative w-full" data-testid="marketing-banner">
      <button
        type="button"
        onClick={() => onOpen(delivery)}
        className="block h-24 w-full overflow-hidden rounded-xl border border-border bg-surface text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
        aria-label={intl.formatMessage({ id: "marketing.view" })}
      >
        {background ? (
          <MarketingHeroTicket hero={background} presentation />
        ) : (
          <div className="flex h-full w-full items-center gap-2 px-4">
            {title ? <span className="truncate font-medium">{title}</span> : null}
            {description ? (
              <span className="hidden truncate text-muted-foreground md:inline">{description}</span>
            ) : null}
          </div>
        )}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={intl.formatMessage({ id: "marketing.close" })}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute right-2.5 top-2.5 z-10 rounded-full text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:ring-foreground/50"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}
