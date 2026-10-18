import { createServiceLogger } from "../logger/serviceLogger.js";
import { listCodeBuddyAccounts, type CodeBuddyRegion } from "./codebuddyAuth.js";
import {
  codebuddyCheckinAccount,
  codebuddyClaimedLocally,
  type CodeBuddyCheckinRegion,
} from "./codebuddyCheckin.js";

/**
 * XCode fork：CodeBuddy 每账号自动签到（开关 + 时间）与定时调度。
 *
 * 设计照搬 codebuddy2api 参考实现的 auto-checkin 三件套（settings / 写入 /
 * scheduler），按 XCode 的账号体系落地：
 *
 *   - 每账号独立开关 + 时间（HH:MM，分钟级选项 0/30）：同一实例可混管
 *     cn/intl 两区账号，各账号各按各的时间签到。
 *   - 「已领取当天」记本地（签到历史窗口日期），防止**重启**或**多实例**
 *     重复领取；失败**不记日期**，下一个 tick 自动补跑。
 *   - 同一 tick 内多实例竞争时，上游把重复领取当 already-claimed 而非
 *     error，因此竞争是安全的。
 *   - tick 内仍会先读一次上游状态：账号可能已被手动签到或被别的实例领掉，
 *     不信任本地账本就出发。
 *
 * 设置持久化：`codebuddy:checkin:settings`（credentialService 加密通道，
 * node.ts 注入），与账号列表/签到历史同一存储后端。删除账号后其设置成为
 * 孤儿条目，读取时按当前账号列表过滤，顺带清理。
 */

export type CodeBuddyAutoCheckinRegion = CodeBuddyRegion;

/** 分钟级时间选项（半点粒度，与参考实现的 AUTO_CHECKIN_MINUTE_OPTIONS 一致）。 */
export const AUTO_CHECKIN_MINUTE_OPTIONS = [0, 30] as const;

export const DEFAULT_AUTO_CHECKIN_TIME = "09:00";

/** 24 小时 HH:MM（刻意严格：坏时间要么永不触发要么意外触发，都比拒绝输入更糟）。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidAutoCheckinTime = (value: unknown): boolean =>
  typeof value === "string" && TIME_PATTERN.test(value.trim());

export interface CodeBuddyAutoCheckinSettings {
  enabled: boolean;
  /** HH:MM。 */
  time: string;
}

/**
 * 持久化形状的宽松视图：手改存储/旧版本数据可能把 enabled 写成 "true"，
 * 访问器需要容忍（与参考实现一致）。
 */
interface PersistedAutoCheckinSettingsLike {
  enabled?: boolean | string;
  time?: string;
}

/** 读取时间，未设置或格式非法时回落默认值（手改文件/旧版本数据不会让调度永久停摆）。 */
export function getAutoCheckinTime(
  settings: Partial<PersistedAutoCheckinSettingsLike> | undefined,
): string {
  const value = settings?.time;
  return typeof value === "string" && isValidAutoCheckinTime(value)
    ? value.trim()
    : DEFAULT_AUTO_CHECKIN_TIME;
}

/** 读开关，兼容手改存储里的 "true"/"false" 字符串。 */
export function isAutoCheckinEnabled(
  settings: Partial<PersistedAutoCheckinSettingsLike> | undefined,
): boolean {
  const value = settings?.enabled;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

export function getAutoCheckinSettings(
  settings: Partial<PersistedAutoCheckinSettingsLike> | undefined,
): CodeBuddyAutoCheckinSettings {
  return { enabled: isAutoCheckinEnabled(settings), time: getAutoCheckinTime(settings) };
}

// ---------------------------------------------------------------------------
// 设置持久化
// ---------------------------------------------------------------------------

/** key: `${region}:${accountId}` → 设置。 */
type CodeBuddyAutoCheckinSettingsMap = Record<string, CodeBuddyAutoCheckinSettings>;

const SETTINGS_STORE_KEY = "codebuddy:checkin:settings";

/** 复用签到历史的存储通道（同一 credentialService 加密后端），保持装配单一入口。 */
let settingsStoreLoad: ((key: string) => Promise<string | null>) | null = null;
let settingsStoreSave: ((key: string, value: string) => Promise<void>) | null = null;
let settingsCache: CodeBuddyAutoCheckinSettingsMap | null = null;
/** 串行化写，避免并发更新互相覆盖。 */
let settingsWriteChain: Promise<void> = Promise.resolve();

function logger() {
  return createServiceLogger("codebuddy-auto-checkin");
}

/**
 * node.ts 组装时注入持久化。与签到历史共用 `setCodeBuddyCheckinHistoryStore`
 * 的通道参数，这里单独持有一份 load/save 引用，避免两个 key 的缓存互相干扰。
 */
export function setCodeBuddyAutoCheckinSettingsStore(store: {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
} | null): void {
  settingsStoreLoad = store?.load ?? null;
  settingsStoreSave = store?.save ?? null;
  settingsCache = null;
}

async function loadSettingsMap(): Promise<CodeBuddyAutoCheckinSettingsMap> {
  if (settingsCache) return settingsCache;
  const empty: CodeBuddyAutoCheckinSettingsMap = {};
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
    const parsed = JSON.parse(raw) as CodeBuddyAutoCheckinSettingsMap;
    const normalized: CodeBuddyAutoCheckinSettingsMap = {};
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (!value || typeof value !== "object") continue;
      normalized[key] = getAutoCheckinSettings(value as Partial<CodeBuddyAutoCheckinSettings>);
    }
    settingsCache = normalized;
    return normalized;
  } catch (error) {
    logger().warn(undefined, "CodeBuddy 自动签到设置读取失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    settingsCache = empty;
    return empty;
  }
}

