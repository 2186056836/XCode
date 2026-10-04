/* oxlint-disable eslint(max-lines) -- 皮肤工坊是单块紧耦合编辑器：草稿状态、实时预览、
   白名单 lint、草稿恢复都围绕同一份 draft，拆分会把"改一个字段要同步三处"的问题放大。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import appLogoUrl from "@/assets/X.svg";
import {
  ArrowUp,
  Blocks,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock,
  Code,
  Ellipsis,
  Folder,
  FolderInputIcon,
  Hash,
  PanelLeftClose,
  PanelRightOpen,
  Plus,
  Redo2Icon,
  RotateCcwIcon,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  SquareTerminal,
  Trash2Icon,
  Undo2Icon,
  User,
} from "lucide-react";
import {
  DEFAULT_SKIN_IMAGE,
  DEFAULT_SKIN_SURFACE,
  MAX_SKIN_BACKGROUND_IMAGE_CHARS,
  MAX_SKIN_SAFE_CSS_CHARS,
  type CustomSkinSettings,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import { applyCustomSkin, buildSkinTokenValues } from "@/useTheme.js";
import { cn } from "@/components/lib/utils.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";
import {
  readSkinLibrary,
  resolveLibraryEntryName,
  SKIN_PRESETS,
  writeSkinLibrary,
  type SkinLibrary,
} from "@/settings/skin-library.js";
import { convertDreamSkinTheme, DreamSkinImportError } from "@/settings/dreamskin-import.js";
import { unzipDreamSkinTheme } from "@/settings/dreamskin-unzip.js";
import {
  buildDreamSkinImmersiveRules,
  buildDreamSkinPartBaseRules,
  buildDreamSkinVariables,
  scopeDreamSkinCss,
  translateDreamSkinCss,
} from "@/settings/dreamskin-parts.js";
import { lintSkinSafeCss, type SafeCssIssue } from "@/settings/dreamskin-safe-css.js";

/**
 * 皮肤工坊（Skin Studio）。
 *
 * 参考 Codex DreamSkin Studio 的信息架构（身份 → 调色板 → 资产 → 构图 → 表面 →
 * 高级 CSS → 校验），但预览区不用 Codex 的 mock DOM，而是用 XCode 自己的语义类
 * （bg-panel / bg-card / bg-surface / bg-input / text-foreground）搭缩略 UI——
 * 皮肤引擎覆盖的是 :root 上的 --color-* token，所以预览和真实界面走同一套变量，
 * 预览即所见。另给"应用到整个窗口"开关做全保真预览。
 *
 * 草稿自动落 localStorage，异常关闭后可恢复；undo/redo 基于快照栈。
 */

const DRAFT_STORAGE_KEY = "xcode-skin-studio-draft";

/** 草稿 = 皮肤设置的可变副本（base 必填，其余全部可选）。 */
type SkinDraft = CustomSkinSettings;

interface ColorFieldSpec {
  field: string;
  labelId: string;
}

/** 调色板字段顺序：先表面后文字再点缀，和 Codex Studio 的 palette 分区一致。 */
const PALETTE_FIELDS: readonly ColorFieldSpec[] = [
  { field: "background", labelId: "settings.skin.field.background" },
  // 备选背景（多窗口/非活动窗口的底色）：旧自定义对话框暴露过，重写成工坊时漏掉会静默丢能力
  { field: "backgroundWinAlt", labelId: "settings.skin.field.backgroundWinAlt" },
  { field: "panel", labelId: "settings.skin.field.panel" },
  { field: "panelAlt", labelId: "settings.skin.field.panelAlt" },
  { field: "card", labelId: "settings.skin.field.card" },
  { field: "surface", labelId: "settings.skin.field.surface" },
  { field: "sidebar", labelId: "settings.skin.field.sidebar" },
  { field: "input", labelId: "settings.skin.field.input" },
  { field: "popover", labelId: "settings.skin.field.popover" },
  { field: "border", labelId: "settings.skin.field.border" },
  { field: "line", labelId: "settings.skin.field.line" },
  { field: "text", labelId: "settings.skin.field.text" },
  { field: "muted", labelId: "settings.skin.field.muted" },
  { field: "accent", labelId: "settings.skin.field.accent" },
  { field: "accentAlt", labelId: "settings.skin.field.accentAlt" },
  { field: "secondary", labelId: "settings.skin.field.secondary" },
  { field: "highlight", labelId: "settings.skin.field.highlight" },
  { field: "brand", labelId: "settings.skin.field.brand" },
] as const;

const SURFACE_SLIDERS: readonly {
  key: keyof typeof DEFAULT_SKIN_SURFACE;
  labelId: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}[] = [
  { key: "opacity", labelId: "settings.skin.surface.opacity", min: 0, max: 100, step: 1, unit: "%" },
  { key: "blur", labelId: "settings.skin.surface.blur", min: 0, max: 40, step: 1, unit: "px" },
  { key: "radius", labelId: "settings.skin.surface.radius", min: 0, max: 24, step: 1, unit: "px" },
  { key: "borderAlpha", labelId: "settings.skin.surface.borderAlpha", min: 0, max: 100, step: 1, unit: "%" },
  { key: "shadow", labelId: "settings.skin.surface.shadow", min: 0, max: 100, step: 1, unit: "%" },
];

const IMAGE_SLIDERS: readonly {
  key: "zoom" | "dim";
  labelId: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}[] = [
  { key: "zoom", labelId: "settings.skin.image.zoom", min: 1, max: 3, step: 0.1, unit: "×" },
  { key: "dim", labelId: "settings.skin.image.dim", min: 0, max: 80, step: 1, unit: "%" },
];

// ── 颜色工具 ────────────────────────────────────────────────

