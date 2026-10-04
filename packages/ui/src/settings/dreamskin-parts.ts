/**
 * DreamSkin 合约适配层。
 *
 * 背景：Codex 主题包（github.com/Fei-Away/Codex-Dream-Skin）由 theme.json（10 色 +
 * art）+ theme.css 组成，theme.css 是过 dreamskin-safe-css/1 校验的 Safe CSS，
 * 用 `[data-ds-part="..."]` 选择器直接描述每个面的 alpha/圆角/边框/阴影。Codex
 * 客户端把它原样注入 <style>，所以"皮肤长什么样"完全由 theme.css 决定。
 *
 * 本文件是把这套契约接到 XCode 上的唯一适配点：
 *   1. buildDreamSkinVariables —— 定义 --ds-theme-* 变量（颜色来自皮肤 overrides，
 *      其余按 Codex 客户端缺省值），否则 theme.css 里的 var() 引用全部失效；
 *   2. translateDreamSkinCss —— 补 !important，并把 background-color 改成背景图层，
 *      让主题层叠在客户端底座之上而不是替换它（见该函数注释里的实测数据）；
 *   3. scopeDreamSkinCss —— 皮肤工坊预览用：把规则限制在预览根内，避免工坊
 *      自己的界面被皮肤带着变色。
 *
 * 选择器不翻译：XCode 的 DOM 直接挂 data-ds-part 属性（见 WorkspaceShellLayout /
 * WorkspaceHeader / ConversationComposer 等），所以主题包原文即可命中，后续新
 * 皮肤包无需改代码。
 */

import {
  DEFAULT_DREAM_SKIN_VARS,
  type CustomSkinSettings,
} from "@zcode/shared";

/** theme.json.colors 的 10 个键 → CSS 变量后缀与皮肤 overrides 字段。 */
const DREAM_SKIN_COLOR_FIELDS: Record<string, keyof NonNullable<CustomSkinSettings["overrides"]>> =
  {
    background: "background",
    panel: "panel",
    "panel-alt": "panelAlt",
    accent: "accent",
    "accent-alt": "accentAlt",
    secondary: "secondary",
    highlight: "highlight",
    text: "text",
    muted: "muted",
    line: "line",
  };

/** Codex 的 --ds-theme-font-family 是枚举（system/rounded/serif/mono），这里给字体栈。 */
const DREAM_SKIN_FONT_STACKS: Record<string, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Songti SC", "SimSun", serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
};

/**
 * 皮肤 → --ds-theme-* 变量表。颜色 10 项从 overrides 原样取（Codex 客户端同样
 * 原样写 DOM，alpha 是主题设计的一部分，不做任何混合）；其余取 Codex 客户端缺省值。
 */
export function buildDreamSkinVariables(skin: CustomSkinSettings): Record<string, string> {
  const vars: Record<string, string> = { ...DEFAULT_DREAM_SKIN_VARS };
  for (const [suffix, field] of Object.entries(DREAM_SKIN_COLOR_FIELDS)) {
    const value = skin.overrides?.[field];
    if (value?.trim()) vars[`--ds-theme-color-${suffix}`] = value.trim();
  }
  const fontFamily = vars["--ds-theme-font-family"];
  const stack = fontFamily ? DREAM_SKIN_FONT_STACKS[fontFamily] : undefined;
  if (stack) vars["--ds-theme-font-family"] = stack;
  return vars;
}

/** 单个 `selector { declarations }` 块；@ 规则已被白名单拒绝，无需处理嵌套。 */
const CSS_BLOCK_RE = /([^{}]*)\{([^{}]*)\}/g;

