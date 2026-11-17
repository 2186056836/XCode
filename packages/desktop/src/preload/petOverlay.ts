/**
 * 桌宠悬浮窗 preload（对齐 cuaPermissionPanel 的取舍：专用小窗口只暴露它需要的能力，
 * 不复用主窗口的庞大 preload，攻击面最小）。
 */
import { contextBridge, ipcRenderer } from "electron";
import { PlatformChannels } from "@zcode/shared";

export interface PetOverlayWindowConfig {
  enabled: boolean;
  petId: string;
  sizePx: number;
  x?: number;
  y?: number;
}

contextBridge.exposeInMainWorld("petOverlay", {
  /** 拖拽相位：move 携带指针增量（dx/dy），主进程平移窗口。 */
  drag: (payload: { phase: "start" | "move" | "end"; dx?: number; dy?: number }) =>
    ipcRenderer.send(PlatformChannels.PetOverlayDrag, payload),
  /** 抛掷（松手惯性）：像素/秒。 */
  throwWithVelocity: (velocityX: number, velocityY: number) =>
    ipcRenderer.send(PlatformChannels.PetOverlayThrow, { velocityX, velocityY }),
  /** 尺寸调整三相位（主进程钳制 80–224、左上锚定并广播配置）。 */
  resize: (payload: { phase: "start" | "move" | "end"; width?: number }) =>
    ipcRenderer.send(PlatformChannels.PetOverlayResize, payload),
  /** 通知托盘实际高度（0 = 收起）：主进程据此让窗口刚好容纳托盘 + 宠物，不互相遮挡。 */
  setTrayHeight: (height: number) =>
    ipcRenderer.send(PlatformChannels.PetOverlayTrayHeight, { height }),
  /** 指针进入/离开宠物热区时切换点击穿透。 */
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.send(PlatformChannels.PetOverlaySetIgnoreMouseEvents, { ignore }),
  /** 点击宠物：聚焦主窗。 */
  focusMain: () => ipcRenderer.send(PlatformChannels.PetOverlayFocusMain),
  /** 当前配置（宠物/尺寸）与变更推送。 */
  getConfig: (): Promise<PetOverlayWindowConfig> =>
    ipcRenderer.invoke(PlatformChannels.PetOverlayGetConfig),
  onConfig: (callback: (config: PetOverlayWindowConfig) => void) => {
    const listener = (_event: unknown, payload: PetOverlayWindowConfig) => callback(payload);
    ipcRenderer.on(PlatformChannels.PetOverlayConfigEvent, listener);
    return () => ipcRenderer.removeListener(PlatformChannels.PetOverlayConfigEvent, listener);
  },
  installPetMakerSkill: (): Promise<string> =>
    ipcRenderer.invoke(PlatformChannels.PetOverlayInstallPetMakerSkill),
  installHatchPetSkill: (): Promise<string> =>
    ipcRenderer.invoke(PlatformChannels.PetOverlayInstallHatchPetSkill),
  /** 自定义宠物精灵 dataURL（custom:<slug> 才有效）。 */
  getCustomSpriteDataUrl: (petId: string): Promise<string | null> =>
    ipcRenderer.invoke(PlatformChannels.PetOverlayGetCustomSpriteDataUrl, petId),
  /** 点击 pill 内动作按钮：把 optionId 回传给主窗执行 resolveInteraction。 */
  resolveAction: (payload: { interactionId: string; optionId: string }) =>
    ipcRenderer.send(PlatformChannels.PetOverlayResolveAction, payload),
  /** 点击通知托盘某一行：请求主窗切到该会话（官方行点击行为）。 */
  openSession: (sessionId: string) =>
    ipcRenderer.send(PlatformChannels.PetOverlayOpenSession, { sessionId }),
  /** 主窗转发的行为状态（running/waiting/failed/review…）。 */
  onState: (
    callback: (payload: {
      state: string;
      wave?: boolean;
      badge?: number;
      title?: string;
      notifications?: Array<{
        sessionId: string;
        state: string;
        title: string;
        waitingKind?: string;
      }>;
      actions?: { interactionId: string; options: Array<{ optionId: string; label: string }> };
    }) => void,
  ) => {
    const listener = (
      _event: unknown,
      payload: {
        state: string;
        wave?: boolean;
        badge?: number;
        title?: string;
        notifications?: Array<{
          sessionId: string;
          state: string;
          title: string;
          waitingKind?: string;
        }>;
        actions?: {
          interactionId: string;
          options: Array<{ optionId: string; label: string }>;
        };
      },
    ) => callback(payload);
    ipcRenderer.on(PlatformChannels.PetOverlaySetState, listener);
    return () => ipcRenderer.removeListener(PlatformChannels.PetOverlaySetState, listener);
  },
});
