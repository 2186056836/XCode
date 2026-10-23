/**
 * 代理池服务契约（browser-safe）。
 *
 * 只放接口、描述符与视图类型：renderer 需要它们做类型与 descriptor 解析，
 * 但**不能**把实现带进来——实现依赖 settingService、provider facade 与 undici，
 * 属于 host 侧装配（见 proxyPoolService.ts）。
 * 这与 setting.ts / settingService.ts 的既有拆分同惯例。
 *
 * 绑定单位是**单条连接**（= 一个账号 / 一份凭据），对齐 9router 的
 * `connection.providerSpecificData.proxyPoolId`；无账号免费档另有 provider 级出口与轮询。
 * 「绑定某池」与「未绑定」只有两种状态：绑了就走池并屏蔽全局代理，没绑就跟随全局代理状态。
 *
 * 本契约同时承载**账号轮询设置**（fill-first / round-robin + sticky）的读写：账号行与
 * 绑定行在同一处渲染，UI 无需再接第二个服务。
 */
import type {
  ProviderProxyBinding,
  ProviderProxyRotationStrategy,
  ProxyPoolEntry,
} from "@zcode/shared";
import type { AccountRotationSettings } from "../model-provider/accountRotation.js";
import { BIGMODEL_PROVIDER_ID, ServiceChannels, ZAI_PROVIDER_ID } from "@zcode/shared";
import type { ModelProviderFamilyId } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 供应商绑定的 UI 投影：连接级绑定表 + 该供应商的连接（账号）列表 + 可选的全局池列表。 */
export interface ProxyProviderBindingView {
  providerId: string;
  providerName: string;
  /** 供应商的请求画像；qoder / codebuddy 表示有「连接」概念。 */
  requestProfile?: string;
  /** 当前绑定表；一条都没绑时为 undefined。 */
  binding?: ProviderProxyBinding;
  /** 该供应商已知连接（账号）；无连接概念时为空数组。 */
  accounts: ProxyProviderAccountView[];
  /**
   * 全局池列表（含停用条目）——内联选择器的候选项。
   * 不复用 binding.entries：那是「已绑定条目的快照」，没绑过池时是空的，列不出候选。
   */
  pools: ProxyPoolEntry[];
  /** 该供应商是否存在可绑定的连接；false 时 UI 不提供连接级入口。 */
  supportsConnections: boolean;
  /**
   * 该供应商是否支持**供应商级**出口（无账号的免费供应商，如 OpenCode Free / Kilo Free）。
   * 这类供应商没有 connection 可绑，但上游按出口 IP 风控，需要在 provider 级配池与轮询。
   */
  supportsProviderBinding: boolean;
  /** 供应商级出口的 UI 投影；未配置时为 undefined（= 跟随全局代理状态）。 */
  providerBinding?: ProxyProviderRotationView;
  /**
   * 账号轮询设置；只有存在 ≥2 个连接的供应商才有意义（单账号无需轮询）。
   * 缺省值见 DEFAULT_ACCOUNT_ROTATION_SETTINGS（fill-first / sticky 3）。
   */
  accountRotation?: AccountRotationSettings;
}

export interface ProxyProviderRotationView {
  strategy: ProviderProxyRotationStrategy;
  /** 候选池 id，按轮询顺序。 */
  poolIds: string[];
}

export interface ProxyProviderAccountView {
  id: string;
  displayName: string;
  email?: string;
  active: boolean;
  /** 该连接绑定的池条目 id；未绑定为 undefined（= 出口跟随全局代理状态）。 */
  boundEntryId?: string;
}

/**
 * 单次绑定操作的上下文：目标（供应商或 family 伪 provider）的连接列表 + 当前绑定。
 *
 * 由 proxyPoolService（真实供应商）与 proxyPoolFamilyBinding（zai / bigmodel 账号族）各自产出，
 * 绑定写入的三个入口共用同一形状。
 */
export interface ProviderBindingContext {
  providerId: string;
  requestProfile?: string;
  /** 供应商分组；free 组（无账号免费档）走 provider 级出口。 */
  group?: string;
  /** 可绑定的连接 id（账号）；无连接概念的供应商为空数组。 */
  connectionIds: string[];
  binding: ProviderProxyBinding | undefined;
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
  /** 严格模式：代理建连失败直接报错，而不是回退直连。 */
  strictProxy?: boolean;
}

