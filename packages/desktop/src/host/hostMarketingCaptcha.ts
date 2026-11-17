import { randomUUID } from "node:crypto";

import { HostResponseTypes, type MarketingCaptchaConfig } from "@zcode/shared";

/**
 * Host 侧：向 Main 借渲染进程跑一次阿里云无感验证，换一张领取用的票据。
 *
 * ```text
 * 自动领取 tick ─▶ request(config) ─HostResponse:marketing-captcha-request─▶ Main ─▶ Renderer
 *              ◀─ handleResult ─HostMessage:marketing-captcha-result ◀──── Main ◀┘
 * ```
 *
 * 契约与 `hostProviderProvisioningStatus` 同构（requestId 关联、Main 必有应答）。
 * 差别是这里**必须有超时**：渲染进程可能还没装监听（启动早期）、窗口正在销毁，
 * 或者 SDK 加载失败。拿不到票据时回 `null`，调用方按「本轮领不了」处理，
 * 绝不能挂住整个 tick。
 */

/** Main 侧等待渲染进程 25s，这里再留一点投递余量。 */
const REQUEST_TIMEOUT_MS = 30_000;

export interface HostMarketingCaptchaProof {
  verifyParam: string;
  region?: string;
}

interface PendingRequest {
  resolve(proof: HostMarketingCaptchaProof | null): void;
  timer: ReturnType<typeof setTimeout>;
}

interface ResultMessage {
  requestId: string;
  verifyParam?: string;
  region?: string;
  error?: string;
}

export function createHostMarketingCaptchaRequester(
  postMessage: (message: unknown) => void,
): {
  request(config: MarketingCaptchaConfig): Promise<HostMarketingCaptchaProof | null>;
  handleResult(message: ResultMessage): boolean;
} {
  const pending = new Map<string, PendingRequest>();

  return {
    request(config) {
      const requestId = randomUUID();
      return new Promise<HostMarketingCaptchaProof | null>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve(null);
        }, REQUEST_TIMEOUT_MS);
        timer.unref?.();
        pending.set(requestId, { resolve, timer });
        try {
          postMessage({
            type: HostResponseTypes.MarketingCaptchaRequest,
            requestId,
            config,
          });
        } catch {
          pending.delete(requestId);
          clearTimeout(timer);
          resolve(null);
        }
      });
    },
    handleResult(message) {
      const request = pending.get(message.requestId);
      if (!request) return false;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      request.resolve(
        message.verifyParam
          ? {
              verifyParam: message.verifyParam,
              ...(message.region ? { region: message.region } : {}),
            }
          : null,
      );
      return true;
    },
  };
}
