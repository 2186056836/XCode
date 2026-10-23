import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { GODMODE_TEMPLATES, PREFILL_TEMPLATES } from "@/settings/godmodeTemplates.js";

/**
 * 内置身份模板（提示词 + PreFill 成套预设）。
 *
 * 内置模板的 system 提示词与 PreFill 按同一 id 绑定：点一次「使用」同时写入
 * `customSystemMessages.cliPrefix` 与 `customSystemMessages.prefill`，避免两套
 * 下拉框各选一次、还可能选到不配套的组合。
 */
export function GodmodeTemplatePresets() {
  const { intl } = useXCodeIntl();
  const { settings, update } = useSettings();
  const [selectedId, setSelectedId] = useState<string>(GODMODE_TEMPLATES[0]?.id ?? "");

  const selected = GODMODE_TEMPLATES.find((t) => t.id === selectedId);

  const applyTemplate = async () => {
    if (!selected) return;
    const prefill = PREFILL_TEMPLATES.find((template) => template.id === selected.id);
    await update({
      customSystemMessages: {
        ...settings?.customSystemMessages,
        cliPrefix: selected.prompt,
        ...(prefill
          ? {
              prefill: {
                enabled: true,
                messages: prefill.messages.map((message) => ({ ...message })),
              },
            }
          : {}),
      },
    });
    toast(intl.formatMessage({ id: "settings.modelJailbreak.templateApplied" }));
  };

  return (
    <SettingsGroupCard>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.modelJailbreak.templates" })}
        description={intl.formatMessage({ id: "settings.modelJailbreak.templates.description" })}
        control={<div className="flex w-full items-center gap-2 sm:w-auto">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger size="lg" className="w-full min-w-0 sm:w-72">
              <SelectValue placeholder={intl.formatMessage({ id: "settings.modelJailbreak.templates" })} />
            </SelectTrigger>
            <SelectContent>
              {GODMODE_TEMPLATES.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="lg" disabled={!selected} onClick={() => void applyTemplate()}>
            {intl.formatMessage({ id: "settings.modelJailbreak.templates.apply" })}
          </Button>
        </div>}
      />
    </SettingsGroupCard>
  );
}
