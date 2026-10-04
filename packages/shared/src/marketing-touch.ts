/**
 * Marketing Touch 营销活动类型（host 与 UI 共享）。
 *
 * 该文件已按官方 ZCode 客户端（3.14.4）从 asar 反编译出的真实 schema 对齐：
 *   - heap 判别联合：image / video / lottie / interactive_bundle
 *   - interactive_bundle 走云端 sandbox（runtime `zcode-hero-sandbox-v1`），
 *     通过 zip bundle（url+entry+sha256）+ 沙箱 iframe + postMessage 通信
 *   - dialog.description 是 {format, text} 对象；buttons 用 actionId 关联 actions
 */

export type MarketingTouchResourcePosition = "banner" | "popup";
export type MarketingCampaignKind = "campaign" | "feature" | "notice";
export type MarketingTextFormat = "plain_text" | "html" | "markdown";

/** http(s) URL，不含账号/密码。 */
export type MarketingHttpsUrl = string;

export interface MarketingTextContent {
  format: MarketingTextFormat;
  text: string;
}

/** 图片 hero。 */
export interface MarketingImageHero {
  type: "image";
  src: MarketingHttpsUrl;
  darkSrc?: MarketingHttpsUrl;
  alt: string;
  fit?: "cover" | "contain";
}

/** 视频 hero。 */
export interface MarketingVideoHero {
  type: "video";
  src: MarketingHttpsUrl;
  darkSrc?: MarketingHttpsUrl;
  poster: MarketingHttpsUrl;
  autoplay?: boolean;
  loop?: boolean;
  muted: true;
  fit?: "cover" | "contain";
}

/** Lottie hero。 */
export interface MarketingLottieHero {
  type: "lottie";
  src: MarketingHttpsUrl;
  darkSrc?: MarketingHttpsUrl;
  autoplay?: boolean;
  loop?: boolean;
  speed?: number;
  fallback?: MarketingImageHero;
}

/** 云端交互 bundle（zip）配置。 */
export interface MarketingBundle {
  format: "zip";
  url: MarketingHttpsUrl;
  /** zip 内的入口文件路径。 */
  entry: string;
  /** 64 位小写 hex。 */
  sha256: string;
  sizeBytes?: number;
}

/**
 * interactive_bundle 运行时 sandbox（官方 `zcode-hero-sandbox-v1`）。
 *
 * 渲染成 `<iframe sandbox="allow-scripts" src={resolvedUrl}>`，onLoad 后向 iframe
 * postMessage `{channel:'zcode-cloud-hero-v1', type:'init', instanceId, theme, locale, reducedMotion, data}`；
 * iframe 回 `{channel, instanceId, type:'ready'|'action'|'error'|'resize'}`。
 */
export interface MarketingInteractiveBundleHero {
  type: "interactive_bundle";
  runtime: "zcode-hero-sandbox-v1";
  bundle?: MarketingBundle;
  /** 官方把 zip 解到云端资源后的可加载 URL（blob / 云资源协议）。 */
  resolvedUrl?: MarketingHttpsUrl;
  viewport: { aspectRatio: "4:3" };
  /** 传给 sandbox 的 args（官方用 Ynn() 从 args.zcode_plan 映射）。 */
  data: Record<string, unknown>;
  /** 事件名 → actionId 映射，例如 {replay:'replay'}。 */
  events: Record<string, string>;
  fallback?: MarketingImageHero;
}

export type MarketingHero =
  | MarketingImageHero
  | MarketingVideoHero
  | MarketingLottieHero
  | MarketingInteractiveBundleHero;

export type MarketingButtonVariant = "primary" | "secondary" | "link";

export interface MarketingCampaignButton {
  id: string;
  label: string;
  variant?: MarketingButtonVariant;
  /** 主题样式（可选）。 */
  theme?: Record<string, string> | null;
  /** 关联到 campaign.actions 的 actionId。 */
  actionId: string;
}

