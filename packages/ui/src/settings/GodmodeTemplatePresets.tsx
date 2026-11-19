import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  clonePrefillMessages,
  PersonaTemplateEditorDialog,
  type PersonaTemplateEditorDraft,
} from "@/settings/PersonaTemplateEditorDialog.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { GODMODE_TEMPLATES, PREFILL_TEMPLATES } from "@/settings/godmodeTemplates.js";

/**
 * 内置身份模板（提示词 + PreFill 成套预设）。
 *
 * 内置模板的 system 提示词与 PreFill 按同一 id 绑定：点一次「使用」同时写入
 * `customSystemMessages.cliPrefix` 与 `customSystemMessages.prefill`，避免两套
 * 下拉框各选一次、还可能选到不配套的组合。
 *
 * 「编辑」把选中的内置模板按当前内容摊到表单里，改完保存同样写回全局；内置模板
 * 本身是代码常量，这里改的是写进 setting.json 的那一份。
 */
export function GodmodeTemplatePresets() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const [selectedId, setSelectedId] = useState<string>(GODMODE_TEMPLATES[0]?.id ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorInitial, setEditorInitial] = useState<PersonaTemplateEditorDraft>({
    name: "",
    cliPrefix: "",
    prefill: [],
  });

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

  const openEditor = () => {
    if (!selected) return;
    const prefill = PREFILL_TEMPLATES.find((template) => template.id === selected.id);
    setEditorInitial({
      name: selected.name,
      cliPrefix: selected.prompt,
      prefill: clonePrefillMessages(prefill?.messages),
    });
    setEditorOpen(true);
  };

  const saveEdited = async (draft: PersonaTemplateEditorDraft) => {
    const messages = draft.prefill
      .map((message) => ({ role: message.role, content: message.content.trim() }))
      .filter((message) => message.content.length > 0);
    setSaving(true);
    try {
      await update({
        customSystemMessages: {
          // 与「使用」同构：只换提示词与 PreFill，混淆等其它字段保持当前值。
          ...settings?.customSystemMessages,
          cliPrefix: draft.cliPrefix,
          prefill: { enabled: true, messages },
        },
      });
      toast(intl.formatMessage({ id: "settings.modelJailbreak.templates.edited" }));
      setEditorOpen(false);
    } catch (error) {
      logger.warn("[settings] 保存内置身份模板修改失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.saveError" }));
    } finally {
      setSaving(false);
    }
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
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={!selected}
            onClick={openEditor}
          >
            <PencilIcon className="size-3.5" />
            {intl.formatMessage({ id: "settings.modelJailbreak.templates.edit" })}
          </Button>
          <Button type="button" size="lg" disabled={!selected} onClick={() => void applyTemplate()}>
            {intl.formatMessage({ id: "settings.modelJailbreak.templates.apply" })}
          </Button>
        </div>}
      />
      <PersonaTemplateEditorDialog
        open={editorOpen}
        title={intl.formatMessage({ id: "settings.modelJailbreak.templates.editTitle" })}
        initial={editorInitial}
        showName={false}
        saving={saving}
        onOpenChange={(next) => setEditorOpen(next)}
        onSubmit={(draft) => void saveEdited(draft)}
      />
    </SettingsGroupCard>
  );
}
