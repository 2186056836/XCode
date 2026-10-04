import type {
  MarketingCampaignAction,
  MarketingCampaignButton,
  MarketingHero,
  MarketingTextContent,
  MarketingTouchDelivery,
} from "@zcode/shared";
import { prepareMarketingBundle } from "./prepareMarketingBundle.js";

/**
 * 官方 `/api/v1/marketing/touch` 返回的是扁平资源位 schema（banner/popup 直接携带
 * title/description/hero/buttons，按钮为 `{text, action}`，动作类型为
 * `claim_zcode_plan` / `navigate` / `copy_text` / `open_url`）。
 *
 * fork 的控制器与 UI（useMarketingTouchCampaign / MarketingCampaignBanner /
 * MarketingCampaignDialog）消费的是 `MarketingTouchDelivery.campaign` 结构
 * （dialog + actions 映射 + claim_plan）。这里在 host 边界做归一化，把官方扁平
 * 结构转成 fork UI 的形状，从而复用现有控制器与渲染组件。
 */

// ── 官方原始扁平结构（与 asar 内 zod schema 对齐） ───────────────────────────
interface RawText {
  format?: string;
  content?: string;
}
interface RawAction {
  type: string;
  args?: {
    url?: string;
    plan_id?: string;
    text?: string;
    page?: string;
    section?: string;
    [key: string]: unknown;
  } | null;
}
interface RawButton {
  text?: RawText;
  action?: RawAction;
  theme?: { variant?: string } | null;
}
interface RawHero {
  type: "image" | "video" | "bundle";
  image?: { default: string; dark?: string };
  video?: { src: string; fallback?: string };
  bundle?: {
    bundle?: { src: string; sha256?: string };
    entry?: string;
    fallback?: string;
  };
  args?: Record<string, unknown>;
}
interface RawPanel {
  layout?: string;
  title?: RawText;
  description?: RawText;
  hero?: RawHero;
  buttons?: RawButton[];
}
export interface RawMarketingDelivery {
  campaign_id: string;
  priority?: number;
  resource_position: "banner" | "popup";
  banner?: RawPanel & { background?: RawHero; success_popup?: RawPanel | null };
  popup?: RawPanel;
}

function normalizeFormat(format: string | undefined): MarketingTextContent["format"] {
  switch (format) {
    case "html":
      return "html";
    case "markdown":
      return "markdown";
    default:
      return "plain_text";
  }
}

function textContent(raw: RawText | undefined): MarketingTextContent {
  return { format: normalizeFormat(raw?.format), text: raw?.content ?? "" };
}

function mapAction(action: RawAction | undefined): MarketingCampaignAction | undefined {
  if (!action) return undefined;
  const args = action.args ?? {};
  switch (action.type) {
    case "claim_zcode_plan":
      return { type: "claim_plan", planId: String(args.plan_id ?? "") };
    case "open_url":
      return { type: "open_external", url: String(args.url ?? "") };
    case "copy_text":
      return { type: "copy_text", text: String(args.text ?? "") };
    case "navigate": {
      // 官方 navigate args: { page:"settings", section:"models" }
      const destination =
        args.section === "models" ? "model_settings" : args.page === "settings" ? "settings" : "settings";
      return { type: "navigate", destination };
    }
    case "close":
      return { type: "close" };
    case "dismiss_content":
      return { type: "dismiss_content" };
    default:
      return undefined;
  }
}

async function mapHero(
  hero: RawHero | undefined,
  rawArgs: Record<string, unknown> | undefined,
  planData: Record<string, unknown> | undefined,
  options: { stripClaimIndicator?: boolean } = {},
): Promise<MarketingHero | undefined> {
  if (!hero) return undefined;
  switch (hero.type) {
    case "image":
      return { type: "image", src: hero.image?.default ?? "", darkSrc: hero.image?.dark, alt: "" };
    case "video":
      return { type: "video", src: hero.video?.src ?? "", poster: hero.video?.fallback ?? "", muted: true };
    case "bundle": {
      const bundle = hero.bundle?.bundle;
      const entry = hero.bundle?.entry;
      // 官方 sandbox bundle：host 下载 zip → 校验 sha256 → 解包 → 内联成自包含 data URL。
      // 成功则 iframe 加载动画；失败回落到 data 驱动的静态票券（此处不设 bundle/resolvedUrl）。
      if (bundle?.src && entry) {
        try {
          const resolvedUrl = await prepareMarketingBundle({
            url: bundle.src,
            entry,
            sha256: bundle.sha256 ?? "",
            stripClaimIndicator: options.stripClaimIndicator,
          });
          return {
            type: "interactive_bundle",
            runtime: "zcode-hero-sandbox-v1",
            bundle: { format: "zip", url: bundle.src, entry, sha256: bundle.sha256 ?? "" },
            resolvedUrl,
            viewport: { aspectRatio: "4:3" },
            data: rawArgs ?? {},
            events: { replay: "replay" },
            fallback: hero.bundle?.fallback ? { type: "image", src: hero.bundle.fallback, alt: "" } : undefined,
          };
        } catch {
          // 落到静态票券兜底
        }
      }
      return {
        type: "interactive_bundle",
        runtime: "zcode-hero-sandbox-v1",
        viewport: { aspectRatio: "4:3" },
        data: planData ?? {},
        events: {},
      };
    }
    default:
      return undefined;
  }
}

