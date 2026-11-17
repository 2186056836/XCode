import { createServiceLogger } from "../logger/serviceLogger.js";
import { recordAutoActivity } from "./autoClaimLog.js";

/**
 * XCode fork：zai/bigmodel 每账号自动领取（开关 + 时间）与定时调度。
 *
 * 与 `codebuddyAutoCheckin` 同构（同一套语义：每账号独立开关 + HH:MM、
 * 30 分钟一扫、档期已到且未领过才尝试、失败下个 tick 补跑），差异在领取链路：
 *
 *   1. 按 per-account zcodejwt 查营销投放（marketing/touch），取
 *      claim_zcode_plan 动作的 plan_id；
 *   2. 领取（zcode-plan/billing/claim）；claim 接口强制校验阿里云验证码票据
 *      （`X-Aliyun-Captcha-Verify-Param`，由 client/configs 的 captcha 下发）。
 *      手动领取能静默拿到票据，是因为渲染进程跑了阿里云无感验证——不是没有
 *      验证码，而是评分低时不弹滑块；host 是纯 Node，没有 DOM 跑不了该 SDK，
 *      所以这类账号记日志跳过，别每 30 分钟重打一次上游；
 *   3. 已有名下计划（billing/balance 返回非空）的账号视为已领过，当天跳过。
 *
 * 「已领取当天」的判定复用名下计划快照：有计划 = 该账号领过（Start Plan
 * 权益一次性的），比本地账本更准——多实例/换机都不会重复领取。
 *
 * 设置持久化：`marketing:claim:settings`（credentialService 加密通道，
 * node.ts 注入）。删除账号后其设置成为孤儿条目，读取时按当前账号列表过滤。
 */

export const AUTO_CLAIM_MINUTE_OPTIONS = [0, 30] as const;

export const DEFAULT_AUTO_CLAIM_TIME = "09:00";

/** 24 小时 HH:MM（刻意严格：坏时间要么永不触发要么意外触发，都比拒绝输入更糟）。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidAutoClaimTime = (value: unknown): boolean =>
  typeof value === "string" && TIME_PATTERN.test(value.trim());

export interface AutoClaimSettings {
  enabled: boolean;
  /** HH:MM。 */
  time: string;
}

interface PersistedAutoClaimSettingsLike {
  enabled?: boolean | string;
  time?: string;
}

function readTime(settings: Partial<PersistedAutoClaimSettingsLike> | undefined): string {
  const value = settings?.time;
  return typeof value === "string" && isValidAutoClaimTime(value)
    ? value.trim()
    : DEFAULT_AUTO_CLAIM_TIME;
}

function readEnabled(settings: Partial<PersistedAutoClaimSettingsLike> | undefined): boolean {
  // 手改存储可能写成 "true"/"false"/1：只认明确的真值，其余一律关闭。
  return settings?.enabled === true || settings?.enabled === "true" || settings?.enabled === "1";
}

export function getAutoClaimSettings(
  settings: Partial<PersistedAutoClaimSettingsLike> | undefined,
): AutoClaimSettings {
  return { enabled: readEnabled(settings), time: readTime(settings) };
}

type AutoClaimSettingsMap = Record<string, AutoClaimSettings>;

const SETTINGS_STORE_KEY = "marketing:claim:settings";

let settingsStoreLoad: ((key: string) => Promise<string | null>) | null = null;
let settingsStoreSave: ((key: string, value: string) => Promise<void>) | null = null;
let settingsCache: AutoClaimSettingsMap | null = null;
/** 串行化写，避免并发更新互相覆盖。 */
let settingsWriteChain: Promise<void> = Promise.resolve();
/** 调度器注册的「立刻补扫」钩子；未启动调度时为空。 */
let settingsNudge: (() => void) | null = null;
let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

function logger() {
  return createServiceLogger("auto-claim");
}

export function setAutoClaimSettingsStore(store: {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
} | null): void {
  settingsStoreLoad = store?.load ?? null;
  settingsStoreSave = store?.save ?? null;
  settingsCache = null;
}

