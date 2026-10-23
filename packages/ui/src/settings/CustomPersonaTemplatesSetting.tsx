import { useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { CustomPersonaTemplate, ModelJailbreakPrefillMessage } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
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
const MAX_PREFILL_LENGTH = 8192;

function createTemplateId(): string {
  return `custom-${crypto.randomUUID()}`;
}

function clonePrefill(
  messages: readonly ModelJailbreakPrefillMessage[] | undefined,
): ModelJailbreakPrefillMessage[] {
  return (messages ?? []).map((message) => ({ ...message }));
}

export function CustomPersonaTemplatesSetting() {
  const { intl } = useXCodeIntl();
  const { settings, update } = useSettings();
  const templates = settings?.customPersonaTemplates ?? [];
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [prefill, setPrefill] = useState<ModelJailbreakPrefillMessage[]>([]);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setPrompt("");
    setPrefill([]);
    setOpen(true);
  };

  const openEdit = (template: CustomPersonaTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setPrompt(template.cliPrefix);
    setPrefill(clonePrefill(template.prefill?.messages));
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

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const messages = prefill
      .map((message) => ({ role: message.role, content: message.content.trim() }))
      .filter((message) => message.content.length > 0);
    const entry: CustomPersonaTemplate = {
      id: editingId ?? createTemplateId(),
      name: trimmedName.slice(0, MAX_NAME_LENGTH),
      cliPrefix: prompt.slice(0, MAX_PROMPT_LENGTH),
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

  const setRow = (index: number, patch: Partial<ModelJailbreakPrefillMessage>) => {
    setPrefill((prev) => prev.map((message, i) => (i === index ? { ...message, ...patch } : message)));
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
      {templates.length === 0 ? (
        <div className="px-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.empty" })}
        </div>
      ) : (
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
      <Dialog open={open} onOpenChange={(next) => (saving ? undefined : setOpen(next))}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({
                id: editingId
                  ? "settings.modelJailbreak.customTemplates.editTitle"
                  : "settings.modelJailbreak.customTemplates.createTitle",
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            <label className="flex flex-col gap-1.5 text-ui-sm">
              <span className="text-foreground-subtle">
                {intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.name" })}
              </span>
              <Input
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder={intl.formatMessage({
                  id: "settings.modelJailbreak.customTemplates.namePlaceholder",
                })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-ui-sm">
              <span className="text-foreground-subtle">
                {intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.prompt" })}
              </span>
              <Textarea
                value={prompt}
                rows={6}
                maxLength={MAX_PROMPT_LENGTH}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                className="max-h-[35vh] min-h-32 overflow-y-auto font-mono text-ui-sm"
              />
            </label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.prefill" })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrefill((prev) => [...prev, { role: "user", content: "" }])}
                >
                  <PlusIcon className="size-3.5" />
                  {intl.formatMessage({ id: "settings.modelJailbreak.prefill.add" })}
                </Button>
              </div>
              {prefill.map((message, index) => (
                <div key={index} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Select
                      value={message.role}
                      onValueChange={(role) =>
                        setRow(index, {
                          role: role as ModelJailbreakPrefillMessage["role"],
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">user</SelectItem>
                        <SelectItem value="assistant">assistant</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setPrefill((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    value={message.content}
                    rows={2}
                    maxLength={MAX_PREFILL_LENGTH}
                    onChange={(event) => setRow(index, { content: event.currentTarget.value })}
                    className="font-mono text-ui-sm"
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="button" disabled={saving || name.trim().length === 0} onClick={() => void save()}>
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroupCard>
  );
}
