import type {
  ApiClient,
  MarketingTouchDelivery,
  MarketingTouchReport,
  MarketingTouchResponse,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import { readApiJson } from "../providers/api/apiJson.js";
import {
  ZCODE_MARKETING_TOUCH_REPORT_URL,
  ZCODE_MARKETING_TOUCH_URL,
} from "../providers/api/apiEndpoints.js";
import { ensureDeviceMidForAccountSync } from "../device/deviceMid.js";
import { buildXCodeSourceHeaders } from "../providers/sourceHeaders.js";
import type { IMarketingTouchService, MarketingTouchQuery } from "./marketingTouch.js";
import { normalizeMarketingDelivery, type RawMarketingDelivery } from "./normalizeMarketingDelivery.js";

const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";

/**
 * `/api/v1/marketing/touch` 实际返回包了一层业务信封：
 * `{ code, msg, data: { server_time, language, deliveries }, logid }`。
 * 控制器读取的是 `MarketingTouchResponse.deliveries`，因此此处必须解包 `data`。
 * 且 `data.deliveries` 是官方扁平资源位 schema，需经 normalizeMarketingDelivery
 * 转成 fork 控制器/UI 消费的 MarketingTouchDelivery 形状。
 */
interface MarketingTouchEnvelope {
  code: number;
  msg?: string;
  data?: {
    server_time: number;
    language: string;
    deliveries: RawMarketingDelivery[];
  };
  logid?: string;
}

export function createMarketingTouchService(dependencies: {
  apiClient: ApiClient;
  credentialService: ICredentialService;
}): IMarketingTouchService {
  async function loadAuthHeaders(accountRef?: string): Promise<Record<string, string>> {
    // 一键领取按账号凭据查询：整套装 source 头（X-ZCode-App-Version / X-Device-Mid 等）
    // 必须跟随目标账号 —— apiClient 注入的 Device-Mid 永远是激活账号的，JWT 与 mid
    // 不配对时服务端不下发活动。per-account mid 缺失（从未激活过）时先生成落盘。
    if (accountRef) {
      ensureDeviceMidForAccountSync(accountRef);
    }
    const sourceHeaders = accountRef ? buildXCodeSourceHeaders({ accountRef }) : {};
    const headers: Record<string, string> = { ...sourceHeaders, "Content-Type": "application/json" };
    // 一键领取按账号凭据查询：accountRef 给定时读 per-account JWT（zcodejwt:{ref}，
    // 与 oauthCredentialRepo 的 accountZcodeJwtKey 同 key 约定），不读全局镜像。
    const jwtToken = (
      await dependencies.credentialService.load(
        accountRef ? `zcodejwt:${accountRef}` : ZCODE_JWT_TOKEN_KEY,
      )
    )?.trim();
    if (jwtToken) {
      headers.Authorization = `Bearer ${jwtToken}`;
    }
    return headers;
  }

  return {
    query: async (input: MarketingTouchQuery): Promise<MarketingTouchResponse> => {
      const seq = input.seq ?? Date.now();
      const params = new URLSearchParams({
        seq: String(seq),
        lang: input.locale,
      });
      const url = `${ZCODE_MARKETING_TOUCH_URL}?${params.toString()}`;
      const envelope = await readApiJson<MarketingTouchEnvelope>(dependencies.apiClient, url, {
        method: "GET",
        headers: await loadAuthHeaders(input.accountRef),
      });
      // 优先取业务信封内的 data；个别环境/模拟源直接返回顶层 deliveries，也一并兜底。
      const payload = (envelope?.data ?? (envelope as unknown as MarketingTouchResponse)) ?? {};
      const rawDeliveries = Array.isArray(payload.deliveries) ? payload.deliveries : [];
      const deliveries = (
        await Promise.all(
          rawDeliveries.map(async (d): Promise<MarketingTouchDelivery | null> => {
            if (d && typeof d === "object" && "campaign" in d) return d as MarketingTouchDelivery;
            return normalizeMarketingDelivery(d as RawMarketingDelivery, input.locale);
          }),
        )
      ).filter((d): d is MarketingTouchDelivery => Boolean(d));
      return { ...payload, deliveries };
    },
    report: async (input: MarketingTouchReport): Promise<void> => {
      // 官方 action 上报体为 { campaign_id, action_type }；scope/locale 仅用于请求上下文。
      const response = await dependencies.apiClient.request(ZCODE_MARKETING_TOUCH_REPORT_URL, {
        method: "POST",
        headers: await loadAuthHeaders(),
        body: JSON.stringify({
          campaign_id: input.campaignId,
          action_type: input.actionType,
        }),
      });
      if (!response.ok) {
        throw new Error(`marketing touch report failed: HTTP ${response.status}`);
      }
    },
  };
}
