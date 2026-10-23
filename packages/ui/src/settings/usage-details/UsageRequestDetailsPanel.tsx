import { useCallback, useMemo, useState } from "react";
import type { XCodeUsageRequestDetailsResult } from "@zcode/shared";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import {
  EMPTY_USAGE_DETAILS_FILTERS,
  useUsageRequestDetails,
  type UsageDetailsFilters,
  type UsageDetailsStatusFilter,
} from "@/hooks/useUsageRequestDetails.js";
import { UsageEmptyState } from "@/settings/usage-stats/usageStatsUiParts.js";
import { UsageRequestDetailsDialog } from "./UsageRequestDetailsDialog.js";

type DetailRow = XCodeUsageRequestDetailsResult["details"][number];

const STATUS_OPTIONS: UsageDetailsStatusFilter[] = ["", "completed", "error", "cancelled", "running"];

function formatTimestamp(locale: string, value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(value: number | undefined): string {
  if (value === undefined) return "--";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatTokens(value: number | undefined): string {
  if (value === undefined) return "--";
  return new Intl.NumberFormat().format(value);
}

/**
 * 「使用详情」：逐请求的模型调用明细。
 *
 * 数据源是 agent 侧 model_usage 表（与「使用统计」同源），此处展示每条物理请求的
 * provider / 模型 / 账号 / 出口代理 / 耗时 / tokens。
 */
export function UsageRequestDetailsPanel() {
  const { intl, locale } = useXCodeIntl();
  const providerSettings = useProviderSettingsView();
  const {
    error,
    filters,
    loading,
    page,
    pageSize,
    refresh,
    result,
    setFilters,
    setPage,
    setPageSize,
  } = useUsageRequestDetails();
  const [selected, setSelected] = useState<DetailRow | null>(null);

  const rows = result?.details ?? [];
  const pagination = result?.pagination;
  const totalItems = pagination?.totalItems ?? 0;
  const totalPages = pagination?.totalPages ?? 0;

  const updateFilter = useMemo(
    () => (patch: Partial<UsageDetailsFilters>) => {
      setFilters({ ...filters, ...patch });
    },
    [filters, setFilters],
  );

  const providerOptions = result?.providers ?? [];
  const modelOptions = result?.models ?? [];

  // 供应商列与过滤下拉显示名称而不是 id：id 是 `other:qoder` 这类内部标识，
  // 对用户没有意义。取不到名称时回落到 id 本身。
  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of providerSettings.state.status === "ready" ? providerSettings.state.view.providers : []) {
      if (provider.providerName) map.set(provider.providerId, provider.providerName);
    }
    return map;
  }, [providerSettings.state]);
  const providerLabel = useCallback(
    (providerId: string) => providerNameById.get(providerId) ?? providerId,
    [providerNameById],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usageDetails.filter.provider" })}
          </span>
          <Select
            value={filters.providerId || "all"}
            onValueChange={(value) => updateFilter({ providerId: value === "all" ? "" : value })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {intl.formatMessage({ id: "settings.usageDetails.filter.allProviders" })}
              </SelectItem>
              {providerOptions.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {providerLabel(provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usageDetails.filter.model" })}
          </span>
          <Select
            value={filters.modelId || "all"}
            onValueChange={(value) => updateFilter({ modelId: value === "all" ? "" : value })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {intl.formatMessage({ id: "settings.usageDetails.filter.allModels" })}
              </SelectItem>
              {modelOptions.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usageDetails.filter.status" })}
          </span>
          <Select
            value={filters.status || "all"}
            onValueChange={(value) =>
              updateFilter({ status: (value === "all" ? "" : value) as UsageDetailsStatusFilter })
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status || "all"} value={status || "all"}>
                  {status
                    ? intl.formatMessage({ id: `settings.usageDetails.status.${status}` })
                    : intl.formatMessage({ id: "settings.usageDetails.filter.allStatuses" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usageDetails.filter.startDate" })}
          </span>
          <Input
            type="datetime-local"
            value={filters.startDate}
            onChange={(event) => updateFilter({ startDate: event.currentTarget.value })}
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.usageDetails.filter.endDate" })}
          </span>
          <Input
            type="datetime-local"
            value={filters.endDate}
            onChange={(event) => updateFilter({ endDate: event.currentTarget.value })}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.usageDetails.totalCount" }, { count: totalItems })}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFilters({ ...EMPTY_USAGE_DETAILS_FILTERS })}
          >
            {intl.formatMessage({ id: "settings.usageDetails.action.clearFilters" })}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => refresh()}>
            <RefreshCcw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
            {intl.formatMessage({ id: "common.refresh" })}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/40 px-4 py-3 text-ui-sm text-destructive">
          {error}
        </div>
      ) : null}

      {rows.length === 0 && !loading ? (
        <UsageEmptyState
          title={intl.formatMessage({ id: "settings.usageDetails.emptyTitle" })}
          description={intl.formatMessage({ id: "settings.usageDetails.emptyDescription" })}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[1080px] text-ui-sm">
            <thead className="bg-surface text-foreground-subtle">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.time" })}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.provider" })}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.model" })}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.account" })}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.proxy" })}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.status" })}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.duration" })}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.ttft" })}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.tokens" })}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {intl.formatMessage({ id: "settings.usageDetails.column.actions" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border/70 hover:bg-surface/60">
                  <td className="whitespace-nowrap px-3 py-2 text-foreground-subtle">
                    {formatTimestamp(locale, row.startedAt)}
                  </td>
                  <td
                    className="max-w-[180px] truncate px-3 py-2 text-foreground"
                    title={row.providerId}
                  >
                    {row.providerId ? providerLabel(row.providerId) : "--"}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-foreground" title={row.modelId}>
                    {row.modelId || "--"}
                  </td>
                  <td
                    className="max-w-[160px] truncate px-3 py-2 text-foreground"
                    title={row.accountDisplayName || row.accountId}
                  >
                    {row.accountDisplayName || row.accountId || "--"}
                  </td>
                  <td
                    className="max-w-[160px] truncate px-3 py-2 text-foreground"
                    title={row.proxyDisplayName || row.proxyPoolId}
                  >
                    {row.proxyDisplayName || row.proxyPoolId || "--"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.status === "error"
                          ? "text-destructive"
                          : row.status === "completed"
                            ? "text-foreground"
                            : "text-foreground-subtle"
                      }
                    >
                      {intl.formatMessage({ id: `settings.usageDetails.status.${row.status}` })}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                    {formatDuration(row.durationMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground-subtle">
                    {formatDuration(row.timeToFirstTokenMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                    {formatTokens(row.computedTotalTokens)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelected(row)}
                    >
                      {intl.formatMessage({ id: "settings.usageDetails.action.detail" })}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
          <span>
            {intl.formatMessage({ id: "settings.usageDetails.pageSize" })}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value))}
          >
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[20, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-ui-sm text-foreground-subtle">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {intl.formatMessage({ id: "settings.usageDetails.action.prevPage" })}
          </Button>
          <span>
            {totalPages === 0
              ? intl.formatMessage({ id: "settings.usageDetails.pageIndicator" }, { page, total: 0 })
              : intl.formatMessage({ id: "settings.usageDetails.pageIndicator" }, { page, total: totalPages })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!pagination?.hasNext}
            onClick={() => setPage(page + 1)}
          >
            {intl.formatMessage({ id: "settings.usageDetails.action.nextPage" })}
          </Button>
        </div>
      </div>

      <UsageRequestDetailsDialog
        detail={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
