/**
 * DSH 走位与角落定位（移植自 PC2005-cloud/dsh-pet shared/motion.ts
 * 与 client/pet/motion/move-action.ts）。纯计算，无 DOM。
 */

import { PET_REF_WIDTH, randomBetween, type Rect } from "./dshPetCore.js";

export interface MovesParams {
  minDist: number;
  maxDist: number;
  margin: number;
  leadSec: number;
  tailSec: number;
}

export interface MoveActionConfig {
  name: string;
  params?: Partial<MovesParams>;
}

export interface MovesConfig {
  default: MovesParams;
  actions: MoveActionConfig[];
}

export interface MovePlan {
  startRatio: number;
  startYRatio: number;
  targetRatio: number;
  totalRatio: number;
}

export interface PendingMove extends MovePlan {
  dir: 1 | -1;
  leadSec: number;
  tailSec: number;
}

/** 点是否落在任一工作区内。 */
export function areaAtPoint(areas: readonly Rect[], x: number, y: number): boolean {
  return areas.some((a) => x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height);
}

/**
 * 计算一次移动的起点/终点比例坐标；目标越出边界（含边距）时返回 null。
 * sideAllow = 左右透明边余量：边界按身体贴边而不是按整个视频盒贴边。
 * areas 传入时（桌面多显示器）改判工作区并集：缝隙两侧都有屏即可骑缝走过。
 */
export function planMove(o: {
  cx: number;
  cy: number;
  W: number;
  H: number;
  dir: 1 | -1;
  minDist: number;
  maxDist: number;
  margin: number;
  halfW: number;
  sideAllow?: number;
  areas?: Rect[];
}): MovePlan | null {
  const side = o.sideAllow ?? 0;
  const distance = randomBetween(o.minDist, o.maxDist);
  const target = o.cx + o.dir * distance;
  if (o.areas && o.areas.length > 0) {
    const bodyHalf = o.halfW - side;
    if (!areaAtPoint(o.areas, target - bodyHalf - o.margin, o.cy)) return null;
    if (!areaAtPoint(o.areas, target + bodyHalf + o.margin, o.cy)) return null;
  } else {
    const leftBound = o.margin + o.halfW - side;
    const rightBound = o.W - o.margin - o.halfW + side;
    if (target < leftBound || target > rightBound) return null;
  }
  return {
    startRatio: o.cx / o.W,
    startYRatio: o.cy / o.H,
    targetRatio: target / o.W,
    totalRatio: Math.abs(target - o.cx) / o.W,
  };
}

/**
 * 规划一次自主走位（对齐上游 planMoveAction）。
 * 距离按宠物尺寸等比缩放：配置里的 minDist/maxDist 是基准宽度 462 下的像素。
 * 走路方向只看当前 facing，不用 turn 动画反推。
 */
export function planMoveAction(input: {
  moves: MovesConfig;
  preferredName?: string;
  facing: "left" | "right";
  size: number;
  center: { x: number; y: number };
  viewport: { width: number; height: number };
  halfW: number;
  sideAllow: number;
  areas?: Rect[];
  random?: () => number;
}): { anim: string; pending: PendingMove } | null {
  const actions = input.moves.actions;
  if (!actions.length) return null;
  const random = input.random ?? Math.random;
  const chosen = input.preferredName
    ? (actions.find((action) => action.name === input.preferredName) ?? null)
    : actions[Math.floor(random() * actions.length)]!;
  if (!chosen) return null;
  const params = { ...input.moves.default, ...chosen.params };
  const dir: 1 | -1 = input.facing === "right" ? 1 : -1;
  const distScale = input.size / PET_REF_WIDTH;
  const plan = planMove({
    cx: input.center.x,
    cy: input.center.y,
    W: input.viewport.width,
    H: input.viewport.height,
    dir,
    minDist: params.minDist * distScale,
    maxDist: params.maxDist * distScale,
    margin: params.margin,
    halfW: input.halfW,
    sideAllow: input.sideAllow,
    ...(input.areas ? { areas: input.areas } : {}),
  });
  if (plan === null) return null;
  return {
    anim: chosen.name,
    pending: { ...plan, dir, leadSec: params.leadSec, tailSec: params.tailSec },
  };
}

/**
 * 走位进度 → 当帧横向比例（对齐上游 walk.ts 分段）：
 * startSec 内原地起脚、结束前 tailSec 秒到位、中段按比例匀速。
 */
export function walkRatioAt(pending: PendingMove, currentSec: number, durationSec: number): number {
  const travelWindow = Math.max(0.1, durationSec - pending.leadSec - pending.tailSec);
  if (currentSec <= pending.leadSec) return pending.startRatio;
  if (currentSec >= durationSec - pending.tailSec) return pending.targetRatio;
  return (
    pending.startRatio +
    pending.dir * pending.totalRatio * ((currentSec - pending.leadSec) / travelWindow)
  );
}

/** 元数据未就绪时的兜底时长（秒）：内置走路素材常见时长，避免除零。 */
export const WALK_FALLBACK_DURATION_SEC = 10.09;

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * 角落 + 边距 → 宠物包围盒左上角像素坐标。
 * area 传入时角落取那块屏而不是视口外接矩形（不规则布局下外接矩形角落可能不属于任何屏）。
 */
export function anchorPixel(o: {
  corner: Corner;
  marginX: number;
  marginY: number;
  size: number;
  W: number;
  H: number;
  area?: Rect;
}): { x: number; y: number } {
  const height = (o.size * 9) / 16;
  const a = o.area ?? { x: 0, y: 0, width: o.W, height: o.H };
  const left = a.x + o.marginX;
  const top = a.y + o.marginY;
  const right = a.x + a.width - o.size - o.marginX;
  const bottom = a.y + a.height - height - o.marginY;
  switch (o.corner) {
    case "top-left":
      return { x: left, y: top };
    case "top-right":
      return { x: right, y: top };
    case "bottom-left":
      return { x: left, y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
  }
}
