import type { ModelRequestAuth } from "@zcode/contracts";
import type { ModelExecutionInput, ModelExecutionContext } from "./contract.js";

/** 两种输入协议共用执行材料投影；不把 Secret/Ticket 放入可持久化的 intent。 */
export function createModelExecutionContext(input: ModelExecutionInput): ModelExecutionContext {
  const requestAuth = input.requestAuth ? freezeRequestAuth(input.requestAuth) : undefined;
  return {
    ...(input.memoryExtraction ? { memoryExtraction: input.memoryExtraction } : {}),
    selectionScope: "execution",
    ...(input.offPeak ? { offPeak: input.offPeak } : {}),
    ...(requestAuth
      ? {
          requestDependencies: { requestAuth: { source: { resolve: async () => requestAuth } } },
        }
      : {}),
    ...(input.subagents ? { subagents: input.subagents } : {}),
    ...(input.selectionFallback ? { selectionFallback: input.selectionFallback } : {}),
  };
}

function freezeRequestAuth(input: ModelRequestAuth): ModelRequestAuth {
  return Object.freeze({
    ...(input.accountScope ? { accountScope: input.accountScope } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
    // 连接（账号）id：zhipu-account 唯一可用的账号身份来源，丢了它连接级代理绑定会失效。
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.headers ? { headers: Object.freeze({ ...input.headers }) } : {}),
  });
}
