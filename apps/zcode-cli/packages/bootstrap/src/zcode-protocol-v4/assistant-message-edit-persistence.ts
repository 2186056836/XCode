import {
  SessionEventType,
  createEventId,
  type SessionEvent,
  type SessionEventStorePort,
  type SessionId,
  type SessionStorePort,
  type TraceId,
} from "@zcode/contracts";

interface PersistAssistantMessageEditInput {
  sessionStore: SessionStorePort;
  eventStore: SessionEventStorePort;
  sessionId: string;
  messageId: string;
  entityId: string;
  newText: string;
  traceId: string;
  /** core runtime 方法：transcript part upsert + messageHistory 重建。 */
  editAssistantMessageText: (options: {
    messageId: string;
    newText: string;
  }) => Promise<void>;
  now?: () => number;
  onPersistedEvent(event: SessionEvent): void;
  onLiveProjectionError?(error: unknown): void;
}

/**
 * XCode fork：助手消息原地编辑的持久编排。
 *
 * transcript（sqlite part）是权威：先经 runtime 方法改 part 并重建 runtime history，
 * 再 append AssistantMessageEdited 事件推进 live/cold projection。
 * append 失败时补偿回原始文本（合并语义下重写首 part 即恢复），避免半提交状态。
 */
export async function persistAssistantMessageEdit(
  input: PersistAssistantMessageEditInput,
): Promise<void> {
  const sessionId = input.sessionId as SessionId;
  const target = await input.sessionStore.messageWithParts({
    sessionID: sessionId,
    messageID: input.messageId as import("@zcode/contracts").MessageId,
  });
  if (!target || target.info.role !== "assistant") {
    throw new Error("proto.staleTarget");
  }
  const originalTextParts = target.parts.filter(
    (part) => part.type === "text" && !part.ignored,
  );
  if (originalTextParts.length === 0) {
    throw new Error("proto.staleTarget");
  }
  const originalText = originalTextParts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n");

  await input.editAssistantMessageText({
    messageId: input.messageId,
    newText: input.newText,
  });

  const event: SessionEvent = {
    id: createEventId(),
    sessionId,
    type: SessionEventType.AssistantMessageEdited,
    timestamp: new Date((input.now ?? Date.now)()),
    traceId: input.traceId as TraceId,
    sequenceNumber: (await input.eventStore.getLatestSequenceNumber(sessionId)) + 1,
    payload: {
      entityId: input.entityId,
      messageId: input.messageId,
      text: input.newText,
    },
  };
  let persisted: SessionEvent;
  try {
    persisted = await input.eventStore.append(event);
  } catch (error) {
    // transcript 已改、event append 失败：补偿回原始文本，避免 renderer 失败 ACK
    // 与半提交持久事实相反；补偿本身失败则聚合抛出。
    try {
      await input.editAssistantMessageText({
        messageId: input.messageId,
        newText: originalText,
      });
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "assistant message edit event append failed and transcript rollback failed",
      );
    }
    throw error;
  }

  try {
    input.onPersistedEvent(persisted);
  } catch (error) {
    // event 已 durable 后不能再给 renderer 失败 ACK；live projection 失败留给
    // resync/hydration 收敛，只走诊断回调。
    input.onLiveProjectionError?.(error);
  }
}
