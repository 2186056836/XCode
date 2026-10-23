import { createServiceLogger } from "../logger/serviceLogger.js";
import { listQoderAccounts } from "./qoderAuth.js";
import { qoderCheckinAccount, qoderCheckinStats, type QoderCheckinRegion } from "./qoderCheckin.js";

/**
 * XCode fork：Qoder 每账号自动签到（开关 + 时间）与定时调度。
 *
 * 与 `codebuddyAutoCheckin` 同构（同一套语义：每账号独立开关 + HH:MM、本地记
 * 「当天已领取」防重启/多实例重复、失败不记日期等下一 tick 补跑），差异只在
 * 账号来源、签到接口与「已领取」的判定词：
 *
 *   - CodeBuddy 的签到结果是 `claimed` / `already`；
 *   - Qoder 是 `claimed` / `already_claimed`，另外还有 `no_campaign`（活动未开启，
 *     不是失败，当天不该反复重试）。
 *
 * 设置持久化：`qoder:checkin:settings`（credentialService 加密通道，node.ts 注入），
 * 与签到历史同一存储后端。删除账号后其设置成为孤儿条目，读取时按当前账号列表过滤。
 */

export type QoderAutoCheckinRegion = QoderCheckinRegion;

/** 分钟级时间选项（半点粒度，与 CodeBuddy 侧保持一致）。 */
export const QODER_AUTO_CHECKIN_MINUTE_OPTIONS = [0, 30] as const;

export const QODER_DEFAULT_AUTO_CHECKIN_TIME = "09:00";

/** 24 小时 HH:MM（刻意严格：坏时间要么永不触发要么意外触发，都比拒绝输入更糟）。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidQoderAutoCheckinTime = (value: unknown): boolean =>
  typeof value === "string" && TIME_PATTERN.test(value.trim());

export interface QoderAutoCheckinSettings {
  enabled: boolean;
  /** HH:MM。 */
  time: string;
}

interface PersistedAutoCheckinSettingsLike {
  enabled?: boolean | string;
  time?: string;
}

function readTime(settings: Partial<PersistedAutoCheckinSettingsLike> | undefined): string {
  const value = settings?.time;
  return typeof value === "string" && isValidQoderAutoCheckinTime(value)
    ? value.trim()
    : QODER_DEFAULT_AUTO_CHECKIN_TIME;
}

function readEnabled(settings: Partial<PersistedAutoCheckinSettingsLike> | undefined): boolean {
  // 手改存储可能写成 "true"/"false"/1：只认明确的真值，其余一律关闭。
  return settings?.enabled === true || settings?.enabled === "true" || settings?.enabled === "1";
}

export function getQoderAutoCheckinSettings(
  settings: Partial<PersistedAutoCheckinSettingsLike> | undefined,
): QoderAutoCheckinSettings {
  return { enabled: readEnabled(settings), time: readTime(settings) };
}

type QoderAutoCheckinSettingsMap = Record<string, QoderAutoCheckinSettings>;

const SETTINGS_STORE_KEY = "qoder:checkin:settings";

/** 与签到历史共用同一 credentialService 加密后端，保持装配单一入口。 */
let settingsStoreLoad: ((key: string) => Promise<string | null>) | null = null;
let settingsStoreSave: ((key: string, value: string) => Promise<void>) | null = null;
let settingsCache: QoderAutoCheckinSettingsMap | null = null;
/** 串行化写，避免并发更新互相覆盖。 */
let settingsWriteChain: Promise<void> = Promise.resolve();

function logger() {
  return createServiceLogger("qoder-auto-checkin");
}

export function setQoderAutoCheckinSettingsStore(store: {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
} | null): void {
  settingsStoreLoad = store?.load ?? null;
  settingsStoreSave = store?.save ?? null;
  settingsCache = null;
}