/**
 * 翻译 DreamSkin Safe CSS：补 !important + 把 background-color 改成背景图层。
 *
 * `background-color` 转成 `background-image: linear-gradient(v, v)`：Codex 的主题层
 * 是**叠在客户端自己的底座之上**的，不是替换。实测 miku v2 的 composer——theme.css
 * 写的是 `rgba(253,252,249,0.05)`，Codex 里量到的是 rgb(238,247,243) 正好等于
 * panelAlt(#eef7f3) 再叠 5% 的 panel。直接按 background-color 盖上去会把客户端底座
 * （侧栏面板、输入框底色）整块替换掉，侧栏和 composer 立刻透图。
 *
 * **`main` 是例外，必须保留 background-color**：背景图由引擎统一画在 html 上
 * （fixed 附着），main 的可见面由沉浸式 mainRule 强制 `background-color: transparent`
 * （见 buildDreamSkinImmersiveRules，排在 theme.css 之后必胜）——主题给 main 写什么
 * 底色都会被清掉，图从 html 透上来。Codex 官方 runtime 的 `compileRuntimeCss` 同样把
 * sidebar/main/home 列入 `CORE_BACKGROUND_IMAGE_PARTS`，在主题的 background-color 后
 * 强制补 `background-image: none`。
 *
 * 注意 Safe CSS 的属性白名单里只有 background-color、没有 background-image，
 * 主题本来就写不了图。
 */
export function translateDreamSkinCss(css: string): string {
  return css.replace(CSS_BLOCK_RE, (_match, selector: string, body: string) => {
    const isMainPart = /\[data-ds-part="main"\]/.test(selector);
    const decls = body
      .split(";")
      .map((decl) => decl.trim())
      .filter((decl) => decl.length > 0 && !decl.startsWith("/*"));
    if (decls.length === 0) return `${selector.trim()}{}`;
    const translated = decls.map((decl) => {
      const withImportant = /!\s*important$/i.test(decl) ? decl : `${decl} !important`;
      // main：主题只换底色，让 art 图层（background-image）压在它上面。
      if (isMainPart) return withImportant;
      const bgMatch = /^background-color\s*:\s*(.+?)\s*!important$/i.exec(withImportant);
      if (!bgMatch?.[1]) return withImportant;
      const value = bgMatch[1];
      // 纯 transparent 不需要建图层：底座本来就是透明时盖了也白盖，
      // 而建了图层反而会压住底座。
      if (/^transparent$/i.test(value)) return withImportant;
      return `background-image: linear-gradient(${value}, ${value}) !important`;
    });
    return `${selector.trim()} { ${translated.join("; ")} }`;
  });
}



/** 皮肤图 → CSS 里可用的 URL。
 *
 * 皮肤图以 base64 data URL 存在 settings 里（工坊导入/粘贴都是这个形态），而 Blink
 * 会**整条丢掉**"多个背景图层 + 巨型 url"的 `background-image` 声明：实测
 * `url(<8MB data url>)` 单独写能正常解析，前面或后面多挂一个 linear-gradient 图层
 * 之后，同一声明的 background-image 变成空串，computed 回落 `none`——图直接消失
 * （kobe 的 6MB base64 就是这么没的，theme.css 的不透明底色反而一直是好的）。
 * 换成 blob: URL 后声明只剩几十字节，图层随便叠。
 *
 * Codex 侧没有这个问题：它的图是磁盘文件，runtime 直接写文件 URL。
 *
 * 同步实现（atob / Blob / createObjectURL 都是同步 API），调用方不用改异步；
 * 按 data URL 缓存，同一张图反复应用不会反复解码 6MB。
 */
const artUrlCache = new Map<string, string>();
const ART_URL_CACHE_LIMIT = 16;

