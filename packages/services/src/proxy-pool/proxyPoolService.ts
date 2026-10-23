/**
 * 代理池服务（services 层，host 侧）。
 *
 * 两块职责，互不耦合：
 * 1. **池条目 CRUD + 连通性测试**：读写 AppSettings.proxyPools（setting.json），
 *    与既有设置项同一条持久化链路（settingService.get/update）。
 * 2. **连接级绑定读写**：读写 provider config 的 `api.proxy`，经既有
 *    ProviderSettingsFacade.savePersonalProviderOverlay 落盘，因此天然走
 *    provider 的 overlay/校验/Registry 刷新链，agent 侧无需额外通道即可拿到绑定。
 *
 * 绑定单位是**单条连接**（一个账号 / 一份凭据），对齐 9router 的
 * `connection.providerSpecificData.proxyPoolId`。写入口只有三个，都只动一条或一批连接：
 * saveAccountBinding / applyPoolToAllAccounts / distributePools；
 * 没有任何「供应商级启用开关 / 策略 / 多选池」状态需要维护。
 *
 * agent 读不到 host 的 setting.json，所以绑定里内联的是**完整条目快照**；池条目改名/改 URL/
 * 被删除后需要把快照刷到最新——由 syncProviderBindings 完成。
 *
 * 本服务不读写全局 httpProxy / httpProxyNoProxy / httpProxyCaCertPath。二者的关系
 * 在**解析侧**（shared/proxy-pool.ts 的 resolveProviderProxyRoute）而非本服务：
 * 绑了池的连接走池、不再走全局代理；未绑定的连接（含绑定指向已停用池的连接，这类绑定
 * 会被本服务摘掉）跟随全局代理状态。
 */
