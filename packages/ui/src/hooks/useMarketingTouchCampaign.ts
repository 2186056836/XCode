import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MarketingCampaign,
  MarketingCampaignAction,
  MarketingCampaignButton,
  MarketingCaptchaConfig,
  MarketingClaimPlanResponse,
  MarketingHero,
  MarketingTextContent,
  MarketingTouchDelivery,
  MarketingTouchReport,
  MarketingTouchReportActionType,
  MarketingTouchResponse,
} from "@zcode/shared";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { useXCodeStore } from "@/store/StoreProvider.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import { logger } from "@/logger.js";

/**
 * Marketing Touch 控制器（复刻官方 controller 状态机）。
 *
 * 官方 client 在登录恢复后轮询 `/api/v1/marketing/touch`，把资源位为 banner 且有可领取
 * 动作的活动展示为顶栏 banner；点击后打开 dialog 弹窗。此 hook 提供同款状态机：
 * `{banner,dialog,pending,phase,error}` 与开关动作、行为上报、领取链路。
 *
 * host dist 类型可能滞后，这里用局部断言补齐新增方法，与 OAuthAccountService
 * / useCodingPlanBillingDiscount 的处理方式一致。
 */

interface MarketingTouchServiceLike {
  query(input: { locale: string; seq?: number }): Promise<MarketingTouchResponse>;
  report(input: MarketingTouchReport): Promise<void>;
}

interface CodingPlanMarketingCapableService {
  claimManualPlan(input: {
    planId: string;
    captchaVerifyParam?: string;
    captchaRegion?: string;
  }): Promise<MarketingClaimPlanResponse>;
  getCaptchaConfig(): Promise<MarketingCaptchaConfig | null>;
}

export type MarketingTouchPhase = "idle" | "claiming" | "success" | "error";

export interface MarketingTouchCampaignState {
  loading: boolean;
  banner: MarketingTouchDelivery | null;
  dialog: MarketingTouchDelivery | null;
  pending: boolean;
  phase: MarketingTouchPhase;
  error: string | null;
  successTitle: string | null;
  /** Success description as rich content (format=text/html/markdown). */
  successDescription: MarketingTextContent | null;
  /** 领取成功后的 hero（banner.success_popup.hero）。 */
  successHero: MarketingHero | null;
  /** 领取成功弹窗的动作按钮（模型设置/复制分享），actionId 关联 campaign.actions。 */
  successButtons: MarketingCampaignButton[];
}

const BANNER_DISMISSED_KEY = "zcode-marketing-banner-dismissed";
const PROD_POLL_MS = 10 * 60 * 1000;
const DEV_POLL_MS = 30 * 1000;

/** 已关闭/已领取卡片的会话内标记：按 账号+campaign 隔离，换号后互不影响。 */
function bannerDismissedStorageKey(userId: string | null, campaignId: string): string {
  return `${BANNER_DISMISSED_KEY}:${userId ?? "anon"}:${campaignId}`;
}

function writeBannerDismissed(userId: string | null, campaignId: string): void {
  try {
    window.sessionStorage.setItem(
      bannerDismissedStorageKey(userId, campaignId),
      String(Date.now()),
    );
  } catch {
    // 忽略。
  }
}

