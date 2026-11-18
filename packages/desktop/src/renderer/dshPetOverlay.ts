/* eslint-disable max-lines -- 动画链/物理/气泡/菜单共居一文件（上游同样聚合在 sprite 渲染层） */
/**
 * DSH 桌宠渲染层（源码级移植 PC2005-cloud/dsh-pet，MIT）。
 *
 * 分工对齐上游 runtime/electron-helper：**渲染层拥有物理与命中**，每帧把窗口
 * 矩形推给主进程；主进程只应用 bounds 与翻转点击穿透（pointer-target.js 语义）。
 *
 * 与上游 sprite.js 的对照：
 *  - 拖拽跟手弹簧 → springStep
 *  - 松手初速     → estimateReleaseVelocity（峰值/加速增益/软钳速/死区）
 *  - 抛掷积分     → throwSubsteps（重力/恢复系数/地面摩擦）
 *  - 落地挤压     → landingSquash + squashScale（Q 弹曲线）
 *  - 播完决策     → decideEndedCue（工作状态轮换 / idle / 随机小动作）
 *  - 权重掷骰     → rollKind + pickCategoryAction
 */
import {
  CANVAS_H,
  CANVAS_W,
  DRAG_THRESHOLD,
  SLINGSHOT_DOUBLE_MS,
  FEET_Y,
  HIT_BOX,
  SQ_DURATION_MS,
  WORK_STATUS_INDEX,
  behaviorStateToWorkStatus,
  computePetGeometry,
  decideEndedCue,
  estimateReleaseVelocity,
  landingSquash,
  pickCategoryAction,
  pickSlot,
  poolIncludes,
  pullAngle,
  slingshotPower,
  slingshotVelocity,
  rollKind,
  springStep,
  squashScale,
  throwBoundsIn,
  throwSubsteps,
  trimTrail,
  type Category,
  type DragSample,
  type EventSlot,
  type PetGeometry,
  type Rect,
  type ThrowState,
  type WorkStatusState,
  buildMenuTree,
  isNoMirrorAnimation,
  type MenuLeaf,
  type MenuNode,
  bodyPixelBox,
  collidePet,
  rectsOverlap,
} from "../shared/dshPetCore.js";
import {
  anchorPixel,
  planMoveAction,
  walkRatioAt,
  WALK_FALLBACK_DURATION_SEC,
  type MovesConfig,
  type PendingMove,
} from "../shared/dshPetMotion.js";
import { mountContextMenu, type ContextMenuMount } from "./dshPetMenuView.js";
import { mountChatDialog, type ChatDialogMount } from "./dshPetChatDialog.js";
import {
  DSH_PET_FONT_PRESETS,
  type DshPetEntry,
  type DshPetUserConfig,
} from "../shared/dshPetConfig.js";
import { playClickSound, setClickSoundEnabled } from "./dshPetClickSound.js";

/** 自制宠物包读取结果：包内 config 覆盖数据 + 授权后的 webm URL；失败带 error。 */
type DshPetPackLoad =
  | {
      name: string;
      animations: unknown;
      animationWeights: unknown;
      workStatusTexts: unknown;
      urls: Record<string, string>;
    }
  | { error: string };

interface DshPetBridge {
  setBounds: (payload: {
    x: number;
    y: number;
    width: number;
    height: number;
    marginL: number;
    marginT: number;
    stageWidth: number;
    stageHeight: number;
    invalidate?: boolean;
  }) => void;
  setInputBusy: (busy: boolean) => void;
  ready: () => void;
  /** 菜单「打开 XCode」：显式恢复并聚焦主窗。 */
  openApp: () => void;
  /** 菜单「重载配置」：重读配置并重载悬浮窗。 */
  reload: () => void;
  /** 菜单「碎碎念」：立即生成一句；meme 是抽中的配图名（写进 prompt，回复带上同一张）。 */
  requestWhisper: (payload?: { meme?: string }) => void;
  /** 宠物互撞：把被撞方的新初速交主进程转发（上游 flight onHit）。 */
  petHit: (payload: { targetId: string; vx: number; vy: number }) => void;
  /** 自制宠物包：按宠物读包（config 覆盖 + 授权 webm URL）；无包/读包失败返回 error。 */
  loadPack: (payload: { petId: string }) => Promise<DshPetPackLoad>;
  /**
   * 完整素材包：取动作名对应的授权播放 URL。
   * 空对象 = 没装完整包，调用方回落到内置 pets-dsh/。
   */
  /**
   * 完整素材包：取动作名对应的授权播放 URL、表情包与字体。
   * 没装完整包时 `webm`/`memes` 为空、`font` 为 null，调用方回落内置。
   */
  assets?: {
    /** 已缓存的动作名：右键菜单只列这些，避免列出点了还要等下载的动作。 */
    cached: () => Promise<string[]>;
    media: (payload: {
      names: string[];
      memes?: boolean;
      font?: boolean;
    }) => Promise<{
      webm: Record<string, string>;
      memes: Record<string, string>;
      font: string | null;
    }>;
  };
  /** 对话弹窗：发送一条消息（记忆/回复在 main）。 */
  sendChatMessage: (payload: {
    message: string;
    pool?: string[];
    imageEnabled?: boolean;
    attachment?: { mediaType: string; data: string };
  }) => Promise<{ ok: boolean; message?: string }>;
  /** 对话面板需要键盘焦点：请主进程聚焦本桌宠窗。 */
  focusSelf: () => void;
  /** 菜单「显示位置」：改开关（仅桌面 / 都不）。 */
  setConfig: (patch: Partial<DshPetUserConfig>) => Promise<DshPetUserConfig>;
  getConfig: () => Promise<DshPetUserConfig>;
  onConfig: (callback: (config: DshPetUserConfig) => void) => () => void;
  onHostEvent: (
    callback: (payload: { type: string; [key: string]: unknown }) => void,
  ) => () => void;
}

interface Animations {
  idle: string[];
  turn: string[];
  drag: string[];
  clicks: string[];
  events: Record<string, EventSlot[]>;
  categories: Category[];
  moves?: MovesConfig;
}

interface DisplayArea extends Rect {
  scaleFactor: number;
  primary: boolean;
}

declare global {
  interface Window {
    dshPet?: DshPetBridge;
  }
}

const bridge = window.dshPet ?? null;
const stageEl = document.getElementById("stage") as HTMLDivElement | null;
const petEl = document.getElementById("pet") as HTMLDivElement | null;
/**
 * 完整素材包的字体是否已接管。
 *
 * 修复原因（「选了软糖体没生效」）：它原来声明在 main() 体内第 628 行，而 applyAssetFont()
 * 在 337 行就被调用——函数声明会提升、`let` 不会，于是每次启动都在 TDZ 里抛
 * `ReferenceError: Cannot access 'assetFontApplied' before initialization`，
 * 字体注入一次都没执行过。放到模块作用域，调用顺序不再影响初始化。
 */
let assetFontApplied = false;

if (!bridge || !stageEl || !petEl) {
  console.warn("[dsh-pet-overlay] bridge missing");
} else {
  void main(bridge, stageEl, petEl);
}

/** JSONC → JSON：去掉行/块注释与尾逗号。 */
function stripJsoncComments(raw: string): string {
  return raw
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
}

interface LoadedConfig {
  animations: Animations;
  weights: { idle: number; turn: number; move: number };
  petSize: number | null;
  /** 工作状态气泡文案（上游顶层 workStatusTexts：状态档位 → 文案数组）。 */
  workStatusTexts: string[][];
}

async function loadConfig(): Promise<LoadedConfig> {
  try {
    const response = await fetch("pets-dsh/config.jsonc");
    const parsed = JSON.parse(stripJsoncComments(await response.text())) as {
      animations?: Partial<Animations>;
      animationWeights?: { idle?: number; turn?: number; move?: number };
      pets?: Array<{ size?: number }>;
      workStatusTexts?: string[][];
    };
    const a = (parsed.animations ?? {}) as Partial<Animations>;
    return {
      animations: {
        idle: a.idle?.length ? a.idle : ["待机呼吸休闲"],
        turn: a.turn ?? [],
        drag: a.drag ?? [],
        clicks: a.clicks ?? [],
        events: a.events ?? {},
        categories: a.categories ?? [],
        ...(a.moves ? { moves: a.moves } : {}),
      },
      weights: {
        idle: parsed.animationWeights?.idle ?? 10,
        turn: parsed.animationWeights?.turn ?? 5,
        move: parsed.animationWeights?.move ?? 5,
      },
      petSize: parsed.pets?.[0]?.size ?? null,
      workStatusTexts: Array.isArray(parsed.workStatusTexts)
        ? parsed.workStatusTexts.filter((group) => Array.isArray(group))
        : [],
    };
  } catch {
    return {
      animations: {
        idle: ["待机呼吸休闲"],
        turn: [],
        drag: [],
        clicks: [],
        events: {},
        categories: [],
      },
      weights: { idle: 10, turn: 5, move: 5 },
      petSize: null,
      workStatusTexts: [],
    };
  }
}

