import { useEffect, useState, useCallback } from "react";
import {
  DEFAULT_SKIN_IMAGE,
  DEFAULT_SKIN_SURFACE,
  type CustomSkinSettings,
} from "@zcode/shared";
import {
  buildDreamSkinImmersiveRules,
  buildDreamSkinPartBaseRules,
  buildDreamSkinVariables,
  dreamSkinArtUrl,
  translateDreamSkinCss,
} from "@/settings/dreamskin-parts.js";

export type Theme = "light" | "dark" | "zai-light" | "zai-dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "zcode-theme";
const BROWSER_THEME_SURFACE_ATTRIBUTE = "data-zcode-browser-theme-surface";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }

  return theme === "dark" || theme === "zai-dark" ? "dark" : "light";
}

export function normalizeThemePreference(theme: Theme): Theme {
  if (theme === "dark") return "zai-dark";
  if (theme === "light") return "zai-light";
  return theme;
}

function setThemeMetaContent(name: "theme-color" | "color-scheme", content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

function syncBrowserThemeSurface(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (
    typeof root.hasAttribute !== "function" ||
    !root.hasAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE)
  ) {
    return;
  }

  // Electron 为 vibrancy 保持透明根背景，但普通浏览器需要从文档根和标准 meta
  // 获得页面主题。只切换 React 的 dark class 会让浏览器工具栏、原生控件和 overscroll 留在旧主题。
  root.setAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE, resolved);
  root.style.colorScheme = resolved;
  setThemeMetaContent("color-scheme", resolved);

  const background = getComputedStyle(root).getPropertyValue("--color-background").trim();
  if (background) {
    setThemeMetaContent("theme-color", background);
  }
}

// 皮肤活跃时的底座锁：applyTheme 的所有调用方（store 主题切换、system 模式下
// prefers-color-scheme 变化、初始化）都会翻转 .theme-zai-* class；皮肤的内联
// CSS variables 只适配声明的 base。不锁底座就会出现浅色 class 配深色内联
// background 的撕裂——锁定后皮肤活跃期间底座 class 始终跟 skin.base。
let activeSkinBase: "zai-dark" | "zai-light" | null = null;

