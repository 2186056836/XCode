/**
 * DSH 桌宠用户配置（1:1 对齐 dsh-pet 的 main-config 字段与设置页语义）。
 *
 * 上游设置页（src/client/settings/*）管理的字段全部收进这份配置：
 *   - pets[]：每只宠物的实例字段（名字 / 大小 / 显示位置 / 位置 / 偏移 / 四个功能开关 / 实例人设）；
 *   - 顶层全局：通知 / 点击音效 / 碎碎念配图 / 对话配图 / 锁屏 / 托盘 / 对话上下文 / 模型选择 /
 *     physics / font / eventsRefreshSec / animationWeights。
 *
 * 与上游的差异只有一处：XCode 桌宠没有浏览器 overlay，`display` 的「仅网页」对桌面无意义，
 * 但字段保留（面板仍展示四个选项），渲染端按 desktop/both 显示窗口。
 *
 * 纯数据层：不碰 DOM、不碰 Electron，主进程与渲染层共用同一份规范化与校验。
 */
import { DEFAULT_PHYSICS, type PhysicsParams } from "./dshPetCore.js";

/** 宠物贴着的屏幕角落（上游 shared/types.ts 的 Corner）。 */
export type DshPetCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** 显示位置（上游 PetDisplay）。 */
export type DshPetDisplay = "web" | "desktop" | "both" | "none";

export const DSH_PET_CORNERS: readonly DshPetCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export interface DshPetPosition {
  corner: DshPetCorner;
  marginX: number;
  marginY: number;
}

/** 一只宠物的实例字段（上游 pets[] 条目的可编辑子集）。 */
export interface DshPetEntry {
  id: string;
  name: string;
  size: number;
  balanceEnabled: boolean;
  whisperEnabled: boolean;
  workStatusEnabled: boolean;
  fixedEnabled: boolean;
  display: DshPetDisplay;
  position: DshPetPosition;
  /** 实例级人设（pets[].whisperPrompt）：空 = 跟随条目级 whisperPrompt。 */
  whisperPrompt?: string;
  /**
   * 自制宠物包（pet-maker 产出，userData/dsh-pet/packs/<packId>/）：空 = 内置蓝毛小女仆。
   * 包内 *-config.json 的 animations/workStatusTexts 覆盖内置素材，webm 走授权媒体协议。
   */
  packId?: string;
}

export interface DshPetFontConfig {
  family: string;
  size: number;
  followPet: boolean;
}

export interface DshPetModelSelection {
  provider: string;
  model: string;
}

export interface DshPetEventsRefreshSec {
  balance: number;
  whisper: number;
}

export interface DshPetUserConfig {
  /**
   * 桌宠总开关。false = 不创建任何宠物窗口（首次启动默认值）。
   * 与每只宠物的 display 正交：display 决定「开关打开时显示在哪」，enabled 决定「是否运行」。
   */
  enabled: boolean;
  pets: DshPetEntry[];
  /** 条目级人设（main 顶层 whisperPrompt）。 */
  whisperPrompt: string;
  notificationsEnabled: boolean;
  clickSoundEnabled: boolean;
  whisperImageEnabled: boolean;
  chatImageEnabled: boolean;
  confineToScreen: boolean;
  trayEnabled: boolean;
  chatMemoryRounds: number;
  chatImageLimit: number;
  whisperModel: DshPetModelSelection;
  chatModel: DshPetModelSelection;
  physics: PhysicsParams;
  font: DshPetFontConfig;
  eventsRefreshSec: DshPetEventsRefreshSec;
  animationWeights: { idle: number; turn: number; move: number };
}

/** 尺寸输入边界（上游设置页：step 10、min 120）。 */
export const DSH_PET_SIZE_MIN = 120;
export const DSH_PET_SIZE_MAX = 1200;
export const DSH_PET_SIZE_STEP = 10;
/** 字号合法区间（上游 shared/fonts.ts）。 */
export const DSH_PET_FONT_SIZE_MIN = 4;
export const DSH_PET_FONT_SIZE_MAX = 200;

