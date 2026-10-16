import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";

type Intl = ReturnType<typeof import("@/i18n/IntlProvider.js").useXCodeIntl>["intl"];

export interface PoolDraft {
  id?: string;
  name: string;
  proxyUrl: string;
  noProxy: string;
  isActive: boolean;
}

interface Props {
  draft: PoolDraft;
  saving: boolean;
  onChange: (next: PoolDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  intl: Intl;
}

/** 代理条目编辑弹窗：名称 + 地址 + 绕过 + 启用开关。 */
export function PoolEditor({ draft, saving, onChange, onCancel, onSave, intl }: Props) {
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({
              id: draft.id ? "settings.proxyPool.editPool" : "settings.proxyPool.addPool",
            })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.proxyPool.proxyUrlPlaceholder" })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-foreground-subtle">
              {intl.formatMessage({ id: "settings.proxyPool.name" })}
            </label>
            <Input
              value={draft.name}
              autoFocus
              placeholder={intl.formatMessage({ id: "settings.proxyPool.namePlaceholder" })}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-foreground-subtle">
              {intl.formatMessage({ id: "settings.proxyPool.proxyUrl" })}
            </label>
            <Input
              value={draft.proxyUrl}
              placeholder={intl.formatMessage({ id: "settings.proxyPool.proxyUrlPlaceholder" })}
              onChange={(e) => onChange({ ...draft, proxyUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-foreground-subtle">
              {intl.formatMessage({ id: "settings.proxyPool.noProxy" })}
            </label>
            <Input
              value={draft.noProxy}
              placeholder={intl.formatMessage({ id: "settings.proxyPool.noProxyPlaceholder" })}
              onChange={(e) => onChange({ ...draft, noProxy: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-foreground-subtle">
            <Switch
              checked={draft.isActive}
              onCheckedChange={(checked) => onChange({ ...draft, isActive: checked })}
            />
            {intl.formatMessage({ id: "settings.proxyPool.enabled" })}
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            {intl.formatMessage({ id: "settings.proxyPool.cancel" })}
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            {intl.formatMessage({ id: "settings.proxyPool.save" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
