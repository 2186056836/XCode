/* eslint-disable max-lines -- 窗口生命周期、IPC、托盘、配置归一化与碎碎念调度共享同一份宠物状态，拆开会让跨窗口一致性更难追踪 */
/**
 * DSH 桌宠悬浮窗控制器（第二套宠物系统，独立实现）。
 *
 * 与 Codex 精灵图宠物（petOverlay.ts）完全分开：独立窗口、独立配置存储
 * （userData/dsh-pet-overlay.json）、独立 IPC 通道（DshPet*）、独立渲染页
 * （dsh-pet-overlay.html?pet=<id>）。两套可同时开启、同屏并存、互不影响。
 *
 * 窗口与命中语义逐条移植自 PC2005-cloud/dsh-pet 的 runtime/electron-helper：
 *  - 每只宠物一个窗口（pets[].display = desktop/both 才建窗）；
 *  - 窗口 = 宠物包围盒 + 四周余量（左右下 = size×0.5，上边距按气泡加高）；
 *  - 窗口默认**整窗点击穿透**，主进程按 60ms 轮询真实光标，进入身体命中区才
 *    临时取消穿透（dsh-pet 注释实测：Electron 的 forward 鼠标钩子在 Windows 上
 *    会静默失效，不能依赖）；
 *  - 位置由渲染层逐帧上报（渲染层拥有物理），主进程只应用 bounds。
 */
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  screen,
  Tray,
} from "electron";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PlatformChannels } from "@zcode/shared";
import { computePetGeometry } from "../shared/dshPetCore.js";
import {
  normalizeDshPetConfig,
  type DshPetEntry,
  type DshPetUserConfig,
} from "../shared/dshPetConfig.js";
import {
  ALL_ACTION_NAMES,
  BUNDLED_ACTIONS,
  createDshAssetsManager,
  type DshAssetsManager,
  type DshAssetsProgress,
} from "./dshPetAssets.js";

/** 运行时配置即上游设置页管理的那一份。 */
export type DshPetConfig = DshPetUserConfig;

/** 光标轮询间隔（ms）：dsh-pet pointer-target.js 同名常量。 */
const POINTER_POLL_MS = 60;
/** 光标停在余量区（非输入忙碌）超过它即恢复穿透（ms）。 */
const OFF_BODY_RELEASE_MS = 400;
/**
 * 内联字体的体积上限（字节）。上首软糖体约 3.9 MB，base64 后约 5.2 MB；
 * 超过这个量级说明取到的不是预期字体，宁可回落到系统字体也不要把主进程内存撑爆。
 */
const DSH_PET_FONT_MAX_BYTES = 16 * 1024 * 1024;

interface DshPetDependencies {
  preloadPath: string;
  /** 主应用窗（排除两套桌宠窗；装配方保证）。 */
  getMainWindow: (overlayWindow: BrowserWindow | null) => BrowserWindow | null;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  /**
   * 一次性文本生成（碎碎念/对话回复）：走主窗渲染层的 workspace services 调
   * workspaceGenerateText，不传 selection = 跟随当前会话模型。失败/超时返回 null。
   */
  generateText: (
    prompt: string,
    selection?: { providerId: string; modelId: string } | null,
    attachment?: { mediaType: string; data: string },
  ) => Promise<string | null>;
  /** 最近一次 generateText 失败的原因（对话失败要透给弹窗，不吞成「模型未返回文本」）。 */
  getLastGenerateError: () => string | null;
  /** 自制宠物包的媒体授权：登记绝对路径并换取可播放的 URL（zcode-media 协议）。 */
  authorizePackMedia: (path: string) => Promise<string>;
}

/** 每只宠物窗口的运行时状态（命中区判定 / 穿透镜像 / 输入租约都按窗隔离）。 */
interface PetWindowEntry {
  petId: string;
  win: BrowserWindow;
  /** 渲染层最近一次上报的窗口矩形与余量（DIP）：命中区判定依据。 */
  lastBounds: { x: number; y: number; width: number; height: number } | null;
  lastMargins: { l: number; t: number };
  /**
   * 舞台（宠物视频盒）尺寸。菜单打开时窗口会临时变大，此时「窗口宽 − 两侧余量」
   * 不再等于宠物宽，命中区必须用这个显式值。
   */
  lastStage: { width: number; height: number };
  /** 光标是否在身体命中区内（上一帧快照，进/出沿通知渲染层收悬浮提示）。 */
  hoverBody: boolean;
  /** 当前穿透状态镜像（Electron 没有取值 API）。 */
  windowIgnoring: boolean;
  /** 光标停在余量区的连续时长（ms）。 */
  offBodyMs: number;
  /** 宠物互撞用的运动学快照：舞台左上角速度由连续 bounds 上报差分得到。 */
  vel: { vx: number; vy: number };
  prevPos: { x: number; y: number } | null;
  lastMoveAt: number;
  /** 渲染端是否正拿着鼠标输入（拖拽/菜单）；忙碌期间不强制恢复穿透。 */
  inputBusy: boolean;
}

