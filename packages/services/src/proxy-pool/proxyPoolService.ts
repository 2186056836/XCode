/**
 * 代理池服务（services 层，host 侧）。
 *
 * 两块职责，互不耦合：
 * 1. **池条目 CRUD + 连通性测试**：读写 AppSettings.proxyPools（setting.json），
 *    与既有设置项同一条持久化链路（settingService.get/update）。
 * 2. **供应商绑定读写**：读写 provider config 的 `api.proxy`，经既有
 *    ProviderSettingsFacade.savePersonalProviderOverlay 落盘，因此天然走
 *    provider 的 overlay/校验/Registry 刷新链，agent 侧无需额外通道即可拿到绑定。
 *
 * 关键设计：绑定里同时保存 entryIds（UI 编辑意图）与 entries（物化快照）。
 * agent 读不到 host 的 setting.json，所以必须把条目内联进 provider config；
 * 而池条目改名/改 URL 后需要把快照刷新——由本服务的 syncProviderBindings 完成。
 *
 * 与全局 httpProxy 完全独立：本服务不读写 httpProxy / httpProxyNoProxy /
 * httpProxyCaCertPath，也不提供任何 fallback 到全局代理的解析。
 */
import type {
  AppSettings,
  ProviderProxyBinding,
  ProxyPoolEntry,
  ProxyPoolSettings,
} from "@zcode/shared";
import {
  createProxyPoolId,
  inferProxyPoolType,
  materializeProviderProxyEntries,
  normalizeProxyPoolNoProxy,
  sanitizeProxyPoolSettings,
  validateProxyPoolUrl,
} from "@zcode/shared";
import type { ProviderId, ProviderSettingsProviderView } from "@zcode/provider";
import type { ISettingService } from "../setting/setting.js";
import { testProxyUrl } from "./proxyTest.js";
import {
  supportsAccountBinding,
  type IProxyPoolService,
  type ProxyPoolSaveInput,
  type ProxyPoolState,
  type ProxyPoolTestResult,
  type ProxyProviderAccountView,
  type ProxyProviderBindingSaveInput,
  type ProxyProviderBindingView,
} from "./proxyPool.js";

