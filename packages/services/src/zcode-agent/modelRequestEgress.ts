import type { IProxyPoolService } from "../proxy-pool/proxyPool.js";

/**
 * 「使用详情」要展示的本次请求身份：账号与出口代理。
 *
 * - 账号：多账号供应商（Qoder / CodeBuddy）每次物理请求可能命中不同账号，
 *   只看 provider_id 分不出来，必须带上账号 id 与显示名。
 * - 出口代理：代理池按「供应商 → 连接」两级绑定，连接级绑定优先于 provider 级；
 *   两者都没有则跟随全局代理状态，缺席即可。
 */
export interface ModelRequestEgress {
  accountId?: string;
  accountDisplayName?: string;
  proxyPoolId?: string;
  proxyDisplayName?: string;
}

interface ProxyPoolEntryLike {
  id: string;
  name?: string;
}

interface ProxyAccountLike {
  id: string;
  displayName?: string;
}

interface ProxyBindingLike {
  bindings?: Record<string, ProxyPoolEntryLike>;
  provider?: {
    strategy?: "none" | "round-robin" | "random";
    pools?: ProxyPoolEntryLike[];
  };
}

/**
 * 解析某条连接的出口代理与账号显示名。
 *
 * 连接级绑定优先于 provider 级绑定；都没有时返回空（跟随全局代理状态）。
 */
export async function resolveConnectionEgress(
  proxyPoolService: IProxyPoolService | undefined,
  providerId: string,
  connectionId: string | undefined,
): Promise<ModelRequestEgress> {
  if (!proxyPoolService) return {};
  let binding: ProxyBindingLike | undefined;
  let accountDisplayName: string | undefined;
  try {
    // 出口取原始绑定（不过 UI 视图过滤）；账号显示名走视图（账号列表只在视图里）。
    binding = await proxyPoolService.getProviderProxyBinding(providerId);
    const view = await proxyPoolService.getProviderBinding(providerId);
    accountDisplayName = view?.accounts?.find((item) => item.id === connectionId)?.displayName;
  } catch {
    return {};
  }
  if (!binding) {
    return accountDisplayName ? { accountDisplayName } : {};
  }

  // 连接级绑定优先；provider 级出口是无账号供应商（OpenCode Free / Kilo Free）的 per-request 出口。
  const boundPool = connectionId ? binding.bindings?.[connectionId] : undefined;
  if (boundPool) {
    return {
      ...(accountDisplayName ? { accountDisplayName } : {}),
      proxyPoolId: boundPool.id,
      ...(boundPool.name ? { proxyDisplayName: boundPool.name } : {}),
    };
  }

  const rotation = binding.provider;
  const pools = rotation?.pools ?? [];
  const pool = pools[0];
  if (!pool) {
    return accountDisplayName ? { accountDisplayName } : {};
  }
  // 轮询/随机是 per-request 选择：这里只有候选快照，**不能**当成实际出口写死。
  // 写第一条会让「使用详情」永远显示同一个池；写「轮询 N 个池」也不是节点名。
  // 真实命中的节点由 adapter 在 fetch 层回报（见 ModelInvocationContext.reportResolvedEgress）。
  if ((rotation?.strategy === "round-robin" || rotation?.strategy === "random") && pools.length > 1) {
    return accountDisplayName ? { accountDisplayName } : {};
  }
  return {
    ...(accountDisplayName ? { accountDisplayName } : {}),
    proxyPoolId: pool.id,
    ...(pool.name ? { proxyDisplayName: pool.name } : {}),
  };
}
