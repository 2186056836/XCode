import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Progress } from "@/components/ui/progress.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import type { AccountQuotaSnapshot, QuotaBatchResult } from "@zcode/services";
import { formatQuotaResetTime } from "@/lib/codingPlanQuotaPresentation.js";

/**
 * XCode fork：账号额度/配额展示（Qoder / CodeBuddy 通用）。
 *
 * 【为什么不做成独立板块】
 *   用户明确要求「额度显示在账号区域就行」——额度是账号的属性，不是独立的
 *   设置项。所以这里只暴露：
 *     - useAccountQuota()：一次批量查询（服务端并发上限 4）+ 按 accountId 索引；
 *     - AccountQuotaInline：账号行内的紧凑额度文案（不占整行、不抢视觉权重）。
 *   账号行（QoderLoginSection / CodeBuddyLoginSection）负责把它们摆到
 *   账号副标题那一行（与到期时间并列）。
 *
 * 数据经 RPC 走 host（providerSettingsService.qoderQueryAllQuotas /
 * codebuddyQueryAllQuotas），渲染端不直接碰上游。失败静默降级——额度查不到
 * 不该在账号区弹错误块，账号本身仍可用。
 */

/** 账号额度查询结果：按 accountId 索引的快照 + 汇总（供账号列表标题行用）。 */
export interface AccountQuotaView {
  /** accountId → 快照；查询失败或未返回的账号不在表内。 */
  byAccountId: ReadonlyMap<string, AccountQuotaSnapshot>;
  /** 汇总（账号数/总额/平均/最小/最大）；无数据时为 null。 */
  summary: QuotaBatchResult["summary"] | null;
  /** 首次加载中（有数据后刷新不再置 true，避免闪烁）。 */
  loading: boolean;
  /** 重新查询（供刷新按钮用）。 */
  refresh: () => void;
}

/**
 * 批量拉取本区全部账号的额度，按 accountId 索引。
 *
 * 惰性：挂载即查一次（账号区可见时才挂载）；不做轮询——额度不是高频变化量，
 * 且上游查询有成本。用户可通过 refresh 手动刷新。
 */
export function useAccountQuota(input: {
  family: "qoder" | "codebuddy";
  region: "cn" | "intl";
}): AccountQuotaView {
  const { providerSettingsService } = useServices();
  const [batch, setBatch] = useState<QuotaBatchResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result =
        input.family === "qoder"
          ? await providerSettingsService.qoderQueryAllQuotas({ regions: [input.region] })
          : await providerSettingsService.codebuddyQueryAllQuotas({ regions: [input.region] });
      setBatch(result);
    } catch {
      // 静默降级：额度不可得时账号区照常可用，不弹错误块。
      setBatch(null);
    } finally {
      setLoading(false);
    }
  }, [input.family, input.region, providerSettingsService]);

  useEffect(() => {
    void load();
  }, [load]);

  const byAccountId = useMemo(() => {
    const map = new Map<string, AccountQuotaSnapshot>();
    for (const snapshot of batch?.results ?? []) map.set(snapshot.accountId, snapshot);
    return map;
  }, [batch]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { byAccountId, summary: batch?.summary ?? null, loading, refresh };
}

/**
 * 账号行内的紧凑额度文案。
 *
 * 形态：进度条 + `剩余 1,234 / 2,000 · Pro · 11-13 重置`。
 * 进度条表达「剩余占比」——条越短剩余越少，低于阈值转警示色。
 * 无数据/失败时不渲染（静默），账号行不会因为额度不可得而出现空壳。
 *
 * **长度必须恒定**：额度条的用途是让多个账号纵向对比（谁的余量先见底），
 * 如果让它跟着右侧可用空间伸缩，账号行多一个「使用」按钮就会窄一截、短一大截，
 * 条长本身变成噪音。所以本组件要求调用方把它放进**整宽行**（账号卡片自己的
 * 一行），宽度只由卡片决定，与右侧按钮数量无关；这里再取满整行宽度。
 */
