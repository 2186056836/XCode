import { existsSync, readFileSync } from "node:fs";
import type {
  XCodeAgentMcpServer,
  XCodeSessionImportHistory,
  XCodeSessionImportMessage,
  XCodeSessionStateSnapshot,
} from "@zcode/shared";
import {
  getLegacyDeletedTaskSessionSnapshotPath,
  getLegacyTaskSessionSnapshotPath,
} from "#src/paths.js";
import { buildImportedClaudeTaskId } from "#src/session/claude-native/buildImportedClaudeTaskFile.js";
import { claudeNativeSessionImportRepo } from "#src/session/claude-native/claudeNativeSessionImportRepo.js";
import { parseClaudeNativeSessionFile } from "#src/session/claude-native/claudeNativeSessionImportParser.js";
import { safeParseLegacyTaskSessionFile } from "#src/session/legacyTaskSessionFile.js";

export interface ImportedClaudeHistoryRepairTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export interface ImportedClaudeHistoryRepairResult {
  // fork 保留：上游 1010 删掉了 traceId，但 fork 的 zcodeTaskServiceAdapter 仍以
  // `history.traceId ?? createSessionTraceId()` 恢复会话 trace。删除会导致 TS2339。
  traceId?: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  messages: XCodeSessionImportMessage[];
  source: "legacySnapshot" | "nativeJsonl";
}

export interface ImportedClaudeSessionRepairTarget extends ImportedClaudeHistoryRepairTarget {
  mcpServers?: XCodeAgentMcpServer[];
}

export interface ImportedClaudeSessionRepairCreateParams {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  mode: XCodeSessionStateSnapshot["session"]["mode"];
  model: XCodeSessionStateSnapshot["settings"]["model"]["current"];
  thoughtLevel?: string;
  persistence: "immediate";
  mcpServers?: XCodeAgentMcpServer[];
  importedHistory: XCodeSessionImportHistory;
}

function toImportMessages(
  messages: readonly { role: string; content: string; timestamp?: number }[],
): XCodeSessionImportMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      timestamp: message.timestamp,
    }));
}

function countAssistantMessages(messages: readonly XCodeSessionImportMessage[]): number {
  return messages.filter((message) => message.role === "assistant").length;
}

export function shouldRepairImportedClaudeSnapshot(
  snapshot: Pick<XCodeSessionStateSnapshot, "messages" | "runtime" | "session">,
): boolean {
  if (snapshot.session.status === "running" || snapshot.runtime.activeTurnId) {
    return false;
  }
  const hasLegacyFixedMessageIds = snapshot.messages.some((message) =>
    /^msg_import_\d+$/u.test(message.info.messageId),
  );
  if (!snapshot.session.sessionId.startsWith("claude-import-") && !hasLegacyFixedMessageIds) {
    // user-only / assistant-first 只是异常形态，不等于 Claude 导入。
    // 只有稳定导入 taskId 或旧版全局 msg_import_* 污染能证明它属于迁移修复边界，
    // 避免普通 XCode session 被同名 legacy 备份误回填成 Claude 历史。
    return false;
  }
  const hasAssistant = snapshot.messages.some((message) => message.info.role === "assistant");
  if (!hasAssistant) {
    return true;
  }
  if (snapshot.messages[0]?.info.role === "assistant") {
    return true;
  }
  // 旧协议导入把所有 Claude session 都写成 msg_import_0/msg_import_1。
  // 这些 ID 是全局主键，后续导入会把前一个 session 的消息改绑到新 session，
  // 即使当前快照里有 assistant，也必须按原 Claude jsonl 重新回填，修正串会话和反序。
  return hasLegacyFixedMessageIds;
}

