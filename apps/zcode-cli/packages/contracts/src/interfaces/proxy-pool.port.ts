// ============================================================
// Proxy Pool Port - agent-side proxy-pool configuration boundary
// ============================================================
// 与 AutomationPort / OffPeakPort 兄弟并列。这里只放「agent 能读写的那部分配置面」的窄类型，
// 刻意不 import services 的视图类型：那些是 renderer/host 侧投影，会拖进 settingService 与
// provider facade。形状逐字镜像 IProxyPoolService，真正的跨层契约是协议 schema。
//
// 语义（与设置页「代理出口」下拉逐字一致，不得自行发明第三种状态）：
// - 绑定了某条池的连接：该连接的供应商请求（登录 / 模型请求 / 签到）走这条池，
//   且**完全不再经过 XCode 全局代理**；
// - 未绑定的连接：出口跟随 XCode 全局代理状态（设了全局代理就用，没设就走直连）；
// - 绑定但该池被停用或地址无效：硬直连——绝不回落全局代理。
// 绑定单位是**单条连接**（= 一个账号 / 一份凭据），没有供应商级启用开关，没有策略与轮询配置。

import type {
  ProxyPoolAccountView,
  ProxyPoolEntryView,
  ProxyPoolProviderSummary,
  ProxyPoolProviderView,
  ProxyPoolTestOutcome,
} from "../tools/proxy-pool.js";

// 视图类型（池条目 / 账号 / 供应商详情与摘要 / 探针结果）的唯一来源是
// tools/proxy-pool.ts 里那套 zod schema——它们是 host 输出的校验边界，这里只做转发，
// 不再自己写一份同形 interface（两份同名导出会在 contracts 桶文件里撞成 TS2308）。
//
// 字段语义速查：
// - ProxyPoolEntryView.type 由 host 从 proxyUrl 推导（http / https / socks4 / socks5），不接受手工指定；
// - ProxyPoolAccountView.boundEntryId 缺席即「未绑定 = 出口跟随 XCode 全局代理状态」；
// - ProxyPoolProviderSummary.accountCount - boundAccountCount = 跟随全局代理的连接数；
// - ProxyPoolTestOutcome.exitIp 是探针回显的真实出口 IP，用来确认请求确实走了这条池。
export type {
  ProxyPoolAccountView,
  ProxyPoolEntryView,
  ProxyPoolProviderSummary,
  ProxyPoolProviderView,
  ProxyPoolTestOutcome,
};

/** 目录里的供应商摘要与全量池；一次 list 的结果。 */
export interface ProxyPoolCatalog {
  pools: ProxyPoolEntryView[];
  providers: ProxyPoolProviderSummary[];
}

export interface ProxyPoolSaveRequest {
  /** 省略 = 新建（id 由 host 生成，模型不能指定）；提供 = 按 id 更新。 */
  poolId?: string;
  name: string;
  proxyUrl: string;
  noProxy?: string;
  isActive?: boolean;
  strictProxy?: boolean;
}

/**
 * 代理池配置端口。所有写操作返回**改动后的全量目录**，让模型每次都能看到当前真值，
 * 不必再额外 list 一次（也避免了「写完读回旧缓存」这一类不一致）。
 */
export interface ProxyPoolPort {
  /** 全量池列表 + 支持连接的供应商摘要。 */
  listCatalog(): Promise<ProxyPoolCatalog>;
  /** 单供应商详情：账号列表 + 每个账号已绑定的池。 */
  getProvider(providerId: string): Promise<ProxyPoolProviderView>;
  save(input: ProxyPoolSaveRequest): Promise<ProxyPoolCatalog>;
  remove(poolId: string): Promise<ProxyPoolCatalog>;
  setActive(poolId: string, isActive: boolean): Promise<ProxyPoolCatalog>;
  /** 按 poolId 或直接给 proxyUrl 测连通性；返回真实耗时、状态码与出口 IP。 */
  test(input: { poolId?: string; proxyUrl?: string; testUrl?: string }): Promise<ProxyPoolTestOutcome>;
  /** 只改一条连接的绑定；poolId 传 null = 取消绑定（回到「跟随全局代理状态」）。 */
  bindAccount(input: {
    providerId: string;
    accountId: string;
    poolId: string | null;
  }): Promise<ProxyPoolProviderView>;
  /** 批量：把同一条池套用到该供应商的全部连接；poolId 传 null = 全部取消绑定。 */
  applyToAll(input: { providerId: string; poolId: string | null }): Promise<ProxyPoolProviderView>;
  /**
   * 批量：按顺序把多个池轮流分配给全部连接（每条连接固定拿一个池，不是每次请求换）。
   * poolIds 为空数组 = 由 host 取当前全部启用的池，按列表顺序。
   */
  distribute(input: { providerId: string; poolIds: string[] }): Promise<ProxyPoolProviderView>;
}