async function loadSettingsMap(): Promise<QoderAutoCheckinSettingsMap> {
  if (settingsCache) return settingsCache;
  const empty: QoderAutoCheckinSettingsMap = {};
  if (!settingsStoreLoad) {
    settingsCache = empty;
    return empty;
  }
  try {
    const raw = await settingsStoreLoad(SETTINGS_STORE_KEY);
    if (!raw) {
      settingsCache = empty;
      return empty;
    }
    const parsed = JSON.parse(raw) as QoderAutoCheckinSettingsMap;
    const normalized: QoderAutoCheckinSettingsMap = {};
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (!value || typeof value !== "object") continue;
      normalized[key] = getQoderAutoCheckinSettings(value);
    }
    settingsCache = normalized;
    return normalized;
  } catch (error) {
    logger().warn(undefined, "Qoder 自动签到设置读取失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    settingsCache = empty;
    return empty;
  }
}

function saveSettingsMap(map: QoderAutoCheckinSettingsMap): Promise<void> {
  settingsCache = map;
  if (!settingsStoreSave) return Promise.resolve();
  const operation = settingsWriteChain.then(async () => {
    try {
      await settingsStoreSave?.(SETTINGS_STORE_KEY, JSON.stringify(map));
    } catch (error) {
      logger().warn(undefined, "Qoder 自动签到设置写入失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  settingsWriteChain = operation;
  return operation;
}

function settingsKeyOf(region: QoderAutoCheckinRegion, accountId: string): string {
  return `${region}:${accountId}`;
}

/** 列出某区域全部账号的自动签到设置（只读当前账号列表，孤儿条目不返回）。 */
export async function listQoderAutoCheckinSettings(
  region: QoderAutoCheckinRegion,
): Promise<Array<{ accountId: string; accountName: string } & QoderAutoCheckinSettings>> {
  const [map, { accounts }] = await Promise.all([loadSettingsMap(), listQoderAccounts(region)]);
  return accounts.map((account) => ({
    accountId: account.id,
    accountName: account.displayName || account.id,
    ...getQoderAutoCheckinSettings(map[settingsKeyOf(region, account.id)]),
  }));
}

/**
 * 更新某账号的自动签到设置（局部更新）。
 *
 * 时间先校验再落盘：被拒绝的请求不留下半更新的设置。
 */
export async function updateQoderAutoCheckinSettings(
  region: QoderAutoCheckinRegion,
  accountId: string,
  update: { enabled?: unknown; time?: unknown },
): Promise<QoderAutoCheckinSettings> {
  const map = await loadSettingsMap();
  const key = settingsKeyOf(region, accountId);
  const current = getQoderAutoCheckinSettings(map[key]);
  let time = current.time;
  if (update.time !== undefined) {
    if (!isValidQoderAutoCheckinTime(update.time)) {
      throw new Error("Invalid auto check-in time, expected HH:MM");
    }
    time = String(update.time).trim();
  }
  const enabled = update.enabled === undefined ? current.enabled : Boolean(update.enabled);
  const next: QoderAutoCheckinSettings = { enabled, time };
  map[key] = next;
  await saveSettingsMap(map);
  return next;
}

// ---------------------------------------------------------------------------
// 调度器
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 30 * 60 * 1000;
const START_DELAY_MS = 10 * 1000;
const MAX_PER_TICK = 4;

interface QoderAutoCheckinSchedulerState {
  timer: ReturnType<typeof setInterval>;
  ticking: boolean;
}

const globalSchedulerState = globalThis as typeof globalThis & {
  __xcodeQoderAutoCheckin__?: QoderAutoCheckinSchedulerState;
};

/** 本地 YYYY-MM-DD，用于记住「当天窗口已领取」。 */
const localDateKey = (now: Date): string => {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * 配置时间（如 09:00 / 09:30）到 now 是否已到。
 *
 * 按「当天第几分钟」比较而非字符串比较：tick 迟到（09:30 的 tick 覆盖 09:00
 * 的档期）仍然生效——这正是漏跑后下一 tick 自动补跑的关键。
 */
const isSlotDue = ({ now, time }: { now: Date; time: string }): boolean => {
  const [slotHours = "0", slotMinutes = "0"] = time.split(":");
  const slotTotal = Number(slotHours) * 60 + Number(slotMinutes);
  return now.getHours() * 60 + now.getMinutes() >= slotTotal;
};

/** 该账号今天是否已在本地签到历史里记过领取。 */
async function claimedLocally(
  region: QoderAutoCheckinRegion,
  accountId: string,
  today: string,
): Promise<boolean> {
  try {
    const stats = await qoderCheckinStats(region, accountId);
    // recent 按新→旧排列，第一条就是最后一次领取日；等于今天即视为已领。
    return stats.recent[0]?.date === today;
  } catch {
    // 读不到本地历史时按「未领取」处理：宁可多试一次（上游会把重复领取当
    // already_claimed），也不要因为本账本损坏而整天不签到。
    return false;
  }
}

/**
 * 跑一次扫描：每个「开关打开 + 档期已到 + 当天未在本地记领取」的账号签到一次。
 */
export const runQoderAutoCheckinTick = async (now: Date = new Date()): Promise<string[]> => {
  const regions: readonly QoderAutoCheckinRegion[] = ["cn", "intl"];
  const today = localDateKey(now);
  const due: Array<{ region: QoderAutoCheckinRegion; accountId: string }> = [];

  for (const region of regions) {
    let accounts: Awaited<ReturnType<typeof listQoderAccounts>>["accounts"] = [];
    try {
      accounts = (await listQoderAccounts(region)).accounts;
    } catch (error) {
      logger().warn(undefined, "Qoder 自动签到读取账号列表失败", {
        region,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const map = await loadSettingsMap();
    for (const account of accounts) {
      const settings = getQoderAutoCheckinSettings(map[settingsKeyOf(region, account.id)]);
      if (!settings.enabled) continue;
      if (await claimedLocally(region, account.id, today)) continue;
      if (!isSlotDue({ now, time: settings.time })) continue;
      due.push({ region, accountId: account.id });
      if (due.length >= MAX_PER_TICK) break;
    }
    if (due.length >= MAX_PER_TICK) break;
  }

  const checkedIn: string[] = [];
  for (const target of due) {
    try {
      const result = await qoderCheckinAccount(target.region, target.accountId);
      // no_campaign = 活动没开，不是失败但今天也不必反复试；记进结果让调用方可见。
      const succeeded =
        result.status === "claimed" ||
        result.status === "already_claimed" ||
        result.status === "no_campaign";
      if (!succeeded) {
        logger().warn(undefined, "Qoder 自动签到未成功", {
          region: target.region,
          accountId: target.accountId,
          status: result.status,
          message: result.message,
        });
        continue;
      }
      checkedIn.push(`${target.region}:${target.accountId}`);
    } catch (error) {
      logger().warn(undefined, "Qoder 自动签到失败", {
        region: target.region,
        accountId: target.accountId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return checkedIn;
};

/**
 * 启动调度（进程内单例 interval）。
 *
 * globalThis 守卫：host 模块可能被多次求值（多处 import / HMR），每次求值
 * 都加一个 interval 会重复签到。timer unref，不独自保活进程。
 */
export const startQoderAutoCheckinScheduler = (): void => {
  if (globalSchedulerState.__xcodeQoderAutoCheckin__) return;
  const state: QoderAutoCheckinSchedulerState = {
    ticking: false,
    timer: setInterval(() => {
      if (state.ticking) return;
      state.ticking = true;
      void runQoderAutoCheckinTick()
        .catch((error) => {
          logger().warn(undefined, "Qoder 自动签到 tick 失败", {
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          state.ticking = false;
        });
    }, TICK_INTERVAL_MS),
  };
  state.timer.unref?.();
  globalSchedulerState.__xcodeQoderAutoCheckin__ = state;

  setTimeout(() => {
    void runQoderAutoCheckinTick().catch((error) => {
      logger().warn(undefined, "Qoder 自动签到首扫失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, START_DELAY_MS).unref?.();
};

/** 停止调度（测试/热重载缝）。 */
export const stopQoderAutoCheckinScheduler = (): void => {
  const state = globalSchedulerState.__xcodeQoderAutoCheckin__;
  if (!state) return;
  clearInterval(state.timer);
  delete globalSchedulerState.__xcodeQoderAutoCheckin__;
};