// fork 保留 export：上游 1010 已将其收为模块私有，但 fork 的 zcodeTaskServiceAdapter.ts 仍按
// 具名导入使用（await 非 Promise 值在运行时安全）。删除 export 会导致 TS2459。
export function readLegacyImportedClaudeHistory(
  target: ImportedClaudeHistoryRepairTarget,
): ImportedClaudeHistoryRepairResult | null {
  const snapshotPath = [
    getLegacyTaskSessionSnapshotPath(
      target.workspacePath,
      target.taskId,
      target.workspaceIdentity,
    ),
    getLegacyDeletedTaskSessionSnapshotPath(
      target.workspacePath,
      target.taskId,
      target.workspaceIdentity,
    ),
  ].find((path) => existsSync(path));
  if (!snapshotPath) {
    return null;
  }

  const parsed = safeParseLegacyTaskSessionFile(
    JSON.parse(readFileSync(snapshotPath, "utf-8")) as unknown,
  );
  if (!parsed.success || parsed.data.meta.migrationSource !== "claudeCode") {
    return null;
  }
  const messages = toImportMessages(parsed.data.messages);
  return messages.length > 0
    ? {
        title: parsed.data.meta.title,
        createdAt: parsed.data.meta.createdAt,
        updatedAt: parsed.data.meta.updatedAt,
        messages,
        source: "legacySnapshot",
      }
    : null;
}

async function readNativeImportedClaudeHistory(
  target: ImportedClaudeHistoryRepairTarget,
): Promise<ImportedClaudeHistoryRepairResult | null> {
  const candidates = await claudeNativeSessionImportRepo.scanImportableSessions({
    workspacePath: target.workspacePath,
  });
  const candidate = candidates.find(
    (item) => buildImportedClaudeTaskId(item.workspacePath, item.sessionId) === target.taskId,
  );
  if (!candidate) {
    return null;
  }

  const importedSource = await parseClaudeNativeSessionFile({
    filePath: candidate.sourcePath,
    workspacePath: candidate.workspacePath,
    sessionId: candidate.sessionId,
    sourcePath: candidate.sourcePath,
    fallbackCreatedAt: candidate.createdAt,
    fallbackUpdatedAt: candidate.updatedAt,
  });
  const messages = toImportMessages(importedSource.messages);
  return messages.length > 0
    ? {
        title: importedSource.title,
        createdAt: importedSource.createdAt,
        updatedAt: importedSource.updatedAt,
        messages,
        source: "nativeJsonl",
      }
    : null;
}

export async function resolveImportedClaudeHistoryForRepair(
  target: ImportedClaudeHistoryRepairTarget,
): Promise<ImportedClaudeHistoryRepairResult | null> {
  const legacyHistory = readLegacyImportedClaudeHistory(target);
  if (legacyHistory && countAssistantMessages(legacyHistory.messages) > 0) {
    return legacyHistory;
  }

  const nativeHistory = await readNativeImportedClaudeHistory(target);
  if (
    nativeHistory &&
    countAssistantMessages(nativeHistory.messages) >= countAssistantMessages(legacyHistory?.messages ?? [])
  ) {
    // 旧版本可能已经把 user-only 的 legacy 备份写坏了。
    // 这时 legacy 不能再作为权威来源，需要按 taskId 反查原 Claude jsonl 重建 assistant。
    return nativeHistory;
  }

  return legacyHistory;
}

export async function repairImportedClaudeSessionSnapshot<T>(params: {
  snapshot: XCodeSessionStateSnapshot;
  target: ImportedClaudeSessionRepairTarget;
  createSession(input: ImportedClaudeSessionRepairCreateParams): Promise<T>;
  onRepair?(history: ImportedClaudeHistoryRepairResult): void;
}): Promise<T | null> {
  if (!shouldRepairImportedClaudeSnapshot(params.snapshot)) {
    return null;
  }
  const history = await resolveImportedClaudeHistoryForRepair(params.target);
  if (!history) {
    return null;
  }

  params.onRepair?.(history);
  // 早期导入可能已经创建了真实 XCode session，但没有把 Claude 历史写入
  // zcode-cli sessionStore，或用了全局 msg_import_* 导致串会话。这里统一用同名 sessionId
  // 幂等回填 importedHistory，让 session/read、task snapshot 和远控恢复路径走同一套修复。
  return params.createSession({
    workspacePath: params.target.workspacePath,
    workspaceIdentity: params.target.workspaceIdentity,
    sessionId: params.target.taskId,
    mode: params.snapshot.session.mode,
    model: params.snapshot.settings.model.current,
    thoughtLevel: params.snapshot.settings.thoughtLevel.current,
    persistence: "immediate",
    mcpServers: params.target.mcpServers,
    importedHistory: {
      source: "claudeCode",
      title: history.title,
      createdAt: history.createdAt,
      updatedAt: history.updatedAt,
      messages: history.messages,
    },
  });
}
