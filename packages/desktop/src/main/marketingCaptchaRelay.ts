import { ipcMain, type BrowserWindow } from "electron";

import {
  PlatformChannels,
  type MarketingCaptchaConfig,
  type MarketingCaptchaProofResult,
} from "@zcode/shared";

/**
 * Host → Main → Renderer 的验证码出票中转。
 *
 * 领取接口（`zcode-plan/billing/claim`）强制校验 `X-Aliyun-Captcha-Verify-Param`。
 * 手动领取能静默通过滑块，是因为渲染进程跑了阿里云**无感验证**：风控评分低时
 * SDK 不渲染任何交互，直接回调一张票据。Host 是纯 Node 工具进程，没有 DOM，
 * 跑不了这个 SDK，所以自动领取只能借渲染进程这一趟。
 *
 * 时序：
 *
 * ```text
 * Host ─postMessage(request)─▶ Main ─webContents.send─▶ Renderer 跑 SDK
 * Host ◀─postMessage(result)── Main ◀──ipcRenderer.send──┘
 * ```
 *
 * 超时保证 Host 不会一直挂着等：渲染进程没装监听（启动早期）、窗口在同时刻
 * 销毁、SDK 加载失败都会走超时或错误回包，调用方按「拿不到票据」处理。
 */

/** 渲染进程侧 SDK 自带 12s 超时，这里留出排队与 IPC 余量。 */
const REQUEST_TIMEOUT_MS = 25_000;

export interface MarketingCaptchaProof {
  verifyParam?: string;
  region?: string;
  error?: string;
}

interface PendingRequest {
  resolve(proof: MarketingCaptchaProof): void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingRequests = new Map<string, PendingRequest>();
let listenerInstalled = false;

function installResultListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  ipcMain.on(PlatformChannels.MarketingCaptchaResult, (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const result = payload as MarketingCaptchaProofResult;
    if (typeof result.requestId !== "string") return;
    const pending = pendingRequests.get(result.requestId);
    if (!pending) return;
    pendingRequests.delete(result.requestId);
    clearTimeout(pending.timer);
    pending.resolve(
      result.verifyParam
        ? {
            verifyParam: result.verifyParam,
            ...(typeof result.region === "string" ? { region: result.region } : {}),
          }
        : { error: result.error || "captcha_verify_failed" },
    );
  });
}

/**
 * 请渲染进程跑一次无感验证，返回票据。
 *
 * 永远 resolve（不 reject）：调用方是自动领取的 tick，拿不到票据就是
 * 「这一轮领不了」，不该用异常打断整轮扫描。
 */
export function requestMarketingCaptchaProof(
  win: BrowserWindow | null,
  request: { requestId: string; config: MarketingCaptchaConfig },
): Promise<MarketingCaptchaProof> {
  installResultListener();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return Promise.resolve({ error: "renderer_unavailable" });
  }

  return new Promise<MarketingCaptchaProof>((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(request.requestId);
      resolve({ error: "captcha_request_timeout" });
    }, REQUEST_TIMEOUT_MS);
    timer.unref?.();
    pendingRequests.set(request.requestId, { resolve, timer });

    try {
      win.webContents.send(PlatformChannels.MarketingCaptchaRequest, {
        requestId: request.requestId,
        config: request.config,
      });
    } catch (error) {
      pendingRequests.delete(request.requestId);
      clearTimeout(timer);
      resolve({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
