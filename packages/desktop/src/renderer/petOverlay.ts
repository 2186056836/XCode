/**
 * 桌宠悬浮窗渲染层（复刻 Codex Pets，规格来自逆向 + PetPack MIT 实现交叉验证）。
 *
 * 精灵图 v2 规范：1536×2288、格 192×208、8 列 × 11 行；
 * 行 0-8 = 动作，行 9-10 = 16 方位注视（22.5°/档）。
 * 状态优先级与时长表与官方逐帧一致（idle [280,110,110,140,140,320] 等）。
 */
interface PetOverlayBridge {
  drag: (payload: { phase: "start" | "move" | "end"; dx?: number; dy?: number }) => void;
  throwWithVelocity: (velocityX: number, velocityY: number) => void;
  resize: (payload: { phase: "start" | "move" | "end"; width?: number }) => void;
  setTrayHeight?: (height: number) => void;
  setIgnoreMouseEvents: (ignore: boolean) => void;
  focusMain: () => void;
  getConfig: () => Promise<PetOverlayConfigView>;
  getCustomSpriteDataUrl: (petId: string) => Promise<string | null>;
  onConfig: (callback: (config: PetOverlayConfigView) => void) => () => void;
  resolveAction?: (payload: { interactionId: string; optionId: string }) => void;
  openSession?: (sessionId: string) => void;
  onState: (callback: (payload: PetStatePayload) => void) => () => void;
}

interface PetNotificationRow {
  sessionId: string;
  state: string;
  title: string;
  waitingKind?: string;
}

interface PetStatePayload {
  state: string;
  wave?: boolean;
  badge?: number;
  title?: string;
  notifications?: PetNotificationRow[];
  actions?: { interactionId: string; options: Array<{ optionId: string; label: string }> };
}

interface PetOverlayConfigView {
  enabled: boolean;
  petId: string;
  sizePx: number;
}

declare global {
  interface Window {
    petOverlay?: PetOverlayBridge;
  }
}

// ---------------- 精灵图规范（逆向 Codex v2） ----------------

const SPRITE_COLUMNS = 8;
const DEFAULT_SPRITE_ROWS = 11;
let spriteRows = DEFAULT_SPRITE_ROWS;
const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;

type PetStateId =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

interface StateRow {
  row: number;
  durations: number[];
}

const PET_STATES: Record<PetStateId, StateRow> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
};

/** 注视帧只在待机类状态下接管（对齐官方 mascotButton 的 lookFrame 条件）。 */
const LOOK_ALLOWED_STATES: ReadonlySet<PetStateId> = new Set(["idle", "running", "waving"]);

const IDLE_FRAME_SLOWDOWN = 6;
/** 非循环动作播完 3 遍 + idle 一遍后回到循环起点（官方 f() 的行为）。 */
const NON_LOOP_REPEATS = 3;

/**
 * 精灵图预加载：窗口可能在 dev server 完全就绪前恢复，首次请求可能失败；
 * 失败后指数退避重试，成功才设置 background-image（否则只剩 resize 手柄可见）。
 */
const spriteUrl = (petId: string): string => `pets/${petId}.png`;

async function loadSpritesheet(petId: string, attempt = 0): Promise<void> {
  try {
    const isCustom = petId.startsWith("custom:");
    const src = isCustom
      ? ((await window.petOverlay?.getCustomSpriteDataUrl(petId)) ?? "")
      : spriteUrl(petId);
    if (!src) throw new Error("no sprite source");
    const columns = 8;
    const rows = await new Promise<number>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth === 0 || image.naturalWidth % columns !== 0) {
          reject(new Error("bad image"));
          return;
        }
        // 行列探测：格宽 = 宽/8，格高按 192:208 推出，行数 = 高/格高（9 或 11）。
        const cellWidth = image.naturalWidth / columns;
        const cellHeight = Math.round((cellWidth * CELL_HEIGHT) / CELL_WIDTH);
        const detected = Math.round(image.naturalHeight / cellHeight);
        resolve(detected === 9 || detected === 11 ? detected : DEFAULT_SPRITE_ROWS);
      };
      image.onerror = () => reject(new Error("load failed"));
      image.src = src;
    });
    spriteRows = rows;
    petElement.style.backgroundImage = `url("${src}")`;
  } catch {
    if (attempt < 8) {
      window.setTimeout(() => void loadSpritesheet(petId, attempt + 1), 500 * 2 ** attempt);
    }
  }
}

