import { useEffect, useRef, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { PERSONA_TEMPLATE_NAME_PLACEHOLDER, type ModelJailbreakPrefillMessage } from "@zcode/shared";
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
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * 身份模板编辑器（提示词 + PreFill 轮次）。
 *
 * 两处共用：自定义模板的新建/编辑，以及内置模板右侧的「编辑」（就地改一版再写回
 * 全局）。内置模板是代码常量，不能原地改，所以两处都只是同一张表单。
 */

export interface PersonaTemplateEditorDraft {
  name: string;
  /**
   * 助手名字：应用模板时替换提示词与 PreFill 里的 `{{name}}` 占位。
   * 模板原文仍保留占位符，换名字不用重写提示词。
   */
  assistantName: string;
  cliPrefix: string;
  prefill: ModelJailbreakPrefillMessage[];
}

const MAX_NAME_LENGTH = 100;
const MAX_PROMPT_LENGTH = 65535;
const MAX_PREFILL_LENGTH = 8192;

export function clonePrefillMessages(
  messages: readonly ModelJailbreakPrefillMessage[] | undefined,
): ModelJailbreakPrefillMessage[] {
  return (messages ?? []).map((message) => ({ ...message }));
}

export function PersonaTemplateEditorDialog(props: {
  open: boolean;
  title: string;
  initial: PersonaTemplateEditorDraft;
  /** 内置模板就地编辑时没有「模板名称」。 */
  showName?: boolean;
  saving?: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(draft: PersonaTemplateEditorDraft): void;
}) {
  const { open, title, initial, showName = true, saving = false, onOpenChange, onSubmit } = props;
  const { intl } = useZCodeIntl();
  const [name, setName] = useState(initial.name);
  const [assistantName, setAssistantName] = useState(initial.assistantName);
  const [prompt, setPrompt] = useState(initial.cliPrefix);
  const [prefill, setPrefill] = useState<ModelJailbreakPrefillMessage[]>(() =>
    clonePrefillMessages(initial.prefill),
  );
  // 每次打开都按调用方当时的内容重置：对话框常驻挂载，不能只在首次渲染取初值。
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => {
    if (!open) return;
    setName(initialRef.current.name);
    setAssistantName(initialRef.current.assistantName);
    setPrompt(initialRef.current.cliPrefix);
    setPrefill(clonePrefillMessages(initialRef.current.prefill));
  }, [open]);

  const setRow = (index: number, patch: Partial<ModelJailbreakPrefillMessage>) => {
    setPrefill((prev) => prev.map((message, i) => (i === index ? { ...message, ...patch } : message)));
  };

  /** 回到打开时的内容：内置模板就是模板原文，自定义模板就是已保存的版本。 */
  const restoreDefault = () => {
    setName(initialRef.current.name);
    setAssistantName(initialRef.current.assistantName);
    setPrompt(initialRef.current.cliPrefix);
    setPrefill(clonePrefillMessages(initialRef.current.prefill));
  };

  const submit = () => {
    onSubmit({ name, assistantName, cliPrefix: prompt, prefill });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          {showName ? (
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
          ) : null}
          <label className="flex flex-col gap-1.5 text-ui-sm">
            <span className="text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelJailbreak.customTemplates.assistantName" })}
            </span>
            <Input
              value={assistantName}
              maxLength={MAX_NAME_LENGTH}
              onChange={(event) => setAssistantName(event.currentTarget.value)}
              placeholder={intl.formatMessage({
                id: "settings.modelJailbreak.customTemplates.assistantNamePlaceholder",
              })}
            />
            <span className="text-ui-xs text-foreground-subtle">
              {intl.formatMessage(
                { id: "settings.modelJailbreak.customTemplates.assistantNameHint" },
                { placeholder: PERSONA_TEMPLATE_NAME_PLACEHOLDER },
              )}
            </span>
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
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" disabled={saving} onClick={restoreDefault}>
            {intl.formatMessage({ id: "settings.customSystemMessages.restoreDefault" })}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              disabled={saving || (showName && name.trim().length === 0)}
              onClick={submit}
            >
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
