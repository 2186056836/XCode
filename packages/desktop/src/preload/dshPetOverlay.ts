/**
 * DSH 桌宠悬浮窗 preload（独立于 Codex 宠物窗的 preload/petOverlay）。
 * 通道与 Codex 版完全分开，两套宠物窗同时存在时互不干扰。
 */
import { contextBridge, ipcRenderer } from "electron";
import { PlatformChannels } from "@zcode/shared";
import type { DshPetUserConfig } from "../shared/dshPetConfig.js";

/** 悬浮窗拿到的完整配置（与主进程、设置页同源同形）。 */
export type DshPetWindowConfig = DshPetUserConfig;

contextBridge.exposeInMainWorld("dshPet", {
  /** 窗口跟随：渲染层拥有物理，逐帧把内容区矩形推给主进程。 */
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
  }) => ipcRenderer.send(PlatformChannels.DshPetDrag, payload),
  /** 截屏：主进程取宠物所在屏的一帧（JPEG base64），形状与上传图片一致。 */
  captureScreen: (): Promise<{ mediaType: string; data: string } | null> =>
    ipcRenderer.invoke(PlatformChannels.DshPetCaptureScreen),
  /** 宠物互撞：把被撞方的新初速交给主进程，转发给那只宠物的窗口重新抛出。 */
  petHit: (payload: { targetId: string; vx: number; vy: number }) =>
    ipcRenderer.send(PlatformChannels.DshPetPetHit, payload),
  /** 输入租约：拖拽/菜单打开时为 true，主进程不强制恢复穿透。 */
  setInputBusy: (busy: boolean) => ipcRenderer.send(PlatformChannels.DshPetThrow, { busy }),

  /** 渲染层就绪：请求主进程下发显示器几何。 */
  ready: () => ipcRenderer.send(PlatformChannels.DshPetReady),
  /** 菜单「打开 XCode」：显式恢复并聚焦主窗。 */
  openApp: () => ipcRenderer.send(PlatformChannels.DshPetOpenApp),
  /** 菜单「重载配置」：重读配置并重载悬浮窗。 */
  reload: () => ipcRenderer.send(PlatformChannels.DshPetReload),
  /** 菜单「碎碎念」：立即生成一句；meme 是渲染层抽中的配图名（写进 prompt）。 */
  requestWhisper: (payload?: { meme?: string }) =>
    ipcRenderer.send(PlatformChannels.DshPetWhisper, payload ?? {}),
  /** 聊天：发送一条消息，回复经 onHostEvent(chat-reply) 推回。 */
  sendChatMessage: (payload: {
    message: string;
    /** 配图候选池（文件名）；对话配图关闭时省略。 */
    pool?: string[];
    imageEnabled?: boolean;
    /** 本轮附带的图片（base64，不带 data: 前缀）。 */
    attachment?: { mediaType: string; data: string };
  }): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke(PlatformChannels.DshPetChat, payload),
  /** 对话面板需要键盘焦点：请主进程把自己的桌宠窗 focus 起来（窗口 focusable:true）。 */
  focusSelf: () => ipcRenderer.send(PlatformChannels.DshPetFocusSelf),
  /** 菜单「显示位置」：改开关（仅桌面 / 都不）。 */
  setConfig: (patch: Partial<DshPetUserConfig>): Promise<DshPetUserConfig> =>
    ipcRenderer.invoke(PlatformChannels.DshPetSetConfig, patch),
  getConfig: (): Promise<DshPetWindowConfig> =>
    ipcRenderer.invoke(PlatformChannels.DshPetGetConfig),
  /** 落盘位置（设置页「存储位置」卡）：用户配置与对话记忆目录。 */
  getMeta: (): Promise<{ userConfig: string; memoryDir: string }> =>
    ipcRenderer.invoke(PlatformChannels.DshPetGetMeta),
  /** 自制宠物包：列出 userData/dsh-pet/packs 下的包（设置页选包用）。 */
  listPacks: (): Promise<Array<{ id: string; name: string }>> =>
    ipcRenderer.invoke(PlatformChannels.DshPetListPacks),
  /** 按宠物读包：包内 config 的 animations/workStatusTexts + 授权后的 webm URL。 */
  loadPack: (
    payload: { petId: string },
  ): Promise<
    | {
        name: string;
        animations: unknown;
        animationWeights: unknown;
        workStatusTexts: unknown;
        urls: Record<string, string>;
      }
    | { error: string }
  > => ipcRenderer.invoke(PlatformChannels.DshPetLoadPack, payload),
  /**
   * 完整素材包（上游 dsh-pet/assets，下载到本地）。
   *
   * 内置只有精简版 8 个动作；下载后桌宠窗解析素材时优先用完整包。
   */
  assets: {
    status: (): Promise<{
      installed: boolean;
      counts: { webm: number; memes: number; font: boolean };
      totals: { webm: number; memes: number; font: number };
      dir: string;
      lastMirror?: string | null;
    }> => ipcRenderer.invoke(PlatformChannels.DshPetAssetsStatus),
    probe: (): Promise<
      Array<{
        label: string;
        template: string;
        bytesPerSecond: number;
        latencyMs: number;
        error?: string;
      }>
    > => ipcRenderer.invoke(PlatformChannels.DshPetAssetsProbe),
    /** 下载上游全部素材（内置之外的动作 + 表情包 + 字体），慢速网络下可能很久，可取消。 */
    download: (): Promise<{
      ok: boolean;
      counts?: { webm: number; memes: number; font: boolean };
      downloaded?: { webm: number; memes: number };
      error?: string;
    }> => ipcRenderer.invoke(PlatformChannels.DshPetAssetsDownload),
    /** 已缓存的动作名（右键菜单只列这些，避免点了要等下载）。 */
    cached: (): Promise<string[]> =>
      ipcRenderer.invoke(PlatformChannels.DshPetAssetsCached),
    cancel: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(PlatformChannels.DshPetAssetsCancel),
    uninstall: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(PlatformChannels.DshPetAssetsUninstall),
    /**
     * 取动作播放 URL：本地缺失时会下载该动作（单动作补缺入口）。
     * `memes`/`font` 传 true 才取对应资源，避免每次切动作都枚举全部表情包。
     */
    media: (payload: {
      names: string[];
      memes?: boolean;
      font?: boolean;
    }): Promise<{
      webm: Record<string, string>;
      memes: Record<string, string>;
      font: string | null;
    }> => ipcRenderer.invoke(PlatformChannels.DshPetAssetsMedia, payload),
    onProgress: (
      callback: (progress: {
        name: string;
        loaded: number;
        total: number;
        done: number;
        target: number;
        mirror?: string;
      }) => void,
    ) => {
      const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) =>
        callback(payload);
      ipcRenderer.on(PlatformChannels.DshPetAssetsProgressEvent, listener);
      return () => ipcRenderer.removeListener(PlatformChannels.DshPetAssetsProgressEvent, listener);
    },
  },
  onConfig: (callback: (config: DshPetWindowConfig) => void) => {
    const listener = (_event: unknown, payload: DshPetWindowConfig) => callback(payload);
    ipcRenderer.on(PlatformChannels.DshPetConfigEvent, listener);
    return () => ipcRenderer.removeListener(PlatformChannels.DshPetConfigEvent, listener);
  },
  /** 主进程事件：displays / size / state / force-release-input。 */
  onHostEvent: (callback: (payload: { type: string; [key: string]: unknown }) => void) => {
    const listener = (_event: unknown, payload: { type: string }) => callback(payload);
    ipcRenderer.on(PlatformChannels.DshPetStateEvent, listener);
    return () => ipcRenderer.removeListener(PlatformChannels.DshPetStateEvent, listener);
  },
});
