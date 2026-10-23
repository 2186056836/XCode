/**
 * 账号轮询（account rotation）—— 对齐 9router `src/sse/services/auth.js` 的语义。
 *
 * 9router 的规则（逐条复刻）：
 * - 策略只有两种：`fill-first`（默认，按 priority 取第一条）与 `round-robin`；
 * - round-robin 带 sticky：同一账号连续使用 `stickyRoundRobinLimit` 次（默认 3）
 *   后才切到下一条，切走时选**最久未使用**的账号；
 * - 状态是连接级的 `lastUsedAt` + `consecutiveUseCount`，持久化在账号记录上；
 * - 失败写**按模型**的锁（`modelLock_<model>`），下次选择跳过锁定账号；
 * - 选择函数上锁串行执行，避免并发请求把同一账号算两次。
 *
 * XCode 的落点：host 侧服务（唯一能看到全部账号与凭据的地方），通过
 * `refreshRuntimeHeadersBeforeAttempt` 反向 RPC 在每次物理请求前被调用；
 * adapter 在账号级失败后把失败连接放进 `excludedConnectionIds` 再来一次。
 *
 * 状态不写 provider_config.json（那会同步给每个 agent 进程且被其他窗口 watch），
 * 也不走 credentials.json（每次 save 都是整文件加密重写 + 广播），用专用小 JSON 文件。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ACCOUNT_ROTATION_FAILOVER_STATUS,
  resolveModelProviderFamilyIdByProviderId,
  type AccountRotationFailoverStatus,
  type ModelProviderFamilyId,
} from "@zcode/shared";

export { ACCOUNT_ROTATION_FAILOVER_STATUS, type AccountRotationFailoverStatus };

export type AccountRotationStrategy = "fill-first" | "round-robin";

/**
 * 有「连接（账号）」概念、因而可做轮询的请求画像。
 *
 * - `qoder` / `codebuddy`：api-key 型多账号供应商，账号表在 provider facade 里；
 * - `zai` / `bigmodel`：Coding Plan 的 OAuth 账号族，账号表在 oauthCredentialRepo 里。
 *   一个 family 下有 start-plan / individual / team 等多个 provider，共享同一份账号表。
 */
export type AccountRotationProfile = "qoder" | "codebuddy" | ModelProviderFamilyId;

export interface AccountRotationSettings {
  strategy: AccountRotationStrategy;
  /** round-robin 的粘性次数；fill-first 忽略。 */
  stickyLimit: number;
  /**
   * 失败时是否换号。默认 false：请求出错（含 429）**不切账号**，直接报错。
   *
   * 存在的原因：Qoder / CodeBuddy 的账号是用户自己导入的一批身份，静默换号会让
   * 「刚才那条 429 是谁的」无从追查，也会在用户只想用某一个号时偷偷消耗别的号。
   * 打开后只对账号级失败生效（见 `onFailure`）。
   */
  failoverOnError: boolean;
  /**
   * 打开 failover 后，哪些状态码才换号。默认只有 429（限流），
   * 401/402/403 默认不换——那三类通常说明凭据/额度本身有问题，换号只是把
   * 同一个错误在别的账号上重演一遍，还会污染账号池的可用性判断。
   */
  failoverStatusCodes: AccountRotationFailoverStatus[];
}

export const DEFAULT_ACCOUNT_ROTATION_SETTINGS: AccountRotationSettings = {
  strategy: "fill-first",
  stickyLimit: 3,
  failoverOnError: false,
  failoverStatusCodes: [429],
};

const MIN_STICKY_LIMIT = 1;
const MAX_STICKY_LIMIT = 20;

export interface AccountRotationCandidate {
  id: string;
  displayName?: string;
  /** 该连接当前可用的 Bearer / JWT。 */
  accessToken: string;
  /** Qoder 设备指纹；CodeBuddy 不需要。 */
  machineId?: string;
  /** 用户当前选中的账号（fill-first 的优先项）。 */
  active: boolean;
}

export interface AccountRotationSelection {
  connectionId: string;
  accessToken: string;
  machineId?: string;
  displayName?: string;
  requestProfile: AccountRotationProfile;
  /** 是否因本次调用发生了账号切换（诊断/日志用）。 */
  rotated: boolean;
  /** 失败换号策略，随选号结果下发给 adapter；adapter 据此决定要不要重试。 */
  failover: { enabled: boolean; statusCodes: number[] };
}

