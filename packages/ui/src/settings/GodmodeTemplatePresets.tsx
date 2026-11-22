import { resolveBuiltinPersonaTemplate, resolvePersonaTemplateText } from "@zcode/shared";
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
 * 每个内置模板有独立槽位（`builtinPersonaOverrides[id]`）：「编辑」摊开的是该模板
 * 当前生效的内容（槽位优先、代码常量兜底），保存只写回这个槽位；只有正在生效的
 * 就是这个模板时才同步全局配置。内置模板本身是代码常量，槽位是写进 setting.json
 * 的那一份，应用/切换时按「槽位优先」解析。
 */
export function GodmodeTemplatePresets() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const [selectedId, setSelectedId] = useState<string>(GODMODE_TEMPLATES[0]?.id ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorInitial, setEditorInitial] = useState<PersonaTemplateEditorDraft>({
    name: "",
    assistantName: "",
    cliPrefix: "",
    prefill: [],
  });

  const selected = GODMODE_TEMPLATES.find((t) => t.id === selectedId);

  const applyTemplate = async () => {
    if (!selected) return;
    // 槽位优先、代码常量兜底：用户在设置页改过的内置模板应用改动后的版本。
    const resolved = resolveBuiltinPersonaTemplate(selected.id, settings?.builtinPersonaOverrides);
    if (!resolved) return;
    await update({
      customSystemMessages: {
        ...settings?.customSystemMessages,
        cliPrefix: resolved.cliPrefix,
        ...(resolved.prefill ? { prefill: resolved.prefill } : {}),
      },
    });
    toast(intl.formatMessage({ id: "settings.modelJailbreak.templateApplied" }));
  };

  const openEditor = () => {
    if (!selected) return;
    const override = settings?.builtinPersonaOverrides?.[selected.id];
    const prefill = PREFILL_TEMPLATES.find((template) => template.id === selected.id);
    setEditorInitial({
      name: selected.name,
      // 内置模板的默认助手名字（来自 prompt frontmatter）预填到输入框；
      // 提示词原文保留 {{name}}，保存时按这里的值展开。
      assistantName: selected.assistantName ?? "",
      // 该模板已有用户槽位时摊开槽位内容（已是展开后的正文），否则用代码常量。
      cliPrefix: override?.cliPrefix ?? selected.prompt,
      prefill:
        override?.prefill?.messages && override.prefill.messages.length > 0
          ? clonePrefillMessages(override.prefill.messages)
          : clonePrefillMessages(prefill?.messages),
    });
    setEditorOpen(true);
  };

  const saveEdited = async (draft: PersonaTemplateEditorDraft) => {
    // 内置模板直接写全局配置，没有模板对象可保留占位符：在这里把 {{name}}
    // 展开成本次填写的助手名字。自定义模板则保留原文，应用时再展开。
    const assistantName = draft.assistantName.trim();
    const messages = draft.prefill
      .map((message) => ({
        role: message.role,
        content: resolvePersonaTemplateText(message.content.trim(), assistantName),
      }))
      .filter((message) => message.content.length > 0);
    const cliPrefix = resolvePersonaTemplateText(draft.cliPrefix, assistantName);
    // 每个内置模板一个独立槽位：编辑非当前人设只更新它的槽位，不再覆盖全局。
    const nextOverrides = {
      ...(settings?.builtinPersonaOverrides ?? {}),
      [selectedId]: {
        cliPrefix,
        // 模板没有 PreFill（例如「默认XCODE」）时不清空当前槽位里的 PreFill：
        // 用户可能只改了提示词，要停用 PreFill 用上面的「全局 PreFill」开关。
        ...(messages.length > 0 ? { prefill: { enabled: true, messages } } : {}),
      },
    };
    // 只有「正在生效的就是这个模板」时才同步全局配置，让改动立刻生效；
    // 否则只存槽位，等用户以后切换/应用该模板时再读取。
    const resolvedBefore = resolveBuiltinPersonaTemplate(
      selectedId,
      settings?.builtinPersonaOverrides,
    );
    const globalPrefix = settings?.customSystemMessages?.cliPrefix?.trim() ?? "";
    const isActive = Boolean(
      resolvedBefore && globalPrefix && resolvedBefore.cliPrefix.trim() === globalPrefix,
    );
    setSaving(true);
    try {
      await update({
        builtinPersonaOverrides: nextOverrides,
        ...(isActive
          ? {
              customSystemMessages: {
                ...settings?.customSystemMessages,
                cliPrefix,
                ...(messages.length > 0 ? { prefill: { enabled: true, messages } } : {}),
              },
            }
          : {}),
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
