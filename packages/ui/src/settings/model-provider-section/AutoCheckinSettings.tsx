import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";

/** 半点粒度的签到时间选项（与 host 侧调度器的 tick 间隔匹配）。 */
export const AUTO_CHECKIN_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = `${Math.floor(index / 2)}`.padStart(2, "0");
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
});

export interface AutoCheckinRow {
  accountId: string;
  accountName: string;
  enabled: boolean;
  time: string;
}

/**
 * 每账号自动签到设置面板。
 *
 * CodeBuddy 与 Qoder 的语义完全一致（每账号独立开关 + HH:MM，host 侧按 tick
 * 扫描补跑），差别只在文案前缀，所以抽成一个组件、由调用方传入 i18n key 前缀。
 *
 * 用 `<details>` 折叠：这块是低频配置，默认不该占掉账号列表的视觉重心。
 */
export function AutoCheckinSettings({
  intlKeyPrefix,
  rows,
  savingAccountId,
  onToggle,
  onChangeTime,
}: {
  /** 例如 "settings.codebuddy" / "settings.qoder"，配套 key 为 `${prefix}.autoCheckinTitle` 等。 */
  intlKeyPrefix: string;
  rows: readonly AutoCheckinRow[];
  savingAccountId: string | null;
  onToggle: (accountId: string, enabled: boolean) => void;
  onChangeTime: (accountId: string, time: string) => void;
}) {
  const { intl } = useXCodeIntl();
  if (rows.length === 0) return null;

  return (
    <details className="text-ui-sm text-foreground-subtle">
      <summary className="cursor-pointer select-none">
        {intl.formatMessage({ id: `${intlKeyPrefix}.autoCheckinTitle` })}
      </summary>
      <p className="mt-2">{intl.formatMessage({ id: `${intlKeyPrefix}.autoCheckinHint` })}</p>
      <div className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.accountId}
            className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-foreground">{row.accountName}</span>
            <Switch
              checked={row.enabled}
              disabled={savingAccountId !== null}
              onCheckedChange={(next) => onToggle(row.accountId, next)}
              aria-label={intl.formatMessage(
                { id: `${intlKeyPrefix}.autoCheckinToggle` },
                { name: row.accountName },
              )}
            />
            <Select
              value={row.time}
              disabled={!row.enabled || savingAccountId !== null}
              onValueChange={(next) => onChangeTime(row.accountId, next)}
            >
              <SelectTrigger size="sm" className="w-24 justify-between">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {AUTO_CHECKIN_TIME_OPTIONS.map((time) => (
                  <SelectItem key={time} value={time}>
                    {time}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </details>
  );
}