export function dreamSkinArtUrl(backgroundImage: string): string {
  if (!/^data:/i.test(backgroundImage)) return backgroundImage;
  const cached = artUrlCache.get(backgroundImage);
  if (cached) return cached;
  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(dataUrlToBlob(backgroundImage));
  } catch {
    // 解码失败就退回原值：单图层那条路（html 底图）还能走，不至于全黑。
    return backgroundImage;
  }
  artUrlCache.set(backgroundImage, objectUrl);
  while (artUrlCache.size > ART_URL_CACHE_LIMIT) {
    const oldest = artUrlCache.keys().next().value;
    if (oldest === undefined) break;
    const stale = artUrlCache.get(oldest);
    artUrlCache.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
  return objectUrl;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = comma > 0 ? dataUrl.slice(5, comma) : "image/png";
  const payload = comma > 0 ? dataUrl.slice(comma + 1) : "";
  const mime = header.split(";")[0] || "image/png";
  if (/;base64$/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

/**
 * 背景图图层——对齐 Codex runtime 的 `SHELL_MAIN::before`。
 *
 * Codex 官方 runtime（dream-skin.css）把背景图画在 main 容器的 `::before` 伪元素上，
 * `z-index: 0`、`pointer-events: none`，图层顺序为 `task-fade → task-shade → art`
 * （先写的在上层），并用 `opacity` 表达 taskMode：ambient 深色底座 .78 / 浅色 .72、
 * full 1、off 不渲染。因为它位于 main 自身 background-color **之上**，主题把 main
 * 写成不透明实色也挡不住图——这就是"为什么 Codex 能正常显示"。
 *
 * 我们不用伪元素而用 main 自己的 `background-image` 多图层：CSS 的背景模型本身就是
 * "color 在底、image 在其上"，效果等价，且不必给 main 的所有子元素补
 * `position: relative; z-index: 1`（伪元素带 z-index 会盖住静态子元素的文字，
 * Codex 是靠给全部子元素提 z-index 绕开的，那个改动面太大）。
 *
 * **veil 浓度必须乘层不透明度**。Codex 把 fade/shade/art 一起放在 ::before 上，
 * 整层再乘一个 `opacity`（.78 / .72），所以 veil 的有效浓度 = 渐变 alpha × 层不透明度。
 * 早期版本漏了这一乘，veil 按满浓度画——浅色底座下 shade 左侧是 .68 的近白色，
 * 主区直接被糊成一片，和 Codex 并排看色差极明显（用户截图对比出来的）。
 * 深浅两套 veil 数值也不一样，见 VEIL_STOPS。
 *
 * **首页不画 veil**。Codex 的 veil 规则带 `:not(:has(home-route))`，新对话首页只有
 * `body { background-image: art }` 一张满强度图。XCode 的首页特征是 main 里挂着
 * `[data-ds-part="home"]`（推荐语槽位），所以对话态才发带 veil 的那条规则。
 *
 * veil 色取 `--color-background`：Codex 的 `--ds-bg` 在皮肤激活时就被 runtime 换成
 * 主题的 background 色（renderer-inject.js: `"--ds-bg": pick("background")`），同源。
 *
 * 图的 URL 走 dreamSkinArtUrl（data URL → blob URL），不要直接内联 base64，
 * 也不要借道 CSS 自定义属性：前者撞上 Blink 的多图层+巨型 url 丢弃，后者撞上
 * 自定义属性约 1MB 的长度上限，两条路都实测过，图都会变成 none。
 */

/** Codex 的 --ds-task-fade / --ds-task-shade 色标（位置 %, alpha），深浅两套。 */
const VEIL_STOPS = {
  dark: {
    fade: [
      [0, 0.1],
      [32, 0.18],
      [68, 0.76],
      [100, 1],
    ] as const,
    shade: [
      [0, 0.56],
      [48, 0.36],
      [100, 0.12],
    ] as const,
    layerAlpha: 0.78,
  },
  light: {
    fade: [
      [0, 0.08],
      [34, 0.22],
      [70, 0.78],
      [100, 1],
    ] as const,
    shade: [
      [0, 0.68],
      [48, 0.4],
      [100, 0.12],
    ] as const,
    layerAlpha: 0.72,
  },
} as const;

/**
 * 各 part 的"底座"背景色——即 Codex 客户端自己画的那层，主题的 5% 叠在它上面。
 * 取值以 Codex runtime 实测为准：sidebar=panel、composer/dialog/message=panel-alt
 * （Codex 侧对应 --ds-panel-2）、main=background（皮肤激活时透图）。
 * Studio 模板里 message 写的是 panel，但 Codex 真实渲染的用户气泡是 panel-alt 色
 * （见下面 message 那条的实测数据），以实测为准。
 * 只在有 DreamSkin 主题时发射：没有主题就不该改动这些面的既有背景。
 */
export function buildDreamSkinPartBaseRules(
  prefix: string,
  options: { sidebarOpacity: number },
): string[] {
  const sel = (part: string) => `${prefix}[data-ds-part="${part}"]`;
  // 中性重置：translateDreamSkinCss 会把主题的 background-color 转成
  // background-image: linear-gradient(...)。若某 part 的主题值是 transparent
  // （不产生 background-image），已应用皮肤的**全局**同 part 规则（优先级 0,1,0）
  // 的 background-image 就会漏进预览区。part-base 在预览里是 scoped（0,2,0），
  // 这里显式把 background-image / box-shadow / backdrop-filter 重置为中性，
  // 即可压住全局泄漏；草稿自己的 theme.css 排在 part-base 之后，需要时再覆盖回来。
  // 真实 app 里 part-base 与 theme.css 同为 0,1,0、theme.css 在后，行为不变。
  const neutral = "background-image: none !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;";
  return [
    `${sel("root")} { background-color: transparent !important; }`,
    `${sel("sidebar")} { background-color: color-mix(in srgb, var(--color-panel) ${options.sidebarOpacity}%, transparent) !important; ${neutral} }`,
    `${sel("main")} { background-color: transparent !important; ${neutral} }`,
    `${sel("header")} { background-color: transparent !important; ${neutral} }`,
    `${sel("home")} { background-color: transparent !important; ${neutral} }`,
    `${sel("home-hero")} { background-color: transparent !important; ${neutral} }`,
    `${sel("project-list")} { background-color: transparent !important; ${neutral} }`,
    `${sel("thread")} { background-color: transparent !important; ${neutral} }`,
    // message 用 panel-alt：Codex 的用户气泡底座是 --ds-panel-2（runtime 把气泡的
    // bg-token-main-surface-primary 清成透明后由它上色）。实测 Codex 截图里用户气泡
    // 是 rgb(114,214,255)，主题包 panel-alt 正好是 #75d1ff = rgb(117,209,255)；
    // 而 --color-surface 是从 panel 镜像来的（useTheme.buildSkinTokenValues），
    // 气泡会停在 panel 的近白色，和主题包脱色。80% 透出让气泡在图上仍是玻璃。
    `${sel("message")} { background-color: color-mix(in srgb, var(--color-background-alt) 80%, transparent) !important; ${neutral} }`,
    `${sel("composer")} { background-color: var(--color-input) !important; ${neutral} }`,
    `${sel("composer-toolbar")} { background-color: transparent !important; ${neutral} }`,
    `${sel("dialog")} { background-color: var(--color-popover) !important; ${neutral} }`,
  ];
}

/**
 * 宽图沉浸式布局——对齐 Codex 的 `[data-dream-art-wide="true"]` 那一组规则
 * （dream-skin.css 里 LEFT_PANEL / SHELL_MAIN / COMPOSER_CHROME / HEADER_TINT）。
 *
 * 触发条件是图的宽高比 >= 1.75（CODEX_ART_WIDE_RATIO）。图由 useTheme 的 html
 * 规则扛（background-attachment: fixed），这里发其余四个面。
 *
 * **两套值，按路由分流**（Codex 用 `[role="main"]` 判首页，XCode 用
 * `[data-ds-part="thread"]` 判会话页）：
 *   首页   侧栏 panel/.46→bg/.40，主区 bg/.40/.26@64%/.16
 *   会话页 侧栏 panel/.70→bg/.82，主区 bg/.82/.74@64%/.60（浅色另有自己的值）
 * 分不清路由只发一套，就会有一边明显不对——最初只发了会话页那套，首页看着发闷。
 * taskMode=full 时会话页也走首页那套（Codex 的 full 分支引的就是 --ds-immersive-*）。
 *
 * 为什么侧栏终于透了：非沉浸式下 main 自己扛着不透明的图，侧栏再半透也透不出
 * 东西；沉浸式把图挪到 body 上、main 只留 veil，侧栏的 panel→bg 横向渐变才看得见。
 * 用户的原话是「codex 效果侧栏是透的」，Codex 这套就是答案。
 */
export function buildDreamSkinImmersiveRules(
  prefix: string,
  options: { base: "zai-dark" | "zai-light"; taskMode?: "off" | "ambient" | "full" },
): string[] {
  const sel = (part: string) => `${prefix}[data-ds-part="${part}"]`;
  const light = options.base === "zai-light";
  const veil = (alpha: number) =>
    `color-mix(in srgb, var(--color-background) ${(alpha * 100).toFixed(1)}%, transparent)`;
  const panel = (alpha: number) =>
    `color-mix(in srgb, var(--color-panel) ${(alpha * 100).toFixed(1)}%, transparent)`;
  const muted = (alpha: number) =>
    `color-mix(in srgb, var(--color-foreground-subtle) ${(alpha * 100).toFixed(1)}%, transparent)`;
  const text = (alpha: number) =>
    `color-mix(in srgb, var(--color-foreground) ${(alpha * 100).toFixed(1)}%, transparent)`;
  const bg = (alpha: number) => (light ? panel(alpha) : veil(alpha));

  // 侧栏/主区/输入框在沉浸式下按 Codex 的写法把主题给的边框圆角阴影全部抹掉
  // （Codex 三条规则都以 border:0 / border-radius:0 / box-shadow:none 开头）。
  // 不抹的话主题写死的 16px 圆角 + 1px 边会把"侧栏是窗口延伸"的观感切回卡片感，
  // 小红就是这么破相的。
  const flat = "border: 0 !important; border-radius: 0 !important; box-shadow: none !important;";
  // Codex:
  // 深色: 0 10px 30px rgb(bg/.20), inset 0 0 0 1px line, inset 0 1px rgb(text/.12)
  // 浅色: 0 10px 28px rgb(bg/.14), inset 0 0 0 1px line, inset 0 1px rgb(panel/.72)
  const composerShadow = light
    ? [
        "0 10px 28px color-mix(in srgb, var(--color-background) 14%, transparent)",
        "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 24%, transparent)",
        "inset 0 1px color-mix(in srgb, var(--color-panel) 72%, transparent)",
      ].join(", ")
    : [
        "0 10px 30px color-mix(in srgb, var(--color-background) 20%, transparent)",
        "inset 0 0 0 1px color-mix(in srgb, var(--color-foreground-subtle) 42%, transparent)",
        "inset 0 1px color-mix(in srgb, var(--color-foreground) 12%, transparent)",
      ].join(", ");
  const composerBlur = light ? "blur(8px) saturate(102%)" : "none";
  // COMPOSER_CHROME：--ds-immersive-composer-solid
  // 深色 = panel-2 混 12% muted；浅色 = panel/.74。
  const composerBg = light
    ? panel(0.74)
    : `color-mix(in srgb, var(--color-background-alt) 88%, var(--color-foreground-subtle) 12%)`;

  // Codex 的沉浸式有**两套值**，靠 `[role="main"]`（首页）分流：
  //   首页   --ds-immersive-*        侧栏 panel/.46→bg/.40，主区 bg/.40/.26@64%/.16
  //   会话页 --ds-task-immersive-*   侧栏 panel/.70→bg/.82，主区 bg/.82/.74@64%/.60
  // taskMode=full 时会话页也用首页那套（Codex 的 full 分支引用的是 --ds-immersive-*）。
  // XCode 的对应判据是 `[data-ds-part="thread"]`：它只在真有会话内容时挂载
  // （ConversationTimeline 的 rows.length > 0 || totalCount > 0），首页/新任务态没有。
  // 用 :has() 而不是在 applyCustomSkin 里算：皮肤是应用时生成一次 CSS 的，
  // 导航后不会重算，只有让浏览器自己判路由才能两边都盖到。
  const onThread = `html:has(${prefix}[data-ds-part="thread"]) `;
  const offThread = `html:not(:has(${prefix}[data-ds-part="thread"])) `;
  const home = (body: string) => `${offThread}${body}`;
  const task = (body: string) => `${onThread}${body}`;

  // 沉浸式只有一套值——**不分首页/会话页路由**。依据（alpha 拟合，方法见下）：
  //   1. 真机首页（图一）：侧栏 α≈0.707，主区 α≈0.044~0.065（基本全透）；
  //   2. Codex 官方主题模拟器（/themes/ver_* 预览页，用户指定的参照系）：
  //      首页顶部带 α≈0.04~0.11、会话页顶部带 α≈0.05~0.06（深色皮肤干净样本），
  //      与真机首页一致，且会话页同样没有厚渐变；
  //   3. repo 的 dream-skin.css 写的首页 (.44→.28→.14)、会话页 (.82→.74→.60)
  //      两套渐变与以上两个参照都不符（客户端版本漂移），照抄会让主区发奶
  //      （XCode 曾实测 0.30~0.43，模拟器/真机只有 0.05 左右）。
  // 方法：原图按 cover+focus 映射进截图（模板匹配验证偏移误差 <0.1px），
  // 逐带最小二乘解 rendered = α·tint + (1−α)·raw，残差 >18 剔 UI 像素取中位数。
  // 可读性不靠蒙层靠投影：会话页正文 text-shadow、首页问候语投影（见下方路由门控规则）。
  const [sbL, sbR] = light ? [0.72, 0.68] : [0.70, 0.64];
  const sbGrad = `linear-gradient(90deg, ${panel(sbL)}, ${bg(sbR)})`;
  // 主区只留极薄一层（深色壳稍厚一点压住亮图噪点）
  const mainGrad = `linear-gradient(90deg, ${bg(light ? 0.06 : 0.10)}, ${bg(light ? 0.04 : 0.06)})`;

  // 关键：必须显式设 background-color: transparent !important。
  // Codex 用 background: 简写声明渐变，天然重置了 background-color；
  // XCode 单独写 background-image 时，底层由 buildDreamSkinPartBaseRules
  // 给 sidebar 垫的 50% 实色会在渐变底下重复上色，导致实测不透明度高达 87%（发白发奶）。
  // 这里清掉 background-color，只留单层渐变，通透度瞬间与 Codex 完全对齐。
  const sidebarRule = (sb: string, scope: (b: string) => string) =>
    `${scope(sel("sidebar"))} { background-color: transparent !important; background-image: ${sb} !important; ${flat} backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`;
  // HEADER_TINT 在沉浸式下全透明、去边框去 blur。会话页另按 Codex 给标题文字和
  // 图标加投影——header 直接压在图上，没有投影时白字遇亮图会糊。
  const headerRule = (scope: (b: string) => string, withTextShadow: boolean) => {
    const shadow = withTextShadow
      ? ` color: var(--color-foreground) !important; text-shadow: 0 1px 2px ${veil(0.86)}, 0 0 8px ${veil(0.52)} !important;`
      : "";
    return [
      `${scope(sel("header"))} { background-color: transparent !important; background-image: none !important; ${flat}${shadow} backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`,
      ...(withTextShadow
        ? [
            `${scope(sel("header"))} svg { color: ${muted(0.96)} !important; filter: drop-shadow(0 1px 2px ${veil(0.72)}); }`,
          ]
        : []),
    ];
  };
  const mainRule = (mn: string, scope: (b: string) => string) =>
    `${scope(sel("main"))} { background-color: transparent !important; background-image: ${mn} !important; background-repeat: no-repeat !important; background-size: 100% 100% !important; background-position: center !important; ${flat} }`;
  const composerRule = (scope: (b: string) => string) =>
    // COMPOSER_CHROME 用 background 简写（连带清掉 background-image）——主题常给
    // composer 写 linear-gradient 蒙层，只改 background-color 的话那层渐变仍浮在
    // 实色上面，把 Codex 的纯色面板又变成半透明渐变。
    `${scope(sel("composer"))} { background-color: ${composerBg} !important; background-image: none !important; border: 0 !important; box-shadow: ${composerShadow} !important; backdrop-filter: ${composerBlur} !important; -webkit-backdrop-filter: ${composerBlur} !important; }`;

  const rules: string[] = [];
  if (options.taskMode === "off") return rules;

  // 会话页正文投影：Codex 只给会话页的 markdown 加（首页的 hero 另有一套更淡的）。
  // 挂在 [data-conversation-selectable] 上——XCode 的 assistant 正文就是包在这一层
  // 里的（ConversationRowView），工坊预览的 mock 也挂同一层，两边一致。
  const mdShadow = light
    ? `0 1px 2px ${panel(0.92)}, 0 0 10px ${panel(0.72)}`
    : `0 1px 2px ${veil(0.82)}, 0 0 10px ${veil(0.58)}`;

  // 首页推荐按钮：Codex 给 panel/.56 + 8px blur + 1px 内环。XCode 的对应物是
  // [data-draft-suggested-prompt]，引擎另有一条 background@90% 的兜底规则——
  // 这里同优先级后写者赢，沉浸式下以 Codex 的值为准。
  const suggestionRule = `${home(`${prefix}[data-draft-suggested-prompt]`)} { background-color: ${panel(0.56)} !important; box-shadow: 0 8px 22px ${veil(0.16)}, inset 0 0 0 1px ${muted(0.2)} !important; backdrop-filter: blur(8px) saturate(104%) !important; -webkit-backdrop-filter: blur(8px) saturate(104%) !important; }`;

  // 四个面不再分路由：真机与模拟器的实测都表明首页/会话页共用同一层薄 veil
  // （路由差异只存在于文字投影与推荐按钮这些内容级规则里）。
  rules.push(
    sidebarRule(sbGrad, (b) => b),
    mainRule(mainGrad, (b) => b),
    ...headerRule((b) => b, true),
    composerRule((b) => b),
    suggestionRule,
    // Codex 给首页 [role="main"] 的正文投影，XCode 等价物是问候语
    // （ConversationDraftEmptyState 的 data-v4-draft-greeting）。
    `${home(`${prefix}[data-v4-draft-greeting="true"]`)} { text-shadow: 0 1px 2px ${veil(0.72)}, 0 0 10px ${veil(0.46)} !important; }`,
    `${task(`${prefix}[data-conversation-selectable="true"]`)} { text-shadow: ${mdShadow} !important; }`,
  );
  return rules;
}

/**
 * 把 Safe CSS 限制在预览根内：选择器统一加 scope 前缀。
 * `[data-ds-part="root"]` 特判成 scope 本身——预览根就是 root 的载体，
 * 加前缀会变成"后代匹配"而永远不命中自己。
 */
export function scopeDreamSkinCss(css: string, scope: string): string {
  return css.replace(CSS_BLOCK_RE, (_match, selector: string, body: string) => {
    const selectors = selector
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => (part === '[data-ds-part="root"]' ? scope : `${scope} ${part}`));
    if (selectors.length === 0) return "";
    return `${selectors.join(", ")} { ${body.trim()} }`;
  });
}

/** 皮肤里是否有任何 Safe CSS 规则（工坊据此决定是否显示 CSS 面板提示）。 */
export function hasDreamSkinCss(skin: CustomSkinSettings | null | undefined): boolean {
  return Boolean(skin?.safeCss?.trim());
}