export function AccountQuotaInline({
  snapshot,
}: {
  snapshot: AccountQuotaSnapshot | undefined;
}) {
  const { intl, locale } = useXCodeIntl();
  if (!snapshot) return null;

  const formatNumber = (value: number) =>
    new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 1 }).format(value);

  const detail = resolveQuotaDetail(snapshot, formatNumber, intl);
  if (!detail) return null;

  const meta: string[] = [];
  if (snapshot.planName) {
    meta.push(intl.formatMessage({ id: "settings.quota.plan" }, { plan: snapshot.planName }));
  }
  const resetAt = formatResetLabel(snapshot.resetAt, locale);
  if (resetAt) meta.push(resetAt);

  // 只有同时拿到剩余和总量才能画占比；缺任一侧就退化成纯文本，
  // 不拿 0 或 100 编造一个没有依据的进度。
  const percent = resolveRemainingPercent(snapshot);

  return (
    // 取满宿主行宽度；宿主必须是账号卡片的整宽行，条长才与右侧按钮数量无关。
    <div className="w-full space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ui-sm text-foreground-subtle">
        <span className={snapshot.exceeded ? "text-destructive" : undefined}>{detail}</span>
        {meta.length > 0 ? <span>{meta.join(" · ")}</span> : null}
      </div>
      {percent !== null ? (
        <Progress
          value={percent}
          className="h-1.5"
          indicatorClassName={quotaIndicatorClass(snapshot, percent)}
          aria-label={detail}
        />
      ) : null}
    </div>
  );
}

/**
 * 剩余占比（0-100）。total 缺失或非正数时返回 null——那种情况下任何
 * 百分比都是编的，宁可不画。
 */
function resolveRemainingPercent(snapshot: AccountQuotaSnapshot): number | null {
  const { remaining, total } = snapshot;
  if (remaining === null || total === null || !Number.isFinite(total) || total <= 0) return null;
  const ratio = remaining / total;
  if (!Number.isFinite(ratio)) return null;
  return Math.min(Math.max(ratio * 100, 0), 100);
}

/**
 * 进度条配色：超额/见底转 destructive，低于 20% 转警示，其余用主色。
 * 额度是账号可用性的直接信号，见底时应当在视觉上先于文字被注意到。
 */
function quotaIndicatorClass(snapshot: AccountQuotaSnapshot, percent: number): string {
  if (snapshot.exceeded || percent <= 0) return "bg-destructive";
  if (percent <= 20) return "bg-warning";
  return "bg-primary";
}

/** 汇总条：账号数 / 总额 / 平均 / 最小 / 最大（只统计有数据的账号）。 */
export function AccountQuotaSummaryLine({
  summary,
  loading,
}: {
  summary: QuotaBatchResult["summary"] | null;
  loading: boolean;
}) {
  const { intl, locale } = useXCodeIntl();
  if (loading && !summary) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        {intl.formatMessage({ id: "settings.quota.loading" })}
      </span>
    );
  }
  if (!summary || summary.accountCount === 0) return null;
  const formatNumber = (value: number) =>
    new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 1 }).format(value);
  return (
    <span className="text-ui-sm text-foreground-subtle">
      {intl.formatMessage(
        { id: "settings.quota.summary" },
        {
          count: String(summary.accountCount),
          total: formatNumber(summary.totalRemaining),
          avg: formatNumber(summary.averageRemaining),
          min: formatNumber(summary.minRemaining ?? 0),
          max: formatNumber(summary.maxRemaining ?? 0),
        },
      )}
      {summary.failedCount > 0
        ? " " +
          intl.formatMessage(
            { id: "settings.quota.summaryFailed" },
            { failed: String(summary.failedCount) },
          )
        : ""}
    </span>
  );
}

/** 重置时间：解析失败或缺失时不显示（不编造）。 */
function formatResetLabel(value: string | null, locale: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return (
    formatQuotaResetTime({ locale: locale ?? "zh-CN", value: parsed, format: "adaptive" }) ?? null
  );
}

/** 额度主文案：ok 给剩余/总额（缺字段给空态文案），no_token/error 给原因。 */
function resolveQuotaDetail(
  snapshot: AccountQuotaSnapshot,
  formatNumber: (value: number) => string,
  intl: ReturnType<typeof useXCodeIntl>["intl"],
): string {
  if (snapshot.status === "no_token") {
    return intl.formatMessage({ id: "settings.quota.accountNoToken" });
  }
  if (snapshot.status === "error") {
    return intl.formatMessage(
      { id: "settings.quota.accountFailed" },
      { message: snapshot.error ?? "unknown" },
    );
  }
  if (snapshot.remaining !== null && snapshot.total !== null) {
    return intl.formatMessage(
      { id: "settings.quota.accountRemaining" },
      { remaining: formatNumber(snapshot.remaining), total: formatNumber(snapshot.total) },
    );
  }
  if (snapshot.remaining !== null) {
    return intl.formatMessage(
      { id: "settings.quota.accountRemainingUnknownTotal" },
      { remaining: formatNumber(snapshot.remaining) },
    );
  }
  return intl.formatMessage({ id: "settings.quota.accountNoData" });
}
