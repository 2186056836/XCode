import {
  systemReminderAttachmentEntry,
  type RuntimeMessageEntry,
} from "../../agent/message-history.js";
import type { ContextBuildResult } from "../deps.js";
import type { SystemPromptPrefillSettings } from "../../context/types.js";

/**
 * 前缀条目 = system 消息 + meta user attachments（+ 可选的 godmode prefill）。
 *
 * `countContextPrefixMessages` 依赖这里的形状判断「哪些消息属于可重建的前缀」：
 * system / `<system-reminder>` user / context_prefix 附件会被计入，**普通 user 会中断计数**。
 * 因此 prefill 的 priming 轮必须挂在 prefix 末尾、且用 metadata 标记为
 * `context_prefix`，否则第二次 rebuild 会把它们当成真实对话保留下来（重复注入），
 * 或者直接丢掉（首轮之后就没了）。
 */
export function buildContextHistoryEntries(
  contextResult: ContextBuildResult,
  prefill?: SystemPromptPrefillSettings,
): RuntimeMessageEntry[] {
  const entries: RuntimeMessageEntry[] = [
    ...contextResult.systemMessages.map((message): RuntimeMessageEntry => ({ message })),
    ...contextResult.metaUserAttachments.map((attachment) =>
      systemReminderAttachmentEntry(attachment.source, attachment.content),
    ),
  ];
  if (prefill?.enabled && prefill.messages?.length) {
    for (const turn of prefill.messages) {
      entries.push({
        message: { role: turn.role, content: turn.content },
        metadata: { source: "context_prefix" },
      });
    }
  }
  return entries;
}