/** 从官方 bundle hero 的 args.zcode_plan 派生 fork 静态票券需要的 data。 */
function derivePlanData(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const plan = (args?.zcode_plan ?? undefined) as
    | {
        name?: string;
        description?: string;
        show_name?: string;
        grant_units?: number;
        unit_type?: string;
        ends_at?: number;
        entitlements?: { show_name?: string; grant_units?: number; unit_type?: string }[];
      }
    | undefined;
  if (!plan) return { ...(args ?? {}) };
  const first = plan.entitlements?.[0];
  const unitType = plan.unit_type ?? first?.unit_type;
  return {
    planName: plan.name ?? first?.show_name ?? "ZCode",
    amountValue: formatAmount(String(plan.grant_units ?? first?.grant_units ?? "")),
    amountUnit: unitType === "token" ? "Tokens" : unitType ?? "",
    benefits: (plan.entitlements ?? []).map((e) => e.show_name ?? "").filter(Boolean),
    endsAtLabel: plan.ends_at ? new Date(plan.ends_at * 1000).toLocaleDateString("zh-CN") : "",
    endsAtPrefix: "截至",
  };
}

/** 大额数字转中文单位显示（1e8 → 1亿、1e4 → 1万）。 */
function formatAmount(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 100_000_000) return `${n / 100_000_000}亿`;
  if (n >= 10_000) return `${n / 10_000}万`;
  return value;
}

/** 从 planData 派生一张卡片标题/描述，供 banner bar / dialog 标题兜底。 */
function deriveTitleDescription(planData: Record<string, unknown>): { title: string; description: string } {
  const title = String(planData.planName ?? "领取福利");
  const value = formatAmount(String(planData.amountValue ?? ""));
  const unit = String(planData.amountUnit ?? "");
  const description = value ? `${value}${unit} 限时领取` : "限时领取，先到先得";
  return { title, description };
}

function mapButtons(
  rawButtons: RawButton[] | undefined,
  planData: Record<string, unknown> | undefined,
  idPrefix = "action",
): { buttons: MarketingCampaignButton[]; actions: Record<string, MarketingCampaignAction> } {
  const buttons: MarketingCampaignButton[] = [];
  const actions: Record<string, MarketingCampaignAction> = {};
  for (const [i, raw] of (rawButtons ?? []).entries()) {
    const action = mapAction(raw.action);
    // close / dismiss_content 由弹窗右上角 X 承担，不作为 dialog 按钮。
    if (!action || action.type === "close" || action.type === "dismiss_content") continue;
    const actionId = `${idPrefix}-${i}`;
    const label = raw.text?.content?.trim() || (action.type === "claim_plan" ? "立即领取" : "");
    buttons.push({
      id: `button-${i}`,
      label,
      actionId,
      variant: raw.theme?.variant === "secondary" ? "secondary" : raw.theme?.variant === "link" ? "link" : "primary",
    });
    actions[actionId] = action;
  }
  return { buttons, actions };
}

export async function normalizeMarketingDelivery(
  raw: RawMarketingDelivery,
  locale: string,
): Promise<MarketingTouchDelivery | null> {
  if (!raw) return null;
  const normalizedLocale = (locale === "en-US" ? "en-US" : "zh-CN") as "zh-CN" | "en-US";
  const rawArgs = (raw.banner?.background ?? raw.popup?.hero)?.args as Record<string, unknown> | undefined;
  const planData = derivePlanData(rawArgs);
  const { title, description } = deriveTitleDescription(planData);
  const panel = raw.resource_position === "popup" ? raw.popup : raw.banner;

  const rawTitle = panel?.title?.content;
  const rawDesc = panel?.description?.content;
  const dialogTitle = rawTitle?.trim() || title;
  const dialogDesc = rawDesc?.trim() ? textContent(panel!.description) : { format: "plain_text" as const, text: description };
  const { buttons, actions } = mapButtons(panel?.buttons, planData);
  // 弹窗（dialog/popup）hero：剥离「领取」指示器，弹窗底部已有 claim 按钮。
  const hero = await mapHero(
    panel?.hero ?? (raw.resource_position === "banner" ? raw.banner?.background : undefined),
    rawArgs,
    planData,
    { stripClaimIndicator: true },
  );

  const base = {
    schemaVersion: 1 as const,
    id: raw.campaign_id,
    revision: 0,
    kind: "campaign" as const,
    locale: normalizedLocale,
    dialog: {
      title: dialogTitle,
      description: dialogDesc,
      hero,
      buttons,
    },
    actions,
  };

  // 官方领取成功弹窗复用同一 dialog 结构：hero + title/description + buttons
  // （如 模型设置/复制分享）。按钮 actions 用独立前缀并入 campaign.actions。
  const successPanel =
    raw.resource_position === "banner" ? raw.banner?.success_popup : undefined;
  const successPopup = successPanel
    ? await (async () => {
        const { buttons: successButtons, actions: successActions } = mapButtons(
          successPanel.buttons,
          planData,
          "success-action",
        );
        Object.assign(actions, successActions);
        return {
          hero: await mapHero(successPanel.hero, rawArgs, planData, {
            stripClaimIndicator: true,
          }),
          title: successPanel.title?.content,
          description: successPanel.description
            ? textContent(successPanel.description)
            : undefined,
          buttons: successButtons,
        };
      })()
    : undefined;

  if (raw.resource_position === "banner") {
    return {
      resource_position: "banner",
      campaign_id: raw.campaign_id,
      campaign: base,
      banner: {
        background: await mapHero(raw.banner?.background, rawArgs, planData),
        buttons,
        success_popup: successPopup,
      },
    };
  }

  return {
    resource_position: "popup",
    campaign_id: raw.campaign_id,
    campaign: base,
    popup: {
      hero,
      title: rawTitle ?? title,
      description: rawDesc?.trim() ? textContent(panel?.description) : { format: "plain_text" as const, text: description },
      buttons,
    },
  };
}
