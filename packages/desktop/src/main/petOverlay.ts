/* eslint-disable max-lines -- 桌宠悬浮窗状态机集中：窗口生命周期 / 菜单 / 动作调度共享同一组闭包状态，拆分会把状态同步打散。 */
/**
 * 桌宠悬浮窗（复刻 Codex Pets）。
 *
 * 逆向来源：Codex Desktop app.asar 的 AvatarOverlayWindow（报告见 D:/temp/codex-pet/REPORT.md），
 * 关键参数照搬官方实现：
 * - 透明置顶无框窗（skipTaskbar、focusable:false、hasShadow:false）；
 * - 拖拽/抛掷物理全在 main：16ms 定时器积分、摩擦 0.88^(dt/16ms)、屏幕边缘回弹 ×0.7、
 *   速度 < 65px/s 或 > 900ms 停止；
 * - 点击穿透 setIgnoreMouseEvents(forward:true)，指针进入宠物热区时由渲染层反向解除；
 * - 尺寸 80–224px（宽），高按 192:208 等比。
 *
 * 简化（相对官方）：单窗口单宠物，无多表面合成/通知胶囊/dock 吸附；位置与配置持久化在
 * userData/pet-overlay.json 小文件（同 account-rotation store 的取舍：不含秘密、避免整包加密重写）。
 */
