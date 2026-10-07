import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { GODMODE_TEMPLATES } from "@/settings/godmodeTemplates.js";

/**
 * GODMODE CLASSIC 系统提示词模板预设（下拉选择）。
 *
 * 从下拉框选一套模板，点击「套用」即把整段 system 提示词写入
 * `customSystemMessages.cliPrefix`（复用「Agent 提示词」卡片，整段替换第 1 条 system 消息）。
 */
export function GodmodeTemplatePresets() {
  const { intl } = useXCodeIntl();
  const { settings, update } = useSettings();
  const [selectedId, setSelectedId] = useState<string>(GODMODE_TEMPLATES[0]?.id ?? "");

  const selected = GODMODE_TEMPLATES.find((t) => t.id === selectedId);

  const applyTemplate = async () => {
    if (!selected) return;
    await update({
      customSystemMessages: { ...settings?.customSystemMessages, cliPrefix: selected.prompt },
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
