// 平台能力面收敛：设置页「插件管理」的薄服务接口。
//
// 背景：pluginManagementStore / usePluginUninstall 过去直接注入 IXCodeAgentService，
// UI 层因此散布 13 个 plugins/* 旧协议词的消费点。收敛为独立薄 service 后，UI 只依赖
// 本接口；plugins/* 词表的 host 侧消费点收拢到 pluginManagementService 一处（插件的
// 事实源在 zcode-cli 进程，服务实现仍经 agent 协议往返——plugins 词表的收口归属
// 插件能力面自身的协议演进，不在会话 v4 词表范围内）。
// 注意与既有 IPluginsService（已 retired 的 marketplace pluginStore 通道）区分：
// 那套接口按 pluginName+marketplace 寻址且方法语义过时，不复用避免签名冲突。
import type { Event } from "@zcode/rpc";
import type {
  XCodePluginOperationProgressNotification,
  XCodePluginsConfigureResult,
  XCodePluginsCancelOperationResult,
  XCodePluginsDescribeResult,
  XCodePluginsInstallResult,
  XCodePluginsListResult,
  XCodePluginsMarketplaceMutationResult,
  XCodePluginsOverviewResult,
  XCodePluginsReferenceCatalogResult,
  XCodePluginsRestoreBuiltinResult,
  XCodePluginsSetEnabledResult,
  XCodePluginsUninstallResult,
  XCodePluginsValidateResult,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  XCodeAgentAddPluginMarketplaceParams,
  XCodeAgentConfigurePluginParams,
  XCodeAgentCancelPluginOperationParams,
  XCodeAgentDescribePluginParams,
  XCodeAgentInstallPluginParams,
  XCodeAgentPluginReferenceCatalogParams,
  XCodeAgentResolveSuggestedPluginReferenceParams,
  XCodeAgentResetPluginConfigParams,
  XCodeAgentPluginViewParams,
  XCodeAgentRemovePluginMarketplaceParams,
  XCodeAgentRestoreBuiltinPluginParams,
  XCodeAgentSetPluginEnabledParams,
  XCodeAgentUninstallPluginParams,
  XCodeAgentUpdatePluginMarketplaceParams,
  XCodeAgentUpdatePluginParams,
  XCodeAgentValidatePluginParams,
} from "../zcode-agent/zcodeAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: XCodeAgentPluginViewParams): Promise<XCodePluginsListResult>;
  /**
   * Plugin 对话引用 catalog：
   * 带 sessionId → session-owned 冻结 catalog；不带 → workspace 当前 catalog。
   * 实现路由到 workspace 级 agent client，不走插件管理独立进程。
   */
  getPluginReferenceCatalog(
    params: XCodeAgentPluginReferenceCatalogParams,
  ): Promise<XCodePluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: XCodeAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@zcode/shared").XCodePluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<XCodePluginOperationProgressNotification>;
  getPluginsOverview(params: XCodeAgentPluginViewParams): Promise<XCodePluginsOverviewResult>;
  addPluginMarketplace(
    params: XCodeAgentAddPluginMarketplaceParams,
  ): Promise<XCodePluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: XCodeAgentRemovePluginMarketplaceParams,
  ): Promise<XCodePluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: XCodeAgentUpdatePluginMarketplaceParams,
  ): Promise<XCodePluginsMarketplaceMutationResult>;
  installPlugin(params: XCodeAgentInstallPluginParams): Promise<XCodePluginsInstallResult>;
  cancelPluginOperation(
    params: XCodeAgentCancelPluginOperationParams,
  ): Promise<XCodePluginsCancelOperationResult>;
  uninstallPlugin(params: XCodeAgentUninstallPluginParams): Promise<XCodePluginsUninstallResult>;
  updatePlugin(params: XCodeAgentUpdatePluginParams): Promise<XCodePluginsInstallResult>;
  restoreBuiltinPlugin(
    params: XCodeAgentRestoreBuiltinPluginParams,
  ): Promise<XCodePluginsRestoreBuiltinResult>;
  configurePlugin(params: XCodeAgentConfigurePluginParams): Promise<XCodePluginsConfigureResult>;
  resetPluginConfig(
    params: XCodeAgentResetPluginConfigParams,
  ): Promise<XCodePluginsConfigureResult>;
  validatePlugin(params: XCodeAgentValidatePluginParams): Promise<XCodePluginsValidateResult>;
  describePlugin(params: XCodeAgentDescribePluginParams): Promise<XCodePluginsDescribeResult>;
  setPluginEnabled(params: XCodeAgentSetPluginEnabledParams): Promise<XCodePluginsSetEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);
