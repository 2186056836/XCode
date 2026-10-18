/**
 * 代理池的**视图投影**（UI 形状），从 proxyPoolService 拆出。
 *
 * 服务本身只做两件事：池条目 CRUD 与绑定读写；「把绑定讲成 UI 能消费的形状」是第三种职责，
 * 且要同时覆盖真实供应商（provider config + requestProfile）与 zai / bigmodel 的 family 伪
 * provider，单独成模块才不至于把服务堆成上帝对象。
 *
 * 所有视图都做 read-repair：入口处按当前池列表重算一次绑定（停用/删除的池会让引用失效），
 * 与存量不一致就顺手落盘——否则「已停用仍被引用」的存量绑定会一直留在 provider config 里，
 * UI 显示回到「跟随全局」而 agent 侧快照还是旧的。
 */
import type { ProviderProxyBinding, ProxyPoolEntry } from "@zcode/shared";
import { dropProviderProxyRotation, refreshProviderProxyBinding } from "@zcode/shared";
import type { ProviderId, ProviderSettingsProviderView } from "@zcode/provider";
import type { AccountRotationSettings } from "../model-provider/accountRotation.js";
import type { AccountFamilyBinding } from "./proxyPoolFamilyBinding.js";
import {
  resolveAccountFamilyProviderId,
  supportsAccountBinding,
  supportsProviderBinding,
  type ProxyProviderAccountView,
  type ProxyProviderBindingView,
} from "./proxyPool.js";

export interface ProxyPoolViewDeps {
  getProviderSettingsView: () => Promise<{ providers: readonly ProviderSettingsProviderView[] }>;
  saveProviderProxy: (
    providerId: ProviderId,
    binding: ProviderProxyBinding | null,
  ) => Promise<unknown>;
  listProviderAccounts: (
    providerId: string,
    requestProfile: string | undefined,
  ) => Promise<ProxyProviderAccountView[]>;
  accountFamily: AccountFamilyBinding;
  accountRotationSettings?: {
    get(providerId: string): Promise<AccountRotationSettings>;
    save(providerId: string, settings: AccountRotationSettings): Promise<void>;
  };
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface ProxyPoolViews {
  buildProviderViews(pools: ProxyPoolEntry[]): Promise<ProxyProviderBindingView[]>;
  readProviderView(
    providerId: string,
    pools: ProxyPoolEntry[],
  ): Promise<ProxyProviderBindingView | null>;
}

export function createProxyPoolViews(dependencies: ProxyPoolViewDeps): ProxyPoolViews {
  const log = dependencies.logger;

  /** 组装单个供应商的 UI 视图；绑定表始终以当前池列表为准刷新。 */
  const buildProviderView = async (
    provider: ProviderSettingsProviderView,
    pools: ProxyPoolEntry[],
  ): Promise<ProxyProviderBindingView> => {
    const effective = provider.effectiveConfig;
    const requestProfile = effective.requestProfile ?? undefined;
    const supportsConnections = supportsAccountBinding(requestProfile);
    const providerBindingSupported = supportsProviderBinding(
      provider.providerId,
      effective.group,
      requestProfile,
    );
    // 快照可能落后于刚编辑的池（保存顺序/并发），视图里重算一次，UI 才能看到真实生效值。
    const stored = effective.api?.proxy ?? undefined;
    const refreshed = refreshProviderProxyBinding(stored, pools);
    // 不支持的供应商（如自带 key 的「冇名AI」）要连**存量配置**一起摘掉：只藏 UI 入口不够，
    // agent 侧仍会照旧绕池，UI 与真实出口就不一致了。
    const binding = providerBindingSupported ? refreshed : dropProviderProxyRotation(refreshed);
    if (JSON.stringify(binding) !== JSON.stringify(stored)) {
      try {
        await dependencies.saveProviderProxy(provider.providerId as ProviderId, binding ?? null);
      } catch (error) {
        log?.warn(`[proxy-pool] heal binding failed for ${provider.providerId}:`, error);
      }
    }
    const accounts = supportsConnections
      ? await dependencies
          .listProviderAccounts(provider.providerId, requestProfile)
          .catch((error: unknown) => {
            log?.warn(`[proxy-pool] list connections failed for ${provider.providerId}:`, error);
            return [];
          })
      : [];
    // 单账号没有轮询意义；读取失败按「未配置」处理，不阻断整个视图。
    const accountRotation =
      supportsConnections && accounts.length >= 2 && dependencies.accountRotationSettings
        ? await dependencies.accountRotationSettings.get(provider.providerId).catch(() => undefined)
        : undefined;
    return {
      providerId: provider.providerId,
      providerName: provider.providerName ?? provider.providerId,
      requestProfile,
      ...(binding ? { binding } : {}),
      accounts: accounts.map((account) => ({
        ...account,
        ...(binding?.bindings[account.id]
          ? { boundEntryId: binding.bindings[account.id]!.id }
          : {}),
      })),
      pools,
      supportsConnections,
      supportsProviderBinding: providerBindingSupported,
      ...(binding?.provider && providerBindingSupported
        ? {
            providerBinding: {
              strategy: binding.provider.strategy,
              poolIds: binding.provider.pools.map((pool) => pool.id),
            },
          }
        : {}),
      ...(accountRotation ? { accountRotation } : {}),
    };
  };

  return {
    async buildProviderViews(pools) {
      const view = await dependencies.getProviderSettingsView();
      const result: ProxyProviderBindingView[] = [];
      for (const provider of view.providers) {
        result.push(await buildProviderView(provider, pools));
      }
      return result;
    },

    async readProviderView(providerId, pools) {
      // zai / bigmodel：账号不属于任何单个 provider，走 family 伪 providerId 分支。
      const family = resolveAccountFamilyProviderId(providerId);
      if (family) {
        return dependencies.accountFamily.buildView(family, pools);
      }
      const view = await dependencies.getProviderSettingsView();
      const provider = view.providers.find((item) => item.providerId === providerId);
      return provider ? buildProviderView(provider, pools) : null;
    },
  };
}
