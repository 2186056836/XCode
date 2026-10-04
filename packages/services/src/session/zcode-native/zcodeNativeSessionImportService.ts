import { join } from "node:path";
import type { XCodeImportSessionsResult, XCodeTaskMeta } from "@zcode/shared";
import { generateTraceId, ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { getConversationWorkspaceDir } from "#src/paths.js";
import type { TaskIndexRepo } from "#src/session/taskIndexRepo.js";
import {
  copyZcodeSessionRows,
  deleteZcodeSessionRowsFromDest,
  destDbHasSessionTable,
  findZcodeSessionRow,
  getZcodeHomeRoots,
  isSameOrInsidePath,
  openDestZcodeDbForWrite,
  openSourceZcodeDb,
  sessionExistsInDest,
  type ZcodeSessionRow,
} from "#src/session/zcode-native/zcodeNativeSessionImportRepo.js";

const logger = createServiceLogger("zcode-native-import");

/**
 * ZCode 旧默认工作区（~/.zcode/workspace/default）里的会话归属 XCode 的共享会话工作区。
 * 其余真实项目目录原样保留；找不到 workspace 信息时落到 XCode 默认工作区。
 */
function mapZcodeWorkspacePath(raw: string | null): string {
  const path = raw?.trim();
  if (!path) {
    return getConversationWorkspaceDir();
  }
  for (const homePath of getZcodeHomeRoots()) {
    if (isSameOrInsidePath(path, join(homePath, ".zcode", "workspace", "default"))) {
      return getConversationWorkspaceDir();
    }
  }
  return path;
}

function buildZcodeTaskMeta(row: ZcodeSessionRow): XCodeTaskMeta {
  return {
    taskId: row.id,
    traceId: generateTraceId(row.id),
    title: row.title?.trim() || "New session",
    workspacePath: mapZcodeWorkspacePath(row.directory ?? row.path),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    mode: "build",
    // 侧栏 listTasks 按当前 runtime provider 过滤；导入的历史会话归属 XCode Agent
    // 才能进入默认任务列表（与 Claude 迁移走 agent 真实建会话的行为对齐）。
    provider: ZCODE_AGENT_PROVIDER,
    migrationSource: "zcodeSession",
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function markAllFailed(
  result: XCodeImportSessionsResult,
  sessionIds: readonly string[],
  reason: string,
): XCodeImportSessionsResult {
  for (const sessionId of sessionIds) {
    result.failed.push({ provider: "zcode", sessionId, reason });
  }
  return result;
}

/**
 * 逐条把选中的 ZCode 会话复制进当前 XCode 会话库。
 * 关键语义：只 INSERT、绝不整库覆盖；目标库已有同 id 会话时跳过，
 * 导入完成后把会话补进 tasks-index 并广播列表变更，让侧边栏即时可见。
 */
export async function importZcodeNativeSessions(params: {
  taskIndexRepo: TaskIndexRepo;
  sessionIds: string[];
  onTaskImported: (meta: XCodeTaskMeta) => void;
  /** 每个会话处理完回调一次（0 基索引 + 总数），供后台任务注册表上报进度。 */
  onProgress?: (processed: number, total: number) => void;
}): Promise<XCodeImportSessionsResult> {
  const normalizedSessionIds = [
    ...new Set(params.sessionIds.map((item) => item.trim()).filter(Boolean)),
  ];
  const result: XCodeImportSessionsResult = { imported: [], skipped: [], failed: [] };
  if (normalizedSessionIds.length === 0) {
    return result;
  }
  let processed = 0;

  logger.info(
    undefined,
    `开始导入 ZCode 会话 count=${normalizedSessionIds.length}`,
  );

  const source = openSourceZcodeDb();
  if (!source) {
    return markAllFailed(result, normalizedSessionIds, "zcode_db_missing");
  }
  let dest: ReturnType<typeof openDestZcodeDbForWrite> | null = null;
  try {
    dest = openDestZcodeDbForWrite();
    if (!dest) {
      return markAllFailed(result, normalizedSessionIds, "dest_db_missing");
    }
    if (!destDbHasSessionTable(dest)) {
      return markAllFailed(result, normalizedSessionIds, "dest_db_not_initialized");
    }

    for (const sessionId of normalizedSessionIds) {
      let rowsCopied = false;
      try {
        const row = findZcodeSessionRow(source, sessionId);
        if (!row) {
          result.skipped.push({ provider: "zcode", sessionId, reason: "session_not_found" });
          continue;
        }
        if (sessionExistsInDest(dest, sessionId)) {
          // 会话行已存在：此前的版本导入时未写 provider，侧栏 listTasks 按 provider 过滤会漏掉。
          // 已存在分支做一次幂等 index 修正（补齐 provider 等），修好才计入 imported；
          // 否则视为 already_imported 跳过。
          const indexMeta = await params.taskIndexRepo.getTaskMeta({
            taskId: sessionId,
            workspacePath: mapZcodeWorkspacePath(row.directory ?? row.path),
          });
          if (indexMeta?.provider === ZCODE_AGENT_PROVIDER) {
            result.skipped.push({ provider: "zcode", sessionId, reason: "already_imported" });
            continue;
          }
          const meta = await params.taskIndexRepo.syncTaskMeta({
            meta: buildZcodeTaskMeta(row),
            archived: false,
            deleted: false,
          });
          params.onTaskImported(meta);
          result.imported.push({
            provider: "zcode",
            sessionId,
            taskId: meta.taskId,
            workspacePath: meta.workspacePath,
          });
          continue;
        }
        const copiedRows = await copyZcodeSessionRows({
          source,
          dest,
          sessionId,
          yieldBetweenBatches: yieldToEventLoop,
        });
        rowsCopied = true;
        const meta = await params.taskIndexRepo.syncTaskMeta({
          meta: buildZcodeTaskMeta(row),
          archived: false,
          deleted: false,
        });
        params.onTaskImported(meta);
        result.imported.push({
          provider: "zcode",
          sessionId,
          taskId: meta.taskId,
          workspacePath: meta.workspacePath,
        });
        logger.info(
          undefined,
          `ZCode 会话导入成功 session=${sessionId} rows=${copiedRows} workspace=${meta.workspacePath}`,
        );
      } catch (error) {
        // 会话库与 tasks-index 是两个库、无法跨库事务：索引/广播阶段失败时回滚已复制的
        // 会话行，保证「失败=无残留」，重试不会被 already_imported 挡成列表不可见的半态。
        if (rowsCopied && dest) {
          try {
            deleteZcodeSessionRowsFromDest(dest, sessionId);
          } catch (cleanupError) {
            logger.warn(
              undefined,
              `ZCode 会话导入回滚失败 session=${sessionId}（重试可能命中 already_imported）`,
              cleanupError,
            );
          }
        }
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(undefined, `导入 ZCode 会话失败 session=${sessionId}`, error);
        result.failed.push({ provider: "zcode", sessionId, reason });
      } finally {
        // 每个会话（成功/跳过/失败）都推进一次进度，供后台任务轮询展示。
        processed += 1;
        params.onProgress?.(processed, normalizedSessionIds.length);
      }
    }
  } finally {
    try {
      source.close();
    } catch {
      // 忽略。
    }
    if (dest) {
      try {
        dest.close();
      } catch {
        // 忽略。
      }
    }
  }

  logger.info(
    undefined,
    `ZCode 会话导入完成 imported=${result.imported.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
  );
  return result;
}
