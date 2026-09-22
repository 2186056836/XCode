import type { MessageId, TextPart } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";
import { hydrateMessageHistoryFromSession } from "../../agent/session-history-hydrator.js";

export interface EditAssistantMessageTextInput {
  messageId: string;
  newText: string;
}

/**
 * XCode fork：原地编辑已完成助手消息的文本。
 *
 * transcript（sqlite part）是持久权威：savePart upsert 新文本（多个非 ignored text part
 * 时合并语义——首 part 承载新文本、其余删除，保证 hydrate 后文本恰为编辑值）。
 * 随后按当前 branch cut 状态全量重建 messageHistory，使后续模型请求把新文本当真实上下文；
 * 不截断后续消息、不重跑 turn（与 editUserQuery 的 rewind+重发语义不同）。
 */
export async function editAssistantMessageText(
  this: AgentRuntimeInternal,
  input: EditAssistantMessageTextInput,
): Promise<void> {
  if (!this.sessionStore) {
    throw new Error("proto.staleTarget");
  }
  const sessionId = this.sessionId;
  const messageId = input.messageId as MessageId;
  const target = await this.sessionStore.messageWithParts({
    sessionID: sessionId,
    messageID: messageId,
  });
  if (!target || target.info.role !== "assistant") {
    throw new Error("proto.staleTarget");
  }
  const textParts = target.parts.filter(
    (part): part is TextPart => part.type === "text" && !part.ignored,
  );
  if (textParts.length === 0) {
    // 纯 reasoning/tool 的 assistant 消息没有可编辑文本面。
    throw new Error("proto.staleTarget");
  }
  const [first, ...rest] = textParts;
  await this.sessionStore.savePart({ ...first, text: input.newText });
  for (const part of rest) {
    await this.sessionStore.removePart({
      sessionID: sessionId,
      messageID: messageId,
      partID: part.id,
    });
  }

  const session = await this.sessionStore.getSession(sessionId);
  const persistedMessages = await this.sessionStore.messages({ sessionID: sessionId });
  this.messageHistory.reset();
  await hydrateMessageHistoryFromSession({
    artifactStore: this.artifactStore,
    history: this.messageHistory,
    messages: persistedMessages,
    branchCutAfterMessageId: session?.revert?.branchCutAfterMessageID,
    rewindCreatedMessageId: session?.revert?.createdMessageID,
    rewindKeptMessageIds: session?.revert?.keptMessageIDs,
    rewindTargetMessageId: session?.revert?.targetMessageID,
  });
  this.messageHistory.setCacheMiss();
}
