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
  /**
   * 组本次请求的鉴权头。
   *
   * `accountRef` 给定时读该账号自己的 JWT（`zcodejwt:{accountRef}`）与 Device-Mid，
   * 而不是全局镜像。一键领取要对每个账号「用谁的凭据查投放」——用激活账号的凭据去查，
   * 拿到的就是激活账号的投放，再拿别的账号的凭据去领，服务端自然判无活动。
   */
  async function context(locale: "zh-CN" | "en-US", accountRef?: string) {
    const tokenKey = accountRef ? `zcodejwt:${accountRef}` : XCODE_JWT_TOKEN_KEY;
    const token = (await options.credentialService.load(tokenKey))?.trim() || "";
    if (previousToken !== token) {
      previousToken = token;
      scope = randomUUID();
    }
    // Device-Mid 必须与被查询账号配对：source 头里的 mid 与 JWT 不同源时服务端会拒绝。
    const sourceHeaders = buildXCodeSourceHeaders(accountRef ? { accountRef } : {});
    const headers: Record<string, string> = {
      ...sourceHeaders,
      "X-Client-Language": localeSchema.parse(locale),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    z.string().uuid().parse(headers["X-Device-Mid"]);
    return { scope, headers };
  }
  return {
    async query({ locale, accountRef }) {
      const identity = await context(locale, accountRef);
      const url = new URL(XCODE_MARKETING_TOUCH_URL);
      url.searchParams.set("seq", String(bootRequestSeq++));
      const response = await readApiJson<unknown>(options.apiClient, url.href, {
        method: "GET",
        headers: identity.headers,
        timeoutMs: 15_000,
        redirect: "error",
      });
      if ((await context(locale, accountRef)).scope !== identity.scope)
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
