import { BadgePercent } from "lucide-react";
import type { CodingPlanBillingDiscountText } from "@zcode/shared";
import { useCodingPlanBillingDiscount } from "@/hooks/useCodingPlanBillingDiscount.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

/**
 * Coding Plan 活动/折扣徽标（复刻官方 CascadingPlanBillingDiscount 形态）。
 *
 * 从 client/configs 读取的活动配置按 locale 组织；官网下发且有 badgeBody 才显示，
 * 未登录/未下发/旧 host 不提供该接口时返回 null，不阻塞套餐卡片。
 */
export function CodingPlanBillingDiscount({
  size = "default",
  variant = "gradient",
  iconVisible = true,
}: {
  size?: "default" | "compact";
  variant?: "gradient" | "surface" | "tag";
  iconVisible?: boolean;
}) {
  const { active, config } = useCodingPlanBillingDiscount();
  const { locale } = useXCodeIntl();

  if (!active || !config) {
    return null;
  }

  const text: CodingPlanBillingDiscountText | undefined = config[locale];
  const badgeBody = text?.badgeBody?.trim();
  if (!badgeBody) {
    return null;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center whitespace-nowrap",
        size === "compact" ? "gap-0.5 px-1.5 py-0.5 text-ui-xs leading-none" : "gap-1 px-2 py-0.5 text-ui-xs",
        variant === "surface"
          ? "rounded-full bg-white text-[#191A1D]"
          : variant === "tag"
            ? "rounded-full bg-tag text-foreground"
            : "rounded-full text-white button-gradient dark:bg-[#484A58]",
      )}
    >
      {iconVisible ? <BadgePercent className={size === "compact" ? "size-2.5" : "size-3"} /> : null}
      {badgeBody}
    </div>
  );
}
