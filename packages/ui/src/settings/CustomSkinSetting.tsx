/* oxlint-disable eslint(max-lines) -- 皮肤设置卡片只承载设置行 + 工坊入口 + 恢复默认；
   编辑器本体在 SkinStudio.tsx，预设/主题库在 skin-library.ts。 */
import { useCallback, useEffect, useState } from "react";
import { PaletteIcon, WandIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { applyCustomSkin } from "@/useTheme.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import type { CustomSkinSettings } from "@zcode/shared";
import { SkinStudio } from "@/settings/SkinStudio.js";
import { SKIN_PRESETS } from "@/settings/skin-library.js";
import { toast } from "@/components/ui/toast.js";

/**
 * 原生换肤卡片（外观设置区）。
 *
 * 皮肤 = 底座主题（zai-dark/zai-light）+ 语义 token 覆盖 + 可选背景图，外加
 * Skin Studio 的构图/表面/Safe CSS 参数。编辑统一走皮肤工坊（WandIcon 入口）——
 * 这里曾经还有一个「自定义」弹窗做同一件事，两套编辑器各自存一份字段映射，
 * 已下线；本卡片只保留设置行、恢复默认与工坊入口。
 */

export function CustomSkinSetting() {
  const { intl } = useXCodeIntl();
  const { settings, update } = useSettings();
  const savedSkin = settings?.customSkin ?? null;
  const [studioOpen, setStudioOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 皮肤配置变化（保存成功/其他窗口同步）时立即应用到当前窗口。
  useEffect(() => {
    applyCustomSkin(savedSkin);
  }, [savedSkin]);

  /** 写入 AppSettings.customSkin 并应用；清空必须传 null（RPC/JSON 会吞 undefined）。 */
  const persist = async (next: CustomSkinSettings | null): Promise<boolean> => {
    setSaving(true);
    try {
      await update({ customSkin: next });
      applyCustomSkin(next);
      return true;
    } catch (error) {
      logger.warn("[settings] 保存皮肤失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.skin.saveError" }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 恢复默认：按钮在设置行上（工坊之外），没有"保存"兜底，必须立即落盘并回到官方主题。
  const handleReset = useCallback(async () => {
    if (await persist(null)) setStudioOpen(false);
  }, [persist]);

  // 当前皮肤若与某套内置预设完全一致（且无背景图），在副标题标注是哪一套。
  const activePresetId = SKIN_PRESETS.find(
    (preset) =>
      savedSkin != null &&
      preset.skin.base === savedSkin.base &&
      JSON.stringify(preset.skin.overrides) === JSON.stringify(savedSkin.overrides) &&
      !savedSkin.backgroundImage,
  )?.id;

  return (
    <>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.skin.title" })}
        description={intl.formatMessage({ id: "settings.skin.description" })}
        control={
          <div className="flex items-center gap-2">
            {savedSkin ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={saving}
                onClick={() => void handleReset()}
              >
                {intl.formatMessage({ id: "settings.skin.reset" })}
              </Button>
            ) : null}
            <Button type="button" size="lg" onClick={() => setStudioOpen(true)}>
              <WandIcon data-icon="inline-start" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.skin.openStudio" })}
            </Button>
          </div>
        }
        detail={
          activePresetId ? (
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({
                id: SKIN_PRESETS.find((p) => p.id === activePresetId)?.labelId ?? "",
              })}
            </span>
          ) : savedSkin ? (
            <span className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.skin.customActive" })}
            </span>
          ) : null
        }
      />

      <SkinStudio
        open={studioOpen}
        onOpenChange={setStudioOpen}
        initialSkin={savedSkin}
        onSave={async (next) => {
          await persist(next);
        }}
      />
    </>
  );
}