export function createDshPetOverlayController(deps: DshPetDependencies) {
  const configPath = join(app.getPath("userData"), "dsh-pet-overlay.json");
  let config: DshPetConfig = normalizeDshPetConfig(null);
  /** petId → 窗口状态；只包含当前应该显示的宠物。 */
  const petWindows = new Map<string, PetWindowEntry>();
  let saveTimer: NodeJS.Timeout | null = null;
  let pointerTimer: NodeJS.Timeout | null = null;
  let tray: Tray | null = null;

  const geometryFor = (sizePx: number) => computePetGeometry(sizePx);

  /** 当前应显示窗口的宠物（display = desktop / both）。 */
  const visiblePets = (): DshPetConfig["pets"] =>
    config.pets.filter((pet) => pet.display === "desktop" || pet.display === "both");

  // ---------------- 配置持久化 ----------------
  const loadConfig = async (): Promise<void> => {
    try {
      // 与上游一致：只持久化配置项，不保存运行位置（重启回配置角落）。
      config = normalizeDshPetConfig(JSON.parse(await readFile(configPath, "utf8")));
    } catch {
      config = normalizeDshPetConfig(null);
    }
  };

  const scheduleSave = (): void => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void (async () => {
        try {
          await mkdir(join(configPath, ".."), { recursive: true });
          const temp = `${configPath}.tmp`;
          await writeFile(temp, JSON.stringify(config), "utf8");
          await rename(temp, configPath);
        } catch (error) {
          deps.logger.warn("[dsh-pet] config save failed", error);
        }
      })();
    }, 500);
    saveTimer.unref?.();
  };

  // ---------------- 托盘（上游 tray-platform 同语义：列出宠物，勾选切换显示） ----------------
  /** 16×16 占位图标：蓝底白点（没有随包 logo 资产，运行时画一枚）。 */
  const trayIcon = (): Electron.NativeImage => {
    // 上游 tray.js trayIcon：包内 logo 缩到 16×16（macOS 要模板图，否则深色菜单栏下看不见）。
    const file = app.isPackaged
      ? join(process.resourcesPath, "dsh-pet-logo.png")
      : join(import.meta.dirname, "../../build/dsh-pet-logo.png");
    let image = nativeImage.createFromPath(file);
    if (!image.isEmpty()) {
      image = image.resize({ width: 16, height: 16 });
      if (process.platform === "darwin") image.setTemplateImage(true);
      return image;
    }
    // 读不到图标 = 托盘不可见但菜单逻辑照跑，最难查的一种坏法：必须留下能定位的日志。
    deps.logger.warn(`[dsh-pet] tray icon missing or unreadable: ${file}`);
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x - 7.5;
        const dy = y - 7.5;
        const inside = dx * dx + dy * dy <= 36;
        const offset = (y * size + x) * 4;
        // BGRA
        buf[offset] = inside ? 255 : 0;
        buf[offset + 1] = inside ? 160 : 0;
        buf[offset + 2] = inside ? 60 : 0;
        buf[offset + 3] = 255;
      }
    }
    return nativeImage.createFromBitmap(buf, { width: size, height: size });
  };

  /**
   * 系统托盘（逐字对齐上游 runtime/electron-helper/main/tray.js）：
   * 列出配置里的**全部**宠物（含已隐藏的——这正是托盘相对宠物右键菜单的增量），
   * 勾选 = 当前显示在桌面；点一下在 desktop / none 之间翻转。
   * 托盘只在「总开关打开、配置里有宠物、且 trayEnabled」时存在——关闭态连托盘都不留。
   */
  const syncTray = (): void => {
    if (!config.enabled || !config.trayEnabled || config.pets.length === 0) {
      tray?.destroy();
      tray = null;
      return;
    }
    const isDesktopDisplay = (display: DshPetEntry["display"]): boolean =>
      display === "desktop" || display === "both";
    const template: Electron.MenuItemConstructorOptions[] = config.pets.map((pet) => ({
      label: pet.name || pet.id,
      type: "checkbox",
      // 勾选 = 真的显示在桌面：总开关关闭时任何宠物都不算显示。
      checked: config.enabled && isDesktopDisplay(pet.display),
      click: () => {
        // 上游 toggleDisplay：桌面位在 desktop / none 间翻转（XCode 没有浏览器位）。
        // 总开关关闭时点一次 = 显式开启并显示这只宠物。
        const next = config.enabled && isDesktopDisplay(pet.display) ? "none" : "desktop";
        config = normalizeDshPetConfig({
          ...config,
          enabled: true,
          pets: config.pets.map((item) => (item.id === pet.id ? { ...item, display: next } : item)),
        });
        scheduleSave();
        broadcastConfig();
        void reconcileWindows().then(() => syncTray());
      },
    }));
    template.push(
      { type: "separator" },
      {
        // 上游「退出」= 结束桌面 Helper 进程；这里等价于关闭总开关：
        // 保留每只宠物的 display 设置，下次在设置页开启时按原样恢复。
        label: "退出桌宠",
        click: () => {
          config = normalizeDshPetConfig({
            ...config,
            enabled: false,
          });
          scheduleSave();
          broadcastConfig();
          void reconcileWindows().then(() => syncTray());
        },
      },
    );
    if (!tray) {
      tray = new Tray(trayIcon());
      tray.setToolTip("XCode 桌面宠物");
      // Windows：setContextMenu 只接管右键，左键默认什么都不做（上游 tray-platform 同判定）。
      if (process.platform === "win32") {
        tray.on("click", () => tray?.popUpContextMenu());
      }
    }
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  const broadcastConfig = (): void => {
    for (const entry of petWindows.values()) {
      if (!entry.win.isDestroyed()) {
        entry.win.webContents.send(PlatformChannels.DshPetConfigEvent, config);
      }
    }
    const main = deps.getMainWindow(firstWindow());
    if (main && !main.isDestroyed()) {
      main.webContents.send(PlatformChannels.DshPetConfigEvent, config);
    }
  };

  const firstWindow = (): BrowserWindow | null => petWindows.values().next().value?.win ?? null;

  // ---------------- 点击穿透（dsh-pet pointer-target.js 语义） ----------------
  /** 窗口矩形 → 宠物身体命中区的屏幕矩形（DIP）。 */
  const spriteHitRect = (entry: PetWindowEntry) => {
    if (!entry.lastBounds) return null;
    const CANVAS_H = 360;
    const CANVAS_W = 640;
    const FEET_Y = 330;
    const HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };
    const { x, y, width } = entry.lastBounds;
    const ml = entry.lastMargins.l;
    const mt = entry.lastMargins.t;
    // 优先用渲染层显式上报的舞台尺寸；缺失时退回旧口径（窗口宽 − 两侧余量）。
    const stageW = entry.lastStage.width > 0 ? entry.lastStage.width : width - ml * 2;
    const stageH = entry.lastStage.height > 0 ? entry.lastStage.height : (stageW * CANVAS_H) / CANVAS_W;
    const bottomPad = (stageH * (CANVAS_H - FEET_Y)) / CANVAS_H;
    return {
      left: x + ml + (HIT_BOX.x0 / CANVAS_W) * stageW,
      top: y + mt + bottomPad + (HIT_BOX.y0 / CANVAS_H) * stageH,
      right: x + ml + (HIT_BOX.x1 / CANVAS_W) * stageW,
      bottom: y + mt + bottomPad + (HIT_BOX.y1 / CANVAS_H) * stageH,
    };
  };

  const setWindowIgnore = (entry: PetWindowEntry, ignore: boolean): void => {
    if (entry.win.isDestroyed() || entry.windowIgnoring === ignore) return;
    entry.windowIgnoring = ignore;
    // forward:true 在本 Electron 的 Windows 上不可靠（dsh-pet 同样结论），
    // 故不依赖它转发事件，只做纯穿透开关，由轮询负责翻转。
    entry.win.setIgnoreMouseEvents(ignore);
  };

  const tickEntry = (entry: PetWindowEntry): void => {
    if (entry.win.isDestroyed()) return;
    const rect = spriteHitRect(entry);
    const applyIgnore = (ignore: boolean): void => {
      setWindowIgnore(entry, ignore);
    };
    if (!rect) {
      entry.hoverBody = false;
      applyIgnore(true);
      return;
    }
    const point = screen.getCursorScreenPoint();
    const bounds = entry.lastBounds;
    const inWindow =
      bounds != null &&
      point.x >= bounds.x &&
      point.x < bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y < bounds.y + bounds.height;
    const inBody =
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

    // 窗口转穿透后渲染层收不到 pointermove，悬浮提示的收起只能由主进程补发：
    // 光标从身体离开的那一刻推一条 exit 事件（上游 hoverBody 同语义）。
    if (entry.hoverBody && !inBody && !entry.inputBusy) {
      entry.win.webContents.send(PlatformChannels.DshPetStateEvent, {
        type: "pointer-exit-body",
      });
    }
    entry.hoverBody = inBody;

    if (inBody) {
      entry.offBodyMs = 0;
      applyIgnore(false);
      return;
    }
    if (entry.inputBusy) {
      // 渲染端正拿着输入（菜单展开 / 拖拽中）：必须保持整窗可交互，
      // 否则菜单一出现在身体命中区之外就直接穿透到下层窗口，点击全部失效。
      entry.offBodyMs = 0;
      applyIgnore(false);
      return;
    }
    applyIgnore(true);
    if (!inWindow) {
      entry.offBodyMs = 0;
      return;
    }
    entry.offBodyMs += POINTER_POLL_MS;
    if (entry.offBodyMs >= OFF_BODY_RELEASE_MS) {
      entry.offBodyMs = 0;
      // 兜底：余量区停留过久，强制恢复穿透（防渲染端忘记松手）。
      entry.win.webContents.send(PlatformChannels.DshPetStateEvent, {
        type: "force-release-input",
      });
    }
  };

  const stepPointer = (): void => {
    for (const entry of petWindows.values()) tickEntry(entry);
  };

  const startPointerPump = (): void => {
    if (pointerTimer) return;
    pointerTimer = setInterval(stepPointer, POINTER_POLL_MS);
    pointerTimer.unref?.();
  };

  const stopPointerPumpIfEmpty = (): void => {
    if (petWindows.size === 0 && pointerTimer) {
      clearInterval(pointerTimer);
      pointerTimer = null;
    }
  };

  // ---------------- 窗口生命周期 ----------------
  const resolvePageUrl = (petId: string): string => {
    const base = !app.isPackaged && process.env["ELECTRON_RENDERER_URL"]
      ? `${process.env["ELECTRON_RENDERER_URL"]}/dsh-pet-overlay.html`
      : `file://${join(import.meta.dirname, "../renderer/dsh-pet-overlay.html")}`;
    return `${base}?pet=${encodeURIComponent(petId)}`;
  };

  /** 把显示器工作区与完整配置下发给渲染层。 */
  const sendDisplays = (entry: PetWindowEntry): void => {
    if (entry.win.isDestroyed()) return;
    entry.win.webContents.send(PlatformChannels.DshPetStateEvent, {
      type: "displays",
      displays: screen.getAllDisplays().map((d) => ({
        x: d.workArea.x,
        y: d.workArea.y,
        width: d.workArea.width,
        height: d.workArea.height,
        scaleFactor: d.scaleFactor,
        primary: d.id === screen.getPrimaryDisplay().id,
      })),
      petId: entry.petId,
      config,
    });
  };

  const createPetWindow = async (pet: DshPetConfig["pets"][number]): Promise<PetWindowEntry> => {
    const geo = geometryFor(pet.size);
    // 初始放在主屏工作区左上角：真实位置由渲染层在收到显示器几何后按配置角落推送。
    const wa = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      width: geo.window.width,
      height: geo.window.height,
      x: wa.x,
      y: wa.y,
      acceptFirstMouse: true,
      backgroundColor: "#00000000",
      // 与 dsh-pet 一致：小窗、透明、置顶。窗口**必须可聚焦**——对话输入框/菜单
      // 需要键盘焦点才能打字（上游 windowOptions 同注释）；初始用 showInactive()
      // 显示，不打断其它应用。
      focusable: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      title: "XCode DSH Pet",
      transparent: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: deps.preloadPath,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.setAudioMuted(false);
    const entry: PetWindowEntry = {
      petId: pet.id,
      win,
      lastBounds: null,
      lastMargins: { l: 0, t: 0 },
      lastStage: { width: 0, height: 0 },
      hoverBody: false,
      windowIgnoring: true,
      offBodyMs: 0,
      inputBusy: false,
      vel: { vx: 0, vy: 0 },
      prevPos: null,
      lastMoveAt: 0,
    };
    // did-finish-load 早于渲染层注册监听（渲染层要先 await 读配置），
    // 因此这里只作为补充；真正的首次下发由渲染层的 ready 请求触发。
    win.webContents.on("did-finish-load", () => sendDisplays(entry));
    win.on("closed", () => {
      petWindows.delete(pet.id);
      stopPointerPumpIfEmpty();
    });
    petWindows.set(pet.id, entry);
    // 整窗默认穿透（dsh-pet 同语义）：鼠标事件由轮询翻转。
    win.setIgnoreMouseEvents(true);
    await win.loadURL(resolvePageUrl(pet.id));
    win.showInactive();
    startPointerPump();
    return entry;
  };

  /** 按配置对齐窗口集合：该显示的建窗，不该显示的关窗。 */
  const reconcileWindows = async (): Promise<void> => {
    // 总开关关闭时「应显示集合」恒为空：保存任何配置都不会意外弹出宠物窗。
    const shown = config.enabled ? visiblePets() : [];
    const wanted = new Set(shown.map((pet) => pet.id));
    // 迭代期间 closed 回调会删键，先拷贝快照。
    // eslint-disable-next-line unicorn/no-useless-spread -- 同上
    for (const [petId, entry] of [...petWindows.entries()]) {
      if (!wanted.has(petId)) {
        petWindows.delete(petId);
        if (!entry.win.isDestroyed()) entry.win.close();
      }
    }
    for (const pet of shown) {
      if (!petWindows.has(pet.id)) {
        try {
          await createPetWindow(pet);
        } catch (error) {
          deps.logger.warn(`[dsh-pet] failed to create window for ${pet.id}`, error);
        }
      }
    }
    stopPointerPumpIfEmpty();
  };

  const closeAllWindows = (): void => {
    for (const entry of petWindows.values()) {
      if (!entry.win.isDestroyed()) entry.win.close();
    }
    petWindows.clear();
    stopPointerPumpIfEmpty();
  };

  // ---------------- IPC ----------------
  const entryOfSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): PetWindowEntry | null => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const entry of petWindows.values()) {
      if (entry.win === win) return entry;
    }
    return null;
  };

  /**
   * 宠物互撞的共享站场（上游桌面端 collision broker 的等价实现）：
   * 把每只可见宠物的「舞台左上角 + 速度 + 尺寸」周期性发给其余宠物窗口，
   * 飞行积分在各自渲染层做（与上游 flight.ts 相同的数学），被撞方经 petHit 回主进程转发。
   */
  const broadcastPeers = (): void => {
    const snapshot = [...petWindows.values()]
      .filter((entry) => !entry.win.isDestroyed() && entry.lastBounds)
      .map((entry) => {
        const pet = config.pets.find((item) => item.id === entry.petId);
        const size = entry.lastStage.width || pet?.size || 462;
        // 静止判定：250ms 没有 bounds 上报视为速度 0（拖拽/飞行中每帧都有上报）。
        const moving = Date.now() - entry.lastMoveAt < 250;
        return {
          id: entry.petId,
          size,
          bottomPad: computePetGeometry(size).bottomPad,
          x: entry.lastBounds!.x + entry.lastMargins.l,
          y: entry.lastBounds!.y + entry.lastMargins.t,
          vx: moving ? entry.vel.vx : 0,
          vy: moving ? entry.vel.vy : 0,
          busy: entry.inputBusy,
        };
      });
    for (const entry of petWindows.values()) {
      if (entry.win.isDestroyed()) continue;
      entry.win.webContents.send(PlatformChannels.DshPetStateEvent, {
        type: "peers",
        peers: snapshot.filter((peer) => peer.id !== entry.petId),
      });
    }
  };

  let peerTimerScheduled = false;
  /** 广播节流：bounds 上报很密（飞行逐帧），120ms 一拍足够碰撞判定用。 */
  const schedulePeerBroadcast = (): void => {
    if (peerTimerScheduled) return;
    peerTimerScheduled = true;
    const timer = setTimeout(() => {
      peerTimerScheduled = false;
      broadcastPeers();
    }, 120);
    timer.unref?.();
  };

  /**
   * 完整素材包管理器（上游 dsh-pet/assets，约 60 MB，下载到本地）。
   *
   * 内置只带精简版：待机/转向/拖拽/5 个点击回应共 8 个动作 + config。其余 98 个
   * 动作、表情包和字体从上游逐文件下载，不整包拉（本机测速只有
   * 30–50 KB/s，整包 60 MB 要半小时）。放在 registerIpc 之前：IPC 注册时要引用它。
   */
  const dshAssets: DshAssetsManager = createDshAssetsManager({
    cacheRoot: join(app.getPath("userData"), "dsh-pet", "assets"),
    logger: deps.logger as never,
    // 走 Electron 的 net.fetch：继承系统代理设置，公司网络/代理环境下才连得上。
    fetchImpl: async (input, init) => net.fetch(input, init as never),
  });
  /** 正在进行的批量下载：允许设置页「取消」。 */
  let assetsInstallAbort: AbortController | null = null;

  /** 把进度单向设置页所在主窗广播（桌宠窗不响应设置操作）。 */
  const broadcastAssetsProgress = (progress: DshAssetsProgress): void => {
    const mainWindow = deps.getMainWindow(null);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(PlatformChannels.DshPetAssetsProgressEvent, progress);
    }
  };

  const registerIpc = (): void => {
    ipcMain.handle(PlatformChannels.DshPetGetConfig, () => config);
    // 设置页「存储位置」卡（上游 paths-cards 的 XCode 等价）：只读展示落盘路径。
    ipcMain.handle(PlatformChannels.DshPetGetMeta, () => ({
      userConfig: configPath,
      memoryDir: join(app.getPath("userData"), "dsh-pet", "memory"),
    }));
    // 自制宠物包：设置页列包选包；桌宠窗按 petId 读包（config + 授权 webm URL）。
    ipcMain.handle(PlatformChannels.DshPetListPacks, () => listPacks());
    // 完整素材：逐文件下载到本地（整包 60 MB 在本机只有 30–50 KB/s，不可行）。
    // status：已下载多少 / 上游总数；probe：镜像测速排名；download：下载上游全部素材。
    ipcMain.handle(PlatformChannels.DshPetAssetsStatus, () => dshAssets.status());
    ipcMain.handle(PlatformChannels.DshPetAssetsProbe, () => dshAssets.probeMirrors());
    /**
     * 下载上游素材：把内置 8 个动作之外的 98 个动作、27 张表情包和字体全部下到本地。
     *
     * 设置页「下载全部素材」按钮走这里。慢速网络下可能要十几分钟，因此支持取消；
     * 已下到的文件保留，再次下载只补缺的。
     */
    ipcMain.handle(PlatformChannels.DshPetAssetsDownload, async () => {
      if (assetsInstallAbort) return { ok: false, error: "already-running" };
      const controller = new AbortController();
      assetsInstallAbort = controller;
      try {
        const pending = ALL_ACTION_NAMES.filter((n) => !BUNDLED_ACTIONS.includes(n as never));
        const webm = await dshAssets.ensureWebm(pending, {
          signal: controller.signal,
          onProgress: broadcastAssetsProgress,
        });
        if (controller.signal.aborted) return { ok: false, error: "cancelled" };
        const memes = await dshAssets.ensureMemes({
          signal: controller.signal,
          onProgress: broadcastAssetsProgress,
        });
        const font = await dshAssets.ensureFont({ signal: controller.signal });
        const status = await dshAssets.status();
        // 素材装好后重载桌宠窗：字体是在窗口初始化时一次性注入的（applyAssetFont），
        // 不重载的话「下载全部素材」之后要等用户重启应用才看得到软糖体和完整动作。
        if (font) {
          for (const entry of petWindows.values()) {
            if (!entry.win.isDestroyed()) entry.win.webContents.reload();
          }
        }
        return {
          ok: true,
          counts: { ...status.counts, font: status.counts.font && Boolean(font) },
          downloaded: { webm: Object.keys(webm).length, memes: memes.length },
        };
      } finally {
        assetsInstallAbort = null;
      }
    });
    /**
     * 已缓存的动作名列表。
     *
     * 右键菜单只列这些：列了没缓存的反而害用户——点了要等下载，慢网下像卡死。
     * 内置 8 个核心动作永远可用，由渲染端自己并上，不走这个通道。
     */
    ipcMain.handle(PlatformChannels.DshPetAssetsCached, () => dshAssets.cachedWebmNames());
    ipcMain.handle(PlatformChannels.DshPetAssetsCancel, () => {
      assetsInstallAbort?.abort();
      return { ok: true };
    });
    ipcMain.handle(PlatformChannels.DshPetAssetsUninstall, async () => {
      await dshAssets.clear();
      return { ok: true };
    });
    /**
     * 渲染端取动作的播放 URL —— 缓存里有就直接授权返回，没有就当场下载。
     *
     * 单动作补缺入口：桌宠切到某动作而本地没有时调用，`ensureWebm` 只下缺的。
     * 没触发过的动作永远不下载。返回空 = 该动作既没缓存也下载失败，渲染端跳过。
     */
    ipcMain.handle(
      PlatformChannels.DshPetAssetsMedia,
      async (_event, payload: { names?: unknown; memes?: unknown; font?: unknown }) => {
        const names = Array.isArray(payload?.names)
          ? payload.names.filter((n): n is string => typeof n === "string")
          : [];
        const webmUrls: Record<string, string> = {};
        if (names.length > 0) {
          const ready = await dshAssets.ensureWebm(names, {
            onProgress: broadcastAssetsProgress,
          });
          for (const [name, path] of Object.entries(ready)) {
            try {
              webmUrls[name] = await deps.authorizePackMedia(path);
            } catch {
              /* 单个授权失败跳过 */
            }
          }
        }
        const memeUrls: Record<string, string> = {};
        if (payload?.memes === true) {
          const cached = await dshAssets.cachedMemes();
          for (const name of cached) {
            try {
              memeUrls[name] = await deps.authorizePackMedia(
                join(app.getPath("userData"), "dsh-pet", "assets", "memes", name),
              );
            } catch {
              /* 跳过 */
            }
          }
        }
        let font: string | null = null;
        if (payload?.font === true) {
          const path = await dshAssets.cachedFont();
          if (path) {
            // 修复原因（「选了软糖体没生效」）：字体必须内联成 data URL。
            // @font-face 对跨源字体强制 CORS 校验，而 zcode-media 走 registerFileProtocol，
            // 响应带不了 Access-Control-Allow-Origin，字体加载会被静默拒绝——图片和视频
            // 不做这个校验，所以只有字体坏。读成 base64 内联就绕开了跨源判定。
            try {
              const data = await readFile(path);
              if (data.byteLength > 0 && data.byteLength <= DSH_PET_FONT_MAX_BYTES) {
                font = `data:font/ttf;base64,${data.toString("base64")}`;
              } else if (data.byteLength > 0) {
                deps.logger.warn("[dsh-pet] bundled font too large, ignored", {
                  bytes: data.byteLength,
                });
              }
            } catch (error) {
              deps.logger.warn("[dsh-pet] read bundled font failed", error);
              font = null;
            }
          }
        }
        return { webm: webmUrls, memes: memeUrls, font };
      },
    );
    ipcMain.handle(PlatformChannels.DshPetLoadPack, (_event, payload: { petId?: unknown }) => {
      const petId = typeof payload?.petId === "string" ? payload.petId : "";
      const packId = config.pets.find((item) => item.id === petId)?.packId ?? "";
      return packId ? loadPack(packId) : { error: "no-pack" };
    });
    // 设置页整包保存：合并后整体规范化，脏值不会进内存也不会落盘；随后按 display 对齐窗口集合。
    ipcMain.handle(PlatformChannels.DshPetSetConfig, (event, patch: Partial<DshPetConfig>) => {
      const wasEnabled = config.enabled;
      config = normalizeDshPetConfig({ ...config, ...patch });
      // 总开关从「关」切到「开」但所有宠物都在隐藏位：开启的语义就是把宠物唤回桌面。
      // 旧版「退出桌宠」会留下 display=none，不做这步时勾选保存后桌面上什么都不会出现。
      if (
        !wasEnabled &&
        config.enabled &&
        config.pets.length > 0 &&
        !config.pets.some((pet) => pet.display === "desktop" || pet.display === "both")
      ) {
        config = {
          ...config,
          pets: config.pets.map((pet) => ({ ...pet, display: "desktop" })),
        };
      }
      scheduleSave();
      broadcastConfig();
      void reconcileWindows().then(() => syncTray());
      BrowserWindow.fromWebContents(event.sender)?.webContents.send(
        PlatformChannels.DshPetConfigEvent,
        config,
      );
      return config;
    });
    // 渲染层就绪：下发显示器几何（此时监听已注册，不会丢帧）。
    ipcMain.on(PlatformChannels.DshPetReady, (event) => {
      const entry = entryOfSender(event);
      if (entry) sendDisplays(entry);
    });
    // 菜单「打开 XCode」：显式动作，恢复并聚焦主窗（点击宠物本身不会触发）。
    ipcMain.on(PlatformChannels.DshPetOpenApp, () => {
      const main = deps.getMainWindow(firstWindow());
      if (!main || main.isDestroyed()) return;
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    });
    // 菜单「重载配置」（上游 reload 同语义）：重读磁盘配置，再重载全部悬浮窗。
    ipcMain.on(PlatformChannels.DshPetReload, () => {
      void (async () => {
        await loadConfig();
        await reconcileWindows();
        broadcastConfig();
        for (const entry of petWindows.values()) {
          if (!entry.win.isDestroyed()) entry.win.webContents.reload();
        }
      })();
    });
    // 渲染层逐帧上报窗口矩形（渲染层拥有物理）。主进程只应用 + 记命中区依据。
    ipcMain.on(
      PlatformChannels.DshPetDrag,
      (
        event,
        payload: {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          marginL?: number;
          marginT?: number;
          /** 舞台（宠物盒）尺寸：窗口因菜单临时变大时必须显式给，命中区不能用窗口宽反推。 */
          stageWidth?: number;
          stageHeight?: number;
          /** 透明窗挪移/缩放后强制整窗重绘：清掉 DWM 残留的旧帧（宠物残影）。 */
          invalidate?: boolean;
        },
      ) => {
        const entry = entryOfSender(event);
        if (!entry || entry.win.isDestroyed()) return;
        const x = Number(payload.x);
        const y = Number(payload.y);
        const width = Number(payload.width);
        const height = Number(payload.height);
        if (![x, y, width, height].every(Number.isFinite)) return;
        entry.lastBounds = {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        };
        if (Number.isFinite(payload.marginL) && Number.isFinite(payload.marginT)) {
          entry.lastMargins = { l: Number(payload.marginL), t: Number(payload.marginT) };
        }
        if (Number.isFinite(payload.stageWidth) && Number.isFinite(payload.stageHeight)) {
          entry.lastStage = { width: Number(payload.stageWidth), height: Number(payload.stageHeight) };
        }
        // 宠物互撞的运动学快照：舞台左上角（屏幕坐标）对相邻两次上报做差分。
        // 飞行时渲染层逐帧 pushBounds，差分就是真实速度；静止时长时间无更新归零。
        const stageX = entry.lastBounds.x + entry.lastMargins.l;
        const stageY = entry.lastBounds.y + entry.lastMargins.t;
        const now = Date.now();
        if (entry.prevPos) {
          const dt = (now - entry.lastMoveAt) / 1000;
          if (dt > 0 && dt < 0.4) {
            entry.vel = { vx: (stageX - entry.prevPos.x) / dt, vy: (stageY - entry.prevPos.y) / dt };
          } else if (dt >= 0.4) {
            entry.vel = { vx: 0, vy: 0 };
          }
        }
        entry.prevPos = { x: stageX, y: stageY };
        entry.lastMoveAt = now;
        schedulePeerBroadcast();
        const bounds = entry.win.getBounds();
        const next = { ...entry.lastBounds };
        if (
          bounds.x !== next.x ||
          bounds.y !== next.y ||
          bounds.width !== next.width ||
          bounds.height !== next.height
        ) {
          entry.win.setBounds(next, false);
        }
        if (payload.invalidate === true) {
          // 透明窗在 setBounds 后 DWM 可能继续合成旧帧（旧位置的宠物残影）：
          // 强制整窗失效重绘，把陈旧纹理清掉。
          entry.win.webContents.invalidate();
        }
      },
    );
    // 菜单「碎碎念」：立即为该宠物生成一句并推回。
    ipcMain.on(PlatformChannels.DshPetWhisper, (event, payload?: { meme?: unknown }) => {
      const entry = entryOfSender(event);
      if (!entry) return;
      const pet = config.pets.find((item) => item.id === entry.petId);
      if (!pet || !pet.whisperEnabled) return;
      // 配图由渲染层抽（素材包在渲染层），这里只把它写进 prompt 让文案贴合画面。
      const meme =
        typeof payload?.meme === "string" && payload.meme.trim() ? payload.meme.trim() : null;
      void generateWhisper(pet, meme);
    });
    // 对话：渲染层发整段消息历史，主进程持久化并生成回复推回。
    ipcMain.handle(
      PlatformChannels.DshPetChat,
      async (
        event,
        payload: {
          petId?: string;
          message?: string;
          /** 表情包候选池（文件名），渲染层随请求带上；对话配图已关闭时为空。 */
          pool?: unknown;
          imageEnabled?: unknown;
          /** 本轮附带的图片（base64，不带 data: 前缀）。 */
          attachment?: unknown;
        },
      ) => {
        const entry = entryOfSender(event);
        const petId = entry?.petId ?? payload.petId;
        const pet = config.pets.find((item) => item.id === petId);
        const message = typeof payload.message === "string" ? payload.message.trim() : "";
        if (!pet || !message) return { ok: false as const, message: "消息为空或宠物不存在" };
        // 对话配图（上游 chatImageEnabled + chatImageLimit）：把候选清单交给模型挑一张，
        // 回复末尾写 [图:名称]，这里解析并剥掉标记。
        const attachment =
          payload.attachment &&
          typeof payload.attachment === "object" &&
          typeof (payload.attachment as { mediaType?: unknown }).mediaType === "string" &&
          typeof (payload.attachment as { data?: unknown }).data === "string"
            ? {
                mediaType: (payload.attachment as { mediaType: string }).mediaType,
                data: (payload.attachment as { data: string }).data,
              }
            : undefined;
        const limit = Math.max(0, config.chatImageLimit);
        const pool =
          payload.imageEnabled === true && Array.isArray(payload.pool)
            ? payload.pool
                .filter((item): item is string => typeof item === "string" && !!item.trim())
                .slice(0, limit > 0 ? limit : undefined)
            : [];
        return await (async (): Promise<{ ok: boolean; message?: string }> => {
          try {
            await appendMemory(pet.id, { role: "user", content: message });
            const memory = await readMemory(pet.id);
            const persona = pet.whisperPrompt || config.whisperPrompt;
            const name = pet.name || pet.id;
            const rounds = Math.max(0, config.chatMemoryRounds);
            const history = memory.slice(Math.max(0, memory.length - rounds * 2));
            const transcript = history
              .map((item) => `${item.role === "user" ? "主人" : name}：${item.content}`)
              .join("\n");
            const prompt = [
              persona,
              `你的名字是「${name}」。当前时间：${new Date().toLocaleString("zh-CN")}。`,
              "以下是你们最近的对话记录，请以这只桌宠的口吻回复主人的最后一句：",
              transcript,
              `主人：${message}`,
              "只输出回复本身，不超过 60 个字。",
              pool.length > 0 ? chatImageInstruction(pool) : "",
            ].filter(Boolean).join("\n");
            const chatSelection =
              config.chatModel.provider && config.chatModel.model
                ? { providerId: config.chatModel.provider, modelId: config.chatModel.model }
                : null;
            const text = await generatePetText(prompt, chatSelection, attachment);
            const parsed = extractChatImage((text ?? "").trim(), pool);
            const cleaned = parsed.text.split("\n")[0]?.trim();
            if (!cleaned) {
              return {
                ok: false as const,
                message: text === null ? (deps.getLastGenerateError() ?? "生成失败") : "模型未返回文本",
              };
            }
            await appendMemory(pet.id, { role: "assistant", content: cleaned });
            if (entry && !entry.win.isDestroyed()) {
              entry.win.webContents.send(PlatformChannels.DshPetStateEvent, {
                type: "chat-reply",
                text: cleaned,
                ...(parsed.image ? { image: parsed.image } : {}),
              });
            }
            return { ok: true as const };
          } catch (error) {
            deps.logger.warn("[dsh-pet] chat reply failed", error);
            return {
              ok: false as const,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        })();
      },
    );
    // 对话面板打开：聚焦本桌宠窗，输入框才能收键盘（窗口 focusable:true）。
    ipcMain.on(PlatformChannels.DshPetFocusSelf, (event) => {
      const entry = entryOfSender(event);
      if (!entry || entry.win.isDestroyed()) return;
      entry.win.showInactive();
      entry.win.focus();
    });
    // 渲染端输入租约：拖拽/菜单期间不强制恢复穿透（按窗隔离）。
    ipcMain.on(PlatformChannels.DshPetThrow, (event, payload: { busy?: boolean }) => {
      const entry = entryOfSender(event);
      if (!entry) return;
      entry.inputBusy = payload.busy === true;
      if (entry.inputBusy) entry.offBodyMs = 0;
    });
    // 截屏：取宠物所在那块屏的一帧，按物理像素请求缩略图，回一次 JPEG base64。
    // 不做流、不落盘；渲染端拿到后与上传图片走同一条预算编码（上游 pet:capture-screen 同构）。
    ipcMain.handle(PlatformChannels.DshPetCaptureScreen, async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
      const scale = display.scaleFactor || 1;
      const size = {
        width: Math.max(1, Math.min(4096, Math.round(display.size.width * scale))),
        height: Math.max(1, Math.min(4096, Math.round(display.size.height * scale))),
      };
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
      // display_id 是字符串；取不到对应屏时退回第一块，总比「点了没反应」好
      const source =
        sources.find((item) => String(item.display_id) === String(display.id)) ?? sources[0];
      if (!source || source.thumbnail.isEmpty()) return null;
      const thumbnail = source.thumbnail;
      const { width, height } = thumbnail.getSize();
      const data = thumbnail.toJPEG(85).toString("base64");
      return { mediaType: "image/jpeg", data, width, height, bytes: Math.floor((data.length * 3) / 4) };
    });
    // 宠物互撞：被撞方拿新初速从当前落点重新抛出（上游 flight onHit 语义）。
    ipcMain.on(
      PlatformChannels.DshPetPetHit,
      (event, payload: { targetId?: unknown; vx?: unknown; vy?: unknown }) => {
        void event;
        const vx = Number(payload?.vx);
        const vy = Number(payload?.vy);
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
        const target =
          typeof payload?.targetId === "string" ? petWindows.get(payload.targetId) : undefined;
        if (!target || target.win.isDestroyed() || target.inputBusy) return;
        target.win.webContents.send(PlatformChannels.DshPetStateEvent, {
          type: "pet-hit",
          vx,
          vy,
        });
      },
    );
  };

  /** 会话状态变化 → 系统通知（上游 notificationsEnabled：窗口失焦时弹）。 */
  const maybeNotify = (payload: Record<string, unknown>): void => {
    // 总开关关闭 = 桌宠未运行，不弹任何通知。
    if (!config.enabled || !config.notificationsEnabled) return;
    const state = String(payload.state ?? "");
    if (state !== "waiting" && state !== "success" && state !== "failed") return;
    const main = deps.getMainWindow(firstWindow());
    // 主窗聚焦 = 用户正在看，不打扰。
    if (main && !main.isDestroyed() && main.isFocused()) return;
    const titles: Record<string, string> = {
      waiting: "桌宠：等待你的确认",
      success: "桌宠：任务完成",
      failed: "桌宠：任务失败",
    };
    try {
      const detail = typeof payload.title === "string" ? payload.title : "";
      new Notification({ title: titles[state] ?? "桌宠", body: detail }).show();
    } catch {
      /* 通知不可用，静默忽略。 */
    }
  };

  // ---------------- 碎碎念 / 对话（模型经 generateText 依赖走当前会话模型） ----------------
  const memoryPath = (petId: string): string =>
    join(app.getPath("userData"), "dsh-pet", "memory", `${petId}.json`);

  // ---------------- 自制宠物包（pet-maker 产出，userData/dsh-pet/packs/<id>/） ----------------
  const packsRoot = (): string => join(app.getPath("userData"), "dsh-pet", "packs");

  interface DshPackSummary {
    id: string;
    name: string;
  }

  interface DshPackMedia {
    animations?: unknown;
    animationWeights?: unknown;
    workStatusTexts?: unknown;
  }

  interface DshPackLoaded {
    name: string;
    animations: unknown;
    animationWeights: unknown;
    workStatusTexts: unknown;
    urls: Record<string, string>;
  }

  /** 列出全部包：目录里找第一份 *-config.json（pet-maker 安装布局），名字取 pets[0].name。 */
  const listPacks = async (): Promise<DshPackSummary[]> => {
    try {
      const entries = await readdir(packsRoot(), { withFileTypes: true });
      const packs: DshPackSummary[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = join(packsRoot(), entry.name);
        try {
          const files = await readdir(dir);
          const configFile = files.find((file) => file === "config.json" || file.endsWith("-config.json"));
          if (!configFile) continue;
          const parsed = JSON.parse(await readFile(join(dir, configFile), "utf8")) as {
            pets?: Array<{ name?: unknown }>;
          };
          const name =
            typeof parsed.pets?.[0]?.name === "string" && parsed.pets[0]!.name!.trim()
              ? parsed.pets[0]!.name!.trim()
              : entry.name;
          packs.push({ id: entry.name, name });
        } catch {
          deps.logger.warn(`[dsh-pet] pack skipped (unreadable): ${entry.name}`);
        }
      }
      return packs;
    } catch {
      return [];
    }
  };

  /** 递归收集包内全部 webm：动作名 = 文件名（去扩展名），与 dsh-pet 素材约定一致。 */
  const collectPackWebms = async (dir: string, out: Map<string, string>): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectPackWebms(child, out);
        continue;
      }
      if (entry.name.toLowerCase().endsWith(".webm")) {
        out.set(entry.name.slice(0, -5), child);
      }
    }
  };

  /** 读包：config 的 animations/workStatusTexts + 全部 webm 的授权播放 URL。 */
  const loadPack = async (packId: string): Promise<DshPackLoaded | { error: string }> => {
    if (!packId || packId.includes("/") || packId.includes("\\") || packId.includes("..")) {
      return { error: "bad-pack-id" };
    }
    const dir = join(packsRoot(), packId);
    try {
      const files = await readdir(dir);
      const configFile = files.find((file) => file === "config.json" || file.endsWith("-config.json"));
      if (!configFile) return { error: "pack-config-missing" };
      const parsed = JSON.parse(await readFile(join(dir, configFile), "utf8")) as DshPackMedia & {
        pets?: Array<{ name?: unknown }>;
      };
      const webms = new Map<string, string>();
      await collectPackWebms(dir, webms);
      const urls: Record<string, string> = {};
      for (const [name, path] of webms) {
        try {
          urls[name] = await deps.authorizePackMedia(path);
        } catch {
          // 授权失败的单个素材跳过：渲染端回落到内置同名素材或忽略该动作。
        }
      }
      const name =
        typeof parsed.pets?.[0]?.name === "string" && parsed.pets[0]!.name!.trim()
          ? parsed.pets[0]!.name!.trim()
          : packId;
      return {
        name,
        animations: parsed.animations ?? {},
        animationWeights: parsed.animationWeights ?? {},
        workStatusTexts: parsed.workStatusTexts ?? [],
        urls,
      };
    } catch (error) {
      deps.logger.warn(`[dsh-pet] pack load failed: ${packId}`, error);
      return { error: "pack-load-failed" };
    }
  };

  const readMemory = async (petId: string): Promise<Array<{ role: "user" | "assistant"; content: string }>> => {
    try {
      const parsed = JSON.parse(await readFile(memoryPath(petId), "utf8")) as {
        messages?: Array<{ role: "user" | "assistant"; content: string }>;
      };
      return Array.isArray(parsed.messages) ? parsed.messages : [];
    } catch {
      return [];
    }
  };

  const appendMemory = async (
    petId: string,
    entry: { role: "user" | "assistant"; content: string },
  ): Promise<void> => {
    const messages = [...(await readMemory(petId)), entry].slice(-40);
    await mkdir(join(memoryPath(petId), ".."), { recursive: true });
    await writeFile(memoryPath(petId), JSON.stringify({ messages }, null, 2), "utf8");
  };

