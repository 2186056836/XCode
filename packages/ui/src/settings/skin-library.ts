import type { CustomSkinSettings } from "@zcode/shared";

/**
 * 皮肤主题库（localStorage）。
 *
 * 存放两类东西：内置预设（SKIN_PRESETS，随代码发布）与用户导入的 DreamSkin
 * 主题包（导入时按主题名去重）。Skin Studio 的主题库区是唯一消费方——
 * 旧的「自定义皮肤」弹窗已下线，预设与导入统一走工坊，避免两套编辑器各存一份。
 */

const SKIN_LIBRARY_STORAGE_KEY = "xcode-skin-library";

export type SkinLibrary = Record<string, CustomSkinSettings>;

export function readSkinLibrary(): SkinLibrary {
  try {
    const raw = localStorage.getItem(SKIN_LIBRARY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SkinLibrary;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSkinLibrary(library: SkinLibrary): void {
  localStorage.setItem(SKIN_LIBRARY_STORAGE_KEY, JSON.stringify(library));
}

/** 内置预设：token 覆盖值即 styles.css 里的合法 CSS 颜色。 */
export const SKIN_PRESETS: { id: string; labelId: string; skin: CustomSkinSettings }[] = [
  {
    id: "midnight-blue",
    labelId: "settings.skin.preset.midnightBlue",
    skin: {
      base: "zai-dark",
      overrides: {
        background: "#0f172a",
        backgroundWinAlt: "#1e293b",
        surface: "rgba(148, 163, 184, 0.08)",
        card: "#1e293b",
        panel: "#1e293b",
        sidebar: "#0f172a",
        popover: "#1e293b",
        input: "#1e293b",
        accent: "#1d4ed8",
      },
    },
  },
  {
    id: "forest-green",
    labelId: "settings.skin.preset.forestGreen",
    skin: {
      base: "zai-dark",
      overrides: {
        background: "#0f1a14",
        backgroundWinAlt: "#1a2e23",
        surface: "rgba(134, 239, 172, 0.06)",
        card: "#1a2e23",
        panel: "#1a2e23",
        sidebar: "#0f1a14",
        popover: "#1a2e23",
        input: "#1a2e23",
        accent: "#15803d",
      },
    },
  },
  {
    id: "sakura",
    labelId: "settings.skin.preset.sakura",
    skin: {
      base: "zai-light",
      overrides: {
        background: "#fdf6f7",
        backgroundWinAlt: "#f5e8ea",
        surface: "rgba(190, 24, 93, 0.05)",
        card: "#f5e8ea",
        panel: "#f5e8ea",
        sidebar: "#fdf6f7",
        popover: "#f5e8ea",
        input: "#f5e8ea",
        accent: "#f9a8d4",
      },
    },
  },
  {
    id: "sepia",
    labelId: "settings.skin.preset.sepia",
    skin: {
      base: "zai-light",
      overrides: {
        background: "#f7f1e5",
        backgroundWinAlt: "#ede4d1",
        surface: "rgba(120, 86, 30, 0.06)",
        card: "#ede4d1",
        panel: "#ede4d1",
        sidebar: "#f7f1e5",
        popover: "#ede4d1",
        input: "#ede4d1",
        accent: "#d6b88a",
      },
    },
  },
];

/**
 * 主题名去重：同名追加序号。唯一例外——旧条目缺背景图而新条目带图时视为同一主题的
 * 修复版直接覆盖，避免历史坏数据堆积出 "Name 2"。
 */
export function resolveLibraryEntryName(
  library: SkinLibrary,
  themeName: string,
  hasBackgroundImage: boolean,
): string {
  const existing = library[themeName];
  const supersedes =
    existing !== undefined && hasBackgroundImage && !existing.backgroundImage;
  if (supersedes) return themeName;
  let name = themeName;
  for (let i = 2; library[name] !== undefined; i += 1) name = `${themeName} ${i}`;
  return name;
}
