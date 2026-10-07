/**
 * 后台任务注册表（文件迁移、会话导入等统一使用）
 *
 * 设计：
 * - 按 name 注册/查询最新任务；进程内内存状态 + v2/zcode-migration-jobs.json 持久化最后完成结果。
 * - 启动时自动 hydrate last completed tasks（供用户重启应用后还能看到之前的结果）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAppConfigDir } from "../paths.js";

const CACHE_FILE = join(getAppConfigDir(), "zcode-migration-jobs.json");

export interface JobSnapshot<T = unknown> {
  name: string;
  running: boolean;
  startedAt: number;
  finishedAt?: number;
  progress?: number;        // 已处理数/总进度（可选，0~1 或具体 count）
  total?: number;           // 总量提示（可选）
  result?: T;               // 成功时的结果
  error?: string;           // 失败原因
}

// 内存缓存：<name, snapshot>，仅维护当前运行的快照 + 最近完成的快照
const latestByNamed: Map<string, JobSnapshot> = new Map();

// 从本地 JSON 加载（启动时调用一次），不覆盖 running=true 的任务
function hydrateFromDisk(): void {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    const data: Record<string, JobSnapshot> = JSON.parse(raw);
    for (const [name, snap] of Object.entries(data)) {
      if (!snap.running) {
        // 只补全已完成/已失败的任务
        latestByNamed.set(name, snap);
      }
    }
  } catch {
    // 文件不存在/损坏忽略（首次运行或文件被删都是正常情况）
  }
}

/**
 * 获取最新快照（如果没有返回 null）
 */
export function getJobSnapshot<T>(name: string): JobSnapshot | null {
  return latestByNamed.get(name) ?? null;
}

/**
 * 启动一个后台任务（executor 在后台运行，UI 轮询 getJobSnapshot(name) 查看进度）
 */
export async function runBackgroundJob<T>(name: string, executor: (report?: (u:{progress?:number,total?:number})=>void)=>Promise<T>): Promise<JobSnapshot> {
  // 如果同名的已经正在跑，跳过并返回既有状态
  const existing = latestByNamed.get(name);
  if (existing && existing.running) {
    return existing;
  }
  const snapshot: JobSnapshot = { name, running:true, startedAt: Date.now() };
  latestByNamed.set(name, snapshot);
  try {
    const result = await executor((report) => {
      snapshot.progress = report?.progress;
      snapshot.total = report?.total;
    });
    snapshot.running = false;
    snapshot.finishedAt = Date.now();
    snapshot.result = result as any;
    snapshot.error = undefined;
    persistToDisk(name, snapshot);
  } catch (e: unknown) {
    snapshot.running = false;
    snapshot.finishedAt = Date.now();
    snapshot.result = undefined;
    snapshot.error = e instanceof Error ? e.message : String(e);
    persistToDisk(name, snapshot);
  }
  return snapshot;
}

function persistToDisk(name: string, snapshot: JobSnapshot): void {
  try {
    const data: Record<string, JobSnapshot> = {};
    for (const s of latestByNamed.values()) {
      if (!s.running) data[s.name] = s;
    }
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch {
    // 写盘失败不影响逻辑（用户下次登录再试）
  }
}

// 模块初始化时 hydrate（确保 host 重启后仍有上次完成的结果可见）
hydrateFromDisk();
