/* oxlint-disable max-lines -- 多 provider 的编排 facade 集中聚合，拆分会让单个提供商配置面分散到多个文件。 */
import type { Event } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import {
  isApiKeyAccess,
  type ModelConfigObject,
  type ModelId,
  type ModelSelection,
  type ModelSelectionFacade,
  type ModelSelectionView,
  type ModelSelectionViewInput,
  type ProviderConfigObject,
  type ProviderId,
  type ProviderSettingsFacade,
  type ProviderSettingsCreationResult,
  type ModelConfigResolution,
  type ProviderSettingsView,
  type ResolveModelConfigInput,
  type SavePersonalModelDraftInput,
} from "@zcode/provider";
import { createServiceDescriptor } from "../descriptors.js";
import type { ModelConnectivityResult, UpstreamModelListResult } from "@zcode/shared";
import {
  providerFetch,
  qoderProviderId,
  resolveProviderAccountId,
} from "../providers/api/providerNetwork.js";
import {
  activateQoderPro,
  queryQoderProStatus,
  beginQoderLogin,
  listQoderAccounts,
  pollQoderLogin,
  removeQoderAccount,
  switchQoderAccount,
  upsertQoderAccount,
} from "./qoderAuth.js";
import {
  qoderCheckinAccount,
  qoderCheckinAll,
  qoderCheckinStats,
  type QoderCheckinRegion,
  type QoderCheckinResult,
  type QoderCheckinStats,
  type QoderCheckinSummary,
} from "./qoderCheckin.js";
import {
  codebuddyCheckinAccount,
  codebuddyCheckinAll,
  codebuddyCheckinStats,
  type CodeBuddyCheckinRegion,
  type CodeBuddyCheckinResult,
  type CodeBuddyCheckinStats,
  type CodeBuddyCheckinSummary,
} from "./codebuddyCheckin.js";
import {
  listCodeBuddyAutoCheckinSettings,
  updateCodeBuddyAutoCheckinSettings,
  type CodeBuddyAutoCheckinSettings,
} from "./codebuddyAutoCheckin.js";
import {
  beginCodeBuddyLogin,
  describeCodeBuddyAccessToken,
  listCodeBuddyAccounts,
  pollCodeBuddyLogin,
  refreshCodeBuddyStored,
  removeCodeBuddyAccount,
  switchCodeBuddyAccount,
  upsertCodeBuddyAccount,
  type CodeBuddyPollResult,
} from "./codebuddyAuth.js";
// XCode fork：额度/配额查看（Qoder / CodeBuddy）。以下为额度功能新增导入。
import { queryCodeBuddyAccountQuota, queryCodeBuddyQuotaBatch } from "./codebuddyQuota.js";
import {
  queryQoderAccountQuota,
  queryQoderQuotaBatch,
  type QoderGatewayQuotaReader,
} from "./qoderQuota.js";
import type {
  AccountQuotaSnapshot,
  QuotaBatchResult,
  QuotaSummary,
} from "./accountQuota.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ProviderSettingsUpstreamModelsFetcher } from "./upstreamModelListFetcher.js";

export type {
  ProviderSettingsProviderView,
  ModelSelectionView,
  ModelSelectionViewInput,
  ProviderSettingsView,
} from "@zcode/provider";

// XCode fork：Qoder 签到相关类型随服务接口一起导出，UI 直接消费。
export type {
  QoderCheckinRegion,
  QoderCheckinResult,
  QoderCheckinStats,
  QoderCheckinStatus,
  QoderCheckinSummary,
} from "./qoderCheckin.js";

// XCode fork：CodeBuddy 签到 / 自动签到相关类型随服务接口一起导出，UI 直接消费。
export type {
  CodeBuddyCheckinRegion,
  CodeBuddyCheckinResult,
  CodeBuddyCheckinStats,
  CodeBuddyCheckinStatus,
  CodeBuddyCheckinSummary,
} from "./codebuddyCheckin.js";
export type { CodeBuddyAutoCheckinSettings } from "./codebuddyAutoCheckin.js";

