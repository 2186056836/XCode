import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import type { ContextBuildResult } from "../deps.js";

// Context prefix 只含 system 消息；指令文件、Skill、Git 等改由请求前的动态公告宣告。
export function buildContextHistoryEntries(
  contextResult: ContextBuildResult,
): RuntimeMessageEntry[] {
  return contextResult.systemMessages.map((message): RuntimeMessageEntry =>
    // builder 把 godmode PreFill 的 priming 轮追加在 system 之后；它们属于可重建的
    // context prefix，必须带专用 source 标记，rebuild 才不会把它们当真实对话重复保留。
    message.role === "system" ? { message } : { message, metadata: { source: "context_prefix" } },
  );
}
