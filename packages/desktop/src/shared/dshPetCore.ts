/**
 * DSH 桌宠核心纯逻辑（源码级移植自 PC2005-cloud/dsh-pet，MIT）。
 *
 * 逐模块对照关系：
 *   - src/shared/constants.ts          → CANVAS_H / FEET_Y / HIT_BOX / DRAG_THRESHOLD / PET_REF_WIDTH
 *   - src/shared/physics/constants.ts  → 全部弹簧/抛掷/挤压常量
 *   - src/shared/physics/throw.ts      → throwStep / throwBounds / screenOfBox
 *   - src/shared/physics/release.ts    → estimateReleaseVelocity / trimTrail / throwVelocity / 弹弓
 *   - src/shared/physics/squash.ts     → landingSquash / squashScale
 *   - src/shared/physics/spring.ts     → springStep / softClampSpeed
 *   - src/shared/pickers.ts            → pick / pickSlot / rollKind / pickCategoryAction / nextWorkStatusAnim
 *   - src/client/pet/animation/cues.ts → decideEndedCue
 *   - src/client/pet/timings.ts        → BUBBLE_DURATION_MS / 轮询节奏
 *   - src/shared/work-status.ts        → WORK_STATUS_INDEX
 *
 * 本文件不依赖 DOM / Electron，两端（渲染层与主进程）共用同一份，保证手感与决策完全一致。
 */

// ───────────────────────── 画布几何（src/shared/constants.ts） ─────────────────────────
export const CANVAS_H = 360;
export const CANVAS_W = 640;
/** 人物站在 y=330 线上。 */
export const FEET_Y = 330;
/** 点击与拖拽的命中矩形（640×360 画布坐标）。 */
export const HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 } as const;
/** 拖拽判定阈值（px）。 */
export const DRAG_THRESHOLD = 5;
/** 弹弓窗口（ms）：两次按下间隔小于它即按弹弓算。 */
export const SLINGSHOT_DOUBLE_MS = 200;
/** 移动距离缩放基准（px）：配置里的 minDist/maxDist 按此基准等比缩放。 */
export const PET_REF_WIDTH = 462;
/** 窗口外扩比例：左右下余量 = size × 该值。 */
export const WINDOW_MARGIN_RATIO = 0.5;

// ───────────────────────── 物理常量（src/shared/physics/constants.ts） ─────────────────────────
export const SPRING_K = 200;
export const SPRING_C = 30;
export const TRAIL_KEEP_MS = 200;
export const RELEASE_WINDOW_MS = 150;
export const RELEASE_STALE_MS = 150;
export const MIN_SPAN_MS = 20;
export const SEG_MIN_DT_MS = 8;
export const DEAD_ZONE_SPEED = 500;
export const MAX_THROW_SPEED = 3600;
export const PEAK_WEIGHT = 0.5;
export const ACCEL_REF = 8000;
export const ACCEL_GAIN_MAX = 0.6;

export const GRAVITY = 1400;
export const RESTITUTION = 0.78;
export const GROUND_FRICTION = 2.5;
export const DEFAULT_THROW_POWER = 1;
export const REST_VY = 40;
export const REST_VX = 15;
export const MAX_STEP_DT = 0.05;

export const SQ_SQUASH = 0.55;
export const SQ_DURATION_MS = 220;
export const SQ_SOFT_SPEED = 300;
export const SQ_HARD_SPEED = 1500;
export const SQ_MAX_SQUASH = 0.55;
export const THROW_SPEED_ANCHOR = 1200;
export const SLINGSHOT_REF_RATIO = 0.6;
export const SUBSTEP_PX = 8;
export const SUBSTEP_MAX = 64;

// ───────────────────────── 时间常量（src/client/pet/timings.ts） ─────────────────────────
export const BUBBLE_DURATION_MS = 10_000;
export const STATE_WAIT_MS = 1000;
export const STATE_FALLBACK_MS = 1000;

// ───────────────────────── 类型 ─────────────────────────
export interface PhysicsParams {
  gravity: number;
  restitution: number;
  groundFriction: number;
  ceilingBounce: boolean;
  throwPower: number;
  petCollision: boolean;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: GRAVITY,
  restitution: RESTITUTION,
  groundFriction: GROUND_FRICTION,
  ceilingBounce: true,
  throwPower: DEFAULT_THROW_POWER,
  petCollision: false,
};

export interface DragSample {
  t: number;
  x: number;
  y: number;
}