import type {
  AppSettings,
  ProviderProxyBinding,
  ProviderProxyRotationStrategy,
  ProxyPoolEntry,
  ProxyPoolSettings,
} from "@zcode/shared";
import {
  assignProviderProxyRotation,
  assignProxyPoolToBindings,
  createProxyPoolId,
  distributeProxyPoolsToBindings,
  inferProxyPoolType,
  normalizeProxyPoolNoProxy,
  refreshProviderProxyBinding,
  sanitizeProxyPoolSettings,
  validateProxyPoolUrl,
} from "@zcode/shared";
import type { ProviderId, ProviderSettingsProviderView } from "@zcode/provider";
import type { AccountRotationSettings } from "../model-provider/accountRotation.js";
import type { ISettingService } from "../setting/setting.js";
import { createAccountFamilyBinding } from "./proxyPoolFamilyBinding.js";
import { createProxyPoolViews } from "./proxyPoolViews.js";
import { testProxyUrl } from "./proxyTest.js";
import {
  resolveAccountFamilyProviderId,
  supportsAccountBinding,
  supportsProviderBinding,
  type IProxyPoolService,
  type ProviderBindingContext,
  type ProxyPoolSaveInput,
  type ProxyPoolState,
  type ProxyPoolTestResult,
  type ProxyProviderAccountView,
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
  /** 读取某供应商的连接（账号）列表；无连接概念时返回空数组。 */
  listProviderAccounts: (
    providerId: string,
    requestProfile: string | undefined,
  ) => Promise<ProxyProviderAccountView[]>;
  /** 账号轮询设置读写；undefined 时 UI 不展示轮询控件。 */
  accountRotationSettings?: {
    get(providerId: string): Promise<AccountRotationSettings>;
    save(providerId: string, settings: AccountRotationSettings): Promise<void>;
  };
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export function createProxyPoolService(
  dependencies: ProxyPoolServiceDependencies,
): IProxyPoolService {
  const log = dependencies.logger;
  // zai / bigmodel 的账号不属于任何单个 provider，走 family 伪 providerId 分支。
  const accountFamily = createAccountFamilyBinding({
    getProviderSettingsView: dependencies.getProviderSettingsView,
    saveProviderProxy: dependencies.saveProviderProxy,
    listProviderAccounts: dependencies.listProviderAccounts,
    ...(dependencies.accountRotationSettings
      ? { accountRotationSettings: dependencies.accountRotationSettings }
      : {}),
    ...(log ? { logger: log } : {}),
  });
  const views = createProxyPoolViews({
    getProviderSettingsView: dependencies.getProviderSettingsView,
    saveProviderProxy: dependencies.saveProviderProxy,
    listProviderAccounts: dependencies.listProviderAccounts,
    accountFamily,
    ...(dependencies.accountRotationSettings
      ? { accountRotationSettings: dependencies.accountRotationSettings }
      : {}),
    ...(log ? { logger: log } : {}),
  });

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

  /** 读该供应商的连接列表 + 当前绑定；供应商不存在返回 undefined。 */
  const readBindingContext = async (
    providerId: string,
  ): Promise<ProviderBindingContext | undefined> => {
    // zai / bigmodel 的账号不属于任何单个 provider，走 family 伪 providerId 分支。
    const family = resolveAccountFamilyProviderId(providerId);
    if (family) {
      return accountFamily.readBindingContext(family);
    }
    const view = await dependencies.getProviderSettingsView();
    const provider = view.providers.find((item) => item.providerId === providerId);
    if (!provider) {
      return undefined;
    }
    const requestProfile = provider.effectiveConfig.requestProfile ?? undefined;
    // 连接列表只对多账号供应商查询（qoder / codebuddy）；其他供应商没有「连接」概念，
    // 跳过查询既省一次凭据读取，也天然不给这类供应商提供代理池入口。
    const accounts = supportsAccountBinding(requestProfile, provider.providerId)
      ? await dependencies
          .listProviderAccounts(providerId, requestProfile)
          .catch((error: unknown) => {
            log?.warn(`[proxy-pool] list connections failed for ${providerId}:`, error);
            return [];
          })
      : [];
    return {
      providerId,
      requestProfile,
      group: provider.effectiveConfig.group ?? undefined,
      connectionIds: accounts.map((account) => account.id),
      binding: provider.effectiveConfig.api?.proxy ?? undefined,
    };
  };

  /**
   * 把 provider 绑定里的快照刷新到最新池列表。
   *
   * 在池增删改后调用：指向**已删除或已停用**条目的绑定会被丢弃（该连接回到「未绑定」=
   * 跟随全局代理），改名/改 URL/改 noProxy/改 strictProxy 的条目就地更新，避免 agent 侧
   * 拿到过期 URL。单个供应商刷新失败不阻断池保存；下次池变更会重试。
   */
  const syncProviderBindings = async (pools: ProxyPoolEntry[]): Promise<void> => {
    const view = await dependencies.getProviderSettingsView();
    for (const provider of view.providers) {
      const binding = provider.effectiveConfig.api?.proxy;
      if (!binding) {
        continue;
      }
      const next = refreshProviderProxyBinding(binding, pools);
      if (JSON.stringify(next) === JSON.stringify(binding)) {
        continue;
      }
      try {
        await dependencies.saveProviderProxy(provider.providerId as ProviderId, next ?? null);
      } catch (error) {
        log?.warn(
          `[proxy-pool] refresh binding snapshot failed for ${provider.providerId}:`,
          error,
        );
      }
    }
  };

  /** 写入绑定表；空表写 null（让 overlay 显式覆盖掉旧值，不留空壳字段）。 */
  const writeBinding = async (
    providerId: string,
    binding: ProviderProxyBinding | undefined,
  ): Promise<void> => {
    const family = resolveAccountFamilyProviderId(providerId);
    if (family) {
      await accountFamily.writeBinding(family, binding);
      return;
    }
    await dependencies.saveProviderProxy(providerId as ProviderId, binding ?? null);
  };

  return {
    async getState(): Promise<ProxyPoolState> {
      const pools = await readPools();
      return { pools, providers: await views.buildProviderViews(pools) };
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
        ...(input.strictProxy ? { strictProxy: true } : {}),
      };
      const nextPools =
        existingIndex >= 0
          ? pools.map((pool, index) => (index === existingIndex ? entry : pool))
          : [...pools, entry];
      await writePools(nextPools);
      await syncProviderBindings(nextPools);
      log?.info(`[proxy-pool] saved pool ${entry.id} (${entry.type})`);
      return { pools: nextPools, providers: await views.buildProviderViews(nextPools) };
    },

    async deletePool(poolId: string): Promise<ProxyPoolState> {
      const pools = await readPools();
      const nextPools = pools.filter((pool) => pool.id !== poolId);
      if (nextPools.length === pools.length) {
        return { pools, providers: await views.buildProviderViews(pools) };
      }
      await writePools(nextPools);
      await syncProviderBindings(nextPools);
      return { pools: nextPools, providers: await views.buildProviderViews(nextPools) };
    },

    async setPoolActive(poolId: string, isActive: boolean): Promise<ProxyPoolState> {
      const pools = await readPools();
      const nextPools = pools.map((pool) => (pool.id === poolId ? { ...pool, isActive } : pool));
      await writePools(nextPools);
      // 停用 = 引用它的连接回到「跟随全局」：syncProviderBindings 会把指向停用条目的
      // 绑定摘掉（refreshProviderProxyBinding 只保留启用中的池）。启用则相反——被摘掉的
      // 绑定不会自动恢复，需要用户重新选一次。
      await syncProviderBindings(nextPools);
      return { pools: nextPools, providers: await views.buildProviderViews(nextPools) };
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

    async getProviderBinding(providerId: string): Promise<ProxyProviderBindingView | null> {
      return views.readProviderView(providerId, await readPools());
    },

    async getProviderProxyBinding(
      providerId: string,
    ): Promise<ProviderProxyBinding | undefined> {
      // 直读 effectiveConfig：UI 视图会按能力裁掉 provider 级出口（无 group 的
      // 免费供应商会被 drop），但请求侧仍按原始绑定出站——记账要显示真实出口。
      const view = await dependencies.getProviderSettingsView();
      const provider = view.providers.find((item) => item.providerId === providerId);
      return provider?.effectiveConfig.api?.proxy ?? undefined;
    },

    async saveAccountBinding(
      providerId: string,
      accountId: string,
      poolId: string | null,
    ): Promise<ProxyProviderBindingView | null> {
      const pools = await readPools();
      const context = await readBindingContext(providerId);
      if (!context) return null;
      // 停用池与不存在的池同等对待：停用后引用它的连接已回到「跟随全局」，
      // 允许写回一条停用绑定只会造出一读就被 read-repair 摘掉的幽灵绑定。
      const entry = poolId ? pools.find((pool) => pool.id === poolId && pool.isActive) : undefined;
      if (poolId && !entry) {
        // 池在提交前被删了/停用了：按「取消绑定」处理，不留一个永远选不中的值。
        log?.warn(
          `[proxy-pool] pool ${poolId} missing or inactive, clearing binding for ${accountId}`,
        );
      }
      const next = assignProxyPoolToBindings(context.binding, [accountId], entry);
      await writeBinding(providerId, next);
      return views.readProviderView(providerId, pools);
    },

    async applyPoolToAllAccounts(
      providerId: string,
      poolId: string | null,
    ): Promise<ProxyProviderBindingView | null> {
      const pools = await readPools();
      const context = await readBindingContext(providerId);
      if (!context) return null;
      if (context.connectionIds.length === 0) {
        // 没有可绑定的连接：不改任何东西。poolId 非空说明用户在没有连接的供应商上操作，
        // 静默写一条无人引用的绑定只会让下次读取时凭空多出条目。
        return views.readProviderView(providerId, pools);
      }
      // 同 saveAccountBinding：停用条目按「不存在」处理，不写进绑定表。
      const entry = poolId ? pools.find((pool) => pool.id === poolId && pool.isActive) : undefined;
      const next = assignProxyPoolToBindings(context.binding, context.connectionIds, entry);
      await writeBinding(providerId, next);
      log?.info(
        `[proxy-pool] applied ${entry ? `pool ${entry.id}` : "no binding"} to ${
          context.connectionIds.length
        } connection(s) of ${providerId}`,
      );
      return views.readProviderView(providerId, pools);
    },

    async distributePools(
      providerId: string,
      poolIds: string[],
    ): Promise<ProxyProviderBindingView | null> {
      const pools = await readPools();
      const context = await readBindingContext(providerId);
      if (!context) return null;
      const byId = new Map(pools.map((pool) => [pool.id, pool]));
      // 保持用户在 UI 里选中的顺序：轮询语义依赖顺序，不能按池列表顺序重排。
      const entries = poolIds
        .map((poolId) => byId.get(poolId))
        .filter((entry): entry is ProxyPoolEntry => Boolean(entry));
      if (entries.length === 0 || context.connectionIds.length === 0) {
        return views.readProviderView(providerId, pools);
      }
      const next = distributeProxyPoolsToBindings(context.binding, context.connectionIds, entries);
      await writeBinding(providerId, next);
      log?.info(
        `[proxy-pool] distributed ${entries.length} pool(s) over ${context.connectionIds.length} connection(s) of ${providerId}`,
      );
      return views.readProviderView(providerId, pools);
    },

    async saveProviderBinding(
      providerId: string,
      input: { strategy: ProviderProxyRotationStrategy; poolIds: string[] } | null,
    ): Promise<ProxyProviderBindingView | null> {
      const pools = await readPools();
      const context = await readBindingContext(providerId);
      if (!context) return null;
      if (!supportsProviderBinding(context.providerId, context.group, context.requestProfile)) {
        log?.warn(`[proxy-pool] ${providerId} has no provider-level binding capability`);
        return views.readProviderView(providerId, pools);
      }
      const byId = new Map(pools.map((pool) => [pool.id, pool]));
      const strategy = input?.strategy ?? "none";
      // 三种策略都只认用户显式选中的池：
      // - 固定线路：取第一条；
      // - 轮询/随机：取选中的全部（用户要的是「在这几条之间切」，不是「所有启用池都参与」）。
      // 传了 id 但都已停用/删除时 entries 为空，走下面的 clear 分支，不静默扩大候选集。
      const requested = (input?.poolIds ?? [])
        .map((poolId) => byId.get(poolId))
        .filter((entry): entry is ProxyPoolEntry => Boolean(entry?.isActive));
      const entries = strategy === "none" ? requested.slice(0, 1) : requested;
      const rotation =
        input && entries.length > 0
          ? {
              strategy,
              pools: entries,
            }
          : undefined;
      if (input && entries.length === 0) {
        log?.warn(
          `[proxy-pool] no active pool selected for ${providerId}, clearing provider binding`,
        );
      }
      const next = assignProviderProxyRotation(context.binding, rotation);
      await writeBinding(providerId, next);
      log?.info(
        `[proxy-pool] provider binding for ${providerId}: ${
          rotation ? `${rotation.strategy} × ${rotation.pools.length}` : "cleared"
        }`,
      );
      return views.readProviderView(providerId, pools);
    },

    async saveAccountRotation(
      providerId: string,
      settings: AccountRotationSettings,
    ): Promise<ProxyProviderBindingView | null> {
      const pools = await readPools();
      const context = await readBindingContext(providerId);
      if (!context) return null;
      if (
        !supportsAccountBinding(context.requestProfile, context.providerId) ||
        !dependencies.accountRotationSettings
      ) {
        log?.warn(`[proxy-pool] ${providerId} has no account rotation capability`);
        return views.readProviderView(providerId, pools);
      }
      await dependencies.accountRotationSettings.save(providerId, settings);
      log?.info(
        `[proxy-pool] account rotation for ${providerId}: ${settings.strategy} (sticky ${settings.stickyLimit})`,
      );
      return views.readProviderView(providerId, pools);
    },
  };
}