// XCode fork：额度/配额查看相关类型随服务接口一起导出，UI 直接消费。
export type {
  AccountQuotaSnapshot,
  QuotaBatchResult,
  QuotaProvider,
  QuotaSummary,
} from "./accountQuota.js";

export interface IProviderSettingsService {
  readonly onDidChange: Event<ProviderSettingsView>;
  getView(): Promise<ProviderSettingsView>;
  refresh(reason: string): Promise<ProviderSettingsView>;
  createPersonalProvider(
    input?: Parameters<ProviderSettingsFacade["createPersonalProvider"]>[0],
  ): Promise<ProviderSettingsCreationResult>;
  resolveModelConfig(input: ResolveModelConfigInput): Promise<ModelConfigResolution>;
  savePersonalProviderOverlay(
    providerId: ProviderId,
    config: ProviderConfigObject,
    metadata?: Parameters<ProviderSettingsFacade["savePersonalProviderOverlay"]>[2],
  ): Promise<ProviderSettingsView>;
  deletePersonalProvider(providerId: ProviderId): Promise<ProviderSettingsView>;
  reorderPersonalProviders(providerIds: readonly ProviderId[]): Promise<ProviderSettingsView>;
  reorderPersonalModels(
    providerId: ProviderId,
    modelIds: readonly ModelId[],
  ): Promise<ProviderSettingsView>;
  addPersonalModel(
    providerId: ProviderId,
    modelId: ModelId,
    config: ModelConfigObject,
    useRecommendedConfig?: boolean,
  ): Promise<ProviderSettingsView>;
  renamePersonalModel(
    providerId: ProviderId,
    currentModelId: ModelId,
    nextModelId: ModelId,
  ): Promise<ProviderSettingsView>;
  deletePersonalModel(providerId: ProviderId, modelId: ModelId): Promise<ProviderSettingsView>;
  savePersonalModelDraft(input: SavePersonalModelDraftInput): Promise<ProviderSettingsView>;
  setPersonalModelEnabled(
    providerId: ProviderId,
    modelId: ModelId,
    enabled: boolean,
  ): Promise<ProviderSettingsView>;
  /** 测试已经保存并进入目标 Environment Registry 的正式 Model。 */
  testModelConnectivity(
    input: ProviderSettingsConnectivityRequest,
  ): Promise<ModelConnectivityResult>;
  /** XCode fork：从供应商上游拉取模型列表（GET {baseUrl}/models），用于批量添加模型。 */
  fetchUpstreamModels(
    input: ProviderSettingsUpstreamModelsRequest,
  ): Promise<UpstreamModelListResult>;
  /** XCode fork：CodeBuddy 登录——获取 state + 浏览器授权 URL（cn/intl）。 */
  codebuddyBeginLogin(region: "cn" | "intl"): Promise<{ state: string; authUrl: string }>;
  /** XCode fork：CodeBuddy 登录——轮询一次授权结果；成功即入账号列表并激活。 */
  codebuddyPollLogin(
    region: "cn" | "intl",
    state: string,
  ): Promise<CodeBuddyPollResult>;
  /** XCode fork：CodeBuddy 账号列表（含激活标记与当前令牌）。 */
  codebuddyListAccounts(region: "cn" | "intl"): Promise<{
    accounts: Array<{
      id: string;
      displayName: string;
      email?: string;
      expiresAt: number;
      active: boolean;
      accessToken: string;
    }>;
    activeAccessToken: string | null;
  }>;
  /** XCode fork：切换激活账号，返回新激活账号（令牌供 overlay 回写）。 */
  codebuddySwitchAccount(
    region: "cn" | "intl",
    id: string,
  ): Promise<{ id: string; displayName: string; accessToken: string; expiresAt: number } | null>;
  /** XCode fork：删除账号；删激活账号时自动激活剩余第一个并返回其令牌。 */
  codebuddyRemoveAccount(
    region: "cn" | "intl",
    id: string,
  ): Promise<{ accounts: unknown; activeAccessToken: string | null }>;
  /** XCode fork：Qoder 设备流登录——生成 nonce/PKCE + 浏览器授权 URL。 */
  qoderBeginLogin(region: "cn" | "intl"): Promise<{
    nonce: string;
    userCode: string;
    verificationUri: string;
    codeVerifier: string;
    machineIdHint: string;
    /** XCode fork：登录前从 mi-token 接口取的设备标识三件套，一号一绑。 */
    machineToken?: string;
    machineType?: string;
    machineCode?: string;
    expiresAt: number;
  }>;
  /** XCode fork：Qoder 登录——轮询一次授权结果；成功即入账号列表并激活。 */
  qoderPollLogin(
    region: "cn" | "intl",
    nonce: string,
    codeVerifier: string,
    /** 登录会话的 machineId，随账号持久化用于设备指纹派生。 */
    machineId?: string,
    /** 登录会话预取的设备标识三件套，与该账号一号一绑。 */
    deviceIdentity?: { machineToken?: string; machineType?: string; machineCode?: string },
  ): Promise<
    | { status: "pending" }
    | {
        status: "ok";
        accessToken: string;
        userId: string;
        displayName: string;
        email: string;
        expiresAt: number;
      }
    | { status: "failed"; message: string }
  >;
  /** XCode fork：Qoder 账号列表（含激活标记）。 */
  qoderListAccounts(region: "cn" | "intl"): Promise<{
    accounts: Array<{
      /** 账号标识（Cosy-User）。 */
      id: string;
      displayName: string;
      email?: string;
      /** 访问令牌：UI 把"激活账号"镜像进 overlay 时需要。 */
      accessToken: string;
      /** 设备标识四件套：machineId + 官方 machine-info 三件套。 */
      machineId?: string;
      machineToken?: string;
      machineType?: string;
      machineCode?: string;
      expiresAt: number;
      active: boolean;
    }>;
  }>;
  /** XCode fork：切换激活账号。machineId 必须回传，设备指纹由它确定性派生。 */
  qoderSwitchAccount(
    region: "cn" | "intl",
    id: string,
  ): Promise<{ id: string; displayName: string; accessToken: string; machineId?: string } | null>;
  /** XCode fork：删除账号。 */
  qoderRemoveAccount(
    region: "cn" | "intl",
    id: string,
  ): Promise<{ accounts: unknown; activeAccessToken: string | null }>;
  /**
   * XCode fork：激活 Qoder PRO（领取 38max 800 点活动试用点）。
   * machineToken 由 mi-token 接口下发或取自账号缓存——claim 接口校验其真实性，
   * 伪造值会被判"不可领取"，因此本地不自造。
   */
  /**
   * XCode fork：为账号生成本机设备指纹三件套（替代远程 mi-token 接口）。
   * 同一台机器重复调用结果一致，一号一绑。
   */
  /**
   * XCode fork：查询账号的 PRO 状态（Bearer-only 端点，不触发设备指纹复核，
   * 不会把已 PRO 账号打回）。
   */
  qoderQueryProStatus(
    region: "cn" | "intl",
    id: string,
  ): Promise<{ isPro: boolean; userType: string; planTier: string }>;
  qoderActivatePro(
    region: "cn" | "intl",
    id: string,
    options?: { machineToken?: string; machineCode?: string },
  ): Promise<{
    ok: boolean;
    already: boolean;
    userType: string;
    claimed: boolean;
    message: string;
  }>;