export interface AccountRotationCandidateSource {
  /** 返回 undefined 表示该供应商不支持轮询。 */
  listCandidates(providerId: string): Promise<
    | {
        requestProfile: AccountRotationProfile;
        candidates: AccountRotationCandidate[];
      }
    | undefined
  >;
}

export interface AccountRotationStore {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}

/**
 * 轮询状态/设置的落盘实现：**专用小 JSON 文件**，不写 credentials.json。
 *
 * credentialsService 每次 save 都是一次整文件加密 + 文件锁 + 全量重写，且会
 * `onDidMutate` 广播；账号轮询每个 attempt 都要更新 lastUsedAt，走加密通道会把
 * 一次普通对话放大成几十次全量重写。这里用明文小文件（不含任何秘密）+ 进程内缓存
 * + 500ms 合并写。崩溃丢最后半秒的计数是安全损失（只影响 sticky 顺序）。
 */
export function createJsonFileAccountRotationStore(filePath: string): AccountRotationStore {
  type Data = Record<string, string>;
  let cache: Data | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  let scheduled = false;

  const loadAll = async (): Promise<Data> => {
    if (cache) return cache;
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      cache =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Data)
          : {};
    } catch {
      cache = {};
    }
    return cache;
  };

  const flush = (): void => {
    if (scheduled) return;
    scheduled = true;
    const timer = setTimeout(() => {
      scheduled = false;
      writeChain = writeChain
        .then(async () => {
          const data = cache ?? {};
          await mkdir(dirname(filePath), { recursive: true });
          const temp = `${filePath}.tmp`;
          await writeFile(temp, JSON.stringify(data), "utf8");
          await rename(temp, filePath);
        })
        .catch(() => {
          // 轮询计数丢失只影响 sticky 顺序，不值得打断对话；下次选择会重建。
        });
    }, 500);
    // 调度器不保活进程（Node 的 Timeout 支持 unref）。
    (timer as { unref?: () => void }).unref?.();
  };

  return {
    async load(key) {
      return (await loadAll())[key] ?? null;
    },
    async save(key, value) {
      const data = await loadAll();
      data[key] = value;
      flush();
    },
  };
}

interface ConnectionUsage {
  lastUsedAt?: string;
  consecutiveUseCount?: number;
}

interface ProviderRotationState {
  connections: Record<string, ConnectionUsage>;
  /** modelId -> connectionId -> 锁定截止时间（epoch ms）。 */
  locks: Record<string, Record<string, number>>;
}

interface AccountRotationServiceDependencies {
  source: AccountRotationCandidateSource;
  store: AccountRotationStore;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface AccountRotationSelectInput {
  providerId: string;
  modelId: string;
  excludedConnectionIds?: readonly string[];
  lastFailure?: { statusCode?: number; providerErrorCode?: string; connectionId?: string };
}

export interface AccountRotationService {
  select(input: AccountRotationSelectInput): Promise<AccountRotationSelection | undefined>;
  getSettings(providerId: string): Promise<AccountRotationSettings>;
  saveSettings(providerId: string, settings: AccountRotationSettings): Promise<void>;
}

const SETTINGS_KEY_PREFIX = "account-rotation:settings:";
const STATE_KEY_PREFIX = "account-rotation:state:";

/**
 * 轮询设置与状态的键。
 *
 * zai / bigmodel 一个 family 下有 start-plan / individual / team 等多个 provider，它们**共享
 * 同一份 OAuth 账号表**：若按 providerId 分键，「选了轮询」会在每个套餐 provider 上各自维护
 * 一套游标与 sticky 计数，同一份账号被当成互不相干的两批来轮。因此 family 成员统一收敛到
 * family id。qoder / codebuddy 不是 family（`other:qoder` 与 `other:qoder-cn` 是两份独立账号
 * 表），继续按 providerId 分键，行为不变。
 */
function rotationKey(providerId: string): string {
  return resolveModelProviderFamilyIdByProviderId(providerId) ?? providerId;
}

/** 账号级失败后对该账号+模型的冷却；429 短、鉴权/额度类长。 */
function lockTtlMs(statusCode: number | undefined): number | undefined {
  switch (statusCode) {
    case 429:
      return 60_000;
    case 401:
    case 402:
    case 403:
      return 10 * 60_000;
    default:
      return undefined;
  }
}

export function normalizeAccountRotationSettings(
  value: unknown,
): AccountRotationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_ACCOUNT_ROTATION_SETTINGS };
  }
  const raw = value as {
    strategy?: unknown;
    stickyLimit?: unknown;
    failoverOnError?: unknown;
    failoverStatusCodes?: unknown;
  };
  const strategy =
    raw.strategy === "round-robin" || raw.strategy === "fill-first"
      ? raw.strategy
      : DEFAULT_ACCOUNT_ROTATION_SETTINGS.strategy;
  const parsedSticky =
    typeof raw.stickyLimit === "number" && Number.isFinite(raw.stickyLimit)
      ? Math.round(raw.stickyLimit)
      : DEFAULT_ACCOUNT_ROTATION_SETTINGS.stickyLimit;
  const failoverOnError = raw.failoverOnError === true;
  const parsedCodes = Array.isArray(raw.failoverStatusCodes)
    ? raw.failoverStatusCodes.filter(
        (code): code is AccountRotationFailoverStatus =>
          typeof code === "number" &&
          (ACCOUNT_ROTATION_FAILOVER_STATUS as readonly number[]).includes(code),
      )
    : [];
  // 空集合回落默认 [429]：打开 failover 却没勾任何状态码，等于静默关闭，
  // 而用户在 UI 上看到的是「已开启」——这种半开状态必须避免。
  const failoverStatusCodes = parsedCodes.length
    ? [...new Set(parsedCodes)].sort((a, b) => a - b)
    : [...DEFAULT_ACCOUNT_ROTATION_SETTINGS.failoverStatusCodes];
  return {
    strategy,
    stickyLimit: Math.min(MAX_STICKY_LIMIT, Math.max(MIN_STICKY_LIMIT, parsedSticky)),
    failoverOnError,
    failoverStatusCodes,
  };
}

