import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  parseMarketingTouchResponse,
  SUPPORTED_LOCALES,
  type ApiClient,
  type Locale,
} from "@zcode/shared";
import { readApiJson } from "#src/providers/api/apiJson.js";
import {
  XCODE_MARKETING_TOUCH_REPORT_URL,
  XCODE_MARKETING_TOUCH_URL,
} from "#src/providers/api/apiEndpoints.js";
import { buildXCodeSourceHeaders } from "#src/providers/sourceHeaders.js";
import type { ICredentialService } from "#src/credential/credential.js";
import type { IMarketingTouchService } from "#src/marketing-touch/marketingTouch.js";

const XCODE_JWT_TOKEN_KEY = "zcodejwttoken";
// X-Client-Language 必须是真实界面语言（含 ja-JP/ru-RU/ko-KR），不能先降级成中英。
const localeSchema = z.enum(SUPPORTED_LOCALES);
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
  /**
   * 账号级代理出口：查询/领取权益是平台 API，之前只走全局 apiClient，
   * 账号在账号管理里绑定的代理池对它们不生效。按 accountRef 解析账号绑定池，
   * 未传 accountRef 时解析当前激活账号；未提供时回落全局 apiClient。
   */
  accountApiClient?: (accountRef?: string) => ApiClient;
  onSnapshot?: (snapshot: ReturnType<typeof parseMarketingTouchResponse>) => void;
}): IMarketingTouchService {
  /**
   * scope 必须按身份隔离：一键领取会并发/连续用不同账号的 JWT 查投放，而界面的
   * 后台轮询同时用激活账号在查。之前 scope 是单值 + 单 previousToken，两个身份交错
   * 就会让先返回的那次请求在复查时读到别人的 token、判定 `marketing_identity_changed`
   * ——表现正是「一键领取第一个账号直接失败」。
   */
  const identities = new Map<string, { token: string; scope: string }>();
  /**
   * 组本次请求的鉴权头。
   *
   * `accountRef` 给定时读该账号自己的 JWT（`zcodejwt:{accountRef}`）与 Device-Mid，
   * 而不是全局镜像。一键领取要对每个账号「用谁的凭据查投放」——用激活账号的凭据去查，
   * 拿到的就是激活账号的投放，再拿别的账号的凭据去领，服务端自然判无活动。
   */
  async function context(locale: Locale, accountRef?: string) {
    const tokenKey = accountRef ? `zcodejwt:${accountRef}` : XCODE_JWT_TOKEN_KEY;
    const identityKey = accountRef ?? "__active__";
    const token = (await options.credentialService.load(tokenKey))?.trim() || "";
    // 身份内 token 变化（重新登录/换绑）才换 scope；不同账号互不影响。
    const known = identities.get(identityKey);
    const scope = known?.token === token ? known.scope : randomUUID();
    identities.set(identityKey, { token, scope });
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
      const response = await readApiJson<unknown>(
        options.accountApiClient?.(accountRef) ?? options.apiClient,
        url.href,
        {
          method: "GET",
          headers: identity.headers,
          timeoutMs: 15_000,
          redirect: "error",
        },
      );
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