export interface ThrowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ThrowState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ───────────────────────── 弹簧与限速（physics/spring.ts） ─────────────────────────
/** 过阻尼弹簧单轴速度步进：调用方随后 x += v*dt。 */
export function springStep(
  v: number,
  x: number,
  target: number,
  dt: number,
  power: number = DEFAULT_THROW_POWER,
): number {
  return v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;
}

/** 软钳速：cap×(1-e^(-s/cap))，任意速度下单调可区分、渐近不超过 cap。 */
export function softClampSpeed(speed: number): number {
  if (speed <= 0) return 0;
  return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
}

// ───────────────────────── 宠物互撞（physics/collide.ts） ─────────────────────────
/** 碰撞恢复系数：近乎弹性（动量守恒 + 0.995）。 */
export const PET_BOUNCE_E = 0.995;

/** 一只参与碰撞的宠物：位置（包围盒左上角，屏幕 px）+ 速度（px/s）+ 宽（px，质量 ∝ size²）。 */
export interface PetCollider {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

/** 身体包围盒（HIT_BOX 命中框比例换算到屏幕像素）：碰撞相交检测的几何。 */
export const bodyPixelBox = (o: {
  x: number;
  y: number;
  size: number;
  bottomPad: number;
}): { left: number; top: number; right: number; bottom: number } => {
  const h = (o.size * 9) / 16;
  return {
    left: o.x + (HIT_BOX.x0 / CANVAS_W) * o.size,
    top: o.y + o.bottomPad + (HIT_BOX.y0 / CANVAS_H) * h,
    right: o.x + (HIT_BOX.x1 / CANVAS_W) * o.size,
    bottom: o.y + o.bottomPad + (HIT_BOX.y1 / CANVAS_H) * h,
  };
};

/** 两矩形是否相交（碰撞检测）。 */
export const rectsOverlap = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** 飞行中的宠物撞到另一只：动量守恒 + 恢复系数 0.995，质量 ∝ size²。
 *  法向 = 两包围盒中心连线，法向速度按一维动量公式重分配，切向分量各自保留。
 *  返回 null = 中心重合定不出法向，或两者正在分离（避免重叠帧反复弹跳抖动）。 */
export const collidePet = (
  fly: PetCollider,
  hit: PetCollider,
): { fvx: number; fvy: number; hvx: number; hvy: number } | null => {
  const hf = (fly.size * 9) / 16 / 2;
  const hh = (hit.size * 9) / 16 / 2;
  const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
  const cy = hit.y + hh - (fly.y + hf);
  const dist = Math.hypot(cx, cy);
  if (dist < 1e-6) return null;
  const nx = cx / dist;
  const ny = cy / dist;
  // 相对速度在法向的投影（碰撞方向 = fly → hit，正 = 正在接近）
  const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
  if (vrel <= 0) return null;
  const e = PET_BOUNCE_E;
  const m1 = fly.size * fly.size;
  const m2 = hit.size * hit.size;
  const v1n = fly.vx * nx + fly.vy * ny;
  const v2n = hit.vx * nx + hit.vy * ny;
  const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
  const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
  return {
    fvx: fly.vx - v1n * nx + v1n2 * nx,
    fvy: fly.vy - v1n * ny + v1n2 * ny,
    hvx: hit.vx - v2n * nx + v2n2 * nx,
    hvy: hit.vy - v2n * ny + v2n2 * ny,
  };
};

// ───────────────────────── 抛掷边界与积分（physics/throw.ts） ─────────────────────────
/** 由 W/H/size 计算抛掷碰撞边界：身体贴屏幕边缘才反弹。 */
export function throwBounds(o: {
  W: number;
  H: number;
  size: number;
  sideAllow: number;
}): ThrowBounds {
  const h = (o.size * 9) / 16;
  return { minX: -o.sideAllow, minY: 0, maxX: o.W - o.size + o.sideAllow, maxY: o.H - h };
}

/** 同 throwBounds，但基于任意一块工作区矩形（原点不必是 0）。 */
export function throwBoundsIn(area: Rect, size: number, sideAllow: number): ThrowBounds {
  const h = (size * 9) / 16;
  return {
    minX: area.x - sideAllow,
    minY: area.y,
    maxX: area.x + area.width - size + sideAllow,
    maxY: area.y + area.height - h,
  };
}

/**
 * 抛体单步积分与边界反弹。
 * 返回 bounced（本步碰边/落地）与 atRest（贴地且低速，调用方应停止循环）。
 */
export function throwStep(
  s: ThrowState,
  dtRaw: number,
  b: ThrowBounds,
  physics: PhysicsParams = DEFAULT_PHYSICS,
): ThrowState & { bounced: boolean; atRest: boolean } {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
  let { x, y, vx, vy } = s;
  vy += physics.gravity * dt;
  x += vx * dt;
  y += vy * dt;
  let bounced = false;
  if (x < b.minX) {
    x = b.minX;
    vx = Math.abs(vx) * physics.restitution;
    bounced = true;
  } else if (x > b.maxX) {
    x = b.maxX;
    vx = -Math.abs(vx) * physics.restitution;
    bounced = true;
  }
  if (y < b.minY) {
    if (physics.ceilingBounce) {
      y = b.minY;
      vy = Math.abs(vy) * physics.restitution;
      bounced = true;
    }
  } else if (y >= b.maxY) {
    y = b.maxY;
    vx *= Math.max(0, 1 - physics.groundFriction * dt);
    if (Math.abs(vy) < REST_VY) vy = 0;
    else {
      vy = -Math.abs(vy) * physics.restitution;
      bounced = true;
    }
  }
  const onGround = y >= b.maxY - 0.5;
  const atRest = onGround && Math.abs(vy) < REST_VY && Math.abs(vx) < REST_VX;
  return { x, y, vx, vy, bounced, atRest };
}

/** 一帧内按位移拆步积分，避免高速穿透地面。 */
export function throwSubsteps(s: ThrowState, dt: number, b: ThrowBounds, physics: PhysicsParams) {
  const speed = Math.hypot(s.vx, s.vy);
  const steps = Math.min(SUBSTEP_MAX, Math.max(1, Math.ceil((speed * dt) / SUBSTEP_PX)));
  let state = s;
  let bounced = false;
  for (let i = 0; i < steps; i += 1) {
    const result = throwStep(state, dt / steps, b, physics);
    state = { x: result.x, y: result.y, vx: result.vx, vy: result.vy };
    bounced = bounced || result.bounced;
    if (result.atRest) return { ...state, bounced, atRest: true };
  }
  return { ...state, bounced, atRest: false };
}

// ───────────────────────── 松手初速（physics/release.ts） ─────────────────────────
/** 剔除保留窗口外的旧采样。 */
export function trimTrail(trail: DragSample[], now: number): DragSample[] {
  const cutoff = now - TRAIL_KEEP_MS;
  let i = 0;
  while (i < trail.length && trail[i]!.t < cutoff) i += 1;
  return i === 0 ? trail : trail.slice(i);
}

/** 抛掷指令（angle 度 + power）→ 初速度。angle 0 = 正右，逆时针为正。 */
export function throwVelocity(angleDeg: number, power: number): { vx: number; vy: number } {
  const speed = softClampSpeed(power * THROW_SPEED_ANCHOR);
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
}

export function slingshotRefDist(size: number): number {
  return size > 0 ? size * SLINGSHOT_REF_RATIO : 0;
}

export function slingshotPower(dist: number, size: number): number {
  const ref = slingshotRefDist(size);
  if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist)) return 0;
  return dist / ref;
}