const clampSize = (size: number): number =>
  Number.isFinite(size) ? Math.round(Math.min(224, Math.max(80, size))) : 112;

const petElement = document.getElementById("pet") as HTMLDivElement;
const resizeElement = document.getElementById("resize") as HTMLDivElement;
const bridge = window.petOverlay ?? null;

if (!bridge) {
  // preload 缺席（开发直开浏览器等）：静默退出，页面保持透明。
  console.warn("[pet-overlay] preload bridge missing");
} else {
  void main(bridge);
}

async function main(bridge: PetOverlayBridge): Promise<void> {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let config = await bridge.getConfig();
  let behaviorState: string = "idle";
  let transientState: PetStateId | null = null;
  let dragging = false;
  let hovering = false;
  let lookFrame: { row: number; column: number } | null = null;
  let playTimer: number | null = null;
  let playFrame = 0;
  let playRepeat = 0;
  let currentPetId = "";

  const applyLayout = (): void => {
    const spriteWidth = config.sizePx;
    const spriteHeight = Math.round((spriteWidth * CELL_HEIGHT) / CELL_WIDTH);
    petElement.style.width = `${spriteWidth}px`;
    petElement.style.height = `${spriteHeight}px`;
    // 窗口 = 托盘区（可选）+ 精灵 + 底部 pill 空间：精灵水平居中、垂直靠下。
    petElement.style.left = "50%";
    petElement.style.bottom = "22px";
    petElement.style.top = "auto";
    petElement.style.transform = "translateX(-50%)";
    if (currentPetId !== config.petId) {
      currentPetId = config.petId;
      void loadSpritesheet(config.petId);
    }
    petElement.style.backgroundSize = `${SPRITE_COLUMNS * 100}% ${spriteRows * 100}%`;
  };

  const framePosition = (row: number, column: number): string =>
    `${(column / (SPRITE_COLUMNS - 1)) * 100}% ${(row / (spriteRows - 1)) * 100}%`;

  const resolveState = (): PetStateId => {
    if (transientState) return transientState;
    if (dragging) return "running";
    return (PET_STATES[behaviorState as PetStateId] ? behaviorState : "idle") as PetStateId;
  };

  const stopPlay = (): void => {
    if (playTimer !== null) {
      window.clearTimeout(playTimer);
      playTimer = null;
    }
  };

  const drawLook = (): void => {
    if (!lookFrame) return;
    petElement.style.backgroundPosition = framePosition(lookFrame.row, lookFrame.column);
  };

  const scheduleNext = (state: PetStateId): void => {
    const def = PET_STATES[state];
    const duration =
      state === "idle"
        ? def.durations[playFrame % def.durations.length]! * IDLE_FRAME_SLOWDOWN
        : def.durations[playFrame % def.durations.length]!;
    playTimer = window.setTimeout(() => {
      playFrame += 1;
      if (playFrame >= def.durations.length) {
        playFrame = 0;
        if (transientState) {
          // 非循环瞬态：播 N 遍后回落到常规状态。
          playRepeat += 1;
          if (playRepeat >= NON_LOOP_REPEATS) {
            transientState = null;
            playRepeat = 0;
          }
        }
      }
      render(true);
    }, duration);
  };

  const render = (continuing = false): void => {
    const state = resolveState();
    if (!continuing) {
      playFrame = 0;
      playRepeat = 0;
    }
    const def = PET_STATES[state];
    if (lookFrame && LOOK_ALLOWED_STATES.has(state) && !dragging && !hovering) {
      stopPlay();
      drawLook();
      return;
    }
    petElement.dataset.state = state;
    petElement.style.backgroundPosition = framePosition(def.row, playFrame);
    if (reducedMotion) {
      stopPlay();
      return;
    }
    stopPlay();
    scheduleNext(state);
  };

  // ---------------- 注视：指针相对宠物的方位 → 16 档帧 ----------------
  const updateLook = (clientX: number, clientY: number): void => {
    const rect = petElement.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) <= 1) {
      lookFrame = null;
      render();
      return;
    }
    // 官方角度基准：atan2(dx, -dy)，正北为 0°，顺时针 22.5°/档。
    const angle = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360;
    const index = Math.round(angle / 22.5) % 16;
    lookFrame = { row: index < 8 ? 9 : 10, column: index % 8 };
    render();
  };

  // ---------------- 拖拽（增量上报 + 速度采样 → 抛掷） ----------------
  let dragLast: { x: number; y: number; t: number } | null = null;
  const velocitySamples: Array<{ x: number; y: number; t: number }> = [];

  petElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    petElement.setPointerCapture(event.pointerId);
    dragging = true;
    dragLast = { x: event.screenX, y: event.screenY, t: Date.now() };
    velocitySamples.length = 0;
    bridge.drag({ phase: "start" });
    render();
  });

  petElement.addEventListener("pointermove", (event) => {
    if (dragging && dragLast) {
      const dx = event.screenX - dragLast.x;
      const dy = event.screenY - dragLast.y;
      dragLast = { x: event.screenX, y: event.screenY, t: Date.now() };
      velocitySamples.push({ x: event.screenX, y: event.screenY, t: Date.now() });
      if (velocitySamples.length > 8) velocitySamples.shift();
      bridge.drag({ phase: "move", dx, dy });
      // 拖拽方向驱动跑步动画（官方 Δ≥4px 判定）。
      transientState = dx >= 4 ? "running-right" : dx <= -4 ? "running-left" : transientState;
      if (dx >= 4 || dx <= -4) render();
    } else {
      updateLook(event.clientX, event.clientY);
    }
  });

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    transientState = null;
    bridge.drag({ phase: "end" });
    // 抛掷速度：最近样本的位置差/时间差（px/s）。
    const now = Date.now();
    const recent = velocitySamples.filter((sample) => now - sample.t < 120);
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (first && last && last.t > first.t) {
      const dt = (last.t - first.t) / 1000;
      bridge.throwWithVelocity((last.x - first.x) / dt, (last.y - first.y) / dt);
    }
    dragLast = null;
    render();
    void event;
  };

  petElement.addEventListener("pointerup", endDrag);
  petElement.addEventListener("pointercancel", endDrag);

  // 无位移的点击 = 打招呼 + 聚焦主窗。
  let pointerDownAt: { x: number; y: number } | null = null;
  petElement.addEventListener("pointerdown", (event) => {
    pointerDownAt = { x: event.screenX, y: event.screenY };
  });
  petElement.addEventListener("pointerup", (event) => {
    if (!pointerDownAt) return;
    const moved = Math.hypot(event.screenX - pointerDownAt.x, event.screenY - pointerDownAt.y);
    pointerDownAt = null;
    if (moved < 4) {
      transientState = "waving";
      render();
      bridge.focusMain();
    }
  });

  // 官方 collapseNotificationTray：手动收起后本次任务周期内不再自动展开。
  document.getElementById("trayClose")?.addEventListener("click", (event) => {
    event.stopPropagation();
    trayOpen = false;
    updateTray();
    updatePill();
  });

  // ---------------- 尺寸手柄（对齐官方 mascot-resize 交互） ----------------
  let resizing = false;
  let resizeState: {
    currentWidthPx: number;
    pointerId: number;
    startScreenX: number;
    startWidthPx: number;
  } | null = null;
  let resizeMoveQueued = false;
  let resizePendingWidth: number | null = null;

  const applyLocalWidth = (widthPx: number): void => {
    // 官方 Ee(n)：本地乐观更新，立即反映到精灵与窗口命中区。
    config = { ...config, sizePx: widthPx };
    applyLayout();
  };

  const setForceResizeCursor = (on: boolean): void => {
    // 官方 ve(true/false)：resize 期间整窗强制 nwse 光标。
    document.body.classList.toggle("codex-avatar-overlay-force-resize-cursor", on);
  };

  resizeElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeElement.setPointerCapture(event.pointerId);
    resizing = true;
    resizeState = {
      currentWidthPx: config.sizePx,
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startWidthPx: config.sizePx,
    };
    setForceResizeCursor(true);
    bridge.resize({ phase: "start", width: config.sizePx });
  });

  resizeElement.addEventListener("pointermove", (event) => {
    const state = resizeState;
    if (!resizing || !state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    // 官方 Wr：clamp(startWidthPx + screenX - startScreenX)。
    const widthPx = clampSize(state.startWidthPx + (event.screenX - state.startScreenX));
    state.currentWidthPx = widthPx;
    applyLocalWidth(widthPx);
    // 官方 Rt：rAF 节流，一帧至多一条 move。
    resizePendingWidth = widthPx;
    if (!resizeMoveQueued) {
      resizeMoveQueued = true;
      window.requestAnimationFrame(() => {
        resizeMoveQueued = false;
        const pending = resizePendingWidth;
        resizePendingWidth = null;
        if (pending !== null) bridge.resize({ phase: "move", width: pending });
      });
    }
  });

  const endResize = (event: PointerEvent): void => {
    const state = resizeState;
    if (!resizing || !state || state.pointerId !== event.pointerId) return;
    resizing = false;
    const widthPx = clampSize(state.startWidthPx + (event.screenX - state.startScreenX));
    state.currentWidthPx = widthPx;
    applyLocalWidth(widthPx);
    setForceResizeCursor(false);
    bridge.resize({ phase: "end", width: widthPx });
    resizeState = null;
    // 官方 Bt：100ms 后清本地覆盖，回到 host 广播真值。
    window.setTimeout(() => {
      if (!resizing) applyLayout();
    }, 100);
  };
  resizeElement.addEventListener("pointerup", endResize);
  resizeElement.addEventListener("pointercancel", endResize);

  // ---------------- 悬停/注视：窗口常驻可交互 ----------------
  // 本 Electron 上 setIgnoreMouseEvents(forward:true) 不转发（实测 0 事件），
  // 穿透 toggle 方案不可行；窗口改为常驻可交互（margin 已收小到 8px），
  // mousemove 直接驱动注视与悬停跳跃。
  const insideRect = (rect: DOMRect, x: number, y: number): boolean =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  window.addEventListener("mousemove", (event) => {
    if (dragging || resizing) return;
    const overPet = insideRect(petElement.getBoundingClientRect(), event.clientX, event.clientY);
    if (hovering !== overPet) {
      hovering = overPet;
      if (overPet) {
        // 官方悬停语义：跳一次（jumping 非循环，播完回 idle），非常驻跳跃。
        transientState = "jumping";
      } else {
        lookFrame = null;
      }
      render();
    }
  });

  document.body.addEventListener("pointerleave", () => {
    if (!dragging && !resizing) {
      hovering = false;
      lookFrame = null;
      render();
    }
  });

  // ---------------- 配置与行为状态 ----------------
  bridge.onConfig((next) => {
    config = next;
    applyLayout();
  });
  bridge.onState((payload) => {
    if (payload.wave === true) {
      // PetControl 触发的一次性挥手。
      transientState = "waving";
      render();
      return;
    }
    if (typeof payload.state === "string") {
      behaviorState = payload.state;
      taskTitle = payload.title;
      pendingActions = payload.actions;
      if (payload.notifications) {
        const hadNotifications = notifications.length > 0;
        notifications = payload.notifications;
        // 官方语义：新通知到达时托盘展开；清空时收起。用户手动收起后，
        // 同一批通知的后续状态刷新不能把托盘又弹开。
        if (notifications.length === 0) {
          trayOpen = false;
        } else if (!hadNotifications) {
          trayOpen = true;
        }
      }
      updateBadge();
      updatePill();
      updateTray();
      render();
    }
  });

  const WAITING_KIND_LABEL: Record<string, string> = {
    question: "提问",
    patch: "补丁",
    plan: "计划",
    exec: "执行",
    permission: "权限",
    tool: "工具",
    network: "网络",
  };

  /**
   * 托盘实测高度回报：官方托盘和宠物是上下分栏布局（不重叠），
   * 主进程按这个高度加高窗口，宠物底边位置保持不变。
   */
  let reportedTrayHeight = -1;
  const reportTrayHeight = (tray: HTMLDivElement | null): void => {
    const height =
      tray && !tray.hidden ? Math.min(131, Math.round(tray.getBoundingClientRect().height)) : 0;
    if (height === reportedTrayHeight) return;
    reportedTrayHeight = height;
    bridge?.setTrayHeight?.(height);
  };

  /** 官方通知托盘：所有非 idle 会话各一行（色点 + 标题 + 等待类型）。 */
  const updateTray = (): void => {
    const tray = document.getElementById("tray") as HTMLDivElement | null;
    const list = document.getElementById("trayList") as HTMLDivElement | null;
    const title = document.getElementById("trayTitle") as HTMLSpanElement | null;
    if (!tray || !list || !title) return;
    if (!trayOpen || notifications.length === 0) {
      tray.hidden = true;
      // 收起时清空行 DOM：既省内存，也让「读 innerText 判断托盘内容」的
      // 诊断脚本不会被上一次的残留行误导。
      list.replaceChildren();
      reportTrayHeight(tray);
      return;
    }
    tray.hidden = false;
    title.textContent = `活动（${notifications.length}）`;
    list.replaceChildren(
      ...notifications.map((row) => {
        const item = document.createElement("div");
        item.className = "pet-tray-row";
        item.dataset.sessionId = row.sessionId;
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        const openRow = (): void => {
          bridge?.openSession?.(row.sessionId);
        };
        item.addEventListener("click", openRow);
        item.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openRow();
          }
        });
        const dot = document.createElement("span");
        dot.className = "pet-tray-row-dot";
        dot.style.background = BADGE_COLORS[row.state] ?? "rgba(0,0,0,0.3)";
        const text = document.createElement("span");
        text.className = "pet-tray-row-text";
        text.textContent = row.title || row.state;
        item.append(dot, text);
        const kind = row.waitingKind ? WAITING_KIND_LABEL[row.waitingKind] : undefined;
        if (kind) {
          const kindEl = document.createElement("span");
          kindEl.className = "pet-tray-row-kind";
          kindEl.textContent = kind;
          item.appendChild(kindEl);
        }
        return item;
      }),
    );
    reportTrayHeight(tray);
  };

  /** 官方 pill：状态文案 + 任务标题；idle 且无标题时隐藏。 */
  const updatePill = (): void => {
    const pill = document.getElementById("pill") as HTMLDivElement | null;
    const dot = document.getElementById("pillDot") as HTMLSpanElement | null;
    const text = document.getElementById("pillText") as HTMLSpanElement | null;
    if (!pill || !dot || !text) return;
    // 官方 avatarOverlay.status* 文案（含正文副标题）。
    const STATUS_LABEL: Record<string, string> = {
      running: "Thinking",
      waiting: "Needs input",
      failed: "Blocked",
      review: "Ready",
    };
    const label = STATUS_LABEL[behaviorState];
    // 官方：托盘展开时胶囊让位给托盘；收起时才用胶囊显示摘要。
    if (!label || trayOpen || (behaviorState === "idle" && !taskTitle)) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    dot.style.background = BADGE_COLORS[behaviorState] ?? "rgba(255,255,255,0.6)";
    text.textContent = taskTitle ? `${label} · ${taskTitle}` : label;
    renderPillActions();
  };

  /** 官方 pill 动作区：至多 3 个选项，点击回传 resolveInteraction。 */
  const renderPillActions = (): void => {
    const host = document.getElementById("pillActions") as HTMLSpanElement | null;
    if (!host) return;
    const actions = pendingActions;
    if (!actions || actions.options.length === 0) {
      host.replaceChildren();
      return;
    }
    host.replaceChildren(
      ...actions.options.map((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pet-pill-action";
        // 官方 tone：首个 primary、含 deny 语义的 danger、其余 secondary。
        const denyLike = /deny|reject|decline|拒绝|取消/i.test(option.label);
        button.dataset.tone = denyLike ? "danger" : index === 0 ? "primary" : "secondary";
        button.textContent = option.label;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          bridge?.resolveAction?.({
            interactionId: actions.interactionId,
            optionId: option.optionId,
          });
        });
        return button;
      }),
    );
  };

  // ---------------- 状态角标（对齐官方 badge 色板） ----------------
  let badgeElement: HTMLDivElement | null = null;
  const BADGE_COLORS: Record<string, string> = {
    running: "#3b82f6",
    waiting: "#f59e0b",
    failed: "#ef4444",
    review: "#22c55e",
  };
  let taskTitle: string | undefined;
  let notifications: PetNotificationRow[] = [];
  let trayOpen = false;
  let pendingActions:
    | { interactionId: string; options: Array<{ optionId: string; label: string }> }
    | undefined;
  /**
   * 官方 badge 语义（avatar-overlay-page）：只在**有通知**时渲染，内容是通知条数；
   * 托盘展开时变成收起图标。它不是一个按状态常驻的色点——常驻会让「已完成」也
   * 一直挂个绿点，与官方不符。
   */
  const updateBadge = (): void => {
    const hasNotifications = notifications.length > 0;
    if (!hasNotifications) {
      badgeElement?.remove();
      badgeElement = null;
      return;
    }
    if (!badgeElement) {
      badgeElement = document.createElement("div");
      badgeElement.style.cssText =
        "position:absolute;top:4px;right:4px;min-width:16px;height:16px;border-radius:8px;" +
        "display:flex;align-items:center;justify-content:center;padding:0 4px;" +
        "font:600 10px/1 system-ui,sans-serif;color:#fff;cursor:pointer;" +
        "border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.35);z-index:30;" +
        "pointer-events:auto;";
      // 官方角标挂在宠物右上角，不是窗口右上角（窗口还包含上方的托盘区域）。
      badgeElement.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      // 官方点击 badge = 展开/收起托盘。
      badgeElement.addEventListener("click", (event) => {
        event.stopPropagation();
        trayOpen = !trayOpen;
        updateBadge();
        updateTray();
        updatePill();
      });
      petElement.appendChild(badgeElement);
    }
    // 官方底色取首条通知的 badgeBackgroundColor（红=失败/黄=等待/绿=就绪/蓝=运行）。
    const topState = notifications[0]?.state ?? "running";
    badgeElement.style.background = BADGE_COLORS[topState] ?? "#3b82f6";
    badgeElement.textContent = String(notifications.length);
    badgeElement.title = trayOpen ? "收起活动" : "展开活动";
  };

  // 首启挥手（官方 first-awake）。
  transientState = "waving";
  applyLayout();
  render();
}
