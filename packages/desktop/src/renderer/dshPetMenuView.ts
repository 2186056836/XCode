/**
 * DSH 桌宠右键菜单挂载（逐字移植自 PC2005-cloud/dsh-pet shared/menu/mount.ts）。
 *
 * 结构对齐上游：根容器零尺寸，每级面板平级挂载并按触发项位置贴边定位
 * （优先父面板右侧，放不下翻左侧，且不与任何已展开面板重叠）；指针在菜单树
 * 内绝不自动收起，整体离开（root mouseleave，软 200ms）才关闭整棵菜单。
 * clamp：允许占用的矩形（视口局部坐标）——桌面传「窗口 ∩ 工作区」，宠物贴边时
 * 窗口外扩的部分会被 OS 裁掉，约束进去即可完整显示，窗口与宠物零移动。
 */
import { isBranchNode, type MenuLeaf, type MenuNode } from "../shared/dshPetCore.js";
import { MENU_CSS, pickPanelPosition } from "../shared/dshPetMenu.js";

export interface ContextMenuMount {
  el: HTMLElement;
  close: () => void;
}

export function mountContextMenu(opts: {
  tree: MenuNode[];
  x: number;
  y: number;
  onAction: (leaf: MenuLeaf) => void;
  /** 菜单被关闭（点项/点外/Esc/指针离开）后的通知：挂载方据此复位自身状态。 */
  onClose?: () => void;
  /** 菜单允许占用的矩形（视口局部坐标）；缺省 = 整个视口。 */
  clamp?: { x: number; y: number; w: number; h: number };
}): ContextMenuMount {
  const { tree, x, y, onAction, onClose, clamp } = opts;
  // 防御：clamp 含非有限值时回落整个视口，否则面板会落到 (0,0)。
  const c =
    clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h)
      ? clamp
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

  const style = document.createElement("style");
  style.textContent = MENU_CSS;
  const root = document.createElement("div");
  root.className = "dsh-pet-menu";
  root.style.left = "0px";
  root.style.top = "0px";
  root.appendChild(style);
  root.addEventListener("contextmenu", (event) => event.preventDefault());
  document.body.appendChild(root);

  let closed = false;
  /** 每个面板当前展开的子面板（无 = 未展开）；hideChain 会沿链清除。 */
  const openChild = new Map<HTMLElement, HTMLElement>();
  /** 指针整体离开菜单树的兜底关闭定时器（root mouseover 重新进入即取消）。 */
  let leaveTimer: number | null = null;

  /** 关闭某面板及其后代面板整条链（display:none + 清 openChild 链）。 */
  const hideChain = (panel: HTMLElement): void => {
    panel.style.display = "none";
    const child = openChild.get(panel);
    if (child) {
      openChild.delete(panel);
      hideChain(child);
    }
  };

  /** 把子面板摆到触发项旁边：优先父面板右侧，放不下翻到父面板左侧，
   *  且不与任何已展开面板重叠；贴边时夹进 clamp。 */
  const showPanel = (panel: HTMLElement, item: HTMLElement): void => {
    const rect = item.getBoundingClientRect();
    panel.style.left = "";
    panel.style.top = "";
    panel.style.display = "block";
    const parentEl = item.parentElement;
    const pr = parentEl ? parentEl.getBoundingClientRect() : rect;
    const pick = pickPanelPosition({
      panel: { w: panel.offsetWidth, h: panel.offsetHeight },
      item: { left: rect.left, right: rect.right, top: rect.top },
      parent: { left: pr.left, right: pr.right, top: pr.top },
      others: Array.from(root.querySelectorAll<HTMLElement>(".dsh-pet-menu-column"))
        .filter((p) => p !== panel && p.style.display !== "none")
        .map((p) => {
          const b = p.getBoundingClientRect();
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        }),
      clamp: { x: c.x, y: c.y, w: c.w, h: c.h },
    });
    panel.style.left = `${pick.left}px`;
    panel.style.top = `${pick.top}px`;
  };

  /** 构建一层面板；分支项的子面板平级挂到 root 下、不嵌套。
   *  面板先入 DOM、子面板后入，层级越深绘制越靠上（子菜单盖在父菜单上层）。 */
  const buildPanel = (nodes: MenuNode[]): HTMLElement => {
    const panel = document.createElement("div");
    panel.className = "dsh-pet-menu-column";
    panel.style.display = "none";
    // 桌面 clamp：把列高封顶到可视矩形内（否则 62vh 相对的是窗口高度，可视区更小时仍会溢出被裁）。
    if (clamp) panel.style.maxHeight = `${Math.min(460, Math.max(120, c.h - 16))}px`;
    root.appendChild(panel);
    for (const node of nodes) {
      const item = document.createElement("div");
      item.className = "dsh-pet-menu-item";
      if (isBranchNode(node)) {
        item.classList.add("dsh-pet-menu-branch");
        const label = document.createElement("span");
        label.textContent = node.label;
        const arrow = document.createElement("span");
        arrow.className = "dsh-pet-menu-arrow";
        arrow.textContent = "\u25b8";
        item.append(label, arrow);
        const childPanel = buildPanel(node.children);
        // 悬停分支：先收掉本面板其它分支已展开的子面板链，再展开当前的。
        // 指针在本菜单树内移动绝不自动收起——跨 4px 缝隙或面板间隙都不会触发关闭。
        item.addEventListener("mouseenter", () => {
          const prev = openChild.get(panel);
          if (prev && prev !== childPanel) hideChain(prev);
          openChild.set(panel, childPanel);
          showPanel(childPanel, item);
        });
      } else {
        const label = document.createElement("span");
        label.textContent = node.label;
        item.appendChild(label);
        if (node.hint) {
          const hint = document.createElement("span");
          hint.className = "dsh-pet-menu-hint";
          hint.textContent = node.hint;
          item.appendChild(hint);
        }
        item.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          close();
          onAction(node);
        });
      }
      panel.appendChild(item);
    }
    return panel;
  };

  const rootPanel = buildPanel(tree);
  rootPanel.style.display = "block";

  // 根面板定位：按 (x,y) 下落，超出 clamp 矩形时夹回（必须先入文档才能量到尺寸）。
  rootPanel.style.left = "";
  rootPanel.style.top = "";
  const rw = rootPanel.offsetWidth;
  const rh = rootPanel.offsetHeight;
  rootPanel.style.left = `${Math.max(c.x + 4, Math.min(x, c.x + c.w - rw - 4))}px`;
  rootPanel.style.top = `${Math.max(c.y + 4, Math.min(y, c.y + c.h - rh - 4))}px`;

  // 指针整体离开菜单树（离开全部面板的并集）→ 200ms 后关闭整棵菜单；
  // 期间任何指针移动（mouseover 冒泡到 root）都视为仍在菜单内，取消关闭。
  root.addEventListener("mouseleave", () => {
    if (leaveTimer !== null) window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      leaveTimer = null;
      close();
    }, 200);
  });
  root.addEventListener("mouseover", () => {
    if (leaveTimer !== null) {
      window.clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  });

  const onDocPointerDown = (event: MouseEvent): void => {
    if (closed) return;
    if (root.contains(event.target as Node)) return;
    close();
  };
  const onDocKeyDown = (event: KeyboardEvent): void => {
    if (closed) return;
    if (event.key === "Escape") close();
  };
  document.addEventListener("mousedown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);

  function close(): void {
    if (closed) return;
    closed = true;
    if (leaveTimer !== null) window.clearTimeout(leaveTimer);
    leaveTimer = null;
    document.removeEventListener("mousedown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
    root.remove();
    onClose?.();
  }

  return { el: root, close };
}
