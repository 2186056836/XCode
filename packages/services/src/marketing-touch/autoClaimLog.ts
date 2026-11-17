import { createServiceLogger } from "../logger/serviceLogger.js";

/**
 * 自动签到 / 自动领取的本地日志（「最近活动」记录）。
 *
 * 每条记录是一次调度器动作（签到成功 / 已领过跳过 / 验证码跳过 / 失败），
 * 供设置页展示「上次自动处理时间 + 结果」，也方便排查「为什么没领」。
 *
 * 存储：`automation:activity:log`（credentialService 加密通道，node.ts 注入）。
 * 每账号每类型只保留最近一条 + 全局保留最近 200 条，防止无限增长。
 */

export type AutoActivityKind = "auto-checkin" | "auto-claim";

export type AutoActivityStatus =
  | "claimed" // 领取/签到成功
  | "already" // 已领过（名下计划已有 / 当天已签）
  | "no-campaign" // 无可领取投放（视为当天完成）
  | "captcha-skipped" // 要求滑块验证码，跳过
  | "failed"; // 尝试了但失败（下个 tick 重试）

export interface AutoActivityRecord {
  /** `${kind}:${accountRef}` 唯一定位一条最新记录。 */
  id: string;
  kind: AutoActivityKind;
  accountRef: string;
  status: AutoActivityStatus;
  /** 失败原因 / 跳过原因（仅 failed / captcha-skipped）。 */
  message?: string;
  /** 动作发生的本地时间（ISO 字符串）。 */
  at: string;
}

export interface AutoActivitySnapshot {
  records: AutoActivityRecord[];
}

const LOG_STORE_KEY = "automation:activity:log";
const GLOBAL_LIMIT = 200;

let logStore: {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
} | null = null;
let recordsCache: AutoActivityRecord[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

function logger() {
  return createServiceLogger("auto-activity");
}

export function setAutoActivityLogStore(store: {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
} | null): void {
  logStore = store;
  recordsCache = null;
}

async function loadRecords(): Promise<AutoActivityRecord[]> {
  if (recordsCache) return recordsCache;
  if (!logStore) {
    recordsCache = [];
    return recordsCache;
  }
  try {
    const raw = await logStore.load(LOG_STORE_KEY);
    if (!raw) {
      recordsCache = [];
      return recordsCache;
    }
    const parsed = JSON.parse(raw) as AutoActivityRecord[];
    recordsCache = Array.isArray(parsed)
      ? parsed.filter(
          (record) =>
            record &&
            typeof record === "object" &&
            typeof record.id === "string" &&
            typeof record.at === "string",
        )
      : [];
    return recordsCache;
  } catch (error) {
    logger().warn(undefined, "自动活动日志读取失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    recordsCache = [];
    return recordsCache;
  }
}

function persistRecords(records: AutoActivityRecord[]): Promise<void> {
  recordsCache = records;
  if (!logStore) return Promise.resolve();
  const operation = writeChain.then(async () => {
    try {
      await logStore?.save(LOG_STORE_KEY, JSON.stringify(records));
    } catch (error) {
      logger().warn(undefined, "自动活动日志写入失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  writeChain = operation;
  return operation;
}

/**
 * 记录一次自动动作。同 id（kind + accountRef）覆盖旧记录，
 * 全局列表按时间倒序截断到 GLOBAL_LIMIT。写失败不抛（日志不能阻断领取链路）。
 */
export async function recordAutoActivity(input: {
  kind: AutoActivityKind;
  accountRef: string;
  status: AutoActivityStatus;
  message?: string;
  now?: Date;
}): Promise<void> {
  const record: AutoActivityRecord = {
    id: `${input.kind}:${input.accountRef}`,
    kind: input.kind,
    accountRef: input.accountRef,
    status: input.status,
    ...(input.message ? { message: input.message } : {}),
    at: (input.now ?? new Date()).toISOString(),
  };
  const records = await loadRecords();
  const next = [record, ...records.filter((item) => item.id !== record.id)].slice(
    0,
    GLOBAL_LIMIT,
  );
  await persistRecords(next);
}

/** 读日志（新→旧）。可选按 kind 过滤。 */
export async function listAutoActivity(
  kind?: AutoActivityKind,
): Promise<AutoActivityRecord[]> {
  const records = await loadRecords();
  return kind ? records.filter((record) => record.kind === kind) : records;
}
