import type {
  XCodeConfigOption,
  XCodeMessageWithParts,
  ModelSelection,
  XCodeSessionMode,
  XCodeSessionSettingsState,
  XCodeSessionStateSnapshot,
  XCodeTaskModeInfo,
} from "@zcode/shared";
import {
  formatModelPickerValue as formatSharedModelSelection,
  getXCodeAgentAvailableModes as getSharedXCodeAgentAvailableModes,
  normalizeAvailableXCodeMode as normalizeSharedAvailableXCodeMode,
  zcodeSessionSettingsToXCodeConfigOptions,
} from "@zcode/shared";

export const MODEL_CONFIG_ID = "model";
export const MODE_CONFIG_ID = "mode";
export const THOUGHT_LEVEL_CONFIG_ID = "thought_level";

export function formatModelPickerValue(ref: ModelSelection | undefined): string {
  return formatSharedModelSelection(ref);
}

function resolveLatestMessageModelSelection(
  messages: readonly XCodeMessageWithParts[],
): ModelSelection | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const model = messages[index]?.info.model;
    if (model) {
      return model;
    }
  }
  return undefined;
}

function resolveTaskMetaModelSelectionFromSnapshot(
  snapshot: Pick<XCodeSessionStateSnapshot, "messages" | "settings">,
): ModelSelection | undefined {
  // 历史 resume 曾经可能用 app 当前默认模型覆盖 settings.current，
  // 但消息 info.model 仍保留真实使用的模型。task meta 是历史恢复 hint，
  // 应优先记录最近消息实际使用的模型，避免错误 snapshot 继续污染 task index。
  return resolveLatestMessageModelSelection(snapshot.messages) ?? snapshot.settings.model.current;
}

export function formatTaskMetaModelSelectionFromSnapshot(
  snapshot: Pick<XCodeSessionStateSnapshot, "messages" | "settings">,
): string {
  return formatModelPickerValue(resolveTaskMetaModelSelectionFromSnapshot(snapshot));
}

export function normalizeAvailableXCodeMode(mode: XCodeSessionMode): string {
  return normalizeSharedAvailableXCodeMode(mode);
}

export function getXCodeAgentAvailableModes(): XCodeTaskModeInfo[] {
  return getSharedXCodeAgentAvailableModes();
}

export function settingsToConfigOptions(settings: XCodeSessionSettingsState): XCodeConfigOption[] {
  // service 侧曾经维护了一份三项 mode 白名单，edit 模式上线后没有同步，
  // 切换模式时 mode_update 会把 UI 菜单覆盖成 build/plan/yolo。这里统一复用 shared 的事实源。
  return zcodeSessionSettingsToXCodeConfigOptions(settings);
}