  /**
   * XCode fork：Qoder 每日签到（单账号）。走 campaigns→claim 权威流程，
   * host 按区域分流；命中账号持久化的真实 machinetoken 一并上行。
   */
  qoderCheckin(input: {
    region: QoderCheckinRegion;
    accountId: string;
  }): Promise<QoderCheckinResult>;
  /**
   * XCode fork：Qoder 每日签到（批量）。默认遍历 cn + intl 全部已登录账号，
   * 也可用 regions 限定区域。
   */
  qoderCheckinAll(input?: {
    regions?: readonly QoderCheckinRegion[];
  }): Promise<QoderCheckinSummary>;
  /** XCode fork：只读获取本地签到统计（连续/累计天数、累计积分，不触发上游请求）。 */
  qoderCheckinStats(input: {
    region: QoderCheckinRegion;
    accountId: string;
  }): Promise<QoderCheckinStats>;

  /**
   * XCode fork：CodeBuddy 每日签到（单账号）。走 /v2/billing/meter/* 流程
   * （checkin-activity-status → daily-checkin），host 按区域分流端点。
   */
  codebuddyCheckin(input: {
    region: CodeBuddyCheckinRegion;
    accountId: string;
  }): Promise<CodeBuddyCheckinResult>;
  /** XCode fork：CodeBuddy 每日签到（批量，并发 4）。默认 cn + intl 全部账号。 */
  codebuddyCheckinAll(input?: {
    regions?: readonly CodeBuddyCheckinRegion[];
  }): Promise<CodeBuddyCheckinSummary>;
  /** XCode fork：只读获取本地签到统计（不上行任何请求）。 */
  codebuddyCheckinStats(input: {
    region: CodeBuddyCheckinRegion;
    accountId: string;
  }): Promise<CodeBuddyCheckinStats>;
  /** XCode fork：CodeBuddy 每账号自动签到设置（开关 + HH:MM）。 */
  codebuddyListAutoCheckin(region: CodeBuddyCheckinRegion): Promise<
    Array<{ accountId: string; accountName: string } & CodeBuddyAutoCheckinSettings>
  >;
  /** XCode fork：更新某账号的自动签到设置（局部更新，时间先校验再落盘）。 */
  codebuddyUpdateAutoCheckin(
    region: CodeBuddyCheckinRegion,
    accountId: string,
    update: { enabled?: boolean; time?: string },
  ): Promise<CodeBuddyAutoCheckinSettings>;