export function applyTheme(theme: Theme) {
  const effectiveTheme = activeSkinBase ?? theme;
  const resolved = resolveTheme(effectiveTheme);
  const appliedTheme =
    effectiveTheme === "system"
      ? resolved === "dark"
        ? "zai-dark"
        : "zai-light"
      : normalizeThemePreference(effectiveTheme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-zai-light", appliedTheme === "zai-light");
  document.documentElement.classList.toggle("theme-zai-dark", appliedTheme === "zai-dark");
  syncBrowserThemeSurface(resolved);
}

// ─────────────────────────────────────────────
// 原生皮肤引擎
// overrides 以内联 CSS variables 盖在 .theme-zai-* token 块之上（style 属性天然优先），
// 背景 figure 直接画在 <html> 的 background 上（透明 UI 栈的最底层），无蒙层元素。
// ─────────────────────────────────────────────

const SKIN_STYLE_ELEMENT_ID = "xcode-custom-skin-style";

export const TOKEN_BY_FIELD: Record<string, string> = {
  background: "--color-background",
  backgroundWinAlt: "--color-background-win-alt",
  surface: "--color-surface",
  card: "--color-card",
  panel: "--color-panel",
  sidebar: "--color-sidebar",
  popover: "--color-popover",
  input: "--color-input",
  border: "--color-border",
  accent: "--color-accent",
  brand: "--color-brand",
  // Skin Studio 调色板扩充：对齐 DreamSkin theme.json 的 10 色，
  // 落到我们底座主题里语义相同的 token 上。
  text: "--color-foreground",
  muted: "--color-foreground-subtle",
  line: "--color-border",
  highlight: "--color-find-highlight",
  secondary: "--color-secondary",
  panelAlt: "--color-background-alt",
  accentAlt: "--color-primary",
};

/**
 * 皮肤 → :root token 覆盖表。引擎（applyCustomSkin）与皮肤工坊预览共用，
 * 保证预览算出来的 token 和真实生效的逐条一致——之前预览只吃全局 :root，
 * 工坊自己的界面会被皮肤带着一起变。
 */
export function buildSkinTokenValues(skin: CustomSkinSettings): Map<string, string> {
  const tokenValues = new Map<string, string>();
  for (const [field, token] of Object.entries(TOKEN_BY_FIELD)) {
    const value = skin.overrides?.[field as keyof NonNullable<CustomSkinSettings["overrides"]>];
    if (value?.trim()) tokenValues.set(token, value.trim());
  }
  // 主题只覆盖 card 时把 input（含聚焦态）一起带上，否则输入框停留在底座主题的
  // 白色、和主题脱色；聚焦态一起镜像，避免聚焦时从主题色跳回底座白。
  const cardValue = tokenValues.get("--color-card");
  if (cardValue && !tokenValues.has("--color-input")) {
    tokenValues.set("--color-input", cardValue);
    tokenValues.set("--color-input-focused", cardValue);
  }
  // 主题覆盖 panel 而未覆盖 surface 时镜像过去（保留 20% 透出让气泡在图上仍是玻璃）。
  const panelValue = tokenValues.get("--color-panel");
  if (panelValue && !tokenValues.has("--color-surface")) {
    tokenValues.set("--color-surface", `color-mix(in srgb, ${panelValue} 80%, transparent)`);
  }
  // panelAlt 是 Codex 的 composer/dialog 底座（Studio 模板里 composer 和 dialog 都用
  // var(--ds-theme-color-panel-alt)）。不镜像的话 XCode 的 composer 仍是底座白，
  // 主题层叠上去也达不到 Codex 那个 panelAlt 底色——实测 miku v2 的 composer 在
  // Codex 里是 rgb(238,247,243) 正好等于 panelAlt(#eef7f3)。
  const panelAltValue = tokenValues.get("--color-background-alt");
  if (panelAltValue) {
    if (!tokenValues.has("--color-input")) {
      tokenValues.set("--color-input", panelAltValue);
      tokenValues.set("--color-input-focused", panelAltValue);
    }
    if (!tokenValues.has("--color-popover")) tokenValues.set("--color-popover", panelAltValue);
  }
  return tokenValues;
}

// 窗口外壳（DesktopWindowFrame）在背景图模式下是全透明画布。CDP 实测元素链：
// sidebar 一路透明到 aside，唯一给侧边栏上色的就是外壳的 bg-background-win-alt；
// 主区则是外壳 + conversation section 两层——不撤掉就会把侧栏和主区一起扣暗。
// 用元素规则而非 token：Windows/Linux 外壳用 win-alt，macOS 用 background-alt，
// 后者还有一堆对话框/pane 消费者，不能把整个 token 设透明。
const SHELL_TRANSPARENT_RULE =
  '[data-desktop-window-frame="true"] { background-color: transparent !important; }';

// 主内容区透明：原版 Codex 的主区就是透图的（主题包 theme.css 只给 sidebar 上
// 遮罩，主区没有任何蒙版规则），XCode 默认给 conversation frame 上 bg-background
// 实色会把图挡死。挂点是 frame 上的 data-workspace-conversation-frame。
const CONVERSATION_TRANSPARENT_RULE =
  '[data-workspace-conversation-frame="true"] { background-color: transparent !important; }';

// 侧栏面板不透明度：原版 theme.css 给 sidebar 上主题 panel 色，但客户端把这个色
// 固定加了透出（--ds-theme-color-panel 由客户端定义，主题包里的 panel 常是实色），
// 直接贴实色会得到一块死板。实测反解原版约 85%（侧栏与主内容间隙露出纯图，列
// 方程 composite = α·panel + (1−α)·raw 三通道一致）。取 50% 让侧栏更透、底图
// 存在感更强。Skin Studio 把它提升为皮肤参数 surface.opacity，缺省 50，
// 未设置时与这里一致。
const SIDEBAR_PANEL_OPACITY_PERCENT = DEFAULT_SKIN_SURFACE.opacity;
/** DreamSkin 10 色 → 语义 token（补齐 --ds-theme-color-* 时的取值来源）。 */
const DREAM_SKIN_COLOR_TOKENS: Record<string, string> = {
  background: "--color-background",
  panel: "--color-panel",
  "panel-alt": "--color-card",
  accent: "--color-accent",
  "accent-alt": "--color-primary",
  secondary: "--color-secondary",
  highlight: "--color-find-highlight",
  text: "--color-foreground",
  muted: "--color-foreground-subtle",
  line: "--color-border",
};


// 表面（卡片/面板/弹层/输入框）类名集合。Skin Studio 的 radius/border/shadow/blur
// 通过引擎按需发射 !important 元素规则落到这些类上——只在用户显式设置时发射，
// 默认皮肤不产生任何规则，视觉与今天逐字节一致。
const SURFACE_CLASS_SELECTOR =
  ".bg-card, .bg-panel, .bg-surface, .bg-popover, .bg-input";

/** 应用/清除自定义皮肤覆盖层；皮肤有 base 时以 base 为准切底座主题。 */
export function applyCustomSkin(skin: CustomSkinSettings | null | undefined) {
  const root = document.documentElement;
  const styleEl =
    document.getElementById(SKIN_STYLE_ELEMENT_ID) ?? createSkinStyleElement();

  // 辅助：清底图相关 inline 样式。
  const clearRootBg = () => {
    root.style.backgroundImage = "";
    root.style.backgroundSize = "";
    root.style.backgroundPosition = "";
    root.style.backgroundRepeat = "";
  };

  if (!skin) {
    activeSkinBase = null;
    styleEl.textContent = "";
    clearRootBg();
    // 皮肤活跃期间底座被锁成 skin.base，.theme-zai-* class 已被改写。撤掉皮肤必须把
    // 用户的主题偏好还原回去，否则预览过一个深色皮肤再关掉，整个应用会一直留在深色
    // 底座（实测 themePref=system + 系统浅色，class 却停在 dark theme-zai-dark）。
    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    applyTheme(isTheme(storedTheme) ? normalizeThemePreference(storedTheme) : "zai-dark");
    return;
  }

  activeSkinBase = skin.base;
  applyTheme(skin.base);

  // token 覆盖用 map 收口，写入时唯一化，避免同一 token 出现重复声明。
  const tokenValues = buildSkinTokenValues(skin);
  let settingsNavMask: string | undefined;

  // 背景图统一铺满整窗：html 固定附着扛图，侧栏磨砂、主区薄 veil、正文靠投影。
  // 宽图与非宽图都是"图铺满整窗"的模型，差异只在构图裁切；图片还没解码完
  // 也照常出图——html 规则不依赖宽高比。
  if (skin.backgroundImage) {
    // 底图必须画在 <html> 上，但 styles.css 的 `html,body,#root{background:transparent
    // !important}` 会覆盖 inline style（important 声明 > 内联）——CDP 实测 computed
    // background-image 为 none 正是这个原因。皮肤图同样用 !important（同为 important
    // 时按来源排序，style 元素晚于 styles.css 注入且同为 author 样式，后者优先），
    // 写进 skin style 元素确保生效。
    const focusX = skin.backgroundFocusX != null ? Math.round(skin.backgroundFocusX * 100) : 50;
    const focusY = skin.backgroundFocusY != null ? Math.round(skin.backgroundFocusY * 100) : 50;
    const zoom = skin.image?.zoom ?? DEFAULT_SKIN_IMAGE.zoom;
    const dim = skin.image?.dim ?? DEFAULT_SKIN_IMAGE.dim;
    const safeArea = skin.image?.safeArea ?? DEFAULT_SKIN_IMAGE.safeArea;
    // 背景层叠顺序（CSS 多背景先画的在上层）：压暗 → 安全区渐变 → 图。
    // 压暗用纯黑 alpha 叠在最上层，safeArea 用同色渐变把某一侧压暗过渡到透明，
    // 让导航/列表那侧不被花图抢内容。
    const layers: string[] = [];
    if (dim > 0) {
      layers.push(`linear-gradient(rgba(0,0,0,${(dim / 100).toFixed(3)}), rgba(0,0,0,${(dim / 100).toFixed(3)}))`);
    }
    if (safeArea === "left") {
      layers.push("linear-gradient(to right, rgba(0,0,0,0.55), rgba(0,0,0,0) 32%)");
    } else if (safeArea === "right") {
      layers.push("linear-gradient(to left, rgba(0,0,0,0.55), rgba(0,0,0,0) 32%)");
    }
    // 同样走 dreamSkinArtUrl：这里只要叠了 dim/safeArea 图层就是"多图层 + 巨型
    // data url"，Blink 会把整条 background-image 丢掉（kobe 没配 dim，所以这条
    // 一直是单图层、看着像好的，属于运气）。
    layers.push(`url(${dreamSkinArtUrl(skin.backgroundImage)})`);
    // zoom=1 保持 cover（与旧行为逐字节一致）；>1 时按宽度放大，aspect 由 auto 保留，
    // 超出部分自然裁切——这正是"放大看局部"的预期。
    const backgroundSize = zoom > 1 ? `${Math.round(zoom * 100)}% auto` : "cover";
    // 图铺满整窗且固定附着：侧栏（磨砂）与主区（薄 veil）都叠在图上，正文可读性靠投影。
    const attachment = " background-attachment: fixed !important;";
    tokenValues.set(
      "__HTML_BG_IMAGE__",
      `background-image: ${layers.join(", ")} !important; background-size: ${backgroundSize} !important; background-position: ${focusX}% ${focusY}% !important; background-repeat: no-repeat !important;${attachment}`,
    );
    // 主区那份背景图：Codex 的图是画在 main 容器上的（runtime 的 SHELL_MAIN::before），
    // 位于 main 自身 background-color 之上，所以主题把 main 写成不透明实色也挡不住图。
    // 只画在 html 上会被 main 的实色底整块盖掉——kobe 的 main 是 #17131C，6MB 的图
    // 就是这么消失的。图与 veil 一起作为 main 的 background-image 发出（见下方
    // buildDreamSkinArtRules）；图的 data URL 不借道自定义属性，Chromium 会静默
    // 丢弃值超过约 1MB 的自定义属性声明，6MB 的 base64 一去不回。
    clearRootBg();

    // 主题色原样上桌，不做二次加工。Codex 客户端直接把主题包的颜色写进 DOM，
    // alpha 是主题设计的一部分（firefly 的 background 就是 rgba(...,0.04)）。
    // 不混透明 veil 蒙层，先落原始 override 再读 computed：base 主题的 token 有
    // var() 引用和 color-mix，只有渲染引擎解析后的值才是最终生效色。
    styleEl.textContent = rootTokenRule(tokenValues);
    // 图铺满整窗后侧栏由沉浸式磨砂渐变统一上色（panel .72→.68 / .70→.64），
    // 主题自己的 sidebar Safe CSS 会被它覆盖——侧栏浓度收口在引擎一处，不与主题包各自为政。
    // 设置页导航列：与右侧 data-settings-panel-frame 的 bg-background 同源，
    // 用主题 background 原值，左右密度一致。
    settingsNavMask = getComputedStyle(root).getPropertyValue("--color-background").trim() || undefined;
  } else {
    clearRootBg();
    tokenValues.set("__HTML_BG_IMAGE__", "background-image: none !important;");
  }
  // 分条规则输出：html 背景（重要优先级，穿透 styles.css 的 transparent !important）、
  // :root token 覆盖、元素级规则（外壳让位、主内容区透图、侧栏/设置导航用主题色）。
  const htmlBgRule = tokenValues.get("__HTML_BG_IMAGE__") ?? "";
  const taskIntensity = skin.image?.taskIntensity ?? DEFAULT_SKIN_IMAGE.taskIntensity;
  // 任务/对话区底图强度：图铺满整窗后，外壳和 conversation frame 都全透明，
  // 蒙层统一由 buildDreamSkinImmersiveRules 的薄 veil 统筹（off 除外——off 用实色
  // 把主区挡住，只留侧栏透图）。
  const conversationRule =
    taskIntensity === "off"
      ? '[data-workspace-conversation-frame="true"] { background-color: var(--color-background) !important; }'
      : CONVERSATION_TRANSPARENT_RULE;
  const sidebarPanelRule =
    taskIntensity === "off"
      ? ""
      : '[data-workspace-sidebar-panel="true"] { background-color: transparent !important; }';
  const elementRules = skin.backgroundImage
    ? [
        SHELL_TRANSPARENT_RULE,
        conversationRule,
        ...(sidebarPanelRule ? [sidebarPanelRule] : []),
        ...(settingsNavMask
          ? [`[data-settings-nav-frame="true"] { background-color: ${settingsNavMask} !important; }`]
          : []),
        // 首页推荐操作按钮（周报总结那排）：Button 的 outline 变体静止态没有背景，
        // 花背景图上就是一排空胶囊。原版这类操作卡是主题 background 色约 90% 的
        // 浅色面板（截图实测填充 (243,241,237) vs 周围原图 (167,154,141)）。
        // 用元素规则而非改 Button 变体：只作用于皮肤激活时，默认皮肤零影响。
        '[data-draft-suggested-prompt] { background-color: color-mix(in srgb, var(--color-background) 90%, transparent); }',
      ]
    : [];

  // Skin Studio 表面参数：只在用户显式设置时发射，未设置不产生规则。
  // radius/border/shadow 落在通用表面类上（!important 压过 Tailwind 的 rounded-*），
  // blur 用 backdrop-filter 让半透明面板真正"毛"起来。
  const surface = skin.surface;
  if (surface) {
    if (surface.radius != null) {
      elementRules.push(
        `${SURFACE_CLASS_SELECTOR} { border-radius: ${surface.radius}px !important; }`,
      );
    }
    if (surface.borderAlpha != null) {
      elementRules.push(
        `${SURFACE_CLASS_SELECTOR} { border-color: color-mix(in srgb, var(--color-border) ${surface.borderAlpha}%, transparent) !important; }`,
      );
    }
    if (surface.shadow != null && surface.shadow > 0) {
      const a = (surface.shadow / 100) * 0.35;
      elementRules.push(
        `${SURFACE_CLASS_SELECTOR} { box-shadow: 0 1px 2px rgba(0,0,0,${a.toFixed(3)}), 0 6px 16px rgba(0,0,0,${(a * 1.6).toFixed(3)}) !important; }`,
      );
    }
    if (surface.blur != null && surface.blur > 0) {
      elementRules.push(
        `${SURFACE_CLASS_SELECTOR} { backdrop-filter: blur(${surface.blur}px) !important; -webkit-backdrop-filter: blur(${surface.blur}px) !important; }`,
      );
    }
  }

  // DreamSkin Safe CSS（Codex 主题包的 theme.css / 工坊手写的高级 CSS）必须排在
  // 最后：它按 [data-ds-part] 描述每个面的 alpha/圆角/阴影，而上面那些引擎默认
  // 蒙层（侧栏 50%、对话区 70%）是按我们自己的挂点写的。同优先级下后写者赢，
  // 主题明确指定过的面就应由主题说话；没提到的面仍走引擎默认。
  // 声明统一补 !important：Tailwind 实用类与 [data-ds-part] 同为 (0,1,0) 优先级，
  // dev 下 Vite 还会往 head 追加 <style>，不补就会出现皮肤被反杀、时好时坏。
  const dreamSkinCss = skin.safeCss?.trim() ?? "";
  if (dreamSkinCss) {
    // 先给每个 part 补"客户端底座"：Codex 的主题层是叠在底座上的，不是替换。
    // 少了这一层，主题写的 5% 会直接把侧栏面板和输入框底色盖掉，侧栏/composer
    // 变成透图——实测 miku v2 的 composer 在 Codex 里是 rgb(238,247,243)
    // （= panelAlt 再叠 5% panel），只贴 theme.css 的 5% 就只剩透图。
    const sidebarOpacity = skin.surface?.opacity ?? SIDEBAR_PANEL_OPACITY_PERCENT;
    elementRules.push(...buildDreamSkinPartBaseRules("", { sidebarOpacity }));
  }

  if (dreamSkinCss) {
    elementRules.push(`/* dreamskin-safe-css */\n${translateDreamSkinCss(dreamSkinCss)}`);
  }

  // 沉浸式四件套（侧栏磨砂渐变 / header 全透明 / composer 实色 / main 薄 veil）对所有
  // 有图的皮肤生效——图已统一铺满整窗，不再有"非沉浸"形态。
  // **必须排在 theme.css 之后**：同优先级 (0,1,0) + 同为 !important，发在前面会被
  // 主题的 72% 实色整块盖掉（曾因此把 theme.css 重复 push 了一遍，第二份落在后面
  // 把沉浸式规则盖回去，表现为"改了没生效"——判这类问题先 dump sheet 的 rule index）。
  elementRules.push(
    ...buildDreamSkinImmersiveRules("", {
      base: skin.base,
      taskMode: skin.image?.taskIntensity ?? DEFAULT_SKIN_IMAGE.taskIntensity,
    }),
  );

  // thread 的 backdrop-filter 一律剥掉。主题常给 thread 写 blur（小红：blur(4px)），
  // 而 thread 是透图的那一层——糊它等于把背景图糊掉，主区整片发糊。
  // 玻璃感是 sidebar/composer/dialog 那些有自己底色的面的事，跟 thread 无关。
  // 必须排在 theme.css 之后：同优先级 (0,1,0) + 同为 !important，后写者赢。
  // 只在有背景图时发：没有图时 thread 背后就是一块实色，糊不糊都看不出来。
  if (skin.backgroundImage) {
    elementRules.push(
      `[data-ds-part="thread"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`,
    );
  }

  // --ds-theme-* 变量：DreamSkin Safe CSS 用 var() 引用主题色与表面参数。
  // 不定义就等于引用方拿到 invalid var()——background-color 会回落 transparent，
  // 整面消失。颜色来自 overrides（Codex 客户端同样原样写 DOM），其余按客户端缺省值。
  const dreamSkinVars = buildDreamSkinVariables(skin);
  for (const [name, value] of Object.entries(dreamSkinVars)) {
    tokenValues.set(name, value);
  }
  // 主题只给了部分色（工坊手写的 Safe CSS、或导入包某色格式不合法被跳过）时，
  // 用语义 token 的解析值补齐：token 块里有 var() 引用和 color-mix，只有渲染引擎
  // 解析后的值才是最终生效色，所以先落 :root 再读 computed。
  styleEl.textContent = rootTokenRule(tokenValues);
  for (const [suffix, token] of Object.entries(DREAM_SKIN_COLOR_TOKENS)) {
    const name = `--ds-theme-color-${suffix}`;
    if (dreamSkinVars[name]) continue;
    const fallback = getComputedStyle(root).getPropertyValue(token).trim();
    if (fallback) tokenValues.set(name, fallback);
  }

  styleEl.textContent = [
    rootTokenRule(tokenValues),
    htmlBgRule ? `html { ${htmlBgRule} }` : "",
    ...elementRules,
  ]
    .filter(Boolean)
    .join("\n");
}



/** :root token 覆盖规则；空 map 返回空串。 */
function rootTokenRule(tokenValues: Map<string, string>): string {
  const declarations = [...tokenValues.entries()]
    .filter(([token]) => token.startsWith("--"))
    .map(([token, value]) => `${token}: ${value};`);
  return declarations.length > 0 ? `:root { ${declarations.join(" ")} }` : "";
}

function createSkinStyleElement(): HTMLStyleElement {
  const el = document.createElement("style");
  el.id = SKIN_STYLE_ELEMENT_ID;
  document.head.append(el);
  return el;
}

function isTheme(value: string | null): value is Theme {
  return (
    value === "light" ||
    value === "dark" ||
    value === "zai-light" ||
    value === "zai-dark" ||
    value === "system"
  );
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // 默认主题统一收敛到 Zai dark，避免旧 hook 兜底值和 Zustand store 默认值分叉。
    return isTheme(saved) ? normalizeThemePreference(saved) : "zai-dark";
  });

  const setTheme = useCallback((t: Theme) => {
    const normalizedTheme = normalizeThemePreference(t);
    localStorage.setItem(STORAGE_KEY, normalizedTheme);
    setThemeState(normalizedTheme);
    applyTheme(normalizedTheme);
  }, []);

  // 初始化 + system 模式下监听系统偏好变化
  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme } as const;
}