export type MarketingNavigateDestination = "model_settings" | "plugin_store" | "settings";

export type MarketingCampaignAction =
  | { type: "close" }
  | { type: "dismiss_content" }
  | { type: "navigate"; destination: MarketingNavigateDestination }
  | { type: "copy_text"; text: string }
  | { type: "open_external"; url: MarketingHttpsUrl }
  | { type: "claim_plan"; planId: string };

export interface MarketingCampaignDialog {
  title: string;
  description: MarketingTextContent;
  hero?: MarketingHero;
  buttons: MarketingCampaignButton[];
}

export interface MarketingCampaign {
  schemaVersion: 1;
  id: string;
  revision: number;
  kind: MarketingCampaignKind;
  locale: "zh-CN" | "en-US";
  dialog: MarketingCampaignDialog;
  actions: Record<string, MarketingCampaignAction>;
}

/**
 * 官方下发的触摸条目（touch delivery）。
 *
 * banner 资源位使用 `banner.background`（banner 背景 hero）与 `banner.success_popup.hero`；
 * popup 资源位使用 `popup.hero`。按钮/动作收敛到 campaign。
 */
export interface MarketingTouchDelivery {
  resource_position: MarketingTouchResourcePosition;
  campaign_id: string;
  campaign?: MarketingCampaign;
  banner?: {
    background?: MarketingHero;
    buttons?: MarketingCampaignButton[];
    success_popup?: {
      hero?: MarketingHero;
      title?: string;
      description?: MarketingTextContent;
      /** 领取成功弹窗的动作按钮（如 模型设置/复制分享），actionId 关联 campaign.actions。 */
      buttons?: MarketingCampaignButton[];
    };
  };
  popup?: {
    hero?: MarketingHero;
    title?: string;
    description?: MarketingTextContent;
    buttons?: MarketingCampaignButton[];
  };
}

export interface MarketingTouchResponse {
  scope?: string;
  seq?: number;
  deliveries: MarketingTouchDelivery[];
}

export type MarketingTouchReportActionType =
  | "expose"
  | "click"
  | "claim_success"
  | "claim_fail"
  | "close";

export interface MarketingTouchReport {
  scope: string;
  campaignId: string;
  actionType: MarketingTouchReportActionType;
  locale: string;
  extra?: Record<string, string | number | boolean>;
}

/**
 * campaign args 内的 `zcode_plan`（官方 Ynn() 映射的数据源）。
 */
export interface ZcodePlanData {
  name?: string;
  ends_at?: number;
  entitlements?: Array<{
    meter?: string;
    grant_units?: number;
    show_name?: string;
    unit_type?: string;
  }>;
}

export interface MarketingManualPlanPreviewResponse {
  plans?: Array<Record<string, unknown>>;
}

export interface MarketingManualPlanPreview {
  planId: string;
  name?: string;
  benefits?: string[];
  amountValue?: string;
  amountUnit?: string;
  endsAtLabel?: string;
  [key: string]: unknown;
}

export interface MarketingClaimPlanResponse {
  success: boolean;
  code?: number;
  message?: string;
  plan?: {
    userPlanId?: string;
    planId?: string;
    status?: string;
    startsAt?: string;
    endsAt?: string;
    entitlements?: string[];
  };
}

/**
 * 阿里云验证码配置（来自 client/configs 的 captcha 字段）。
 *
 * 官方门槛（`p3`）：无配置、`enabled===false`、或缺 `region/prefix/sceneId` 任一，
 * 视为验证码关闭，领取时不带验证码头。开启时用 `{region,prefix,sceneId,language}`
 * 初始化 aliyunCaptcha 并优先 traceless（无感）验证。
 */
export interface MarketingCaptchaConfig {
  enabled?: boolean;
  region?: string;
  prefix?: string;
  sceneId?: string;
  language?: string;
  [key: string]: unknown;
}