  /** XCode fork：CodeBuddy 令牌刷新（对应区域当前激活账号）。 */
  codebuddyRefreshStored(region: "cn" | "intl"): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null>;

  /**
   * XCode fork：查询单个 Qoder 账号的剩余额度/配额。
   * intl 走 openapi Bearer-only 的 /api/v2/quota/usage；cn 走 COSY 网关
   * （node.ts 已注入 qoderProStatusGatewayFetcher，未注入时如实报错）。
   */
  qoderQueryAccountQuota(input: {
    region: "cn" | "intl";
    accountId: string;
  }): Promise<AccountQuotaSnapshot>;
  /**
   * XCode fork：批量查询 Qoder 额度并汇总（账号数/总额/平均/最小/最大，
   * 对齐 9router check_quota.sh）。默认 cn + intl 全部账号，并发上限 4。
   */
  qoderQueryAllQuotas(input?: {
    regions?: readonly ("cn" | "intl")[];
  }): Promise<QuotaBatchResult>;
  /**
   * XCode fork：查询单个 CodeBuddy 账号的剩余额度/配额。
   * 企业 seat 走 tenant meter（get-enterprise-user-usage，404/405 回退），
   * 其余走个人资源查询（get-user-resource）。
   */
  codebuddyQueryAccountQuota(input: {
    region: "cn" | "intl";
    accountId: string;
  }): Promise<AccountQuotaSnapshot>;
  /**
   * XCode fork：批量查询 CodeBuddy 额度并汇总（维度同上）。
   * 默认 cn + intl 全部账号，并发上限 4。
   */
  codebuddyQueryAllQuotas(input?: {
    regions?: readonly ("cn" | "intl")[];
  }): Promise<QuotaBatchResult>;
}

export const IProviderSettingsService = createServiceDescriptor<IProviderSettingsService>(
  ServiceChannels.ProviderSettings,
);

export interface ProviderSettingsConnectivityTestInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