function readBannerDismissed(storageKey: string): boolean {
  try {
    return window.sessionStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

function isDev(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    (typeof window !== "undefined" && window.location.port === "5174")
  );
}

/** 从 delivery 解析弹窗内容（campaign.dialog 兜底）。 */
export function resolveDialog(delivery: MarketingTouchDelivery): MarketingCampaign | undefined {
  return delivery.campaign;
}

/** 解析按钮关联的 action。 */
export function resolveAction(
  campaign: MarketingCampaign | undefined,
  button: MarketingCampaignButton,
): MarketingCampaignAction | undefined {
  return campaign?.actions?.[button.actionId];
}

export function useMarketingTouchCampaign() {
  const services = useOptionalServices();
  const touchService = services?.marketingTouchService as
    | MarketingTouchServiceLike
    | undefined;
  const baseCodingPlanService = services?.codingPlanSubscriptionService;
  const codingPlanService = (baseCodingPlanService as
    | (NonNullable<typeof baseCodingPlanService> & CodingPlanMarketingCapableService)
    | undefined);
  const { locale, intl } = useXCodeIntl();
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);

  const [state, setState] = useState<MarketingTouchCampaignState>({
    loading: false,
    banner: null,
    dialog: null,
    pending: false,
    phase: "idle",
    error: null,
    successTitle: null,
    successDescription: null,
    successHero: null,
    successButtons: [],
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const touchServiceRef = useRef(touchService);
  touchServiceRef.current = touchService;
  /** 已自动弹出的 popup campaign（本会话去重；换号即作废）。 */
  const popupOpenedRef = useRef(new Set<string>());
  /** 激活账号 id：领取卡片的关闭/领取标记按账号隔离，换号立即重查。 */
  const activeUserId = useXCodeStore((state) => state.user?.id ?? null);
  const activeUserIdRef = useRef(activeUserId);

  const report = useCallback(
    async (delivery: MarketingTouchDelivery | null, actionType: MarketingTouchReportActionType) => {
      if (!touchServiceRef.current || !delivery) return;
      try {
        await touchServiceRef.current.report({
          scope: "",
          campaignId: delivery.campaign_id,
          actionType,
          locale,
        });
      } catch (error) {
        logger.warn("[MarketingTouch] 行为上报失败", error);
      }
    },
    [locale],
  );

  const refresh = useCallback(async () => {
    if (!touchService) return;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const response = await touchService.query({ locale });
      const banner = pickBannerDelivery(response, (campaignId) =>
        readBannerDismissed(bannerDismissedStorageKey(activeUserIdRef.current, campaignId)),
      );
      if (banner) {
        setState((prev) => ({ ...prev, banner: prev.banner ?? banner, loading: false }));
        void report(banner, "expose");
      } else {
        setState((prev) => ({ ...prev, banner: null, loading: false }));
      }
      // popup 资源位：官方直出弹窗（无横幅）。同一 campaign 本会话自动弹一次。
      const popup = pickPopupDelivery(response);
      if (popup && !stateRef.current.dialog && !popupOpenedRef.current.has(popup.campaign_id)) {
        popupOpenedRef.current.add(popup.campaign_id);
        setState((prev) => ({ ...prev, dialog: popup, phase: "idle", error: null }));
        void report(popup, "expose");
      }
    } catch (error) {
      logger.warn("[MarketingTouch] 拉取营销活动失败", error);
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [touchService, locale, report]);

  const closeBanner = useCallback(() => {
    const banner = stateRef.current.banner;
    setState((prev) => ({ ...prev, banner: null }));
    void report(banner, "close");
    if (banner) writeBannerDismissed(activeUserIdRef.current, banner.campaign_id);
  }, [report]);

  const openDialog = useCallback(
    (delivery: MarketingTouchDelivery) => {
      setState((prev) => ({ ...prev, dialog: delivery, phase: "idle", error: null }));
      void report(delivery, "click");
    },
    [report],
  );

  const closeDialog = useCallback(() => {
    const dialog = stateRef.current.dialog;
    setState((prev) => ({ ...prev, dialog: null, phase: "idle", error: null }));
    void report(dialog, "close");
  }, [report]);

  const dismissContent = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  const claimPlan = useCallback(
    async (delivery: MarketingTouchDelivery, planId: string) => {
      const captchaFailed = intl.formatMessage({ id: "marketing.captchaFailed" });
      if (!codingPlanService || !planId) {
        setState((prev) => ({
          ...prev,
          phase: "error",
          error: intl.formatMessage({ id: "marketing.claimMissingPlan" }),
        }));
        return;
      }
      setState((prev) => ({ ...prev, phase: "claiming", pending: true, error: null }));
      try {
        let captchaVerifyParam: string | undefined;
        let captchaRegion: string | undefined;
        const captcha = await codingPlanService.getCaptchaConfig();
        // 官方门槛：无配置 / enabled===false / 缺 region|prefix|sceneId 时验证码关闭，
        // 领取不带验证码头；否则优先 traceless（无感）验证。
        if (shouldRunCaptcha(captcha)) {
          const captchaResult = await runAliyunCaptcha(captcha as MarketingCaptchaConfig, {
            failed: captchaFailed,
            loadFailed: intl.formatMessage({ id: "marketing.captchaLoadFailed" }),
          });
          captchaVerifyParam = captchaResult?.verifyParam;
          captchaRegion = captchaResult?.region;
          if (!captchaVerifyParam) throw new Error(captchaFailed);
        }
        const result = await codingPlanService.claimManualPlan({
          planId,
          captchaVerifyParam,
          captchaRegion,
        });
        if (!result.success) {
          throw new Error(result.message || intl.formatMessage({ id: "marketing.claimFailed" }));
        }
        const success = delivery.banner?.success_popup;
        // 领取成功：同 campaign 的卡片立即收掉并写会话标记（生产轮询 10min，
        // 不主动清会让卡片一直挂着）；不同 campaign 的卡片不动。
        // 官方交互：点卡片直接领取，成功弹 success_popup 弹窗——确保弹窗有载体。
        setState((prev) => ({
          ...prev,
          phase: "success",
          pending: false,
          banner: prev.banner?.campaign_id === delivery.campaign_id ? null : prev.banner,
          dialog: prev.dialog ?? delivery,
          successTitle: success?.title ?? intl.formatMessage({ id: "marketing.claimSuccessTitle" }),
          successDescription:
            success?.description ??
            ({ format: "plain_text", text: intl.formatMessage({ id: "marketing.claimSuccessDescription" }) } as MarketingTextContent),
          successHero: success?.hero ?? null,
          successButtons: success?.buttons ?? [],
        }));
        writeBannerDismissed(activeUserIdRef.current, delivery.campaign_id);
        void report(delivery, "claim_success");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("[MarketingTouch] 领取失败", error);
        // 直领失败：打开弹窗承载错误行与重试按钮（对齐官方失败反馈），卡片保留。
        setState((prev) => ({
          ...prev,
          phase: "error",
          pending: false,
          error: message,
          dialog: prev.dialog ?? delivery,
        }));
        void report(delivery, "claim_fail");
      }
    },
    [codingPlanService, report, intl],
  );

  // 官方交互：点击侧栏卡片 = 直接触发领取（无中间弹窗）；无 claim 动作才退回打开弹窗。
  // 领取成功由 claimPlan 弹 success_popup 弹窗；失败由 claimPlan 打开错误弹窗（可重试）。
  const claimFromBanner = useCallback(
    (delivery: MarketingTouchDelivery) => {
      void report(delivery, "click");
      const actions = delivery.campaign?.actions ?? {};
      const claimAction = Object.values(actions).find((action) => action?.type === "claim_plan");
      if (!claimAction) {
        openDialog(delivery);
        return;
      }
      void claimPlan(delivery, claimAction.planId);
    },
    [report, openDialog, claimPlan],
  );

  const runAction = useCallback(
    async (delivery: MarketingTouchDelivery, action: MarketingCampaignAction | undefined) => {
      if (!action) {
        closeDialog();
        return;
      }
      const campaign = resolveDialog(delivery);
      switch (action.type) {
        case "close":
          closeDialog();
          break;
        case "dismiss_content":
          dismissContent();
          break;
        case "navigate":
          if (action.destination === "model_settings") {
            setPendingSettingsSection("modelProvider");
            openSettingsTab();
          } else if (action.destination === "plugin_store") {
            setPendingSettingsSection("plugin");
            openSettingsTab();
          } else if (action.destination === "settings") {
            openSettingsTab();
          }
          closeDialog();
          break;
        case "copy_text":
          try {
            await navigator.clipboard.writeText(action.text);
          } catch (error) {
            logger.warn("[MarketingTouch] 复制失败", error);
          }
          break;
        case "open_external":
          window.open(action.url, "_blank", "noopener,noreferrer");
          closeDialog();
          break;
        case "claim_plan":
          await claimPlan(delivery, action.planId);
          break;
      }
    },
    [closeDialog, dismissContent, openSettingsTab, claimPlan],
  );

  const handleButton = useCallback(
    (delivery: MarketingTouchDelivery, button: MarketingCampaignButton) => {
      void runAction(delivery, resolveAction(resolveDialog(delivery), button));
    },
    [runAction],
  );

  // 轮询 + visibility/online 触发，与官方 10min/30s 一致。
  useEffect(() => {
    if (!touchService) return;
    void refresh();
    const intervalMs = isDev() ? DEV_POLL_MS : PROD_POLL_MS;
    const timer = window.setInterval(() => void refresh(), intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [touchService, refresh]);

  // 账号切换：popup 去重标记作废 + 立即重查，让领取卡片/弹窗跟随新账号
  // （生产轮询 10min，不主动重查会让旧账号的卡片挂到下个轮询周期）。
  useEffect(() => {
    if (activeUserIdRef.current === activeUserId) return;
    activeUserIdRef.current = activeUserId;
    popupOpenedRef.current.clear();
    void refresh();
  }, [activeUserId, refresh]);

  return {
    ...state,
    refresh,
    closeBanner,
    openDialog,
    claimFromBanner,
    closeDialog,
    dismissContent,
    runAction,
    handleButton,
  };
}

function pickBannerDelivery(
  response: MarketingTouchResponse,
  isDismissed: (campaignId: string) => boolean,
): MarketingTouchDelivery | null {
  const deliveries = response?.deliveries ?? [];
  for (const delivery of deliveries) {
    if (delivery.resource_position !== "banner") continue;
    if (!delivery.banner?.background && !delivery.banner?.success_popup) continue;
    if (!hasClaimAction(delivery)) continue;
    if (isDismissed(delivery.campaign_id)) continue;
    return delivery;
  }
  return null;
}

function pickPopupDelivery(response: MarketingTouchResponse): MarketingTouchDelivery | null {
  const deliveries = response?.deliveries ?? [];
  for (const delivery of deliveries) {
    if (delivery.resource_position !== "popup") continue;
    if (!hasClaimAction(delivery)) continue;
    return delivery;
  }
  return null;
}

function hasClaimAction(delivery: MarketingTouchDelivery): boolean {
  const actions = delivery.campaign?.actions ?? {};
  return Object.values(actions).some((action) => action?.type === "claim_plan");
}

export interface AliyunCaptchaResult {
  verifyParam: string;
  region?: string;
}

/** 官方 `p3` 门槛：验证码是否开启。 */
export function shouldRunCaptcha(config: MarketingCaptchaConfig | null): boolean {
  return Boolean(
    config &&
      config.enabled !== false &&
      config.region &&
      config.prefix &&
      config.sceneId,
  );
}

/**
 * 阿里云验证码。加载官方 SDK（o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js），
 * 优先 `startTracelessVerification`（无感静默验证），不可用才回退 `show()`。
 * SDK 不可用/验证失败时抛错，绝不静默跳过；是否跳过由 `shouldRunCaptcha` 决定。
 */
export async function runAliyunCaptcha(
  config: MarketingCaptchaConfig,
  messages: { failed: string; loadFailed: string },
): Promise<AliyunCaptchaResult | null> {
  if (typeof window === "undefined") return null;
  const containerId = "zcode-aliyun-captcha-container";
  const elementId = "zcode-aliyun-captcha-element";
  const buttonId = "zcode-aliyun-captcha-button";
  try {
    await loadAliyunCaptchaScript();
  } catch (error) {
    logger.warn("[MarketingTouch] 验证码 SDK 加载失败", error);
    throw new Error(messages.loadFailed);
  }
  const initFn = (window as unknown as { initAliyunCaptcha?: (options: unknown) => void })
    .initAliyunCaptcha;
  if (typeof initFn !== "function") throw new Error(messages.loadFailed);

  const container = document.createElement("div");
  container.id = containerId;
  container.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;height:0;width:0;overflow:hidden;";
  container.innerHTML = `<div id="${elementId}"></div><button id="${buttonId}" type="button"></button>`;
  document.body.appendChild(container);

  // 官方在 init 前设置 window.AliyunCaptchaConfig，aliyun SDK 依赖它读取 region/prefix；
  // 缺少会导致验证不产生有效的 verifyCode，服务器返回 captcha verify failed。
  (window as unknown as { AliyunCaptchaConfig?: { region: string; prefix: string } }).AliyunCaptchaConfig =
    { region: config.region!, prefix: config.prefix! };

  return await new Promise<AliyunCaptchaResult | null>((resolve, reject) => {
    let instance: { startTracelessVerification?: () => void; show?: () => void } | null = null;
    let settled = false;
    let triggered = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutTimer);
      container.remove();
      fn();
    };
    const trigger = () => {
      if (triggered || settled) return;
      if (instance?.startTracelessVerification) {
        triggered = true;
        instance.startTracelessVerification();
      } else if (instance?.show) {
        triggered = true;
        instance.show();
      }
    };
    // getInstance 可能延迟触发，轮询等待实例就绪后触发无感验证。
    const pollTimer = window.setInterval(() => {
      if (instance) {
        window.clearInterval(pollTimer);
        trigger();
      }
    }, 100);
    const timeoutTimer = window.setTimeout(() => {
      if (!settled) finish(() => reject(new Error(messages.failed)));
    }, 12_000);
    try {
      initFn({
        SceneId: config.sceneId,
        mode: "popup",
        language: config.language === "en-US" ? "en" : "cn",
        showErrorTip: false,
        element: `#${elementId}`,
        button: `#${buttonId}`,
        getInstance: (inst: { startTracelessVerification?: () => void; show?: () => void }) => {
          instance = inst;
        },
        success: (verifyParam: string) => {
          finish(() => resolve({ verifyParam, region: config.region }));
        },
        fail: () => {
          // 无感验证失败时回退交互式验证（官方 allowInteractive 行为）。
          if (!settled && instance?.show) {
            try {
              instance.show();
              return;
            } catch {
              // 落到 reject
            }
          }
          finish(() => reject(new Error(messages.failed)));
        },
        onError: () => finish(() => reject(new Error(messages.loadFailed))),
      });
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(messages.failed)));
    }
  });
}

let aliYunCaptchaLoadPromise: Promise<void> | null = null;
const ALIYUN_CAPTCHA_SDK = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
function loadAliyunCaptchaScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as unknown as { initAliyunCaptcha?: unknown }).initAliyunCaptcha) return Promise.resolve();
  if (aliYunCaptchaLoadPromise) return aliYunCaptchaLoadPromise;
  aliYunCaptchaLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ALIYUN_CAPTCHA_SDK;
    script.onload = () => resolve();
    script.onerror = () => {
      aliYunCaptchaLoadPromise = null;
      reject(new Error("captcha_sdk_load_failed"));
    };
    document.head.appendChild(script);
  });
  return aliYunCaptchaLoadPromise;
}
