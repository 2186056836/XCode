import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useServices } from "@/hooks/useServices.js";
import { useXCodeIntl } from "@/i18n/IntlProvider.js";
import type { IProxyPoolService, ProxyProviderBindingView } from "@zcode/services";
import type { AccountRotationStrategy } from "@zcode/services";
import type { ProviderProxyRotationStrategy } from "@zcode/shared";
import {
  readProviderBindingSlot,
  subscribeProviderBinding,
  writeProviderBindingSlot,
} from "./providerBindingViewStore.js";

/**
 * 「跟随全局代理」的 UI 哨兵值。
 *
 * Radix 的 SelectItem 不接受空字符串 value，所以这里必须用一个非空哨兵；
 * 提交时转成 null（= 删除该连接的绑定）。哨兵只是 UI 细节，绝不写进配置。
 */
const FOLLOW_GLOBAL_VALUE = "__follow__";

/**
 * 「各账号出口不一致」的 UI 哨兵值，只出现在批量分配行的显示位上。
 *
 * 批量行是动作入口（选一个池 → 套用到全部账号），但它的显示值同时承担状态位：
 * 显示值必须是「这批账号当前的统一出口」，否则点完之后下拉还停在原处，用户分不清
 * 是「没生效」还是「生效了但和之前一样」。不一致时既不是某个池也不是「跟随全局」，
 * 只能另造一个哨兵，配一个禁用的说明项把它显示出来。
 */
const MIXED_VALUE = "__mixed__";

/**
 * 读取单个供应商的连接级代理绑定视图。
 *
 * 视图存在模块级的共享槽里（见 providerBindingViewStore）：同一页面上账号行、
 * 供应商级出口、批量分配行、账号轮询控件是四个独立消费者，各存一份 state 的话，
 * 任何一处写盘后其余几处都看不到新值——批量套用后账号行仍显示旧出口就是这么来的。
 * 谁写回结果谁广播，四个消费者一起更新。
 */
function useProviderBindingView(providerId: string) {
  const services = useServices();
  const service: IProxyPoolService | undefined = services.proxyPoolService;
  const slot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribeProviderBinding(providerId, listener),
      [providerId],
    ),
    useCallback(() => readProviderBindingSlot(providerId), [providerId]),
  );

  const setView = useCallback(
    (next: ProxyProviderBindingView | null) => {
      writeProviderBindingSlot(providerId, { loaded: true, view: next });
    },
    [providerId],
  );

  const load = useCallback(async () => {
    if (!service) {
      setView(null);
      return;
    }
    try {
      setView(await service.getProviderBinding(providerId));
    } catch {
      setView(null);
    }
  }, [service, providerId, setView]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loaded: slot.loaded, service, view: slot.view, setView };
}

/**
 * 连接级代理出口选择器（内嵌到供应商账号行）。
 *
 * 一个连接只有两种状态，下拉里也只给两个语义：
 * - 「跟随全局」（哨兵，提交 null / 删除绑定）：出口交给 XCode 全局代理状态决定；
 * - 「某个池」：该连接独占该池出口，全局代理对它不再生效。
 *
 * 没有第三个选项——旧版的「跟随策略」与「直连」在语义上是同一件事（都 = 跟随全局），
 * 同时列出会让用户选到两个效果完全一样的项。
 *
 * **停用的池不进候选**：停用意味着引用它的连接已被重置回「跟随全局」（host 侧摘绑定），
 * 再列出来只会让用户绑到一个用不了的条目上。
 * 供应商没有连接（非 qoder / codebuddy）、或一条启用的池都没有时不渲染，避免空下拉。
 */