interface ProxyPoolServiceDependencies {
  settingService: ISettingService;
  /** Provider 设置视图读取；用于枚举供应商与其 requestProfile。 */
  getProviderSettingsView: () => Promise<{ providers: readonly ProviderSettingsProviderView[] }>;
  /**
   * 保存某供应商的 api.proxy；传 null 表示清除绑定。
   *
   * **实现方必须做 read-modify-write**：只替换 `api.proxy`，保留该 Provider 的
   * api.type / baseUrl / headers 等其它字段。ProviderSettingsFacade 的
   * savePersonalProviderOverlay 是整份 overlay 替换语义，直接传只带 proxy 的
   * config 会把 baseUrl/headers 一起抹掉。
   */
  saveProviderProxy: (
    providerId: ProviderId,
    binding: ProviderProxyBinding | null,
  ) => Promise<unknown>;
  /** 读取某供应商的账号列表；无账号概念时返回空数组。 */
  listProviderAccounts: (
    providerId: string,
    requestProfile: string | undefined,
  ) => Promise<ProxyProviderAccountView[]>;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export function createProxyPoolService(
  dependencies: ProxyPoolServiceDependencies,
): IProxyPoolService {
  const log = dependencies.logger;

  const readPools = async (): Promise<ProxyPoolEntry[]> => {
    const settings: AppSettings = await dependencies.settingService.get();
    return sanitizeProxyPoolSettings(settings.proxyPools).pools;
  };

  const writePools = async (pools: ProxyPoolEntry[]): Promise<void> => {
    const proxyPools: ProxyPoolSettings = { pools };
    // 清空时写 undefined 而非 { pools: [] }：避免在 setting.json 里留一个空壳字段，
    // 也让「从未配置过」和「配过又删光」在读取侧表现一致。
    await dependencies.settingService.update(
      pools.length > 0 ? { proxyPools } : { proxyPools: undefined },
    );
  };

  const buildProviderViews = async (pools: ProxyPoolEntry[]): Promise<ProxyProviderBindingView[]> => {
    const view = await dependencies.getProviderSettingsView();
    const providers = view.providers;
    const result: ProxyProviderBindingView[] = [];
    for (const provider of providers) {
      const effective = provider.effectiveConfig;
      const binding = effective.api?.proxy ?? undefined;
      const requestProfile = effective.requestProfile ?? undefined;
      // 账号列表只对多账号供应商查询（qoder / codebuddy）；其他供应商直接跳过，
      // 避免为几十个自定义供应商各发一次无意义的凭据读取。
      const accounts = supportsAccountBinding(requestProfile)
        ? await dependencies
            .listProviderAccounts(provider.providerId, requestProfile)
            .catch((error: unknown) => {
              log?.warn(`[proxy-pool] list accounts failed for ${provider.providerId}:`, error);
              return [];
            })
        : [];
      result.push({
        providerId: provider.providerId,
        providerName: provider.providerName ?? provider.providerId,
        requestProfile,
        ...(binding
          ? {
              binding: {
                ...binding,
                // 视图里的 entries 始终以当前池列表为准重算：provider config 里的快照
                // 可能落后于刚编辑的池（保存顺序/并发），UI 必须看到真实生效值。
                entries: materializeProviderProxyEntries(binding.entryIds, pools),
              },
            }
          : {}),
        accounts: accounts.map((account) => ({
          ...account,
          ...(binding?.accountBindings?.[account.id]
            ? { boundEntryId: binding.accountBindings[account.id] }
            : {}),
        })),
      });
    }
    return result;
  };

  /**
   * 把 provider 绑定的 entries 快照刷新到最新池列表。
   *
   * 在池增删改后调用：绑定里指向已删除条目的 entryId 会被丢弃，
   * accountBindings 里的死绑定也会清掉，避免 agent 侧拿到过期 URL。
   */
  const syncProviderBindings = async (pools: ProxyPoolEntry[]): Promise<void> => {
    const view = await dependencies.getProviderSettingsView();
    for (const provider of view.providers) {
      const binding = provider.effectiveConfig.api?.proxy;
      if (!binding?.enabled || binding.entryIds.length === 0) {
        continue;
      }
      const nextEntries = materializeProviderProxyEntries(binding.entryIds, pools);
      const liveIds = new Set(nextEntries.map((entry) => entry.id));
      const currentBindings = binding.accountBindings ?? {};
      const nextBindings: Record<string, string> = {};
      for (const [accountId, entryId] of Object.entries(currentBindings)) {
        if (liveIds.has(entryId)) {
          nextBindings[accountId] = entryId;
        }
      }
      const entriesChanged = JSON.stringify(nextEntries) !== JSON.stringify(binding.entries);
      const bindingsChanged =
        Object.keys(nextBindings).length !== Object.keys(currentBindings).length;
      if (!entriesChanged && !bindingsChanged) {
        continue;
      }
      try {
        await dependencies.saveProviderProxy(provider.providerId as ProviderId, {
          ...binding,
          entries: nextEntries,
          accountBindings: nextBindings,
        });
      } catch (error) {
        // 单个供应商刷新失败不能阻断池保存；下次池变更会重试。
        log?.warn(`[proxy-pool] refresh binding snapshot failed for ${provider.providerId}:`, error);
      }
    }
  };

  return {
    async getState(): Promise<ProxyPoolState> {
      const pools = await readPools();
      return { pools, providers: await buildProviderViews(pools) };
    },

    async savePool(input: ProxyPoolSaveInput): Promise<ProxyPoolState> {
      const name = input.name.trim();
      if (!name) {
        throw new Error("proxy-pool-name-required");
      }
      const validation = validateProxyPoolUrl(input.proxyUrl);
      if (!validation.ok || !validation.normalizedUrl) {
        throw new Error(validation.error ?? "proxy-url-invalid");
      }
      const noProxy = normalizeProxyPoolNoProxy(input.noProxy);
      const pools = await readPools();
      const existingIndex = input.id ? pools.findIndex((pool) => pool.id === input.id) : -1;
      const entry: ProxyPoolEntry = {
        id: existingIndex >= 0 ? pools[existingIndex]!.id : createProxyPoolId(),
        name,
        proxyUrl: validation.normalizedUrl,
        ...(noProxy ? { noProxy } : {}),
        isActive: input.isActive ?? true,
        type: inferProxyPoolType(validation.normalizedUrl),
      };
      const nextPools =
        existingIndex >= 0
          ? pools.map((pool, index) => (index === existingIndex ? entry : pool))
          : [...pools, entry];
      await writePools(nextPools);
      await syncProviderBindings(nextPools);
      log?.info(`[proxy-pool] saved pool ${entry.id} (${entry.type})`);
      return { pools: nextPools, providers: await buildProviderViews(nextPools) };
    },

    async deletePool(poolId: string): Promise<ProxyPoolState> {
      const pools = await readPools();
      const nextPools = pools.filter((pool) => pool.id !== poolId);
      if (nextPools.length === pools.length) {
        return { pools, providers: await buildProviderViews(pools) };
      }
      await writePools(nextPools);
      await syncProviderBindings(nextPools);
      return { pools: nextPools, providers: await buildProviderViews(nextPools) };
    },

    async setPoolActive(poolId: string, isActive: boolean): Promise<ProxyPoolState> {
      const pools = await readPools();
      const nextPools = pools.map((pool) =>
        pool.id === poolId ? { ...pool, isActive } : pool,
      );
      await writePools(nextPools);
      // 停用不需要刷新快照（agent 侧 selectUsableProviderProxyEntries 会按 isActive 过滤），
      // 但启用后条目重新可用，快照可能仍是旧的，统一刷一次更省心。
      await syncProviderBindings(nextPools);
      return { pools: nextPools, providers: await buildProviderViews(nextPools) };
    },

    async testPool(input): Promise<ProxyPoolTestResult> {
      let proxyUrl = input.proxyUrl?.trim();
      if (!proxyUrl && input.poolId) {
        const pools = await readPools();
        proxyUrl = pools.find((pool) => pool.id === input.poolId)?.proxyUrl;
      }
      if (!proxyUrl) {
        return { ok: false, error: "proxy-url-required" };
      }
      return testProxyUrl({ proxyUrl, testUrl: input.testUrl });
    },

    async saveProviderBinding(
      providerId: string,
      input: ProxyProviderBindingSaveInput | null,
    ): Promise<ProxyPoolState> {
      const pools = await readPools();
      // null 或 enabled=false 或没选条目 → 清除绑定（写 null，让 overlay 显式覆盖掉旧值）。
      const shouldClear = !input || !input.enabled || input.entryIds.length === 0;
      if (shouldClear) {
        await dependencies.saveProviderProxy(providerId as ProviderId, null);
        return { pools, providers: await buildProviderViews(pools) };
      }
      const entries = materializeProviderProxyEntries(input.entryIds, pools);
      if (entries.length === 0) {
        // 用户选了条目但都被删了：按清除处理，避免留下一个永远选不中的绑定。
        await dependencies.saveProviderProxy(providerId as ProviderId, null);
        return { pools, providers: await buildProviderViews(pools) };
      }
      const liveIds = new Set(entries.map((entry) => entry.id));
      const accountBindings: Record<string, string> = {};
      for (const [accountId, entryId] of Object.entries(input.accountBindings ?? {})) {
        if (liveIds.has(entryId)) {
          accountBindings[accountId] = entryId;
        }
      }
      const noProxy = normalizeProxyPoolNoProxy(input.noProxy);
      const binding: ProviderProxyBinding = {
        enabled: true,
        strategy: input.strategy,
        entryIds: entries.map((entry) => entry.id),
        entries,
        ...(Object.keys(accountBindings).length > 0 ? { accountBindings } : {}),
        ...(noProxy ? { noProxy } : {}),
      };
      await dependencies.saveProviderProxy(providerId as ProviderId, binding);
      log?.info(`[proxy-pool] saved binding for ${providerId} (${entries.length} entries)`);
      return { pools, providers: await buildProviderViews(pools) };
    },

    async getProviderBinding(providerId: string): Promise<ProxyProviderBindingView | null> {
      const pools = await readPools();
      const views = await buildProviderViews(pools);
      return views.find((view) => view.providerId === providerId) ?? null;
    },

    async saveAccountBinding(
      providerId: string,
      accountId: string,
      entryId: string | null,
    ): Promise<ProxyProviderBindingView | null> {
      const pools = await readPools();
      const view = await dependencies.getProviderSettingsView();
      const provider = view.providers.find((p) => p.providerId === providerId);
      if (!provider) return null;
      const binding = provider.effectiveConfig.api?.proxy;
      const enabled = binding?.enabled ?? false;
      const entryIds = binding?.entryIds ?? [];
      // 账号绑定要求该供应商已启用代理且有可用条目；否则视为「未配置绑定」，
      // 账号只能跟随策略（entryId 非空但无条目时同样按清除处理）。
      const liveIds = new Set(entryIds);
      const accountBindings: Record<string, string> = { ...(binding?.accountBindings ?? {}) };
      if (!entryId || !liveIds.has(entryId)) {
        delete accountBindings[accountId];
      } else {
        accountBindings[accountId] = entryId;
      }
      const next: ProviderProxyBinding | null = enabled && entryIds.length > 0
        ? {
            ...binding!,
            accountBindings,
          }
        : null;
      await dependencies.saveProviderProxy(providerId as ProviderId, next);
      return this.getProviderBinding(providerId);
    },
  };
}