/** 拉向量（起点→松手点，y 向下）→ 弹射角度：弹的是拉的反方向。 */
export function pullAngle(pullX: number, pullY: number): number {
  return (Math.atan2(pullY, -pullX) * 180) / Math.PI;
}

/** 弹弓初速（无软上限，任意 power 单调可区分）。 */
export function slingshotVelocity(
  angleDeg: number,
  power: number,
  throwPower: number = DEFAULT_THROW_POWER,
): { vx: number; vy: number } {
  const speed = THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
  if (speed === 0) return { vx: 0, vy: 0 };
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
}

/**
 * 由拖拽轨迹估算松手初速。
 * 方向取窗口首末端点位移（抗抖）；大小 = 端点平均与窗口峰值加权，末段仍在加速时给增益；
 * 再过软钳速、乘 throwPower。返回 null = 温柔放下。
 */
export function estimateReleaseVelocity(
  trail: DragSample[],
  now: number,
  physics: PhysicsParams = DEFAULT_PHYSICS,
): { vx: number; vy: number } | null {
  if (trail.length === 0) return null;
  const last = trail[trail.length - 1]!;
  if (now - last.t > RELEASE_STALE_MS) return null;
  const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
  if (win.length < 2) return null;
  const t0 = win[0]!.t;
  const x0 = win[0]!.x;
  const y0 = win[0]!.y;
  const t1 = win[win.length - 1]!.t;
  const x1 = win[win.length - 1]!.x;
  const y1 = win[win.length - 1]!.y;
  const spanMs = t1 - t0;
  if (spanMs < MIN_SPAN_MS) return null;
  const baseVx = ((x1 - x0) / spanMs) * 1000;
  const baseVy = ((y1 - y0) / spanMs) * 1000;
  const baseSpeed = Math.hypot(baseVx, baseVy);
  if (baseSpeed < 1e-6) return null;
  const segSpeeds: { speed: number; tEnd: number }[] = [];
  let px = x0;
  let py = y0;
  let pt = t0;
  for (const s of win.slice(1)) {
    const dt = s.t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
      px = s.x;
      py = s.y;
      pt = s.t;
    }
  }
  const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
  let accel = 0;
  if (segSpeeds.length >= 2) {
    const lastSeg = segSpeeds[segSpeeds.length - 1]!;
    const firstSeg = segSpeeds[0]!;
    accel =
      (lastSeg.speed - firstSeg.speed) /
      Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, MIN_SPAN_MS / 1000);
  }
  const speedBeforeClamp =
    ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) *
    (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
  const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
  if (speed < DEAD_ZONE_SPEED) return null;
  return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
}

