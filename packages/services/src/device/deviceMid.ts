import { createUuid } from "@zcode/shared";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAppConfigDir } from "../paths.js";

const LOCK_RETRY_DELAY_MS = 10;
const LOCK_RETRY_COUNT = 200;
const LOCK_STALE_MS = 5 * 60 * 1000;

interface DeviceState {
  deviceMid?: string;
  /** per-account 设备标识：每个账号一个独立 X-Device-Mid。 */
  accounts?: Record<string, { deviceMid?: string }>;
}

interface DeviceStateLockOwner {
  pid: number;
  createdAt: number;
}

const deviceMidCacheByStateFile = new Map<string, Promise<string>>();

// `telemetry-state.json` 是设备身份文件沿用至今的磁盘文件名：CLI、Desktop、远端 server 都读写同一
// 路径与字段，改名等于重置用户的设备身份，因此文件名保持不变。
function resolveDeviceStateFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".xcode", "v2", "telemetry-state.json");
  }
  return join(getAppConfigDir(), "telemetry-state.json");
}

function resolveDeviceStateLockFile(homeDir?: string): string {
  if (homeDir) {
    return join(homeDir, ".xcode", "v2", "telemetry-state.lock");
  }
  return join(getAppConfigDir(), "telemetry-state.lock");
}

