/**
 * DSH 右键菜单的落点计算与样式（移植自 PC2005-cloud/dsh-pet shared/menu/*）。
 * 纯函数，不碰 DOM；挂载在 renderer 侧（dshPetOverlay.ts）。
 */

export interface PanelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 面板与边界、面板之间的间距（px）。 */
const PANEL_GAP = 4;

/**
 * 决定子面板的落点：优先不与任何已展开面板重叠，其次贴边。
 * 以父面板（而不是触发项）为基准：触发项长在父面板里，按它往左翻必然盖回父面板。
 */
export function pickPanelPosition(input: {
  panel: { w: number; h: number };
  item: { left: number; right: number; top: number };
  parent: { left: number; right: number; top: number };
  others: PanelBox[];
  clamp: { x: number; y: number; w: number; h: number };
}): { left: number; top: number } {
  const { panel, item, parent, others, clamp } = input;
  const minLeft = clamp.x + PANEL_GAP;
  const minTop = clamp.y + PANEL_GAP;
  const maxLeft = clamp.x + clamp.w - PANEL_GAP - panel.w;
  const maxTop = clamp.y + clamp.h - PANEL_GAP - panel.h;
  const clampX = (v: number): number => Math.max(minLeft, Math.min(v, Math.max(minLeft, maxLeft)));
  const clampY = (v: number): number => Math.max(minTop, Math.min(v, Math.max(minTop, maxTop)));
  const hitsOther = (left: number, top: number): boolean =>
    others.some(
      (b) => left < b.right && left + panel.w > b.left && top < b.bottom && top + panel.h > b.top,
    );
  const fitsClamp = (left: number, top: number): boolean =>
    left >= minLeft - 0.5 && left <= maxLeft + 0.5 && top >= minTop - 0.5 && top <= maxTop + 0.5;
  const topAtItem = clampY(item.top);
  const topAtParent = clampY(parent.top);
  const cands = [
    { left: parent.right + PANEL_GAP, top: topAtItem },
    { left: parent.left - PANEL_GAP - panel.w, top: topAtItem },
    { left: parent.right + PANEL_GAP, top: topAtParent },
    { left: parent.left - PANEL_GAP - panel.w, top: topAtParent },
  ];
  const ideal = cands.find((cd) => fitsClamp(cd.left, cd.top) && !hitsOther(cd.left, cd.top));
  if (ideal) return ideal;
  const fitted = cands
    .map((cd) => ({ left: clampX(cd.left), top: clampY(cd.top) }))
    .find((cd) => !hitsOther(cd.left, cd.top));
  if (fitted) return fitted;
  return { left: clampX(parent.right + PANEL_GAP), top: clampY(topAtItem) };
}

/**
 * 菜单样式（逐字取自上游 menu/css.ts）：固定浅色浮层，不跟随宿主主题
 * ——跟随主题会在深色背景上糊成一片，且两端观感会分叉。
 */
export const MENU_CSS = [
  ".dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;",
  "font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
  ".dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}",
  ".dsh-pet-menu-column{position:absolute;min-width:150px;max-width:300px;padding:4px;",
  "background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;",
  "box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto;",
  "scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.22) transparent}",
  ".dsh-pet-menu-column::-webkit-scrollbar{width:8px;height:8px}",
  ".dsh-pet-menu-column::-webkit-scrollbar-track{background:transparent}",
  ".dsh-pet-menu-column::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px;",
  "border:2px solid transparent;background-clip:content-box}",
  ".dsh-pet-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(43,99,255,.4);",
  "border:2px solid transparent;background-clip:content-box}",
  ".dsh-pet-menu-column::-webkit-scrollbar-corner{background:transparent}",
  ".dsh-pet-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;",
  "gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}",
  ".dsh-pet-menu-item:hover{background:rgba(43,99,255,.14)}",
  ".dsh-pet-menu-item>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}",
  ".dsh-pet-menu-hint{color:#9aa0a6;font-size:12px;flex:none;white-space:nowrap}",
  ".dsh-pet-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}",
].join("");