import { BrowserWindow, screen, ipcMain, nativeImage } from "electron";
import { join } from "node:path";
import { cp, mkdir, readFile, rename, rm, readdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { unzipSync } from "fflate/node";
import { app } from "electron";
import { PlatformChannels } from "@zcode/shared";

export interface PetOverlayConfig {
  enabled: boolean;
  petId: string;
  sizePx: number;
  x?: number;
  y?: number;
}

export const PET_OVERLAY_PET_IDS = [
  "codex",
  "bsod",
  "dewey",
  "fireball",
  "hoots",
  "null-signal",
  "rocky",
  "seedy",
  "stacky",
] as const;

// 默认关闭：首次启动不恢复宠物窗口，用户主动「唤出」后才开启。
const DEFAULT_CONFIG: PetOverlayConfig = { enabled: false, petId: "codex", sizePx: 112 };

/** 官方校验规则的 Python 实现（随 hatch-pet 技能释放）。 */

export const PET_OVERLAY_MIN_SIZE_PX = 80;
export const PET_OVERLAY_MAX_SIZE_PX = 224;
const PET_SPRITE_ASPECT = 208 / 192;

// 官方物理参数（见报告 §二）。
const PHYSICS_TICK_MS = 16;
const PHYSICS_FRICTION_PER_TICK = 0.88;
const PHYSICS_BOUNCE = 0.7;
const PHYSICS_MIN_SPEED_PX_S = 65;
const PHYSICS_MAX_DURATION_MS = 900;
// 窗口比精灵图大一圈。注意：透明窗不做逐像素命中，margin 区域会挡住下层点击，
// 所以只留 resize 手柄所需的最小边（forward:true 转发在本 Electron 上不可靠，
// 不能依赖穿透 toggle）。
const WINDOW_MARGIN_PX = 8;
// 底部额外留白：容纳通知胶囊（官方 pill 位于宠物下方，不遮本体）。
const WINDOW_PILL_SPACE_PX = 22;
// 通知托盘：官方布局是托盘与宠物**上下分栏**（mascot top 207 / tray bottom 190，留 17px），
// 窗口按托盘实际高度加高，绝不让托盘压住宠物。上限沿用官方 131px。
const PET_TRAY_MAX_HEIGHT_PX = 131;
const PET_TRAY_GAP_PX = 8;
/** 托盘刚出现、渲染层还没回报实测高度时的保守预留（表头 + 一行）。 */
const PET_TRAY_PROVISIONAL_HEIGHT_PX = 56;

interface PetOverlayDependencies {
  preloadPath: string;
  /**
   * 返回主应用窗口。必须排除桌宠窗自己：`BrowserWindow.getAllWindows()` 的顺序
   * 取决于创建顺序，桌宠窗先建时会被当成「第一个窗口」，主窗事件就全发给桌宠窗了。
   */
  getMainWindow: (overlayWindow: BrowserWindow | null) => BrowserWindow | null;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  /**
   * 会话聚合状态旁路：DSH 桌宠（第二套独立宠物系统）订阅同一份聚合结果，
   * 但走自己的窗口与通道。本控制器不感知对方是否存在。
   */
  onStateBroadcast?: (payload: Record<string, unknown>) => void;
}

export function createPetOverlayController(deps: PetOverlayDependencies) {
  const configPath = join(app.getPath("userData"), "pet-overlay.json");
  let config: PetOverlayConfig = { ...DEFAULT_CONFIG };
  let overlayWindow: BrowserWindow | null = null;
  let momentumTimer: NodeJS.Timeout | null = null;
  let saveTimer: NodeJS.Timeout | null = null;

  // ---------------- 配置持久化（500ms 合并写 + 原子替换） ----------------
  const loadConfig = async (): Promise<void> => {
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<PetOverlayConfig>;
      config = {
        enabled: parsed.enabled === true,
        petId: PET_OVERLAY_PET_IDS.includes(parsed.petId as never)
          ? (parsed.petId as string)
          : DEFAULT_CONFIG.petId,
        sizePx: clampSize(parsed.sizePx ?? DEFAULT_CONFIG.sizePx),
        ...(typeof parsed.x === "number" && typeof parsed.y === "number"
          ? { x: parsed.x, y: parsed.y }
          : {}),
      };
    } catch {
      config = { ...DEFAULT_CONFIG };
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
          deps.logger.warn("[pet-overlay] config save failed", error);
        }
      })();
    }, 500);
    saveTimer.unref?.();
  };

  const clampSize = (size: number): number =>
    Math.min(PET_OVERLAY_MAX_SIZE_PX, Math.max(PET_OVERLAY_MIN_SIZE_PX, Math.round(size)));

  const windowSizeFor = (sizePx: number): { width: number; height: number } => ({
    width: sizePx + WINDOW_MARGIN_PX * 2,
    height: Math.round(sizePx * PET_SPRITE_ASPECT) + WINDOW_MARGIN_PX * 2 + WINDOW_PILL_SPACE_PX,
  });

  /** 通知托盘实测高度（0 = 未展示）。渲染层每次重绘后回报，主进程按它加高窗口。 */
  let trayHeightPx = 0;

  const overlayHeightFor = (sizePx: number, trayHeight: number): number =>
    windowSizeFor(sizePx).height +
    (trayHeight > 0 ? Math.min(trayHeight, PET_TRAY_MAX_HEIGHT_PX) + PET_TRAY_GAP_PX : 0);

  /**
   * 把窗口调整到「托盘 + 间距 + 宠物」的高度。增长时以**底边为锚**（y 同步上移），
   * 保证宠物在屏幕上的位置不变——官方布局也是宠物固定、托盘在它上方展开。
   */
  const syncOverlayBounds = (): void => {
    const win = overlayWindow;
    if (!win || win.isDestroyed()) return;
    const base = windowSizeFor(config.sizePx);
    const height = overlayHeightFor(config.sizePx, trayHeightPx);
    const bounds = win.getBounds();
    if (bounds.height === height && bounds.width === base.width) return;
    const delta = height - bounds.height;
    let y = bounds.y;
    if (delta !== 0) {
      const display = screen.getDisplayMatching({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height,
      });
      y = Math.max(display.workArea.y, bounds.y - delta);
    }
    win.setBounds({ x: bounds.x, y, width: base.width, height });
  };

  const broadcastConfig = (): void => {
    for (const win of [overlayWindow, deps.getMainWindow(overlayWindow)]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(PlatformChannels.PetOverlayConfigEvent, config);
      }
    }
  };

  // ---------------- 窗口生命周期 ----------------
  const resolvePageUrl = (): string => {
    if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
      return `${process.env["ELECTRON_RENDERER_URL"]}/pet-overlay.html`;
    }
    return `file://${join(import.meta.dirname, "../renderer/pet-overlay.html")}`;
  };

  const ensureWindow = async (): Promise<BrowserWindow> => {
    if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
    const { width, height } = windowSizeFor(config.sizePx);
    const win = new BrowserWindow({
      width,
      height,
      ...(config.x != null && config.y != null ? { x: config.x, y: config.y } : {}),
      acceptFirstMouse: true,
      backgroundColor: "#00000000",
      focusable: false,
      frame: false,
      hasShadow: false,
      resizable: false,
      show: false,
      skipTaskbar: true,
      title: "XCode Pet",
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
    overlayWindow = win;
    win.on("closed", () => {
      overlayWindow = null;
      cancelMomentum();
    });
    await win.loadURL(resolvePageUrl());
    win.showInactive();
    return win;
  };

  const closeWindow = (): void => {
    cancelMomentum();
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
    overlayWindow = null;
  };

  // ---------------- 惯性物理（官方参数） ----------------
  let velocity: { x: number; y: number } | null = null;
  let momentumStartedAt = 0;

  const cancelMomentum = (): void => {
    if (momentumTimer) {
      clearTimeout(momentumTimer);
      momentumTimer = null;
    }
    velocity = null;
  };

  const applyMomentum = (): void => {
    const win = overlayWindow;
    if (!win || win.isDestroyed() || !velocity) {
      cancelMomentum();
      return;
    }
    momentumTimer = null;
    const now = Date.now();
    const dt = PHYSICS_TICK_MS / 1000;
    const { x: wx, y: wy, width: ww, height: wh } = win.getBounds();
    let { x: vx, y: vy } = velocity;
    let nextX = wx + vx * dt;
    let nextY = wy + vy * dt;

    // 屏幕边缘回弹：以指针所在显示器为边界，防止抛出可视区后失联。
    const display = screen.getDisplayNearestPoint({
      x: Math.round(nextX + ww / 2),
      y: Math.round(nextY + wh / 2),
    });
    const bounds = display.workArea;
    let bounced = false;
    if (nextX < bounds.x) {
      nextX = bounds.x;
      vx = -vx * PHYSICS_BOUNCE;
      bounced = true;
    } else if (nextX + ww > bounds.x + bounds.width) {
      nextX = bounds.x + bounds.width - ww;
      vx = -vx * PHYSICS_BOUNCE;
      bounced = true;
    }
    if (nextY < bounds.y) {
      nextY = bounds.y;
      vy = -vy * PHYSICS_BOUNCE;
      bounced = true;
    } else if (nextY + wh > bounds.y + bounds.height) {
      nextY = bounds.y + bounds.height - wh;
      vy = -vy * PHYSICS_BOUNCE;
      bounced = true;
    }
    win.setBounds({ x: Math.round(nextX), y: Math.round(nextY), width: ww, height: wh });

    // 摩擦：每帧 0.88（16ms 基准）。
    vx *= PHYSICS_FRICTION_PER_TICK;
    vy *= PHYSICS_FRICTION_PER_TICK;
    velocity = { x: vx, y: vy };

    const elapsed = now - momentumStartedAt;
    if (
      elapsed >= PHYSICS_MAX_DURATION_MS ||
      Math.hypot(vx, vy) < PHYSICS_MIN_SPEED_PX_S * (PHYSICS_TICK_MS / 1000)
    ) {
      cancelMomentum();
      persistBounds(win);
      return;
    }
    momentumTimer = setTimeout(applyMomentum, PHYSICS_TICK_MS);
    momentumTimer.unref?.();
  };

  const throwWithVelocity = (vx: number, vy: number): void => {
    const win = overlayWindow;
    if (!win || win.isDestroyed()) return;
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || (vx === 0 && vy === 0)) return;
    cancelMomentum();
    velocity = { x: vx, y: vy };
    momentumStartedAt = Date.now();
    momentumTimer = setTimeout(applyMomentum, PHYSICS_TICK_MS);
    momentumTimer.unref?.();
  };

  const persistBounds = (win: BrowserWindow): void => {
    if (win.isDestroyed()) return;
    const { x, y } = win.getBounds();
    config = { ...config, x, y };
    scheduleSave();
  };

  const clampToVisibleArea = (win: BrowserWindow): void => {
    const { x, y, width, height } = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: x + width / 2, y: y + height / 2 });
    const area = display.workArea;
    const clampedX = Math.min(Math.max(x, area.x), area.x + area.width - width);
    const clampedY = Math.min(Math.max(y, area.y), area.y + area.height - height);
    if (clampedX !== x || clampedY !== y) {
      win.setBounds({ x: clampedX, y: clampedY, width, height });
    }
    persistBounds(win);
  };

  // ---------------- 自定义宠物（官方 pet.json + spritesheet 格式） ----------------
  const petsRoot = (): string => join(app.getPath("userData"), "pets");

  const BS_CHAR = process.platform === "win32" ? "\\" : "/";
  const sanitizeSlug = (name: string): string =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "pet";

  /** buffer 版校验（ZIP 导入路径不落盘直接验）。 */
  const validateSpritesheetBuffer = (
    bytes: Uint8Array,
  ): { ok: true; rows: number } | { ok: false; error: string } => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) return { ok: false, error: "image-not-decodable" };
    const { width, height } = image.getSize();
    if (width === 0 || width % 8 !== 0) return { ok: false, error: "width-not-divisible-by-8" };
    if (height % 11 === 0 && Math.abs((width / 8) * (208 / 192) - height / 11) < 2) {
      return { ok: true, rows: 11 };
    }
    if (height % 9 === 0 && Math.abs((width / 8) * (208 / 192) - height / 9) < 2) {
      return { ok: true, rows: 9 };
    }
    return { ok: false, error: "height-not-matching-grid" };
  };

  /** 校验精灵图：可解码、宽 = 8 格、高 = 9/11 行（v1/v2），返回行列信息。 */
  const validateSpritesheet = (
    imagePath: string,
  ): { ok: true; width: number; height: number; rows: number } | { ok: false; error: string } => {
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) return { ok: false, error: "image-not-decodable" };
    const { width, height } = image.getSize();
    if (width === 0 || height === 0) return { ok: false, error: "image-not-decodable" };
    if (width % 8 !== 0) return { ok: false, error: "width-not-divisible-by-8" };
    if (height % 11 === 0 && Math.abs((width / 8) * (208 / 192) - height / 11) < 2) {
      return { ok: true, width, height, rows: 11 };
    }
    if (height % 9 === 0 && Math.abs((width / 8) * (208 / 192) - height / 9) < 2) {
      return { ok: true, width, height, rows: 9 };
    }
    return { ok: false, error: "height-not-matching-grid" };
  };

  const listCustomPets = async (): Promise<
    Array<{
      id: string;
      displayName: string;
      description: string;
      spriteVersionNumber: number;
      columns: number;
      rows: number;
      cellWidth: number;
      cellHeight: number;
    }>
  > => {
    try {
      const entries = await readdir(petsRoot(), { withFileTypes: true });
      const out: Array<{
        id: string;
        displayName: string;
        description: string;
        spriteVersionNumber: number;
        columns: number;
        rows: number;
        cellWidth: number;
        cellHeight: number;
      }> = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const manifest = JSON.parse(
            await readFile(join(petsRoot(), entry.name, "pet.json"), "utf8"),
          ) as {
            id?: unknown;
            displayName?: unknown;
            description?: unknown;
            spriteVersionNumber?: unknown;
            spritesheetPath?: unknown;
          };
          if (typeof manifest.id !== "string" || typeof manifest.displayName !== "string") continue;
          if (typeof manifest.spritesheetPath !== "string") continue;
          const rows = manifest.spriteVersionNumber === 2 ? 11 : 9;
          const cellWidth = Math.round(
            (await imageWidth(join(petsRoot(), entry.name, manifest.spritesheetPath))) / 8,
          );
          out.push({
            id: `custom:${entry.name}`,
            displayName: manifest.displayName,
            description: typeof manifest.description === "string" ? manifest.description : "",
            spriteVersionNumber: rows,
            columns: 8,
            rows,
            cellWidth,
            cellHeight: Math.round((cellWidth * 208) / 192),
          });
        } catch {
          // 单个坏目录跳过，不拖垮整个列表。
        }
      }
      return out;
    } catch {
      return [];
    }
  };

  const imageWidth = async (imagePath: string): Promise<number> => {
    const image = nativeImage.createFromPath(imagePath);
    return image.getSize().width;
  };

  const installCustomPet = async (input: {
    name: string;
    description?: string;
    sourceImagePath: string;
  }): Promise<{ id: string } | { error: string }> => {
    const name = input.name.trim();
    if (!name) return { error: "name-required" };
    const validation = validateSpritesheet(input.sourceImagePath);
    if (!validation.ok) return { error: validation.error };
    const slug = sanitizeSlug(name);
    const dir = join(petsRoot(), slug);
    const ext = input.sourceImagePath.toLowerCase().endsWith(".png") ? "png" : "webp";
    await mkdir(dir, { recursive: true });
    await copyFile(input.sourceImagePath, join(dir, `spritesheet.${ext}`));
    await writeFile(
      join(dir, "pet.json"),
      JSON.stringify(
        {
          id: slug,
          displayName: name,
          description: input.description?.trim() || "",
          spriteVersionNumber: validation.rows === 11 ? 2 : 1,
          spritesheetPath: `spritesheet.${ext}`,
        },
        null,
        2,
      ),
      "utf8",
    );
    return { id: `custom:${slug}` };
  };

  const deleteCustomPet = async (petId: string): Promise<void> => {
    if (!petId.startsWith("custom:")) return;
    const slug = petId.slice("custom:".length);
    if (!/^[a-z0-9-_]+$/.test(slug)) return;
    await rm(join(petsRoot(), slug), { recursive: true, force: true });
    if (config.petId === petId) {
      config = { ...config, petId: "codex" };
      scheduleSave();
      broadcastConfig();
    }
  };

  /** hatch-pet 官方技能资产根（打包后 resources/pet-skills，dev 直读仓库）。 */
  const hatchPetSkillSource = (): string =>
    app.isPackaged
      ? join(process.resourcesPath, "pet-skills", "hatch-pet")
      : // dev 主进程产物在 packages/desktop/out/main，仓库资源在 packages/desktop/resources。
        // 这里少一级 `..` 会指向 packages/resources，安装时静默 ENOENT，技能永远停在旧版本。
        join(import.meta.dirname, "../../resources/pet-skills/hatch-pet");

  /**
   * 官方 SKILL.md 面向 Codex（CODEX_HOME、~/.codex/pets）。安装时只做路径变换：
   * 仓库内资产已是 XCode 版（无内置生图技能，生成前先问用户 API 或 SVG），
   * 不再在安装时重写任何生成章节，避免两边文案漂移。
   */
  const adaptSkillMarkdown = (markdown: string): string => {
    const petsDir = petsRoot();
    const skillDir = join(app.getPath("home"), ".xcode", "skills", "hatch-pet");
    const replacements: Array<[string, string]> = [
      ["${CODEX_HOME:-$HOME/.codex}/skills/hatch-pet", skillDir],
      ["${CODEX_HOME:-$HOME/.codex}/generated_images", join(petsDir, "generated_images")],
      ["${CODEX_HOME:-$HOME/.codex}", petsDir],
      ["$HOME/.codex", petsDir],
      ["~/.codex/pets", petsDir],
      ["~/.codex", petsDir],
    ];
    let adapted = markdown;
    for (const [needle, replacement] of replacements) {
      while (adapted.includes(needle)) {
        adapted = adapted.split(needle).join(replacement);
      }
    }
    const noteLines = [
      "<!-- XCODE ADAPTATION NOTE: ported from openai/skills .curated/hatch-pet (Apache-2.0).",
      "     Original Codex paths were replaced with the XCode pets folder (see installHatchPetSkill); the",
      "     floating pet window scans that folder for pet.json + spritesheet automatically. -->",
    ];
    const newline = String.fromCharCode(10);
    return noteLines.join(newline) + newline + newline + adapted;
  };

  /** 把官方 hatch-pet 技能整目录安装到用户技能区（幂等覆盖，markdown 做 XCode 适配）。 */
  const installHatchPetSkill = async (): Promise<string> => {
    const source = hatchPetSkillSource();
    const target = join(app.getPath("home"), ".xcode", "skills", "hatch-pet");
    await cp(source, target, {
      recursive: true,
      force: true,
      filter: (sourcePath) => !sourcePath.endsWith("agents/openai.yaml"),
    });
    // 对 markdown 做 XCode 适配（scripts/*.py 为确定性图像处理，不需要改）。
    const mdFiles = [
      "SKILL.md",
      "references/animation-rows.md",
      "references/codex-pet-contract.md",
      "references/qa-rubric.md",
    ];
    for (const file of mdFiles) {
      const mdPath = join(target, file);
      try {
        const markdown = await readFile(mdPath, "utf8");
        await writeFile(mdPath, adaptSkillMarkdown(markdown), "utf8");
      } catch {
        // 单个文件缺失不阻断安装。
      }
    }
    return join(target, "SKILL.md");
  };

  /** pet-maker 技能资产根（打包后 resources/pet-skills，dev 直读仓库）。 */
  const petMakerSkillSource = (): string =>
    app.isPackaged
      ? join(process.resourcesPath, "pet-skills", "pet-maker")
      : join(import.meta.dirname, "../../resources/pet-skills/pet-maker");

  /**
   * 安装 pet-maker（幂等覆盖）。SKILL.md 的 dsh-pet 安装路径改写为 XCode 数据根：
   * 生成的桌宠包（dist/xcode/pet.json + webm/）落到 userData/dsh-pet/packs/<id>/，
   * 悬浮窗的自定义宠物包加载器从这里读取（随后接入）。
   */
  const installPetMakerSkill = async (): Promise<string> => {
    const source = petMakerSkillSource();
    const target = join(app.getPath("home"), ".xcode", "skills", "pet-maker");
    await cp(source, target, { recursive: true, force: true });
    const packsDir = join(app.getPath("userData"), "dsh-pet", "packs");
    const replacements: Array<[string, string]> = [
      ["~/.dsh/dsh-pet", join(app.getPath("userData"), "dsh-pet")],
      ["<DSH_HOME>/dsh-pet/pet/", join(packsDir, "/")],
      ["`--install-root ~/.dsh/dsh-pet`", `\`--install-root ${join(app.getPath("userData"), "dsh-pet")}\``],
    ];
    const mdPath = join(target, "SKILL.md");
    try {
      const markdown = await readFile(mdPath, "utf8");
      let adapted = markdown;
      for (const [needle, replacement] of replacements) {
        while (adapted.includes(needle)) {
          adapted = adapted.split(needle).join(replacement);
        }
      }
      const noteLines = [
        "<!-- XCODE ADAPTATION NOTE: ported from PC2005-cloud/dsh-pet (MIT code; assets non-commercial).",
        "     Install paths were replaced with the XCode data root (userData/dsh-pet). DSH pet packs",
        "     (--install-root <userData/dsh-pet>, i.e. pet/<id>-config.json + pet/<id>-animation/webm/) can be",
        "     selected per pet in XCode settings; the DSH floating window loads them from userData/dsh-pet/packs/<id>/. -->",
      ];
      const newline = String.fromCharCode(10);
      adapted = noteLines.join(newline) + newline + newline + adapted;
      await writeFile(mdPath, adapted, "utf8");
    } catch {
      // 单个文件缺失不阻断安装。
    }
    return mdPath;
  };

  /**
   * ZIP 导入第一段：解包并返回清单与精灵 base64（不落盘）。
   * WebP 解码交给渲染层 Image（nativeImage 仅支持 PNG/JPEG），PNG 化后由
   * commitCustomPetImport 落盘——与内置九张全 PNG 的解码基线一致。
   */
  const prepareCustomPetZipImport = async (
    zipPath: string,
  ): Promise<
    | {
        manifest: {
          displayName: string;
          description: string;
          suggestedId: string;
          declaredRows: number;
        };
        spriteBase64: string;
        spriteMime: string;
      }
    | { error: string }
  > => {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await readFile(zipPath)));
    } catch (error) {
      return {
        error: "zip-unreadable: " + (error instanceof Error ? error.message : String(error)),
      };
    }
    const normalized = Object.entries(entries).map(([name, data]) => ({
      name: name.split(process.platform === "win32" ? "\\" : "/").join("/"),
      data,
    }));
    const manifests = normalized.filter(
      (entry) => entry.name === "pet.json" || entry.name.endsWith("/pet.json"),
    );
    if (manifests.length !== 1) return { error: "zip-must-contain-one-pet-json" };
    const manifestEntry = manifests[0] as { name: string; data: Uint8Array };
    let manifest: {
      id?: unknown;
      displayName?: unknown;
      description?: unknown;
      spritesheetPath?: unknown;
    };
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
    } catch {
      return { error: "pet-json-unparsable" };
    }
    if (typeof manifest.displayName !== "string" || manifest.displayName.trim() === "") {
      return { error: "pet-name-required" };
    }
    if (typeof manifest.spritesheetPath !== "string" || manifest.spritesheetPath.includes("..")) {
      return { error: "spritesheet-path-invalid" };
    }
    const prefix = manifestEntry.name.slice(0, -"pet.json".length);
    const sheetName = `${prefix}${manifest.spritesheetPath}`;
    const sheet = normalized.find((entry) => entry.name === sheetName);
    if (!sheet) return { error: "spritesheet-missing" };
    const ext = sheetName.toLowerCase().endsWith(".png") ? "image/png" : "image/webp";
    return {
      manifest: {
        displayName: manifest.displayName,
        description: typeof manifest.description === "string" ? manifest.description : "",
        suggestedId:
          typeof manifest.id === "string" && manifest.id.trim() !== ""
            ? manifest.id.trim()
            : manifest.displayName,
        declaredRows: 11,
      },
      spriteBase64: Buffer.from(sheet.data).toString("base64"),
      spriteMime: ext,
    };
  };

  /** ZIP 导入第二段：接收渲染层 PNG 化的精灵，落盘 pet.json + spritesheet.png。 */
  const commitCustomPetImport = async (input: {
    displayName: string;
    description: string;
    suggestedId: string;
    rows: number;
    pngBase64: string;
  }): Promise<{ id: string } | { error: string }> => {
    const displayName = input.displayName.trim();
    if (displayName === "") return { error: "pet-name-required" };
    if (input.rows !== 9 && input.rows !== 11) return { error: "height-not-matching-grid" };
    const slug =
      sanitizeSlug(typeof input.suggestedId === "string" ? input.suggestedId : displayName) ||
      sanitizeSlug(displayName);
    const dir = join(petsRoot(), slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "spritesheet.png"), Buffer.from(input.pngBase64, "base64"));
    await writeFile(
      join(dir, "pet.json"),
      JSON.stringify(
        {
          id: slug,
          displayName,
          description: input.description,
          spriteVersionNumber: input.rows === 11 ? 2 : 1,
          spritesheetPath: "spritesheet.png",
        },
        null,
        2,
      ),
      "utf8",
    );
    return { id: `custom:${slug}` };
  };

  const getCustomSpriteDataUrl = async (petId: string): Promise<string | null> => {
    if (!petId.startsWith("custom:")) return null;
    const slug = petId.slice("custom:".length);
    if (!/^[a-z0-9-_]+$/.test(slug)) return null;
    try {
      const files = await readdir(join(petsRoot(), slug));
      const sheet = files.find((file) => /^spritesheet\.(png|webp)$/i.test(file));
      if (!sheet) return null;
      const bytes = await readFile(join(petsRoot(), slug, sheet));
      const mime = sheet.toLowerCase().endsWith(".png") ? "image/png" : "image/webp";
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  };

  // ---------------- hatch-pet 技能（对齐官方 bundled skill 语义） ----------------
  /** 官方校验规则（逆向 tui/src/pets/model.rs + asset_pack.rs 的错误串 + PET_FORMATS 规范）。 */
  // ---------------- IPC ----------------
  const registerIpc = (): void => {
    ipcMain.handle(PlatformChannels.PetOverlayGetConfig, () => config);
    ipcMain.handle(
      PlatformChannels.PetOverlaySetConfig,
      (event, patch: Partial<PetOverlayConfig>) => {
        const prevSize = config.sizePx;
        config = {
          ...config,
          ...(typeof patch.petId === "string" &&
          (PET_OVERLAY_PET_IDS.includes(patch.petId as never) ||
            // 自定义宠物：custom:<slug>，要求对应目录已安装。
            (patch.petId.startsWith("custom:") &&
              /^[a-z0-9-_]+$/.test(patch.petId.slice("custom:".length)) &&
              existsSync(join(petsRoot(), patch.petId.slice("custom:".length)))))
            ? { petId: patch.petId }
            : {}),
          ...(typeof patch.sizePx === "number" ? { sizePx: clampSize(patch.sizePx) } : {}),
          ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
        };
        scheduleSave();
        broadcastConfig();
        if (config.enabled) {
          void ensureWindow().then((win) => {
            // 尺寸或宠物变了要重设窗口大小（渲染层按 config 事件重载精灵图）。
            if (config.sizePx !== prevSize) {
              const size = windowSizeFor(config.sizePx);
              win.setBounds({
                ...win.getBounds(),
                width: size.width,
                height: overlayHeightFor(config.sizePx, trayHeightPx),
              });
            }
          });
        }
        // 广播对主窗不可靠（实测主窗收不到），发起方直接回读返回值兜底。
        BrowserWindow.fromWebContents(event.sender)?.webContents.send(
          PlatformChannels.PetOverlayConfigEvent,
          config,
        );
        return config;
      },
    );
    ipcMain.handle(PlatformChannels.PetOverlayToggle, (event) => {
      config = { ...config, enabled: !config.enabled };
      scheduleSave();
      broadcastConfig();
      if (config.enabled) void ensureWindow();
      else closeWindow();
      BrowserWindow.fromWebContents(event.sender)?.webContents.send(
        PlatformChannels.PetOverlayConfigEvent,
        config,
      );
      return config;
    });
    ipcMain.on(
      PlatformChannels.PetOverlayDrag,
      (_event, payload: { phase: "start" | "move" | "end"; dx?: number; dy?: number }) => {
        const win = overlayWindow;
        if (!win || win.isDestroyed()) return;
        cancelMomentum();
        if (payload.phase === "start") return;
        if (payload.phase === "end") {
          clampToVisibleArea(win);
          return;
        }
        // move：渲染层上报指针增量，主进程平移并做工作区钳制（防止拖出可视区）。
        if (typeof payload.dx !== "number" || typeof payload.dy !== "number") return;
        const { x, y, width, height } = win.getBounds();
        const area = screen.getDisplayNearestPoint({
          x: x + width / 2,
          y: y + height / 2,
        }).workArea;
        win.setBounds({
          x: Math.round(Math.min(Math.max(x + payload.dx, area.x), area.x + area.width - width)),
          y: Math.round(Math.min(Math.max(y + payload.dy, area.y), area.y + area.height - height)),
          width,
          height,
        });
      },
    );
    ipcMain.on(
      PlatformChannels.PetOverlayThrow,
      (_event, payload: { velocityX: number; velocityY: number }) => {
        throwWithVelocity(payload.velocityX, payload.velocityY);
      },
    );
    // 桌宠缩放（对齐官方 resizeMascotToCurrentCursor）：左上角锚定，宽度主算式
    // 在主进程用真实光标 X 增量独立计算（渲染层宽度仅作覆盖值），边界取光标
    // 所在显示器工作区。
    let mascotResizeState: {
      startAnchor: { x: number; y: number };
      startCursorX: number;
      startSizePx: number;
    } | null = null;
    ipcMain.on(
      PlatformChannels.PetOverlayResize,
      (_event, payload: { phase: "start" | "move" | "end"; width?: number }) => {
        const win = overlayWindow;
        if (!win || win.isDestroyed()) return;
        cancelMomentum();
        if (payload.phase === "start") {
          const { x, y } = win.getBounds();
          mascotResizeState = {
            startAnchor: { x, y },
            startCursorX: screen.getCursorScreenPoint().x,
            startSizePx: config.sizePx,
          };
          return;
        }
        const state = mascotResizeState;
        if (!state) return;
        const cursorX = screen.getCursorScreenPoint().x;
        const sizePx = clampSize(
          payload.width ?? state.startSizePx + (cursorX - state.startCursorX),
        );
        config = { ...config, sizePx };
        const size = windowSizeFor(sizePx);
        // 官方锚定：anchor = { ...startAnchor, ...size } —— x/y 固定，向右下生长。
        win.setBounds({
          x: state.startAnchor.x,
          y: state.startAnchor.y,
          width: size.width,
          height: overlayHeightFor(sizePx, trayHeightPx),
        });
        if (payload.phase === "end") {
          mascotResizeState = null;
          clampToVisibleArea(win);
          broadcastConfig();
        }
      },
    );
    // 托盘实测高度：渲染层每次重绘后回报，主进程按需加高/回缩窗口。
    ipcMain.on(PlatformChannels.PetOverlayTrayHeight, (_event, payload: { height?: number }) => {
      const next = Math.max(0, Math.min(PET_TRAY_MAX_HEIGHT_PX, Math.round(payload.height ?? 0)));
      if (next === trayHeightPx) return;
      trayHeightPx = next;
      syncOverlayBounds();
    });
    ipcMain.on(
      PlatformChannels.PetOverlaySetIgnoreMouseEvents,
      (_event, payload: { ignore: boolean }) => {
        const win = overlayWindow;
        if (!win || win.isDestroyed()) return;
        win.setIgnoreMouseEvents(payload.ignore, { forward: true });
      },
    );
    ipcMain.on(PlatformChannels.PetOverlayFocusMain, () => {
      const main = deps.getMainWindow(overlayWindow);
      if (main && !main.isDestroyed()) {
        if (main.isMinimized()) main.restore();
        main.focus();
      }
    });
    ipcMain.handle(PlatformChannels.PetOverlayListCustomPets, () => listCustomPets());
    ipcMain.handle(
      PlatformChannels.PetOverlayInstallCustomPet,
      (
        _event,
        input: {
          name: string;
          description?: string;
          sourceImagePath: string;
        },
      ) => installCustomPet(input),
    );
    ipcMain.handle(PlatformChannels.PetOverlayDeleteCustomPet, (_event, petId: string) =>
      deleteCustomPet(petId),
    );
    ipcMain.handle(PlatformChannels.PetOverlayGetCustomSpriteDataUrl, (_event, petId: string) =>
      getCustomSpriteDataUrl(petId),
    );
    ipcMain.handle(
      PlatformChannels.PetOverlayPrepareCustomPetZipImport,
      (_event, zipPath: string) => prepareCustomPetZipImport(zipPath),
    );
    ipcMain.handle(
      PlatformChannels.PetOverlayCommitCustomPetImport,
      (
        _event,
        input: {
          displayName: string;
          description: string;
          suggestedId: string;
          rows: number;
          pngBase64: string;
        },
      ) => commitCustomPetImport(input),
    );
    ipcMain.handle(PlatformChannels.PetOverlayInstallHatchPetSkill, () => installHatchPetSkill());
    ipcMain.handle(PlatformChannels.PetOverlayInstallPetMakerSkill, () => installPetMakerSkill());
    // 宠物窗 pill 内按钮 → 转发主窗（主窗执行 resolveInteraction）。
    ipcMain.on(
      PlatformChannels.PetOverlayResolveAction,
      (_event, payload: { interactionId: string; optionId: string }) => {
        const main = deps.getMainWindow(overlayWindow);
        if (main && !main.isDestroyed()) {
          main.webContents.send(PlatformChannels.PetOverlayActionRequest, payload);
        }
      },
    );
    // 宠物窗点击通知托盘行 → 聚焦主窗并请求切到该会话（官方行为）。
    ipcMain.on(PlatformChannels.PetOverlayOpenSession, (_event, payload: { sessionId: string }) => {
      const main = deps.getMainWindow(overlayWindow);
      if (!main || main.isDestroyed()) return;
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
      main.webContents.send(PlatformChannels.PetOverlayOpenSessionRequest, payload);
    });
    ipcMain.on(
      PlatformChannels.PetOverlaySetState,
      (
        _event,
        payload: {
          state: string;
          badge?: number;
          source?: string;
          title?: string;
          waitingKind?: string;
          actions?: { interactionId: string; options: Array<{ optionId: string; label: string }> };
          clear?: boolean;
        },
      ) => {
        deps.logger.info("[pet-overlay][diag] SetState received", {
          state: payload.state,
          badge: payload.badge,
          source: payload.source,
        });
        // 主窗转发的会话状态：并入聚合。source 是稳定来源 key（全局任务面 vs
        // 各 pane），缺省沿用旧 state-key 行为；PetControl 直推不走聚合。
        if (payload.clear === true) {
          if (payload.source === "*") {
            // 主窗重载：渲染层内存里的来源表已丢失，主进程必须一起清空，
            // 否则旧会话行会永久留在托盘里。
            petSessionStates.clear();
          } else if (payload.source) {
            // 会话切走/关闭：只移除该来源的聚合贡献，其它会话保持。
            petSessionStates.delete(payload.source);
          }
          const { state: top, badge, title: topTitle, notifications } = aggregatePetState();
          pushPetState(top, badge, {
            ...(topTitle ? { title: topTitle } : {}),
            notifications,
          });
          return;
        }
        if (payload.badge !== undefined) {
          applyPetSessionState(
            payload.source ?? `renderer:${payload.state}`,
            payload.state,
            payload.badge,
            payload.title,
            payload.waitingKind,
            payload.actions,
          );
          return;
        }
        pushPetState(payload.state, lastBadge, lastTitle ? { title: lastTitle } : {});
      },
    );
  };

  const initialize = async (): Promise<void> => {
    await loadConfig();
    registerIpc();
    // hatch-pet 技能默认安装（幂等覆盖）：设置页「创建」直接预填 $hatch-pet 调用。
    void installPetMakerSkill().catch((error: unknown) => {
      deps.logger.warn("[pet-overlay] pet-maker skill install failed", error);
    });
    void installHatchPetSkill().catch((error: unknown) => {
      deps.logger.warn("[pet-overlay] hatch-pet skill install failed", error);
    });
    if (config.enabled) {
      try {
        await ensureWindow();
      } catch (error) {
        deps.logger.warn("[pet-overlay] failed to restore window", error);
      }
    }
  };

  // 会话→任务状态聚合（官方语义：宠物反映所有会话的 attention）。
  // 优先级：failed > waiting > running > review > idle；badge = waiting+failed 计数和。
  const PET_STATE_PRIORITY: Record<string, number> = {
    failed: 4,
    waiting: 3,
    running: 2,
    review: 1,
    idle: 0,
  };
  // 官方托盘排序（use-avatar-overlay-selection 的 notificationPriority）：
  // 等待 > 失败 > 就绪 > 运行。与宠物行为优先级不同，单独一张表。
  const PET_NOTIFICATION_PRIORITY: Record<string, number> = {
    waiting: 0,
    failed: 1,
    review: 2,
    running: 3,
  };
  const petSessionStates = new Map<
    string,
    {
      state: string;
      attentionCount: number;
      title?: string;
      waitingKind?: string;
      actions?: { interactionId: string; options: Array<{ optionId: string; label: string }> };
    }
  >();
  let lastBehaviorState = "idle";
  let lastBadge = 0;
  let lastTitle: string | undefined;

  const aggregatePetState = (): {
    state: string;
    badge: number;
    title?: string;
    notifications: Array<{ sessionId: string; state: string; title: string; waitingKind?: string }>;
  } => {
    // 同一个会话可能有两个来源：SessionPane 的 pane:<id>（实时、带审批动作）与
    // sessions-index 的 task:<id>（后台/所有会话）。官方每个会话只占一行通知，
    // 这里先按会话归并，再让高优先级状态胜出、动作从任一方补齐。
    const sessionKeyOf = (source: string): string =>
      source.startsWith("pane:") || source.startsWith("task:")
        ? source.slice(source.indexOf(":") + 1)
        : source;
    const bySession = new Map<
      string,
      {
        sessionId: string;
        state: string;
        attentionCount: number;
        title?: string;
        waitingKind?: string;
        actions?: { interactionId: string; options: Array<{ optionId: string; label: string }> };
      }
    >();
    for (const [source, value] of petSessionStates) {
      const sessionId = sessionKeyOf(source);
      const incoming = { sessionId, ...value };
      const existing = bySession.get(sessionId);
      if (!existing) {
        bySession.set(sessionId, incoming);
        continue;
      }
      const incomingWins =
        (PET_STATE_PRIORITY[incoming.state] ?? 0) > (PET_STATE_PRIORITY[existing.state] ?? 0);
      const winner = incomingWins ? incoming : existing;
      const loser = incomingWins ? existing : incoming;
      bySession.set(sessionId, {
        ...winner,
        title: winner.title ?? loser.title,
        waitingKind: winner.waitingKind ?? loser.waitingKind,
        // waiting 动作只由 pane 上报；即便全局来源状态更高也要保留，否则 pill 没有按钮。
        actions: winner.actions ?? loser.actions,
      });
    }
    const entries = [...bySession.values()];
    const top = entries.reduce<{
      state: string;
      attentionCount: number;
      title?: string;
    }>(
      (best, entry) =>
        (PET_STATE_PRIORITY[entry.state] ?? 0) > (PET_STATE_PRIORITY[best.state] ?? 0)
          ? entry
          : best,
      { state: "idle", attentionCount: 0 },
    );
    const badge = entries.reduce(
      (sum, entry) =>
        entry.state === "failed" || entry.state === "waiting" ? sum + entry.attentionCount : sum,
      0,
    );
    // 官方通知托盘：所有非 idle 会话各占一行（等待 > 失败 > 就绪 > 运行）。
    // 焦点会话（pane 已挂载）的 running/review 不进托盘——用户正看着它，
    // 官方对打开中的会话排除这类瞬时/已读通知（waiting/failed 仍保留）。
    // 宠物行为状态不受影响：top 仍由全部条目（含焦点会话）竞争得出。
    const paneCoveredSessions = new Set(
      [...petSessionStates.keys()]
        .filter((source) => source.startsWith("pane:"))
        .map((source) => source.slice("pane:".length)),
    );
    const notifications = entries
      .filter(
        (entry) =>
          entry.state !== "idle" &&
          entry.title &&
          !(
            paneCoveredSessions.has(entry.sessionId) &&
            (entry.state === "running" || entry.state === "review")
          ),
      )
      .sort(
        (a, b) =>
          (PET_NOTIFICATION_PRIORITY[a.state] ?? 9) - (PET_NOTIFICATION_PRIORITY[b.state] ?? 9),
      )
      .map((entry) => ({
        sessionId: entry.sessionId,
        state: entry.state,
        title: entry.title ?? "",
        ...(entry.waitingKind ? { waitingKind: entry.waitingKind } : {}),
      }));
    return {
      state: top.state,
      badge,
      ...(top.title ? { title: top.title } : {}),
      notifications,
    };
  };

  let lastNotifications: Array<{
    sessionId: string;
    state: string;
    title: string;
    waitingKind?: string;
  }> = [];
  const pushPetState = (
    state: string,
    badge: number,
    options: {
      wave?: boolean;
      title?: string;
      notifications?: Array<{
        sessionId: string;
        state: string;
        title: string;
        waitingKind?: string;
      }>;
      actions?: { interactionId: string; options: Array<{ optionId: string; label: string }> };
    } = {},
  ): void => {
    lastBehaviorState = state;
    lastBadge = badge;
    lastTitle = options.title;
    if (options.notifications) lastNotifications = options.notifications;
    // 托盘与宠物上下分栏：有通知时先按保守高度加高，渲染层随后回报实测高度再精调。
    if (lastNotifications.length === 0) {
      trayHeightPx = 0;
    } else if (trayHeightPx === 0) {
      trayHeightPx = PET_TRAY_PROVISIONAL_HEIGHT_PX;
    }
    syncOverlayBounds();
    const payload = {
      state: options.wave ? "idle" : state,
      badge,
      ...(options.wave ? { wave: true } : {}),
      ...(options.title ? { title: options.title } : {}),
      notifications: lastNotifications,
      ...(options.actions && options.actions.options.length > 0
        ? { actions: options.actions }
        : {}),
    };
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send(PlatformChannels.PetOverlaySetState, payload);
    }
    // 独立宠物系统（DSH）旁路：同一份聚合状态，各自渲染各自的。
    deps.onStateBroadcast?.(payload);
  };

  const applyPetSessionState = (
    sessionId: string,
    state: string,
    attentionCount: number,
    title?: string,
    waitingKind?: string,
    actions?: { interactionId: string; options: Array<{ optionId: string; label: string }> },
  ): void => {
    petSessionStates.set(sessionId, {
      state,
      attentionCount,
      ...(title ? { title } : {}),
      ...(waitingKind ? { waitingKind } : {}),
      ...(actions ? { actions } : {}),
    });
    const { state: top, badge, title: topTitle, notifications } = aggregatePetState();
    const topActions = [...petSessionStates.values()].find(
      (entry) => entry.state === top && entry.actions,
    )?.actions as
      | { interactionId: string; options: Array<{ optionId: string; label: string }> }
      | undefined;
    pushPetState(top, badge, {
      ...(topTitle ? { title: topTitle } : {}),
      notifications,
      ...(topActions ? { actions: topActions } : {}),
    });
  };

  return {
    initialize,
    closeWindow,
    getWindow: () => overlayWindow,
    isEnabled: () => config.enabled,
    getPetId: () => config.petId,
    getCurrentBehaviorState: () => lastBehaviorState,
    getCurrentBadge: () => lastBadge,
    /** 会话任务状态上报（SessionPane 主 pane）：聚合所有会话后驱动宠物。 */
    applyPetSessionState: (sessionId: string, state: string, attentionCount: number): void => {
      petSessionStates.set(sessionId, { state, attentionCount });
      const { state: top, badge } = aggregatePetState();
      pushPetState(top, badge);
    },
    /** PetControl/阶段联动的统一入口；wave 是一次性挥手动画。 */
    pushBehaviorState: (state: string): void => {
      if (state === "wave") {
        pushPetState(lastBehaviorState, lastBadge, {
          wave: true,
          ...(lastTitle ? { title: lastTitle } : {}),
        });
        return;
      }
      pushPetState(state, lastBadge, lastTitle ? { title: lastTitle } : {});
    },
  };
}