/** 连通性测试结果；形状与 proxyTest 的返回值一致（此处避免 host 依赖，故独立声明）。 */
export interface ProxyPoolTestResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  url?: string;
  elapsedMs?: number;
  /** 探针回显的出口 IP；有值时 UI 直接展示，用户据此确认实际出口线路。 */
  exitIp?: string;
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
  /** 读取单个供应商的绑定视图（含连接列表）；用于供应商页的内联选择器。 */
  getProviderBinding(providerId: string): Promise<ProxyProviderBindingView | null>;
  /**
   * 直读供应商的原始代理绑定（不过 UI 视图过滤）。
   *
   * 视图会把「不支持 provider 级出口」的供应商的 provider 轮询摘掉，但请求侧
   * 仍按原始绑定出站——记账要显示真实出口，必须读原始绑定。
   */
  getProviderProxyBinding(providerId: string): Promise<ProviderProxyBinding | undefined>;
  /**
   * 只改一条连接的绑定；poolId 传 null = 取消绑定（回到「跟随全局代理状态」）。
   * 不动该供应商其他连接。返回更新后的该供应商绑定视图。
   */
  saveAccountBinding(
    providerId: string,
    accountId: string,
    poolId: string | null,
  ): Promise<ProxyProviderBindingView | null>;
  /**
   * 批量：把同一条池套用到该供应商的全部连接；poolId 传 null = 全部取消绑定。
   * 对齐 9router 供应商详情页的 batch apply。
   */
  applyPoolToAllAccounts(
    providerId: string,
    poolId: string | null,
  ): Promise<ProxyProviderBindingView | null>;
  /**
   * 批量：按顺序把多个池轮流分配给全部连接（每条连接固定拿一个池）。
   * 这是 9router 实现「轮询」的方式——见 shared 的 distributeProxyPoolsToBindings。
   */
  distributePools(providerId: string, poolIds: string[]): Promise<ProxyProviderBindingView | null>;
  /**
   * 设置无账号供应商的 provider 级出口（对齐 9router noAuth 的 proxyPoolId +
   * rotateStrategy）。传 null = 清除，回到「跟随全局代理状态」。
   *
   * strategy = "none" 时只取 poolIds[0]；round-robin / random 时每个请求在传入的
   * poolIds 子集之间挑一条（**只认用户选中的线路**，不自动扩到全部启用池）。
   * 停用或不存在的池会被丢弃；传了 id 但全部无效时按「清除」处理。
   */
  saveProviderBinding(
    providerId: string,
    input: {
      strategy: ProviderProxyRotationStrategy;
      poolIds: string[];
    } | null,
  ): Promise<ProxyProviderBindingView | null>;
  /**
   * 保存账号轮询设置（fill-first / round-robin + sticky）。
   * 只影响该供应商后续的账号选择；不改变当前激活账号。
   */
  saveAccountRotation(
    providerId: string,
    settings: AccountRotationSettings,
  ): Promise<ProxyProviderBindingView | null>;
}

export const IProxyPoolService = createServiceDescriptor<IProxyPoolService>(
  ServiceChannels.ProxyPool,
);

/** 该 requestProfile（或 family 伪 providerId）是否有「连接（账号）」概念；只有这种供应商才能做连接级绑定。 */
export function supportsAccountBinding(
  requestProfile: string | undefined,
  providerId?: string,
): boolean {
  if (requestProfile === "qoder" || requestProfile === "codebuddy") {
    return true;
  }
  // zai / bigmodel：账号是 family 级的 OAuth 账号，不挂在任何单个 provider 上。调用方在这种
  // 场景下传的是 family id（伪 providerId），没有 requestProfile 可查。
  return providerId !== undefined && resolveAccountFamilyProviderId(providerId) !== null;
}

/**
 * zai / bigmodel 的账号（连接）归属。
 *
 * 一个 family 下有 start-plan / individual / team 等多个 provider，它们共享同一份 Coding Plan
 * 账号表（oauthCredentialRepo 的 account_list），而账号表本身不属于任何一个 provider。
 * UI 用 family id 作为**伪 providerId** 访问这张表：账号 id 用现成的 accountRef
 * （`${provider}:${identity}`，与账号管理页显示的是同一个值），绑定则写进该 family 下**所有**
 * provider 的 api.proxy——agent 只会读到它本次实际使用的那一个。
 */
export function resolveAccountFamilyProviderId(providerId: string): ModelProviderFamilyId | null {
  return providerId === ZAI_PROVIDER_ID || providerId === BIGMODEL_PROVIDER_ID ? providerId : null;
}

/** zai / bigmodel 的 family 列表（伪 providerId 全集）。 */
export const ACCOUNT_FAMILY_PROVIDER_IDS: readonly ModelProviderFamilyId[] = [
  ZAI_PROVIDER_ID,
  BIGMODEL_PROVIDER_ID,
];

/**
 * 需要 provider 级出口的免费供应商（显式白名单）。
 *
 * 只有**匿名共享档**才有这个需求：OpenCode Free / Kilo Free 拿公开共享凭据打上游，
 * 配额按出口 IP 计，换池即换额度桶。
 * 自带 apiKey 的免费中转——「冇名AI」(`free:mouming-ai`)——配额绑在 key 上，上游不按出口
 * IP 风控，给它配 provider 级出口只会把请求绕远，因此不在此列；其余 free 组供应商同理。
 *
 * 写成代码常量而不是 provider config 字段：Built-in config 会被远端 revision 覆盖回写，
 * 字段一旦被旧版远端配置抹掉，OpenCode/Kilo 的出口配置就会静默失效；放代码里不受影响。
 */
export const PROVIDER_EGRESS_ROTATION_PROVIDER_IDS: readonly string[] = [
  "free:opencode-free",
  "free:kilo-free",
];

const providerEgressRotationIds = new Set(PROVIDER_EGRESS_ROTATION_PROVIDER_IDS);

/**
 * 该供应商是否走「无账号免费档」的 provider 级池。
 *
 * 三重条件：group=free、没有连接概念、且在白名单里。白名单把「自带 apiKey 的免费中转」
 * 挡在外面——它们不需要换出口 IP，给了入口只会让用户误以为在绕上游风控。
 */
export function supportsProviderBinding(
  providerId: string,
  group: string | null | undefined,
  requestProfile: string | undefined,
): boolean {
  if (group !== "free" || supportsAccountBinding(requestProfile)) {
    return false;
  }
  return providerEgressRotationIds.has(providerId);
}