async function main(b: DshPetBridge, stage: HTMLDivElement, pet: HTMLDivElement) {
  const loaded = await loadConfig();
  const animations = loaded.animations;
  const weights = loaded.weights;

  const initial = await b.getConfig();
  /** 用户配置（设置页同形）：尺寸 / 角落与偏移 / 固定 / 工作状态 / 锁屏 / 物理。 */
  let userConfig: DshPetUserConfig = initial;
  /** 本窗口对应的宠物（URL ?pet=<id>；displays 事件会再校准）。 */
  let myPetId = new URLSearchParams(location.search).get("pet") ?? userConfig.pets[0]?.id ?? "main";
  const myPet = (): DshPetEntry =>
    userConfig.pets.find((pet) => pet.id === myPetId) ?? userConfig.pets[0]!;
  setClickSoundEnabled(userConfig.clickSoundEnabled);
  let size = myPet().size;
  /** 上游名字的用途之一是悬浮提示：这里落到原生 title（窗口可交互时悬停即出）。 */
  const applyPetName = (): void => {
    // 名字的悬浮展示走自定义 tip（上游 tooltip.ts），不再设置原生 title——
    // 原生提示是系统方框样式，且与自定义提示会同时弹出。
    // 启动早期 tip 尚未创建：用 DOM 探测代替变量判断（tipOn/ tipEl 在下方才声明）。
    if (document.getElementById("dsh-pet-tip")) renderTip();
  };
  applyPetName();
  let geo: PetGeometry = computePetGeometry(size);

  // ───────── 自制宠物包（pet-maker 产出，userData/dsh-pet/packs/<packId>/） ─────────
  /** 包激活时的授权媒体 URL（url() 优先取这里）。 */
  let packUrls: Record<string, string> | null = null;
  /**
   * 完整素材包（上游 dsh-pet/assets，设置页下载）的授权 URL。
   *
   * 内置只带 8 个核心动作；装了完整包后这里按需补齐其余动作的 URL。
   * `null` = 还没查过；`{}` = 查过但没装。`pending` 去重同一动作名的并发请求，
   * 否则切换动画时同一帧会连发十几条 IPC。
   */
  let assetUrls: Record<string, string> | null = null;
  const assetRequests = new Map<string, Promise<string | undefined>>();
  const assetUrlOf = async (name: string): Promise<string | undefined> => {
    if (assetUrls && name in assetUrls) return assetUrls[name];
    const inflight = assetRequests.get(name);
    if (inflight) return inflight;
    const request = (async () => {
      try {
        const result = (await b.assets?.media({ names: [name] })) ?? {
          webm: {},
          memes: {},
          font: null,
        };
        if (assetUrls) {
          Object.assign(assetUrls, result.webm);
        } else if (Object.keys(result.webm).length > 0) {
          assetUrls = result.webm;
        } else {
          assetUrls = assetUrls ?? {};
        }
        return result.webm[name];
      } catch {
        return undefined;
      } finally {
        assetRequests.delete(name);
      }
    })();
    assetRequests.set(name, request);
    return request;
  };
  /** 包内 config 的 animations/animationWeights/workStatusTexts 覆盖内置素材；webm 走授权 URL。 */
  const applyPack = async (): Promise<void> => {
    const packId = myPet().packId ?? "";
    if (!packId) {
      packUrls = null;
      return;
    }
    const pack = await b.loadPack({ petId: myPetId });
    if ("error" in pack) {
      packUrls = null;
      return;
    }
    packUrls = pack.urls;
    const a = (pack.animations ?? {}) as Partial<Animations>;
    animations.idle = a.idle?.length ? a.idle : animations.idle;
    animations.turn = a.turn ?? animations.turn;
    animations.drag = a.drag ?? animations.drag;
    animations.clicks = a.clicks ?? animations.clicks;
    animations.events = a.events ?? animations.events;
    animations.categories = a.categories ?? animations.categories;
    if (a.moves) animations.moves = a.moves;
    const packWeights = (pack.animationWeights ?? {}) as { idle?: number; turn?: number; move?: number };
    weights.idle = packWeights.idle ?? weights.idle;
    weights.turn = packWeights.turn ?? weights.turn;
    weights.move = packWeights.move ?? weights.move;
    if (Array.isArray(pack.workStatusTexts) && pack.workStatusTexts.length > 0) {
      loaded.workStatusTexts = pack.workStatusTexts.filter((group) => Array.isArray(group));
    }
  };
  await applyPack();
  // 完整素材包的字体是异步补的，不阻塞桌宠窗首帧——装上就换，没装继续用系统字体。
  void applyAssetFont();
  // ───────── A/B 双缓冲视频（上游同构：换源不闪） ─────────
  const videos = [document.createElement("video"), document.createElement("video")];
  let front = 0;
  for (const video of videos) {
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity 60ms linear;";
    pet.appendChild(video);
  }

  // ───────── 鼠标样式（上游 renderer.js .pet-hit：抓取/抓取中自绘光标，热点 16 16） ─────────
  // 16×16 光标图（上游 32px 素材缩到 16px：Windows Chromium 按 1:1 DIP 渲染，
  // 直接用 32px 素材在高分屏上观感翻倍「过大」）；热点居中 8 8。
  const CURSOR_GRAB = 'url("pets-dsh/pic/cursor-grab.png") 8 8, grab';
  const CURSOR_GRABBING = 'url("pets-dsh/pic/cursor-grabbing.png") 8 8, grabbing';
  pet.style.cursor = CURSOR_GRAB;

  // ───────── 点击积分（上游 score.ts + score-popup.ts：飞行中点击 → 粒子 + 得分卡） ─────────
  const SCORE_MIN_SPEED = 400;
  const clickScore = (speed: number, size: number): number => {
    if (speed <= 0 || size <= 0) return 0;
    return Math.max(1, Math.round((speed / 100) * (462 / size)));
  };
  if (!document.querySelector("style[data-plugin-css='dsh-pet/score']")) {
    const scoreStyle = document.createElement("style");
    scoreStyle.dataset.pluginCss = "dsh-pet/score";
    scoreStyle.textContent = [
      ".dsh-pet-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;",
      "background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;",
      "box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;",
      "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);}",
      ".dsh-pet-score.is-in{animation:dshPetScorePop .28s ease}",
      ".dsh-pet-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}",
      ".dsh-pet-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}",
      ".dsh-pet-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}",
      ".dsh-pet-score-particle{position:absolute;border-radius:50%;pointer-events:none}",
      "@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}",
    ].join("");
    document.head.appendChild(scoreStyle);
  }

  /** 在 (x, y) 爆开一圈暖色粒子（视口坐标）：随机初速 + 重力回落 + 淡出（上游同参数）。 */
  const spawnScoreBurst = (x: number, y: number): void => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const burst = document.createElement("div");
    burst.className = "dsh-pet-score-burst";
    const colors = ["#ffb300", "#ff8f00", "#ff7043", "#f4511e", "#ffc400", "#ffd54f", "#ef5350"];
    const particles: Array<{ el: HTMLDivElement; vx: number; vy: number; life: number }> = [];
    const count = 20;
    for (let i = 0; i < count; i += 1) {
      const el = document.createElement("div");
      el.className = "dsh-pet-score-particle";
      const radius = 3 + Math.random() * 4;
      el.style.width = `${radius}px`;
      el.style.height = `${radius}px`;
      el.style.background = colors[Math.floor(Math.random() * colors.length)]!;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      burst.appendChild(el);
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 340;
      particles.push({
        el,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        life: 500 + Math.random() * 400,
      });
    }
    document.body.appendChild(burst);
    let last = performance.now();
    const step = (): void => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      let alive = false;
      for (const particle of particles) {
        if (particle.life <= 0) continue;
        alive = true;
        particle.life -= now - last + dt * 1000;
        particle.vy += 700 * dt;
        const current = parseFloat(particle.el.style.left || "0");
        const currentTop = parseFloat(particle.el.style.top || "0");
        particle.el.style.left = `${current + particle.vx * dt}px`;
        particle.el.style.top = `${currentTop + particle.vy * dt}px`;
        particle.el.style.opacity = String(Math.max(0, particle.life / 900));
      }
      if (alive) requestAnimationFrame(step);
      else burst.remove();
    };
    requestAnimationFrame(step);
  };

  const mountScorePopup = (input: {
    x: number;
    y: number;
    score: number;
    speed: number;
    size: number;
  }): void => {
    const popup = document.createElement("div");
    popup.className = "dsh-pet-score is-in";
    popup.style.left = `${input.x + 12}px`;
    popup.style.top = `${input.y + 12}px`;
    popup.innerHTML = [
      `<div class="dsh-pet-score-val">+${input.score}</div>`,
      `<div class="dsh-pet-score-sub">速度 ${Math.round(input.speed)} px/s · 体型 ${input.size}px</div>`,
    ].join("");
    document.body.appendChild(popup);
    window.setTimeout(() => popup.remove(), 2200);
  };

  let pressScoreFired = false;

  // ───────── 悬浮提示（上游 tooltip.ts：白底胶囊跟光标，名字 = 显示名） ─────────
  const FONT_REF_SIZE = 462;
  const BUBBLE_FONT_BASE_PX = 0.0455 * FONT_REF_SIZE;
  const TIP_FONT_BASE_PX = 0.026 * FONT_REF_SIZE;
  const TOOLTIP_GAP_RATIO = 0.022;
  const fontStackOf = (id: string): string =>
    DSH_PET_FONT_PRESETS.find((preset) => preset.id === id)?.stack ??
    DSH_PET_FONT_PRESETS[0]!.stack;
  /** 字号换算（上游 fonts.ts resolveFontPx）：基准 × (font.size ÷ 21) × (followPet ? 宽 ÷ 462 : 1)。 */
  const resolveFontPx = (): { bubble: number; tip: number } => {
    const ratio = userConfig.font.size > 0 ? userConfig.font.size / 21 : 1;
    const scale = userConfig.font.followPet ? myPet().size / FONT_REF_SIZE : 1;
    return {
      bubble: BUBBLE_FONT_BASE_PX * ratio * scale,
      tip: TIP_FONT_BASE_PX * ratio * scale,
    };
  };
  /** 上游 tooltip.ts tooltipPlacement：优先光标右下，装不下翻左/翻上，翻完仍越界夹回。 */
  const tooltipPlacement = (
    cursor: { x: number; y: number },
    tip: { w: number; h: number },
    bounds: { x: number; y: number; w: number; h: number },
    gap: number,
  ): { x: number; y: number } => {
    const clampTo = (v: number, lo: number, hi: number): number =>
      hi < lo ? lo : Math.min(Math.max(v, lo), hi);
    const rightMax = bounds.x + bounds.w;
    const bottomMax = bounds.y + bounds.h;
    let x = cursor.x + gap;
    if (x + tip.w > rightMax) x = cursor.x - gap - tip.w;
    x = clampTo(x, bounds.x, rightMax - tip.w);
    let y = cursor.y + gap;
    if (y + tip.h > bottomMax) y = cursor.y - gap - tip.h;
    y = clampTo(y, bounds.y, bottomMax - tip.h);
    return { x, y };
  };

  const tipEl = document.createElement("div");
  tipEl.style.cssText = [
    "position:fixed;left:0;top:0;z-index:4;pointer-events:none;",
    `max-width:${Math.round(geo.size * 0.8)}px;`,
    `padding:${(geo.size * 0.01).toFixed(1)}px ${(geo.size * 0.021).toFixed(1)}px;`,
    `border-radius:${(geo.size * 0.016).toFixed(1)}px;`,
    "background:rgba(255,255,255,.96);color:#1f1f1f;",
    "border:1px solid rgba(0,0,0,.12);line-height:1.4;",
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
    `box-shadow:0 ${(geo.size * 0.004).toFixed(1)}px ${(geo.size * 0.013).toFixed(1)}px rgba(0,0,0,.18);`,
    "opacity:0;transition:opacity .12s ease;",
  ].join("");
  tipEl.id = "dsh-pet-tip";
  tipEl.textContent = "";
  document.body.appendChild(tipEl);
  let tipOn = false;

  const renderTip = (): void => {
    const name = myPet().name || myPet().id;
    if (tipEl.textContent !== name) tipEl.textContent = name;
    const cursor = tipCursor;
    if (cursor) {
      tipEl.style.fontFamily = fontStackOf(userConfig.font.family);
      tipEl.style.fontSize = `${Math.max(4, Math.round(resolveFontPx().tip))}px`;
      // 允许范围 = 整个窗口视口（窗口 ∩ 工作区由主进程保证窗口不出屏）。
      const placement = tooltipPlacement(
        cursor,
        { w: tipEl.offsetWidth, h: tipEl.offsetHeight },
        { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
        geo.size * TOOLTIP_GAP_RATIO,
      );
      tipEl.style.left = `${placement.x}px`;
      tipEl.style.top = `${placement.y}px`;
    }
    tipEl.classList.toggle("is-on", tipOn);
    tipEl.style.opacity = tipOn ? "1" : "0";
  };

  const setTip = (on: boolean): void => {
    if (on === tipOn) return;
    tipOn = on;
    renderTip();
  };

  // ───────── 气泡（上游 bubble.ts + whisper.ts MEME_BUBBLE_CSS 同构） ─────────
  /**
   * 气泡样式逐字取自上游：位置锚 `bottom: calc(100% - 宠物宽 × 0.108)`——气泡底边落进宠物盒
   * 内约 10.8% 宽的位置，正好贴着头顶；尺寸全部锚在字号 --f 上，字号调大整体等比放大。
   */
  const BUBBLE_CSS = [
    ".dsh-pet-bubble{position:absolute;left:50%;transform:translateX(-50%);",
    // 上游气泡挂在根节点下、舞台整体 translateY(bottomPad)：底边实际落在头顶上方一点。
    // 我们的气泡挂在舞台内（舞台没有下移，bottomPad 由窗口底边承担），这里把 bottomPad 补回去。
    "bottom:calc(100% - var(--dsh-pet-size)*0.108 + var(--dsh-pet-bottom-pad,0px));width:max-content;",
    "min-width:calc(var(--f)*5.7143);max-width:min(calc(var(--f)*16),100%);",
    "box-sizing:content-box;padding:calc(var(--f)*0.4835) calc(var(--f)*0.6593);",
    "border-radius:calc(var(--f)*0.7692);background:rgba(255,255,255,.92);color:#2b2b2b;",
    "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
    "font-size:var(--f);line-height:1.6;z-index:3;pointer-events:none;",
    "box-shadow:0 calc(var(--f)*0.1978) calc(var(--f)*0.7692) rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.08);",
    "backdrop-filter:blur(6px);opacity:0;transition:opacity .25s ease;",
    "white-space:normal;overflow-wrap:break-word;display:none}",
    ".dsh-pet-bubble.is-on{opacity:1}",
    // 拖拽中：上游舞台取消 translateY(bottomPad)，精灵相对根节点上移，气泡因此贴得更近。
    ".dsh-pet-bubble.is-dragging{bottom:calc(100% - var(--dsh-pet-size)*0.108)}",
    ".dsh-pet-bubble::after{content:'';position:absolute;left:50%;bottom:calc(var(--f)*-0.3736);",
    "transform:translateX(-50%);border:calc(var(--f)*0.3736) solid transparent;",
    "border-top-color:rgba(255,255,255,.92);border-bottom:none}",
    ".dsh-pet-bubble.dsh-pet-whisper{font-size:calc(var(--f)*0.7473);",
    "min-width:calc(var(--f)*2.1978);max-width:min(calc(var(--f)*10.989),100%)}",
    ".dsh-pet-bubble.has-img{min-width:0}",
    ".dsh-pet-bubble .pet-bub-img{--m:var(--f);display:block;width:calc(var(--m)*7.4725);",
    "max-width:100%;height:auto;border-radius:calc(var(--m)*0.5714);",
    "margin:0 auto calc(var(--m)*0.3736);object-fit:cover;pointer-events:none;user-select:none}",
  ].join("");
  {
    const style = document.createElement("style");
    style.textContent = BUBBLE_CSS;
    document.head.appendChild(style);
  }
  const bubbleEl = document.createElement("div");
  bubbleEl.className = "dsh-pet-bubble";
  pet.appendChild(bubbleEl);
  // 配图在上、正文在下（上游 whisper 带图气泡同序）。
  const bubbleImage = document.createElement("img");
  bubbleImage.alt = "";
  bubbleImage.className = "pet-bub-img";
  const bubbleText = document.createElement("span");
  bubbleEl.append(bubbleImage, bubbleText);

  let bubbleTimer: number | null = null;
  /**
   * 碎碎念配图池。
   *
   * 内置只剩空的 memes/manifest.json —— 表情包属于「完整素材包」，设置页下载后
   * 才有内容。这里先试完整包，再回落内置 manifest（自制宠物包场景下仍可能有随包表情）。
   */
  let memeNames: string[] | null = null;
  /** 完整素材包授权后的表情 URL（键 = 文件名）。 */
  let assetMemeUrls: Record<string, string> | null = null;
  const loadAssetMemeUrls = async (): Promise<Record<string, string>> => {
    if (assetMemeUrls) return assetMemeUrls;
    try {
      const result = await b.assets?.media({ names: [], memes: true });
      assetMemeUrls = result?.memes ?? {};
    } catch {
      assetMemeUrls = {};
    }
    return assetMemeUrls;
  };
  const memePool = async (): Promise<string[]> => {
    if (memeNames === null) {
      const fromAssets = Object.keys(await loadAssetMemeUrls());
      if (fromAssets.length > 0) {
        memeNames = fromAssets;
      } else {
        try {
          const response = await fetch("pets-dsh/memes/manifest.json");
          memeNames = response.ok ? ((await response.json()) as string[]) : [];
        } catch {
          memeNames = [];
        }
      }
    }
    return memeNames;
  };
  const memePathOf = (name: string): string =>
    assetMemeUrls?.[name] ?? `pets-dsh/memes/${encodeURIComponent(name)}`;
  const randomMemeName = async (): Promise<string | null> => {
    if (!userConfig.whisperImageEnabled) return null;
    const pool = await memePool();
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)]!;
  };
  /** 悬浮提示光标（窗口内坐标）：窗口随宠物移动，贴光标不漂。 */
  let tipCursor: { x: number; y: number } | null = null;
  let bubbleFadeTimer: number | null = null;

  /**
   * 完整素材包的字体接管。
   *
   * 内置已移除 3.9 MB 的「上首软糖体」；HTML 里那条 @font-face 会 404 并静默回落到
   * 系统字体。装了完整包后在这里补一条指向授权 URL 的 @font-face —— 用同一
   * font-family 名后声明覆盖前者，不需要改 HTML。
   *
   * 用 `function` 而不是 `const`：它在 applyPack 之后、本函数定义之前就被调用，
   * 箭头函数会在暂时性死区里抛 ReferenceError。
   */
  async function applyAssetFont(): Promise<void> {
    const assetsBridge = b.assets;
    if (assetFontApplied || !assetsBridge) return;
    try {
      const result = await assetsBridge.media({ names: [], font: true });
      // 没装字体就保持「未接管」：素材包下载完成后主进程会重载本窗，届时再注入一次。
      if (!result.font) return;
      const style = document.createElement("style");
      style.dataset.dshAssetFont = "1";
      style.textContent = `@font-face{font-family:"ShangshouSoftCandy";src:url("${result.font}") format("truetype");font-display:swap;font-weight:400}`;
      document.head.appendChild(style);
      // 主动加载一次，document.fonts 里能看到真实状态（失败仍回落系统字体）。
      void document.fonts.load('400 21px "ShangshouSoftCandy"').catch(() => undefined);
      assetFontApplied = true;
    } catch {
      /* 字体不是必需品，失败就用系统字体 */
    }
  }
  const applyBubbleFont = (): void => {
    // 对话弹窗挂在 body 下，继承不到宠物根容器的字体，走全局变量（上游同款）。
    document.documentElement.style.setProperty("--dsh-pet-font-family", fontStackOf(userConfig.font.family));
    // 气泡尺寸全部锚在 --f（气泡正文最终字号）与 --dsh-pet-size（宠物宽）上。
    bubbleEl.style.setProperty("--f", `${Math.max(4, Math.round(resolveFontPx().bubble))}px`);
    bubbleEl.style.setProperty("--dsh-pet-size", `${geo.size}px`);
    // 舞台脚垫（上游 stage translateY(bottomPad)）：气泡锚点相对舞台时要把它加回去。
    bubbleEl.style.setProperty("--dsh-pet-bottom-pad", `${geo.bottomPad}px`);
  };

  const hideBubble = (): void => {
    if (bubbleTimer !== null) {
      window.clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
    bubbleEl.classList.remove("is-on");
    if (bubbleFadeTimer !== null) window.clearTimeout(bubbleFadeTimer);
    bubbleFadeTimer = window.setTimeout(() => {
      bubbleFadeTimer = null;
      bubbleEl.style.display = "none";
    }, 250);
  };

  /** 显示气泡：sticky = 常驻（工作状态），否则 duration ms 后自动收起（碎碎念/余额 10s）。 */
  const showBubble = (
    text: string,
    options?: {
      sticky?: boolean;
      durationMs?: number;
      image?: string | null;
      /** 碎碎念变体（上游 dsh-pet-whisper：字号缩到 0.75、宽度上限更窄）。 */
      variant?: "whisper";
    },
  ): void => {
    if (bubbleTimer !== null) {
      window.clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
    if (bubbleFadeTimer !== null) {
      window.clearTimeout(bubbleFadeTimer);
      bubbleFadeTimer = null;
    }
    applyBubbleFont();
    bubbleText.textContent = text;
    bubbleImage.style.display = options?.image ? "block" : "none";
    if (options?.image) bubbleImage.src = options.image;
    else bubbleImage.removeAttribute("src");
    bubbleEl.classList.toggle("has-img", Boolean(options?.image));
    bubbleEl.classList.toggle("dsh-pet-whisper", options?.variant === "whisper");
    bubbleEl.style.display = "block";
    // 先 display 再下一帧加 is-on，才会走 opacity 过渡（与上游一致）。
    void bubbleEl.offsetWidth;
    bubbleEl.classList.add("is-on");
    if (!options?.sticky) {
      bubbleTimer = window.setTimeout(hideBubble, options?.durationMs ?? 10_000);
    }
  };

  /** 工作状态 → 常驻气泡文案（上游 workStatusTexts 档位随机抽 1）。 */
  const showWorkBubble = (state: WorkStatusState): void => {
    const slot = loaded.workStatusTexts[WORK_STATUS_INDEX[state]];
    const group = Array.isArray(slot) ? slot : [];
    if (group.length === 0) return;
    const text = group[Math.floor(Math.random() * group.length)]!;
    // 终态 10s 自动收起，进行中常驻到状态切走（上游 events.js 同语义）。
    showBubble(text, {
      sticky: state !== "success" && state !== "error",
      durationMs: 10_000,
    });
  };

  const applyStageLayout = (): void => {
    geo = computePetGeometry(size);
    stage.style.width = `${geo.size}px`;
    stage.style.height = `${geo.height}px`;
    stage.style.marginLeft = `${geo.margin.l}px`;
    stage.style.marginTop = `${geo.margin.t}px`;
    // 命中区（调试可视化）；实际穿透由主进程轮询判定
    pet.style.width = `${geo.size}px`;
    pet.style.height = `${geo.height}px`;
    document.body.style.paddingBottom = `${geo.bottomPad}px`;
  };
  applyStageLayout();

  // ───────── 位置（包围盒左上角，工作区坐标） ─────────
  let pos = { x: 0, y: 0 };
  let areas: DisplayArea[] = [];

  /** 宠物当前所在的显示器（命中区 / 锁屏漫游用）。 */
  const areaAt = (): DisplayArea | null => {
    const cx = pos.x + geo.size / 2;
    const cy = pos.y + geo.height / 2;
    return (
      areas.find(
        (area) =>
          cx >= area.x && cx <= area.x + area.width && cy >= area.y && cy <= area.y + area.height,
      ) ??
      areas.find((area) => area.primary) ??
      areas[0] ??
      null
    );
  };

  /**
   * 可见夹取矩形（窗口 ∩ 宠物所在屏的工作区），窗口局部坐标；可见区太小返回 null。
   * 上游 sprite.js visibleClampRect 同构：宠物贴边时窗口外扩的余量在屏幕外，
   * 菜单走进那里会被 OS 裁掉——约束进可见区即可完整显示，窗口与宠物零移动。
   */
  const visibleClampRect = (): { x: number; y: number; w: number; h: number } | null => {
    const area = areaAt();
    if (!area) return null;
    const winX = pos.x - geo.margin.l;
    const winY = pos.y - geo.margin.t;
    const winW = geo.window.width;
    const winH = geo.window.height;
    const vx0 = Math.max(area.x, winX);
    const vy0 = Math.max(area.y, winY);
    const vx1 = Math.min(area.x + area.width, winX + winW);
    const vy1 = Math.min(area.y + area.height, winY + winH);
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    if (w < 40 || h < 40) return null;
    return { x: vx0 - winX, y: vy0 - winY, w, h };
  };

  /** 自主漫游 / 抛掷的作用区：锁定在当前屏幕 = 宠物所在屏；否则回主屏。 */
  const roamArea = (): DisplayArea | null => {
    if (userConfig.confineToScreen) return areaAt();
    return areas.find((area) => area.primary) ?? areas[0] ?? null;
  };

  /** 配置的角落 + 偏移 → 宠物包围盒左上角（上游 position.corner/marginX/marginY）。 */
  const anchorFromConfig = (): { x: number; y: number } | null => {
    const area = areas.find((candidate) => candidate.primary) ?? areas[0];
    if (!area) return null;
    return anchorPixel({
      corner: myPet().position.corner,
      marginX: myPet().position.marginX,
      marginY: myPet().position.marginY,
      size: geo.size,
      W: area.width,
      H: area.height,
      area,
    });
  };

  const pushBounds = (invalidate = false): void => {
    b.setBounds({
      x: Math.round(pos.x - geo.margin.l),
      y: Math.round(pos.y - geo.margin.t),
      width: Math.round(geo.window.width),
      height: Math.round(geo.window.height),
      marginL: geo.margin.l,
      marginT: geo.margin.t,
      // 窗口在菜单展开时会临时变大，命中区不能用窗口宽反推，必须显式给舞台尺寸。
      stageWidth: geo.size,
      stageHeight: geo.height,
      ...(invalidate ? { invalidate: true } : {}),
    });
  };

  // ───────── 动画播放 ─────────
  let currentAnim = "";
  let gen = 0;
  let workState: WorkStatusState | null = null;
  /** 朝向与上游同义：left = 素材原样，right = 镜像（scaleX(-1)）。 */
  let facing: "left" | "right" = "left";

  /**
   * 朝向只作用于精灵视频本身（上游 animation.ts / playback.js 也是给视频元素贴
   * `scaleX(-1)`），容器永远不镜像——否则容器里任何文字/UI 都会跟着颠倒。
   */
  const applyFacing = (next: "left" | "right"): void => {
    if (next === facing) return;
    facing = next;
    const mirror = facing === "right" ? "scaleX(-1)" : "";
    for (const video of videos) video.style.transform = mirror;
  };

  /** 内置回退路径：精简版只带 8 个核心动作，其余动作要等完整素材包下载。 */
  const builtinUrl = (name: string): string =>
    `pets-dsh/webm/${encodeURIComponent(name)}.webm`;
  /**
   * 同步 URL：自制包 > 完整素材包（已查到）> 内置。
   *
   * 完整素材包的 URL 要经 IPC 授权才能拿，首个请求必然是异步——所以这里同步返回
   * 内置路径先播起来，`resolveUrl` 在后台把授权 URL 补进 `assetUrls`，下一次切到
   * 同一动作就命中缓存。这样冷启动不会被 IPC 往返卡住，也不会出现空白帧。
   */
  const url = (name: string): string =>
    packUrls?.[name] ?? assetUrls?.[name] ?? builtinUrl(name);
  /**
   * 异步取最终 URL：装了完整包就换成授权 URL，否则保持内置。
   *
   * 内置精简版里缺的动作（比如 98 个非核心动作）只有完整包才有；此时 `assetUrls`
   * 拿到的是 undefined，调用方回落到内置 404 —— 由 playback 的 error 处理跳过该动作。
   */
  const resolveUrl = async (name: string): Promise<string> => {
    if (packUrls?.[name]) return packUrls[name];
    if (!b.assets || assetUrls?.[name]) return url(name);
    const authorized = await assetUrlOf(name);
    return authorized ?? builtinUrl(name);
  };

  /**
   * 换源播放。`onFront` 在新元素真正成为前台后回调——走位必须拿到这个元素，
   * 直接用 videos[front] 会取到换源前的旧元素，导致按旧视频时长驱动位移。
   */
  const switchTo = (
    name: string,
    once: boolean,
    onFront?: (el: HTMLVideoElement) => void,
  ): void => {
    if (!name || (name === currentAnim && !once)) return;
    currentAnim = name;
    const myGen = ++gen;
    const next = videos[1 - front]!;
    next.loop = !once;
    const onReady = (): void => {
      if (myGen !== gen) return;
      next.removeEventListener("loadeddata", onReady);
      // 换下的旧视频必须暂停（上游 playback.js 同构）：否则它在后台播完还会触发
      // ended → handleEnded，拿新动画的名字做决策，随机链和朝向都会被带偏。
      const outgoing = videos[front]!;
      outgoing.pause();
      outgoing.style.opacity = "0";
      next.style.opacity = "1";
      front = 1 - front;
      void next.play().catch(() => undefined);
      onFront?.(next);
    };
    next.addEventListener("loadeddata", onReady);
    // 先用同步路径立刻起播（内置/已缓存），随后若有授权 URL 再无缝换源。
    next.src = url(name);
    if (b.assets && !packUrls?.[name] && !assetUrls?.[name]) {
      void resolveUrl(name).then((resolved) => {
        if (myGen !== gen || !resolved || resolved === next.src) return;
        next.src = resolved;
        void next.load();
      });
    }
    void next.load();
  };

  /** 非终态工作状态：单候选循环、多候选播一遍轮换（上游 resumeWorkStatusAnim 同构）。 */
  const resumeWorkStatusAnim = (): boolean => {
    const state = workState;
    if (!state || state === "success" || state === "error") return false;
    const pool = animations.events.workStatus;
    const slot = pool?.[WORK_STATUS_INDEX[state]];
    if (slot === undefined) return false;
    const name = pickSlot(slot, currentAnim);
    // 单候选用 loop 无限循环（不触发 ended）；多候选播一遍，由 handleEnded 轮换。
    switchTo(name, Array.isArray(slot) && slot.length > 1);
    return true;
  };

  /** 工作状态档位：终态播一遍即回空闲链；非终态按候选数循环/轮换。 */
  const playWorkStatus = (state: WorkStatusState): void => {
    const pool = animations.events.workStatus;
    const slot = pool?.[WORK_STATUS_INDEX[state]];
    if (slot === undefined) return;
    const name = pickSlot(slot, currentAnim);
    const terminal = state === "success" || state === "error";
    switchTo(name, terminal || (Array.isArray(slot) && slot.length > 1));
  };

  /** 无工作状态：回到空闲随机链的起点（idle 播一遍，播完由 ended 掷骰）。 */
  const playAmbient = (): void => {
    if (resumeWorkStatusAnim()) return;
    switchTo(animations.idle[Math.floor(Math.random() * animations.idle.length)]!, true);
  };

  // ───────── 自主走位（对齐上游 walk.ts） ─────────
  let walkRaf = 0;
  let walkToken = 0;
  let pendingMove: PendingMove | null = null;

  const stopWalk = (): void => {
    walkToken += 1;
    cancelAnimationFrame(walkRaf);
    walkRaf = 0;
    pendingMove = null;
  };

  /** 视频就绪后按播放时间平移（上游同构：起脚留白 / 中段匀速 / 收脚提前到位）。 */
  const startWalk = (el: HTMLVideoElement): void => {
    if (!pendingMove || walkRaf !== 0) return;
    const move = pendingMove;
    pendingMove = null;
    const area = roamArea();
    if (!area) return;
    const duration =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : WALK_FALLBACK_DURATION_SEC;
    const own = ++walkToken;
    const step = (): void => {
      if (own !== walkToken) return;
      const ratioX = walkRatioAt(move, el.currentTime || 0, duration);
      pos = { x: area.x + ratioX * area.width - geo.size / 2, y: pos.y };
      pushBounds();
      if ((el.currentTime || 0) >= duration - move.tailSec) {
        walkRaf = 0;
        pos = { x: area.x + move.targetRatio * area.width - geo.size / 2, y: pos.y };
        pushBounds();
        // 收尾后不主动换动画（上游 startMoveDrive 同构）：这一段播完的 ended 会接回随机链。
        return;
      }
      walkRaf = requestAnimationFrame(step);
    };
    walkRaf = requestAnimationFrame(step);
  };

  /**
   * 尝试发起一次走位：占用中返回 true、无法移动返回 false、成功返回动作名。
   * 落点越界（贴边）时调用方退回原地动作，与上游一致。
   */
  const tryMove = (preferredName?: string): boolean | string => {
    if (walkRaf !== 0) return true;
    if (throwing || dragging) return false;
    const area = roamArea();
    if (!area || !animations.moves) return false;
    const planned = planMoveAction({
      moves: animations.moves,
      ...(preferredName ? { preferredName } : {}),
      facing,
      size: geo.size,
      center: { x: pos.x + geo.size / 2, y: pos.y + geo.height / 2 },
      viewport: { width: area.width, height: area.height },
      halfW: geo.size / 2,
      sideAllow: geo.sideAllow,
      areas: [area],
    });
    if (!planned) return false;
    pendingMove = planned.pending;
    switchTo(planned.anim, true, (el) => {
      // 新元素已是前台：元数据就绪即开跑（loadeddata 时通常已就绪）。
      if (!pendingMove) return;
      if (el.readyState >= 1) startWalk(el);
      else {
        const begin = (): void => {
          el.removeEventListener("loadedmetadata", begin);
          if (pendingMove) startWalk(el);
        };
        el.addEventListener("loadedmetadata", begin);
      }
    });
    return planned.anim;
  };

  // ───────── 对话面板（上游 mountChat 同构：消息列表 + 输入框，记忆在 main） ─────────
  // ───────── 对话弹窗（1:1 移植上游 src/shared/chat/*） ─────────
  let chatDialog: ChatDialogMount | null = null;
  /** 打开对话弹窗：贴在宠物命中区右上角（上游 openChat 同款落点），超出窗口夹回。 */
  const openChatDialog = (image?: File): void => {
    chatDialog?.close();
    // 上游 openChat：弹窗贴在**身体命中区**右上角（.dsh-pet-hit 的几何），不是舞台盒；
    // 命中区按 640×360 画布比例换算（geometry.ts PET_HIT_STYLE 同式）。
    const petRect = pet.getBoundingClientRect();
    // 上游 openChat：命中区右上角 + 6，贴边时夹回可见区（窗口 ∩ 工作区）——
    // 宠物贴屏幕边时窗口有一部分在屏幕外，用整窗视口会让弹窗被 OS 裁掉。
    const x = Math.max(4, petRect.left + (HIT_BOX.x1 / CANVAS_W) * petRect.width + 6);
    const y = Math.max(4, petRect.top + (HIT_BOX.y0 / CANVAS_H) * petRect.height + 6);
    chatDialog = mountChatDialog({
      ...(image ? { initialImage: image } : {}),
      x,
      y,
      clamp: visibleClampRect() ?? undefined,
      // 截屏：主进程取宠物所在屏的一帧（JPEG base64），形状与上传图片一致。
      capture: async () => {
        const bridge = (window as unknown as {
          dshPet?: { captureScreen?: () => Promise<{ mediaType: string; data: string } | null> };
        }).dshPet;
        if (!bridge?.captureScreen) throw new Error("当前环境不支持截屏");
        const shot = await bridge.captureScreen();
        if (!shot) throw new Error("没有取到屏幕画面");
        return {
          base64: shot.data,
          // 主进程固定回 image/jpeg；收窄到白名单类型仅为满足编码结果形状。
          mediaType: shot.mediaType as "image/jpeg",
          previewUrl: `data:${shot.mediaType};base64,${shot.data}`,
        };
      },
      onSend: async (text, attachment) => {
        // 对话配图：把候选池交给 main 拼进 prompt（模型按语境挑一张）。
        const pool = userConfig.chatImageEnabled ? await memePool() : [];
        const result = await window.dshPet?.sendChatMessage({
          message: text,
          imageEnabled: userConfig.chatImageEnabled,
          ...(pool.length > 0 ? { pool } : {}),
          ...(attachment ? { attachment } : {}),
        });
        return result ?? { ok: false };
      },
      onClose: () => {
        chatDialog = null;
        b.setInputBusy(false);
      },
    });
    // 对话期间整窗保持可交互（主进程按 inputBusy 跳过穿透翻转），并把键盘焦点给桌宠窗。
    b.setInputBusy(true);
    b.focusSelf();
  };

  // ───────── 右键菜单（对齐上游 shared/menu/mount.ts） ─────────
  let menu: ContextMenuMount | null = null;

  const closeMenu = (): void => {
    if (!menu) return;
    menu.close();
    menu = null;
    b.setInputBusy(false);
  };

  const runMenuAction = (leaf: MenuLeaf): void => {
    closeMenu();
    // 先试走位（点播移动动作时真的走过去，而不是原地播放）
    if (leaf.anim && animations.moves?.actions.some((m) => m.name === leaf.anim)) {
      if (tryMove(leaf.anim) === false) {
        // 无法移动：退回原地播放该动作
        switchTo(leaf.anim, true);
      }
      return;
    }
    if (leaf.anim) {
      // noMirror（文字类）朝右时是镜像的：点播前强制朝左（left = 素材原样），避免文字颠倒。
      if (facing === "right" && isNoMirrorAnimation(animations.categories, leaf.anim)) {
        applyFacing("left");
      }
      switchTo(leaf.anim, true);
      return;
    }
    if (leaf.action === "open-app") {
      // 上游「打开软件」：显式动作，恢复并聚焦主窗（点击宠物不会触发）。
      b.openApp();
      return;
    }
    if (leaf.action === "whisper-request") {
      // 上游「碎碎念」：立即生成一句（whisperEnabled 门控在 main 侧）。
      // 配图先抽好，名字写进 prompt；回复只带同一个名字，避免图文对不上。
      void randomMemeName().then((meme) => b.requestWhisper(meme ? { meme } : undefined));
      return;
    }
    if (leaf.action === "open-chat") {
      // 上游「对话」：在宠物右上角开输入弹窗；回复走气泡，不在这里。
      if (myPet().whisperEnabled) {
        setTip(false);
        openChatDialog();
      }
      return;
    }
    if (leaf.action === "reload") {
      // 上游「重载配置」：重读配置并重建悬浮窗。
      b.reload();
      return;
    }
    if (leaf.action === "set-display") {
      // 上游「显示位置」：改本宠物的 display；都不 = 收起本窗（恢复入口在设置页）。
      const display = leaf.display ?? "desktop";
      void b.setConfig({
        pets: userConfig.pets.map((pet) => (pet.id === myPetId ? { ...pet, display } : pet)),
      });
      return;
    }
    if (leaf.action === "home") {
      const anchor = anchorFromConfig();
      if (!anchor) return;
      pos = anchor;
      // 上游 goHome 只停运动并归位，不换动画。
      pushBounds();
      return;
    }
  };

  /**
   * 右键菜单「动作」树只列**已下载**的动作。
   *
   * 完整素材是按需下载的，菜单里列一个没缓存的动作等于让用户点一次等下载——
   * 慢网下像卡死。内置 8 个核心动作永远在，所以即使一条都没下载，菜单也不会空。
   *
   * 缓存列表要经 IPC 取，而 openMenu 是同步的：先取再挂载。IPC 往返在本机是
   * 亚毫秒级，但菜单是用户主动操作，宁可慢一帧也不要弹出残缺的列表。
   */
  /**
   * 内置的 8 个核心动作名：随包发布，永远在右键菜单里。
   *
   * 必须与 `main/dshPetAssets.ts` 的 `BUNDLED_ACTIONS` 保持一致——那边用它跳过
   * 下载，这边用它保证菜单不为空。两边不一致会导致菜单列出没缓存的动作。
   */
  const BUNDLED_ACTION_NAMES = [
    "待机呼吸休闲",
    "东张西望",
    "被鼠标拖拽悬空反馈",
    "点击回应-开心跃动",
    "点击回应-害羞惊讶",
    "点击回应-傲娇生气",
    "点击回应-挠痒咯咯笑",
    "点击回应-元气挥手",
  ] as const;

  const availableActions = async (): Promise<Set<string>> => {
    const available = new Set<string>(BUNDLED_ACTION_NAMES);
    if (!b.assets) return available;
    try {
      for (const name of await b.assets.cached()) available.add(name);
    } catch {
      // 取不到就只列内置：宁可少列，不列点了要等下载的。
    }
    return available;
  };

  /** 用可用动作集合过滤动画池；空池由 buildMenuTree 自动省略。 */
  const filterAnimations = (available: Set<string>): Parameters<typeof buildMenuTree>[0] => {
    const keep = (names: readonly string[]): string[] =>
      names.filter((name) => available.has(name));
    const events: Record<string, EventSlot[]> = {};
    for (const [key, pool] of Object.entries(animations.events ?? {})) {
      const filtered = pool.filter((slot) =>
        typeof slot === "string" ? available.has(slot) : true,
      );
      if (filtered.length > 0) events[key] = filtered;
    }
    return {
      idle: keep(animations.idle),
      turn: keep(animations.turn),
      drag: keep(animations.drag),
      clicks: keep(animations.clicks),
      events,
      categories: (animations.categories ?? []).map((category) => ({
        ...category,
        actions: keep(category.actions),
      })),
      ...(animations.moves
        ? {
            moves: {
              ...animations.moves,
              actions: animations.moves.actions.filter((action) =>
                available.has(action.name),
              ),
            },
          }
        : {}),
    };
  };

  /** 等主进程真正把窗口挪/撑到位（IPC + setBounds 异步），避免菜单先在旧原点画一帧再跳。 */
  const openMenu = (clientX: number, clientY: number): void => {
    // 上游 onContextMenu：拖拽中 / 菜单已开着时不再开新菜单。
    if (dragging || menu) return;
    // 根菜单顺序对齐上游 onContextMenu：工具项在前，「动作」树在最后。
    const baseNodes: MenuNode[] = [
      { label: "打开 XCode", action: "open-app" },
      { label: "碎碎念", action: "whisper-request", hint: myPet().whisperEnabled ? undefined : "未开启" },
      { label: "对话", action: "open-chat", hint: myPet().whisperEnabled ? "T 键" : "未开启" },
      { label: "回到初始位置", action: "home" },
      {
        label: "显示位置",
        children: [
          { label: "仅桌面", action: "set-display", display: "desktop" },
          { label: "都不", action: "set-display", display: "none" },
        ],
      },
      { label: "重载配置", action: "reload" },
    ];
    const mount = (nodes: MenuNode[]): void => {
      stopThrow(); // 菜单弹出前停住飞行中的宠物
      stopWalk(); // 菜单悬停期间宠物不漫游
      setTip(false); // 菜单期间提示让位，不跟浮层抢注意力
      b.setInputBusy(true);
      // 窗口零移动：菜单是窗口内 DOM，clamp 到「窗口 ∩ 工作区」，宠物贴边时也不会溢出屏幕。
      menu = mountContextMenu({
        tree: nodes,
        x: clientX,
        y: clientY,
        clamp: visibleClampRect() ?? undefined,
        onAction: runMenuAction,
        onClose: () => {
          menu = null;
          b.setInputBusy(false);
        },
      });
    };
    void availableActions().then((available) => {
      // 取列表期间用户可能已经点了别处把菜单关了，或另开了一次菜单。
      if (menu) return;
      mount([...baseNodes, ...buildMenuTree(filterAnimations(available ?? new Set()))]);
    });
  };

  pet.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu(event.clientX, event.clientY);
  });
  /** 权重掷骰 + 分类动作（上游 playIdle：先停走位，再掷骰；链由 ended 驱动，无定时器）。 */
  const playRandom = (): void => {
    stopWalk();
    const kind = rollKind(Math.random(), weights, { fixed: myPet().fixedEnabled });
    // move 档先试走位：成功即已切好走路动作；无法移动（贴边）退回原地分类动作。
    if (kind === "move") {
      const moved = tryMove();
      // 已有运动占用（抛掷中）：重播当前段，别让链断在半路（上游同构）。
      if (moved === true) {
        switchTo(currentAnim, true);
        return;
      }
      if (moved !== false) return;
    }
    if (kind === "idle" || (kind === "turn" && animations.turn.length === 0)) {
      // 空闲链的每一段都播一遍（上游 playOnce）：播完才有下一个 ended 继续掷骰。
      switchTo(animations.idle[Math.floor(Math.random() * animations.idle.length)]!, true);
    } else if (kind === "turn") {
      switchTo(pickSlot(animations.turn, currentAnim), true);
    } else {
      const action = pickCategoryAction(
        animations.categories,
        animations.idle,
        facing,
        currentAnim,
      );
      switchTo(action.name, true);
    }
  };

  const handleEnded = (): void => {
    // 拖拽中动画链不推进（上游同构）。
    if (dragging) return;
    const cue = decideEndedCue({
      animations: {
        idle: animations.idle,
        turn: animations.turn,
        drag: animations.drag,
        clicks: animations.clicks,
        events: animations.events,
      },
      current: currentAnim,
      workState,
    });
    if (cue.kind === "work-rotate") {
      // 非终态多候选档位：继续播下一候选（once），播完再轮换。
      switchTo(cue.anim, true);
      return;
    }
    if (cue.kind === "work-replay") {
      // 非终态档位播完：上游走 resumeWorkStatusAnim（单候选重新进入循环）。
      playAmbient();
      return;
    }
    if (cue.kind === "interaction-done" || cue.kind === "event-done") {
      // 互动/事件动画播完回空闲链（或恢复工作状态循环），不进随机骰子（上游同构）。
      playAmbient();
      return;
    }
    if (cue.kind === "turn") {
      // 转身动画播完才真正切换朝向（上游 playback.js 同构）：镜像在下一段换源时才生效。
      applyFacing(facing === "left" ? "right" : "left");
      playRandom();
      return;
    }
    // random
    playRandom();
  };

  for (const video of videos) video.addEventListener("ended", handleEnded);

  // ───────── 拖拽（过阻尼弹簧跟手） ─────────
  let dragging = false;
  let dragOrigin = { x: 0, y: 0 };
  let dragStartPos = { x: 0, y: 0 };
  let trail: DragSample[] = [];
  let springVel = { x: 0, y: 0 };
  let pointerTarget = { x: 0, y: 0 };
  let dragRaf = 0;
  let lastDragAt = 0;
  /** 弹弓：200ms 内二次按下蓄力，松手按拉距发射（上游 input.js 同构）。 */
  let lastPressAt = 0;
  let slingArmed = false;
  let slingAnchor = { x: 0, y: 0 };

  const stepDragFollow = (): void => {
    if (!dragging) return;
    // 与上游 motion.js 同构：按真实帧间隔积分并封顶 1/30，固定 1/60 会让高刷屏
    // 追得比指针快、低帧率又追不上，手感随帧率漂移。
    const now = performance.now();
    const dt = Math.min((now - lastDragAt) / 1000, 1 / 30);
    lastDragAt = now;
    springVel.x = springStep(springVel.x, pos.x, pointerTarget.x, dt, userConfig.physics.throwPower);
    springVel.y = springStep(springVel.y, pos.y, pointerTarget.y, dt, userConfig.physics.throwPower);
    pos.x += springVel.x * dt;
    pos.y += springVel.y * dt;
    pushBounds();
    dragRaf = requestAnimationFrame(stepDragFollow);
  };

  const stopDragFollow = (): void => {
    cancelAnimationFrame(dragRaf);
    dragRaf = 0;
    springVel = { x: 0, y: 0 };
  };

  // ───────── 抛掷积分 ─────────
  let throwState: ThrowState | null = null;
  let throwRaf = 0;
  let throwing = false;
  let lastThrowAt = 0;

  const stopThrow = (): void => {
    cancelAnimationFrame(throwRaf);
    throwRaf = 0;
    throwState = null;
    throwing = false;
  };

  /** 其他宠物的运动学快照（屏幕坐标），主进程 120ms 一拍广播。 */
  let peers: Array<{
    id: string;
    size: number;
    bottomPad: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    busy: boolean;
  }> = [];
  /** 宠物互撞：飞行方按动量弹开，被撞方经主进程转发新初速（一帧只处理一次）。 */
  const resolvePetCollision = (
    state: ThrowState,
  ): { fvx: number; fvy: number; hvx: number; hvy: number } | null => {
    const myBox = bodyPixelBox({ x: state.x, y: state.y, size: geo.size, bottomPad: geo.bottomPad });
    for (const peer of peers) {
      if (peer.busy) continue;
      const otherBox = bodyPixelBox({
        x: peer.x,
        y: peer.y,
        size: peer.size,
        bottomPad: peer.bottomPad,
      });
      if (!rectsOverlap(myBox, otherBox)) continue;
      const hit = collidePet(
        { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: geo.size },
        { x: peer.x, y: peer.y, vx: peer.vx, vy: peer.vy, size: peer.size },
      );
      if (!hit) continue;
      b.petHit({ targetId: peer.id, vx: hit.hvx, vy: hit.hvy });
      return hit;
    }
    return null;
  };

  const stepThrow = (): void => {
    if (!throwState) return;
    const now = performance.now();
    const dt = Math.min((now - lastThrowAt) / 1000, 0.05);
    lastThrowAt = now;
    const area = roamArea();
    if (!area) {
      stopThrow();
      return;
    }
    const bounds = throwBoundsIn(area, geo.size, geo.sideAllow);
    const prevVy = throwState.vy;
    const result = throwSubsteps(throwState, dt, bounds, userConfig.physics);
    throwState = { x: result.x, y: result.y, vx: result.vx, vy: result.vy };
    if (userConfig.physics.petCollision) {
      // 上游 flight.ts：飞行方按动量弹开，被撞方回调以新初速重新抛出；一帧只处理一次。
      const hit = resolvePetCollision(throwState);
      if (hit) throwState = { x: throwState.x, y: throwState.y, vx: hit.fvx, vy: hit.fvy };
    }
    pos = { x: throwState.x, y: throwState.y };
    pushBounds();
    if (result.bounced && prevVy > 0 && Math.abs(prevVy) > 200) {
      startSquash(landingSquash(Math.abs(prevVy)));
    }
    if (result.atRest) {
      stopThrow();
      pushBounds();
      playAmbient();
      return;
    }
    throwRaf = requestAnimationFrame(stepThrow);
  };

  const startThrow = (vx: number, vy: number): void => {
    stopWalk();
    throwState = { x: pos.x, y: pos.y, vx, vy };
    throwing = true;
    lastThrowAt = performance.now();
    cancelAnimationFrame(throwRaf);
    throwRaf = requestAnimationFrame(stepThrow);
  };

  // ───────── 落地/点击挤压（Q 弹） ─────────
  let squashRaf = 0;
  const startSquash = (amount: number): void => {
    const squashStart = performance.now();
    cancelAnimationFrame(squashRaf);
    stage.style.transformOrigin = "50% 100%";
    const tick = (): void => {
      const u = (performance.now() - squashStart) / SQ_DURATION_MS;
      if (u >= 1) {
        stage.style.transform = "";
        squashRaf = 0;
        return;
      }
      stage.style.transform = `scaleY(${squashScale(u, amount).toFixed(3)})`;
      squashRaf = requestAnimationFrame(tick);
    };
    squashRaf = requestAnimationFrame(tick);
  };

  // ───────── 指针交互 ─────────
  pet.style.pointerEvents = "auto";
  pet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // 指针捕获失败不应中断拖拽（合成事件/已释放的 pointerId 会抛 NotFoundError）。
    try {
      pet.setPointerCapture(event.pointerId);
    } catch {
      /* 捕获失败：后续事件仍冒泡到 pet，拖拽照常工作 */
    }
    b.setInputBusy(true);
    // 命中区守卫（主进程已按命中区放行；这里防余量区误触）
    const localX = ((event.clientX - geo.margin.l) / geo.size) * CANVAS_W;
    const localY = ((event.clientY - geo.margin.t - geo.bottomPad) / geo.height) * CANVAS_H;
    if (localX < HIT_BOX.x0 || localX > HIT_BOX.x1 || localY < HIT_BOX.y0 || localY > HIT_BOX.y1) {
      b.setInputBusy(false);
      return;
    }
    // 点击积分：按下瞬间即触发（不等松开）——读 stopThrow 之前的飞行速度，达标就爆发 + 弹窗。
    pressScoreFired = false;
    if (throwState && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      const grabSpeed = Math.hypot(throwState.vx, throwState.vy);
      if (grabSpeed >= SCORE_MIN_SPEED) {
        pressScoreFired = true;
        spawnScoreBurst(event.clientX, event.clientY);
        mountScorePopup({
          x: event.clientX,
          y: event.clientY,
          score: clickScore(grabSpeed, myPet().size),
          speed: grabSpeed,
          size: myPet().size,
        });
      }
    }
    stopThrow();
    stopWalk();
    setTip(false); // 拖拽期间指针始终在身体内，不收提示会跟着宠物一路飘
    pet.style.cursor = CURSOR_GRABBING;
    dragging = true;
    // 上游拖拽时舞台取消脚垫位移：气泡的锚点补偿同步取消（视觉上贴得更近）。
    bubbleEl.classList.add("is-dragging");
    // 增量必须用 screenX/screenY（上游 input.js 同构）：屏幕坐标与窗口位置无关，
    // 窗口逐帧跟手不会反过来影响指针读数。clientX 是相对窗口的，窗口一动它就变，
    // 把「窗口已经追上的距离」从目标里又减掉一次，表现为拖拽只跟一半、越拖越黏。
    const pressNow = performance.now();
    slingArmed = pressNow - lastPressAt < SLINGSHOT_DOUBLE_MS;
    lastPressAt = slingArmed ? 0 : pressNow; // 命中就清掉，免得连点三下弹两次
    slingAnchor = { x: pos.x + geo.size / 2, y: pos.y + geo.height / 2 };
    dragOrigin = { x: event.screenX, y: event.screenY };
    dragStartPos = { x: pos.x, y: pos.y };
    trail = [{ t: performance.now(), x: event.screenX, y: event.screenY }];
    pointerTarget = { x: pos.x, y: pos.y };
    lastDragAt = performance.now();
    if (animations.drag.length) switchTo(pickSlot(animations.drag), false);
    cancelAnimationFrame(dragRaf);
    dragRaf = requestAnimationFrame(stepDragFollow);
  });

  pet.addEventListener("pointermove", (event) => {
    if (dragging) {
      const now = performance.now();
      trail.push({ t: now, x: event.screenX, y: event.screenY });
      trail = trimTrail(trail, now);
      pointerTarget = {
        x: dragStartPos.x + (event.screenX - dragOrigin.x),
        y: dragStartPos.y + (event.screenY - dragOrigin.y),
      };
      // 拖拽不改朝向（上游同构）：镜像只在转身动画播完后切换。
      return;
    }
    // 悬浮提示与可交互判定同源（同一个 inBody）：进身体出现，离开收起（上游 input.js 同构）。
    const localX = ((event.clientX - geo.margin.l) / geo.size) * CANVAS_W;
    const localY = ((event.clientY - geo.margin.t - geo.bottomPad) / geo.height) * CANVAS_H;
    const inBody =
      localX >= HIT_BOX.x0 &&
      localX <= HIT_BOX.x1 &&
      localY >= HIT_BOX.y0 &&
      localY <= HIT_BOX.y1;
    if (inBody) tipCursor = { x: event.clientX, y: event.clientY };
    setTip(inBody);
    if (tipOn) renderTip();
  });

  // 悬停时按 T 打开对话（上游 chat/hotkey.ts 同构）；拖图落到宠物上直接带图开弹窗。
  document.addEventListener(
    "keydown",
    (event) => {
      if (!tipOn || dragging) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== "t" && event.key !== "T") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      event.preventDefault();
      openChatDialog();
    },
    true,
  );
  pet.addEventListener("dragover", (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes("Files")) return;
    // 不拦默认行为的话，浏览器会把这个文件当导航打开，页面直接被换掉。
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  pet.addEventListener("drop", (event) => {
    const files = event.dataTransfer?.files;
    const file = files && files[0];
    if (!file) return;
    event.preventDefault();
    openChatDialog(file);
  });

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    bubbleEl.classList.remove("is-dragging");
    stopDragFollow();
    pet.style.cursor = CURSOR_GRAB;
    b.setInputBusy(false);
    const moved = Math.hypot(event.screenX - dragOrigin.x, event.screenY - dragOrigin.y);
    const velocity = estimateReleaseVelocity(trail, performance.now(), userConfig.physics);
    trail = [];

    if (moved < DRAG_THRESHOLD && !pressScoreFired) {
      // 点击：点击音效 + 点击回应 + 挤压（上游 drag.ts 同构；不打开/聚焦 XCode）
      playClickSound();
      if (animations.clicks.length) switchTo(pickSlot(animations.clicks, currentAnim), true);
      startSquash(0.55);
      return;
    }
    if (moved < DRAG_THRESHOLD && pressScoreFired) {
      // 空中抓取被点过积分：松手按普通放下收尾，不播普通点击动画（上游同语义）。
      pushBounds();
      playAmbient();
      return;
    }
    if (slingArmed) {
      // 弹弓：力度 = 拉距（与手速无关），弹的是拉的反方向；拉向量用宠物实际中心算
      // （弹簧有滞后，用户看到的是宠物被拉出去多远）。之后与甩抛走同一条 startThrow。
      const pullX = pos.x + geo.size / 2 - slingAnchor.x;
      const pullY = pos.y + geo.height / 2 - slingAnchor.y;
      const rawPower = slingshotPower(Math.hypot(pullX, pullY), geo.size);
      const v = slingshotVelocity(pullAngle(pullX, pullY), rawPower, userConfig.physics.throwPower);
      trail = [];
      startThrow(v.vx, v.vy);
      return;
    }
    if (velocity) {
      startThrow(velocity.vx, velocity.vy);
      return;
    }
    pushBounds();
    playAmbient();
  };

  pet.addEventListener("pointerup", endDrag);
  pet.addEventListener("pointercancel", endDrag);

  // ───────── 主进程事件 ─────────
  // 设置页保存后主进程会广播整包配置：桌宠窗实时生效（上游桌面端靠重启 helper 达到同样的效果）。
  b.onConfig((next) => {
    const beforePet = userConfig.pets.find((pet) => pet.id === myPetId);
    userConfig = next;
    // 宠物包切换：素材与动作集在启动时装配，直接重载本窗（与上游重启 helper 同语义）。
    if ((beforePet?.packId ?? "") !== (myPet().packId ?? "")) {
      location.reload();
      return;
    }
    setClickSoundEnabled(next.clickSoundEnabled);
    const nextSize = myPet().size;
    if (nextSize !== size) {
      size = nextSize;
      applyStageLayout();
      pushBounds();
    }
    applyBubbleFont();
    // 位置配置变了（角落 / 偏移）：上游保存会重建窗口并回角落，这里等价地重新钉一次。
    const now = myPet().position;
    if (
      !beforePet ||
      beforePet.position.corner !== now.corner ||
      beforePet.position.marginX !== now.marginX ||
      beforePet.position.marginY !== now.marginY
    ) {
      const anchor = anchorFromConfig();
      if (anchor) {
        stopThrow();
        stopWalk();
        pos = anchor;
        pushBounds();
      }
    }
  });

  b.onHostEvent((payload) => {
    if (payload.type === "displays") {
      areas = (payload.displays as DisplayArea[]) ?? [];
      if (payload.config && typeof payload.config === "object") {
        userConfig = payload.config as DshPetUserConfig;
      }
      if (typeof payload.petId === "string" && payload.petId) {
        myPetId = payload.petId;
      }
      // 上游不持久化运行位置：每次启动都回配置的角落（position.corner + marginX/marginY）。
      const anchor = anchorFromConfig();
      if (anchor) pos = anchor;
      pushBounds();
      playAmbient();
      return;
    }
    if (payload.type === "size") {
      size = Number(payload.sizePx) || size;
      applyStageLayout();
      pushBounds();
      return;
    }
    if (payload.type === "force-release-input") {
      if (dragging) {
        dragging = false;
        bubbleEl.classList.remove("is-dragging");
        stopDragFollow();
      }
      setTip(false);
      b.setInputBusy(false);
      return;
    }
    if (payload.type === "pointer-exit-body") {
      // 窗口转穿透后渲染层收不到后续 pointermove：光标离开身体由主进程补发本事件收提示。
      setTip(false);
      return;
    }
    if (payload.type === "peers") {
      peers = Array.isArray(payload.peers)
        ? (payload.peers as typeof peers).filter(
            (peer) => peer && typeof peer.id === "string" && Number.isFinite(peer.x),
          )
        : [];
      return;
    }
    if (payload.type === "pet-hit") {
      // 上游 flight onHit：被撞方以新初速从当前落点重新抛出。
      const vx = Number(payload.vx);
      const vy = Number(payload.vy);
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || dragging) return;
      stopWalk();
      startThrow(vx, vy);
      return;
    }
    if (payload.type === "whisper") {
      // 碎碎念：气泡（10s）+ 碎碎念动画一次 + 随机配图（whisperImageEnabled）。
      const text = String(payload.text ?? "").trim();
      if (!text) return;
      // 配图用 main 回传的同一张（渲染层抽图后随请求带上）；老版本/异常时退回随机抽。
      const image = typeof payload.image === "string" && payload.image ? memePathOf(payload.image) : null;
      void (image ? Promise.resolve(image) : randomMemeName().then((name) => (name ? memePathOf(name) : null))).then(
        (meme) => {
          showBubble(text, { durationMs: 10_000, image: meme, variant: "whisper" });
          const pool = animations.events.whisper ?? [];
          const slot = pool[0];
          if (slot) switchTo(pickSlot(slot, currentAnim), true);
        },
      );
      return;
    }
    if (payload.type === "chat-reply") {
      // 上游：回复统一以气泡展示（对话弹窗发送成功即关），配图跟着气泡走。
      const text = String(payload.text ?? "").trim();
      if (!text) return;
      const image = typeof payload.image === "string" && payload.image ? payload.image : null;
      showBubble(text, { durationMs: 10_000, image: image ? memePathOf(image) : null });
      return;
    }
    if (payload.type === "state") {
      // 关掉「工作状态联动」后完全免疫（上游 workStatusEnabled 语义）。
      const nextWork = myPet().workStatusEnabled
        ? behaviorStateToWorkStatus(String(payload.state ?? "idle"))
        : null;
      if (nextWork !== workState) {
        workState = nextWork;
        if (!dragging && !throwing) {
          stopWalk();
          if (workState !== null) {
            playWorkStatus(workState);
            showWorkBubble(workState);
          } else if (poolIncludes(animations.events.workStatus ?? [], currentAnim)) {
            // 回空闲：正播档位动画就让它播完（循环的改成播完即停），由 ended 接回空闲链
            // （上游 onWorkTick 同构）。不在这里抢断，否则多候选档位会被腰斩。
            const frontVideo = videos[front];
            if (frontVideo?.loop) frontVideo.loop = false;
            // 回空闲：常驻气泡由 ended 链收回；这里直接收（上游 renderBubble 同步收起）。
            hideBubble();
          } else {
            playAmbient();
            hideBubble();
          }
        }
      }
    }
  });


  // 监听已就绪：请求显示器几何（did-finish-load 早于本处注册，不能依赖它）。
  b.ready();

  // 诊断探针：走位/物理的状态只体现在窗口 bounds 上，DOM 里看不到，
  // 排查「动画在播但没位移」这类问题时需要一个读点。
  (window as unknown as { __dshPetDebug?: () => unknown }).__dshPetDebug = () => ({
    pos,
    geo: { size: geo.size, window: geo.window, sideAllow: geo.sideAllow },
    areas: areas.map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height })),
    currentAnim,
    walkRaf,
    hasPendingMove: pendingMove !== null,
    dragging,
    throwing,
    dragOrigin,
    dragTarget: pointerTarget,
    workState,
    facing,
    config: userConfig,
    mirror: facing === "right",
    videoTransforms: videos.map((video) => video.style.transform),
    containerTransform: pet.style.transform,
  });

  // 供未来按需使用（保持导入不被裁掉）
  void FEET_Y;
}