function saveSettingsMap(map: CodeBuddyAutoCheckinSettingsMap): Promise<void> {
  settingsCache = map;
  if (!settingsStoreSave) return Promise.resolve();
  const operation = settingsWriteChain.then(async () => {
    try {
      await settingsStoreSave?.(SETTINGS_STORE_KEY, JSON.stringify(map));
    } catch (error) {
      logger().warn(undefined, "CodeBuddy 自动签到设置写入失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  settingsWriteChain = operation;
  return operation;
}

function settingsKeyOf(region: CodeBuddyAutoCheckinRegion, accountId: string): string {
  return `${region}:${accountId}`;
}

/** 列出某区域全部账号的自动签到设置（只读当前账号列表，孤儿条目不返回）。 */
export async function listCodeBuddyAutoCheckinSettings(
  region: CodeBuddyAutoCheckinRegion,
): Promise<Array<{ accountId: string; accountName: string } & CodeBuddyAutoCheckinSettings>> {
  const [map, { accounts }] = await Promise.all([
    loadSettingsMap(),
    listCodeBuddyAccounts(region),
  ]);
  return accounts.map((account) => ({
    accountId: account.id,
    accountName: account.displayName || account.id,
    ...getAutoCheckinSettings(map[settingsKeyOf(region, account.id)]),
  }));
}

/**
 * 更新某账号的自动签到设置（局部更新）。
 *
 * 时间先校验再落盘：被拒绝的请求不留下半更新的设置。
 */
export async function updateCodeBuddyAutoCheckinSettings(
  region: CodeBuddyAutoCheckinRegion,
  accountId: string,
  update: { enabled?: unknown; time?: unknown },
): Promise<CodeBuddyAutoCheckinSettings> {
  const map = await loadSettingsMap();
  const key = settingsKeyOf(region, accountId);
  const current = getAutoCheckinSettings(map[key]);
  let time = current.time;
  if (update.time !== undefined) {
    if (!isValidAutoCheckinTime(update.time)) {
      throw new Error("Invalid auto check-in time, expected HH:MM");
    }
    time = String(update.time).trim();
  }
  const enabled = update.enabled === undefined ? current.enabled : Boolean(update.enabled);
  const next: CodeBuddyAutoCheckinSettings = { enabled, time };
  map[key] = next;
  await saveSettingsMap(map);
  return next;
}

// ---------------------------------------------------------------------------
// 调度器
// ---------------------------------------------------------------------------

/** tick 间隔：与提供的小时级选项匹配（半点粒度，30 分钟扫一次足够）。 */
const TICK_INTERVAL_MS = 30 * 60 * 1000;
/** 首个 tick 延迟，等存储就绪后再扫。 */
const START_DELAY_MS = 10 * 1000;
/** 单 tick 上限，避免启动时大批量账号突发请求。 */
const MAX_PER_TICK = 4;

interface CodeBuddyAutoCheckinSchedulerState {
  timer: ReturnType<typeof setInterval>;
  ticking: boolean;
}

const globalSchedulerState = globalThis as typeof globalThis & {
  __xcodeCodeBuddyAutoCheckin__?: CodeBuddyAutoCheckinSchedulerState;
};

/** 本地 YYYY-MM-DD，用于记住"当天窗口已领取"。 */
export const localDateKey = (now: Date): string => {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** 本地 HH:MM（24 小时制），与配置时间比较。 */
export const localTimeKey = (now: Date): string => {
  const hours = `${now.getHours()}`.padStart(2, "0");
  const minutes = `${now.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
};

/**
 * 配置时间（如 09:00 / 09:30）到 now 是否已到。
 *
 * 按"当天第几分钟"比较而非字符串比较：tick 迟到（09:30 的 tick 覆盖 09:00
 * 的档期）仍然生效——这正是漏跑后下一 tick 自动补跑的关键。
 */
const isSlotDue = ({ now, time }: { now: Date; time: string }): boolean => {
  const [slotHours = "0", slotMinutes = "0"] = time.split(":");
  const slotTotal = Number(slotHours) * 60 + Number(slotMinutes);
  return now.getHours() * 60 + now.getMinutes() >= slotTotal;
};

/**
 * 跑一次扫描：每个"开关打开 + 档期已到 + 当天未在本地记领取"的账号签到一次。
 *
 * 每个账号先读上游状态再领取（可能已被手动或别实例领掉）；只有本次真的
 *  claimed/already（即成功拿到"今天已领"的事实）才写本地账本——失败保持
 *  due，下个 tick 自然重试。
 */
export const runCodeBuddyAutoCheckinTick = async (
  now: Date = new Date(),
): Promise<string[]> => {
  const regions: readonly CodeBuddyAutoCheckinRegion[] = ["cn", "intl"];
  const today = localDateKey(now);
  const due: Array<{ region: CodeBuddyAutoCheckinRegion; accountId: string }> = [];

  for (const region of regions) {
    let accounts: Awaited<ReturnType<typeof listCodeBuddyAccounts>>["accounts"] = [];
    try {
      accounts = (await listCodeBuddyAccounts(region)).accounts;
    } catch (error) {
      logger().warn(undefined, "CodeBuddy 自动签到读取账号列表失败", {
        region,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const map = await loadSettingsMap();
    for (const account of accounts) {
      const settings = getAutoCheckinSettings(map[settingsKeyOf(region, account.id)]);
      if (!settings.enabled) continue;
      // 本地已记"当天已领取"直接跳过（重启/多实例去重的第一道闸）。
      if (await codebuddyClaimedLocally(region, account.id, today)) continue;
      if (!isSlotDue({ now, time: settings.time })) continue;
      due.push({ region, accountId: account.id });
      if (due.length >= MAX_PER_TICK) break;
    }
    if (due.length >= MAX_PER_TICK) break;
  }

  const checkedIn: string[] = [];
  for (const target of due) {
    try {
      const result = await codebuddyCheckinAccount(target.region, target.accountId);
      const succeeded = result.status === "claimed" || result.status === "already";
      if (!succeeded) {
        logger().warn(undefined, "CodeBuddy 自动签到未成功", {
          region: target.region,
          accountId: target.accountId,
          status: result.status,
          message: result.error ?? result.message,
        });
        continue;
      }
      checkedIn.push(`${target.region}:${target.accountId}`);
    } catch (error) {
      // 单账号失败不能拖垮整次扫描，也不能让进程出事。
      logger().warn(undefined, "CodeBuddy 自动签到失败", {
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
 * 都加一个 interval 会重复签到。timer unref，不独自保活进程。启动后 10s
 * 先扫一次，错过档期的进程（用户下午才打开应用）当天仍能补上。
 */
export const startCodeBuddyAutoCheckinScheduler = (): void => {
  if (globalSchedulerState.__xcodeCodeBuddyAutoCheckin__) return;
  const state: CodeBuddyAutoCheckinSchedulerState = {
    ticking: false,
    timer: setInterval(() => {
      // 上一 tick 还没跑完时跳过：重叠会重复领取；跳过是安全的，下一 tick 会补上。
      if (state.ticking) return;
      state.ticking = true;
      void runCodeBuddyAutoCheckinTick()
        .catch((error) => {
          logger().warn(undefined, "CodeBuddy 自动签到 tick 失败", {
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          state.ticking = false;
        });
    }, TICK_INTERVAL_MS),
  };
  state.timer.unref?.();
  globalSchedulerState.__xcodeCodeBuddyAutoCheckin__ = state;

  setTimeout(() => {
    void runCodeBuddyAutoCheckinTick().catch((error) => {
      logger().warn(undefined, "CodeBuddy 自动签到首扫失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, START_DELAY_MS).unref?.();
};

/** 停止调度（测试/热重载缝）。 */
export const stopCodeBuddyAutoCheckinScheduler = (): void => {
  const state = globalSchedulerState.__xcodeCodeBuddyAutoCheckin__;
  if (!state) return;
  clearInterval(state.timer);
  delete globalSchedulerState.__xcodeCodeBuddyAutoCheckin__;
};
