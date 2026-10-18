/**
 * zai / bigmodel「账号族」的伪 provider 绑定分支（从 proxyPoolService 拆出，控制单文件行数）。
 *
 * 这两家的账号是 Coding Plan 的 **OAuth 账号**，挂在 oauthCredentialRepo 上，不属于任何单个
 * provider：一个 family 下有 start-plan / individual / team 等多个 provider，共享同一份账号表。
 * 因此 UI 用 family id 作为**伪 providerId** 访问这张表，绑定则整族同步写到每个成员 provider 的
 * `api.proxy`，agent 只会读到它本次实际使用的那一个。
 */
import type { ModelProviderFamilyId, ProviderProxyBinding, ProxyPoolEntry } from "@zcode/shared";
import { getModelProviderFamilySpec, refreshProviderProxyBinding } from "@zcode/shared";
import type { ProviderId, ProviderSettingsProviderView } from "@zcode/provider";
import type { AccountRotationSettings } from "../model-provider/accountRotation.js";
import type {
  ProviderBindingContext,
  ProxyProviderAccountView,
  ProxyProviderBindingView,
} from "./proxyPool.js";

export interface AccountFamilyBindingDeps {
  /** Provider 设置视图读取；「谁属于这个账号族」的权威信息在 provider 的 access 字段里。 */
  getProviderSettingsView: () => Promise<{ providers: readonly ProviderSettingsProviderView[] }>;
  /** 保存某成员 provider 的 api.proxy；传 null 表示清除绑定。 */
  saveProviderProxy: (
    providerId: ProviderId,
    binding: ProviderProxyBinding | null,
  ) => Promise<unknown>;
  /** 读取某 family 的账号（连接）列表。 */
  listProviderAccounts: (
    providerId: string,
    requestProfile: string | undefined,
  ) => Promise<ProxyProviderAccountView[]>;
  accountRotationSettings?: {
    get(providerId: string): Promise<AccountRotationSettings>;
    save(providerId: string, settings: AccountRotationSettings): Promise<void>;
  };
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export interface AccountFamilyBinding {
  readBindingContext(family: ModelProviderFamilyId): Promise<ProviderBindingContext>;
  writeBinding(
    family: ModelProviderFamilyId,
    binding: ProviderProxyBinding | undefined,
  ): Promise<void>;
  buildView(
    family: ModelProviderFamilyId,
    pools: ProxyPoolEntry[],
  ): Promise<ProxyProviderBindingView>;
}

export function createAccountFamilyBinding(
  dependencies: AccountFamilyBindingDeps,
): AccountFamilyBinding {
  const log = dependencies.logger;

  /**
   * zai / bigmodel 的 family 成员 provider。
   *
   * 判据用 access（type=zhipu-account + accountType=family）而不是 providerId 前缀：同族
   * provider 的 id 会随套餐/模式增删（start-plan / individual / team / off-peak idle 都存在
   * 过），「谁属于这个账号族」的权威信息只在 access 里。
   */
  const resolveFamilyProviders = async (
    family: ModelProviderFamilyId,
  ): Promise<ProviderSettingsProviderView[]> => {
    const view = await dependencies.getProviderSettingsView();
    return view.providers.filter((provider) => {
      const access = provider.effectiveConfig.access;
      if (!access || access.type !== "zhipu-account") {
        return false;
      }
      return access.accountType === family;
    });
  };

  /**
   * family 级绑定表的读。
   *
   * 同族 provider 共享同一份账号表，也就必须共享同一份绑定表：取第一个带绑定的成员作为
   * 权威值（写入是整族同步写的，正常情况下它们始终一致）。
   */
  const readFamilyBinding = async (
    family: ModelProviderFamilyId,
  ): Promise<ProviderProxyBinding | undefined> => {
    for (const provider of await resolveFamilyProviders(family)) {
      const binding = provider.effectiveConfig.api?.proxy;
      if (binding) {
        return binding;
      }
    }
    return undefined;
  };

  /** family 级绑定表的写：整族同步写，这样 agent 用哪个成员 provider 都读到同一份绑定。 */
  const writeBinding = async (
    family: ModelProviderFamilyId,
    binding: ProviderProxyBinding | undefined,
  ): Promise<void> => {
    for (const provider of await resolveFamilyProviders(family)) {
      await dependencies.saveProviderProxy(provider.providerId as ProviderId, binding ?? null);
    }
  };

  const readFamilyAccounts = async (
    family: ModelProviderFamilyId,
  ): Promise<ProxyProviderAccountView[]> =>
    dependencies.listProviderAccounts(family, undefined).catch((error: unknown) => {
      log?.warn(`[proxy-pool] list connections failed for ${family}:`, error);
      return [];
    });

  return {
    async readBindingContext(family) {
      const accounts = await readFamilyAccounts(family);
      return {
        providerId: family,
        connectionIds: accounts.map((account) => account.id),
        binding: await readFamilyBinding(family),
      };
    },

    writeBinding,

    /**
     * family 视图：账号行按 OAuth 账号表渲染，出口绑定是同族共享的那一份。
     *
     * 不走 buildProviderView：family 不是 provider（没有 providerId 对应的 config），
     * 但它有完整的「多账号 + 轮询 + 连接级出口」语义，所以投影形状与 provider 视图一致，
     * UI 侧可以直接复用 ProviderAccountBinding / ProviderAccountRotationControl。
     */
    async buildView(family, pools) {
      const stored = await readFamilyBinding(family);
      // 与 provider 视图同一套 read-repair：停用/删除的池会让绑定失效，顺手落盘。
      const binding = refreshProviderProxyBinding(stored, pools);
      if (JSON.stringify(binding) !== JSON.stringify(stored)) {
        try {
          await writeBinding(family, binding);
        } catch (error) {
          log?.warn(`[proxy-pool] heal binding failed for ${family}:`, error);
        }
      }
      const accounts = await readFamilyAccounts(family);
      // 单账号没有轮询意义；读取失败按「未配置」处理，不阻断整个视图。
      const accountRotation =
        accounts.length >= 2 && dependencies.accountRotationSettings
          ? await dependencies.accountRotationSettings.get(family).catch(() => undefined)
          : undefined;
      return {
        providerId: family,
        providerName: getModelProviderFamilySpec(family).label,
        // 账号表为空（未登录）时不提供连接级入口。
        supportsConnections: accounts.length > 0,
        // provider 级出口只给「无账号免费档」；family 有账号，走连接级绑定。
        supportsProviderBinding: false,
        accounts: accounts.map((account) => ({
          ...account,
          ...(binding?.bindings[account.id]
            ? { boundEntryId: binding.bindings[account.id]!.id }
            : {}),
        })),
        pools,
        ...(binding ? { binding } : {}),
        ...(accountRotation ? { accountRotation } : {}),
      };
    },
  };
}
