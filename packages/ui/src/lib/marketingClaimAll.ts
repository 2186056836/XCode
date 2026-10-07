import type {
  MarketingCaptchaConfig,
  MarketingClaimPlanResponse,
  MarketingTouchDelivery,
  MarketingTouchResponse,
} from "@zcode/shared";
import { logger } from "@/logger.js";
import { runAliyunCaptcha, shouldRunCaptcha } from "@/hooks/useMarketingTouchCampaign.js";

/**
 * 一键领取权益：遍历所有已登录账号，**按各账号的 per-account 凭据**查询营销活动并
 * 自动领取，汇总每个账号的结果。不切换激活账号、不改全局镜像——查询与领取都带
 * accountRef，host 直接读 `zcodejwt:{accountRef}` 组鉴权头。
 */

export interface MarketingClaimAllAccountResult {
  accountRef: string;
  displayName: string;
  provider: string;
  /** claimed=本次领取成功；already-claimed=服务端已领取过；no-campaign=无可领取活动；failed=失败。 */
  status: "claimed" | "already-claimed" | "no-campaign" | "failed";
  /** 失败原因（仅 failed）。 */
  message?: string;
}

export interface MarketingClaimAllDeps {
  listAccounts(): Promise<Array<{ provider: string; identity: string; displayName: string }>>;
  queryTouch(accountRef: string): Promise<MarketingTouchResponse>;
  getCaptchaConfig(): Promise<MarketingCaptchaConfig | null>;
  claimManualPlan(input: {
    planId: string;
    captchaVerifyParam?: string;
    captchaRegion?: string;
    accountRef: string;
  }): Promise<MarketingClaimPlanResponse>;
  getManualClaimPlanPlans(input: {
    accountRef: string;
  }): Promise<{
    plans: Array<{ planId?: string; name?: string; status?: string; endsAt?: number | string | null }>;
  }>;
  locale: string;
  messages: {
    captchaFailed: string;
    captchaLoadFailed: string;
    claimFailed: string;
  };
  onProgress?(done: number, total: number, displayName: string): void;
}

function formatPlanEnds(endsAt: number | string | null | undefined): string {
  if (endsAt == null || endsAt === "") return "";
  const n = typeof endsAt === "string" ? Number(endsAt) : endsAt;
  if (!Number.isFinite(n) || n <= 0) return "";
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function findClaimableDelivery(deliveries: MarketingTouchDelivery[]):
  | { delivery: MarketingTouchDelivery; planId: string }
  | null {
  for (const delivery of deliveries) {
    const actions = delivery.campaign?.actions ?? {};
    const claimAction = Object.values(actions).find((action) => action?.type === "claim_plan");
    if (claimAction?.type === "claim_plan" && claimAction.planId) {
      return { delivery, planId: claimAction.planId };
    }
  }
  return null;
}

async function claimForAccount(
  deps: MarketingClaimAllDeps,
  base: { accountRef: string; displayName: string; provider: string },
): Promise<MarketingClaimAllAccountResult> {
  let deliveries: MarketingTouchDelivery[];
  try {
    const response = await deps.queryTouch(base.accountRef);
    deliveries = response?.deliveries ?? [];
  } catch (error) {
    logger.warn("[MarketingClaimAll] 查询营销活动失败", error);
    return {
      ...base,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const target = findClaimableDelivery(deliveries);
  if (!target) {
    // touch 无领取入口：查名下 Start Plan 计划，区分「已有计划」与「无可领取活动」。
    try {
      const { plans } = await deps.getManualClaimPlanPlans({ accountRef: base.accountRef });
      if (plans.length > 0) {
        const first = plans[0]!;
        const detail = [first.name, formatPlanEnds(first.endsAt)].filter(Boolean).join(" · ");
        return { ...base, status: "already-claimed", message: detail || undefined };
      }
    } catch (error) {
      // balance 查询失败不阻断判定，按无计划处理。
      logger.warn("[MarketingClaimAll] 查询名下计划失败", error);
    }
    return { ...base, status: "no-campaign" };
  }

  let captchaVerifyParam: string | undefined;
  let captchaRegion: string | undefined;
  try {
    const captcha = await deps.getCaptchaConfig();
    if (shouldRunCaptcha(captcha)) {
      const captchaResult = await runAliyunCaptcha(captcha as MarketingCaptchaConfig, {
        failed: deps.messages.captchaFailed,
        loadFailed: deps.messages.captchaLoadFailed,
      });
      captchaVerifyParam = captchaResult?.verifyParam;
      captchaRegion = captchaResult?.region;
      if (!captchaVerifyParam) throw new Error(deps.messages.captchaFailed);
    }
  } catch (error) {
    return {
      ...base,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const result = await deps.claimManualPlan({
      planId: target.planId,
      captchaVerifyParam,
      captchaRegion,
      accountRef: base.accountRef,
    });
    if (!result.success) {
      throw new Error(result.message || deps.messages.claimFailed);
    }
    return { ...base, status: "claimed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 服务端 1003（target already exists）＝该账号此前已领过。
    if (/already exists|1003|已领取/i.test(message)) {
      return { ...base, status: "already-claimed" };
    }
    return { ...base, status: "failed", message };
  }
}

/** 逐账号按凭据领取全部权益；激活账号全程不动。 */
export async function claimMarketingForAllAccounts(
  deps: MarketingClaimAllDeps,
): Promise<MarketingClaimAllAccountResult[]> {
  const accounts = await deps.listAccounts();
  const results: MarketingClaimAllAccountResult[] = [];
  let done = 0;
  for (const account of accounts) {
    const base = {
      accountRef: `${account.provider}:${account.identity}`,
      displayName: account.displayName,
      provider: account.provider,
    };
    deps.onProgress?.(done, accounts.length, account.displayName);
    try {
      results.push(await claimForAccount(deps, base));
    } catch (error) {
      logger.warn("[MarketingClaimAll] 账号领取异常", error);
      results.push({
        ...base,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    done += 1;
  }
  return results;
}
