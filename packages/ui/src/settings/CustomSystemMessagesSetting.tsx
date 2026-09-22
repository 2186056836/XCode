import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Textarea } from "@/components/ui/textarea.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

/**
 * XCode fork：Agent 提示词卡片（更改 XCode 身份设定）。
 *
 * 卡片只有一个「编辑」按钮，点击弹窗编辑身份提示词；弹窗初始值 = 已保存的自定义内容，
 * 从未改动过时显示内置默认身份行。保存时内容为空或等于默认行则清空自定义配置
 * （回落内置），否则整段替换发给模型的第 1 条 system 消息。
 * 链路：setting.json → session/requestRuntimePreferences → ContextBuilder。
 */

const MAX_LENGTH = 8192;

/**
 * 内置默认身份行。与 apps/zcode-cli/packages/core/src/context/sections/cli-prefix.ts
 * 的 CLI_PREFIX_PROMPT 逐字同步——改动 core 身份行时必须同步这里。
 */
const DEFAULT_IDENTITY_PROMPT = "You are XCode, an interactive coding agent";

export function CustomSystemMessagesSetting() {
  const { intl } = useXCodeIntl();
  const { settings, update } = useSettings();
  const savedValue = settings?.customSystemMessages?.cliPrefix ?? "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_IDENTITY_PROMPT);
  const [saving, setSaving] = useState(false);

  const openDialog = () => {
    // 没有改动过时编辑框显示默认提示词。
    setDraft(savedValue || DEFAULT_IDENTITY_PROMPT);
    setOpen(true);
  };

  const persist = async (next: { cliPrefix?: string }): Promise<boolean> => {
    setSaving(true);
    try {
      await update({ customSystemMessages: next });
      return true;
    } catch (error) {
      logger.warn("[settings] 保存 Agent 提示词失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.customSystemMessages.saveError" }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    const next = !trimmed || trimmed === DEFAULT_IDENTITY_PROMPT ? {} : { cliPrefix: trimmed };
    if (await persist(next)) setOpen(false);
  };

  const handleRestoreDefault = async () => {
    if (await persist({})) {
      setDraft(DEFAULT_IDENTITY_PROMPT);
    }
  };

  return (
    <SettingsGroupCard>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.customSystemMessages.title" })}
        description={intl.formatMessage({ id: "settings.customSystemMessages.description" })}
        control={
          <Button type="button" size="lg" onClick={openDialog}>
            {intl.formatMessage({ id: "settings.customSystemMessages.edit" })}
          </Button>
        }
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.customSystemMessages.title" })}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={draft}
            rows={6}
            maxLength={MAX_LENGTH}
            onChange={(event) => setDraft(event.currentTarget.value)}
            className="font-mono text-ui-sm"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => void handleRestoreDefault()}
            >
              {intl.formatMessage({ id: "settings.customSystemMessages.restoreDefault" })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="button" disabled={saving} onClick={() => void handleSave()}>
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroupCard>
  );
}