async function loadSettingsMap(): Promise<AutoClaimSettingsMap> {
  if (settingsCache) return settingsCache;
  const empty: AutoClaimSettingsMap = {};
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
    const parsed = JSON.parse(raw) as AutoClaimSettingsMap;
    const normalized: AutoClaimSettingsMap = {};
    for (const [key, value] of Object.entries(parsed ?? {})) {
      if (!value || typeof value !== "object") continue;
      normalized[key] = getAutoClaimSettings(value);
    }
    settingsCache = normalized;
    return normalized;
  } catch (error) {
    logger().warn(undefined, "自动领取设置读取失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    settingsCache = empty;
    return empty;
  }
}

function saveSettingsMap(map: AutoClaimSettingsMap): Promise<void> {
  settingsCache = map;
  if (!settingsStoreSave) return Promise.resolve();
  const operation = settingsWriteChain.then(async () => {
    try {
      await settingsStoreSave?.(SETTINGS_STORE_KEY, JSON.stringify(map));
    } catch (error) {
      logger().warn(undefined, "自动领取设置写入失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  settingsWriteChain = operation;
  return operation;
}

function settingsKeyOf(accountRef: string): string {
  return accountRef;
}

export interface AutoClaimClaimDelegate {
  /** 按账号查名下计划（billing/balance）：非空 = 该账号已领过权益。 */
  getPlans(accountRef: string): Promise<{
    plans: Array<{ planId?: string; name?: string; status?: string }>;
  }>;
  /** 查该账号的营销投放，取可领取的 plan_id；无可领取返回 null。 */
  findClaimablePlanId(accountRef: string): Promise<string | null>;
  /** 领取；要求验证码的投放返回 { requiresCaptcha: true }。 */
  claim(input: {
    accountRef: string;
    planId: string;
  }): Promise<{ ok: boolean; requiresCaptcha?: boolean; message?: string }>;
}

/** 列出全部账号的自动领取设置（只读当前账号列表，孤儿条目不返回）。 */
export async function listAutoClaimSettings(
  accountRefs: readonly string[],
): Promise<Array<{ accountRef: string } & AutoClaimSettings>> {
  const map = await loadSettingsMap();
  return accountRefs.map((accountRef) => ({
    accountRef,
    ...getAutoClaimSettings(map[settingsKeyOf(accountRef)]),
  }));
}

/** 更新某账号的自动领取设置（局部更新，时间先校验再落盘）。 */
export async function updateAutoClaimSettings(
  accountRef: string,
  update: { enabled?: unknown; time?: unknown },
): Promise<AutoClaimSettings> {
  const map = await loadSettingsMap();
  const key = settingsKeyOf(accountRef);
  const current = getAutoClaimSettings(map[key]);
  let time = current.time;
  if (update.time !== undefined) {
    if (!isValidAutoClaimTime(update.time)) {
      throw new Error("Invalid auto claim time, expected HH:MM");
    }
    time = String(update.time).trim();
  }
  const enabled = update.enabled === undefined ? current.enabled : Boolean(update.enabled);
  const next: AutoClaimSettings = { enabled, time };
  map[key] = next;
  await saveSettingsMap(map);
  // 改完就补扫：把档期改成「刚过去」的时间时，否则要等到下一个整点/半点，
  // 用户会以为设置没生效。
  settingsNudge?.();
  return next;
}

/**
 * 批量更新自动领取设置：逐账号局部更新，任一失败继续其余（失败账号在返回值中标出）。
 *
 * 设置写入走同一串行化链，逐条 update 不会互相覆盖；返回结果供 UI 汇总提示。
 */
export async function updateAutoClaimSettingsBatch(
  accountRefs: readonly string[],
  update: { enabled?: boolean; time?: string },
): Promise<{ accountRef: string; ok: boolean; error?: string }[]> {
  const results: { accountRef: string; ok: boolean; error?: string }[] = [];
  for (const accountRef of accountRefs) {
    try {
      await updateAutoClaimSettings(accountRef, update);
      results.push({ accountRef, ok: true });
    } catch (error) {
      results.push({
        accountRef,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 调度器
// ---------------------------------------------------------------------------

/** 扫描网格对齐余量：整点/半点后再等 5 秒，避开系统时间微抖。 */
const TICK_OFFSET_MS = 5_000;
const START_DELAY_MS = 10_000;
const MAX_PER_TICK = 4;
/** 设置刚改完（比如把时间改成刚过去的档期）时，别等下一个网格点。 */
const SETTINGS_NUDGE_DELAY_MS = 3_000;

interface AutoClaimSchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  ticking: boolean;
}

/**
 * 到下一个扫描网格点还差多少毫秒。
 *
 * 网格必须锚在**本地整点/半点**，不能锚在进程启动时刻：配置时间只允许
 * `:00 / :30`（见 `AUTO_CLAIM_MINUTE_OPTIONS`），而固定 30 分钟 interval
 * 会跟着启动时刻漂移——dev 16:49 启动，网格就落在 `:19:31 / :49:31`，
 * 用户设的 19:00 档期要迟到 19 分半才被看到，看起来就像「没触发」。
 */
export function msUntilNextTick(now: Date): number {
  const boundary = new Date(now.getTime());
  boundary.setMinutes(boundary.getMinutes() < 30 ? 30 : 60, 0, 0);
  return Math.max(0, boundary.getTime() - now.getTime()) + TICK_OFFSET_MS;
}

const globalSchedulerState = globalThis as typeof globalThis & {
  __xcodeAutoClaim__?: AutoClaimSchedulerState;
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

/**
 * 把错误展开成可诊断的一行。
 *
 * Node fetch 在网络层失败时只给 `fetch failed`，真正原因藏在 `cause` 链里
 * （`ECONNRESET` / `ENOTFOUND` / `UND_ERR_CONNECT_TIMEOUT`…）。不展开的话，
 * 这类失败在「最近活动」里永远只有四个字，无法判断该修网络还是修代码。
 */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push(typeof code === "string" ? `${current.message} (${code})` : current.message);
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  return parts.filter(Boolean).join(" ← ") || "unknown error";
}

/** 已领过的判定：名下计划非空（Start Plan 权益一次性，有计划 = 已领）。 */
async function alreadyClaimed(
  delegate: AutoClaimClaimDelegate,
  accountRef: string,
): Promise<boolean | "unknown"> {
  try {
    const { plans } = await delegate.getPlans(accountRef);
    return plans.length > 0;
  } catch {
    // 查询失败按未知处理：跳过本次而不重复领取（领取是写操作，宁可少领不可重领）。
    return "unknown";
  }
}

/**
 * 跑一次扫描：每个「开关打开 + 档期已到 + 未领过」的账号尝试领取。
 *
 * 单账号失败不拖垮整次扫描；要求验证码的投放记日志跳过（下个 tick 仍会
 * 跳过，用户需手动领取）。
 */
export const runAutoClaimTick = async (
  deps: {
    delegate: AutoClaimClaimDelegate;
    listAccountRefs: () => Promise<string[]>;
  },
  now: Date = new Date(),
): Promise<string[]> => {
  const { delegate, listAccountRefs } = deps;
  const map = await loadSettingsMap();
  const due: string[] = [];
  let accountRefs: string[] = [];
  try {
    accountRefs = await listAccountRefs();
  } catch (error) {
    logger().warn(undefined, "自动领取读取账号列表失败", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  for (const accountRef of accountRefs) {
    const settings = getAutoClaimSettings(map[settingsKeyOf(accountRef)]);
    if (!settings.enabled) continue;
    if (!isSlotDue({ now, time: settings.time })) continue;
    const held = await alreadyClaimed(delegate, accountRef);
    if (held === true) {
      // 已领过也要留痕：否则「今天一次都没跑」和「跑过但跳过了」在界面上
      // 完全一样，只剩困惑。plan 是一次性权益，这条会稳定覆盖为最新时间。
      await recordAutoActivity({ kind: "auto-claim", accountRef, status: "already" });
      continue;
    }
    due.push(accountRef);
    if (due.length >= MAX_PER_TICK) break;
  }

  const claimed: string[] = [];
  for (const accountRef of due) {
    try {
      const planId = await deps.delegate.findClaimablePlanId(accountRef);
      if (!planId) {
        // 无可领取投放：视为当天完成，避免每个 tick 重查。
        logger().info(undefined, "自动领取：无可领取投放", { accountRef });
        await recordAutoActivity({
          kind: "auto-claim",
          accountRef,
          status: "no-campaign",
        });
        claimed.push(accountRef);
        continue;
      }
      const result = await deps.delegate.claim({ accountRef, planId });
      if (result.requiresCaptcha) {
        // 措辞别写成「滑块」：服务端下发的阿里云验证码在手动领取时走的是无感验证，
        // 静默签一张校验票据，用户根本看不到滑块；后台只是拿不到这张票据。
        logger().warn(undefined, "自动领取：服务端要求验证码校验，后台无法完成，已跳过（请手动领取）", {
          accountRef,
        });
        await recordAutoActivity({
          kind: "auto-claim",
          accountRef,
          status: "captcha-skipped",
          message: result.message,
        });
        // 计为「本轮已处理」：后台永远过不了滑块，不记的话下个 tick 会再打一次上游，
        // 每 30 分钟一次直到用户手动领走——既浪费请求又刷日志。
        claimed.push(accountRef);
        continue;
      }
      if (!result.ok) {
        logger().warn(undefined, "自动领取未成功", { accountRef, message: result.message });
        await recordAutoActivity({
          kind: "auto-claim",
          accountRef,
          status: "failed",
          message: result.message,
        });
        continue;
      }
      logger().info(undefined, "自动领取成功", { accountRef });
      await recordAutoActivity({ kind: "auto-claim", accountRef, status: "claimed" });
      claimed.push(accountRef);
    } catch (error) {
      // `fetch failed` 是 Node fetch 的网络层兜底文案，真正原因在 cause 里
      // （ECONNRESET / ENOTFOUND / 代理超时…）。只记 message 会让这类失败永远
      // 无法排查，所以把 cause 链一并展开。
      const message = describeError(error);
      logger().warn(undefined, "自动领取失败", { accountRef, message });
      await recordAutoActivity({
        kind: "auto-claim",
        accountRef,
        status: "failed",
        message,
      });
    }
  }
  return claimed;
};

/**
 * 启动调度（进程内单例：整点/半点网格 + 设置变更补扫）。
 *
 * globalThis 守卫：host 模块可能被多次求值（多处 import / HMR），每次求值
 * 都加一个 timer 会重复领取。timer unref，不独自保活进程。
 */
export const startAutoClaimScheduler = (deps: {
  delegate: AutoClaimClaimDelegate;
  listAccountRefs: () => Promise<string[]>;
}): void => {
  if (globalSchedulerState.__xcodeAutoClaim__) return;
  const state: AutoClaimSchedulerState = {
    ticking: false,
    timer: null,
  };

  const tick = (): void => {
    // 上一轮没跑完就跳过：单个账号的 claim 可能拖到网格点之后。
    if (state.ticking) return;
    state.ticking = true;
    void runAutoClaimTick(deps)
      .catch((error) => {
        logger().warn(undefined, "自动领取 tick 失败", {
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        state.ticking = false;
      });
  };

  const scheduleNext = (): void => {
    state.timer = setTimeout(() => {
      tick();
      scheduleNext();
    }, msUntilNextTick(new Date()));
    state.timer.unref?.();
  };

  globalSchedulerState.__xcodeAutoClaim__ = state;
  scheduleNext();

  // 设置变更（尤其把时间改成刚刚过去的档期）时立刻补扫一次，否则用户要
  // 等到下一个整点/半点才看到效果——和「没生效」无法区分。
  settingsNudge = () => {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null;
      tick();
    }, SETTINGS_NUDGE_DELAY_MS);
    nudgeTimer.unref?.();
  };

  setTimeout(tick, START_DELAY_MS).unref?.();
};

/** 停止调度（测试/热重载缝）。 */
export const stopAutoClaimScheduler = (): void => {
  const state = globalSchedulerState.__xcodeAutoClaim__;
  settingsNudge = null;
  if (nudgeTimer) {
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
  }
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  delete globalSchedulerState.__xcodeAutoClaim__;
};