function readState(json: string | null): ProviderRotationState {
  if (!json) return { connections: {}, locks: {} };
  try {
    const parsed = JSON.parse(json) as Partial<ProviderRotationState>;
    return {
      connections:
        parsed.connections && typeof parsed.connections === "object" ? parsed.connections : {},
      locks: parsed.locks && typeof parsed.locks === "object" ? parsed.locks : {},
    };
  } catch {
    return { connections: {}, locks: {} };
  }
}

function isLocked(state: ProviderRotationState, modelId: string, connectionId: string, now: number) {
  const until = state.locks[modelId]?.[connectionId];
  return typeof until === "number" && until > now;
}

function lastUsedMs(usage: ConnectionUsage | undefined): number {
  const parsed = usage?.lastUsedAt ? Date.parse(usage.lastUsedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 纯选择函数（导出供单测）：给定候选、策略、状态，返回本次选中的连接。
 *
 * 与 9router 的 `getProviderCredentials` 同序：
 * 1. 过滤 excluded / 模型锁；
 * 2. fill-first → 候选顺序第一条（调用方已把 active 排在最前）；
 * 3. round-robin → 当前账号未达 stickyLimit 就继续用；否则取最久未使用。
 */
export function pickAccountForRotation(input: {
  candidates: readonly AccountRotationCandidate[];
  settings: AccountRotationSettings;
  state: ProviderRotationState;
  modelId: string;
  excludedConnectionIds?: readonly string[];
  now: number;
}):
  | { candidate: AccountRotationCandidate; consecutiveUseCount: number; rotated: boolean }
  | undefined {
  const excluded = new Set(input.excludedConnectionIds ?? []);
  const eligible = input.candidates.filter(
    (candidate) =>
      !excluded.has(candidate.id) &&
      !isLocked(input.state, input.modelId, candidate.id, input.now),
  );
  if (eligible.length === 0) return undefined;

  if (input.settings.strategy !== "round-robin") {
    const candidate = eligible[0]!;
    const previous = input.state.connections[candidate.id];
    return {
      candidate,
      consecutiveUseCount: (previous?.consecutiveUseCount ?? 0) + 1,
      rotated: false,
    };
  }

  const byRecency = [...eligible].sort((a, b) => {
    const diff = lastUsedMs(input.state.connections[b.id]) - lastUsedMs(input.state.connections[a.id]);
    return diff !== 0 ? diff : input.candidates.indexOf(a) - input.candidates.indexOf(b);
  });
  const current = byRecency[0];
  const currentUsage = current ? input.state.connections[current.id] : undefined;
  const currentCount = currentUsage?.consecutiveUseCount ?? 0;
  if (current && lastUsedMs(currentUsage) > 0 && currentCount < input.settings.stickyLimit) {
    return { candidate: current, consecutiveUseCount: currentCount + 1, rotated: false };
  }

  const byOldest = [...eligible].sort((a, b) => {
    const diff = lastUsedMs(input.state.connections[a.id]) - lastUsedMs(input.state.connections[b.id]);
    return diff !== 0 ? diff : input.candidates.indexOf(a) - input.candidates.indexOf(b);
  });
  const next = byOldest[0]!;
  const rotated = current !== undefined && current.id !== next.id;
  return { candidate: next, consecutiveUseCount: 1, rotated };
}

export function createAccountRotationService(
  dependencies: AccountRotationServiceDependencies,
): AccountRotationService {
  const log = dependencies.logger;
  // 选择与状态写回串行化：并发 attempt 不能读到同一个 lastUsedAt 再各自 +1。
  let selectionQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = selectionQueue.then(run, run);
    selectionQueue = next.catch(() => undefined);
    return next;
  };

  const readSettings = async (providerId: string): Promise<AccountRotationSettings> => {
    try {
      return normalizeAccountRotationSettings(
        JSON.parse((await dependencies.store.load(`${SETTINGS_KEY_PREFIX}${rotationKey(providerId)}`)) ?? "null"),
      );
    } catch {
      return { ...DEFAULT_ACCOUNT_ROTATION_SETTINGS };
    }
  };

  const readProviderState = async (providerId: string): Promise<ProviderRotationState> =>
    readState(await dependencies.store.load(`${STATE_KEY_PREFIX}${rotationKey(providerId)}`));

  const writeProviderState = async (
    providerId: string,
    state: ProviderRotationState,
  ): Promise<void> => {
    await dependencies.store.save(
      `${STATE_KEY_PREFIX}${rotationKey(providerId)}`,
      JSON.stringify(state),
    );
  };

  return {
    async getSettings(providerId) {
      return readSettings(providerId);
    },

    async saveSettings(providerId, settings) {
      const normalized = normalizeAccountRotationSettings(settings);
      await dependencies.store.save(
        `${SETTINGS_KEY_PREFIX}${rotationKey(providerId)}`,
        JSON.stringify(normalized),
      );
    },

    async select(input) {
      return serialize(async () => {
        const resolved = await dependencies.source.listCandidates(input.providerId);
        if (!resolved) return undefined;
        if (resolved.candidates.length === 0) return undefined;
        const settings = await readSettings(input.providerId);
        const state = await readProviderState(input.providerId);
        const now = Date.now();

        // 先落失败证据（模型锁），再参与选择：同一请求的下一次 attempt 会跳过它。
        const failedId = input.lastFailure?.connectionId;
        if (failedId) {
          const ttl = lockTtlMs(input.lastFailure?.statusCode);
          if (ttl !== undefined) {
            state.locks[input.modelId] = {
              ...(state.locks[input.modelId] ?? {}),
              [failedId]: now + ttl,
            };
          }
        }
        // 清理过期锁，避免状态无限增长。
        for (const [modelId, locks] of Object.entries(state.locks)) {
          const alive = Object.entries(locks).filter(([, until]) => until > now);
          if (alive.length === 0) delete state.locks[modelId];
          else state.locks[modelId] = Object.fromEntries(alive);
        }

        const ordered = [...resolved.candidates].sort(
          (a, b) => Number(b.active) - Number(a.active),
        );
        const picked = pickAccountForRotation({
          candidates: ordered,
          settings,
          state,
          modelId: input.modelId,
          excludedConnectionIds: input.excludedConnectionIds,
          now,
        });
        if (!picked) {
          await writeProviderState(input.providerId, state);
          log?.warn(
            `[account-rotation] no available connection for ${input.providerId}/${input.modelId}`,
          );
          return undefined;
        }
        state.connections[picked.candidate.id] = {
          lastUsedAt: new Date(now).toISOString(),
          consecutiveUseCount: picked.consecutiveUseCount,
        };
        await writeProviderState(input.providerId, state);
        if (picked.rotated) {
          log?.info(
            `[account-rotation] ${input.providerId}/${input.modelId}: ${picked.candidate.id} (${settings.strategy})`,
          );
        }
        return {
          connectionId: picked.candidate.id,
          accessToken: picked.candidate.accessToken,
          ...(picked.candidate.machineId ? { machineId: picked.candidate.machineId } : {}),
          ...(picked.candidate.displayName
            ? { displayName: picked.candidate.displayName }
            : {}),
          requestProfile: resolved.requestProfile,
          rotated: picked.rotated,
          failover: {
            enabled: settings.failoverOnError,
            statusCodes: settings.failoverStatusCodes,
          },
        };
      });
    },
  };
}