// ───────────────────────── 挤压（physics/squash.ts） ─────────────────────────
export function landingSquash(impactSpeed: number): number {
  const t = Math.min(
    Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0),
    1,
  );
  return Math.min(0.8, 1 - t * (1 - SQ_MAX_SQUASH));
}

/** Q 弹挤压曲线：下压段 ease-in，回弹段 easeOutBack 带回约 4% 过冲。 */
export function squashScale(u: number, squash: number = SQ_SQUASH): number {
  if (u < 0.45) {
    const p = u / 0.45;
    return 1 - (1 - squash) * p * p;
  }
  const p = (u - 0.45) / 0.55;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
}

// ───────────────────────── 随机选择（shared/pickers.ts） ─────────────────────────
/** [min, max) 区间随机整数。 */
export function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/** 从池里等概率抽一个；exclude 避开某个名字（减少连续重复）。 */
export function pick<T>(pool: readonly T[], exclude?: T): T {
  const entries = exclude !== undefined ? pool.filter((n) => n !== exclude) : pool;
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)]!;
}

export type EventSlot = string | readonly string[];

/** 事件档位取值：字符串原样返回；数组随机抽 1 并尽量避开 exclude。 */
export function pickSlot(slot: EventSlot, exclude?: string): string {
  if (typeof slot === "string") return slot;
  const entries = exclude === undefined ? slot : slot.filter((n) => n !== exclude);
  const src = entries.length ? entries : slot;
  return src[Math.floor(Math.random() * src.length)]!;
}

export function slotIncludes(slot: EventSlot, anim: string): boolean {
  return typeof slot === "string" ? slot === anim : slot.includes(anim);
}

export function poolIncludes(pool: readonly EventSlot[], anim: string): boolean {
  return pool.some((slot) => slotIncludes(slot, anim));
}

/** 整个 events 段是否包含某动画名。 */
export function isEventAnim(
  events: Record<string, readonly EventSlot[]> | undefined,
  anim: string,
): boolean {
  return events ? Object.values(events).some((pool) => poolIncludes(pool, anim)) : false;
}

/** 工作状态播完后的轮换：多候选档位返回档内下一候选，单候选返回 null。 */
export function nextWorkStatusAnim(pool: readonly EventSlot[], current: string): string | null {
  const idx = pool.findIndex((slot) => slotIncludes(slot, current));
  if (idx === -1) return null;
  const slot = pool[idx]!;
  if (!Array.isArray(slot) || slot.length <= 1) return null;
  return pickSlot(slot, current);
}

export type RollKind = "idle" | "turn" | "move" | "action";

export interface RollWeights {
  idle: number;
  turn: number;
  move: number;
}

/**
 * 按权重掷骰：(idle + turn + move) / 100 是这三档占比，剩余概率归 action。
 * fixed=true 时 turn/move 权重按 0 算。
 */
export function rollKind(roll: number, w: RollWeights, opts?: { fixed?: boolean }): RollKind {
  const turn = opts?.fixed ? 0 : w.turn;
  const move = opts?.fixed ? 0 : w.move;
  const topEnd = (w.idle + turn + move) / 100;
  if (roll < w.idle / 100) return "idle";
  if (roll < (w.idle + turn) / 100) return "turn";
  if (roll < topEnd) return "move";
  return "action";
}

