import {
  DREAM_SKIN_COLOR_TO_OVERRIDE,
  MAX_SKIN_BACKGROUND_IMAGE_CHARS,
  type CustomSkinSettings,
} from "@zcode/shared";
import { findUnsafeCssIssues } from "@/settings/dreamskin-safe-css.js";

/**
 * DreamSkin 主题包导入适配器。
 *
 * DreamSkin（github.com/Fei-Away/Codex-Dream-Skin）主题包 = manifest.json + theme.json +
 * theme.css + background.jpg。映射分两路，缺一不可：
 *
 *   theme.json.colors（10 色）→ customSkin.overrides → 语义 token，喂给 XCode 原生
 *     皮肤引擎（useTheme 的 buildSkinTokenValues），全 UI 自动跟随；
 *   theme.css（Safe CSS）→ customSkin.safeCss，由引擎定义 --ds-theme-* 变量后原样
 *     注入。Codex 的渲染真相在这段 CSS 里：每个面的 alpha、圆角、阴影都由它指定
 *     （miku v2 全部面 5% 不透明度）。早年只映射 theme.json、丢弃 theme.css，面的
 *     浓度就回落到引擎硬编码的 50%/70% 蒙层，背景图被洗白——导入结果和 Codex 里
 *     完全两个样子。
 */

/** DreamSkin theme.json 的可消费子集（多余字段忽略）。 */
interface DreamSkinThemeJson {
  id?: string;
  name?: string;
  appearance?: string;
  image?: string;
  art?: {
    focusX?: number;
    focusY?: number;
    safeArea?: string;
    taskMode?: string;
  };
  colors?: {
    background?: string;
    panel?: string;
    panelAlt?: string;
    accent?: string;
    accentAlt?: string;
    secondary?: string;
    highlight?: string;
    text?: string;
    muted?: string;
    line?: string;
  };
}

/** DreamSkin manifest.json 的可消费子集。 */
interface DreamSkinManifest {
  schemaVersion?: number;
  name?: string;
  version?: string;
  minClientVersion?: string;
  platforms?: string[];
}

export interface DreamSkinImportResult {
  skin: CustomSkinSettings;
  themeName: string;
  backgroundImageDataUrl: string | null;
}

export class DreamSkinImportError extends Error {
  constructor(
    message: string,
    readonly reasonCode:
      | "invalidZip"
      | "missingThemeJson"
      | "missingThemeCss"
      | "unsafeThemeCss"
      | "missingBackground"
      | "unsupportedPlatform"
      | "entryTooLarge"
      | "tooManyEntries",
  ) {
    super(message);
    this.name = "DreamSkinImportError";
  }
}

const MAX_ENTRY_BYTES = 16 * 1024 * 1024; // 单文件 16MB（背景图上限低于此）

