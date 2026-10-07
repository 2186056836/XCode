import type { ModelJailbreakObfuscationTier } from "@zcode/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

/**
 * godmode Parseltongue 输入混淆。
 *
 * 四档选择器（关闭 / 轻度 / 标准 / 重度），与输入框「高级」段读写同一份
 * `customSystemMessages.obfuscation`，保持两处联动。开启后按所选档位改写发给
 * 模型的 user 文本（UI/历史原文不变）。
 */
export function JailbreakObfuscationSetting() {
  const { intl } = useXCodeIntl();
  const { settings, update } = useSettings();
  const obfuscation = settings?.customSystemMessages?.obfuscation ?? {};
  const enabled = obfuscation.enabled === true;
  const tier = obfuscation.tier ?? "light";
  const currentValue = enabled ? tier : "off";

  const saveObfuscation = (patch: Partial<NonNullable<typeof obfuscation>>) => {
    void update({
      customSystemMessages: {
        ...settings?.customSystemMessages,
        obfuscation: { enabled: false, tier: "light", ...obfuscation, ...patch },
      },
    });
  };

  const values: Array<{ value: string; label: string }> = [
    { value: "off", label: intl.formatMessage({ id: "settings.modelJailbreak.obfuscation.value.off" }) },
    { value: "light", label: intl.formatMessage({ id: "settings.modelJailbreak.obfuscation.value.light" }) },
    { value: "standard", label: intl.formatMessage({ id: "settings.modelJailbreak.obfuscation.value.standard" }) },
    { value: "heavy", label: intl.formatMessage({ id: "settings.modelJailbreak.obfuscation.value.heavy" }) },
  ];

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.modelJailbreak.obfuscation" })}
        description={intl.formatMessage({ id: "settings.modelJailbreak.obfuscation.description" })}
        control={
          <Select
            value={currentValue}
            onValueChange={(value) => {
              if (value === "off") {
                saveObfuscation({ enabled: false });
                return;
              }
              saveObfuscation({ enabled: true, tier: value as ModelJailbreakObfuscationTier });
            }}
          >
            <SelectTrigger size="lg" className="w-full min-w-0 sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {values.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroupCard>
  );
}