/** 字体预设（上游 shared/fonts.ts FONT_PRESETS 同 id 同顺序）。 */
export const DSH_PET_FONT_PRESETS: readonly { id: string; stack: string }[] = [
  {
    id: "candy",
    stack: '"ShangshouSoftCandy","Yuanti SC","YouYuan","幼圆","Comic Sans MS","PingFang SC","Microsoft YaHei",sans-serif',
  },
  { id: "yahei", stack: '"Microsoft YaHei","PingFang SC",sans-serif' },
  { id: "youyuan", stack: '"YouYuan","Yuanti SC",sans-serif' },
  { id: "kaiti", stack: '"KaiTi","STKaiti",serif' },
  { id: "simsun", stack: '"SimSun","Songti SC",serif' },
  { id: "comic", stack: '"Comic Sans MS","Comic Sans",cursive' },
  { id: "system", stack: "system-ui,sans-serif" },
];

/** 上游 assets/config.jsonc 的默认值（文案逐字保留）。 */
export const DSH_PET_DEFAULT_WHISPER_PROMPT =
  "你是主人桌面上的Q版蓝发小女仆，会时不时碎碎念一句。说话要自然随意、短短一句（20字以内），温柔乖巧带点俏皮，说人话不啰嗦，不要解释你自己，不要提你是AI。";

export const DSH_PET_DEFAULT_CONFIG: DshPetUserConfig = {
  /** 是否默认唤出桌宠；false = 首次启动不显示任何宠物窗口，用户显式开启后才生效。 */
  enabled: false,
  pets: [
    {
      id: "main",
      name: "蓝毛小女仆",
      size: 462,
      balanceEnabled: true,
      whisperEnabled: true,
      workStatusEnabled: true,
      fixedEnabled: false,
      display: "desktop",
      position: { corner: "top-right", marginX: 24, marginY: 100 },
    },
  ],
  whisperPrompt: DSH_PET_DEFAULT_WHISPER_PROMPT,
  notificationsEnabled: true,
  clickSoundEnabled: false,
  whisperImageEnabled: true,
  chatImageEnabled: true,
  confineToScreen: false,
  trayEnabled: true,
  chatMemoryRounds: 5,
  chatImageLimit: 10,
  whisperModel: { provider: "", model: "" },
  chatModel: { provider: "", model: "" },
  physics: { ...DEFAULT_PHYSICS },
  font: { family: "candy", size: 21, followPet: true },
  eventsRefreshSec: { balance: 1800, whisper: 300 },
  animationWeights: { idle: 10, turn: 5, move: 5 },
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const booleanOf = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const cornerOf = (value: unknown, fallback: DshPetCorner): DshPetCorner =>
  typeof value === "string" && (DSH_PET_CORNERS as readonly string[]).includes(value)
    ? (value as DshPetCorner)
    : fallback;

const displayOf = (value: unknown, fallback: DshPetDisplay): DshPetDisplay =>
  value === "web" || value === "desktop" || value === "both" || value === "none"
    ? value
    : fallback;

const modelOf = (value: unknown, fallback: DshPetModelSelection): DshPetModelSelection => {
  const rec = (value ?? {}) as Record<string, unknown>;
  return {
    provider: typeof rec.provider === "string" ? rec.provider : fallback.provider,
    model: typeof rec.model === "string" ? rec.model : fallback.model,
  };
};

/** 物理参数规范化：钳到上游校验允许的取值域。 */
export function normalizePhysics(raw: Partial<PhysicsParams> | undefined): PhysicsParams {
  const base = DEFAULT_PHYSICS;
  return {
    gravity: Math.max(0, finiteNumber(raw?.gravity, base.gravity)),
    restitution: clamp(finiteNumber(raw?.restitution, base.restitution), 0, 1),
    groundFriction: Math.max(0, finiteNumber(raw?.groundFriction, base.groundFriction)),
    throwPower: Math.max(0.01, finiteNumber(raw?.throwPower, base.throwPower)),
    ceilingBounce: booleanOf(raw?.ceilingBounce, base.ceilingBounce),
    petCollision: booleanOf(raw?.petCollision, base.petCollision),
  };
}

function normalizeEntry(raw: Record<string, unknown>, index: number): DshPetEntry {
  const base = DSH_PET_DEFAULT_CONFIG.pets[0]!;
  const position = (raw.position ?? {}) as Record<string, unknown>;
  const size = Math.round(
    clamp(finiteNumber(raw.size, base.size), DSH_PET_SIZE_MIN, DSH_PET_SIZE_MAX),
  );
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : `pet-${index + 1}`,
    name: typeof raw.name === "string" ? raw.name.slice(0, 50) : "",
    size,
    balanceEnabled: booleanOf(raw.balanceEnabled, base.balanceEnabled),
    whisperEnabled: booleanOf(raw.whisperEnabled, base.whisperEnabled),
    workStatusEnabled: booleanOf(raw.workStatusEnabled, base.workStatusEnabled),
    fixedEnabled: booleanOf(raw.fixedEnabled, base.fixedEnabled),
    // XCode 没有浏览器 overlay，显示位置只剩 桌面 / 不显示；旧值 web / both 归一为桌面。
    display:
      displayOf(raw.display, base.display) === "web" || displayOf(raw.display, base.display) === "both"
        ? "desktop"
        : displayOf(raw.display, base.display),
    position: {
      corner: cornerOf(position.corner, base.position.corner),
      marginX: Math.round(finiteNumber(position.marginX, base.position.marginX)),
      marginY: Math.round(finiteNumber(position.marginY, base.position.marginY)),
    },
    whisperPrompt: typeof raw.whisperPrompt === "string" ? raw.whisperPrompt : undefined,
    packId: typeof raw.packId === "string" ? raw.packId.trim() : "",
  };
}