export interface Category {
  id: string;
  weight: number;
  actions: string[];
  noMirror?: boolean;
}

/** 按权重选分类；朝右时排除 noMirror 分类并归一化剩余权重。 */
export function pickWeightedCategory(
  categories: readonly Category[],
  facing: "left" | "right",
): Category | null {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === "right"));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1]!;
}

/** 从分类池选一个动作；无可用分类时回退 idle 池。 */
export function pickCategoryAction(
  categories: readonly Category[],
  idlePool: readonly string[],
  facing: "left" | "right",
  current: string,
): { id: string; name: string } {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: "FALLBACK", name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
}

// ───────────────────────── 播完决策（client/pet/animation/cues.ts） ─────────────────────────
export type EndedCue =
  | { kind: "ignore" }
  | { kind: "work-rotate"; anim: string }
  | { kind: "work-replay" }
  | { kind: "event-done" }
  | { kind: "turn" }
  | { kind: "interaction-done" }
  | { kind: "random" };

export interface AnimationPools {
  idle: string[];
  turn: string[];
  drag: string[];
  clicks: string[];
  events?: Record<string, EventSlot[]>;
}

const isWorkActive = (state: string | null | undefined): boolean =>
  state !== null && state !== undefined && state !== "success" && state !== "error";

/** 决定一段动画播完之后进哪条分支。 */
export function decideEndedCue(input: {
  animations: AnimationPools;
  current: string;
  workState: string | null | undefined;
}): EndedCue {
  const { animations, current, workState } = input;
  const isEvent = isEventAnim(animations.events, current);
  if (isEvent && isWorkActive(workState)) {
    const nextWork = nextWorkStatusAnim(animations.events?.workStatus ?? [], current);
    if (nextWork !== null) return { kind: "work-rotate", anim: nextWork };
    if (poolIncludes(animations.events?.workStatus ?? [], current)) return { kind: "work-replay" };
  }
  if (isEvent) return { kind: "event-done" };
  if (animations.turn.includes(current)) return { kind: "turn" };
  if (animations.drag.includes(current) || animations.clicks.includes(current)) {
    return { kind: "interaction-done" };
  }
  return { kind: "random" };
}

// ───────────────────────── 工作状态（shared/work-status.ts） ─────────────────────────
export const WORK_STATUS_STATES = [
  "thinking",
  "working",
  "result",
  "waiting",
  "success",
  "error",
] as const;
export type WorkStatusState = (typeof WORK_STATUS_STATES)[number];

export const WORK_STATUS_INDEX: Record<WorkStatusState, number> = {
  thinking: 0,
  working: 1,
  result: 2,
  waiting: 3,
  success: 4,
  error: 5,
};

export interface WorkStatusSnapshot {
  state: WorkStatusState | null;
  task: string | null;
}

export function toWorkStatus(raw: unknown): WorkStatusSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { state?: unknown; task?: unknown };
  const state: WorkStatusState | null =
    r.state === null ||
    (typeof r.state === "string" && (WORK_STATUS_STATES as readonly string[]).includes(r.state))
      ? (r.state as WorkStatusState | null)
      : null;
  return { state, task: typeof r.task === "string" ? r.task : null };
}

/**
 * XCode 行为状态 → DSH 工作状态档位。
 * 对齐 dsh-pet 的宿主事件映射：turn/start→thinking、tool/call→working、
 * tool/result→result、approval/asked→waiting、turn/end completed→success、error→error。
 */
export function behaviorStateToWorkStatus(state: string): WorkStatusState | null {
  switch (state) {
    case "running":
    case "prewarming":
      return "thinking";
    case "waiting":
      return "waiting";
    case "review":
      return "success";
    case "failed":
      return "error";
    default:
      return null;
  }
}

// ───────────────────────── 窗口几何（runtime/electron-helper/sprite.js 同名算式） ─────────────────────────
export interface PetGeometry {
  /** 宠物包围盒宽。 */
  size: number;
  /** 宠物包围盒高（size × 9/16）。 */
  height: number;
  /** 舞台下方垫高：FEET_Y 以下的空白，防底部被窗口裁剪。 */
  bottomPad: number;
  /** 窗口四周余量（上边距可能因气泡加高而大于其它三边）。 */
  margin: { t: number; r: number; b: number; l: number };
  /** 窗口内容区尺寸。 */
  window: { width: number; height: number };
  /** 身体命中区（窗口坐标）。 */
  hitRect: { x: number; y: number; w: number; h: number };
  /** 左右透明边余量：让边界按身体贴边。 */
  sideAllow: number;
}

