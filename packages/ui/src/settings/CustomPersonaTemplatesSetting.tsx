import { useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import type { CustomPersonaTemplate } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
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

/**
 * 自定义身份模板。
 *
 * 内置模板（GODMODE_TEMPLATES / PREFILL_TEMPLATES）是代码常量，用户改不了；这里允许
 * 新建「提示词 + PreFill」的组合，写进 setting.json 的 `customPersonaTemplates`。
 * 保存后同时出现在：
 * - 设置页「模型越狱」的模板清单（可继续编辑/删除）；
 * - 聊天页模型选择器的「会话身份」子菜单（按会话套用）。
 */

const MAX_TEMPLATES = 50;
const MAX_NAME_LENGTH = 100;
const MAX_PROMPT_LENGTH = 65535;

function createTemplateId(): string {
  return `custom-${crypto.randomUUID()}`;
}

const EMPTY_DRAFT: PersonaTemplateEditorDraft = {
  name: "",
  assistantName: "",
  cliPrefix: "",
  prefill: [],
};

export function CustomPersonaTemplatesSetting() {
  const { intl } = useZCodeIntl();
  const { settings, update } = useSettings();
  const templates = settings?.customPersonaTemplates ?? [];
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initial, setInitial] = useState<PersonaTemplateEditorDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setInitial(EMPTY_DRAFT);
    setOpen(true);
  };

  const openEdit = (template: CustomPersonaTemplate) => {
    setEditingId(template.id);
    setInitial({
      name: template.name,
      assistantName: template.assistantName ?? "",
      cliPrefix: template.cliPrefix,
      prefill: clonePrefillMessages(template.prefill?.messages),
    });
    setOpen(true);
  };

  const persist = async (next: CustomPersonaTemplate[]): Promise<boolean> => {
    setSaving(true);
    try {
      await update({ customPersonaTemplates: next });
      return true;
    } catch (error) {
      logger.warn("[settings] 保存自定义身份模板失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.saveError" }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async (draft: PersonaTemplateEditorDraft) => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) return;
    // 模板原文保留 {{name}}；助手名字单独存，应用模板时再展开（见 shared 的
    // resolvePersonaTemplatePlaceholders）。这样改名不用重写提示词。
    const assistantName = draft.assistantName.trim().slice(0, MAX_NAME_LENGTH);
    const messages = draft.prefill
      .map((message) => ({ role: message.role, content: message.content.trim() }))
      .filter((message) => message.content.length > 0);
    const entry: CustomPersonaTemplate = {
      id: editingId ?? createTemplateId(),
      name: trimmedName.slice(0, MAX_NAME_LENGTH),
      ...(assistantName ? { assistantName } : {}),
      cliPrefix: draft.cliPrefix.slice(0, MAX_PROMPT_LENGTH),
      ...(messages.length > 0 ? { prefill: { enabled: true, messages } } : {}),
    };
    const next = editingId
      ? templates.map((template) => (template.id === editingId ? entry : template))
      : [...templates, entry].slice(0, MAX_TEMPLATES);
    if (await persist(next)) setOpen(false);
  };

  const remove = (id: string) => {
    void persist(templates.filter((template) => template.id !== id));
  };

  return (
    <SettingsGroupCard>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.modelJailbreak.customTemplates" })}
        description={intl.formatMessage({
          id: "settings.modelJailbreak.customTemplates.description",
        })}
        control={
          <Button type="button" size="lg" onClick={openCreate}>
            {intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.create" })}
          </Button>
        }
      />
      {templates.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-ui-base">{template.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => openEdit(template)}
              >
                <PencilIcon className="size-3.5" />
                {intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.edit" })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={saving}
                onClick={() => remove(template.id)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <PersonaTemplateEditorDialog
        open={open}
        title={intl.formatMessage({
          id: editingId
            ? "settings.modelJailbreak.customTemplates.editTitle"
            : "settings.modelJailbreak.customTemplates.createTitle",
        })}
        initial={initial}
        saving={saving}
        onOpenChange={(next) => setOpen(next)}
        onSubmit={(draft) => void save(draft)}
      />
    </SettingsGroupCard>
  );
}
