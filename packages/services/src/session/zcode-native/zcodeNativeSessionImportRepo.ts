import type { SQLInputValue } from "node:sqlite";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";
import type { XCodeImportableSessionCandidate } from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { getDataBaseDir, getXCodeDataRootDir } from "#src/paths.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const logger = createServiceLogger("zcode-native-import");

/** 选择性导入按会话复制的表；session 按主键 id，其余按 session_id 归属列。 */
const SESSION_SCOPED_TABLES: ReadonlyArray<{ table: string; keyColumn: string }> = [
  { table: "session", keyColumn: "id" },
  { table: "message", keyColumn: "session_id" },
  { table: "part", keyColumn: "session_id" },
  { table: "session_entry", keyColumn: "session_id" },
  { table: "session_input", keyColumn: "session_id" },
  { table: "session_target", keyColumn: "session_id" },
  { table: "todo", keyColumn: "session_id" },
  { table: "input_history", keyColumn: "session_id" },
  { table: "model_usage", keyColumn: "session_id" },
  { table: "turn_usage", keyColumn: "session_id" },
  { table: "tool_usage", keyColumn: "session_id" },
];

/** 单批行数：控制在内存峰值，同时让事件轮能在大会话复制间隙里得到喘息。 */
const COPY_CHUNK_ROWS = 400;

export interface ZcodeSessionRow {
  id: string;
  directory: string | null;
  path: string | null;
  title: string | null;
  trace_id: string | null;
  time_created: number;
  time_updated: number;
  task_type: string | null;
}

