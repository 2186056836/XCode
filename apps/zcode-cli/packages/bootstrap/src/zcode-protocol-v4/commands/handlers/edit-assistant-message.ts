import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
} from "@zcode/shared/zcode-protocol-v4";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";
import { V4RowTranslationError } from "./fork-edit-retry.js";

async function editAssistantMessage(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["editAssistantMessage"];
  const record = requireRecord(host, envelope.sessionId);
  const resolution = host.resolveRowActionTarget?.(
    record.app.sessionId,
    payload.target,
    "editAssistantMessage",
  );
  if (!resolution?.ok || !resolution.messageId || resolution.row.kind !== "assistantText") {
    throw new V4RowTranslationError("editAssistantMessage", payload.target.rowId);
  }
  if (!host.editAssistantMessage) {
    throw new Error("fault.command.assistantEditUnsupported");
  }
  await host.editAssistantMessage(record.app.sessionId, {
    entityId: payload.target.entityId,
    messageId: resolution.messageId,
    newText: payload.newText,
  });
  return undefined;
}

export const assistantMessageEditHandlers = { editAssistantMessage };
