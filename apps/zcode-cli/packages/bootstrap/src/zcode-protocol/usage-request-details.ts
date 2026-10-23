import type { UsageStorePort } from "@zcode/contracts";
import {
  zcodeUsageRequestDetailsParamsSchema,
  type XCodeUsageRequestDetailsResult,
} from "@zcode/shared";
import { parseParams } from "./server-types.js";
import type { XCodeProtocolAgentServerContext } from "./server-types.js";

/**
 * 「使用详情」查询：model_usage 逐请求行视图。
 *
 * 与 9router 的 `GET /api/usage/request-details` 同语义。数据源是 agent 自己的
 * sqlite（model_usage 表），host 侧无副本，所以收敛为协议查询而非 host 直连。
 *
 * 只返回元数据（provider/model/耗时/TTFT/tokens/错误），不返回请求与响应正文——
 * 设置页可见性不应等于会话内容可见性。
 */
export async function getUsageRequestDetails(
  context: XCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<XCodeUsageRequestDetailsResult> {
  const params = parseParams(zcodeUsageRequestDetailsParamsSchema, rawParams ?? {});

  // SessionStorePort 与 UsageStorePort 是分离接口，但实际 store 同时实现两者；
  // 沿用 getUsageStats 的运行时收窄方式访问只读查询方法。
  const usageStore = context.deps.sessionStore as Partial<UsageStorePort> | undefined;
  if (!usageStore?.queryModelUsageDetails) {
    return {
      details: [],
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        totalItems: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
      providers: [],
      models: [],
    };
  }

  const result = await usageStore.queryModelUsageDetails({
    page: params.page,
    pageSize: params.pageSize,
    ...(params.since !== undefined ? { since: params.since } : {}),
    ...(params.until !== undefined ? { until: params.until } : {}),
    ...(params.providerId ? { providerId: params.providerId } : {}),
    ...(params.modelId ? { modelId: params.modelId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId as never } : {}),
    ...(params.status ? { status: params.status } : {}),
  });

  return {
    details: result.details.map((row) => ({ ...row, sessionId: String(row.sessionId) })),
    pagination: result.pagination,
    providers: result.providers,
    models: result.models,
  };
}