export function ProviderAccountBinding({
  providerId,
  accountId,
}: {
  providerId: string;
  accountId: string;
}) {
  const { intl } = useXCodeIntl();
  const { loaded, service, view, setView } = useProviderBindingView(providerId);

  const activePools = (view?.pools ?? []).filter((pool) => pool.isActive);
  const supportsConnections = view?.supportsConnections ?? false;
  // 该连接绑定的池 id；undefined = 未绑定 = 跟随全局。
  const boundEntryId = view?.accounts.find((account) => account.id === accountId)?.boundEntryId;

  if (!service || !loaded || !supportsConnections || activePools.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-ui-sm text-foreground-subtle">
      <span>{intl.formatMessage({ id: "settings.proxyPool.accountExit" })}</span>
      <Select
        value={boundEntryId ?? FOLLOW_GLOBAL_VALUE}
        onValueChange={(value) => {
          void service
            .saveAccountBinding(
              providerId,
              accountId,
              value === FOLLOW_GLOBAL_VALUE ? null : value,
            )
            .then((next) => setView(next))
            .catch(() => undefined);
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FOLLOW_GLOBAL_VALUE}>
            {intl.formatMessage({ id: "settings.proxyPool.accountFollowGlobal" })}
          </SelectItem>
          {activePools.map((pool) => (
            <SelectItem key={pool.id} value={pool.id}>
              {pool.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * 无账号免费供应商（OpenCode Free / Kilo Free）的 provider 级出口。
 *
 * 这类供应商没有 connection 可以逐条绑，但上游按出口 IP 风控，所以对齐 9router
 * noAuth 路径（proxyPoolId + rotateStrategy）给一个供应商级配置：
 * - 固定线路：所有请求走选中的那一条池；
 * - 轮询 / 随机：每个请求在全部启用中的池之间切换（游标在 agent 进程内，按 providerId 计数）。
 *
 * 「跟随全局」= 清除 vendor 级配置（提交 null），与连接级选择器同一语义。
 * 没有启用中的池、或该供应商不支持 provider 级配置时不渲染。
 */
export function ProviderProxyPoolControl({ providerId }: { providerId: string }) {
  const { intl } = useXCodeIntl();
  const { loaded, service, view, setView } = useProviderBindingView(providerId);

  const activePools = (view?.pools ?? []).filter((pool) => pool.isActive);
  const supported = view?.supportsProviderBinding ?? false;
  const current = view?.providerBinding;
  const strategy = current?.strategy ?? "none";
  const selectedPoolId = current?.poolIds[0];

  if (!service || !loaded || !supported || activePools.length === 0) {
    return null;
  }

  const save = (nextStrategy: ProviderProxyRotationStrategy, poolIds: string[]) => {
    void service
      .saveProviderBinding(
        providerId,
        poolIds.length > 0 ? { strategy: nextStrategy, poolIds } : null,
      )
      .then((next) => setView(next))
      .catch(() => undefined);
  };
  const allActivePoolIds = activePools.map((pool) => pool.id);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-ui-sm">
      <span className="text-foreground-subtle">
        {intl.formatMessage({ id: "settings.proxyPool.providerExit" })}
      </span>
      <Select
        value={strategy}
        onValueChange={(value) => {
          const next = value as ProviderProxyRotationStrategy;
          if (next === "none") {
            // 从轮询切回固定：优先保留原来选中的第一条，否则落到列表第一条。
            save("none", [selectedPoolId ?? allActivePoolIds[0]!]);
          } else {
            save(next, allActivePoolIds);
          }
        }}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            {intl.formatMessage({ id: "settings.proxyPool.providerStrategyNone" })}
          </SelectItem>
          <SelectItem value="round-robin">
            {intl.formatMessage({ id: "settings.proxyPool.providerStrategyRoundRobin" })}
          </SelectItem>
          <SelectItem value="random">
            {intl.formatMessage({ id: "settings.proxyPool.providerStrategyRandom" })}
          </SelectItem>
        </SelectContent>
      </Select>
      {strategy === "none" ? (
        <Select
          value={selectedPoolId ?? FOLLOW_GLOBAL_VALUE}
          onValueChange={(value) =>
            save("none", value === FOLLOW_GLOBAL_VALUE ? [] : [value])
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW_GLOBAL_VALUE}>
              {intl.formatMessage({ id: "settings.proxyPool.accountFollowGlobal" })}
            </SelectItem>
            {activePools.map((pool) => (
              <SelectItem key={pool.id} value={pool.id}>
                {pool.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-foreground-subtle">
          {intl.formatMessage(
            { id: "settings.proxyPool.providerRotationHint" },
            { count: activePools.length },
          )}
        </span>
      )}
    </div>
  );
}

/**
 * 账号轮询设置（Qoder / CodeBuddy，≥2 个账号时显示）。
 *
 * 语义对齐 9router：
 * - 优先当前账号（fill-first，默认）：始终先用用户选中的账号，失败再换下一个；
 * - 轮询（round-robin）：同一账号连续用 sticky 次后切到最久未使用的账号；
 * - 账号级失败（401/402/403/429）时自动换号重试，最多 4 次。
 */
export function ProviderAccountRotationControl({ providerId }: { providerId: string }) {
  const { intl } = useXCodeIntl();
  const { loaded, service, view, setView } = useProviderBindingView(providerId);

  const settings = view?.accountRotation;
  const accounts = view?.accounts ?? [];

  if (!service || !loaded || !settings || accounts.length < 2) {
    return null;
  }

  const save = (next: { strategy: AccountRotationStrategy; stickyLimit: number }) => {
    void service
      .saveAccountRotation(providerId, next)
      .then((value) => setView(value))
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-ui-sm">
      <span className="text-foreground-subtle">
        {intl.formatMessage({ id: "settings.accountRotation.label" })}
      </span>
      <Select
        value={settings.strategy}
        onValueChange={(value) =>
          save({ ...settings, strategy: value as AccountRotationStrategy })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fill-first">
            {intl.formatMessage({ id: "settings.accountRotation.fillFirst" })}
          </SelectItem>
          <SelectItem value="round-robin">
            {intl.formatMessage({ id: "settings.accountRotation.roundRobin" })}
          </SelectItem>
        </SelectContent>
      </Select>
      {settings.strategy === "round-robin" ? (
        <label className="flex items-center gap-1.5 text-foreground-subtle">
          <span>{intl.formatMessage({ id: "settings.accountRotation.sticky" })}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={settings.stickyLimit}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (!Number.isFinite(parsed)) return;
              save({
                ...settings,
                stickyLimit: Math.min(20, Math.max(1, Math.round(parsed))),
              });
            }}
            className="w-16 rounded-md border border-border bg-transparent px-2 py-1 text-ui-sm text-foreground"
          />
        </label>
      ) : null}
      <span className="text-foreground-subtle">
        {intl.formatMessage({ id: "settings.accountRotation.hint" })}
      </span>
    </div>
  );
}

/**
 * 供应商页的批量分配行（对齐 9router 供应商详情页的 batch apply）。
 *
 * - 「全部账号」下拉：把同一条池一次套用到该供应商的所有连接（含「全部取消绑定」）；
 * - 「按序轮流分配」按钮：把当前全部启用的池按列表顺序轮流分给各连接
 *   —— 这就是 9router 实现「轮询」的方式（每条连接固定拿一个池，而不是每次请求换）。
 *
 * 单连接供应商不展示（原生 Select 就够了），少于两条启用池时轮询按钮禁用；
 * 一条启用的池都没有时整行不渲染（列表里只剩「全部取消绑定」没有意义）。
 *
 * **下拉显示的是当前统一出口，不是固定文案**：原来把 value 写死成「跟随全局」，
 * 套用完弹回原样，看起来就像点击没反应（实际已写盘）。显示值取自各账号的绑定，
 * 写盘后随共享视图一起刷新；不一致时显示 MIXED_VALUE 那一项。
 * 失败不再静默吞掉：写盘失败（例如 provider 已不存在）在这里给出错误行。
 */
export function ProviderProxyBatchActions({ providerId }: { providerId: string }) {
  const { intl } = useXCodeIntl();
  const { loaded, service, view, setView } = useProviderBindingView(providerId);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const accounts = view?.accounts ?? [];
  const supportsConnections = view?.supportsConnections ?? false;
  // 停用的池不进候选：停用即已把引用它的连接重置回「跟随全局」。
  const activePools = (view?.pools ?? []).filter((pool) => pool.isActive);

  // 统一出口：全部账号绑同一条池 → 该池；全部未绑 → 跟随全局；其余 → 不一致。
  const commonValue = (() => {
    if (accounts.length === 0) {
      return FOLLOW_GLOBAL_VALUE;
    }
    const first = accounts[0]!.boundEntryId ?? FOLLOW_GLOBAL_VALUE;
    return accounts.every((account) => (account.boundEntryId ?? FOLLOW_GLOBAL_VALUE) === first)
      ? first
      : MIXED_VALUE;
  })();

  const run = (action: Promise<ProxyProviderBindingView | null>) => {
    setErrorMsg(null);
    void action
      .then((next) => setView(next))
      .catch((error: unknown) =>
        setErrorMsg(
          intl.formatMessage(
            { id: "settings.proxyPool.saveFailed" },
            { error: error instanceof Error ? error.message : String(error) },
          ),
        ),
      );
  };

  if (
    !service ||
    !loaded ||
    !supportsConnections ||
    accounts.length < 2 ||
    activePools.length === 0
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-ui-sm">
      <span className="text-foreground-subtle">
        {intl.formatMessage({ id: "settings.proxyPool.batchLabel" })}
      </span>
      <Select
        value={commonValue}
        onValueChange={(value) =>
          run(service.applyPoolToAllAccounts(providerId, value === FOLLOW_GLOBAL_VALUE ? null : value))
        }
      >
        <SelectTrigger className="w-48">
          <SelectValue
            placeholder={intl.formatMessage({ id: "settings.proxyPool.batchApplyPlaceholder" })}
          />
        </SelectTrigger>
        <SelectContent>
          {/* 只用于显示「各账号出口不一致」，不能选中：它不是一种出口状态。 */}
          <SelectItem value={MIXED_VALUE} disabled>
            {intl.formatMessage({ id: "settings.proxyPool.batchMixed" })}
          </SelectItem>
          <SelectItem value={FOLLOW_GLOBAL_VALUE}>
            {intl.formatMessage({ id: "settings.proxyPool.batchClearAll" })}
          </SelectItem>
          {activePools.map((pool) => (
            <SelectItem key={pool.id} value={pool.id}>
              {pool.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        disabled={activePools.length < 2}
        title={
          activePools.length < 2
            ? intl.formatMessage({ id: "settings.proxyPool.batchRotateNeedsTwo" })
            : undefined
        }
        onClick={() =>
          run(
            service.distributePools(
              providerId,
              activePools.map((pool) => pool.id),
            ),
          )
        }
        className="rounded-md border border-border px-2.5 py-1 text-ui-sm text-foreground transition-colors hover:border-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50"
      >
        {intl.formatMessage({ id: "settings.proxyPool.batchRotate" })}
      </button>
      <span className="text-foreground-subtle">
        {intl.formatMessage({ id: "settings.proxyPool.batchHint" }, { count: accounts.length })}
      </span>
      {errorMsg ? <span className="text-destructive">{errorMsg}</span> : null}
    </div>
  );
}