/** 把磁盘上任意形状的旧配置读成完整配置（缺字段回落默认值）。 */
export function normalizeDshPetConfig(
  raw: Record<string, unknown> | null | undefined,
): DshPetUserConfig {
  const source = raw ?? {};
  // 字段缺失（新装 / 旧配置）才回落默认宠物；显式空数组是用户主动删空，必须保持为空。
  const pets = Array.isArray(source.pets)
    ? source.pets
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item, index) => normalizeEntry(item, index))
    : DSH_PET_DEFAULT_CONFIG.pets.map((pet) => ({ ...pet, position: { ...pet.position } }));
  // 总开关：旧配置缺字段按「关闭」处理，避免老版本已有的宠物在升级后自动弹出。
  const enabled = source.enabled === true;
  const weights = (source.animationWeights ?? {}) as Record<string, unknown>;
  const refresh = (source.eventsRefreshSec ?? {}) as Record<string, unknown>;
  const fontRaw = (source.font ?? {}) as Record<string, unknown>;
  return {
    enabled,
    pets,
    whisperPrompt:
      typeof source.whisperPrompt === "string"
        ? source.whisperPrompt
        : DSH_PET_DEFAULT_CONFIG.whisperPrompt,
    notificationsEnabled: booleanOf(source.notificationsEnabled, true),
    clickSoundEnabled: booleanOf(source.clickSoundEnabled, false),
    whisperImageEnabled: booleanOf(source.whisperImageEnabled, true),
    chatImageEnabled: booleanOf(source.chatImageEnabled, true),
    confineToScreen: booleanOf(source.confineToScreen, false),
    trayEnabled: booleanOf(source.trayEnabled, true),
    chatMemoryRounds: Math.max(0, Math.round(finiteNumber(source.chatMemoryRounds, 5))),
    chatImageLimit: Math.max(0, Math.round(finiteNumber(source.chatImageLimit, 10))),
    whisperModel: modelOf(source.whisperModel, DSH_PET_DEFAULT_CONFIG.whisperModel),
    chatModel: modelOf(source.chatModel, DSH_PET_DEFAULT_CONFIG.chatModel),
    physics: normalizePhysics(source.physics as Partial<PhysicsParams> | undefined),
    font: {
      family: typeof fontRaw.family === "string" ? fontRaw.family : "candy",
      size: clamp(
        Math.round(finiteNumber(fontRaw.size, 21)),
        DSH_PET_FONT_SIZE_MIN,
        DSH_PET_FONT_SIZE_MAX,
      ),
      followPet: booleanOf(fontRaw.followPet, true),
    },
    eventsRefreshSec: {
      balance: Math.max(1, Math.round(finiteNumber(refresh.balance, 1800))),
      whisper: Math.max(1, Math.round(finiteNumber(refresh.whisper, 300))),
    },
    animationWeights: {
      idle: clamp(Math.round(finiteNumber(weights.idle, 10)), 0, 100),
      turn: clamp(Math.round(finiteNumber(weights.turn, 5)), 0, 100),
      move: clamp(Math.round(finiteNumber(weights.move, 5)), 0, 100),
    },
  };
}

