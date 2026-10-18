import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseMarketingTouchResponse, type ApiClient } from "@zcode/shared";
import { readApiJson } from "#src/providers/api/apiJson.js";
import {
  XCODE_MARKETING_TOUCH_REPORT_URL,
  XCODE_MARKETING_TOUCH_URL,
} from "#src/providers/api/apiEndpoints.js";
import { buildXCodeSourceHeaders } from "#src/providers/sourceHeaders.js";
import type { ICredentialService } from "#src/credential/credential.js";
import type { IMarketingTouchService } from "#src/marketing-touch/marketingTouch.js";

const XCODE_JWT_TOKEN_KEY = "zcodejwttoken";
const localeSchema = z.enum(["zh-CN", "en-US"]);
// 序号属于本次服务进程启动，不能随组件、账号或服务实例重建而归零。
let bootRequestSeq = 0;
const reportSchema = z.object({
  locale: localeSchema,
  scope: z.string().uuid(),
  campaignId: z.string().trim().min(1).max(128),
  actionType: z.enum(["confirm", "cancel"]),
});

export function createMarketingTouchService(options: {
  apiClient: ApiClient;
  // fork 语义：活动领取/上报的鉴权走账号凭据（与 codingPlan / feedback 同一约定）。
  // 上一轮合并曾把这里的凭据层换成外部注入的 getToken/getDeviceMid，但 node.ts 的
  // 注册点始终按 fork 约定传 credentialService，导致 TS2353 且运行时无凭据可用。
  credentialService: ICredentialService;
  onSnapshot?: (snapshot: ReturnType<typeof parseMarketingTouchResponse>) => void;
}): IMarketingTouchService {
  let previousToken: string | undefined;
  let scope = randomUUID();
  async function context(locale: "zh-CN" | "en-US") {
    const token = (await options.credentialService.load(XCODE_JWT_TOKEN_KEY))?.trim() || "";
    if (previousToken !== token) {
      previousToken = token;
      scope = randomUUID();
    }
    // Device-Mid / App-Version / 渠道等成套 source 头统一由 fork 的 sourceHeaders 构造，
    // 与其他出口保持一致；locale 由调用方显式覆盖。
    const sourceHeaders = buildXCodeSourceHeaders();
    const headers: Record<string, string> = {
      ...sourceHeaders,
      "X-Client-Language": localeSchema.parse(locale),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    z.string().uuid().parse(headers["X-Device-Mid"]);
    return { scope, headers };
  }
  return {
    async query({ locale }) {
      const identity = await context(locale);
      const url = new URL(XCODE_MARKETING_TOUCH_URL);
      url.searchParams.set("seq", String(bootRequestSeq++));
      const response = await readApiJson<unknown>(options.apiClient, url.href, {
        method: "GET",
        headers: identity.headers,
        timeoutMs: 15_000,
        redirect: "error",
      });
      if ((await context(locale)).scope !== identity.scope)
        throw new Error("marketing_identity_changed");
      const snapshot = parseMarketingTouchResponse(response);
      options.onSnapshot?.(snapshot);
      return { ...snapshot, scope: identity.scope };
    },
    async report(input) {
      const parsed = reportSchema.parse(input);
      const identity = await context(parsed.locale);
      // 领取期间账号可能已切换；禁止把旧操作用新凭据上报，也不向 UI 暴露凭据。
      if (identity.scope !== parsed.scope) throw new Error("marketing_identity_changed");
      const response = await readApiJson<unknown>(
        options.apiClient,
        XCODE_MARKETING_TOUCH_REPORT_URL,
        {
          method: "POST",
          headers: { ...identity.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ campaign_id: parsed.campaignId, action_type: parsed.actionType }),
          timeoutMs: 15_000,
          redirect: "error",
        },
      );
      z.object({ code: z.literal(0) }).parse(response);
    },
  };
}