/**
 * 由宠物尺寸算窗口几何（逐字对照 dsh-pet sprite.js 构造函数）。
 * @param size 宠物包围盒宽（CSS px）
 * @param bubbleTopMargin 气泡所需上边距（缺省按 size×0.5）
 */
export function computePetGeometry(size: number, bubbleTopMargin?: number): PetGeometry {
  const height = (size * 9) / 16;
  const bottomPad = (size * (9 / 16) * (CANVAS_H - FEET_Y)) / CANVAS_H;
  const winH = height + bottomPad;
  const hitRect = {
    x: (HIT_BOX.x0 / CANVAS_W) * size,
    y: bottomPad + (HIT_BOX.y0 / CANVAS_H) * height,
    w: ((HIT_BOX.x1 - HIT_BOX.x0) / CANVAS_W) * size,
    h: ((HIT_BOX.y1 - HIT_BOX.y0) / CANVAS_H) * height,
  };
  const sideAllow = (HIT_BOX.x0 / CANVAS_W) * size;
  const m = size * WINDOW_MARGIN_RATIO;
  const margin = {
    t: Math.max(m, bubbleTopMargin ?? 0),
    r: m,
    b: m,
    l: m,
  };
  return {
    size,
    height,
    bottomPad,
    margin,
    window: { width: size + margin.l + margin.r, height: winH + margin.t + margin.b },
    hitRect,
    sideAllow,
  };
}
// ───────────────────────── 右键菜单树（shared/menu/tree.ts） ─────────────────────────
export interface MenuLeaf {
  label: string;
  /** 播放的动画名（点播动作）；action 优先于 anim。 */
  anim?: string;
  /** 自定义动作（对齐上游 whisper / chat / open-site / home / set-display / reload 工具项）。 */
  action?: "home" | "open-app" | "reload" | "set-display" | "whisper-request" | "open-chat";
  /** set-display 的目标：仅桌面 / 都不（XCode 侧没有浏览器 overlay）。 */
  display?: "desktop" | "none";
  /** 右侧灰色小字提示。 */
  hint?: string;
}

export interface MenuBranch {
  label: string;
  children: MenuNode[];
}

export type MenuNode = MenuLeaf | MenuBranch;

export function isBranchNode(n: MenuNode): n is MenuBranch {
  return "children" in n && Array.isArray((n as MenuBranch).children);
}

/**
 * 由成品 animations 配置推导菜单树：一级「动作」→ 二级分类 → 三级动画名。
 * 空池与空分类自动省略（对齐上游 buildMenuTree）。
 */
export function buildMenuTree(animations: {
  idle: string[];
  turn: string[];
  drag: string[];
  clicks: string[];
  events?: Record<string, EventSlot[]>;
  categories?: readonly Category[];
  moves?: { actions?: Array<{ name: string }> };
}): MenuNode[] {
  const groups: MenuNode[] = [];
  const pools: Array<[string, string[]]> = [
    ["待机", animations.idle],
    ["转向", animations.turn],
    ["拖拽", animations.drag],
    ["点击回应", animations.clicks],
    ["移动", (animations.moves?.actions ?? []).map((m) => m.name)],
  ];
  for (const [label, pool] of pools) {
    if (pool.length) groups.push({ label, children: pool.map((anim) => ({ label: anim, anim })) });
  }
  for (const c of animations.categories ?? []) {
    if (!c.actions.length) continue;
    groups.push({ label: c.id, children: c.actions.map((anim) => ({ label: anim, anim })) });
  }
  const EVENT_LABELS: Record<string, string> = {
    balance: "余额档位",
    whisper: "碎碎念",
    workStatus: "工作状态",
  };
  for (const [key, pool] of Object.entries(animations.events ?? {})) {
    const names: string[] = [];
    for (const slot of pool) {
      if (typeof slot === "string") names.push(slot);
      else names.push(...slot);
    }
    if (names.length) {
      groups.push({
        label: EVENT_LABELS[key] ?? key,
        children: names.map((anim) => ({ label: anim, anim })),
      });
    }
  }
  if (!groups.length) return [];
  return [{ label: "动作", children: groups }];
}

/** 该动画是否属于 noMirror 分类（文字类）：朝右镜像时点播前强制朝左。 */
export function isNoMirrorAnimation(categories: readonly Category[], anim: string): boolean {
  return categories.some((c) => c.noMirror === true && c.actions.includes(anim));
}