function normalizePathForComparison(path: string): string {
  const normalized = normalize(resolve(path));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSameOrInsidePath(candidate: string, parent: string): boolean {
  const target = normalizePathForComparison(candidate);
  const base = normalizePathForComparison(parent);
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

/** 与 Claude 导入同源的多候选根：真实 HOME、显式环境变量、自定义数据目录。 */
export function getZcodeHomeRoots(): string[] {
  const homes = new Set<string>();
  homes.add(homedir());
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  if (envHome) {
    homes.add(envHome);
  }
  const dataBaseDir = getDataBaseDir();
  if (dataBaseDir) {
    homes.add(dataBaseDir);
  }
  return [...homes];
}

export function getSourceZcodeSessionDbPath(): string | null {
  for (const homePath of getZcodeHomeRoots()) {
    const candidate = join(homePath, ".zcode", "cli", "db", "db.sqlite");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getDestZcodeSessionDbPath(): string {
  // 目标会话库由 CLI 运行时创建；导入只写已存在的库，绝不整库覆盖或新建空库。
  return join(getXCodeDataRootDir(), "cli", "db", "db.sqlite");
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function hasTable(db: DatabaseSyncInstance, table: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(table);
  return row !== undefined;
}

function tableColumns(db: DatabaseSyncInstance, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
    name: string;
  }>).map((column) => column.name);
}

export function openSourceZcodeDb(): DatabaseSyncInstance | null {
  const sourcePath = getSourceZcodeSessionDbPath();
  if (!sourcePath) {
    return null;
  }
  try {
    // 只读打开 GB 级源库：不创建 -wal/-shm，不阻塞原版 ZCode 继续写自己的库。
    return new DatabaseSync(sourcePath, { readOnly: true });
  } catch (error) {
    logger.warn(undefined, `打开 ZCode 会话库失败 path=${sourcePath}`, error);
    return null;
  }
}

export function openDestZcodeDbForWrite(): DatabaseSyncInstance | null {
  const destPath = getDestZcodeSessionDbPath();
  if (!existsSync(destPath)) {
    return null;
  }
  const db = new DatabaseSync(destPath);
  // 目标库同时被各 workspace 的 agent 进程读写（WAL 多连接），写入冲突用超时等待而不是报错。
  db.exec("PRAGMA busy_timeout = 15000");
  return db;
}

export function destDbHasSessionTable(db: DatabaseSyncInstance): boolean {
  return hasTable(db, "session");
}

export function scanImportableZcodeSessions(params: {
  workspacePath?: string;
  modifiedSince?: number;
  limit?: number;
}): XCodeImportableSessionCandidate[] {
  const sourcePath = getSourceZcodeSessionDbPath();
  if (!sourcePath) {
    return [];
  }
  const db = openSourceZcodeDb();
  if (!db) {
    return [];
  }
  try {
    if (!hasTable(db, "session")) {
      return [];
    }
    const rows = db
      .prepare(
        `SELECT id, directory, path, title, time_created, time_updated, task_type
         FROM session
         WHERE task_type IS NOT 'subagent_child'
         ORDER BY time_updated DESC`,
      )
      .all() as Array<{
      id: string;
      directory: string | null;
      path: string | null;
      title: string | null;
      time_created: number;
      time_updated: number;
    }>;
    const workspaceFilter = params.workspacePath?.trim();
    const candidates: XCodeImportableSessionCandidate[] = [];
    for (const row of rows) {
      const workspacePath = row.directory?.trim() || row.path?.trim() || "";
      if (workspaceFilter && !isSameOrInsidePath(workspacePath, workspaceFilter)) {
        continue;
      }
      if (
        params.modifiedSince !== undefined &&
        Number.isFinite(params.modifiedSince) &&
        row.time_updated < params.modifiedSince
      ) {
        continue;
      }
      candidates.push({
        provider: "zcode",
        sessionId: row.id,
        workspacePath,
        sourcePath,
        updatedAt: row.time_updated,
        createdAt: row.time_created,
        ...(row.title ? { previewTitle: row.title } : {}),
      });
      if (params.limit !== undefined && candidates.length >= params.limit) {
        break;
      }
    }
    return candidates;
  } finally {
    try {
      db.close();
    } catch {
      // 只读句柄关闭失败无需处理。
    }
  }
}

export function findZcodeSessionRow(db: DatabaseSyncInstance, sessionId: string): ZcodeSessionRow | null {
  const row = db
    .prepare(
      `SELECT id, directory, path, title, trace_id, time_created, time_updated, task_type
       FROM session WHERE id = ?`,
    )
    .get(sessionId) as ZcodeSessionRow | undefined;
  return row ?? null;
}

export function sessionExistsInDest(db: DatabaseSyncInstance, sessionId: string): boolean {
  if (!hasTable(db, "session")) {
    return false;
  }
  return db.prepare("SELECT 1 FROM session WHERE id = ? LIMIT 1").get(sessionId) !== undefined;
}

/**
 * 删除目标库中该会话的归属行。tasks-index 与会话库是两个库，索引写入失败时
 * 用它回滚已复制的行，保证「失败=无残留」，重新导入不会被 already_imported 卡成半态。
 */
export function deleteZcodeSessionRowsFromDest(db: DatabaseSyncInstance, sessionId: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { table, keyColumn } of SESSION_SCOPED_TABLES) {
      if (!hasTable(db, table)) {
        continue;
      }
      db.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(keyColumn)} = ?`).run(sessionId);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 回滚失败交由上层记录。
    }
    throw error;
  }
}

/**
 * 把单个会话的归属行逐表复制进目标库。
 *
 * 锁策略：目标库同时有运行中实例的 agent 进程持续写入（会话行/usage 等）。
 * 若整会话一个大事务长期持有写锁，双方会在 busy_timeout 上互相耗尽报
 * `database is locked`，因此每批 COPY_CHUNK_ROWS 行包一个短事务，批间释放写锁
 * 让 agent 的写入插队。INSERT OR IGNORE + 行主键保证跨批/重试整体幂等；
 * 中途失败由上层 deleteZcodeSessionRowsFromDest 清掉已落库的半截行。
 */
export async function copyZcodeSessionRows(params: {
  source: DatabaseSyncInstance;
  dest: DatabaseSyncInstance;
  sessionId: string;
  yieldBetweenBatches: () => Promise<void>;
}): Promise<number> {
  let copied = 0;
  for (const { table, keyColumn } of SESSION_SCOPED_TABLES) {
    if (!hasTable(params.source, table) || !hasTable(params.dest, table)) {
      continue;
    }
    const sourceColumns = tableColumns(params.source, table);
    const destColumns = new Set(tableColumns(params.dest, table));
    const columns = sourceColumns.filter((column) => destColumns.has(column));
    if (columns.length === 0) {
      continue;
    }
    const columnList = columns.map(quoteIdentifier).join(", ");
    const select = params.source.prepare(
      `SELECT ${columnList} FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(keyColumn)} = ?`,
    );
    const insert = params.dest.prepare(
      `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${columnList}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
    );
    const insertBatch = (rows: Array<Record<string, unknown>>) => {
      params.dest.exec("BEGIN IMMEDIATE");
      try {
        for (const item of rows) {
          insert.run(...columns.map((column) => (item[column] ?? null) as SQLInputValue));
        }
        params.dest.exec("COMMIT");
      } catch (error) {
        try {
          params.dest.exec("ROLLBACK");
        } catch {
          // 回滚失败交由上层清理。
        }
        throw error;
      }
      copied += rows.length;
    };
    let chunk: Array<Record<string, unknown>> = [];
    for (const row of select.iterate(params.sessionId) as Iterable<Record<string, unknown>>) {
      chunk.push(row);
      if (chunk.length < COPY_CHUNK_ROWS) {
        continue;
      }
      insertBatch(chunk);
      chunk = [];
      await params.yieldBetweenBatches();
    }
    if (chunk.length > 0) {
      insertBatch(chunk);
    }
  }
  return copied;
}