/**
 * 表单校验（上游 config/validate-form.ts 同语义）：返回 null 表示合法，
 * 否则返回文案键，由面板换成对应提示。
 */
export function validateDshPetForm(
  draft: DshPetUserConfig,
): "invalid" | "invalidPhysics" | "invalidFont" | "invalidModel" | "invalidChatMemory" | "invalidChatImageLimit" | null {
  if (draft.pets.some((pet) => !Number.isFinite(pet.size) || pet.size <= 0)) return "invalid";
  if (
    draft.pets.some(
      (pet) => !Number.isFinite(pet.position.marginX) || !Number.isFinite(pet.position.marginY),
    )
  ) {
    return "invalid";
  }
  const { gravity, restitution, groundFriction, throwPower } = draft.physics;
  if (
    !Number.isFinite(gravity) ||
    gravity < 0 ||
    !Number.isFinite(groundFriction) ||
    groundFriction < 0 ||
    !Number.isFinite(restitution) ||
    restitution < 0 ||
    restitution > 1 ||
    !Number.isFinite(throwPower) ||
    throwPower <= 0
  ) {
    return "invalidPhysics";
  }
  if (
    !Number.isFinite(draft.font.size) ||
    draft.font.size < DSH_PET_FONT_SIZE_MIN ||
    draft.font.size > DSH_PET_FONT_SIZE_MAX ||
    !DSH_PET_FONT_PRESETS.some((preset) => preset.id === draft.font.family)
  ) {
    return "invalidFont";
  }
  const pairValid = (selection: DshPetModelSelection): boolean =>
    Boolean(selection.provider) === Boolean(selection.model);
  if (!pairValid(draft.whisperModel) || !pairValid(draft.chatModel)) return "invalidModel";
  if (!Number.isFinite(draft.chatMemoryRounds) || draft.chatMemoryRounds < 0) return "invalidChatMemory";
  if (!Number.isFinite(draft.chatImageLimit) || draft.chatImageLimit < 0) return "invalidChatImageLimit";
  return null;
}

/** 生成一个未占用的宠物 id（上游 pet-draft.ts nextPetId：main 沿用 pet-N，从 2 起）。 */
export function nextPetId(list: readonly { id: string }[], kind = "main"): string {
  const prefix = kind === "main" ? "pet" : kind;
  for (let n = 2; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!list.some((pet) => pet.id === id)) return id;
  }
}

/** 按模板造一只新宠物的草稿（上游 pet-draft.ts draftPet：身份换成新 id，其余跟着模板）。 */
export function draftPet(template: DshPetEntry, id: string): DshPetEntry {
  return {
    id,
    name: id,
    size: template.size,
    balanceEnabled: template.balanceEnabled,
    whisperEnabled: template.whisperEnabled,
    workStatusEnabled: template.workStatusEnabled,
    fixedEnabled: template.fixedEnabled,
    display: template.display,
    position: { ...template.position },
  };
}