/** 解析 #rgb/#rrggbb/#rrggbbaa 或 rgb()/rgba() 为 0-255 三元组；失败返回 null。 */
function parseColor(value: string): [number, number, number] | null {
  const text = value.trim();
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(text);
  if (hex?.[1]) {
    const h = hex[1];
    // 用 slice 而非下标：noUncheckedIndexedAccess 下 string 索引是 string|undefined，
    // 而 slice 的返回类型恒为 string，长度已由上面的正则保证。
    if (h.length === 3 || h.length === 4) {
      return [
        parseInt(h.slice(0, 1).repeat(2), 16),
        parseInt(h.slice(1, 2).repeat(2), 16),
        parseInt(h.slice(2, 3).repeat(2), 16),
      ];
    }
    if (h.length === 6 || h.length === 8) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

/** WCAG 相对亮度。 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度（1-21）。任一端解析失败返回 null（无法判定）。 */
export function skinContrastRatio(a: string, b: string): number | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 取色器需要的 #rrggbb；rgba() 丢掉 alpha（取色器不表达透明度）。 */
function toPickerValue(value: string | undefined): string {
  const parsed = parseColor(value ?? "");
  if (!parsed) return "#000000";
  return `#${parsed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// ── 预览背景层（与引擎同一套层叠语义） ──────────────────────────

function previewBackgroundLayers(draft: SkinDraft): string | undefined {
  if (!draft.backgroundImage) return undefined;
  const dim = draft.image?.dim ?? DEFAULT_SKIN_IMAGE.dim;
  const safeArea = draft.image?.safeArea ?? DEFAULT_SKIN_IMAGE.safeArea;
  const layers: string[] = [];
  if (dim > 0) {
    layers.push(`linear-gradient(rgba(0,0,0,${(dim / 100).toFixed(3)}), rgba(0,0,0,${(dim / 100).toFixed(3)}))`);
  }
  if (safeArea === "left") {
    layers.push("linear-gradient(to right, rgba(0,0,0,0.55), rgba(0,0,0,0) 32%)");
  } else if (safeArea === "right") {
    layers.push("linear-gradient(to left, rgba(0,0,0,0.55), rgba(0,0,0,0) 32%)");
  }
  layers.push(`url(${draft.backgroundImage})`);
  return layers.join(", ");
}

// ── 小组件 ─────────────────────────────────────────────────

function Section({
  eyebrow,
  title,
  hint,
  trailing,
  children,
  defaultOpen = true,
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
  /** 分区头右侧的附属操作（重置等）。放在折叠按钮外层，避免按钮嵌套按钮。 */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="min-w-0">
            {eyebrow ? (
              <span className="block truncate text-ui-xs text-foreground-subtle">{eyebrow}</span>
            ) : null}
            <span className="block truncate text-ui-base font-medium text-foreground">{title}</span>
          </span>
          <span className="shrink-0 text-ui-sm text-foreground-subtle">{open ? "▾" : "▸"}</span>
        </button>
        {trailing ? <span className="shrink-0">{trailing}</span> : null}
      </div>
      {open ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {hint ? <p className="text-ui-sm text-foreground-subtle">{hint}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 检查器 tab 条：对齐参考版右栏顶部的 设计/CSS/theme.json/导出。
 * 键盘导航沿用参考版的左右方向键 + Home/End。
 */
const INSPECTOR_TABS = ["design", "surface", "css", "checks"] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number];

function InspectorTabs({
  active,
  onChange,
}: {
  active: InspectorTab;
  onChange: (tab: InspectorTab) => void;
}) {
  const { intl } = useXCodeIntl();
  const tabRefs = useRef<Partial<Record<InspectorTab, HTMLButtonElement | null>>>({});

  const focusTab = (tab: InspectorTab) => {
    onChange(tab);
    tabRefs.current[tab]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={intl.formatMessage({ id: "settings.skin.studio.title" })}
      className="flex shrink-0 gap-1 border-b border-border px-2"
    >
      {INSPECTOR_TABS.map((tab) => {
        const selected = active === tab;
        return (
          <button
            key={tab}
            ref={(element) => {
              tabRefs.current[tab] = element;
            }}
            type="button"
            role="tab"
            id={`skin-studio-${tab}-tab`}
            aria-selected={selected}
            aria-controls={`skin-studio-${tab}-panel`}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "-mb-px border-b-2 px-2.5 py-2 text-ui-base font-medium transition-colors",
              selected
                ? "border-primary text-foreground"
                : "border-transparent text-foreground-subtle hover:text-foreground",
            )}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => {
              const index = INSPECTOR_TABS.indexOf(active);
              if (event.key === "ArrowRight") {
                event.preventDefault();
                focusTab(INSPECTOR_TABS[(index + 1) % INSPECTOR_TABS.length] as InspectorTab);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusTab(
                  INSPECTOR_TABS[(index - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length] as InspectorTab,
                );
              } else if (event.key === "Home") {
                event.preventDefault();
                focusTab(INSPECTOR_TABS[0] as InspectorTab);
              } else if (event.key === "End") {
                event.preventDefault();
                focusTab(INSPECTOR_TABS[INSPECTOR_TABS.length - 1] as InspectorTab);
              }
            }}
          >
            {intl.formatMessage({ id: `settings.skin.studio.tab.${tab}` })}
          </button>
        );
      })}
    </div>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-ui-base">
      <span className="w-28 shrink-0 text-foreground-subtle">{label}</span>
      <input
        type="range"
        className="h-1.5 min-w-0 flex-1 accent-[var(--color-accent)]"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-16 shrink-0 text-right text-ui-sm text-foreground tabular-nums">
        {step < 1 ? value.toFixed(1) : value}
        {unit}
      </span>
    </label>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-ui-base text-foreground-subtle">{label}</span>
      <input
        type="color"
        aria-label={label}
        className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        value={toPickerValue(value)}
        onChange={(event) => onChange(event.target.value)}
      />
      <Input
        value={value ?? ""}
        placeholder="—"
        className="h-7 min-w-0 flex-1 text-ui-sm"
        onChange={(event) => {
          const next = event.target.value.trim();
          onChange(next ? next : undefined);
        }}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onChange(undefined)}
          aria-label={`${label} clear`}
        >
          ✕
        </Button>
      ) : null}
    </div>
  );
}

// ── XCode 样式预览 ─────────────────────────────────────────

/**
 * 预览按真实渲染代码 1:1 搭，类名逐条从这几处抄：
 *   WorkspaceSidebar.tsx                                  —— 侧栏（拖拽区/导航/页签/任务列表）
 *   WorkspaceSidebarFooter.tsx                            —— 侧栏底栏（头像 + 设置）
 *   WorkspaceHeader.tsx + WorkspaceHeaderSections.tsx     —— 顶栏
 *   ChatPromptEditor.tsx + V4ComposerModeControls.tsx     —— composer
 * 预览是同一套类的缩小容器，所以皮肤 token 与真实界面同源、比例一致。
 *
 * 抄代码时对上的几个反直觉点（都核过源码，不靠截图猜）：
 *   - 顶栏没有背景类：透明 + h-12 + border-b border-border/50 + p-2。
 *     bg-header 只有 ResourceManager 用，workspace 顶栏不用
 *   - 侧栏拖拽区是 h-12（48px），不是一小条
 *   - 「自动化」图标是 CalendarClock；Cloud 那条（远程连接）在源码里是注释掉的
 *   - 导航选中态是 bg-selected，hover 才是 bg-surface-hover，两者是不同的 token
 *   - 用户气泡带 border border-border 和 rounded-tr-sm
 */
const PREVIEW_NAV: { key: string; icon: typeof Plus; shortcut?: string }[] = [
  { key: "newTask", icon: Plus },
  { key: "search", icon: Search, shortcut: "Ctrl+K" },
  { key: "automation", icon: CalendarClock },
  { key: "market", icon: Blocks },
];

function SkinPreview({
  draft,
  className,
}: {
  draft: SkinDraft;
  className?: string;
}) {
  const { intl } = useXCodeIntl();
  // 预览可交互：侧栏导航/页签/任务项可点（看选中态），composer 是真输入框
  // （可打字、可聚焦）。hover/focus 直接用真实组件的类，鼠标过去就生效——
  // 皮肤在这些态上的 token（surface-hover / input-border-hover / input-border-focused）
  // 只有真交互才看得到，静态预览会把它们全藏了。
  const [selectedNav, setSelectedNav] = useState("newTask");
  const [activeTab, setActiveTab] = useState<"group" | "project">("group");
  // 预览默认主页（问候语+推荐按钮那屏），点侧栏任务项切到会话页：
  // 两条路由的沉浸式值差别很大（首页 panel/.46→bg/.40，会话页 panel/.70→bg/.82），
  // 默认停在任务页会让用户以为预览就是任务页的效果。
  const [selectedTask, setSelectedTask] = useState(false);
  const [composerText, setComposerText] = useState("");
  const bg = previewBackgroundLayers(draft);
  const zoom = draft.image?.zoom ?? DEFAULT_SKIN_IMAGE.zoom;
  const focusX = draft.backgroundFocusX != null ? Math.round(draft.backgroundFocusX * 100) : 50;
  const focusY = draft.backgroundFocusY != null ? Math.round(draft.backgroundFocusY * 100) : 50;
  const surface = draft.surface;
  const radius = surface?.radius;
  const borderAlpha = surface?.borderAlpha;
  const blur = surface?.blur;
  const shadow = surface?.shadow;
  const surfaceStyle: React.CSSProperties = {
    ...(radius != null ? { borderRadius: `${radius}px` } : {}),
    ...(borderAlpha != null
      ? { borderColor: `color-mix(in srgb, var(--color-border) ${borderAlpha}%, transparent)` }
      : {}),
    ...(shadow != null && shadow > 0
      ? {
          boxShadow: `0 1px 2px rgba(0,0,0,${((shadow / 100) * 0.35).toFixed(3)}), 0 6px 16px rgba(0,0,0,${((shadow / 100) * 0.56).toFixed(3)})`,
        }
      : {}),
    ...(blur != null && blur > 0 ? { backdropFilter: `blur(${blur}px)` } : {}),
  };
  const t = (id: string) => intl.formatMessage({ id });
  // 预览自带 token 作用域：底座主题类（.theme-zai-* 是纯类选择器，挂哪儿就在哪儿生效）
  // 加覆盖值全部内联到预览容器上。这样只有预览跟着皮肤变，工坊自己的 tab/分区/按钮
  // 仍用应用真实主题——之前预览靠全局 :root，载入皮肤会把工坊界面一起染色，
  //  wild 主题下连编辑器都没法用。
  const skinTokens = buildSkinTokenValues(draft);
  const skinTokenStyle: Record<string, string> = {};
  for (const [token, value] of skinTokens) skinTokenStyle[token] = value;
  // --ds-theme-* 与语义 token 同一处注入：DreamSkin Safe CSS 用 var() 引用它们，
  // 缺一个就少一个面（background-color 的 var() 失效会整块变透明）。
  for (const [name, value] of Object.entries(buildDreamSkinVariables(draft))) {
    skinTokenStyle[name] = value;
  }
  // 预览内的样式层，顺序与真实引擎逐条对应（useTheme.applyCustomSkin）：
  //   1) 各 part 的"客户端底座"（Codex 主题层是叠在底座上的，不是替换）
  //   2) 背景图图层（挂在 main 上，位于 main 自身底色之上）
  //   3) DreamSkin Safe CSS（主题层，以背景图层形式叠在底座之上）
  // 两边共用 buildDreamSkinPartBaseRules / translateDreamSkinCss，所以预览算出来的和
  // 真实生效的逐条一致；作用域靠 previewScope 前缀，不会溢出到工坊界面。
  const previewScope = '[data-skin-studio-preview="true"]';
  const previewRules: string[] = [];
  const dreamSkinCss = draft.safeCss?.trim() ?? "";
  if (dreamSkinCss) {
    const sidebarOpacity = surface?.opacity ?? DEFAULT_SKIN_SURFACE.opacity;
    previewRules.push(...buildDreamSkinPartBaseRules(`${previewScope} `, { sidebarOpacity }));
  }
  // 背景图统一铺满整窗（html 固定附着），由 useTheme 的 html 规则负责——预览容器
  // 自身的 style 里的 backgroundImage（previewBackgroundLayers）就是这一层。
  if (dreamSkinCss) {
    previewRules.push(scopeDreamSkinCss(translateDreamSkinCss(dreamSkinCss), previewScope));
  }
  // 沉浸式四件套与 useTheme.applyCustomSkin 同源同序同值（侧栏磨砂渐变 / header 全透明 /
  // composer 实色 / main 薄 veil），对所有有图的皮肤生效，排在 theme.css 之后才能盖过
  // 主题给 sidebar 写的实色。
  if (draft.backgroundImage) {
    previewRules.push(
      ...buildDreamSkinImmersiveRules(`${previewScope} `, {
        base: draft.base,
        taskMode: draft.image?.taskIntensity ?? DEFAULT_SKIN_IMAGE.taskIntensity,
      }),
    );
  }
  // 与 useTheme.applyCustomSkin 同序同值：thread 的 backdrop-filter 剥掉，
  // 否则主题写的 blur 会把预览里的背景图糊掉（预览和真实界面必须一致）。
  if (draft.backgroundImage) {
    previewRules.push(
      `${previewScope} [data-ds-part="thread"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`,
    );
  }
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-background",
        draft.base === "zai-dark" ? "dark theme-zai-dark" : "theme-zai-light",
        className,
      )}
      style={{
        ...skinTokenStyle,
        ...(bg
          ? {
              backgroundImage: bg,
              backgroundSize: zoom > 1 ? `${Math.round(zoom * 100)}% auto` : "cover",
              backgroundPosition: `${focusX}% ${focusY}%`,
              backgroundRepeat: "no-repeat",
            }
          : {}),
      }}
      data-skin-studio-preview="true"
      data-ds-part="root"
    >
      {/* 预览内的皮肤规则：与引擎同源，只作用于本预览容器。 */}
      <style>{previewRules.join("\n")}</style>
      <div className="flex h-full min-h-[26rem]">
        {/* ── 侧栏：WorkspaceSidebar ── */}
        <div className="flex w-[22%] min-w-0 flex-col bg-panel" data-ds-part="sidebar">
          {/* 拖拽区：WorkspaceSidebar 里是一根空的 h-12；左上角那个 X 标识不在侧栏内，
           // 是 DesktopTopOverlay 的侧栏切换按钮（app-logo size-5，hover 换成侧栏图标）。 */}
          <div className="flex h-12 shrink-0 items-center px-2.5">
            <span className="group relative grid size-5 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-md">
              <img
                src={appLogoUrl}
                alt="XCode"
                className="size-5 transition-opacity duration-150 group-hover:opacity-0"
                draggable={false}
              />
              <PanelLeftClose className="absolute size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
            </span>
          </div>
          <div className="flex shrink-0 flex-col gap-1 px-2 py-2">
            {PREVIEW_NAV.map(({ key, icon: Icon, shortcut }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelectedNav(key);
                  if (key === "newTask") setSelectedTask(false);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 py-1.5 text-ui-sm transition-colors",
                  selectedNav === key
                    ? "bg-selected text-foreground"
                    : "text-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {t(`settings.skin.preview.nav.${key}`)}
                </span>
                {shortcut ? (
                  <span className="ml-auto shrink-0 text-ui-xs font-normal text-foreground-subtlest">
                    {shortcut}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {/* 分组/项目页签：TabsList 是 rounded-full bg-surface，指示块是 bg-background */}
          <div className="shrink-0 pl-2.5 pr-3">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 shrink-0 items-center gap-1">
                <div className="relative flex h-7 w-fit shrink-0 items-center overflow-hidden rounded-full bg-surface p-0.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full bg-background transition-all",
                      activeTab === "group" ? "w-14" : "w-12",
                    )}
                    style={activeTab === "project" ? { transform: "translateX(100%)" } : undefined}
                  />
                  {(["group", "project"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "relative z-10 flex h-6 flex-none items-center gap-1 rounded-full py-0 pl-1.5 pr-2 text-ui-sm font-medium transition-colors",
                        activeTab === tab
                          ? "text-foreground"
                          : "text-foreground-subtle hover:text-foreground",
                      )}
                    >
                      {tab === "group" ? (
                        <Hash className="size-3 shrink-0" />
                      ) : (
                        <Folder className="size-3 shrink-0" />
                      )}
                      <span>{t(`settings.skin.preview.tab.${tab}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* 任务列表 */}
          <div
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pt-2"
            data-ds-part="project-list"
          >
            <button
              type="button"
              onClick={() => setSelectedTask(true)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                selectedTask ? "bg-selected" : "hover:bg-surface-hover",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
                {t("settings.skin.preview.taskItem")}
              </span>
              <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                {t("settings.skin.preview.taskTime")}
              </span>
            </button>
          </div>
          {/* 底栏：WorkspaceSidebarFooter */}
          <footer className="flex shrink-0 flex-col gap-2.5 px-4 pt-2 pb-4">
            <div className="flex min-w-0 gap-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-foreground">
                  <User className="size-4" />
                </span>
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate text-ui-sm font-semibold text-foreground">
                    {t("settings.skin.preview.connector")}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                  <Smartphone className="size-4" />
                </span>
                <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                  <Settings className="size-4" />
                </span>
              </span>
            </div>
          </footer>
        </div>

        {/* ── 主区 ── */}
        <div className="flex min-w-0 flex-1 flex-col" data-ds-part="main">
          {/* 顶栏：WorkspaceHeader —— 无背景类，h-12 + border-b border-border/50 + p-2 */}
          <header className="flex h-12 w-full shrink-0 border-b border-border/50" data-ds-part="header">
            <div className="flex h-12 min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden p-2">
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <span className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                  <Folder className="size-4" />
                </span>
                <h1 className="flex min-w-12 shrink items-center gap-2 truncate text-ui-sm font-semibold text-foreground">
                  <span className="min-w-0 truncate">{t("settings.skin.preview.taskTitle")}</span>
                </h1>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                    <Ellipsis className="size-4" />
                  </span>
                </span>
              </div>
              {/* 右侧动作区：编辑器组 + 帮助 + 终端 + 侧栏开关 */}
              <div className="flex shrink-0 items-center gap-0.5">
                <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                  <Code className="size-4" />
                </span>
                <span className="grid w-5 shrink-0 cursor-pointer place-items-center text-foreground-subtlest">
                  <ChevronDown className="size-3.5" />
                </span>
                <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                  <CircleHelp className="size-4" />
                </span>
                <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                  <SquareTerminal className="size-4" />
                </span>
                <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                  <PanelRightOpen className="size-4" />
                </span>
              </div>
            </div>
          </header>
          {/* 路由预览：默认主页（问候语），点侧栏「你好」任务项切会话页。
              沉浸式两套值靠 [data-ds-part="thread"] 的 :has() 分流，所以只能在
              会话页挂 thread 挂点、主页不挂——这样预览和真实界面各自 computed 值才对。 */}
          {selectedTask ? (
            <div
              className="@container/conversation flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
              data-ds-part="thread"
            >
              {/* 用户行：ConversationRowView 的 RowShell 是 flex flex-col items-end——
                  items-end 才让气泡收缩到内容宽并右对齐，少了这层会 stretch 撑满整行。 */}
              <div className="flex flex-col items-end">
                <div
                  className="flex max-w-full flex-col gap-2 rounded-xl rounded-tr-xs border border-border bg-surface px-4 py-3 text-ui-sm text-foreground @min-[624px]/conversation:max-w-xl"
                  style={surfaceStyle}
                  data-ds-part="message"
                >
                  {t("settings.skin.preview.userMessage")}
                </div>
              </div>
              {/* turn 头：TurnHeaderRowView —— border-b + 右侧最后活动 */}
              <div className="-mx-4 flex items-center justify-between gap-2 border-b border-border py-1 pr-4 pl-4 text-ui-sm text-foreground-subtle">
                <span className="flex min-w-0 items-center gap-2">
                  <Clock className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{t("settings.skin.preview.worked")}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0" />
              </div>
              {/* assistant 正文：真实实现是 ConversationRowView 里包住 MessageResponse 的
                  [data-conversation-selectable="true"] 那层。沉浸式的正文投影规则挂在
                  这个属性上，预览不挂就等于预览少一条效果——两边必须一致。 */}
              <span
                className="max-w-[85%] text-ui-sm leading-relaxed text-foreground"
                data-conversation-selectable="true"
              >
                {t("settings.skin.preview.assistantMessage")}
              </span>
            </div>
          ) : (
            /* 主页：ConversationDraftEmptyState 的问候语 + 项目选择器。
               data-v4-draft-greeting 是沉浸式首页正文投影的挂点，真实组件同名同义。 */
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-2">
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8">
                <p
                  data-v4-draft-greeting="true"
                  className="relative z-10 w-full max-w-2xl px-4 text-center text-3xl font-medium leading-[1.2] text-foreground"
                >
                  {t("chat.empty.greeting.evening")}
                </p>
              </div>
            </div>
          )}
          {/* composer：ChatPromptEditor 外壳 + 工具栏 */}
          <div className="shrink-0 p-4 pt-0">
            <div
              className={cn(
                "relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-input-border bg-input p-3 transition-colors",
                "hover:border-input-border-hover focus-within:border-input-border-focused focus-within:bg-input-focused",
              )}
              style={surfaceStyle}
              data-ds-part="composer"
            >
              {/* 主页的项目选择器：真实实现是 composer 顶部的一行下拉 */}
              {!selectedTask ? (
                <button
                  type="button"
                  className="flex w-fit cursor-pointer items-center gap-1 rounded-lg text-ui-sm text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <ChevronDown className="size-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{t("settings.skin.preview.homeProject")}</span>
                </button>
              ) : null}
              <input
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
                placeholder={
                  selectedTask
                    ? t("settings.skin.preview.composer")
                    : t("chat.placeholder.newTask")
                }
                spellCheck={false}
                className="min-w-0 bg-transparent text-ui-sm text-foreground outline-none placeholder:text-foreground-subtlest"
              />
              <div className="flex items-end gap-3" data-ds-part="composer-toolbar">
                <div className="flex min-w-0 flex-1 items-center">
                  <div className="flex shrink-0 items-center gap-1">
                    {/* + 附件菜单：ChatPromptActionMenu */}
                    <span className="grid size-8 cursor-pointer place-items-center rounded-lg text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                      <Plus className="size-4" />
                    </span>
                    {/* 模式切换：V4ComposerModeSwitch */}
                    <span className="flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-ui-sm text-foreground transition-colors hover:bg-surface-hover">
                      <ShieldCheck className="size-4 shrink-0" />
                      <span className="whitespace-nowrap">
                        {t("settings.skin.preview.fullAccess")}
                      </span>
                      <ChevronDown className="size-3.5 shrink-0" />
                    </span>
                  </div>
                </div>
                {/* 提交控制：模型选择 + 发送 */}
                <div className="flex min-w-0 items-center gap-1">
                  <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
                    <span className="flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg px-2 text-ui-sm text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                      <span className="min-w-0 truncate">{t("settings.skin.preview.model")}</span>
                      <ChevronDown className="size-3.5 shrink-0" />
                    </span>
                    <span className="flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg px-2 text-ui-sm text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground">
                      {t("settings.skin.preview.thinking")}
                      <ChevronDown className="size-3.5 shrink-0" />
                    </span>
                  </span>
                  <span className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg bg-brand text-foreground-inverse transition-opacity hover:opacity-80">
                    <ArrowUp className="size-4" />
                  </span>
                </div>
              </div>
            </div>
            {/* 主页推荐操作：真实实现是 ConversationDraftSuggestedPromptsContainer 的
                data-ds-part="home" 槽（h-8 那层）包着 4 颗 data-draft-suggested-prompt
                按钮。沉浸式的推荐按钮规则（panel/.56 + blur(8px)）挂在这两个挂点上。 */}
            {!selectedTask ? (
              <div
                data-ds-part="home"
                data-v4-draft-suggested-prompts-slot="true"
                className="h-8"
              >
                <div className="flex h-full items-center justify-center gap-2">
                  {(["summary", "fix", "ppt", "idle"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      data-draft-suggested-prompt="true"
                      className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1 text-ui-sm text-foreground transition-colors hover:bg-surface-hover"
                    >
                      <span className="min-w-0 whitespace-nowrap">
                        {t(`settings.skin.preview.suggest.${key}`)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ─────────────────────────────────────────────────

export function SkinStudio({
  open,
  onOpenChange,
  initialSkin,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSkin: CustomSkinSettings | null;
  onSave: (skin: CustomSkinSettings | null) => Promise<void> | void;
}) {
  const { intl } = useXCodeIntl();
  const [draft, setDraft] = useState<SkinDraft>(initialSkin ?? { base: "zai-light" });
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("design");
  const [saving, setSaving] = useState(false);
  // "应用到整个窗口" 已移除：预览即所见，工坊界面不再把草稿刷到全局。
  // 预览容器自带 token 作用域，工坊自己的界面也不跟皮肤变。
  const [recovered, setRecovered] = useState<SkinDraft | null>(null);
  const [safeCssIssues, setSafeCssIssues] = useState<SafeCssIssue[]>([]);
  const [skinLibrary, setSkinLibrary] = useState<SkinLibrary>(readSkinLibrary);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const undoStack = useRef<SkinDraft[]>([]);
  const redoStack = useRef<SkinDraft[]>([]);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });

  const t = useCallback(
    (id: string) => intl.formatMessage({ id }),
    [intl],
  );

  // 打开时载入当前皮肤；若有未保存草稿则提示恢复。
  // 每次打开会话只初始化一次：initialSkin 由 useSettings 派生，父组件重渲染就会换引用，
  // 若跟着重置草稿，一来会冲掉用户正在编辑的内容，二来会把刚自动存下的草稿当成
  // "未保存草稿"反复弹恢复横幅。唯一例外是首帧还没拿到皮肤（null），
  // 等皮肤到位后补一次初始化。
  // 但"补一次"也必须看草稿有没有被动过：设置快照迟到、或另一个窗口同步皮肤，
  // initialSkin 都会从 null 变成有值。此时若用户已经导入了主题包/改了字段，
  // 再补初始化就会把刚导进来的东西整份冲掉（导入的 10 色 + safeCss 全部回退成
  // 已保存皮肤）。所以补初始化的前提是草稿仍与上次初始化的值逐字节相同。
  const studioInitRef = useRef({ done: false, hadSkin: false });
  const lastInitDraftRef = useRef<SkinDraft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!open) {
      studioInitRef.current = { done: false, hadSkin: false };
      lastInitDraftRef.current = null;
      return;
    }
    const hasSkin = initialSkin != null;
    if (studioInitRef.current.done) {
      const untouched =
        lastInitDraftRef.current != null &&
        JSON.stringify(lastInitDraftRef.current) === JSON.stringify(draftRef.current);
      if (!(!studioInitRef.current.hadSkin && hasSkin && untouched)) return;
    }
    const next: SkinDraft = initialSkin ?? { base: "zai-light" };
    studioInitRef.current = { done: true, hadSkin: hasSkin };
    lastInitDraftRef.current = next;
    setDraft(next);
    undoStack.current = [];
    redoStack.current = [];
    setHistoryDepth({ undo: 0, redo: 0 });
    setSafeCssIssues([]);
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SkinDraft;
        if (parsed && typeof parsed === "object" && "base" in parsed) {
          setRecovered(parsed);
        }
      }
    } catch {
      // 草稿损坏按无草稿处理
    }
  }, [open, initialSkin]);

  // 草稿自动保存（防抖 400ms）。
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch {
        // 配额满等场景下静默：不影响编辑
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, open]);

  // 关闭时恢复真实皮肤（草稿只是预览，不能污染已保存状态）。
  useEffect(() => {
    if (open) return;
    // 待恢复提示只对应当前这次关闭：state 不清就会在下次打开时残留上一次的横幅
    // （保存只清了 localStorage，recovered 仍是旧值，用户刚存完就看到"发现未保存的草稿"）。
    // 草稿本身在 localStorage 里，下次打开由上面的初始化 effect 重新读取。
    setRecovered(null);
    applyCustomSkin(initialSkin ?? null);
  }, [open, initialSkin]);

  const commitDraft = useCallback((next: SkinDraft) => {
    setDraft((prev) => {
      undoStack.current.push(prev);
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
      setHistoryDepth({ undo: undoStack.current.length, redo: 0 });
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setDraft((current) => {
      redoStack.current.push(current);
      setHistoryDepth({ undo: undoStack.current.length, redo: redoStack.current.length });
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setDraft((current) => {
      undoStack.current.push(current);
      setHistoryDepth({ undo: undoStack.current.length, redo: redoStack.current.length });
      return next;
    });
  }, []);

  const setOverride = useCallback(
    (field: string, value: string | undefined) => {
      setDraft((prev) => {
        const overrides = { ...(prev.overrides ?? {}) };
        if (value) overrides[field as keyof typeof overrides] = value;
        else delete overrides[field as keyof typeof overrides];
        return {
          ...prev,
          ...(Object.keys(overrides).length > 0 ? { overrides } : { overrides: undefined }),
        };
      });
    },
    [],
  );

  const setSurface = useCallback((key: string, value: number) => {
    setDraft((prev) => ({ ...prev, surface: { ...(prev.surface ?? {}), [key]: value } }));
  }, []);

  const setImageField = useCallback((key: string, value: number | string) => {
    setDraft((prev) => ({ ...prev, image: { ...(prev.image ?? {}), [key]: value } }));
  }, []);

  const contrast = useMemo(() => {
    const bg = draft.overrides?.background;
    const fg = draft.overrides?.text;
    if (!bg || !fg) return null;
    return skinContrastRatio(fg, bg);
  }, [draft.overrides?.background, draft.overrides?.text]);

  const onSafeCssChange = useCallback((value: string) => {
    setDraft((prev) => ({
      ...prev,
      ...(value.trim() ? { safeCss: value } : { safeCss: undefined }),
    }));
    setSafeCssIssues(lintSkinSafeCss(value));
  }, []);

  const pickBackgroundImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      // 与原设置页同一判据：按编码后长度预检，避免保存时才被 schema 打回。
      if (file.size > (MAX_SKIN_BACKGROUND_IMAGE_CHARS * 3) / 4) {
        setSafeCssIssues([{ line: 0, message: t("settings.skin.imageTooLarge") }]);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : null;
        if (dataUrl) setDraft((prev) => ({ ...prev, backgroundImage: dataUrl }));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [t]);

  /** DreamSkin 主题包导入：解包 → 校验 → 入库并载入草稿实时预览。 */
  const importDreamSkinZip = useCallback(
    async (file: File) => {
      try {
        const zipBytes = await file.arrayBuffer();
        const files = await unzipDreamSkinTheme(zipBytes);
        const result = convertDreamSkinTheme(files);
        // 先载入草稿再入库：主题库存的是 base64 背景图，localStorage 有配额上限
        // （实测累计到约 48MB 就 QuotaExceededError）。写入失败只该丢掉"回头再
        // 载入"的便捷入口，不能把整个导入判失败——用户要的是导进来能看到效果并保存。
        commitDraft(result.skin);
        let libraryFull = false;
        try {
          const library = readSkinLibrary();
          const name = resolveLibraryEntryName(
            library,
            result.themeName,
            Boolean(result.skin.backgroundImage),
          );
          library[name] = result.skin;
          writeSkinLibrary(library);
          setSkinLibrary(library);
        } catch (error) {
          libraryFull = true;
          logger.warn("[skin-studio] 主题库写入失败（localStorage 配额）", {
            error: String(error),
          });
        }
        toast(
          libraryFull
            ? `${t("settings.skin.importSuccess").replace("{name}", result.themeName)}；${t("settings.skin.libraryFull")}`
            : t("settings.skin.importSuccess").replace("{name}", result.themeName),
        );
      } catch (error) {
        const reasonCode =
          error instanceof DreamSkinImportError ? error.reasonCode : "invalidZip";
        logger.warn("[skin-studio] DreamSkin 主题包导入失败", { error: String(error) });
        toast(t(`settings.skin.importError.${reasonCode}`));
      }
    },
    [commitDraft, t],
  );

  const deleteLibrarySkin = useCallback((name: string) => {
    setSkinLibrary((prev) => {
      const library = { ...prev };
      delete library[name];
      writeSkinLibrary(library);
      return library;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (safeCssIssues.length > 0) return;
    setSaving(true);
    try {
      await onSave(draft);
      try {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // 忽略
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [draft, onOpenChange, onSave, safeCssIssues.length]);

  const safeCssTooLarge = (draft.safeCss?.length ?? 0) > MAX_SKIN_SAFE_CSS_CHARS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[min(54rem,calc(100vh-3rem))] w-[min(88rem,calc(100vw-4rem))] max-w-none grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-clip",
          // 工坊界面自身的明暗基调跟随「当前已应用皮肤」的 base（initialSkin）——
          // 但颜色必须全部回到底座主题。皮肤色只通过 :root 的 --color-* 注入，
          // 底座主题类在这里重声明整套 token（最近祖先声明者赢），工坊子树
          // 立即脱离皮肤色；预览区在其下方自带草稿 token 作用域，不受影响。
          // 没应用皮肤时（initialSkin 为 null）不加类，跟随应用当前主题。
          initialSkin ? (initialSkin.base === "zai-dark" ? "dark theme-zai-dark" : "theme-zai-light") : "",
        )}
        data-skin-studio="true"
        // 工坊是编辑器本体，不是被皮肤渲染的业务界面。Codex 的 Studio 本身就是独立
        // 网页、永远不吃主题；这里显式摘掉 dialog 挂点，否则皮肤一载入连编辑器
        // 自己的底色都被主题改写（之前的"工坊界面跟着皮肤变色"就是这类泄漏）。
        data-ds-part={undefined}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t("settings.skin.studio.title")}</DialogTitle>
          <DialogDescription>{t("settings.skin.studio.description")}</DialogDescription>
        </DialogHeader>

        {/* 工具行右对齐：对齐参考版的「导入 + 撤销/重做/重置」 */}
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => zipInputRef.current?.click()}
          >
            <FolderInputIcon data-icon="inline-start" aria-hidden="true" />
            {t("settings.skin.importButton")}
          </Button>
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importDreamSkinZip(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={historyDepth.undo === 0}
            onClick={undo}
            aria-label={t("settings.skin.studio.undo")}
          >
            <Undo2Icon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={historyDepth.redo === 0}
            onClick={redo}
            aria-label={t("settings.skin.studio.redo")}
          >
            <Redo2Icon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => commitDraft({ base: draft.base })}
            aria-label={t("settings.skin.studio.reset")}
          >
            <RotateCcwIcon aria-hidden="true" />
          </Button>
        </div>

        {/* 两栏：左大预览、右检查器——对齐参考版的 workspace 栅格 */}
        <div className="grid min-h-0 min-w-0 grid-cols-1 gap-4 max-[1023px]:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem]">
          {/* 左：XCode 样式预览（预览即所见：token 与真实界面同源） */}
          <div className="relative flex min-h-0 min-w-0 flex-col">
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full border bg-card/90 px-2 py-1 text-ui-xs backdrop-blur",
                  safeCssIssues.length === 0 && !safeCssTooLarge
                    ? "border-border text-foreground-subtle"
                    : "border-destructive text-destructive",
                )}
              >
                {t("settings.skin.studio.safeCssBadge")}
                {safeCssIssues.length === 0 && !safeCssTooLarge ? " ✓" : ` ×${safeCssIssues.length}`}
              </span>
            </div>
            <SkinPreview draft={draft} className="min-h-0 flex-1" />
            <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs text-foreground-subtle">
              <span>
                {t("settings.skin.studio.statusBase")}:{" "}
                {t(`settings.skin.studio.appearance.${draft.base}`)}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {draft.backgroundImage
                  ? `${Math.round(draft.backgroundImage.length / 1024)} KB`
                  : t("settings.skin.studio.noImage")}
              </span>
              <span aria-hidden="true">·</span>
              <span>{t("settings.skin.studio.draftSaved")}</span>
              <span aria-hidden="true">·</span>
              <span>{t("settings.skin.studio.previewInteractive")}</span>
            </div>
          </div>

          {/* 右：检查器（tab 条 + 分区栈） */}
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background">
            <InspectorTabs active={inspectorTab} onChange={setInspectorTab} />
            <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-3">
              {inspectorTab === "design" ? (
                <>
                  <Section
                    eyebrow={t("settings.skin.studio.eyebrow.library")}
                    title={t("settings.skin.studio.library")}
                  >
                    <p className="text-ui-sm text-foreground-subtle">
                      {t("settings.skin.studio.libraryHint")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SKIN_PRESETS.map((preset) => (
                        <Button
                          key={preset.id}
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => commitDraft(structuredClone(preset.skin))}
                        >
                          {t(preset.labelId)}
                        </Button>
                      ))}
                    </div>
                    {Object.keys(skinLibrary).length > 0 ? (
                      <div className="space-y-1">
                        {Object.entries(skinLibrary).map(([name, skin]) => (
                          <div key={name} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
                              {name}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => commitDraft(structuredClone(skin))}
                            >
                              {t("settings.skin.studio.libraryApply")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              aria-label={`${name} delete`}
                              onClick={() => deleteLibrarySkin(name)}
                            >
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Section>

                  <Section
                          eyebrow={t("settings.skin.studio.eyebrow.identity")}
                          title={t("settings.skin.studio.identity")}
                        >
                    <div className="flex items-center gap-2">
                      <span className="w-28 shrink-0 text-ui-base text-foreground-subtle">
                        {t("settings.skin.studio.appearance")}
                      </span>
                      <div className="flex gap-1">
                        {(["zai-dark", "zai-light"] as const).map((base) => (
                          <Button
                            key={base}
                            type="button"
                            size="sm"
                            variant={draft.base === base ? "default" : "outline"}
                            onClick={() => commitDraft({ ...draft, base })}
                          >
                            {t(`settings.skin.studio.appearance.${base}`)}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <p className="text-ui-sm text-foreground-subtle">
                      {t("settings.skin.studio.appearanceHint")}
                    </p>
                  </Section>

                  <Section
                    eyebrow={t("settings.skin.studio.eyebrow.palette")}
                    title={t("settings.skin.studio.palette")}
                  >
                    <div className="space-y-2">
                      {PALETTE_FIELDS.map((spec) => (
                        <ColorRow
                          key={spec.field}
                          label={t(spec.labelId)}
                          value={draft.overrides?.[spec.field as keyof NonNullable<SkinDraft["overrides"]>]}
                          onChange={(value) => setOverride(spec.field, value)}
                        />
                      ))}
                    </div>
                  </Section>

                  <Section
                          eyebrow={t("settings.skin.studio.eyebrow.asset")}
                          title={t("settings.skin.studio.asset")}
                        >
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={pickBackgroundImage}>
                        {t("settings.skin.studio.chooseImage")}
                      </Button>
                      {draft.backgroundImage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDraft((prev) => ({ ...prev, backgroundImage: undefined }))}
                        >
                          {t("settings.skin.studio.removeImage")}
                        </Button>
                      ) : null}
                      <span className="text-ui-sm text-foreground-subtle">
                        {draft.backgroundImage
                          ? `${Math.round(draft.backgroundImage.length / 1024)} KB`
                          : t("settings.skin.studio.noImage")}
                      </span>
                    </div>
                  </Section>

                  <Section
                    eyebrow={t("settings.skin.studio.eyebrow.composition")}
                    title={t("settings.skin.studio.composition")}
                  >
                    <div className="space-y-2">
                      <RangeRow
                        label={t("settings.skin.image.focusX")}
                        value={draft.backgroundFocusX ?? 0.5}
                        min={0}
                        max={1}
                        step={0.01}
                        unit=""
                        disabled={!draft.backgroundImage}
                        onChange={(v) => setDraft((prev) => ({ ...prev, backgroundFocusX: v }))}
                      />
                      <RangeRow
                        label={t("settings.skin.image.focusY")}
                        value={draft.backgroundFocusY ?? 0.5}
                        min={0}
                        max={1}
                        step={0.01}
                        unit=""
                        disabled={!draft.backgroundImage}
                        onChange={(v) => setDraft((prev) => ({ ...prev, backgroundFocusY: v }))}
                      />
                      {IMAGE_SLIDERS.map((spec) => (
                        <RangeRow
                          key={spec.key}
                          label={t(spec.labelId)}
                          value={draft.image?.[spec.key] ?? DEFAULT_SKIN_IMAGE[spec.key]}
                          min={spec.min}
                          max={spec.max}
                          step={spec.step}
                          unit={spec.unit}
                          disabled={!draft.backgroundImage}
                          onChange={(v) => setImageField(spec.key, v)}
                        />
                      ))}
                      <div className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-ui-base text-foreground-subtle">
                          {t("settings.skin.image.safeArea")}
                        </span>
                        <div className="flex gap-1">
                          {(["none", "left", "right"] as const).map((area) => (
                            <Button
                              key={area}
                              type="button"
                              size="xs"
                              variant={
                                (draft.image?.safeArea ?? DEFAULT_SKIN_IMAGE.safeArea) === area
                                  ? "default"
                                  : "outline"
                              }
                              disabled={!draft.backgroundImage}
                              onClick={() => setImageField("safeArea", area)}
                            >
                              {t(`settings.skin.image.safeArea.${area}`)}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-ui-base text-foreground-subtle">
                          {t("settings.skin.image.taskIntensity")}
                        </span>
                        <div className="flex gap-1">
                          {(["ambient", "full", "off"] as const).map((mode) => (
                            <Button
                              key={mode}
                              type="button"
                              size="xs"
                              variant={
                                (draft.image?.taskIntensity ?? DEFAULT_SKIN_IMAGE.taskIntensity) === mode
                                  ? "default"
                                  : "outline"
                              }
                              disabled={!draft.backgroundImage}
                              onClick={() => setImageField("taskIntensity", mode)}
                            >
                              {t(`settings.skin.image.taskIntensity.${mode}`)}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Section>
                </>
              ) : null}

              {inspectorTab === "surface" ? (
                <Section
                  eyebrow={t("settings.skin.studio.eyebrow.surface")}
                  title={t("settings.skin.studio.surface")}
                >
                  <div className="space-y-2">
                    {SURFACE_SLIDERS.map((spec) => (
                      <RangeRow
                        key={spec.key}
                        label={t(spec.labelId)}
                        value={draft.surface?.[spec.key] ?? DEFAULT_SKIN_SURFACE[spec.key]}
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        unit={spec.unit}
                        onChange={(v) => setSurface(spec.key, v)}
                      />
                    ))}
                  </div>
                </Section>
              ) : null}

              {inspectorTab === "css" ? (
                <Section
                  eyebrow={t("settings.skin.studio.eyebrow.safeCss")}
                  title={t("settings.skin.studio.safeCss")}
                  defaultOpen={false}
                >
                  <p className="text-ui-sm text-foreground-subtle">
                    {t("settings.skin.studio.safeCssHint")}
                  </p>
                  <textarea
                    className="min-h-32 w-full rounded-md border border-input-border bg-input p-2 font-mono text-ui-sm text-foreground"
                    value={draft.safeCss ?? ""}
                    spellCheck={false}
                    onChange={(event) => onSafeCssChange(event.target.value)}
                    placeholder={'[data-ds-part="composer"] {\n  background-color: var(--color-card);\n}'}
                  />
                  <div className="flex items-center justify-between text-ui-sm">
                    <span className="text-foreground-subtle">
                      {(draft.safeCss?.length ?? 0).toLocaleString()} / {MAX_SKIN_SAFE_CSS_CHARS}
                    </span>
                    {safeCssIssues.length > 0 ? (
                      <span className="text-destructive">
                        {t("settings.skin.studio.safeCssIssues")}: {safeCssIssues.length}
                      </span>
                    ) : (
                      <span className="text-foreground-subtle">
                        {t("settings.skin.studio.safeCssClean")}
                      </span>
                    )}
                  </div>
                  {safeCssIssues.slice(0, 6).map((issue) => (
                    <p key={`${issue.line}-${issue.message}`} className="text-ui-sm text-destructive">
                      {issue.line > 0 ? `${issue.line}: ` : ""}
                      {issue.message}
                    </p>
                  ))}
                </Section>
              ) : null}

              {inspectorTab === "checks" ? (
                <Section
                  eyebrow={t("settings.skin.studio.eyebrow.checks")}
                  title={t("settings.skin.studio.checks")}
                >
                  <ul className="space-y-1 text-ui-sm">
                    <li className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          contrast == null
                            ? "bg-foreground-subtle"
                            : contrast >= 4.5
                              ? "bg-success"
                              : "bg-warning",
                        )}
                      />
                      <span className="text-foreground">
                        {t("settings.skin.studio.checkContrast")}
                        {contrast != null ? ` — ${contrast.toFixed(2)}:1` : ""}
                      </span>
                      {contrast != null && contrast < 4.5 ? (
                        <span className="text-warning">
                          {t("settings.skin.studio.contrastWarning")}
                        </span>
                      ) : null}
                    </li>
                    <li className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          safeCssIssues.length === 0 && !safeCssTooLarge ? "bg-success" : "bg-destructive",
                        )}
                      />
                      <span className="text-foreground">{t("settings.skin.studio.checkSafeCss")}</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          draft.backgroundImage ? "bg-success" : "bg-foreground-subtle",
                        )}
                      />
                      <span className="text-foreground">{t("settings.skin.studio.checkImage")}</span>
                    </li>
                  </ul>
                </Section>
              ) : null}
            </div>
          </div>
        </div>

        {recovered ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-ui-sm">
            <span className="text-foreground">{t("settings.skin.studio.draftRecovered")}</span>
            <span className="flex gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => {
                  commitDraft(recovered);
                  setRecovered(null);
                }}
              >
                {t("settings.skin.studio.restoreDraft")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setRecovered(null);
                  try {
                    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
                  } catch {
                    // 忽略
                  }
                }}
              >
                {t("settings.skin.studio.discardDraft")}
              </Button>
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("settings.skin.studio.cancel")}
          </Button>
          <Button
            type="button"
            disabled={saving || safeCssIssues.length > 0 || safeCssTooLarge}
            onClick={() => void handleSave()}
          >
            {t("settings.skin.studio.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