function isHexOrRgba(value: string | undefined): value is string {
  return Boolean(
    value && (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\(/.test(value.trim())),
  );
}

/**
 * 解析 DreamSkin 主题包并映射为 XCode customSkin。
 * 输入是 ZIP 的原始字节；仅依赖浏览器/Node 通用的解压由调用方完成
 * （renderer 侧经 platform 读取文件，这里消费已解出的文件表）。
 */
export function convertDreamSkinTheme(files: {
  themeJson: string;
  themeCssPresent: boolean;
  themeCss?: string;
  backgroundImage?: { dataUrl: string; bytes: number };
  manifest?: string;
}): DreamSkinImportResult {
  if (!files.themeCssPresent) {
    // 正式包契约要求非空 theme.css；缺失说明不是 DreamSkin 主题包。
    throw new DreamSkinImportError("theme.css missing", "missingThemeCss");
  }
  if (files.backgroundImage) {
    // 两层判据：zip 条目字节上限，以及编码后 data URL 的字符上限（schema 的判据，
    // base64 会比原图膨胀约 4/3）。只卡前者会让大图导入"成功"、保存时才被 Zod 打回。
    if (files.backgroundImage.bytes > MAX_ENTRY_BYTES) {
      throw new DreamSkinImportError("background image too large", "entryTooLarge");
    }
    if (files.backgroundImage.dataUrl.length > MAX_SKIN_BACKGROUND_IMAGE_CHARS) {
      throw new DreamSkinImportError("background image data url too large", "entryTooLarge");
    }
  }
  let theme: DreamSkinThemeJson;
  try {
    theme = JSON.parse(files.themeJson) as DreamSkinThemeJson;
  } catch {
    throw new DreamSkinImportError("theme.json is not valid JSON", "missingThemeJson");
  }
  if (files.manifest) {
    try {
      const manifest = JSON.parse(files.manifest) as DreamSkinManifest;
      if (
        Array.isArray(manifest.platforms) &&
        !manifest.platforms.includes("windows") &&
        !manifest.platforms.includes("all")
      ) {
        throw new DreamSkinImportError("platform not supported", "unsupportedPlatform");
      }
    } catch (error) {
      if (error instanceof DreamSkinImportError) throw error;
      // manifest 解析失败按无清单的简化包处理（本地简化 ZIP 同样合法）。
    }
  }

  // theme.json.colors 的 10 色全量映射：早年只搬 5 色（且把 panelAlt 落到 card），
  // 主题的 text/muted/secondary/accentAlt/highlight 全部丢失，界面文字色留在底座
  // 主题上，浅色底深色字直接糊成一团。Codex 客户端是把 10 色原样写进
  // --ds-theme-color-* 的，这里逐条对齐，alpha 一并保留。
  const colors = theme.colors ?? {};
  const overrides: Record<string, string> = {};
  for (const [dreamKey, overrideField] of Object.entries(DREAM_SKIN_COLOR_TO_OVERRIDE)) {
    const value = colors[dreamKey as keyof typeof colors];
    if (isHexOrRgba(value)) overrides[overrideField] = value;
  }

  // theme.css 原文入库：这是 Codex 侧每个面的 alpha/圆角/阴影的唯一来源。
  // 只拦 url() 与 @ 规则（安全边界），属性/part 白名单偏差不拦——详见
  // dreamskin-safe-css 的 findUnsafeCssIssues 说明。
  const themeCss = files.themeCss?.trim() ?? "";
  let safeCss: string | undefined;
  if (themeCss) {
    const unsafe = findUnsafeCssIssues(themeCss);
    if (unsafe.length > 0) {
      throw new DreamSkinImportError(
        `theme.css contains disallowed rules: ${unsafe[0]?.message ?? "unknown"}`,
        "unsafeThemeCss",
      );
    }
    safeCss = themeCss;
  }

  // art.taskMode / safeArea：Codex 的 flag 语义与我们的 image.taskIntensity /
  // safeArea 一一对应（ambient/full/off、left/right/none），不映射就丢掉主题对
  // 任务区底图强度的意图。
  const image: NonNullable<CustomSkinSettings["image"]> = {};
  const taskMode = theme.art?.taskMode;
  if (taskMode === "full" || taskMode === "off" || taskMode === "ambient") {
    image.taskIntensity = taskMode;
  }
  const safeArea = theme.art?.safeArea;
  if (safeArea === "left" || safeArea === "right" || safeArea === "none") {
    image.safeArea = safeArea;
  }

  const skin: CustomSkinSettings = {
    base: theme.appearance === "light" ? "zai-light" : "zai-dark",
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    // 主题色原样上桌：Codex 不二次加工主题包的颜色，alpha 是主题设计的一部分。
    ...(safeCss ? { safeCss } : {}),
    ...(Object.keys(image).length > 0 ? { image } : {}),
    ...(files.backgroundImage
      ? {
          backgroundImage: files.backgroundImage.dataUrl,
          ...(theme.art?.focusX != null ? { backgroundFocusX: theme.art.focusX } : {}),
          ...(theme.art?.focusY != null ? { backgroundFocusY: theme.art.focusY } : {}),
        }
      : {}),
  };
  return {
    skin,
    themeName: theme.name?.trim() || theme.id?.trim() || "DreamSkin theme",
    backgroundImageDataUrl: files.backgroundImage?.dataUrl ?? null,
  };
}

/** 焦点定位转为 CSS background-position（theme.json art.focusX/Y 为 0-1 比例）。 */
export function dreamSkinFocusToBackgroundPosition(
  focusX: number | undefined,
  focusY: number | undefined,
): string | undefined {
  if (focusX == null && focusY == null) return undefined;
  const x = focusX != null ? Math.round(Math.min(1, Math.max(0, focusX)) * 100) : 50;
  const y = focusY != null ? Math.round(Math.min(1, Math.max(0, focusY)) * 100) : 50;
  return `${x}% ${y}%`;
}