/**
 * 对话配图指令（上游 generateChat 的 [配图] 段）：交给模型按语境挑一张，
 * 清单截断到 chatImageLimit 由调用方完成。
 */
function chatImageInstruction(pool: string[]): string {
  return (
    "\n\n[配图] 回复结尾可选附一张表情包给用户看，从下列清单里挑最贴合当前语境的：\n" +
    pool.map((file) => `- ${memeStem(file)}`).join("\n") +
    "\n挑中就在回复最后另起一行写 [图:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。"
  );
}

/** 池内文件名 → 给模型看的名称（去扩展名，上游 memes 的 name 就是这个形状）。 */
function memeStem(file: string): string {
  return file.replace(/\.[a-zA-Z0-9]+$/, "");
}

/** 从回复里摘出 [图:名称]（名称按池内 stem 或完整文件名匹配），返回剥掉标记的正文。 */
function extractChatImage(text: string, pool: string[]): { text: string; image?: string } {
  const match = /\[图[:：]\s*([^\]\n]+)\]\s*$/.exec(text);
  if (!match) return { text };
  const name = match[1]!.trim();
  const body = text.slice(0, match.index).trim();
  const file = pool.find((item) => item === name) ?? pool.find((item) => memeStem(item) === name);
  if (!file || !body) return { text };
  return { text: body, image: file };
}

  /**
   * 生成文本：条目单独配置了模型（whisperModel/chatModel）就先用它，
   * 失败时回落到当前会话模型并留痕（上游 modelCandidates 的候选链语义）。
   */
  const generatePetText = async (
    prompt: string,
    selection: { providerId: string; modelId: string } | null,
    attachment?: { mediaType: string; data: string },
  ): Promise<string | null> => {
    const first = await deps.generateText(prompt, selection, attachment);
    if (first !== null || !selection) return first;
    deps.logger.warn("[dsh-pet] 配置的模型生成失败，回落到当前会话模型");
    return deps.generateText(prompt, null, attachment);
  };

  let whisperInFlight = false;
  // 连续生成失败（provider 429/不可达）时指数退避，避免每 60s 再往模型队列塞一条
  // 需要等到超时才会放弃的请求。
  let whisperFailureStreak = 0;

  /** 生成一句碎碎念并推给对应宠物窗；失败静默重排。 */
  const generateWhisper = async (
    pet: DshPetConfig["pets"][number],
    meme?: string | null,
  ): Promise<void> => {
    if (whisperInFlight) return;
    whisperInFlight = true;
    let produced = false;
    try {
      const persona = pet.whisperPrompt || config.whisperPrompt;
      const name = pet.name || pet.id;
      const now = new Date();
      const prompt = [
        persona,
        `你的名字是「${name}」。当前时间：${now.toLocaleString("zh-CN")}。`,
        "请以这只桌宠的口吻生成一句碎碎念：不超过 20 个字，只输出这一句话本身。",
        // 上游 whisper 配图：先随机抽一张，把图名写进 prompt 让文案贴合画面情绪，
        // 而不是让模型描述画面。抽图由渲染层做（素材包在渲染层）。
        meme
          ? `这次会配一张表情包一起显示，图的名字是「${meme}」。请让这句话和这张图的情绪/场景自然契合，像是配合画面说出来的；不要描述画面本身。`
          : "",
      ].filter(Boolean).join("\n");
      const whisperSelection =
        config.whisperModel.provider && config.whisperModel.model
          ? { providerId: config.whisperModel.provider, modelId: config.whisperModel.model }
          : null;
      const text = await generatePetText(prompt, whisperSelection);
      deps.logger.info(`[dsh-pet] whisper generate -> ${text === null ? "null" : JSON.stringify(text.slice(0, 40))}`);
      const cleaned = (text ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").split("\n")[0]?.trim();
      if (!cleaned) return;
      produced = true;
      const entry = petWindows.get(pet.id);
      if (entry && !entry.win.isDestroyed()) {
        entry.win.webContents.send(PlatformChannels.DshPetStateEvent, {
          type: "whisper",
          text: cleaned,
          ...(meme ? { image: meme } : {}),
        });
      }
    } catch (error) {
      deps.logger.warn("[dsh-pet] whisper generation failed", error);
    } finally {
      whisperInFlight = false;
      whisperFailureStreak = produced ? 0 : Math.min(whisperFailureStreak + 1, 3);
    }
  };

  let whisperTimer: NodeJS.Timeout | null = null;
  const scheduleWhisper = (): void => {
    if (whisperTimer) clearTimeout(whisperTimer);
    // 连续失败时按 2/4/8 倍退避：模型不可用时不能每 60s 再抢一次队列。
    const seconds = Math.max(60, config.eventsRefreshSec.whisper) * 2 ** whisperFailureStreak;
    whisperTimer = setTimeout(() => {
      whisperTimer = null;
      // 总开关关闭时不生成碎碎念（窗口不存在，模型调用纯浪费）。
      const pet = config.enabled ? visiblePets().find((item) => item.whisperEnabled) : undefined;
      if (pet) void generateWhisper(pet);
      scheduleWhisper();
    }, seconds * 1000);
    whisperTimer.unref?.();
  };

  const initialize = async (): Promise<void> => {
    await loadConfig();
    // 旧版「退出桌宠」留下 enabled=true + 全部 display=none + trayEnabled=false 的组合：
    // 这个状态永远画不出宠物，也没有托盘入口把它唤回来，启动时视为需要恢复桌面显示。
    if (
      config.enabled &&
      !config.trayEnabled &&
      config.pets.length > 0 &&
      !config.pets.some((pet) => pet.display === "desktop" || pet.display === "both")
    ) {
      config = {
        ...config,
        pets: config.pets.map((pet) => ({ ...pet, display: "desktop" })),
      };
      scheduleSave();
    }
    registerIpc();
    // 默认关闭：首次启动 / 旧配置未显式开启时不创建任何宠物窗口。
    // 托盘、碎碎念定时器等仍照常初始化，用户开启后立即生效。
    if (config.enabled) {
      try {
        await reconcileWindows();
      } catch (error) {
        deps.logger.warn("[dsh-pet] failed to restore windows", error);
      }
    }
    syncTray();
    scheduleWhisper();
    // 宠物互撞的站场广播：常驻低频定时器（120ms），窗口只有一两只时开销可忽略。
    setInterval(broadcastPeers, 120).unref?.();
  };

  return {
    initialize,
    closeAllWindows,
    getWindow: () => firstWindow(),
    isEnabled: () => config.enabled && visiblePets().length > 0,
    /**
     * 会话聚合状态单向流入（装配方从 Codex 宠物聚合器接过来）。
     * 广播给全部桌宠窗（每只按自己的 workStatusEnabled 门控），并按需弹系统通知。
     */
    pushState: (payload: Record<string, unknown>): void => {
      maybeNotify(payload);
      for (const entry of petWindows.values()) {
        if (!entry.win.isDestroyed()) {
          entry.win.webContents.send(PlatformChannels.DshPetStateEvent, {
            type: "state",
            ...payload,
          });
        }
      }
    },
  };
}
