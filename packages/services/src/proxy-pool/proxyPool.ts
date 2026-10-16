/**
 * 代理池服务契约（browser-safe）。
 *
 * 只放接口、描述符与视图类型：renderer 需要它们做类型与 descriptor 解析，
 * 但**不能**把实现带进来——实现依赖 settingService、provider facade 与 undici，
 * 属于 host 侧装配（见 proxyPoolService.ts）。
 * 这与 setting.ts / settingService.ts 的既有拆分同惯例。
 */
import type { ProviderProxyBinding, ProxyPoolEntry } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 供应商绑定的 UI 投影：绑定 + 该供应商的账号列表（多账号供应商才有）。 */
export interface ProxyProviderBindingView {
  providerId: string;
  providerName: string;
  /** 供应商的请求画像；qoder / codebuddy 表示支持账号级绑定。 */
  requestProfile?: string;
  /** 当前绑定；未配置时为 undefined（等价于「不使用代理」）。 */
  binding?: ProviderProxyBinding;
  /** 该供应商已知账号；无账号概念时为空数组。 */
  accounts: ProxyProviderAccountView[];
}

export interface ProxyProviderAccountView {
  id: string;
  displayName: string;
  email?: string;
  active: boolean;
  /** 该账号当前绑定的池条目 id；未绑定时为 undefined（走策略）。 */
  boundEntryId?: string;
}

export interface ProxyPoolState {
  pools: ProxyPoolEntry[];
  providers: ProxyProviderBindingView[];
}

export interface ProxyPoolSaveInput {
  /** 省略表示新建；提供则按 id 更新。 */
  id?: string;
  name: string;
  proxyUrl: string;
  noProxy?: string;
  isActive?: boolean;
}

/** 绑定写入输入；enabled=false 或 entryIds 为空时按「清除绑定」处理。 */
export interface ProxyProviderBindingSaveInput {
  enabled: boolean;
  strategy: ProviderProxyBinding["strategy"];
  entryIds: string[];
  /** accountId → entryId；多账号供应商用。 */
  accountBindings?: Record<string, string>;
  noProxy?: string;
}

/** 连通性测试结果；形状与 proxyTest 的返回值一致（此处避免 host 依赖，故独立声明）。 */
export interface ProxyPoolTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  elapsedMs?: number;
  error?: string;
}

export interface IProxyPoolService {
  getState(): Promise<ProxyPoolState>;
  savePool(input: ProxyPoolSaveInput): Promise<ProxyPoolState>;
  deletePool(poolId: string): Promise<ProxyPoolState>;
  setPoolActive(poolId: string, isActive: boolean): Promise<ProxyPoolState>;
  /** 按 poolId 或直接给 proxyUrl 测试连通性；返回真实耗时与状态码。 */
  testPool(input: {
    poolId?: string;
    proxyUrl?: string;
    testUrl?: string;
  }): Promise<ProxyPoolTestResult>;
  /** 保存或清除某个供应商的代理绑定；传 null 表示清除。 */
  saveProviderBinding(
    providerId: string,
    input: ProxyProviderBindingSaveInput | null,
  ): Promise<ProxyPoolState>;
  /** 读取单个供应商的代理绑定视图（含账号列表）；用于供应商账号区内联选择器。 */
  getProviderBinding(
    providerId: string,
  ): Promise<ProxyProviderBindingView | null>;
  /**
   * 只改某个账号的绑定：entryId 传 null 表示「跟随策略」。返回更新后的该供应商绑定视图。
   * 只动 accountBindings[accountId]，保留该供应商的其他绑定与策略。
   */
  saveAccountBinding(
    providerId: string,
    accountId: string,
    entryId: string | null,
  ): Promise<ProxyProviderBindingView | null>;
}

export const IProxyPoolService = createServiceDescriptor<IProxyPoolService>(
  ServiceChannels.ProxyPool,
);

/** 支持账号级代理绑定的 requestProfile。 */
export function supportsAccountBinding(requestProfile: string | undefined): boolean {
  return requestProfile === "qoder" || requestProfile === "codebuddy";
}
