import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { ModelJailbreakPrefillMessage } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { GODMODE_DEFAULT_PREFILL } from "@/settings/godmodeTemplates.js";

/**
 * godmode Prefill（预置对话 / priming turns）。
 *
 * 对齐 Hermes `prefill_messages`：把若干 user/assistant 轮作为 priming 注入
 * 到 system 之后、首个真实 user 之前。顶部下拉框控制开关（默认关闭），
 * 「编辑」按钮打开对话轮编辑对话框；默认载入 godmode 的 prefill.json 内容。
 */
export function JailbreakPrefillSetting() {
  const { intl } = useXCodeIntl();
  const { settings, update } = useSettings();
  const prefill = settings?.customSystemMessages?.prefill ?? {};
  const enabled = prefill.enabled === true;
  const savedMessages = prefill.messages ?? [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ModelJailbreakPrefillMessage[]>([]);

  const savePrefill = (patch: Partial<NonNullable<typeof prefill>>) => {
    void update({
      customSystemMessages: {
        ...settings?.customSystemMessages,
        prefill: { ...prefill, ...patch },
      },
    });
  };

  const openDialog = () => {
    setDraft(
      savedMessages.length
        ? savedMessages.map((m) => ({ ...m }))
        : GODMODE_DEFAULT_PREFILL.map((m) => ({ ...m })),
    );
    setOpen(true);
  };

  const save = async () => {
    const cleaned = draft
      .map((m) => ({ role: m.role, content: m.content.trim() }))
      .filter((m) => m.content.length > 0);
    try {
      await update({
        customSystemMessages: {
          ...settings?.customSystemMessages,
          prefill: { ...prefill, messages: cleaned },
        },
      });
      setOpen(false);
    } catch (error) {
      toast(intl.formatMessage({ id: "settings.modelJailbreak.prefill.saveError" }));
    }
  };

  const setRow = (index: number, patch: Partial<ModelJailbreakPrefillMessage>) => {
    setDraft((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const removeRow = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const values = [
    { value: "off", label: intl.formatMessage({ id: "settings.modelJailbreak.prefill.value.off" }) },
    { value: "on", label: intl.formatMessage({ id: "settings.modelJailbreak.prefill.value.on" }) },
  ];

  return (
    <SettingsGroupCard>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.modelJailbreak.prefill" })}
        description={intl.formatMessage({ id: "settings.modelJailbreak.prefill.description" })}
        control={
          <div className="flex items-center gap-2">
            <Select
              value={enabled ? "on" : "off"}
              onValueChange={(value) => savePrefill({ enabled: value === "on" })}
            >
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
            <Button type="button" size="lg" onClick={openDialog}>
              {intl.formatMessage({ id: "settings.modelJailbreak.prefill.edit" })}
            </Button>
          </div>
        }
      />
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : setOpen(false))}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "settings.modelJailbreak.prefill" })}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
            {draft.map((message, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Select
                    value={message.role}
                    onValueChange={(role) => setRow(index, { role: role as ModelJailbreakPrefillMessage["role"] })}
                  >
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">user</SelectItem>
                      <SelectItem value="assistant">assistant</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(index)}>
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={message.content}
                  rows={2}
                  maxLength={8192}
                  onChange={(event) => setRow(index, { content: event.currentTarget.value })}
                  className="font-mono text-ui-sm"
                />
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            className="mt-2 w-fit"
            onClick={() =>
              setDraft((prev) => [...prev, { role: "user", content: "" }])
            }
          >
            <PlusIcon className="size-3.5" />
            {intl.formatMessage({ id: "settings.modelJailbreak.prefill.add" })}
          </Button>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="button" onClick={() => void save()}>
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroupCard>
  );
}