async function readDeviceState(homeDir?: string): Promise<DeviceState> {
  try {
    const raw = await readFile(resolveDeviceStateFile(homeDir), "utf-8");
    const parsed = JSON.parse(raw) as DeviceState;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function writeDeviceState(state: DeviceState, homeDir?: string): Promise<void> {
  const deviceStateFile = resolveDeviceStateFile(homeDir);
  await mkdir(dirname(deviceStateFile), { recursive: true });
  await writeFile(deviceStateFile, JSON.stringify(state, null, 2), "utf-8");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeStaleDeviceStateLockIfNeeded(
  lockFile: string,
  timestamp: number,
): Promise<boolean> {
  try {
    const metadata = await stat(lockFile);
    if (timestamp - metadata.mtimeMs < LOCK_STALE_MS) {
      const owner = await readDeviceStateLockOwner(lockFile);
      if (!owner || isProcessAlive(owner.pid)) {
        return false;
      }
    }

    await unlink(lockFile).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function readDeviceStateLockOwner(lockFile: string): Promise<DeviceStateLockOwner | null> {
  try {
    const raw = await readFile(lockFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DeviceStateLockOwner>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.createdAt === "number" &&
      Number.isFinite(parsed.createdAt)
    ) {
      return {
        pid: parsed.pid,
        createdAt: parsed.createdAt,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ESRCH"
    );
  }
}

async function withDeviceStateLock<T>(
  homeDir: string | undefined,
  run: (state: DeviceState) => Promise<T>,
): Promise<T> {
  const lockFile = resolveDeviceStateLockFile(homeDir);
  await mkdir(dirname(lockFile), { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockFile, "wx");
      try {
        // 锁写入 owner pid，崩溃后 5 分钟内即可判定孤儿锁并被安全回收。
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            createdAt: Date.now(),
          }),
          "utf-8",
        );
        const state = await readDeviceState(homeDir);
        return await run(state);
      } finally {
        await handle.close();
        await unlink(lockFile).catch(() => {});
      }
    } catch (error) {
      const isLockConflict =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST";
      if (!isLockConflict) {
        throw error;
      }

      const removedStaleLock = await removeStaleDeviceStateLockIfNeeded(lockFile, Date.now());
      if (removedStaleLock) {
        continue;
      }

      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error("Device state lock timeout");
}

export interface EnsureDeviceMidOptions {
  homeDir?: string;
  randomUUID?: () => string;
}

function rememberDeviceMid(deviceStateFile: string, deviceMid: string): string {
  deviceMidCacheByStateFile.set(deviceStateFile, Promise.resolve(deviceMid));
  return deviceMid;
}

/**
 * 调用方必须已持有设备身份文件锁（telemetry-state.lock）；只在 state 缺失 deviceMid 时生成并写回。
 *
 * 遥测上报等场景在自身临界区内已持有同一把锁并维护完整 state，需要把 deviceMid 的生成
 * 合并进同一次落盘；此时不能走会重新抢锁的 ensureDeviceMid，改用本入口。
 */
export async function ensureDeviceMidInLockedState(
  state: DeviceState,
  options: EnsureDeviceMidOptions,
): Promise<string> {
  const deviceStateFile = resolveDeviceStateFile(options.homeDir);
  if (state.deviceMid) {
    return rememberDeviceMid(deviceStateFile, state.deviceMid);
  }

  const deviceMid = (options.randomUUID ?? createUuid)();
  state.deviceMid = deviceMid;
  await writeDeviceState(state, options.homeDir);
  return rememberDeviceMid(deviceStateFile, deviceMid);
}

/**
 * 确保设备身份文件里存在 deviceMid 并返回它。
 *
 * deviceMid 是跨端共享的设备身份：X-Device-Mid 计费 header、反馈、onboarding 都读它。
 * 远端 zcode-server 没有 Desktop main 进程，由 stdio entry 启动时调用本函数补写，
 * 与同机 CLI/Desktop 共享同一个文件、字段与锁。
 */
export function ensureDeviceMid(options: EnsureDeviceMidOptions = {}): Promise<string> {
  const deviceStateFile = resolveDeviceStateFile(options.homeDir);
  const cached = deviceMidCacheByStateFile.get(deviceStateFile);
  if (cached) {
    return cached;
  }

  const pending = withDeviceStateLock(options.homeDir, async (state) =>
    ensureDeviceMidInLockedState(state, options),
  ).catch((error) => {
    if (deviceMidCacheByStateFile.get(deviceStateFile) === pending) {
      deviceMidCacheByStateFile.delete(deviceStateFile);
    }
    throw error;
  });
  deviceMidCacheByStateFile.set(deviceStateFile, pending);
  return pending;
}

/**
 * 确保某个账号（accountRef）有独立的设备标识并返回它。
 * 每个账号独立 X-Device-Mid，避免服务端把同一物理机的多号关联到同一设备。
 * 未登录/无账号场景仍回退机器级 deviceMid（调用方继续用 ensureDeviceMid）。
 */
export function ensureDeviceMidForAccount(
  accountRef: string,
  options: EnsureDeviceMidOptions = {},
): Promise<string> {
  const deviceStateFile = resolveDeviceStateFile(options.homeDir);
  const cacheKey = `${deviceStateFile}#${accountRef}`;
  const cached = deviceMidCacheByStateFile.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = withDeviceStateLock(options.homeDir, async (state) => {
    const existing = state.accounts?.[accountRef]?.deviceMid;
    if (existing) {
      return rememberDeviceMid(cacheKey, existing);
    }
    const deviceMid = (options.randomUUID ?? createUuid)();
    state.accounts = { ...(state.accounts ?? {}), [accountRef]: { deviceMid } };
    await writeDeviceState(state, options.homeDir);
    return rememberDeviceMid(cacheKey, deviceMid);
  }).catch((error) => {
    if (deviceMidCacheByStateFile.get(cacheKey) === pending) {
      deviceMidCacheByStateFile.delete(cacheKey);
    }
    throw error;
  });
  deviceMidCacheByStateFile.set(cacheKey, pending);
  return pending;
}

/**
 * 同步确保某个账号有独立设备标识并落盘（账号激活时用，保证第一个请求就用账号值）。
 * 不做文件锁（激活低频，避免与异步锁并发）；与 ensureDeviceMidForAccount 读写同一 accounts 字段。
 */
export function ensureDeviceMidForAccountSync(
  accountRef: string,
  options: EnsureDeviceMidOptions = {},
): string {
  const stateFile = resolveDeviceStateFile(options.homeDir);
  let state: DeviceState = {};
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as DeviceState;
    if (typeof parsed === "object" && parsed) state = parsed;
  } catch {
    // 文件不存在或损坏，重建。
  }
  const existing = state.accounts?.[accountRef]?.deviceMid;
  if (existing) return existing;
  const deviceMid = (options.randomUUID ?? createUuid)();
  const updated: DeviceState = {
    ...state,
    accounts: { ...(state.accounts ?? {}), [accountRef]: { deviceMid } },
  };
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    // 写盘失败不阻断；请求届时回退机器级。
  }
  return deviceMid;
}
