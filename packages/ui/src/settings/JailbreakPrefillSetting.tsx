import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

/**
 * 全局 PreFill（预置对话 / priming turns）。
 *
 * 对齐 Hermes `prefill_messages`：把若干 user/assistant 轮作为 priming 注入
 * 到 system 之后、首个真实 user 之前。这里只保留总开关——内容由「内置身份模板」
 * /「自定义身份模板」成套写入（应用模板时连同提示词一起覆盖 PreFill）。
 */
export function JailbreakPrefillSetting() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const prefill = settings?.customSystemMessages?.prefill ?? {};
  const enabled = prefill.enabled === true;

  const values = [
    { value: "off", label: intl.formatMessage({ id: "settings.modelJailbreak.prefill.value.off" }) },
    { value: "on", label: intl.formatMessage({ id: "settings.modelJailbreak.prefill.value.on" }) },
  ];

  const saveEnabled = (value: string) => {
    void update({
      customSystemMessages: {
        ...settings?.customSystemMessages,
        prefill: { ...prefill, enabled: value === "on" },
      },
    });
  };

  return (
    <SettingsGroupCard>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.modelJailbreak.prefill" })}
        description={intl.formatMessage({ id: "settings.modelJailbreak.prefill.description" })}
        control={
          <Select value={enabled ? "on" : "off"} onValueChange={saveEnabled}>
            <SelectTrigger size="lg" className="w-full min-w-0 sm:w-32">
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