export interface ProviderSettingsConnectivityRequest {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

export type ProviderSettingsConnectivityTester = (
  input: ProviderSettingsConnectivityTestInput,
) => Promise<ModelConnectivityResult>;

export interface ProviderSettingsUpstreamModelsRequest {
  readonly providerId: ProviderId;
}

export interface IModelSelectionService {
  readonly onDidChange: Event<ModelSelectionView>;
  getView(input?: ModelSelectionViewInput): Promise<ModelSelectionView>;
}

export interface ModelSelectionConfiguredDefaultSource {
  read(): Promise<ModelSelection | undefined>;
  onDidChange?(listener: () => void): () => void;
}

export const IModelSelectionService = createServiceDescriptor<IModelSelectionService>(
  ServiceChannels.ModelSelection,
);

/** CN 的 PRO 状态查询走 gateway + COSY（host-only 实现，node.ts 注入）。 */
export type QoderProStatusGatewayFetcher = (input: {
  region: "cn" | "intl";
  accessToken: string;
  userId: string;
  machineId: string;
  /**
   * XCode fork：出口覆盖。facade 会按供应商（+账号）解析后注入，
   * 让网关查询同样绕开全局代理；不传时实现侧退回裸 fetch。
   */
  fetchImpl?: typeof globalThis.fetch;
}) => Promise<{
  isPro: boolean;
  userType: string;
  planTier: string;
  quotaRemaining?: number;
  quotaTotal?: number;
  isQuotaExceeded?: boolean;
}>;

export function createProviderSettingsService(
  facade: ProviderSettingsFacade,
  ensureReady: () => Promise<void> = async () => {},
  testConnectivity?: ProviderSettingsConnectivityTester,
  fetchUpstreamModels?: ProviderSettingsUpstreamModelsFetcher,
  qoderProStatusGatewayFetcher?: QoderProStatusGatewayFetcher,
): IProviderSettingsService {
  // XCode fork：CN 网关查询器是 host-only 实现，出口必须按供应商解析
  // （配了代理池的 Qoder 走池）。这里统一包一层把 fetchImpl 补齐，避免每个调用点重复。
  const qoderGatewayFetcher: QoderProStatusGatewayFetcher | undefined = qoderProStatusGatewayFetcher
    ? (input) =>
        qoderProStatusGatewayFetcher({
          ...input,
          fetchImpl: providerFetch(qoderProviderId(input.region), input.userId),
        })
    : undefined;
  return {
    onDidChange: toEvent((listener) => facade.onDidChange(listener)),
    getView: async () => {
      await ensureReady();
      return facade.getView();
    },
    refresh: async (reason) => {
      await ensureReady();
      return facade.refresh(reason);
    },
    createPersonalProvider: async (input) => {
      await ensureReady();
      return facade.createPersonalProvider(input);
    },
    resolveModelConfig: async (input) => {
      await ensureReady();
      return facade.resolveModelConfig(input);
    },
    savePersonalProviderOverlay: async (providerId, config, metadata) => {
      await ensureReady();
      return facade.savePersonalProviderOverlay(providerId, config, metadata);
    },
    deletePersonalProvider: async (providerId) => {
      await ensureReady();
      return facade.deletePersonalProvider(providerId);
    },
    reorderPersonalProviders: async (providerIds) => {
      await ensureReady();
      return facade.reorderPersonalProviders(providerIds);
    },
    reorderPersonalModels: async (providerId, modelIds) => {
      await ensureReady();
      return facade.reorderPersonalModels(providerId, modelIds);
    },
    addPersonalModel: async (providerId, modelId, config, useRecommendedConfig) => {
      await ensureReady();
      return facade.addPersonalModel(providerId, modelId, config, useRecommendedConfig);
    },
    renamePersonalModel: async (providerId, currentModelId, nextModelId) => {
      await ensureReady();
      return facade.renamePersonalModel(providerId, currentModelId, nextModelId);
    },
    deletePersonalModel: async (providerId, modelId) => {
      await ensureReady();
      return facade.deletePersonalModel(providerId, modelId);
    },
    savePersonalModelDraft: async (input) => {
      await ensureReady();
      return facade.savePersonalModelDraft(input);
    },
    setPersonalModelEnabled: async (providerId, modelId, enabled) => {
      await ensureReady();
      return facade.setPersonalModelEnabled(providerId, modelId, enabled);
    },
    testModelConnectivity: async (input) => {
      await ensureReady();
      if (!testConnectivity) {
        throw new Error("当前 Environment 未装配模型连通性测试能力");
      }
      await facade.waitForProviderOperations(input.providerId);
      // 禁用对象仍存在于配置视图，但不进入执行 Registry；不能把未发布误报成配置丢失。
      // 只消费操作完成后的公共资格，不另查 Key、权益，也不替代目标 Environment 最终校验。
      const provider = facade
        .getView()
        .providers.find((item) => item.providerId === input.providerId);
      const model = provider?.models.find((item) => item.modelId === input.modelId);
      const unavailable =
        !provider || !provider.enabled
          ? "provider-unavailable"
          : !model || !model.enabled || model.issues.length > 0
            ? "model-unavailable"
            : !provider.executable
              ? "provider-unavailable"
              : !model.executable
                ? "model-unavailable"
                : undefined;
      if (unavailable) {
        return {
          success: false,
          error: {
            code: unavailable,
            message:
              unavailable === "provider-unavailable"
                ? "This provider is currently unavailable for connectivity testing."
                : "This model is currently unavailable for connectivity testing.",
          },
        };
      }
      return testConnectivity({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        providerId: input.providerId,
        modelId: input.modelId,
      });
    },
    fetchUpstreamModels: async (input) => {
      await ensureReady();
      if (!fetchUpstreamModels) {
        throw new Error("当前 Environment 未装配上游模型列表拉取能力");
      }
      await facade.waitForProviderOperations(input.providerId);
      // 拉取发生在模型保存之前，只依赖 provider 级 Effective 配置（baseUrl/apiKey/apiType）。
      const provider = facade
        .getView()
        .providers.find((item) => item.providerId === input.providerId);
      if (!provider || !provider.enabled) {
        return {
          success: false,
          error: {
            code: "provider-unavailable",
            message: "This provider is currently unavailable for fetching upstream models.",
          },
        };
      }
      const api = provider.effectiveConfig.api;
      const baseUrl = api?.baseUrl?.trim();
      if (!baseUrl) {
        return {
          success: false,
          error: {
            code: "endpoint-unavailable",
            message: "Configure a Base URL before fetching the upstream model list.",
          },
        };
      }
      const access = provider.effectiveConfig.access;
      const apiKey = isApiKeyAccess(access) ? access.apiKey?.trim() || undefined : undefined;
      // XCode fork：账号 id 从同一份请求上下文里解析（Qoder 读内部身份头、
      // CodeBuddy 读 JWT 的 sub），用于账号级代理绑定选中正确的池条目。
      const proxyAccountId = resolveProviderAccountId({
        ...(api?.headers ? { headers: api.headers } : {}),
        ...(apiKey ? { token: apiKey } : {}),
      });
      const result = await fetchUpstreamModels({
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
        // 与 UI 默认请求格式一致（XCode fork 默认 chat completions）。
        apiType: api?.type ?? "openai-chat-completions",
        // XCode fork：Qoder 的模型目录端点与协议由 requestProfile 决定（需 COSY
        // 签名），不能按通用 `{baseUrl}/models` 处理。
        ...(provider.effectiveConfig.requestProfile
          ? { requestProfile: provider.effectiveConfig.requestProfile }
          : {}),
        ...(api?.headers ? { headers: api.headers } : {}),
        // XCode fork：带上供应商 id，让出口按该供应商的代理池绑定解析
        // （配了池就绕开全局代理）。
        providerId: input.providerId,
        ...(proxyAccountId ? { accountId: proxyAccountId } : {}),
      });
      // XCode fork：提供商可配置 upstreamModelIdFilter（正则片段，不区分大小写），
      // 上游列表只保留匹配的模型 ID（如 Kilo Free 只暴露带 free 的免费模型）。
      const filterSource = provider.effectiveConfig.upstreamModelIdFilter?.trim();
      if (!result.success || !filterSource) return result;
      try {
        const filter = new RegExp(filterSource, "i");
        return { ...result, models: result.models.filter((id) => filter.test(id)) };
      } catch {
        // 正则非法按未配置处理，返回全量列表，让用户在勾选页自行筛选。
        return result;
      }
    },
    codebuddyBeginLogin: async (region) => {
      await ensureReady();
      return beginCodeBuddyLogin(region);
    },
    codebuddyPollLogin: async (region, state) => {
      await ensureReady();
      const result = await pollCodeBuddyLogin(region, state);
      if (result.status === "ok") {
        // 登录成功即入账号列表并激活：身份取自 Keycloak JWT（sub 稳定、
        // name/username/email 作显示名），重登同一账号复用同一列表条目。
        const identity = describeCodeBuddyAccessToken(result.accessToken);
        await upsertCodeBuddyAccount(region, {
          id: identity?.sub ?? state,
          displayName: identity?.displayName || undefined,
          email: identity?.email || undefined,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
        });
      }
      return result;
    },
    codebuddyListAccounts: async (region) => {
      await ensureReady();
      return listCodeBuddyAccounts(region);
    },
    codebuddySwitchAccount: async (region, id) => {
      await ensureReady();
      return switchCodeBuddyAccount(region, id);
    },
    codebuddyRemoveAccount: async (region, id) => {
      await ensureReady();
      return removeCodeBuddyAccount(region, id);
    },
    codebuddyRefreshStored: async (region) => {
      await ensureReady();
      return refreshCodeBuddyStored(region);
    },
    qoderBeginLogin: async (region) => {
      await ensureReady();
      const session = await beginQoderLogin(region);
      return {
        nonce: session.nonce,
        userCode: session.userCode,
        verificationUri: session.verificationUri,
        codeVerifier: session.codeVerifier,
        machineIdHint: session.machineId,
        ...(session.machineToken
          ? {
              machineToken: session.machineToken,
              machineType: session.machineType,
              machineCode: session.machineCode,
            }
          : {}),
        expiresAt: session.expiresAt,
      };
    },
    qoderPollLogin: async (region, nonce, codeVerifier, machineId, deviceIdentity) => {
      await ensureReady();
      const result = await pollQoderLogin(region, nonce, codeVerifier);
      if (result.status === "ok") {
        await upsertQoderAccount(region, {
          id: result.userId || nonce,
          displayName: result.displayName || "Qoder 账号",
          email: result.email || undefined,
          // machineId 随账号持久化：Qoder 设备指纹由它确定性派生，不保存的话
          // 每次请求都会重新随机，设备身份前后不一致。
          machineId: machineId || undefined,
          // 设备三件套随账号持久化：一号一绑，后续切换账号不会串设备身份。
          ...(deviceIdentity?.machineToken
            ? {
                machineToken: deviceIdentity.machineToken,
                machineType: deviceIdentity.machineType,
                machineCode: deviceIdentity.machineCode,
              }
            : {}),
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
        });
      }
      return result;
    },
    qoderListAccounts: async (region) => {
      await ensureReady();
      return listQoderAccounts(region);
    },
    qoderSwitchAccount: async (region, id) => {
      await ensureReady();
      return switchQoderAccount(region, id);
    },
    qoderRemoveAccount: async (region, id) => {
      await ensureReady();
      return removeQoderAccount(region, id);
    },
    qoderQueryProStatus: async (region, id) => {
      await ensureReady();
      const account = (await listQoderAccounts(region)).accounts.find((a) => a.id === id);
      if (!account) return { isPro: false, userType: "", planTier: "" };
      // CN 的 plan/quota 端点在网关且需 COSY 签名（openapi 上不存在），走注入的
      // host-only 查询器；国际版走 Bearer-only 查询。
      if (region === "cn" && qoderGatewayFetcher) {
        return qoderGatewayFetcher({
          region,
          accessToken: account.accessToken,
          userId: account.id,
          machineId: account.machineId ?? "",
        });
      }
      const status = await queryQoderProStatus(region, account.accessToken, account.id);
      return { isPro: status.isPro, userType: status.userType, planTier: status.planTier };
    },
    qoderActivatePro: async (region, id, options) => {
      await ensureReady();
      return activateQoderPro(region, id, options ?? {});
    },
    qoderCheckin: async (input) => {
      await ensureReady();
      return qoderCheckinAccount(input.region, input.accountId);
    },
    qoderCheckinAll: async (input) => {
      await ensureReady();
      return qoderCheckinAll(input ?? {});
    },
    qoderCheckinStats: async (input) => {
      await ensureReady();
      return qoderCheckinStats(input.region, input.accountId);
    },
    codebuddyCheckin: async (input) => {
      await ensureReady();
      return codebuddyCheckinAccount(input.region, input.accountId);
    },
    codebuddyCheckinAll: async (input) => {
      await ensureReady();
      return codebuddyCheckinAll(input ?? {});
    },
    codebuddyCheckinStats: async (input) => {
      await ensureReady();
      return codebuddyCheckinStats(input.region, input.accountId);
    },
    codebuddyListAutoCheckin: async (region) => {
      await ensureReady();
      return listCodeBuddyAutoCheckinSettings(region);
    },
    codebuddyUpdateAutoCheckin: async (region, accountId, update) => {
      await ensureReady();
      return updateCodeBuddyAutoCheckinSettings(region, accountId, update);
    },
    // XCode fork：额度/配额查看。CN 的 Qoder 额度复用已注入的 COSY 网关查询器
    // （qoderProStatusGatewayFetcher 同时在 PRO 状态与额度两条链路使用）。
    qoderQueryAccountQuota: async (input) => {
      await ensureReady();
      return queryQoderAccountQuota(input.region, input.accountId, {
        ...(qoderGatewayFetcher
          ? { gateway: qoderGatewayFetcher as QoderGatewayQuotaReader }
          : {}),
      });
    },
    qoderQueryAllQuotas: async (input) => {
      await ensureReady();
      return queryQoderQuotaBatch({
        ...(input?.regions ? { regions: input.regions } : {}),
        ...(qoderGatewayFetcher
          ? { gateway: qoderGatewayFetcher as QoderGatewayQuotaReader }
          : {}),
      });
    },
    codebuddyQueryAccountQuota: async (input) => {
      await ensureReady();
      return queryCodeBuddyAccountQuota(input.region, input.accountId);
    },
    codebuddyQueryAllQuotas: async (input) => {
      await ensureReady();
      return queryCodeBuddyQuotaBatch(input?.regions ? { regions: input.regions } : {});
    },
  };
}

export function createModelSelectionService(
  facade: ModelSelectionFacade,
  ensureReady: () => Promise<void> = async () => {},
  configuredDefaultSource?: ModelSelectionConfiguredDefaultSource,
): IModelSelectionService & { dispose(): void } {
  const log = createServiceLogger("model-selection");
  let revision = 0;
  let disposed = false;
  const listeners = new Set<(view: ModelSelectionView) => void>();
  const getView = async (input?: ModelSelectionViewInput): Promise<ModelSelectionView> => {
    await ensureReady();
    if (disposed) throw new Error("ModelSelectionService 已 dispose");
    const configuredDefault = await configuredDefaultSource?.read();
    if (disposed) throw new Error("ModelSelectionService 已 dispose");
    const base = facade.getView(configuredDefault);
    if (revision < base.revision) revision = base.revision;
    return facade.getView(configuredDefault, revision, input);
  };
  const emit = (): void => {
    if (disposed) return;
    revision += 1;
    void getView().then(
      (view) => {
        if (disposed) return;
        for (const listener of listeners) listener(view);
      },
      (error: unknown) => {
        // Registry 事件触发的异步 View 重建没有 owner；Host dispose 后它仍会继续
        // 读取已释放的配置仓库，并形成未处理 rejection。dispose 是明确的取消边界；仅在服务
        // 仍存活时记录真实读取失败。
        if (disposed) return;
        log.warn(undefined, `ModelSelection View 刷新失败: ${String(error)}`);
      },
    );
  };
  const disposeFacade = facade.onDidChange(emit);
  const disposeConfiguredDefault = configuredDefaultSource?.onDidChange?.(emit);

  return {
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    getView,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeFacade();
      disposeConfiguredDefault?.();
      listeners.clear();
    },
  };
}

function toEvent<T>(subscribe: (listener: (event: T) => void) => () => void): Event<T> {
  return (listener) => {
    const dispose = subscribe(listener);
    return { dispose };
  };
}
