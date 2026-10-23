import type { XCodeUsageRequestDetailsResult } from "@zcode/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";

type DetailRow = XCodeUsageRequestDetailsResult["details"][number];

function formatTimestamp(locale: string, value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
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
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "--" : new Intl.NumberFormat().format(value);
}

/**
 * 「使用详情」单条明细弹窗。
 *
 * 只展示元数据（provider / 模型 / 账号 / 出口代理 / 耗时 / tokens / 错误），
 * 不含请求与响应正文——设置页可见性不应等于会话内容可见性。
 */
export function UsageRequestDetailsDialog({
  detail,
  onOpenChange,
  open,
}: {
  detail: DetailRow | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { intl, locale } = useXCodeIntl();
  const providerSettings = useProviderSettingsView();
  if (!detail) return null;

  const fields: Array<{ label: string; value: string }> = [
    { label: intl.formatMessage({ id: "settings.usageDetails.field.time" }), value: formatTimestamp(locale, detail.startedAt) },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.provider" }),
      value: detail.providerId
        ? (providerSettings.state.status === "ready"
            ? (providerSettings.state.view.providers.find((p) => p.providerId === detail.providerId)
                ?.providerName ?? detail.providerId)
            : detail.providerId)
        : "--",
    },
    { label: intl.formatMessage({ id: "settings.usageDetails.field.model" }), value: detail.modelId || "--" },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.account" }),
      value: detail.accountDisplayName || detail.accountId || intl.formatMessage({ id: "settings.usageDetails.value.none" }),
    },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.proxy" }),
      value: detail.proxyDisplayName || detail.proxyPoolId || intl.formatMessage({ id: "settings.usageDetails.value.followGlobal" }),
    },
    { label: intl.formatMessage({ id: "settings.usageDetails.field.status" }), value: detail.status },
    { label: intl.formatMessage({ id: "settings.usageDetails.field.duration" }), value: formatDuration(detail.durationMs) },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.ttft" }),
      value: formatDuration(detail.timeToFirstTokenMs),
    },
    { label: intl.formatMessage({ id: "settings.usageDetails.field.inputTokens" }), value: formatCount(detail.inputTokens) },
    { label: intl.formatMessage({ id: "settings.usageDetails.field.outputTokens" }), value: formatCount(detail.outputTokens) },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.reasoningTokens" }),
      value: formatCount(detail.reasoningTokens),
    },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.cacheRead" }),
      value: formatCount(detail.cacheReadInputTokens),
    },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.cacheCreate" }),
      value: formatCount(detail.cacheCreationInputTokens),
    },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.totalTokens" }),
      value: formatCount(detail.computedTotalTokens),
    },
    {
      label: intl.formatMessage({ id: "settings.usageDetails.field.toolCalls" }),
      value: formatCount(detail.toolCallCount),
    },
  ];

  const errorFields =
    detail.errorType || detail.errorCode || detail.errorMessage
      ? [
          { label: intl.formatMessage({ id: "settings.usageDetails.field.errorType" }), value: detail.errorType ?? "--" },
          { label: intl.formatMessage({ id: "settings.usageDetails.field.errorCode" }), value: detail.errorCode ?? "--" },
          { label: intl.formatMessage({ id: "settings.usageDetails.field.errorMessage" }), value: detail.errorMessage ?? "--" },
        ]
      : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "settings.usageDetails.detailTitle" })}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label} className="flex min-w-0 items-baseline gap-2 border-b border-border/60 py-1.5">
              <span className="shrink-0 text-ui-sm text-foreground-subtle">{field.label}</span>
              <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground" title={field.value}>
                {field.value}
              </span>
            </div>
          ))}
          {errorFields.map((field) => (
            <div key={field.label} className="flex min-w-0 items-baseline gap-2 border-b border-border/60 py-1.5">
              <span className="shrink-0 text-ui-sm text-foreground-subtle">{field.label}</span>
              <span className="min-w-0 flex-1 truncate text-ui-sm text-destructive" title={field.value}>
                {field.value}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
