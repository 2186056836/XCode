import {
  createRemoteProjectService,
  IRemoteProjectService,
  projectWorkspaceSettings,
  readRemoteProjectDirectory,
} from "#src/remote-projects/index.js";
export {
  createRemoteProjectConnectionAdmission,
  releaseRemoteProjectProfileHost,
  findRemoteProjectHostIdForProfile,
  remoteProjectHostIdForProfile,
  remoteProjectHostIdForTarget,
  prepareRemoteServerConnection,
} from "#src/remote-projects/index.js";
import {
  createProjectDataPort,
  createProjectService,
  createTaskAutoArchiveScheduler,
  IProjectService,
  shouldRescanTaskAutoArchive,
} from "#src/project/index.js";
import {
  createManagedWorktreeService,
  createWorktreeRemovalGate,
  IManagedWorktreeService,
} from "#src/managed-worktree-tasks/index.js";
export { createLegacySingleRootProjectService } from "#src/project/index.js";
import { createAppControlService } from "#src/app-control/index.js";
import {
  createAppControlDiscoveryDirectory,
  type AppControlDiscoveryConnection,
} from "#src/app-control/discovery-directory.js";
import type {
  AppControlNavigationPort,
  AppControlService,
  AppControlServiceHandle,
} from "#src/app-control/contract.js";
export type {
  AppControlNavigationPort,
  AppControlBinding,
  AppControlServiceHandle,
} from "#src/app-control/contract.js";
export { createRemoteProjectService } from "#src/remote-projects/index.js";
import { getXCodeDataRootDir as projectDataRoot } from "#src/paths.js";
import { getDataBaseDir } from "#src/paths.js";
import { createGitWorktreeRepo } from "#src/git/managed-worktree/index.js";
import { createGitCommandProvider } from "#src/git/providers/gitCommandProvider.js";
import { HOST_WORKTREE_COMMAND } from "#src/zcode-agent/zcodeAgent.js";
import { createTaskGroupService, ITaskGroupService, groupTaskKey } from "#src/task-groups/index.js";
import { IGenUiService } from "./gen-ui/contract.js";
import { createGenUiService } from "./gen-ui/node.js";
// import { channelReplyHostRequestSchema, channelReplyResultSchema } from "@zcode/shared";
/* eslint-disable max-lines -- host process 服务注册和启动装配需要集中维护，拆散后会更难追踪依赖注入顺序 */
// Node.js service implementations — NOT safe to import in browser code
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createNodeProviderRuntimePathEnv,
  NodeModelSelectionConfigRepository,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
} from "@zcode/provider-node";
import { getAppConfigDir as resolveAppConfigDir } from "./paths.js";
import {
  createSystemCredentialCipher,
  createServerCredentialCipher,
  type CredentialCipher,
} from "@zcode/shared/credential-security";
import {
  createHasExistingLocalTask,
  hasAnyAgentSessionRow,
  resolveAgentSessionDbPath,
} from "./onboarding/localUsageEvidence.js";
import {
  buildLocalMediaPreviewUrl,
  isMarketingCaptchaEnabled,
  parseMarketingTouchResponse,
  resolveModelProviderFamilyIdByProviderId,
  startPlatformAppVersionRefresh,
  OAUTH_LINKED_BIGMODEL_KEY,
  OAUTH_SESSION_REVISION_KEY,
  type DynamicWorkflowMode,
  type ProviderProvisioningSourceTrigger,
  toBearerAuthorization,
  XCODE_CLIENT_LANGUAGE_ENV,
} from "@zcode/shared";

export {
  materializeXCodeBuiltinProviderConfig,
  XCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
} from "@zcode/provider-node";
import { randomUUID } from "node:crypto";
import { getAppConfigDir as getContentAppConfigDir } from "#src/paths.js";
import { ICloudContentService } from "#src/cloud-content/cloudContent.js";
import { createCloudContentService } from "#src/cloud-content/cloudContentService.js";
import { IMarketingTouchService } from "#src/marketing-touch/marketingTouch.js";
import { createMarketingTouchService } from "#src/marketing-touch/marketingTouchService.js";
import { IVoiceInputService } from "#src/voice-input/contract.js";
import { createVoiceInputService } from "#src/voice-input/voiceInputService.js";
import { createMarketingAssetRegistry } from "#src/marketing-touch/marketingAssetRegistry.js";
import type { IChannel } from "@zcode/rpc";
import {
  readTopicResourceFromRelay,
  validateTopicResourceFromRelay,
} from "./zcode-agent/topicResourceRelayClient.js";
export {
  createTopicResourcePeers,
  type TopicResourcePeers,
} from "./zcode-agent/topicResourcePeers.js";
export { createTopicResourceRelayChannel } from "./zcode-agent/topicResourceRelayChannel.js";

export { createFileService } from "./file/fileService.js";
export {
  attributeHostProcessTree,
  createProcessResourceSampler,
  createProcessResourceTableReader,
  type HostResourceUsageAgent,
  type ProcessResourceSample,
  type ProcessResourceSampler,
} from "./process/processResourceSampler.js";
export { createMediaPreviewService } from "./media-preview/mediaPreview.js";
export { createContentBundleCache } from "#src/cloud-content/contentBundleCache.js";
export type { ContentBundle } from "#src/cloud-content/contentBundleCache.js";
export type { CreateFileServiceOptions } from "./file/fileService.js";
export {
  defaultWorkspaceFileSearchFilter,
  type WorkspaceFileSearchDecision,
  type WorkspaceFileSearchEntry,
  type WorkspaceFileSearchFilter,
} from "./file/workspaceFileMentionFilter.js";
export {
  createFsFaultInjector,
  getProcessFsFaultInjector,
  maybeThrowInjectedFsFault,
  parseFsFaultRulesFromEnvValue,
  resetProcessFsFaultInjectorForTests,
  setFsFaultInjectorForTests,
  XCODE_E2E_FS_FAULTS_ALLOW_ENV,
  XCODE_E2E_FS_FAULTS_ENV,
} from "./fs/fsFaultInjection.js";
export type {
  FsFaultCheckInput,
  FsFaultHit,
  FsFaultInjector,
  FsFaultOperation,
  FsFaultRuleConfig,
  InjectedFsFaultError,
} from "./fs/fsFaultInjection.js";
// config.json 多写入方共用的「严格读取 + 写前重读 + 原子替换（0600）」（主进程 MCP 设置页也用）。
export {
  JsonObjectFileUnreadableError,
  readJsonObjectFileForUpdate,
  updateJsonObjectFile,
} from "./fs/atomicFileUtils.js";
export {
  setDataBaseDir,
  getDataBaseDir,
  getXCodeDataRootDir,
  getConversationWorkspaceDir,
  getAppConfigDir,
  getExportLogStageDir,
  getExportLogDir,
  getFeedbackRootDir,
  getFeedbackAttachmentDir,
  getFeedbackLogArchiveDir,
  getGitCheckpointIndexRootDir,
  copyDataDirectory,
  validateDataBaseDirTarget,
  XCODE_WINDOWS_APP_INSTALL_DIR_ENV,
} from "./paths.js";
export { createGitService } from "./git/gitService.js";
export { GitCommitMessageGenerator } from "./git/gitCommitMessageGenerator.js";
export { createGitCheckpointService } from "./git/gitCheckpointService.js";
export { createSystemService } from "./system/systemService.js";
export { listSSHConfigAliasesFromLocalConfig } from "./system/sshConfigAlias.js";
export { createTerminalService } from "./terminal/terminalService.js";
export {
  createSettingService,
  createSettingServiceWithMigrations,
} from "./setting/settingService.js";
export { createCredentialService } from "./credential/credentialService.js";
export { createBroadcastService } from "./broadcast/broadcastService.js";
export { createXCodeAgentService } from "./zcode-agent/zcodeAgentService.js";
export type {
  PluginUserOptionsReader,
  XCodeAgentPluginUserOptionsResult,
  XCodeAgentReadPluginUserOptionsParams,
} from "./zcode-agent/pluginHostQueriesClient.js";
export { createXCodeTaskServiceAdapter } from "./zcode-agent/zcodeTaskServiceAdapter.js";
export { createXCodeSessionService } from "./zcode-session/zcodeSessionService.js";
export {
  resolveDefaultXCodeAgentCommand,
  XCodeAgentProcessManager,
} from "./zcode-agent/zcodeAgentProcessManager.js";
export type {
  XCodeAgentCommand,
  XCodeAgentCommandResolver,
  XCodeAgentCommandResolverContext,
  XCodeAgentProcessManagerOptions,
} from "./zcode-agent/zcodeAgentProcessManager.js";
export { XCodeProtocolClient } from "./zcode-agent/zcodeProtocolClient.js";
export type { XCodeProtocolTransport } from "./zcode-agent/zcodeProtocolTransport.js";
export { XCodeStdioTransport } from "./zcode-agent/zcodeStdioTransport.js";
export {
  getXCodeStdioTapDevLogDir,
  readXCodeStdioTapDevState,
  setXCodeStdioTapDevEnabled,
} from "./zcode-agent/zcodeStdioTapDevConfig.js";
export type { XCodeStdioTapDevState } from "@zcode/shared";
export {
  createCuaHelperInstaller,
  requestHelperAccessibilityPermissionViaLaunchServices,
  requestHelperScreenRecordingPermissionViaLaunchServices,
} from "./cua-permission-broker/index.js";
export {
  canonicalizeCuaHelperInstallerOptions,
  createCanonicalCuaHelperInstaller,
  normalizeCuaHelperArch,
  normalizeCuaHelperArchs,
} from "./cua-permission-broker/cuaHelperInstaller.js";
export type {
  CuaHelperInstaller,
  CuaHelperInstallerOptions,
} from "./cua-permission-broker/index.js";
export { createProjectWorkspaceNavigation } from "#src/project-workspace-navigation/index.js";
export { createBotsService } from "./bots/botsService.js";
export { createFileWatcherService } from "./fileWatcher/fileWatcherService.js";
export { createOAuthService } from "./oauth/oauthService.js";
export { createOAuthProviderLogoutHandler } from "./oauth/oauthProviderLogout.js";
export { OAuthCredentialRepo } from "./oauth/repo/oauthCredentialRepo.js";
export { createTelemetryCore, ensureTelemetryDeviceMid } from "./telemetry/telemetryCore.js";
export type { EnsureTelemetryDeviceMidOptions } from "./telemetry/telemetryCore.js";
export type { AccountRequestAuthResolver } from "./model-provider/accountProviderRequestAuthService.js";
export { createAccountProviderCredentialStore } from "./model-provider/accountProviderCredentialStore.js";
export type {
  AccountProviderCredentialStore,
  AccountProviderCredentialStoreOptions,
} from "./model-provider/accountProviderCredentialStore.js";
export { importLegacyPersonalProviderConfig } from "./model-provider/legacyPersonalProviderConfigImporter.js";
export {
  createAccountProviderConfigSource,
  createAccountProviderConnectionResolver,
  createCodingPlanFamilyAvailabilityResolver,
  resolveCurrentAccountAccess,
} from "./model-provider/accountProviderConnectionResolver.js";
export { bindAccountProviderInvalidation } from "./model-provider/accountProviderInvalidation.js";
export type {
  AccountProviderConfigSourceOptions,
  AccountProviderConnectionResolverOptions,
  AccountProviderConnectionSettings,
  AccountProviderFamilyAvailabilityInput,
  AccountProviderFamilyAvailabilityResolver,
  CodingPlanFamilyAvailabilityResolverOptions,
} from "./model-provider/accountProviderConnectionResolver.js";
export {
  createProviderConfigRuntime,
  ProviderConfigRuntime,
} from "./model-provider/providerConfigRuntime.js";
export type { ProviderConfigRuntimeOptions } from "./model-provider/providerConfigRuntime.js";
export {
  createProviderRuntime,
  createProviderRuntimeFromConfigRuntime,
  EmptyAccountProviderConfigSource,
  ProviderRuntime,
} from "./model-provider/providerRuntime.js";
export type {
  ProviderRuntimeDependencies,
  ProviderRuntimeOptions,
} from "./model-provider/providerRuntime.js";
export {
  createProviderProvisioningSource,
  listProviderProvisioningCredentialKeys,
  resolveCredentialFilePath,
  type ProviderProvisioningSource,
  type ProviderProvisioningSourceOptions,
} from "./model-provider/providerProvisioningSource.js";
export {
  createProviderProvisioningTarget,
  type ProviderProvisioningTargetOptions,
} from "./model-provider/providerProvisioningTarget.js";
export {
  createModelSelectionService,
  createProviderSettingsService,
  IModelSelectionService,
  IProviderSettingsService,
} from "./model-provider/providerFacadeServices.js";
import {
  createAccountRotationService,
  createJsonFileAccountRotationStore,
  type AccountRotationCandidate,
  type AccountRotationService,
} from "./model-provider/accountRotation.js";
import { createProxyPoolService } from "./proxy-pool/proxyPoolService.js";
import {
  IProxyPoolService,
  resolveAccountFamilyProviderId,
  supportsAccountBinding,
  type ProxyProviderAccountView,
} from "./proxy-pool/proxyPool.js";
export { createAccountRequestAuthService } from "./model-provider/accountRequestAuthService.js";
export type { IAccountRequestAuthService } from "./model-provider/accountRequestAuthService.js";
export { createAccountProviderRequestAuthService } from "./model-provider/accountProviderRequestAuthService.js";
export {
  resolveAccountTeamPlanRuntimeApiKey,
  resolveAccountTeamPlanRuntimeMaterial,
} from "./model-provider/accountProviderTeamPlanRequestKey.js";
export { createAccountProjectTokenClient } from "./model-provider/accountProjectTokenClient.js";
export { createAccountProviderCredentialService } from "./model-provider/accountProviderCredentialService.js";
export { createSourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspaceService.js";
export {
  SourceServerWorkspaceIdentityChannelServer,
  SourceServerWorkspaceIdentityMapper,
} from "./source-server-workspace/sourceServerWorkspaceIdentityChannelServer.js";
export {
  SourceServerWorkspaceAliasRepo,
  SourceServerWorkspaceIdentityConflictError,
} from "./session/sourceServerWorkspaceAliasRepo.js";
export { migrateControllerRemoteWorkspaceIdentity } from "./session/controllerRemoteIdentityMigration.js";
export type {
  ControllerRemoteIdentityMigrationOptions,
  ControllerRemoteIdentityMigrationReport,
} from "./session/controllerRemoteIdentityMigration.js";
export { createUsageStatsService } from "./usage-stats/usageStatsService.js";
// Storage：service 与 adapters 工厂；desktop host 负责组装（Worker runner 在 desktop 包内）
export { createStorageService } from "./storage/app/storageService.js";
// 组装方与工厂在同一入口取类型，避免 desktop main 为服务接口再引 browser 入口。
export type { IStorageService } from "./storage/contract.js";
export type {
  FsCleanerPort as StorageFsCleanerPort,
  RootsResolverPort as StorageRootsResolverPort,
  ScanRunnerPort as StorageScanRunnerPort,
  StorageScanProgress,
  StorageScanRunRequest,
} from "./storage/app/ports.js";
export { createFsStorageCleaner } from "./storage/adapters/fsCleaner.js";
export {
  createStorageRootsResolver,
  resolveStorageRoots,
} from "./storage/adapters/rootsResolver.js";
export { createFsVolumeProbe } from "./storage/adapters/volumeProbe.js";
export { runStorageScan } from "./storage/adapters/inProcessScanRunner.js";
export { createCodingPlanSubscriptionService } from "./coding-plan-subscription/codingPlanSubscriptionService.js";
export { createClientConfigService } from "./client-config/clientConfigService.js";
export { createClientScenesService } from "./client-scenes/clientScenesService.js";
export { createSkillsService } from "./skills/skillsService.js";
export { createSkillSyncService } from "./skill-sync/skillSyncService.js";
export { createDeviceSyncStateService, createUserConfigSyncService } from "./data-sync/node.js";
export { createHostProviderProvisioningStatus } from "./provider-provisioning-status/node.js";
export { createWindowHostExtensions, type WindowHostExtensions } from "./extensions/node.js";
export { createMcpSyncService } from "./mcp-sync/mcpSyncService.js";
export { createPluginSyncService } from "./plugin-sync/pluginSyncService.js";
export { createPluginsService } from "./plugins/pluginsService.js";
export { createPluginManagementService } from "./plugins/pluginManagementService.js";
export { createSubagentsService } from "./subagents/subagentsService.js";
export { createCommandsService } from "./commands/commandsService.js";
export { createHooksService } from "./hooks/hooksService.js";
export { createMemoryService } from "./memory/memoryService.js";
export { createOutputStyleService } from "./output-style/outputStyleService.js";
export { createSettingsSyncService } from "./settings-sync/settingsSyncService.js";
export { createFeedbackDiagnosticArchive } from "./feedback/feedbackLogArchive.js";
export { createFeedbackService } from "./feedback/feedbackService.js";
export type { CreateFeedbackServiceOptions } from "./feedback/feedbackService.js";
export { createLocalPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransferService.js";
export {
  createLocalConversationShareArtifactSource,
  createRemoteConversationShareArtifactSource,
} from "./conversation-share/conversationShareArtifactSource.js";
export { createNodeApiClient, NodeApiClient } from "./providers/api/nodeApiClient.js";
export {
  createHostApiNetworkTransport,
  type HostApiNetworkTransport,
} from "./providers/api/nodeApiNetwork.js";
export {
  buildRuntimeProcessEnvPatch,
  captureLoginShellEnvSnapshot,
  normalizeRuntimeProcessEnv,
  prepareRuntimeProcessEnvPatch,
} from "./runtime-tools/runtimeCommandEnv.js";

// 定时任务管理与 scheduler 共用同一套 node-only 存储和 cron 语义。
export {
  AutomationRepo,
  DISPATCH_RETRY_BASE_MS,
  DISPATCH_RETRY_CAP_MS,
  DISPATCH_MAX_ATTEMPTS,
  CLAIM_STALE_MS,
  computeRetryAt,
} from "./session/automationRepo.js";
export { AutomationService, InvalidCronExprError } from "./session/automationService.js";
// 闲时任务与 automation 同库不同表；类型/常量全独立。
export { OffPeakTaskRepo, OFF_PEAK_CLAIM_STALE_MS } from "./session/offPeakTaskRepo.js";
// host 域终态回填 files_changed 复用现有 task diff 汇总。
export { buildTaskChangeSummary } from "./session/taskChangeSummary.js";
export { OffPeakTaskService } from "./session/offPeakTaskService.js";
export { IOffPeakTaskService } from "./session/offPeakTask.js";
export { IHighspeedCardService } from "./highspeed/highspeedCard.js";
export { createOffPeakServerClient, OffPeakServerError } from "./session/offPeakServerClient.js";
export { isOffPeakMockEnabled, startOffPeakMockGateway } from "./session/offPeakMockGateway.js";
export {
  buildOffPeakRequestAuth,
  createOffPeakOriginResolver,
  resolveOffPeakCredentials,
  resolveOffPeakCodingPlanSupport,
  resolveOffPeakMockUpstream,
  OffPeakCodingPlanUnavailableError,
  OffPeakCredentialsUnavailableError,
  OffPeakModelUnavailableError,
  OffPeakPermanentDispatchError,
} from "./session/offPeakRuntimeModel.js";
export { createServiceLogger } from "./logger/serviceLogger.js";
export {
  buildOfficialMcpAuthHeaders,
  createOfficialMcpAuthHeadersResolver,
  resolveOfficialMcpCredentials,
} from "./official-mcp/officialMcpCredentials.js";
export {
  computeAutomationNextRunAt,
  computeNextRunAt,
  computeScheduleRuleNextRunAt,
  isOneShotAutomation,
  isValidCronExpr,
} from "./session/automationCron.js";

import {
  buildServerRemoteWorkspaceIdentity,
  DEFAULT_APP_TOOL_SEARCH_MODE,
  remoteHostIdFromWorkspaceIdentity,
} from "@zcode/shared";
import { SourceServerWorkspaceAliasRepo } from "./session/sourceServerWorkspaceAliasRepo.js";
import { SourceServerWorkspaceIdentityMapper } from "./source-server-workspace/sourceServerWorkspaceIdentityChannelServer.js";
import { ServiceCollection } from "./collection.js";
import { IFileService } from "./file/file.js";
import { IMediaPreviewService } from "./media-preview/mediaPreview.js";
import { IGitService } from "./git/git.js";
import { IGitCheckpointService } from "./git/gitCheckpoint.js";
import { ISystemService } from "./system/system.js";
import { ITerminalService } from "./terminal/terminal.js";
import { ISettingService } from "./setting/setting.js";
import { IOnboardingRecordService } from "./onboarding/onboardingRecord.js";
import { ICredentialService } from "./credential/credential.js";
import { IBroadcastService } from "./broadcast/broadcast.js";
import { IXCodeTaskService } from "./session/zcodeTaskService.js";
import { IXCodeAgentService } from "./zcode-agent/zcodeAgent.js";
import type { CuaOperationStateReporter } from "./zcode-agent/cuaOperationTurnTracker.js";
import { IXCodeSessionService } from "./zcode-session/zcodeSession.js";
import {
  createUnsupportedConversationShareService,
  IConversationShareService,
  type IConversationShareService as IConversationShareServiceType,
} from "./conversation-share/conversationShare.js";
import {
  ConversationShareService,
  conversationShareConnectionScopeFactory,
} from "./conversation-share/conversationShareService.js";
import { createLocalConversationShareArtifactSource } from "./conversation-share/conversationShareArtifactSource.js";
import { ConversationShareHttpClient } from "./conversation-share/conversationShareHttpClient.js";
import { IBotsService } from "./bots/bots.js";
import { IFileWatcherService } from "./fileWatcher/fileWatcher.js";
import { IOAuthService } from "./oauth/oauth.js";
import { ISourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspace.js";
import { IUsageStatsService } from "./usage-stats/usageStats.js";
import { ICodingPlanSubscriptionService } from "./coding-plan-subscription/codingPlanSubscription.js";
import { IClientScenesService } from "./client-scenes/clientScenes.js";
import { ISkillsService } from "./skills/skills.js";
import { ISkillSyncService } from "./skill-sync/skillSync.js";
import { IMcpSyncService } from "./mcp-sync/mcpSync.js";
import { IPluginSyncService } from "./plugin-sync/pluginSync.js";
import { IUserConfigSyncService } from "./data-sync/contract.js";
import { createUserConfigSyncService } from "./data-sync/userConfigSyncService.js";
import { IPluginsService } from "./plugins/plugins.js";
import { IPluginManagementService } from "./plugins/pluginManagement.js";
import { ISubagentsService } from "./subagents/subagents.js";
import { ICommandsService } from "./commands/commands.js";
import { IHooksService } from "./hooks/hooks.js";
import { IMemoryService } from "./memory/memory.js";
import { IOutputStyleService } from "./output-style/outputStyle.js";
import { ISettingsSyncService } from "./settings-sync/settingsSync.js";
import { IFeedbackService } from "./feedback/feedback.js";
import { IPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransfer.js";
import { createFileService } from "./file/fileService.js";
import { createMediaPreviewService } from "./media-preview/mediaPreview.js";
import type { WorkspaceFileSearchFilter } from "./file/workspaceFileMentionFilter.js";
import { createGitService } from "./git/gitService.js";
import { GitCommitMessageGenerator } from "./git/gitCommitMessageGenerator.js";
import { createGitCheckpointService } from "./git/gitCheckpointService.js";
import { getWorkspaceCheckpointDirectory } from "./git/repo/gitCheckpointStore.js";
import { createSystemService } from "./system/systemService.js";
import { createTerminalService } from "./terminal/terminalService.js";
import {
  createSettingService,
  createSettingServiceWithMigrations,
} from "./setting/settingService.js";
import { createOnboardingRecordService } from "./onboarding/onboardingRecordService.js";
import { createLegacyTeamOrganizationResolver } from "./model-provider/legacyTeamOrganizationResolver.js";
import { createObservableSettingService } from "./setting/observableSettingService.js";
import { createCredentialService } from "./credential/credentialService.js";
import {
  listCodeBuddyAccounts,
  refreshCodeBuddyToken,
  setCodeBuddyAccountStore,
  upsertCodeBuddyAccount,
} from "./model-provider/codebuddyAuth.js";
import { setQoderAccountStore } from "./model-provider/qoderAuth.js";
import { setQoderCheckinHistoryStore } from "./model-provider/qoderCheckin.js";
import {
  setCodeBuddyCheckinHistoryStore,
  setCodeBuddyDeviceTokenProvider,
} from "./model-provider/codebuddyCheckin.js";
import { createCodeBuddyDeviceTokenProvider } from "./model-provider/codebuddyDeviceToken.js";
import {
  setCodeBuddyAutoCheckinSettingsStore,
  startCodeBuddyAutoCheckinScheduler,
} from "./model-provider/codebuddyAutoCheckin.js";
import {
  setQoderAutoCheckinSettingsStore,
  startQoderAutoCheckinScheduler,
} from "./model-provider/qoderAutoCheckin.js";
import {
  setAutoClaimSettingsStore,
  startAutoClaimScheduler,
  type AutoClaimClaimDelegate,
} from "./marketing-touch/autoClaim.js";
import { setAutoActivityLogStore } from "./marketing-touch/autoClaimLog.js";
import { readApiJson } from "./providers/api/apiJson.js";
import { buildXCodeSourceHeaders } from "./providers/sourceHeaders.js";
import { XCODE_MARKETING_TOUCH_URL } from "./providers/api/apiEndpoints.js";
import { ensureDeviceMidForAccountSync } from "./device/deviceMid.js";
import { createUpstreamModelListFetcher } from "./model-provider/upstreamModelListFetcher.js";
import { createBroadcastService } from "./broadcast/broadcastService.js";
import {
  createXCodeAgentService,
  getInProcessPluginUserOptionsReader,
} from "./zcode-agent/zcodeAgentService.js";
import type { PluginUserOptionsReader } from "./zcode-agent/pluginHostQueriesClient.js";
import type { XCodeAgentCommandResolver } from "./zcode-agent/zcodeAgentProcessManager.js";
import { buildAgentTelemetrySpawnEnv } from "./zcode-agent/agentTelemetryEnv.js";
import { resolveXCodeAgentPresentationSurface } from "./zcode-agent/zcodeAgentPresentationSurface.js";
import { createXCodeTaskServiceAdapter } from "./zcode-agent/zcodeTaskServiceAdapter.js";
import { createXCodeSessionService } from "./zcode-session/zcodeSessionService.js";
import { createXCodeTaskIndexSyncer } from "./zcode-agent/zcodeTaskIndexSyncer.js";
import { TaskIndexRepo } from "./session/taskIndexRepo.js";
import { AutomationRepo } from "#src/session/automationRepo.js";
import type { AppSettings } from "@zcode/shared";
import { createBotsService } from "./bots/botsService.js";
import { BotsRepo } from "#src/bots/repo.js";
import {
  createBotProjectRuntime,
  type BotProjectConnection,
} from "#src/bot-project-runtime/index.js";
export type { BotProjectConnection } from "#src/bot-project-runtime/contract.js";
import type { SessionMessageSendRequested } from "#src/session/sessionMailbox.js";
import { createFileWatcherService } from "./fileWatcher/fileWatcherService.js";
import { createOAuthService } from "./oauth/oauthService.js";
import {
  isOAuthBusinessRequest,
  resolveOAuthBusinessCredentialValidationRequest,
  isCurrentOAuthCredentialRequest,
  resolveAssociatedOAuthCredentialRequest,
} from "#src/oauth/oauthUnauthorizedRequest.js";
import { createOAuthProviderLogoutHandler } from "./oauth/oauthProviderLogout.js";
import { OAuthCredentialRepo } from "./oauth/repo/oauthCredentialRepo.js";
import { readLegacyXCodeConfigProviders } from "./model-provider/legacyXCodeConfigProviderReader.js";
import { resolveAccountTeamPlanRuntimeMaterial } from "./model-provider/accountProviderTeamPlanRequestKey.js";
import { createAccountProviderCredentialStore } from "./model-provider/accountProviderCredentialStore.js";
import { createAccountProviderCredentialService } from "./model-provider/accountProviderCredentialService.js";
import { createAccountProviderRequestAuthService } from "./model-provider/accountProviderRequestAuthService.js";
import {
  createAccountProviderConfigSource,
  createCodingPlanFamilyAvailabilityResolver,
  markProviderFamilyDomainFlip,
  resolveCurrentAccountAccess,
} from "./model-provider/accountProviderConnectionResolver.js";
import { bindAccountProviderInvalidation } from "./model-provider/accountProviderInvalidation.js";
import { AccountProviderApiClient } from "./model-provider/accountProviderApiClient.js";
import { createAccountProjectTokenClient } from "./model-provider/accountProjectTokenClient.js";
import { AccountProviderApiKeyResolver } from "./model-provider/accountProviderApiKeyResolver.js";
import { createProviderConfigRuntime } from "./model-provider/providerConfigRuntime.js";
import { fetchXCodeBuiltinRemoteRelease } from "./model-provider/zcodeBuiltinRemoteConfig.js";
import {
  createProviderRuntimeFromConfigRuntime,
  type ProviderRuntime,
} from "./model-provider/providerRuntime.js";
import {
  IModelSelectionService,
  IProviderSettingsService,
} from "./model-provider/providerFacadeServices.js";
import { createProviderSettingsConnectivityTester } from "./model-provider/providerSettingsConnectivity.js";
import {
  createProviderProvisioningSource,
  listProviderProvisioningCredentialKeys,
  PROVIDER_PROVISIONING_OAUTH_CREDENTIAL_KEYS,
  resolveCredentialFilePath,
  type ProviderProvisioningSource,
} from "./model-provider/providerProvisioningSource.js";
import { createProviderProvisioningTarget } from "./model-provider/providerProvisioningTarget.js";
import { IProviderProvisioningTargetService } from "./model-provider/providerProvisioning.js";
import { buildOffPeakModelSelectionView } from "./model-provider/offPeakModelSelectionView.js";
import { resolveClientConfigPlatform } from "./runtime-tools/clientPlatform.js";
import {
  createAccountRequestAuthService,
  type IAccountRequestAuthService,
} from "./model-provider/accountRequestAuthService.js";
import { createSourceServerWorkspaceService } from "./source-server-workspace/sourceServerWorkspaceService.js";
import { createUsageStatsService } from "./usage-stats/usageStatsService.js";
import { createCodingPlanSubscriptionService } from "./coding-plan-subscription/codingPlanSubscriptionService.js";
import { createClientConfigService } from "./client-config/clientConfigService.js";
import { IClientConfigService } from "./client-config/clientConfig.js";
import { createClientScenesService } from "./client-scenes/clientScenesService.js";
import { createSkillsService } from "./skills/skillsService.js";
import { createSkillSyncService } from "./skill-sync/skillSyncService.js";
import { createMcpSyncService } from "./mcp-sync/mcpSyncService.js";
import {
  IPluginUiAppToolsService,
  IPluginUiSamplingService,
  createPluginUiSamplingService,
  IPluginUiBridgeService,
  createPluginUiAppToolsService,
  createPluginUiBridgeService,
} from "./plugin-ui-bridge/index.js";
import type { PluginSandboxHandle, PluginSandboxRegisterInput } from "@zcode/shared/mcp-apps";
import { createPluginSyncService } from "./plugin-sync/pluginSyncService.js";
import { createPluginsService } from "./plugins/pluginsService.js";
import { createPluginManagementService } from "./plugins/pluginManagementService.js";
import { createSubagentsService } from "./subagents/subagentsService.js";
import { createCommandsService } from "./commands/commandsService.js";
import { createHooksService } from "./hooks/hooksService.js";
import { createMemoryService } from "./memory/memoryService.js";
import { createOutputStyleService } from "./output-style/outputStyleService.js";
import { createSettingsSyncService } from "./settings-sync/settingsSyncService.js";
import {
  createFeedbackService,
  type CreateFeedbackServiceOptions,
} from "./feedback/feedbackService.js";
import { createLocalPromptAttachmentTransferService } from "./prompt-attachment-transfer/promptAttachmentTransferService.js";
import { createNodeApiClient } from "./providers/api/nodeApiClient.js";
import type { ApiClient } from "@zcode/shared";

import {
  createHostApiNetworkTransport,
  type HostApiNetworkTransport,
} from "./providers/api/nodeApiNetwork.js";
import {
  createProviderPoolFetch,
  type ProviderPoolFetch,
} from "./providers/api/providerPoolFetch.js";
import {
  providerNetworkRegion,
  setProviderFetchResolver,
} from "./providers/api/providerNetwork.js";
import type {
  RuntimeProcessLifecycleReporter,
  RuntimeTaskReporter,
} from "#src/process/runtimeProcessLifecycle.js";
import { initializeRuntimeProcessEnv } from "./runtime-tools/runtimeCommandEnv.js";
import {
  buildAgentEndpointOriginEnv,
  buildAgentRuntimeEnv,
} from "./runtime-tools/agentProxyEnv.js";
import { ensureAppCaCert } from "./runtime-tools/appCaCert.js";
import { buildHelperOpenArgs, isCuaLocalDevelopmentRuntime } from "@zcode/zcode-cua/broker/server";
import type { ProviderProxyBinding } from "@zcode/shared/proxy-pool";
import { createServiceLogger, type ServiceLogger } from "#src/logger/serviceLogger.js";
import { ensureTelemetryDeviceMid } from "#src/telemetry/telemetryCore.js";
import { IOffPeakTaskService } from "./session/offPeakTask.js";
import type { HighspeedMockScenario } from "@zcode/shared";
import { IHighspeedCardService } from "./highspeed/highspeedCard.js";
import {
  buildHighspeedCodingPlanAuthHeaders,
  HighspeedCardService,
  createHighspeedHttpTransport,
} from "./highspeed/highspeedCardService.js";
import { createHighspeedMockTransport } from "./highspeed/highspeedMockTransport.js";
import { OffPeakTaskService } from "./session/offPeakTaskService.js";
import { OffPeakTaskRepo } from "./session/offPeakTaskRepo.js";
import { createOffPeakServerClient } from "./session/offPeakServerClient.js";
import {
  buildOffPeakRequestAuth,
  createOffPeakOriginResolver,
  resolveOffPeakCredentials,
  resolveOffPeakCodingPlanSupport,
  resolveOffPeakMockUpstream,
} from "./session/offPeakRuntimeModel.js";
import {
  createOfficialMcpAuthHeadersResolver,
  resolveOfficialMcpCredentials,
} from "./official-mcp/officialMcpCredentials.js";
import {
  createOfficialMcpTrustedOriginRegistry,
  OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV,
} from "@zcode/shared";
import {
  BROKER_SOCKET_ENV,
  BROKER_UNAVAILABLE_ENV,
  createCuaPipSessionService,
  createCuaProductMcpServerResolver,
  createProductCuaHelperHost,
  CuaHelperLifecycleManager,
  ICuaPermissionService,
  ICuaPipSessionService,
  isOfficialCuaPluginEnabledForWorkspace,
  isPotentialZCodeCuaAgentMcpServer,
  isScreenCaptureProbeSuccess,
  reapOrphanedHelpers,
  resolveStandaloneStatusLaunchAppPath,
  shouldRunCuaScreenCaptureProbe,
  type CuaHelperHost,
  type CuaHelperTransportRestartOptions,
  type CuaHelperTransportRestartResult,
  type ManagedCuaProductHelperHost,
  type CuaProductMcpServerResolver,
  type CuaProductMcpServerResolverContext,
  type CuaPermissionRestartOptions,
  type CuaPermissionRestartResult,
  type CuaPermissionState,
  type CuaPermissionStatusQueryOptions,
  type CuaPermissionStatusResult,
} from "#src/cua-permission-broker/index.js";
import {
  resolveWindowsCuaRuntime,
  WindowsCuaDevRuntimeResolutionError,
  type WindowsCuaRuntime,
} from "#src/cua-permission-broker/windowsCuaDevRuntime.js";
import { createCanonicalCuaHelperInstaller } from "./cua-permission-broker/cuaHelperInstaller.js";
import { WindowsCuaHelperHost } from "#src/cua-permission-broker/windowsCuaDevHelperHost.js";
import {
  getStableCuaPipeName,
  resolveStableCuaWinRecipe,
} from "#src/cua-permission-broker/stableCuaTransport.js";
import { HELPER_APP_NAME } from "@zcode/zcode-cua/broker/helperConstants";
import { resolveBrokerSocketPath } from "@zcode/zcode-cua/broker/socketPath";
import {
  DEFAULT_XCODE_MODEL_CONTEXT_BUDGET_STRATEGY,
  OAUTH_ACTIVE_ACCOUNT_CHANGED_BROADCAST_CHANNEL,
  XCODE_JWT_INVALID_BROADCAST_CHANNEL,
  formatLogPrefix,
  isCredentialDecryptError,
  isBuiltinOAuthProvider,
  isStartPlanModelProviderId,
  OFF_PEAK_PROVIDER_IDS,
  BIGMODEL_PROVIDER_ID,
  type ProviderFamilyDomain,
  type OAuthAccountAvailability,
  type ServiceAuthorityMode,
  resolveRuntimeXCodeEndpointOrigin,
  resolveSafeTelemetryHostname,
  type BrowserBackendDescriptor,
  type BrowserClientMode,
  type BrowserCommand,
  isXCodeCuaMcpCommand,
  isXCodeCuaMcpPackageArg,
  isXCodeCuaInternalFeatureEnabled,
  XCODE_CUA_PLUGIN_AUTHORITY_ENV_KEY,
  withZCodeCuaEnvAliases,
  type XCodeAutomation,
  type XCodeAutomationRun,
  getCapturedXCodeAgentTelemetryEnv,
  XCODE_DESKTOP_CONTEXT_PROMPT_ENABLED_ENV,
  ZAI_PROVIDER_ID,
  zcodeAccountAccessSchema,
  zcodeProviderAccountAccessSchema,
  XCODE_VERSION,
  XCODE_ENV,
  buildRuntimeXCodeApiUrl,
} from "@zcode/shared";

// 这些 conversation-share 实现依赖 Node 文件系统；仅通过 @zcode/services/node 暴露，
// 防止 browser-safe 根入口把 node:* 依赖带进 renderer。
export {
  ConversationShareService,
  ConversationShareHttpClient,
  conversationShareConnectionScopeFactory,
};

import { createPluginUiAccountBindings } from "./plugin-ui-bridge/instanceAccounts.js";
interface ServiceWithDisposeAll {
  disposeAll: () => void;
}

interface ServiceWithDisposeAllAndWait {
  disposeAllAndWait: () => Promise<void>;
}

// Bug A: the Helper's first cold launch (large Node SEA + first-time Gatekeeper/notarization
// assessment) routinely exceeds the old 5s health budget; warm it is <1s. Give the cold path
// plenty of headroom.
const CUA_HELPER_HEALTH_TIMEOUT_MS = 30_000;

type DefaultCuaProductHelper = {
  host: ManagedCuaProductHelperHost;
  macPermissionHost?: CuaHelperHost;
  resolver: CuaProductMcpServerResolver;
};

type ManagedDefaultCuaProductHelper = {
  helper: DefaultCuaProductHelper;
  seedContext?: CuaProductMcpServerResolverContext;
};

function hasDisposeAll(instance: unknown): instance is ServiceWithDisposeAll {
  return (
    typeof instance === "object" &&
    instance !== null &&
    "disposeAll" in instance &&
    typeof (instance as { disposeAll?: unknown }).disposeAll === "function"
  );
}

function hasDisposeAllAndWait(instance: unknown): instance is ServiceWithDisposeAllAndWait {
  return (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as { disposeAllAndWait?: unknown }).disposeAllAndWait === "function"
  );
}

interface ManagedCuaHelperHostDispose {
  stop(): Promise<void>;
}

// 默认 Computer Use Helper 是长生命周期的独立 TCC 授权进程（持 broker socket + Accessibility/Screen Recording）。
// 它不是 IPC 服务，不进 ServiceCollection 的 disposeAll 列表，但 host 释放时必须显式终止它，否则会以
// 已授权主体常驻、甚至在 services 重建时再起一个 → 多实例/孤儿/权限主体泄漏。用与 ServiceCollection 绑定
// 的 WeakMap 侧表登记，dispose 时统一终止（best-effort，不阻断其它资源回收）。
const managedCuaHelperHosts = new WeakMap<ServiceCollection, ManagedCuaHelperHostDispose>();
const providerRuntimes = new WeakMap<ServiceCollection, ProviderRuntime>();
const providerProvisioningSources = new WeakMap<ServiceCollection, ProviderProvisioningSource>();
const providerProvisioningTriggerDisposers = new WeakMap<
  ServiceCollection,
  readonly (() => void)[]
>();
// 自动归档定时扫描器不是 IPC 服务，随 services 释放时停掉定时器与设置监听。
const taskAutoArchiveDisposers = new WeakMap<ServiceCollection, () => void>();
// TaskIndexRepo / OffPeakTaskRepo 等各自持有 tasks-index.sqlite 的连接句柄；
// dispose 链必须统一关闭：Windows 上句柄悬着会让宿主回收后临时目录 rm 撞 EBUSY
// （stdioDesktopPresentationSurface 单测稳定复现），Linux 的 unlink-while-open 语义掩盖了泄漏。
// 与其它侧表一样按 ServiceCollection 登记并在 dispose 时统一 close。
const sharedSqliteRepos = new WeakMap<ServiceCollection, ReadonlyArray<{ close(): void }>>();
const accountRequestAuthServices = new WeakMap<ServiceCollection, IAccountRequestAuthService>();
export type OffPeakRequestAuthBuilder = (
  ticketId: string,
) => Promise<{ apiKey: string; headers: Record<string, string>; accountScope?: string }>;
const offPeakRequestAuthBuilders = new WeakMap<ServiceCollection, OffPeakRequestAuthBuilder>();

/** Local Host 进程内能力；不会随 ServiceCollection 暴露到通用 RPC Channel。 */
export function getAccountRequestAuthService(
  services: ServiceCollection,
): IAccountRequestAuthService | undefined {
  return accountRequestAuthServices.get(services);
}

/** Local Host 进程内的 Provisioning Source；不会把凭据通过通用 RPC 暴露给 Renderer。 */
export function getProviderProvisioningSource(
  services: ServiceCollection,
): ProviderProvisioningSource | undefined {
  return providerProvisioningSources.get(services);
}

/** Local Host 私有的闲时请求鉴权装配；复用正式 Registry/Account Access 解析，不进入 RPC。 */
export function getOffPeakRequestAuthBuilder(
  services: ServiceCollection,
): OffPeakRequestAuthBuilder | undefined {
  return offPeakRequestAuthBuilders.get(services);
}

const pluginUserOptionsReaders = new WeakMap<ServiceCollection, PluginUserOptionsReader>();

/**
 * Local Host 进程内：扩展 settings 能力读本插件 user 层有效值（含敏感值，docs/plugins/extension-host.md
 * §16.7）。不登记为服务、不挂在任何服务对象上，所以不会随 ServiceCollection 暴露到任何 RPC 频道
 * （桌面 Renderer、手机远控、远程 workspace）。Window Host 把它作为依赖交给扩展网关，网关只给调用方
 * 自己的插件。只有 createLocalServices 的集合有值；其他集合返回 undefined（调用方按「不支持」处理）。
 */
export function getPluginUserOptionsReader(
  services: ServiceCollection,
): PluginUserOptionsReader | undefined {
  return pluginUserOptionsReaders.get(services);
}
const managedHostApiNetworkTransports = new WeakMap<ServiceCollection, HostApiNetworkTransport>();
const managedProviderPoolFetches = new WeakMap<ServiceCollection, ProviderPoolFetch>();

export function registerManagedCuaHelperHostForDispose(
  services: ServiceCollection,
  host: ManagedCuaHelperHostDispose,
): void {
  managedCuaHelperHosts.set(services, host);
}

export function registerHostApiNetworkTransportForDispose(
  services: ServiceCollection,
  transport: HostApiNetworkTransport,
): void {
  managedHostApiNetworkTransports.set(services, transport);
}

export function registerProviderPoolFetchForDispose(
  services: ServiceCollection,
  poolFetch: ProviderPoolFetch,
): void {
  managedProviderPoolFetches.set(services, poolFetch);
}

export function shouldEnableDefaultCuaProductHelper(
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
  } = {},
): boolean {
  // CUA 已随正式版默认开启（isXCodeCuaInternalFeatureEnabled 默认 ON，仅显式 0/false/off 关闭；2026-08 注释更正——旧注释称默认关闭已过期）。显式开启后 macOS 使用既有产品 Helper，Windows 使用安装包内 runtime；
  // 两端都保持按需启动。关闭时不创建 host、不探测资源、不产生子进程或权限提示。
  const env = options.env ?? process.env;
  if (!isXCodeCuaInternalFeatureEnabled(env)) return false;
  const platform = options.platform ?? process.platform;
  return platform === "darwin" || platform === "win32";
}

/**
 * 是否在当前 host 创建默认 CUA product Helper。Computer Use Helper 只能由**桌面本地** authority 创建：
 * - desktop-attached-remote 与 standalone-server 都绝不自动创建，避免远端 workspace 在错误的
 *   host 上启动 Helper，破坏 shared-host attachment 与权限边界；
 * - 已显式注入 resolver 时不重复创建。
 * 平台/环境层面的启用与否另由 shouldEnableDefaultCuaProductHelper 决定。
 */
export function shouldCreateDefaultCuaProductHelper(opts: {
  serviceAuthorityMode?: ServiceAuthorityMode;
  hasRemoteWorkspaceIdentity?: boolean;
  hasInjectedResolver: boolean;
  hasBuiltInCuaPlugin: boolean;
}): boolean {
  return (
    opts.hasBuiltInCuaPlugin &&
    opts.serviceAuthorityMode === "desktop-local" &&
    !opts.hasRemoteWorkspaceIdentity &&
    !opts.hasInjectedResolver
  );
}

export function shouldUseCuaPermissionService(opts: {
  platform?: NodeJS.Platform;
  cuaEnabled: boolean;
}): boolean {
  const platform = opts.platform ?? process.platform;
  return (platform === "darwin" || platform === "win32") && opts.cuaEnabled;
}

export function shouldRetainDefaultCuaProductHelper(): boolean {
  // CUA 开关只门控后续 Agent admission；已创建的 Helper 只在 Host/App dispose 时停止。
  return true;
}

export function shouldEnableCuaOperationStateReporter(opts: {
  serviceAuthorityMode?: ServiceAuthorityMode;
  hasReporter: boolean;
}): boolean {
  // CUA 操作状态属于物理桌面投影；远端 workspace/server 不得把自己的 turn 投影到本机屏幕。
  return opts.hasReporter && opts.serviceAuthorityMode === "desktop-local";
}

export async function runCuaScreenCaptureReadinessProbe(
  host: Pick<CuaHelperHost, "queryScreenCaptureProbe">,
  screenRecording: "granted" | "denied" | "unknown",
  queryOptions?: CuaPermissionStatusQueryOptions,
): Promise<boolean> {
  if (!shouldRunCuaScreenCaptureProbe(screenRecording, queryOptions)) {
    return false;
  }
  try {
    return isScreenCaptureProbeSuccess(await host.queryScreenCaptureProbe());
  } catch {
    return false;
  }
}

/**
 * Screen Recording 的展示态取值：优先短命 Helper 读到的 TCC 真值，拿不到才沿用常驻 Helper 的报告。
 *
 * 为什么不能直接信常驻 Helper：macOS 撤销 Screen Recording 对**已运行进程**不生效 ——
 * 进程在退出前保留已获得的录屏能力，`CGPreflightScreenCaptureAccess()` 也继续返回撤销前的值。
 * 于是用户在系统设置里关掉授权后，常驻 broker Helper 会一直报 granted 直到它自己重启，
 * 设置页跟着显示「已授权」；而下一次 Helper 重启 CUA 就真的不可用了。
 * 授予方向同样陈旧：刚授权完常驻 Helper 仍可能报 denied。
 *
 * fail-open 是刻意的：预检失败（open 失败 / 超时 / 结果不合法）时沿用报告值，
 * 不比不做预检更糟。硬报 denied 会把已授权用户推进一次无意义的授权引导。
 */
export async function resolveCuaScreenRecordingState(
  host: Pick<CuaHelperHost, "queryScreenRecordingPreflight">,
  reported: "granted" | "denied" | "unknown",
): Promise<"granted" | "denied" | "unknown"> {
  // unknown 表示连 CGPreflight 符号都没拿到（macOS 10.15 前）。预检跑的是同一个 native 调用，
  // 换个进程也只会得到 unknown，不值得花一次 LaunchServices 冷启。
  if (reported === "unknown") return reported;
  try {
    return (await host.queryScreenRecordingPreflight()) ?? reported;
  } catch {
    return reported;
  }
}

export function createDynamicCuaProductMcpServerResolver(options: {
  isPluginEnabled: (context?: CuaProductMcpServerResolverContext) => boolean;
  getResolver: (
    context?: CuaProductMcpServerResolverContext,
  ) => CuaProductMcpServerResolver | undefined | Promise<CuaProductMcpServerResolver | undefined>;
  isResolverCurrent?: (
    resolver: CuaProductMcpServerResolver,
    context?: CuaProductMcpServerResolverContext,
  ) => boolean;
}): CuaProductMcpServerResolver {
  return {
    async resolveMcpServers(servers, context) {
      if (!options.isPluginEnabled(context)) return servers;
      const resolver = await options.getResolver(context);
      if (!resolver) return servers;
      const resolved = await resolver.resolveMcpServers(servers, context);
      // delegate 可能跨过 Helper start/health await；dispose 在等待中置 terminal 时，不能把旧代际
      // 刚注入的 socket/token 交给晚到 Agent。移除 CUA candidate，保持其它 MCP 原样。
      return options.isResolverCurrent?.(resolver, context) === false
        ? servers?.filter((server) => !isPotentialZCodeCuaAgentMcpServer(server))
        : resolved;
    },
    async restart() {
      // 委托到底层真实 resolver（由 ICuaPermissionService.restartHelper 经此调用）。
      const resolver = await options.getResolver();
      if (!resolver) {
        throw new Error("XCode Computer Use is not enabled (plugin off or not product mode).");
      }
      await resolver.restart();
    },
    async restartAfterPermissionGrant(onboardingSessionId) {
      // 授权完成后的 restart 必须保留 session id，才能复用底层的幂等与时序保障。
      const resolver = await options.getResolver();
      if (!resolver) {
        throw new Error("XCode Computer Use is not enabled (plugin off or not product mode).");
      }
      await resolver.restartAfterPermissionGrant(onboardingSessionId);
    },
  };
}

let orphanHelperReaperHasRun = false;

type CreateDefaultCuaProductHelperOptions = {
  // 转发给 resolver，restart 前用来判断是否有活跃 turn（见 cuaProductMcpResolver.ts）。
  // desktop-local agent service 会提供真实的 CUA turn 状态；其他调用方没有该状态时才回退为 false。
  hasActiveTurn?: () => boolean;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resourcesPath?: string;
  arch?: NodeJS.Architecture;
  electronVersion?: string;
  resolveWindowsRuntime?: () => Promise<WindowsCuaRuntime>;
  createMacHost?: () => CuaHelperHost;
  createWindowsHost?: (runtime: WindowsCuaRuntime) => ManagedCuaProductHelperHost;
};

/**
 * Windows 侧 Helper 宿主的懒解析包装：把「解析安装包运行时」推迟到首次 start()/checkHealth()，
 * 并把解析结果缓存（含 rejection）。
 *
 * resolveWindowsCuaRuntime 可能因 missing-native-addon、artifact-integrity-mismatch、
 * incompatible-runtime-manifest 等原因失败。若只向调用方抛错而没有诊断记录，设置页的
 * 「未加载」状态无法说明具体原因。因此在这里记录一条带 reason 的
 * error 日志，且因为 rejection 被缓存、日志挂在同一条 promise 链上，重复 start() 不会刷屏。
 * 载荷只有 reason/artifact/errorName/message：解析发生在 mint token 与命名管道之前，天然不含密钥。
 */
export function createWindowsCuaHelperHost(options: {
  resolveRuntime: () => Promise<WindowsCuaRuntime>;
  createHost: (runtime: WindowsCuaRuntime) => ManagedCuaProductHelperHost;
  logger?: ServiceLogger;
}): ManagedCuaProductHelperHost {
  let host: ManagedCuaProductHelperHost | undefined;
  let resolving: Promise<ManagedCuaProductHelperHost> | undefined;
  let stopped = false;
  let lifecycleEpoch = 0;
  let stopDrain: Promise<void> | undefined;
  const logResolutionFailure = (error: unknown): void => {
    if (!options.logger) return;
    const resolutionError =
      error instanceof WindowsCuaDevRuntimeResolutionError ? error : undefined;
    const artifact = resolutionError?.artifact;
    options.logger.error(undefined, "Windows CUA Helper runtime resolution failed", {
      reason: resolutionError?.reason ?? "unknown",
      ...(artifact ? { artifact } : {}),
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
  };
  const assertActive = (epoch: number): void => {
    if (stopped || epoch !== lifecycleEpoch) {
      throw new Error("Windows Computer Use Helper startup stopped");
    }
  };
  const getHost = async (epoch: number): Promise<ManagedCuaProductHelperHost> => {
    assertActive(epoch);
    if (host) return host;
    resolving ??= options
      .resolveRuntime()
      // catch 只包住 resolveRuntime 本身：下面 then 里的 assertActive 抛出是 stop() 竞态，不是解析失败，
      // 不能混进同一条诊断日志。
      .catch((error: unknown) => {
        logResolutionFailure(error);
        throw error;
      })
      .then((runtime) => {
        // stop() 会同步推进 epoch。运行时解析完成后必须再次检查，防止 dispose 返回后才构造并启动孤儿 Helper。
        assertActive(epoch);
        const nextHost = options.createHost(runtime);
        assertActive(epoch);
        host = nextHost;
        return nextHost;
      });
    const resolvedHost = await resolving;
    assertActive(epoch);
    return resolvedHost;
  };
  const withActiveHost = async <T>(
    operation: (activeHost: ManagedCuaProductHelperHost) => Promise<T>,
  ): Promise<T> => {
    const epoch = lifecycleEpoch;
    const activeHost = await getHost(epoch);
    assertActive(epoch);
    return operation(activeHost);
  };
  return {
    get running() {
      return host?.running ?? false;
    },
    get socketPath() {
      return host?.socketPath ?? null;
    },
    get pluginAuthority() {
      return host?.pluginAuthority ?? null;
    },
    async start() {
      return withActiveHost((activeHost) => activeHost.start());
    },
    async checkHealth(timeoutMs?: number) {
      return withActiveHost((activeHost) => activeHost.checkHealth(timeoutMs));
    },
    async waitForTransport(timeoutMs?: number) {
      return withActiveHost((activeHost) => {
        if (!activeHost.waitForTransport) {
          // 兼容旧注入 Host：没有两阶段接口时，完整 start handle 就是唯一可用 tuple。
          return activeHost.start().then((handle) => ({
            socketPath: handle.socketPath,
            pluginAuthority: handle.pluginAuthority,
          }));
        }
        return activeHost.waitForTransport(timeoutMs);
      });
    },
    async restart() {
      return withActiveHost((activeHost) => activeHost.restart());
    },
    async restartAfterCurrentStart() {
      return withActiveHost((activeHost) => activeHost.restartAfterCurrentStart());
    },
    async restartAfterCurrentStartPreservingTransport(
      restartOptions?: CuaHelperTransportRestartOptions,
    ): Promise<CuaHelperTransportRestartResult> {
      return withActiveHost((activeHost) => {
        if (activeHost.restartAfterCurrentStartPreservingTransport) {
          return activeHost.restartAfterCurrentStartPreservingTransport(restartOptions);
        }
        // 兼容旧注入 Host：wrapper 一旦暴露 preserving 接口，就必须代为提交 fresh-start
        // marker；否则 producer 会在新 tuple 已启动后判定 fail-closed 契约被破坏。
        restartOptions?.beforeFreshStart?.();
        return activeHost.restartAfterCurrentStart().then((handle) => ({ handle, reused: false }));
      });
    },
    async stop() {
      if (stopDrain) return stopDrain;
      stopped = true;
      lifecycleEpoch += 1;
      const pendingResolution = resolving;
      stopDrain = (async () => {
        // 等待已开始的解析落定，确保它观察到 terminal epoch；否则 dispose 之后仍可能晚到地启动 Helper。
        await pendingResolution?.catch(() => undefined);
        await host?.stop();
      })();
      return stopDrain;
    },
  };
}

export function createDefaultCuaProductHelper(
  options: CreateDefaultCuaProductHelperOptions,
): DefaultCuaProductHelper | undefined {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (!shouldEnableDefaultCuaProductHelper({ platform, env })) {
    return undefined;
  }
  const logger = createServiceLogger("cua-product-helper");
  // Best-effort, once per process: reap Helpers orphaned by prior sessions before minting a
  // fresh one. Complements the per-Helper launcher-pid watchdog (helperMain); the reaper never
  // throws, so it cannot block startup.
  if (platform === "darwin" && !orphanHelperReaperHasRun) {
    orphanHelperReaperHasRun = true;
    reapOrphanedHelpers({ logger, env });
  }
  let macPermissionHost: CuaHelperHost | undefined;
  let host: ManagedCuaProductHelperHost;
  if (platform === "darwin") {
    const bundledHelperAppPath = resolveBundledCuaHelperAppPath();
    if (!bundledHelperAppPath) {
      logger.error(
        undefined,
        "CUA product Helper is unavailable: packaged Resources path was not resolved",
      );
      return undefined;
    }
    macPermissionHost =
      options.createMacHost?.() ??
      createProductCuaHelperHost({
        logger,
        env: process.env,
        helperInstaller: createCanonicalCuaHelperInstaller({
          logger,
          env: process.env,
          bundledAppPath: bundledHelperAppPath,
        }),
        // 冲突解决原则：macOS 继续严格消费应用内置 Helper，不能退回下载源；
        // Windows 才走下方独立的安装包 runtime 解析链路。
        bundledHelperAppPath,
        // tolerate the Helper's cold first-launch instead of the 5s default.
        healthTimeoutMs: CUA_HELPER_HEALTH_TIMEOUT_MS,
        // producer product factory 统一固定 ghost cursor/PiP=true、background=false。
        // consumer 不再传伪动态 getter，避免两个仓库各保存一份产品策略。
      });
    host = macPermissionHost;
  } else {
    host = createWindowsCuaHelperHost({
      resolveRuntime:
        options.resolveWindowsRuntime ??
        (() =>
          resolveWindowsCuaRuntime({
            platform,
            env,
            resourcesPath: options.resourcesPath,
            arch: options.arch,
            electronVersion: options.electronVersion,
          })),
      createHost:
        options.createWindowsHost ??
        ((runtime) =>
          new WindowsCuaHelperHost({
            runtime,
            logger,
            mintSocketPath: () => getStableCuaPipeName(),
          })),
      logger,
    });
  }
  const resolver = createCuaProductMcpServerResolver(host, {
    hasActiveTurn: options.hasActiveTurn,
  });
  return {
    host,
    ...(macPermissionHost ? { macPermissionHost } : {}),
    resolver,
  };
}

export const XCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV = "XCODE_CUA_BUNDLED_HELPER_APP_PATH";

export function resolveBundledCuaHelperAppPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const injectedPath = env[XCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV]?.trim();
  if (injectedPath) {
    return injectedPath;
  }
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath?.trim();
  return resourcesPath ? join(resourcesPath, "cua-helper", HELPER_APP_NAME) : undefined;
}

export { isOfficialCuaPluginEnabledForWorkspace };

export function hasGlobalCliXCodeCuaServer(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = env.HOME?.trim() || homedir();
  const configPath = join(home, ".xcode", "cli", "config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  if (isRecord(parsed.features) && parsed.features.mcp === false) return false;
  if (!isRecord(parsed.mcp) || !isRecord(parsed.mcp.servers)) return false;
  return Object.entries(parsed.mcp.servers).some(([name, config]) =>
    isGlobalCliXCodeCuaServer(name, config),
  );
}

function isGlobalCliXCodeCuaServer(name: string, config: unknown): boolean {
  if (!isRecord(config)) return false;
  if (config.enabled === false) return false;
  if (typeof config.type === "string" && config.type !== "stdio") return false;
  if (name === "computer-use") return true;
  // 与 desktop/services resolver 和 CLI bootstrap 共用 @zcode/shared 的单一事实源，避免第三处
  // 判定漂移：git/.git/本地路径形态的 zcode-cua 若这里漏判，全局 CLI env 注入不会带 broker
  // socket/token，agent 会回退成 Python/uvx 自己持有 macOS TCC（违反 product broker 边界）。
  if (typeof config.command === "string" && isXCodeCuaMcpCommand(config.command)) {
    return true;
  }
  return (
    Array.isArray(config.args) &&
    config.args.some((arg) => typeof arg === "string" && isXCodeCuaMcpPackageArg(arg))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 创建包含所有本地服务的 ServiceCollection
 *
 * @param options.parentPort - Electron host process 的 parentPort，
 *        用于 BroadcastService 跨窗口中转。传 null 则广播为空操作。
 */
export function createLocalServices(options: {
  /** Desktop 注入 Main 的私有加解密桥；系统主密钥不进入 Host/CLI。 */
  credentialCipherProvider?: CredentialCipher;
  /** 已鉴权 Desktop stdio 连接提供的私有回查频道；不作为公共 service 暴露。 */
  topicResourceRelayChannel?: (request: unknown) => IChannel;
  parentPort?: Parameters<typeof createBroadcastService>[0];
  /** Desktop Window Host 提供当前 Source 身份和线路，其他宿主不推断 Desktop 状态。 */
  resolveBotRemoteWorkspace?: (target: {
    workspacePath: string;
    workspaceIdentity: string;
  }) => Promise<{ workspacePath: string; workspaceIdentity: string } | null>;
  /** Host 装配层注入的设置权威；与网络 transport 必须来自同一 Window Host 生命周期。 */
  settingService?: ISettingService;
  setWorkspaceProjection?: ReturnType<
    typeof createSettingServiceWithMigrations
  >["setWorkspaceProjection"];
  /** 与注入的本地 Setting 共用写队列；外部远端 Setting 不传，由其权威 Host 完成迁移。 */
  prepareLegacyAccountConnections?: ReturnType<
    typeof createSettingServiceWithMigrations
  >["prepareLegacyAccountConnections"];
  /** 注入后由 ServiceCollection 接管释放，并供 Host 其它 app-managed 下载复用。 */
  hostApiNetworkTransport?: HostApiNetworkTransport;
  /** Desktop Host 注入 Main 推送的实时界面语言，供 XCode endpoint 的 X-Client-Language；远端 server 不注入。 */
  resolveClientLanguage?: () => string | undefined;
  /** Desktop Host 请求 Main 登记 Agent 已授权的精确本地视频路径。 */
  authorizeLocalMediaPreviewPath?: (path: string) => Promise<string>;
  /**
   * Desktop Host 借渲染进程跑阿里云无感验证换一张领取用票据。
   *
   * 领取接口强制校验 `X-Aliyun-Captcha-Verify-Param`；手动领取由渲染进程出票，
   * host 是纯 Node 进程没有 DOM 跑不了 SDK，所以自动领取只能经 Main 转回去。
   * 未注入（远端 server 等）时自动领取会跳过并要求手动领取。
   */
  requestMarketingCaptchaProof?: (config: {
    enabled?: boolean;
    region?: string;
    prefix?: string;
    sceneId?: string;
    language?: string;
    [key: string]: unknown;
  }) => Promise<{ verifyParam: string; region?: string } | null>;
  /** 桌宠控制端口（agent PetControl 工具的落地）；desktop host 装配时注入。 */
  resolvePetControl?:
    | (() => {
        getSnapshot(): Promise<{ enabled: boolean; petId: string; behaviorState: string }>;
        setBehaviorState(state: string): Promise<{
          enabled: boolean;
          petId: string;
          behaviorState: string;
        }>;
        triggerWave(): Promise<{ enabled: boolean; petId: string; behaviorState: string }>;
      })
    | undefined;
  /**
   * 动态工作流用户选择变化后的转发口（docs/dynamic-workflow/launch.md「The user's choice」）：
   * Desktop Host 把本机设置里的选择推给本窗口所有在线的 desktop-attached remote Host。
   */
  forwardDynamicWorkflowUserMode?: (mode: DynamicWorkflowMode | undefined) => void;
  /** Desktop Host 请求 Main 登记已校验的插件 UI HTML，换取沙箱句柄。 */
  registerPluginSandbox?: (input: PluginSandboxRegisterInput) => Promise<PluginSandboxHandle>;
  feedback?: Partial<
    Omit<CreateFeedbackServiceOptions, "apiClient" | "credentialService" | "oauthService">
  >;
  reportPluginTelemetryEvent?: (
    event: import("@zcode/shared").RendererTelemetryEventPayload,
  ) => void | Promise<void>;
  /**
   * 插件管理变更成功返回（Window Host 侧信号），桌面 Host 用它重推扩展进程的插件清单，
   * 配置与重置还通知该插件的扩展设置订阅者（docs/plugins/extension-host.md §16.7）。
   */
  onPluginManagementMutated?: (
    event: import("./plugins/pluginManagementService.js").PluginMutationSucceededEvent,
  ) => void;
  processLifecycleReporter?: RuntimeProcessLifecycleReporter;
  taskRuntimeReporter?: RuntimeTaskReporter;
  /** 阻止退出的事项变化（docs/git/worktree.md §6.4）；桌面 Host 转发给 main 汇总确认。 */
  quitBlockerReporter?: {
    onQuitBlockersChanged(blockers: import("@zcode/shared").HostQuitBlocker[]): void;
  };
  /** workspace 文件搜索默认使用内置过滤器；后续规则来源只需在 Host 装配时注入最终实现。 */
  workspaceFileSearchFilter?: WorkspaceFileSearchFilter;
  forwardSessionMessageSendRequested?: (
    request: SessionMessageSendRequested,
  ) => Promise<void> | void;
  /** desktop local host 在 manual run 落库后直接派发，不经过 scheduler 正常路径。 */
  onAutomationManualRunRequested?: (params: {
    automation: XCodeAutomation;
    run: XCodeAutomationRun;
  }) => Promise<void>;
  /** 闲时任务翻 schedulable 后请求宿主立即唤醒 scheduler（desktop host 注入 parentPort 转发）。 */
  onOffPeakSchedulerWakeRequested?: () => void;
  // 注入点：默认 resolver 已能覆盖 dev/桌面/SSH 远端三类形态；
  // 测试或特殊宿主想强制走自定义 binary/参数时从这里注入。
  zcodeAgentCommandResolver?: XCodeAgentCommandResolver;
  /** Desktop Main 提前异步采集的本机 runtime 环境；Local Host 注入后不再同步启动 login shell。 */
  runtimeProcessEnvPatch?: Record<string, string>;
  /** 本地桌面上次 workspace 缺失时，仅用于 Agent 子进程 spawn.cwd 兜底。 */
  zcodeAgentSpawnFallbackCwd?: string;
  /** desktop-attached remote server 从 Desktop Host 收到的一次性 Agent 网络配置。 */
  remoteAgentNetwork?: {
    httpProxy?: string;
    noProxy?: string;
  };
  /** 所属 Environment 的 XCode Built-in Provider Config 物理路径。 */
  zcodeBuiltinProviderConfigFilePath: string;
  /** HTTP Server 只有在调用方明确配置认证时才暴露跨 Environment Provisioning target。 */
  providerProvisioningTargetEnabled?: boolean;
  /** Desktop Host 私有通知；只在 Source 成功持久化后请求 Main 调度远端镜像。 */
  onProviderProvisioningSourceChanged?: (trigger: ProviderProvisioningSourceTrigger) => void;
  serviceAuthorityMode?: ServiceAuthorityMode;
  /** 可信 Server Core 注入，区分物理持库 Host 与历史 workspace canonical route。 */
  projectStorageHostId?: string;
  sourceServerWorkspaceService?: ISourceServerWorkspaceService;
  resolveProjectHostService?: (hostId: string) => Promise<IProjectService>;
  /** 只取已在线来源的原始项目快照，不触发 identity 迁移、连接或 Agent 启动。 */
  resolveAppControlDiscoverySource?: (hostId: string) => Promise<AppControlDiscoveryConnection>;
  /** Bot 复用窗口已有 Source 连接；不经 main 创建 workspace attachment。 */
  resolveBotProjectConnection?: (hostId: string) => BotProjectConnection | undefined;
  remoteProjectConnection?: Pick<
    Parameters<typeof createRemoteProjectService>[0],
    "connectHost" | "readConnectionStates"
  >;
  cuaProductMcpServerResolver?: CuaProductMcpServerResolver;
  agentTelemetry?: {
    getDeviceMid?: () => string | undefined;
    runtimeSurface?: "desktop_local_host" | "remote_workspace_host";
  };
  /** 窄 App 导航端口，由实际窗口/手机导航 owner 注入；缺席返回 unavailable。 */
  appControlNavigation?: AppControlNavigationPort;
  /**
   * 把本 Host 的 AppControlService 交给进程内的可信组件（扩展网关的会话能力，
   * docs/plugins/extension-host.md §17.2）。它不注册进 ServiceCollection，也不在任何 RPC 频道上。
   */
  onAppControlServiceCreated?: (handle: AppControlServiceHandle) => void;
  /** browser-use 执行桥（host→main WebContentsView+CDP）；desktop host 注入，缺省则 browser 不可用。 */
  browserControlExecutor?: {
    list(input: {
      requestId: string;
      sessionId: string;
      turnId?: string;
      workspaceKey: string;
      workspacePath: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
      clientMode: BrowserClientMode;
      sessionContext: "live" | "cached";
    }): Promise<BrowserBackendDescriptor[]>;
    execute(input: {
      requestId: string;
      browserId?: string;
      browserGeneration?: number;
      sessionId: string;
      turnId?: string;
      workspaceKey: string;
      workspacePath: string;
      workspaceIdentity?: string;
      remoteSessionId?: string;
      clientMode: BrowserClientMode;
      sessionContext: "live" | "cached";
      command: BrowserCommand;
    }): Promise<{ ok: boolean; [k: string]: unknown }>;
  };
  /** Windows desktop-local Host 的 CUA turn 状态投影；其它 authority 会在装配层拒绝。 */
  cuaOperationStateReporter?: CuaOperationStateReporter;
}): ServiceCollection {
  const isDesktopAttachedRemote = options?.serviceAuthorityMode === "desktop-attached-remote";
  // host / remote server 以前直接沿用当前进程环境启动后续服务。
  // GUI 启动的 desktop、SSH/WSL/Docker 拉起的 remote server 往往拿不到用户 login shell 里的 PATH，
  // 导致 bun 这类只在 shell profile 里追加的命令在 XCode Agent/终端里不可见。
  // 这里在所有本地服务启动前统一修正运行时环境，并顺带把内置 rg 注入 PATH，
  // 让 XCode Agent、终端、认证 runtime 共用同一套命令解析结果。
  initializeRuntimeProcessEnv(options?.runtimeProcessEnvPatch);

  const desktopContextPromptEnabledRaw =
    process.env[XCODE_DESKTOP_CONTEXT_PROMPT_ENABLED_ENV]?.trim();
  const desktopContextPromptEnabled =
    desktopContextPromptEnabledRaw === "1"
      ? true
      : desktopContextPromptEnabledRaw === "0"
        ? false
        : undefined;

  // app 自签 CA：首次启动生成一份根 CA（幂等），供 agent 子进程经 NODE_EXTRA_CA_CERTS 信任、
  // 出口代理用其私钥重签。生成失败不应阻断启动（例如只读文件系统），仅记录日志后继续。
  try {
    ensureAppCaCert();
  } catch (error) {
    console.error(formatLogPrefix("appCaCert", process.pid), "ensure app CA cert failed:", error);
  }

  const localSettings = options?.settingService ? null : createSettingServiceWithMigrations();
  const settingService = createObservableSettingService(
    options?.settingService ?? localSettings!.service,
  );
  const resolveCurrentXCodeEndpointOrigin = async () =>
    resolveRuntimeXCodeEndpointOrigin(process.env, {
      overrideOrigin: (await settingService.get()).zcodeEndpointOrigin,
    });
  let invalidateProjectTokens = () => {};
  let invalidatePluginUiAccounts: (() => void) | undefined;
  const provisioningOAuthKeys = new Set<string>(PROVIDER_PROVISIONING_OAUTH_CREDENTIAL_KEYS);
  const credentialCipherProvider =
    options.credentialCipherProvider ??
    createSystemCredentialCipher({ filePath: join(resolveAppConfigDir(), "credentials.json") });
  const credentialService = createCredentialService({
    cipherProvider: credentialCipherProvider,
    onDidMutate: ({ keys, operation }) => {
      if (operation === "recover") {
        invalidatePluginUiAccounts?.();
        invalidateProjectTokens();
        options.onProviderProvisioningSourceChanged?.("credential");
        return;
      }
      if (
        keys.some((key) => key === "oauth:active_provider" || /^oauth:[^:]+:user_info$/.test(key))
      )
        invalidatePluginUiAccounts?.();
      if (keys.some((key) => provisioningOAuthKeys.has(key))) invalidateProjectTokens();
      if (keys.some((key) => provisioningOAuthKeys.has(key))) {
        options.onProviderProvisioningSourceChanged?.("credential");
      }
    },
  });
  const accountProviderCredentialStore = createAccountProviderCredentialStore({
    credentialService,
  });
  const broadcastService = createBroadcastService(options?.parentPort ?? null);
  const gitCheckpointService = createGitCheckpointService();
  const hostApiNetworkTransport =
    options?.hostApiNetworkTransport ??
    createHostApiNetworkTransport(async () => {
      const settings = await settingService.get();
      return {
        httpProxy: settings.httpProxy,
        noProxy: settings.httpProxyNoProxy,
        caCertPath: settings.httpProxyCaCertPath,
      };
    });
  let activeAccountRef: string | null = null;
  const zcodeJwtLogoutHandlerRef: {
    current: ((input: string | URL, headers: Headers) => void) | null;
  } = { current: null };
  const associatedProfileRefreshRef: {
    current:
      | ((
          expected: Pick<OAuthAccountAvailability, "loginProvider" | "userId" | "sessionRevision">,
        ) => Promise<void>)
      | null;
  } = { current: null };
  const apiClient = createNodeApiClient({
    fetchImpl: hostApiNetworkTransport.fetch,
    resolveAssociatedCredentialRefresh: async (input, headers) => {
      const material = await resolveAssociatedOAuthCredentialRequest({
        input,
        headers,
        loadMaterial: () => oauthCredentialRepo.loadFamilyMaterial("bigmodel"),
      });
      if (!material) return null;
      return async () => {
        await associatedProfileRefreshRef.current?.({
          loginProvider: material.loginProvider,
          userId: material.zcodeUserId,
          sessionRevision: material.sessionRevision,
        });
      };
    },
    onXcodeJwtInvalid: (input, headers) => zcodeJwtLogoutHandlerRef.current?.(input, headers),
    isXcodeJwtRequest: (input, headers) =>
      isCurrentOAuthCredentialRequest({ input, headers, credentialService }),
    isBusinessUnauthorizedRequest: (input, _headers) =>
      isOAuthBusinessRequest({ input, credentialService }),
    resolveBusinessCredentialValidationRequest: (input, headers) =>
      resolveOAuthBusinessCredentialValidationRequest({ input, headers, credentialService }),
    resolveXCodeEndpointOrigin: resolveCurrentXCodeEndpointOrigin,
    resolveClientLanguage: options?.resolveClientLanguage,
  });
  const systemService = createSystemService();
  // onboarding 资格与任务列表共用同一份全局 tasks-index；repo 懒加载数据库，提前构造不会
  // 增加启动 I/O，后续 session syncer 也继续复用这一实例。
  const taskIndexRepo = new TaskIndexRepo(undefined, options?.projectStorageHostId);
  // onboarding 完成记录：userId 由登录态补全（apikey/未登录为 null），见 docs/onboarding-record-spec.md。
  const onboardingEvidenceLogger = createServiceLogger("onboardingRecordService");
  const onboardingRecordService = createOnboardingRecordService({
    loadUserId: async () => (await oauthCredentialRepo.loadActiveUserProfile())?.id ?? null,
    // 老用户使用证据不能只查 tasks-index：索引是 session 同步器的衍生投影，同步器在
    // agent/provider 就绪后才回填，而判定在登录完成、主界面挂载时执行，早于回填——
    // 2026-10 线上误弹：索引重建后登录瞬间判定看到空索引，老用户被当成新用户弹出引导
    // （取证：判定时刻全部历史任务行还在 WAL 未落库）。会话库与旧版快照目录是磁盘级
    // 持久事实，与同步时序无关；includeDeleted 让清空过任务列表的存量用户也不失去
    // 资格。会话证据必须查 cli/db/db.sqlite 的 session 表（评审 CR-01：cli/sessions
    // 是工作流输出目录，且文件存在性不代表有会话）。
    hasExistingLocalTask: createHasExistingLocalTask({
      listIndexTasks: () => taskIndexRepo.listTaskMetas({ includeDeleted: true }),
      // 解析结果 null（相对路径/project 覆盖等无法镜像的配置）→ 跳过会话证据源，
      // 继续旧版快照检查；不得猜默认路径，否则自定义会话库的存量用户被漏判。
      // 跳过/命中各留一条 debug（评审 SG-02）：判定每登录一次至多一条，线上复核
      // "走了哪个证据源"有据可依；不记录完整路径，避免 home 路径进日志。
      hasAgentSessionRow: async () => {
        const sessionDbPath = await resolveAgentSessionDbPath();
        if (sessionDbPath === null) {
          onboardingEvidenceLogger.debug(
            "onboarding 会话证据源跳过：会话库路径不可镜像（相对路径或 project 级覆盖）",
          );
          return false;
        }
        const hasRow = await hasAnyAgentSessionRow(sessionDbPath);
        onboardingEvidenceLogger.debug("onboarding 会话证据源已查询", { hasRow });
        return hasRow;
      },
      resolveLegacyTaskSessionsDir: () => join(resolveAppConfigDir(), "sessions"),
    }),
  });
  let handleOAuthProviderLogout: ReturnType<typeof createOAuthProviderLogoutHandler> | null = null;
  const oauthCredentialRepo = new OAuthCredentialRepo(credentialService, {
    onCorruptOAuthSessionCleared: async (providers) => {
      // telemetry 之外的后台路径可能先读到损坏 OAuth 凭据。
      // 这类恢复也必须等价于 logout，复用同一 handler 清理派生模型 provider key。
      // 账号刷新 resolver 也可能读到损坏 token；等待下一轮刷新会让当前轮循环等待自身。
      // OAuth 删除已经完成，派生刷新交回原 Account Source 队列，后台只观察失败。
      void Promise.all(
        providers.map((provider) => handleOAuthProviderLogout?.(provider) ?? Promise.resolve()),
      ).catch((error: unknown) => {
        createServiceLogger("oauth-credential-recovery").warn(
          "refresh derived providers after corrupt OAuth cleanup failed",
          { error },
        );
      });
    },
  });
  const loadOAuthAccountMaterial = (family: ProviderFamilyDomain) =>
    oauthCredentialRepo.loadFamilyMaterial(family);
  // Start 与付费套餐分开取材料：国内无关联账号只有 Start 材料（XCode 主体与共享 JWT）。
  const loadStartPlanMaterial = (family: ProviderFamilyDomain) =>
    oauthCredentialRepo.loadStartPlanMaterial(family);
  const loadOAuthFamilyTokenSet = async (providerId: string) => {
    if (providerId !== ZAI_PROVIDER_ID && providerId !== BIGMODEL_PROVIDER_ID) return null;
    const account = await loadOAuthAccountMaterial(providerId);
    return account
      ? {
          accessToken: account.accessToken,
          zcodeJwtToken: account.zcodeJwtToken,
          sessionRevision: account.sessionRevision,
          accountIdentity: account.accountIdentity,
          zcodeUserId: account.zcodeUserId,
        }
      : null;
  };
  const projectTokenClient = createAccountProjectTokenClient(apiClient, credentialService);
  invalidateProjectTokens = () => projectTokenClient.clear();
  const accountProviderApiKeyRemoteClient = new AccountProviderApiClient(apiClient);
  const accountProviderApiKeyResolver = new AccountProviderApiKeyResolver(
    accountProviderApiKeyRemoteClient.fetchRemoteData.bind(accountProviderApiKeyRemoteClient),
    projectTokenClient,
  );
  const accountProviderCredentialService = createAccountProviderCredentialService({
    loadOAuthAccountMaterial,
    resolveProviderMaterial: (
      family,
      accessToken,
      accountIdentity,
      rejectedProjectTokenFingerprint,
    ) =>
      accountProviderApiKeyResolver.resolveProviderMaterial(
        family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID,
        accessToken,
        accountIdentity,
        rejectedProjectTokenFingerprint,
      ),
  });
  const resolveLegacyTeamOrganization = createLegacyTeamOrganizationResolver({
    apiClient,
    loadOAuthTokenSet: loadOAuthFamilyTokenSet,
  });
  const readAccountProviderSettings = async () => {
    // 迁移只在账号事实入口协调。ApiClient 的代理/端点仍读普通 Setting，不递归等待迁移。
    // 外部注入的 Setting（远端 attachment）由其所属 Host 管理，不读取本机旧文件。
    const prepare =
      options?.prepareLegacyAccountConnections ?? localSettings?.prepareLegacyAccountConnections;
    const unresolvedFamilies = (await prepare?.(resolveLegacyTeamOrganization)) ?? [];
    const settings = await settingService.get();
    return {
      providerFamilyDomain: settings.providerFamilyDomain ?? null,
      selections: settings.providerFamilyConnectionSelections ?? {},
      unresolvedFamilies,
    };
  };
  const loadAccountIdentity = async (family: ProviderFamilyDomain) =>
    (await loadOAuthAccountMaterial(family))?.accountIdentity ?? null;
  const accountRequestAuthService = createAccountRequestAuthService(
    createAccountProviderRequestAuthService({
      resolveCurrentAccountAccess: (access) =>
        resolveCurrentAccountAccess({
          access,
          readSettings: readAccountProviderSettings,
          loadAccountIdentity,
          loadStartPlanMaterial,
        }),
      loadOAuthTokenSet: loadOAuthFamilyTokenSet,
      loadStartPlanXcodeJwt: async (family) =>
        (await loadStartPlanMaterial(family))?.zcodeJwtToken ?? null,
      async loadIndividualPlanMaterial(providerId, family, rejectedProjectTokenFingerprint) {
        const accountIdentity = (await loadOAuthAccountMaterial(family))?.accountIdentity;
        if (!accountIdentity) return null;
        return accountProviderCredentialService.loadCodingPlanMaterial({
          providerId,
          family,
          accountIdentity,
          rejectedProjectTokenFingerprint,
        });
      },
      resolveTeamPlanMaterial: async (access, rejectedProjectTokenFingerprint) => {
        const accountIdentity = await loadAccountIdentity(access.family);
        if (!accountIdentity) return null;
        return resolveAccountTeamPlanRuntimeMaterial({
          apiClient,
          loadOAuthAccountMaterial,
          access,
          accountIdentity,
          tokenClient: projectTokenClient,
          rejectedProjectTokenFingerprint,
        });
      },
    }),
  );
  const providerConfigLog = createServiceLogger("provider-config");
  const clientConfigPlatform = resolveClientConfigPlatform();
  const providerConfigRuntime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: options.zcodeBuiltinProviderConfigFilePath,
    zcodeBuiltinEnvironment: {
      environmentConfigRoot: resolveAppConfigDir(),
      platform: clientConfigPlatform,
      appVersion: XCODE_VERSION,
      resolveEndpointOrigin: resolveCurrentXCodeEndpointOrigin,
      onRefreshResult: (event) => {
        if (event.result === "updated")
          providerConfigLog.info(undefined, "XCode Built-in CDN 配置已更新", event);
        else providerConfigLog.debug(undefined, "XCode Built-in 刷新检查", event);
      },
      fetchRelease: (endpointOrigin, signal) =>
        fetchXCodeBuiltinRemoteRelease({
          apiClient,
          resolveXcodeJwtToken: () => credentialService.load("zcodejwttoken"),
          endpointOrigin,
          signal,
          appVersion: XCODE_VERSION,
          platform: clientConfigPlatform,
        }),
    },
    onXCodeBuiltinRefreshError: (error) => {
      providerConfigLog.warn(undefined, "XCode Built-in Config 远端刷新失败", { error });
    },
    onPersonalConfigRecovery: (event) => {
      providerConfigLog.warn(
        undefined,
        "Personal Provider Config 加载失败，已保留磁盘状态并以内存空配置降级",
        {
          error: event.error,
        },
      );
    },
    onPersonalConfigPollingError: (error) => {
      // 轮询错误只在进入失败状态时回调一次；下一轮仍会自行重试，避免持续故障刷盘。
      providerConfigLog.warn(undefined, "Personal Provider Config 轮询暂时失败，将继续重试", {
        error,
      });
    },
    // 已发布 config.json 保存的是 XCode 用户配置；清理第三方 ACP 不能移除这条升级路径。
    // Repository 仅在新 Personal 配置不存在时导入，并保留旧文件以便回滚。
    readLegacyProviders: () => readLegacyXCodeConfigProviders(),
  });
  const accountProviderConfigSource = createAccountProviderConfigSource({
    loadSessionRevision: async () =>
      (await oauthCredentialRepo.loadSessionSnapshot())[OAUTH_SESSION_REVISION_KEY] ?? null,
    configSource: providerConfigRuntime.configService,
    readSettings: readAccountProviderSettings,
    async loadCodingPlanApiKey(providerId, family, accountIdentity, forceRefresh) {
      if (isStartPlanModelProviderId(providerId)) return null;
      return accountProviderCredentialService.loadCodingPlanApiKey({
        providerId,
        family,
        accountIdentity,
        forceRefresh,
      });
    },
    loadAccountIdentity,
    loadStartPlanMaterial,
    resolveFamilyAvailability: createCodingPlanFamilyAvailabilityResolver({
      apiClient,
      credentialService,
      loadOAuthAccountMaterial,
      loadStartPlanMaterial,
    }),
  });
  const accountProviderRuntimeLog = createServiceLogger("account-provider-runtime");
  const modelSelectionConfiguredDefaultSource = new NodeModelSelectionConfigRepository({
    personalRepository: providerConfigRuntime.personalRepository,
  });
  const providerProvisioningSource = createProviderProvisioningSource({
    cipherProvider: credentialCipherProvider,
    personalRepository: providerConfigRuntime.personalRepository,
    settingService,
    credentialFilePath: resolveCredentialFilePath(resolveAppConfigDir()),
    personalConfigFilePath: join(resolveAppConfigDir(), PERSONAL_PROVIDER_CONFIG_FILE_NAME),
  });
  const providerProvisioningDisposers = [
    providerConfigRuntime.configService.onDidChange((reason) => {
      // 每个 Window Host 都会轮询同一文件；只把本进程成功提交的 updated
      // 作为同步触发，避免其它 Host 的 poll-changed 把一次保存重复计入多个代际。
      if (reason === "personal:updated") {
        options.onProviderProvisioningSourceChanged?.("personal-config");
      }
    }),
    settingService.onDidUpdate((event) => {
      if (
        event.keys.includes("providerFamilyDomain") ||
        event.keys.includes("providerFamilyConnectionSelections")
      ) {
        options.onProviderProvisioningSourceChanged?.("account-settings");
      }
    }),
  ];
  const disposeAccountProviderInvalidation = bindAccountProviderInvalidation({
    onDidUpdateSetting: (listener) => settingService.onDidUpdate(listener),
    refresh: (reason) => accountProviderConfigSource.refresh(reason),
  });
  const accountProviderRefreshErrorDispose = accountProviderConfigSource.onDidRefreshError(
    (event) => {
      accountProviderRuntimeLog.warn(undefined, "account provider source refresh failed", {
        error: event.error,
        reasons: event.reasons,
      });
    },
  );
  let providerConnectivityAgentService:
    | Pick<IXCodeAgentService, "testModelConnectivity">
    | undefined;
  setCodeBuddyAccountStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  setQoderAccountStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  // Qoder 签到历史（本地连续签到天数）与账号列表同一加密通道持久化。
  setQoderCheckinHistoryStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  // CodeBuddy 签到历史（本地累计天数 + 自动签到"已领取当天"去重）与自动签到
  // 设置（每账号开关 + HH:MM）同样走 credentialService 加密通道。
  setCodeBuddyCheckinHistoryStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  setCodeBuddyAutoCheckinSettingsStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  // Qoder 自动签到设置（每账号开关 + HH:MM）走同一条加密通道；键前缀不同，
  // 两家的缓存互不干扰。
  setQoderAutoCheckinSettingsStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  // CodeBuddy 设备风控 token（X-Device-Token）：从本机 WorkBuddy 桌面端自带的
  // TuringShield SDK 取，带 10 分钟缓存；取不到就按无 token 继续签到。
  setCodeBuddyDeviceTokenProvider(createCodeBuddyDeviceTokenProvider());
  // 自动签到调度（进程内单例 interval + globalThis 守卫，unref 不保活）。
  // 启动即扫一次（10s 延迟）：用户下午打开应用也能补上当天的档期。
  startCodeBuddyAutoCheckinScheduler();
  startQoderAutoCheckinScheduler();
  // 官方平台版本（发往 zcode.z.ai 的 X-ZCode-App-Version / app_version）：
  // 官方更新通道 manifest 每 15 分钟刷新一次缓存，官方发版后营销投放/权益领取不会失效。
  // 启动即拉一次；定时器 unref，失败保留上次成功值（首次失败用内置基线）。
  startPlatformAppVersionRefresh();
  // 自动领取（营销权益）：设置存 credentialService 加密通道；delegate 组装
  // billing/claim 与 marketing/touch 三条链路，全部按 per-account JWT 直连。
  setAutoClaimSettingsStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  // 自动签到/领取的最近活动日志：与设置同通道（credentialService 加密）。
  setAutoActivityLogStore({
    load: (key) => credentialService.load(key),
    save: (key, value) => credentialService.save(key, value),
  });
  /**
   * 账号级代理出口的前向引用。
   *
   * 自动领取 delegate（下面）与 codingPlanSubscriptionService（2331 行）都构造在
   * `accountAwareApiClient`（约 3200 行）之前，而后者需要 providerRuntime 的 provider
   * settings 视图。用惰性 holder 打通：构造期只登记读取函数，请求期（一定在整份装配
   * 完成之后）才真正取 client。
   *
   * 为什么必须接这条线：账号绑了代理池时，营销投放查询必须走该账号的出口。之前自动领取
   * 的 `findClaimablePlanId` 直接拿裸 apiClient，绕开代理直连，表现为 `fetch failed`；
   * 手动领取走 IMarketingTouchService（已注入 accountApiClient）所以正常。
   */
  const accountAwareApiClientRef: {
    current: ((accountRef?: string) => ApiClient) | null;
  } = { current: null };

  const autoClaimDelegate: AutoClaimClaimDelegate = {
    async getPlans(accountRef) {
      return codingPlanSubscriptionService.getManualClaimPlanPlans({ accountRef });
    },
    async findClaimablePlanId(accountRef) {
      const family = accountRef.slice(0, accountRef.indexOf(":")) === "zai" ? "zai" : "bigmodel";
      const identity = accountRef.slice(accountRef.indexOf(":") + 1);
      const provider = family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
      const token =
        (await credentialService.load(`zcodejwt:${provider}:${identity}`))?.trim() ?? "";
      if (!token) return null;
      // 与 marketingTouchService.query 同构：source 头跟随目标账号。
      ensureDeviceMidForAccountSync(accountRef);
      const headers = {
        ...buildXCodeSourceHeaders({ accountRef }),
        Authorization: `Bearer ${token}`,
      };
      const url = new URL(XCODE_MARKETING_TOUCH_URL);
      url.searchParams.set("seq", "0");
      // 走账号绑定代理出口，与手动领取的 IMarketingTouchService.query 一致。
      // 装配期 holder 还没绑定（这一段在 1755 行、accountAwareApiClient 在 3200 行），
      // 但调用发生在整份装配完成之后，所以这里一定能取到。
      const client = accountAwareApiClientRef.current?.(accountRef) ?? apiClient;
      const response = await readApiJson<unknown>(client, url.href, {
        method: "GET",
        headers,
        timeoutMs: 15_000,
        redirect: "error",
      });
      const snapshot = parseMarketingTouchResponse(response);
      for (const delivery of snapshot.deliveries) {
        const buttons =
          delivery.resource_position === "banner"
            ? delivery.banner.buttons
            : delivery.popup.buttons;
        for (const item of buttons) {
          if (item.action.type === "claim_zcode_plan") return item.action.args.plan_id;
        }
      }
      return null;
    },
    async claim({ accountRef, planId }) {
      try {
        // 领取接口每次都校验阿里云验证码票据。手动领取能静默通过（无感验证），
        // 是因为渲染进程跑了 SDK；这里没有 DOM，只能经 Main 转给渲染进程代跑。
        // 拿不到票据就当「需要验证码」处理——不要空着手去撞服务端，那只会得到
        // 一句 captcha verify failed，看不出是环境问题还是服务端拒绝。
        let captchaVerifyParam: string | undefined;
        let captchaRegion: string | undefined;
        const captchaConfig = await codingPlanSubscriptionService
          .getCaptchaConfig()
          .catch(() => null);
        if (isMarketingCaptchaEnabled(captchaConfig)) {
          const proof = options.requestMarketingCaptchaProof
            ? await options.requestMarketingCaptchaProof(captchaConfig)
            : null;
          if (!proof?.verifyParam) {
            return {
              ok: false,
              requiresCaptcha: true,
              message: "未取得验证码票据（后台无法完成无感验证），请手动领取",
            };
          }
          captchaVerifyParam = proof.verifyParam;
          captchaRegion = proof.region;
        }
        const result = await codingPlanSubscriptionService.claimManualPlan({
          planId,
          accountRef,
          ...(captchaVerifyParam ? { captchaVerifyParam } : {}),
          ...(captchaRegion ? { captchaRegion } : {}),
        });
        if (!result.success) {
          // 上游要求滑块验证码时按「跳过」处理：后台无法完成浏览器内交互。
          const requiresCaptcha = /captcha|验证码/i.test(result.message ?? "");
          return { ok: false, requiresCaptcha, message: result.message };
        }
        return { ok: true };
      } catch (error) {
        // claimManualPlan 的失败有两种形态：业务信封 code!==0 时 readCodingPlanApiJson
        // 会**抛 ApiError**，只有请求成功但 payload 缺 plan 才走上面的 success:false。
        // 服务端拒绝验证码（code 3007 / HTTP 400 "captcha verify failed"）走的正是抛错
        // 那条路——不在 catch 里识别，就会被上层记成 generic failed，而「需要手动过滑块」
        // 与真正的失败是完全不同的处置，必须分开。
        const text = [
          error instanceof Error ? error.message : String(error),
          (error as { cause?: unknown })?.cause
            ? String((error as { cause?: unknown }).cause)
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (/captcha|验证码/i.test(text)) {
          return { ok: false, requiresCaptcha: true, message: text };
        }
        throw error;
      }
    },
  };
  startAutoClaimScheduler({
    delegate: autoClaimDelegate,
    listAccountRefs: async () => {
      const accounts = await oauthService.getAccounts();
      return accounts.map((entry) => `${entry.provider}:${entry.identity}`);
    },
  });
  const providerRuntime = createProviderRuntimeFromConfigRuntime({
    configRuntime: providerConfigRuntime,
    accountSource: accountProviderConfigSource,
    modelSelectionConfiguredDefaultSource,
    disposeModelSelectionConfiguredDefaultSource: () =>
      modelSelectionConfiguredDefaultSource.dispose(),
    testConnectivity: createProviderSettingsConnectivityTester({
      testModelConnectivity: async (input) => {
        if (!providerConnectivityAgentService) {
          throw new Error("Agent Service 尚未完成模型连通性测试装配");
        }
        return providerConnectivityAgentService.testModelConnectivity(input);
      },
    }),
    // XCode fork：上游模型列表拉取由 Host 直接 HTTP（GET {baseUrl}/models），
    // 复用带代理与 CA 设置的 hostApiNetworkTransport 出口，不经过 Agent 进程。
    fetchUpstreamModels: createUpstreamModelListFetcher({
      fetch: hostApiNetworkTransport.fetch,
    }),
    disposeAccountSource: () => {
      disposeAccountProviderInvalidation();
      accountProviderRefreshErrorDispose();
      accountProviderConfigSource.dispose();
    },
  });
  handleOAuthProviderLogout = createOAuthProviderLogoutHandler({
    accountProviderCredentialStore,
    refreshAccountProviders: (reason: string) => accountProviderConfigSource.refresh(reason),
  });
  const sourceServerWorkspaceService =
    options.sourceServerWorkspaceService ?? createSourceServerWorkspaceService();
  // 官方 Server MCP 的凭证解析源。MCP 调用的身份头与 MCP 额度查询（/api/v1/mcp/usage）
  // 必须共用这一份实现，否则两处对"当前选中的 Coding Plan 连接"的判定会分叉。
  // 额度侧注入的是凭证解析而非 resolveHeaders：归属校验需要 providerFamily，
  // 而身份头里没有 family；身份头仍由同一个 buildOfficialMcpAuthHeaders 构造。
  const officialMcpCredentialSource = {
    resolve: () =>
      resolveOfficialMcpCredentials({
        accountRequestAuthService,
        getRegistryRevision: () =>
          providerRuntime.registryService.getSnapshot()?.registry.revision ?? null,
        loadOAuthIdentityMaterial: () => oauthCredentialRepo.loadIdentityMaterial(),
        loadOAuthAccountMaterial,
        modelSelectionService: providerRuntime.modelSelection,
      }),
  };
  // mcpSync/hooks 里引用 zcodeAgentService 的闭包是惰性调用，声明顺序不影响初始化。
  const skillsService = createSkillsService({ isDesktopRuntime: true });
  const mcpSyncService = createMcpSyncService({
    // mcp/list 的 host 消费点收拢到 mcpSync 服务；真实状态检查仍在 agent 进程。
    listMcpServerStatuses: (params) => zcodeAgentService.listMcpServerStatuses(params),
    setWorkspaceMcpTrust: (params) => zcodeAgentService.setWorkspaceMcpTrust(params),
  });
  const pluginSyncService = createPluginSyncService();
  const pluginUiAccounts = createPluginUiAccountBindings({
    async readAccount() {
      const provider = await oauthCredentialRepo.loadActiveProvider();
      const profile = provider ? await oauthCredentialRepo.loadUserProfile(provider) : null;
      return [provider, profile?.id ?? null];
    },
    open: (params) => zcodeAgentService.openMcpUiInstance(params),
    close: (params) => zcodeAgentService.closeMcpUiInstance(params),
  });
  invalidatePluginUiAccounts = () => pluginUiAccounts.invalidate();
  const pluginUiBridgeService = createPluginUiBridgeService({
    reportTelemetryEvent: options?.reportPluginTelemetryEvent,
    openInstance: (params) => pluginUiAccounts.open(params),
    closeInstance: (params) => pluginUiAccounts.close(params),
    validateInstance: (params) => zcodeAgentService.validateMcpUiInstance(params),
    recycleInstance: (params) => zcodeAgentService.recycleMcpUiInstance(params),
    // 插件 UI：资源读取与 UI 工具调用都发生在 session 所在的 agent 进程；host 只做校验与登记。
    readMcpResource: (params) => zcodeAgentService.readMcpResource(params),
    callMcpToolForUi: (params) => zcodeAgentService.callMcpToolForUi(params),
    cancelMcpToolCallForUi: (params) => zcodeAgentService.cancelMcpToolCallForUi(params),
    readMcpResourceForUi: (params) => zcodeAgentService.readMcpResourceForUi(params),
    listMcpResourcesForUi: (params) => zcodeAgentService.listMcpResourcesForUi(params),
    listMcpResourceTemplatesForUi: (params) =>
      zcodeAgentService.listMcpResourceTemplatesForUi(params),
    subscribeMcpResourceForUi: (params) => zcodeAgentService.subscribeMcpResourceForUi(params),
    unsubscribeMcpResourceForUi: (params) => zcodeAgentService.unsubscribeMcpResourceForUi(params),
    listPluginUiSurfaces: (params) => zcodeAgentService.listPluginUiSurfaces(params),
    registerSandbox: options?.registerPluginSandbox,
  });
  // App-Provided Tools：页面工具登记与模型调用的认领 / 回传都发生在 session 所在的 agent 进程。
  const pluginUiSamplingService = createPluginUiSamplingService({
    sample: (params) => zcodeAgentService.sampleMcpApp(params),
    cancelSampling: (params) => zcodeAgentService.cancelMcpAppSampling(params),
  });
  const pluginUiAppToolsService = createPluginUiAppToolsService({
    registerAppToolsForUi: (params) => zcodeAgentService.registerAppToolsForUi(params),
    unregisterAppToolsForUi: (params) => zcodeAgentService.unregisterAppToolsForUi(params),
    claimAppToolCallForUi: (params) => zcodeAgentService.claimAppToolCallForUi(params),
    resolveAppToolCallForUi: (params) => zcodeAgentService.resolveAppToolCallForUi(params),
  });
  const subagentsService = createSubagentsService({
    isDesktopRuntime: true,
  });
  const commandsService = createCommandsService({ isDesktopRuntime: true });
  const hooksService = createHooksService({
    grantWorkspaceHookTrust: (params) => zcodeAgentService.grantWorkspaceHookTrust(params),
  });
  const memoryService = createMemoryService();
  // 只要当前进程已经装配 Provider Runtime，就由该 Environment 自己的 Selection View
  // 决定执行就绪状态。Desktop-attached remote 也读取远端自己的 Config/Account Facts。
  const modelSelectionReadinessSource = providerRuntime.modelSelection;
  const agentAccountProviderConfigSource = accountProviderConfigSource;
  // ===== Computer Use Helper lifecycle 层（port 自 feat）=====
  // 约束：lifecycle coordinator 懒获取 + 代际 fence（dispose 仅来自显式 workspace 生命周期）；
  // 不创建定时健康探测；Helper restart 尽可能复用 host transport，既有 Agent 的 session、
  // 进程与 MCP stream 保持不变。
  // P1-a mitigation：createDefaultCuaProductHelper() 在 zcodeAgentService 存在之前就要组装 resolver，
  // 但"是否有活跃 turn"这个信号只有 zcodeAgentService 建好之后才能查询。用前向引用占位——resolver 真正
  // 调用 hasActiveTurn() 发生在后续某次 resolveMcpServers（异步），那时 hasActiveTurnRef 早已被赋值。
  // 先用前向引用连接 agent service 的 CUA turn tracker，避免在活跃 CUA 请求中途重启 Helper；
  // service 创建完成后再赋值。Helper recovery 始终不能回收 Agent。
  let hasActiveTurnRef: (() => boolean) | undefined;
  const isCuaEnabledForContext = (context?: CuaProductMcpServerResolverContext): boolean =>
    // 保留 main 原有 gate 行为（避免回归）：dev/internal 特性开启时（XCODE_CUA_DEV_MODE=1 或
    // XCODE_CUA_PRODUCT_HELPER=1）即视为启用，不依赖 config.json 显式 enable——main 的 bootstrap
    // 用 isXCodeCuaInternalFeatureEnabled 门控 bundled plugin，与 feat 的 workspace enablement 不同。
    // 生产路径（dev mode off）回落到官方插件 workspace enablement 判定（与 feat 一致）。
    isXCodeCuaInternalFeatureEnabled(process.env) ||
    isOfficialCuaPluginEnabledForWorkspace({
      env: process.env,
      workingDirectory: context?.workspacePath,
    });
  const defaultCuaProductHelperLifecycle =
    new CuaHelperLifecycleManager<ManagedDefaultCuaProductHelper>(async (managed) => {
      await managed.helper.host.stop();
    });
  const createManagedDefaultCuaProductHelper = (
    context?: CuaProductMcpServerResolverContext,
  ): ManagedDefaultCuaProductHelper | undefined => {
    const helper = createDefaultCuaProductHelper({
      // 转发活跃-turn 查询（前向引用，zcodeAgentService 建好后赋值）。
      hasActiveTurn: () => hasActiveTurnRef?.() ?? false,
    });
    if (!helper) return undefined;

    // 历史默认装配启动 10 秒周期 watchdog；空闲期一次 broker_info 超时就会在后台
    // 调用 resolver.restart()。Helper 不是 Agent runtime owner，且无需在没有 CUA 需求时自愈；
    // 健康检查保留在 spawn env / resolver request boundary，避免后台 timer 干扰其他模块。
    return {
      helper,
      ...(context ? { seedContext: context } : {}),
    };
  };
  const getOrCreateDefaultCuaProductHelper = async (
    context?: CuaProductMcpServerResolverContext,
  ): Promise<DefaultCuaProductHelper | undefined> => {
    const managed = await defaultCuaProductHelperLifecycle.acquire({
      isAdmitted: () =>
        shouldCreateDefaultCuaProductHelper({
          serviceAuthorityMode: options?.serviceAuthorityMode,
          hasRemoteWorkspaceIdentity: Boolean(context?.workspaceIdentity?.trim()),
          hasInjectedResolver: Boolean(options?.cuaProductMcpServerResolver),
          hasBuiltInCuaPlugin: isCuaEnabledForContext(context),
        }),
      shouldRetainCurrent: shouldRetainDefaultCuaProductHelper,
      create: () => createManagedDefaultCuaProductHelper(context),
    });
    return managed?.helper;
  };
  const isDefaultCuaProductHelperCurrent = (helper: DefaultCuaProductHelper): boolean =>
    defaultCuaProductHelperLifecycle.peek()?.helper === helper;
  // Helper 懒启动：宿主启动时仅探测稳定 socket 上是否有一个
  // 自启动（SDK 首调拉起）的 Helper。只 ping，绝不拉起；300ms 预算。probe 结果仅用于
  // 状态展示 / PiP 凭据发现；权限详情与 onboarding 仍走显式 host 流。
  const probeStableCuaHelperSocket = async (): Promise<string | null> => {
    const socketPath =
      process.platform === "win32" ? getStableCuaPipeName() : resolveBrokerSocketPath();
    try {
      const { createConnection } = await import("node:net");
      return await new Promise<string | null>((resolve) => {
        const socket = createConnection(socketPath);
        const finish = (value: string | null): void => {
          socket.destroy();
          resolve(value);
        };
        const timer = setTimeout(() => finish(null), 300);
        socket.on("connect", () => {
          clearTimeout(timer);
          socket.write(`{"id":0,"method":"ping","params":{}}\n`);
          let buffer = "";
          socket.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
            if (buffer.includes("\n")) {
              try {
                const nl = buffer.indexOf("\n");
                const reply = JSON.parse(buffer.slice(0, nl)) as { ok?: boolean };
                finish(reply.ok === true ? socketPath : null);
              } catch {
                finish(null);
              }
            }
          });
        });
        socket.on("error", () => {
          clearTimeout(timer);
          finish(null);
        });
      });
    } catch {
      return null;
    }
  };

  // 按需启动：拉起 standalone Helper（稳定 socket）。dev 场景（本 Helper 构建内嵌 dev
  // policy）成对带 unsigned-launcher/external-escape argv，让 ad-hoc 签名的本进程也能过
  // 签名门查询；产品 Helper 不嵌 dev policy，这对 argv 无效（产品签名天然过 Team 门）。
  // 拉起后轮询 ping（5s/100ms），就绪返回 socket 路径，否则 null。
  //
  // dev 判定直接用上游的 isCuaLocalDevelopmentRuntime（@zcode/zcode-cua/broker/server，
  // 即本文件已经用来 import buildHelperOpenArgs 的那个 subpath，可正常导入）。
  //
  // 行为等价性（别误读成安全加固）：上游是 `COMPILED_LOCAL_DEVELOPMENT_RUNTIME &&
  // XCODE_RUNTIME_ENV!=="production"`，而那个编译期常量只有 scripts/build-cua-helper-app.mjs
  // 会用 define 折叠（Helper bundle）；desktop host bundle 没有该 define，于是回退成
  // `process.env.NODE_ENV !== "production"` —— 正是复制品写的那一项。所以在**当前**打包形态下
  // 两者逐字等价，关门靠的是 XCODE_RUNTIME_ENV=production（打包态显式注入且不传 NODE_ENV）。
  //
  // 换成上游的收益是消除漂移面：折叠点、因子个数与 fail-closed 方向都由上游一处决定，
  // 哪天 host bundle 也补上 __XCODE_LOCAL_DEVELOPMENT_RUNTIME__ define（Helper 侧已经有），
  // 编译期门自动生效，不需要再回来改这里。

  const cuaStatusLaunchLog = createServiceLogger("cua-status-launch");
  const launchStandaloneCuaHelperForStatus = async (): Promise<string | null> => {
    if (process.platform !== "darwin") return null;
    const { existsSync } = await import("node:fs");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const socketPath = resolveBrokerSocketPath();
    let appPath: string | null;
    try {
      appPath = await resolveStandaloneStatusLaunchAppPath({
        env: process.env,
        bundledAppPath: resolveBundledCuaHelperAppPath(),
        exists: existsSync,
        ensureInstalled: (bundledAppPath) =>
          createCanonicalCuaHelperInstaller({
            logger: cuaStatusLaunchLog,
            env: process.env,
            bundledAppPath,
          }).ensureInstalled(),
      });
    } catch (error) {
      cuaStatusLaunchLog.warn(undefined, "CUA Helper install before status launch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (!appPath) return null;
    // Helper 启动参数统一由 buildHelperOpenArgs 构造，避免多处手写导致漏传或漂移。
    // 设置页只读权限探测不承载 PiP，不传 --launcher-pid 和 --pip-mode；
    // exit-log 使用 .settings.exit.log。新增参数应定义在 HelperLaunchSpec 中供调用方共用。
    // ghostCursorOverlay 必须传：overlay 是进程级开关，Helper 常驻，设置页先拉起后
    // 真实 CUA 动作会复用同一进程 —— 漏传则整轮操作没有虚拟光标（2026-10-27 本机实测，
    // 第 6 次 argv 漏传，见 docs/cua/producer/ghost-cursor-revival-and-polish.md §0）。
    // PiP 不同：它依赖 --launcher-pid 的生命周期绑定，按原设计仍不传。
    const args = buildHelperOpenArgs({
      appPath,
      socketPath,
      exitLogPath: `${socketPath}.settings.exit.log`,
      ghostCursorOverlay: true,
      ...(isCuaLocalDevelopmentRuntime(process.env)
        ? { allowUnsignedLauncherLocalDev: true, allowExternalBrokerClientLocalDev: true }
        : {}),
    });
    try {
      await promisify(execFile)("/usr/bin/open", args, { timeout: 5_000 });
    } catch {
      // LaunchServices 已接单也可能超时；继续等 ping。
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await probeStableCuaHelperSocket();
      if (ready) return ready;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };

  const launchWindowsCuaHelperForStatus = async (): Promise<string | null> => {
    try {
      const managed = await getOrCreateDefaultCuaProductHelper(undefined);
      if (managed) void managed.host.start().catch(() => {});
    } catch {}
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ready = await probeStableCuaHelperSocket();
      if (ready) return ready;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };

  // enabled 与 onCuaPipSessionLifecycle 是否挂上，都由 serviceAuthorityMode 单点决定；
  // 提出来命名，避免下面的启动期诊断与真实取值漂移。
  const cuaPipSessionEnabled =
    process.platform === "darwin" && options?.serviceAuthorityMode === "desktop-local";
  const cuaPipSessionService = createCuaPipSessionService({
    enabled: cuaPipSessionEnabled,
    resolveCredentials: async () => {
      const host = defaultCuaProductHelperLifecycle.peek()?.helper.macPermissionHost;
      // PiP 客户端以 role=presentation 声明，资格由 Helper 按对端（XCode 主进程）签名 identifier 裁决。
      if (host?.running && host.socketPath) {
        return {
          socketPath: host.socketPath,
        };
      }
      // 懒启动：无托管 host 时探测稳定 socket 上自启动的 Helper（probe-only，不拉起）。
      const stable = await probeStableCuaHelperSocket();
      return stable ? { socketPath: stable } : undefined;
    },
  });
  // 启动期就把 PiP 投递链的接线状态写出来。dev 实测 PiP 事件一条都没投，而
  // 「enabled=false」与「lifecycle 回调没挂（tracker 整体 undefined、accept 全程 no-op）」
  // 这两种成因在运行期都不产生任何日志，只能靠这行在启动时分辨——重启即可判定，
  // 不必先跑一轮 CUA。scope 沿用 cua-pip-session：已验证该 logger 的 info 会进宿主日志。
  createServiceLogger("cua-pip-session").info(undefined, "[cua-pip-session] wiring resolved", {
    enabled: cuaPipSessionEnabled,
    platform: process.platform,
    serviceAuthorityMode: options?.serviceAuthorityMode ?? null,
    lifecycleWired: options?.serviceAuthorityMode === "desktop-local",
  });
  // Computer Use Helper macOS 权限状态服务：renderer 经 host RPC 查询当前 Helper 的运行态与权限，并在
  // 用户授权后从明确入口精确重启一次 Helper。重启**必须走 resolver.restart()**（不是裸 host.restart），
  // 因为 resolver 优先复用既有 socket/token；裸 host.restart() 可能 fresh 新凭据，使已有 Agent
  // 继续持有旧 transport，无法连接新的 broker。
  const cuaPermissionService: ICuaPermissionService = {
    async getStatus(
      workspacePath: string,
      workspaceIdentity?: string,
      queryOptions?: CuaPermissionStatusQueryOptions,
    ): Promise<CuaPermissionStatusResult> {
      if (process.platform !== "darwin" && process.platform !== "win32") {
        return {
          available: false,
          reason: "CUA permissions are only available on macOS and Windows.",
        };
      }
      const context = workspacePath ? { workspacePath, workspaceIdentity } : undefined;
      // 插件关闭只门控后续 Agent；权限页刷新不得进入 acquire，否则会把仍被已有 Agent 使用的 Helper 停掉。
      if (
        !shouldUseCuaPermissionService({
          cuaEnabled: isCuaEnabledForContext(context),
        })
      ) {
        return {
          available: false,
          reason: "XCode Computer Use is not enabled (plugin off or not product mode).",
        };
      }
      // 懒启动：状态查询绝不拉起 Helper。托管 host 在（如刚完成授权流）→ 全量查询；
      // 否则探测稳定 socket 上自启动的 Helper（probe-only）；都没有 → 未运行（首次使用时自动启动）。
      const peeked = defaultCuaProductHelperLifecycle.peek()?.helper;
      const helper = peeked && isDefaultCuaProductHelperCurrent(peeked) ? peeked : undefined;
      const host = helper ? helper.macPermissionHost : undefined;
      if (!host || !host.running) {
        // Helper 按需启动：设置页查询 = 拉起 standalone Helper（稳定 socket、
        // 无 launcher-pid → 300s 无访问自动休眠，不进托管体系）。拉起后经稳定 socket 查真值。
        let stable = await probeStableCuaHelperSocket();
        if (!stable) {
          stable =
            process.platform === "darwin"
              ? await launchStandaloneCuaHelperForStatus()
              : await launchWindowsCuaHelperForStatus();
        }
        if (!stable) {
          return {
            available: false,
            reason:
              "XCode Computer Use is not running; it will start automatically on first Computer Use use.",
            idle: true,
          } satisfies { available: false; reason: string; idle: true };
        }
        // standalone Helper 上直接查权限真值（身份模式，无 token）。
        try {
          const { callBrokerMethod } = await import("@zcode/zcode-cua/broker/helperHealth");
          const report = await callBrokerMethod<{
            grant_owner: string;
            owner?: { display_name?: string };
            accessibility: CuaPermissionState;
            accessibility_probe_ok?: boolean;
            screen_recording: CuaPermissionState;
          }>({
            socketPath: stable,
            method: "permission_status",
            timeoutMs: 3000,
          });
          return {
            grantOwner: report.grant_owner,
            grantOwnerDisplayName: report.owner?.display_name ?? report.grant_owner,
            accessibility: report.accessibility,
            accessibilityProbeOk: report.accessibility_probe_ok === true,
            screenRecording: report.screen_recording,
            screenCaptureProbeOk: false,
          };
        } catch {
          return {
            available: false,
            reason: "XCode Computer Use is starting up; retry in a moment.",
            idle: true,
          } satisfies { available: false; reason: string; idle: true };
        }
      }
      try {
        const report = await host.queryPermissionStatus();
        if (!helper || !isDefaultCuaProductHelperCurrent(helper)) {
          return {
            available: false,
            reason: "XCode Computer Use lifecycle is disposed.",
          };
        }
        // Screen Recording 的真值必须来自一个新进程：撤销对已运行的常驻 Helper 不生效，
        // 它会一直报撤销前的 granted。拿不到真值时 fail-open 沿用 report 值。
        const screenRecording = await resolveCuaScreenRecordingState(host, report.screen_recording);
        if (!isDefaultCuaProductHelperCurrent(helper)) {
          return {
            available: false,
            reason: "XCode Computer Use lifecycle is disposed.",
          };
        }
        // 真实 screen-capture 探针：TCC screen_recording === "granted" 只说明系统记录了授权，并不保证
        // WindowServer 已对本进程放行像素（wallpaper-frame / SR-not-live 背离）。只有真的抓到非空像素
        // 才算 screen 端到端可用——UI 的"就绪/自动关闭"据此判定。fail-closed：探测抛错/超时一律 false。
        // 用预检后的 state 做门控：预检已判 denied 时没有必要再花一次抓屏。
        const screenCaptureProbeOk = await runCuaScreenCaptureReadinessProbe(
          host,
          screenRecording,
          queryOptions,
        );
        if (!isDefaultCuaProductHelperCurrent(helper)) {
          return {
            available: false,
            reason: "XCode Computer Use lifecycle is disposed.",
          };
        }
        const reportedOwnerDisplayName =
          typeof report.owner?.display_name === "string" ? report.owner.display_name : undefined;
        return {
          grantOwner: report.grant_owner,
          grantOwnerDisplayName: reportedOwnerDisplayName ?? report.grant_owner,
          accessibility: report.accessibility,
          accessibilityProbeOk:
            report.accessibility_probe?.ok === true &&
            report.accessibility_probe?.classification === "functional",
          screenRecording,
          screenCaptureProbeOk,
        };
      } catch (error) {
        return {
          available: false,
          reason: `Could not read Computer Use Helper permission status: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
    async restartHelper(
      workspacePath: string,
      workspaceIdentity?: string,
      restartOptions?: CuaPermissionRestartOptions,
    ): Promise<CuaPermissionRestartResult> {
      if (process.platform !== "darwin") {
        return {
          ok: false,
          reason: "CUA permissions are only available on macOS.",
        };
      }
      const context = workspacePath ? { workspacePath, workspaceIdentity } : undefined;
      // 与 getStatus 一致：插件关闭时不触碰现有 Helper，避免设置页动作改变已有 Agent runtime。
      if (
        !shouldUseCuaPermissionService({
          cuaEnabled: isCuaEnabledForContext(context),
        })
      ) {
        return {
          ok: false,
          reason: "XCode Computer Use is not enabled (plugin off or not product mode).",
        };
      }
      // 走 resolver.restart()，让 host 尽可能复用 transport；不得通过 disposeWorkspace
      // 重建正在运行的 Agent。
      const helper = await getOrCreateDefaultCuaProductHelper(context);
      const resolver =
        helper && helper.macPermissionHost && isDefaultCuaProductHelperCurrent(helper)
          ? helper.resolver
          : undefined;
      if (!resolver) {
        return {
          ok: false,
          reason: "XCode Computer Use is not enabled (plugin off or not product mode).",
        };
      }
      try {
        if (restartOptions?.reason === "permission_granted") {
          await resolver.restartAfterPermissionGrant(restartOptions.onboardingSessionId);
        } else {
          await resolver.restart();
        }
        if (!helper || !isDefaultCuaProductHelperCurrent(helper)) {
          return {
            ok: false,
            reason: "XCode Computer Use lifecycle is disposed.",
          };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: `Failed to restart XCode Computer Use: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  };
  // 动态工作流的用户选择（docs/dynamic-workflow/launch.md「The user's choice」）：本机设置文件是唯一来源，
  // 每次使用时读取。desktop-attached remote Host 读不到桌面的设置，选择由 desktop 推送
  // （zcodeAgentService.syncDynamicWorkflowUserMode），这里不注入。读取失败按「跟随」处理。
  const resolveDynamicWorkflowUserMode = isDesktopAttachedRemote
    ? undefined
    : async () => (await settingService.get()).dynamicWorkflowMode;
  /**
   * codingPlanSubscriptionService 注入账号级出口。
   *
   * 两条领取路径共用 `claimManualPlan`：注入后手动与自动走同一个出口，
   * 不再出现「手动能领、自动 fetch failed」。
   */
  const codingPlanSubscriptionService = createCodingPlanSubscriptionService({
    apiClient,
    loadOAuthAccountMaterial,
    credentialService,
    accountApiClient: (accountRef) => {
      const resolve = accountAwareApiClientRef.current;
      return resolve ? resolve(accountRef) : apiClient;
    },
    ...(resolveDynamicWorkflowUserMode ? { resolveDynamicWorkflowUserMode } : {}),
    resolveOffPeakModelSelectionView: async () => {
      await providerRuntime.start();
      return buildOffPeakModelSelectionView(providerRuntime.registryService.getView());
    },
  });
  // OffPeakTaskService 单例在下方 DI register IIFE 中创建（晚于 agent service）；
  // 用前向引用 holder 惰性绑定——offPeak/create 协议请求只会发生在服务集合装配完成后。
  let offPeakTaskServiceForAgent: OffPeakTaskService | undefined;
  // ProxyPool 工具的 proxyPool/* 协议 handler 经这个前向引用 holder 惰性取用，
  // 与上一条同理：协议请求只会在服务集合装配完成之后到达。
  let proxyPoolServiceForAgent: IProxyPoolService | undefined;
  // oauthService 也晚于 agent service 创建；失败换号跟随激活账号的回调经此 holder 惰性取用。
  let oauthServiceForAgentRotation:
    | { switchAccount(accountRef: string): Promise<unknown> }
    | undefined;
  // desktop-attached-remote 装配不暴露 Off-Peak 工具面（远程不在支持范围）。

  // desktop-attached-remote 装配不暴露 Off-Peak 工具面（远程不在支持范围）。
  const offPeakToolWiring =
    options?.serviceAuthorityMode === "desktop-attached-remote"
      ? {}
      : {
          resolveOffPeakClientConfig: () => codingPlanSubscriptionService.getOffPeakClientConfig(),
          resolveOffPeakTaskService: () => offPeakTaskServiceForAgent,
        };
  const setWorkspaceProjection =
    options?.setWorkspaceProjection ?? localSettings?.setWorkspaceProjection;
  setWorkspaceProjection?.(async (settings) => {
    const db = await taskIndexRepo.getOrganizationDatabase();
    const repository = await taskIndexRepo.getProjectRepository();
    db.exec("BEGIN");
    try {
      const directory =
        !options?.projectStorageHostId || options.projectStorageHostId === "local"
          ? readRemoteProjectDirectory(db)
          : { hosts: [], entries: [] };
      const projection = projectWorkspaceSettings(
        repository.readTree({ includeTasks: false }).projects,
        directory,
        settings,
      );
      db.exec("COMMIT");
      return projection;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  });
  const publishProjectChange = async () => {
    // SQLite 已提交；旧字段只能在设置 owner 的锁内从最新目录派生。
    if (setWorkspaceProjection) await settingService.update({});
    await broadcastService.send({ channel: "state:projects", payload: {} });
  };
  const remoteProjectService = createRemoteProjectService({
    ...options?.remoteProjectConnection,
    controller: !options?.projectStorageHostId || options.projectStorageHostId === "local",
    database: () => taskIndexRepo.getOrganizationDatabase(),
    afterChange: publishProjectChange,
  });
  const projectService = createProjectService({
    directories: {
      home: async () => (await systemService.info()).homedir,
      read: (params) => fileService.readdir(params),
    },
    ownerHostId: options?.projectStorageHostId,
    resolveHost: options?.resolveProjectHostService,
    repository: () => taskIndexRepo.getProjectRepository(),
    workspaceDirectory: join(projectDataRoot(), "workspace"),
    afterChange: publishProjectChange,
    // zcodeAgentService 在下方创建；端口只在命令执行时取用它。
    data: {
      repository: () => taskIndexRepo.getProjectDataRepository(),
      port: createProjectDataPort({
        agent: {
          measure: (params) => {
            if (!zcodeAgentService.measureSessionData) throw new Error("project.data-unavailable");
            return zcodeAgentService.measureSessionData(params);
          },
          purge: (params) => {
            if (!zcodeAgentService.purgeSessionData) throw new Error("project.data-unavailable");
            return zcodeAgentService.purgeSessionData(params);
          },
        },
        checkpointDirectory: (workspacePath) => getWorkspaceCheckpointDirectory(workspacePath),
      }),
    },
  });
  const taskGroupService = createTaskGroupService({
    database: () => taskIndexRepo.getOrganizationDatabase(),
    resolveTasks: async (refs) => {
      // 只读所属 Host 的权威目录；项目路由不会为分组建立连接或启动 Agent。
      const hostIds = [...new Set(refs.map((task) => task.hostId))];
      const results = await Promise.all(
        hostIds.map(async (hostId) => {
          const tree = await projectService.readTree({ hostId, includeDeletedTasks: true });
          const facts = new Map(
            [
              ...tree.tasks,
              ...(tree.deletedTasks ?? []).map((task) => ({ ...task, deleted: true })),
            ].map((task) => [groupTaskKey(task), task]),
          );
          return refs
            .filter((ref) => ref.hostId === hostId)
            .flatMap((ref) => {
              const fact = facts.get(groupTaskKey(ref));
              return fact && fact.hostId === ref.hostId && fact.workspacePath === ref.workspacePath
                ? [{ ...fact, ...ref }]
                : [];
            });
        }),
      );
      return results.flat();
    },
    afterChange: () => broadcastService.send({ channel: "state:task-groups", payload: {} }),
  });
  const prepareProjectExecution = async (projectId: string) => ({
    ...(await projectService.prepareSession({ projectId })),
    hostId: options?.projectStorageHostId ?? "local",
    workspaceIdentity: undefined,
  });
  // XCode fork：多账号轮询（Qoder / CodeBuddy / zai / bigmodel），对齐 9router 的
  // fill-first / round-robin + sticky + per-model lock。
  // host 是唯一能看到全部账号凭据的地方，agent 通过 provider runtime headers
  // 反向 RPC 在每次 attempt 前取「本次用哪个账号」。
  //
  // zai / bigmodel 的账号是 Coding Plan 的 OAuth 账号，落在 oauthCredentialRepo 里，
  // 不属于任何单个 provider：账号 id 用 accountRef（`${provider}:${identity}`），
  // 与账号管理页、代理出口绑定表用同一个值对齐。
  const listAccountFamilyRotationCandidates = async (
    family: ProviderFamilyDomain,
  ): Promise<{ requestProfile: ProviderFamilyDomain; candidates: AccountRotationCandidate[] }> => {
    const activeRef = await oauthCredentialRepo.loadActiveAccountRef();
    const accounts = (await oauthCredentialRepo.listAccounts()).filter(
      (account) => account.provider === family,
    );
    const candidates: AccountRotationCandidate[] = [];
    for (const account of accounts) {
      const accountRef = `${account.provider}:${account.identity}`;
      const tokenSet = await oauthCredentialRepo.loadTokenSetForAccount(accountRef);
      // 登录态被清掉的账号（凭证缺失）不参与轮询：选中它只会在请求前抛
      // AccountRequestCredentialUnavailable，白烧一次 attempt 才轮换。
      if (!tokenSet?.accessToken?.trim()) {
        continue;
      }
      candidates.push({
        id: accountRef,
        displayName: account.displayName || account.username,
        accessToken: tokenSet.accessToken,
        active: accountRef === activeRef,
      });
    }
    return { requestProfile: family, candidates };
  };
  const accountRotationService: AccountRotationService = createAccountRotationService({
    source: {
      listCandidates: async (providerId) => {
        // zai / bigmodel：账号是 Coding Plan 的 OAuth 账号，与 providerId 无关（同族多个
        // provider 共享同一份账号表），因此先判 family 再判 requestProfile。
        const family = resolveModelProviderFamilyIdByProviderId(providerId);
        if (family) {
          return listAccountFamilyRotationCandidates(family);
        }
        const providerView = await providerRuntime.providerSettings.getView();
        const requestProfile = providerView.providers.find((item) => item.providerId === providerId)
          ?.effectiveConfig.requestProfile;
        if (requestProfile !== "qoder" && requestProfile !== "codebuddy") {
          return undefined;
        }
        const region = providerNetworkRegion(providerId);
        if (!region) {
          return undefined;
        }
        const facade = providerRuntime.providerSettings;
        if (requestProfile === "qoder") {
          const { accounts } = await facade.qoderListAccounts(region);
          return {
            requestProfile,
            candidates: accounts.map((account) => ({
              id: account.id,
              displayName: account.displayName,
              accessToken: account.accessToken,
              ...(account.machineId ? { machineId: account.machineId } : {}),
              active: account.active,
            })),
          };
        }
        const { accounts } = await facade.codebuddyListAccounts(region);
        return {
          requestProfile,
          candidates: accounts.map((account) => ({
            id: account.id,
            displayName: account.displayName,
            accessToken: account.accessToken,
            active: account.active,
          })),
        };
      },
    },
    store: createJsonFileAccountRotationStore(join(resolveAppConfigDir(), "account-rotation.json")),
  });

  let appControlService: AppControlService | undefined;
  // 受管 worktree 的删除租约：worktree 服务取得，Agent 服务与终端服务据此拒绝新操作（§8.3）。
  // 租约只在本 Host 内生效，前提是一台机器只有一个本地 Host：应用持有单实例锁，主窗口只经
  // primaryWindowCoordinator 创建并复用已有窗口，renderer 刷新复用原 Host。以后支持多个主窗口时，
  // 删除需要改由 main 跨 Host 协调（docs/git/worktree.md §8.3）。
  const worktreeRemovalGate = createWorktreeRemovalGate();
  const zcodeAgentService = createXCodeAgentService({
    credentialCipherProvider,
    runSessionOperation: (target, operation) =>
      worktreeRemovalGate.runSessionOperation(
        target.sessionId,
        async () => {
          // 只有本地任务可能运行在受管 worktree 中；cwd 只经 tasks-index 同一行得到（§2.1）。
          // 没有任务行时返回 null（未知），由闸门在删除期间拒绝，不回退为 workspace 目录。
          if (target.workspaceIdentity?.trim()) return target.workspacePath;
          return (await taskIndexRepo.getProjectRepository()).readTaskCwd({
            workspacePath: target.workspacePath,
            taskId: target.sessionId,
          });
        },
        operation,
      ),
    resolveAppControlService: () => appControlService,
    appControlSourceServerId: options?.projectStorageHostId ?? "local",
    useSharedTaskRuntime: async (target) => {
      if (options?.projectStorageHostId && options.projectStorageHostId !== "local") return false;
      return !(await taskIndexRepo.getProjectRepository()).hasProjectWorkspace(target);
    },
    prepareProjectExecution,
    prepareForkCreation: async (target) => {
      (await taskIndexRepo.getProjectRepository()).reserveCreatedTask({
        task: { ...target, taskId: target.sessionId },
        parentTaskId: target.parentSessionId,
      });
    },
    prepareSessionCreation: async (target) => {
      const prepared = (await taskIndexRepo.getProjectRepository()).reserveCreatedTask({
        task: { ...target, taskId: target.sessionId },
        projectId: target.projectId,
        creationCommand: target.creationCommand,
        additionalDirectories: target.additionalDirectories,
      });
      return { sessionId: prepared.taskId, additionalDirectories: prepared.additionalDirectories };
    },
    resolveSessionDirectories: async (target) =>
      (await projectService.resolveSessionDirectories({ ...target, taskId: target.sessionId }))
        .additionalDirectories,
    ...(agentAccountProviderConfigSource
      ? { accountProviderConfigSource: agentAccountProviderConfigSource }
      : {}),
    accountRequestAuthService,
    readRequestVerificationConfig: () =>
      codingPlanSubscriptionService.getRequestVerificationConfig(),
    accountRotationService,
    followRotatedAccount: async (accountRef) => {
      const oauth = oauthServiceForAgentRotation;
      if (!oauth) return;
      await oauth.switchAccount(accountRef);
    },
    resolvePetControl: options?.resolvePetControl,
    ...offPeakToolWiring,
    // ProxyPool 工具面不按 serviceAuthorityMode 裁剪：代理池落盘在本 Host 的设置里，
    // 远程 Host 的 agent 就该改远程 Host 自己的出口。host 侧 IProxyPoolService 缺失时
    // resolveProxyPoolService 返回 undefined，协议回 -32601，工具侧报能力不可用。
    resolveProxyPoolService: () => proxyPoolServiceForAgent,
    // ModelJailbreak 工具面：只读写 setting.json 的 customSystemMessages，
    // 与设置页「模型越狱」同一份数据，因此不需要额外的服务实例。
    resolveModelJailbreakStore: () => ({
      get: async () => {
        const settings = await settingService.get();
        return {
          ...(settings.customSystemMessages
            ? { customSystemMessages: settings.customSystemMessages }
            : {}),
          ...(settings.customPersonaTemplates
            ? { customPersonaTemplates: settings.customPersonaTemplates }
            : {}),
        };
      },
      update: async (patch) => {
        await settingService.update(patch);
      },
    }),
    // ProviderAccount 工具面：Qoder / CodeBuddy 走各自 region 账号表，
    // zai / bigmodel 走 oauthCredentialRepo。Qoder 导入缺设备指纹时由 dispatch
    // 主动向 mi-token 接口补，这里只提供刷新回调。
    resolveProviderAccountStore: () => ({
      oauth: oauthCredentialRepo,
      refreshCodeBuddy: async (region, accountId) => {
        const accounts = await listCodeBuddyAccounts(region);
        const target = accounts.accounts.find((account) => account.id === accountId);
        if (!target?.refreshToken) return false;
        const refreshed = await refreshCodeBuddyToken(region, target.refreshToken);
        if (!refreshed) return false;
        await upsertCodeBuddyAccount(region, {
          ...target,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        });
        return true;
      },
    }),

    ...(modelSelectionReadinessSource ? { modelSelectionReadinessSource } : {}),
    authorizeLocalMediaPreviewPath: options?.authorizeLocalMediaPreviewPath,
    ...offPeakToolWiring,
    // 动态工作流灰度：与 Off-Peak 不同，
    // 这里不按 serviceAuthorityMode 裁剪——SSH/WSL/Docker 的 desktop-attached-remote Host
    // 是它自己那些 workspace 的唯一裁决者，灰度开启时远程 workspace 同样提供工作流。
    resolveDynamicWorkflowClientConfig: () =>
      codingPlanSubscriptionService.getDynamicWorkflowClientConfig(),
    ...(resolveDynamicWorkflowUserMode ? { resolveDynamicWorkflowUserMode } : {}),
    forwardDynamicWorkflowUserMode: options?.forwardDynamicWorkflowUserMode,
    commandResolver: options?.zcodeAgentCommandResolver,
    presentationSurface: resolveXCodeAgentPresentationSurface({
      runtimeSurface: options?.agentTelemetry?.runtimeSurface,
      serviceAuthorityMode: options?.serviceAuthorityMode,
      desktopContextPromptEnabled,
    }),
    onAutomationManualRunRequested: options?.onAutomationManualRunRequested,
    // createLocalServices 虽然暴露了 reporter 注入点，旧装配却没有继续传给
    // XCodeAgentProcessManager，导致 host 永远不向 main 上报 Agent spawn/exit，进程监控器
    // 因而看不到实际运行的 Agent，也无法验证只读到可写升级是否复用同一进程。
    processLifecycleReporter: options?.processLifecycleReporter,
    spawnFallbackCwd: options?.zcodeAgentSpawnFallbackCwd,
    // browser-use：host→main 执行桥透传给 agent service 的 onRequest browserExecute 路由。
    browserControlExecutor: options?.browserControlExecutor,
    // 机器人凭据只归属于授权 Host；远端独立服务不能借用本机配置扩大读取范围。
    // 渠道工具等待插件入口接入，仅停用默认发送接线，保留完整实现。
    // channelReplyExecutor: async (value) => {
    //   const request = channelReplyHostRequestSchema.parse(value);
    //   if (
    //     options?.topicResourceRelayChannel &&
    //     (isDesktopAttachedRemote || request.remoteSessionId)
    //   )
    //     return channelReplyResultSchema.parse(
    //       await options.topicResourceRelayChannel(request).call("reply", request),
    //     );
    //   if (isDesktopAttachedRemote) throw new Error("Desktop channel reply peer unavailable");
    //   const bots = services.getOptional(IBotsService);
    //   if (!bots?.replyToChannel) throw new Error("Bot channel reply unavailable");
    //   return bots.replyToChannel(request);
    // },
    topicResourceExecutor: async (request, signal) => {
      if (
        options?.topicResourceRelayChannel &&
        (isDesktopAttachedRemote || request.remoteSessionId)
      )
        return readTopicResourceFromRelay(
          options.topicResourceRelayChannel(request),
          request,
          signal,
        );
      if (isDesktopAttachedRemote) throw new Error("Desktop topic resource peer unavailable");
      const bots = services.getOptional(IBotsService);
      if (!bots?.readTopicResource) throw new Error("Topic resource service is unavailable");
      return bots.readTopicResource({ ...request, signal });
    },
    topicResourceValidator: async (request, signal) => {
      if (
        options?.topicResourceRelayChannel &&
        (isDesktopAttachedRemote || request.remoteSessionId)
      )
        return validateTopicResourceFromRelay(
          options.topicResourceRelayChannel(request),
          request,
          signal,
        );
      if (isDesktopAttachedRemote) throw new Error("Desktop topic resource peer unavailable");
      const bots = services.getOptional(IBotsService);
      if (!bots?.validateTopicResource)
        throw new Error("Topic resource authorization is unavailable");
      return bots.validateTopicResource({ ...request, signal });
    },
    // 官方 Server MCP 身份头：host 是唯一身份权威，Agent 经反向请求索取。
    // Provider 存在性读取正式 Model Selection View；不恢复旧 Provider Snapshot。
    officialMcpAuthHeadersResolver: createOfficialMcpAuthHeadersResolver({
      accountRequestAuthService,
      getRegistryRevision: () =>
        providerRuntime.registryService.getSnapshot()?.registry.revision ?? null,
      loadOAuthIdentityMaterial: () => oauthCredentialRepo.loadIdentityMaterial(),
      loadOAuthAccountMaterial,
      modelSelectionService: providerRuntime.modelSelection,
    }),
    // host 是身份权威边界：provenance/origin 必须在这里再校验一次，不能只依赖 agent
    // adapter 的 fetch wrapper。判定实现与 CLI 侧共用 @zcode/shared 的同一份，避免分叉。
    // origin 解析复用 resolveCurrentXCodeEndpointOrigin——与闲时任务同口径（含 settings
    // 覆盖），否则会出现"闲时任务能连、官方 MCP 连不上"。
    // dev 开关必须同样传入，否则本地自测会被 host 单方面拒绝。
    officialMcpTrustedOrigins: createOfficialMcpTrustedOriginRegistry({
      devTrustedOriginsRaw: process.env[OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV],
      resolveXCodeApiOrigin: resolveCurrentXCodeEndpointOrigin,
    }),
    cuaOperationStateReporter: shouldEnableCuaOperationStateReporter({
      serviceAuthorityMode: options?.serviceAuthorityMode,
      hasReporter: Boolean(options?.cuaOperationStateReporter),
    })
      ? options?.cuaOperationStateReporter
      : undefined,
    // XCode 只发布 turn/session 事实；面板 terminal policy 由 producer coordinator 决定。
    ...(options?.serviceAuthorityMode === "desktop-local"
      ? {
          onCuaPipSessionLifecycle: (_workspace, event) => {
            void cuaPipSessionService.publishLifecycle(event);
          },
        }
      : {}),
    // 设置页的 HTTP 代理、No Proxy + 自定义 CA 按 spawn 时读取注入 agent 子进程 env，
    // 覆盖模型 API / MCP / Bash 出口流量并信任用户显式配置的证书；改动后下次启动 agent 生效。
    resolveSpawnEnv: async (context) => {
      const [settings] = await Promise.all([settingService.get(), providerRuntime.start()]);
      const agentNetwork =
        isDesktopAttachedRemote && options?.remoteAgentNetwork
          ? options.remoteAgentNetwork
          : {
              httpProxy: settings.httpProxy,
              noProxy: settings.httpProxyNoProxy,
            };
      const cuaPluginEnabled = isCuaEnabledForContext(context);
      let cuaProductHelperEnv: Record<string, string> = {};
      if (cuaPluginEnabled && (process.platform === "darwin" || process.platform === "win32")) {
        const brokerSocket =
          process.platform === "win32" ? getStableCuaPipeName() : resolveBrokerSocketPath();
        cuaProductHelperEnv = {
          [BROKER_SOCKET_ENV]: brokerSocket,
          [XCODE_CUA_PLUGIN_AUTHORITY_ENV_KEY]: randomBytes(16).toString("hex"),
        };
        if (process.platform === "win32") {
          const recipe = await resolveStableCuaWinRecipe();
          if (recipe) {
            cuaProductHelperEnv["XCODE_CUA_WIN_HELPER_RECIPE"] = JSON.stringify({
              ...recipe,
              hostPid: process.pid,
            });
          } else {
            cuaProductHelperEnv = {
              [BROKER_UNAVAILABLE_ENV]:
                "broker_unavailable: windows helper recipe could not be resolved",
            };
          }
        }
        // 移植进来的官方 producer 只读 ZCODE_CUA_*；XCODE_ 原名给 fork 自己的
        // plugin host / 状态查询用，别名给 producer。少这一份 producer 连不上 broker。
        cuaProductHelperEnv = withZCodeCuaEnvAliases(cuaProductHelperEnv);
      }
      const telemetryEnv = getCapturedXCodeAgentTelemetryEnv();
      const telemetryConfigured = Boolean(
        telemetryEnv.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || telemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
      );
      const telemetryProfile = telemetryConfigured
        ? await oauthCredentialRepo.loadActiveUserProfile().catch(() => null)
        : null;
      const telemetryDeviceMid = telemetryConfigured
        ? options?.agentTelemetry?.getDeviceMid?.()?.trim()
        : undefined;
      // Host 是旧配置迁移的唯一写入者。Agent spawn 前等待初始化完成，避免 Worker
      // 先拿到尚不存在的 provider_config.json 并发布短暂空 Registry。
      await providerConfigRuntime.start();
      return {
        ...buildAgentRuntimeEnv({
          httpProxy: agentNetwork.httpProxy,
          noProxy: agentNetwork.noProxy,
          caCertPath: settings.httpProxyCaCertPath,
        }),
        // 把 host 解析出的权威 origin（含 settings 覆盖）下发给 agent，否则 agent 侧只按
        // env 推导，test env + 自定义端点时两侧信任判定的输入分叉、官方 MCP 整体 fail closed。
        ...buildAgentEndpointOriginEnv(await resolveCurrentXCodeEndpointOrigin()),
        // Agent 模型请求的 X-Client-Language 默认取 Agent 进程 Intl（Dock 启动无 LANG 时回退 en-US），
        // 跟界面语言无关；这里把 Host 的实时界面语言按 spawn 时下发，切换语言后下一次启动 Agent 生效。
        // 远端 Host 不注入 resolveClientLanguage，保持远端 Intl 行为。
        ...buildAgentClientLanguageEnv(options?.resolveClientLanguage?.()),
        // broker 凭据（socket/token）注入 agent spawn env，让内置 zcode-cua plugin 的
        // computer-use MCP server 经 __zcode-plugin-host 恢复 token 后连上 broker。
        ...cuaProductHelperEnv,
        ...buildAgentTelemetrySpawnEnv({
          deviceMid: telemetryDeviceMid,
          runtimeSurface: options?.agentTelemetry?.runtimeSurface ?? "remote_workspace_host",
          telemetryEnv,
          userId: telemetryProfile?.id,
        }),
        ...createNodeProviderRuntimePathEnv({
          // Built-in Active 路径按当前 Endpoint 隔离，不能通过同步的固定路径
          // getter 读取；Agent spawn 必须等待本轮 Endpoint Source 完成解析和物化。
          zcodeBuiltinFilePath: await providerConfigRuntime.resolveXCodeBuiltinActiveFilePath(),
          personalFilePath: join(resolveAppConfigDir(), PERSONAL_PROVIDER_CONFIG_FILE_NAME),
        }),
      };
    },
    ...(!isDesktopAttachedRemote
      ? {
          prepareRuntimeWorkspace: subagentsService.prepareRuntimeState,
          readSubagentRuntimeConfig: subagentsService.readRuntimeConfig,
        }
      : {}),
    ...(isDesktopAttachedRemote
      ? { sessionRuntimePreferencesAuthority: "external" as const }
      : {
          sessionRuntimePreferencesAuthority: "local" as const,
          resolveSessionRuntimePreferences: async (scope) => {
            // 预算已统一，不能把可选远端配置作为本地/手机 shared-host 建会话的前置条件。
            const settings = await settingService.get();
            const modelContextBudgetStrategy = DEFAULT_XCODE_MODEL_CONTEXT_BUDGET_STRATEGY;
            return {
              askUserQuestionAutoResolutionEnabled:
                settings.askUserQuestionAutoResolutionEnabled !== false,
              nativeSearchEnhancementsEnabled: settings.nativeSearchEnhancementsEnabled !== false,
              toolSearchMode: settings.toolSearchMode ?? DEFAULT_APP_TOOL_SEARCH_MODE,
              memoryEnabled: settings.memoryEnabled === true,
              modelContextBudgetStrategy,
              // user-execution 只消费 Shell；共享默认策略是统一 result schema 的兼容占位，
              // 不会覆盖 runtime-materialization 阶段已经固定的 strategy。
              ...(scope === "user-execution" && settings.integratedTerminalShell
                ? { integratedTerminalShell: settings.integratedTerminalShell }
                : {}),
            };
          },
        }),
  });
  providerConnectivityAgentService = zcodeAgentService;
  // Helper health probe 短暂超时不应在 Computer Use turn 中途回收 Agent。resolver 会把 restart
  // 推迟到下一个 request/turn 边界；若 broker 确实已失效，当前 turn 会自然失败并由下一次请求恢复。
  hasActiveTurnRef = () => zcodeAgentService.hasActiveCuaOperationTurn();
  // desktop-continuous UI 直接订阅 zcodeSessionService，绕开 XCode task adapter 的
  // mapServiceEvent 路径，导致 task_complete 永远不会写回 sqlite，侧边栏 spinner 不停。
  // 在 services 层装配一个共享的 taskIndexRepo + syncer，session 任意入口都会唤醒
  // shadow 订阅，把 runtime 终态收敛进 sqlite。
  const zcodeTaskIndexSyncer = createXCodeTaskIndexSyncer({
    agentService: zcodeAgentService,
    taskIndexRepo,
  });
  // 自动归档只由这里的定时扫描触发（启动首轮 + 每小时 + 设置变更补扫）；readTree 与任务点击
  // 都不再执行 archiveInactive。判据仍排除 syncer 观察到的非终态会话，不为扫描启动 CLI。
  const taskAutoArchiveScheduler = createTaskAutoArchiveScheduler({
    readPolicy: async () => {
      const settings = await settingService.get();
      if (!settings.taskAutoArchiveEnabled) return null;
      const days = Math.max(1, Math.floor(settings.taskAutoArchiveOlderThanDays ?? 30));
      return {
        cutoff: Date.now() - days * 86_400_000,
        activeTasks: zcodeTaskIndexSyncer.activeTaskRefs(),
      };
    },
    repository: () => taskIndexRepo.getProjectRepository(),
    afterChange: async (archived) => {
      // Bug 根因：自动归档直接改 sqlite，只广播项目变更，不发 task_archived；
      // Controller 依赖任务事实流关闭已归档任务的 tab，缺事件会让出声的 Browser guest 留在后台。
      for (const task of archived) {
        zcodeTaskIndexSyncer.emitWorkspaceTaskListChanged(task, undefined, "task_archived");
      }
      await publishProjectChange();
    },
  });
  // The plugin can be toggled at runtime. Do not let a previously created resolver continue
  // health-checking/restarting Helper after disable, and create it lazily after enable.
  // 动态 resolver：isPluginEnabled 与 helper 创建用同一个 isCuaEnabledForContext 门控（dev mode 一致），
  // 避免开发场景下 resolver pass-through 而 helper 已建的割裂。
  const defaultCuaProductMcpServerResolver = createDynamicCuaProductMcpServerResolver({
    isPluginEnabled: (context) => isCuaEnabledForContext(context),
    getResolver: async () => {
      // peek-only——resolver 属托管 host 体系，host 未建时返回 undefined（懒启动下
      // CUA 经 node_repl + 稳定 socket，不依赖此 resolver）；绝不在此 acquire。
      const helper = defaultCuaProductHelperLifecycle.peek()?.helper;
      return helper && isDefaultCuaProductHelperCurrent(helper) ? helper.resolver : undefined;
    },
    isResolverCurrent: (resolver) =>
      defaultCuaProductHelperLifecycle.peek()?.helper.resolver === resolver,
  });
  const cuaProductMcpServerResolver =
    options?.cuaProductMcpServerResolver ?? defaultCuaProductMcpServerResolver;
  const zcodeSessionService = createXCodeSessionService({
    agentService: zcodeAgentService,
    taskIndexSyncer: zcodeTaskIndexSyncer,
    cuaProductMcpServerResolver,
  });
  const gitCommitMessageGenerator = new GitCommitMessageGenerator({
    currentModelProvider: {
      async readCurrentModel() {
        // Git sidecar 属于目标 Environment；初始模型直接读取同一 Host View，
        // 不再通过临时 Agent workspace state 反推模型与 reasoning。
        return (await providerRuntime.modelSelection.getView()).preferredSelection ?? null;
      },
    },
    textGenerator: {
      async generateText(params) {
        return await zcodeAgentService.generateWorkspaceText({
          workspacePath: params.workspacePath,
          ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
          selection: params.selection,
          prompt: params.prompt,
          querySource: params.querySource,
        });
      },
    },
    logger: createServiceLogger("git-commit-message"),
  });
  const gitService = createGitService({
    commitMessageGenerator: gitCommitMessageGenerator,
  });
  // 终端实例需要同时注册给 renderer 与供 worktree 删除前的占用检查使用，必须是同一个实例。
  const terminalService = createTerminalService({
    settingService,
    isCwdBlocked: (cwd) => worktreeRemovalGate.isRemoving(cwd),
  });
  const isLocalProjectHost =
    !options?.projectStorageHostId || options.projectStorageHostId === "local";
  const managedWorktreeService = createManagedWorktreeService({
    isLocalHost: isLocalProjectHost,
    repository: () => taskIndexRepo.getProjectRepository(),
    git: createGitWorktreeRepo({
      commandProvider: createGitCommandProvider(),
      dataBaseDir: getDataBaseDir,
    }),
    removalGate: worktreeRemovalGate,
    runtime: {
      hasTerminalsUnder: async (path) =>
        (await terminalService.listTerminalIdsUnderPath({ path })).length > 0,
      releaseSessionsUnder: async (target) => {
        if (!zcodeAgentService.releaseSessionsUnderDirectory)
          throw new Error("worktree.release-unsupported");
        return await zcodeAgentService.releaseSessionsUnderDirectory(target);
      },
    },
    agent: {
      supportsWorktreeCwd: async (target) =>
        (await zcodeAgentService.supportsWorktreeCwd?.(target)) ?? false,
      // HOST_WORKTREE_COMMAND 只有本服务能设置，渲染进程经 RPC 无法携带（§5.1）。
      sendCommand: (command) =>
        zcodeAgentService.sendConversationCommandV4({ ...command, [HOST_WORKTREE_COMMAND]: true }),
      queryCommandResult: async (target) => {
        if (!zcodeAgentService.queryCommandResult) throw new Error("worktree.query-unsupported");
        return await zcodeAgentService.queryCommandResult(target);
      },
    },
    reportCreatingCount: (count) =>
      options?.quitBlockerReporter?.onQuitBlockersChanged(
        count > 0 ? [{ kind: "worktree-creating", count }] : [],
      ),
    afterChange: publishProjectChange,
  });
  // task wrapper 由 XCode task service adapter 提供；核心 session 状态由 XCode agent server 维护。
  const zcodeTaskService = createXCodeTaskServiceAdapter({
    zcodeAgentService,
    taskIndexRepo,
    taskIndexSyncer: zcodeTaskIndexSyncer,
    settingService,
    cuaProductMcpServerResolver,
  });
  appControlService = createAppControlService({
    sourceServerId: options?.projectStorageHostId ?? "local",
    projects: projectService,
    discovery: createAppControlDiscoveryDirectory({
      sourceServerId: options?.projectStorageHostId ?? "local",
      projects: projectService,
      ...(!options?.projectStorageHostId || options.projectStorageHostId === "local"
        ? { remoteProjects: remoteProjectService }
        : {}),
      resolveSource: options?.resolveAppControlDiscoverySource,
    }),
    resolveWorkspaceIdentity:
      options?.projectStorageHostId && options.projectStorageHostId !== "local"
        ? async (workspacePath) =>
            (await sourceServerWorkspaceService.resolveWorkspace({ workspacePath }))
              .canonicalWorkspaceKey
        : undefined,
    tasks: zcodeTaskService,
    agent: zcodeAgentService,
    models: providerRuntime.modelSelection,
    navigation: options?.appControlNavigation,
    prepareCreation: ({ projectId }) => projectService.prepareSession({ projectId }),
    findCreationReceipts: async (creationCommand) =>
      (await taskIndexRepo.getProjectRepository()).findCreationReceipts({ creationCommand }),
    reserveFork: async (target) => {
      // 分叉正文由 CLI 创建；产品归属仍经 Host 的既有原子预留 owner。
      (await taskIndexRepo.getProjectRepository()).reserveCreatedTask({
        task: target,
        projectId: target.projectId,
        forkedFromTaskId: target.forkedFromTaskId,
      });
    },
  });
  options?.onAppControlServiceCreated?.({
    service: appControlService,
    sourceServerId: options?.projectStorageHostId ?? "local",
  });
  const botsRepo = new BotsRepo();
  const botLog = createServiceLogger("bots");
  const botRemoteWorkspaceService = options.resolveBotProjectConnection
    ? createBotProjectRuntime({
        remoteProjectService,
        resolveOnline: options.resolveBotProjectConnection,
        onConnectionsChanged: (listener) =>
          broadcastService.onMessage((event) => {
            if (event.channel === "state:projects") listener();
          }),
        readBoundTargets: async () =>
          Object.values((await botsRepo.readState()).bots).flatMap((context) =>
            context.workspaceIdentity
              ? [
                  {
                    workspacePath: context.workspacePath,
                    workspaceIdentity: context.workspaceIdentity,
                    hostId: context.hostId,
                  },
                ]
              : [],
          ),
        readRuntimePreferences: async () => {
          const settings = await settingService.get();
          return {
            askUserQuestionAutoResolutionEnabled:
              settings.askUserQuestionAutoResolutionEnabled !== false,
            modelIoFullRetentionEnabled: settings.modelIoFullRetentionEnabled === true,
            pluginAutoRecommendationEnabled: settings.pluginAutoRecommendationEnabled === true,
          };
        },
        warn: (message) => botLog.warn(message),
      })
    : undefined;
  /** accountRef = `${provider}:${identity}`；provider 即 providerFamilyDomain 枚举值。 */
  const resolveAccountRefFamily = (accountRef: string): "zai" | "bigmodel" | null => {
    const provider = accountRef.slice(0, Math.max(0, accountRef.indexOf(":")));
    return provider === ZAI_PROVIDER_ID || provider === BIGMODEL_PROVIDER_ID
      ? (provider as "zai" | "bigmodel")
      : null;
  };
  const reconcileProviderFamilyDomain = async (accountRef: string | null): Promise<void> => {
    const family = accountRef ? resolveAccountRefFamily(accountRef) : null;
    if (!family) return;
    const settings = await settingService.get();
    if (settings.providerFamilyDomain === family) return;
    // 记录翻转时刻：宽限窗口内进行中的旧 family 请求仍可解析凭据，避免切号瞬间打断会话。
    markProviderFamilyDomainFlip();
    await settingService.update({ providerFamilyDomain: family });
  };
  const oauthService = createOAuthService(credentialService, {
    captureCredentialGuard: () => credentialService.captureRecoveryGuard(),
    apiClient,
    onProviderLogout: handleOAuthProviderLogout,
    onActiveAccountChanged: async (accountRef) => {
      activeAccountRef = accountRef ?? null;
      // 为激活账号同步落盘独立设备标识，保证第一个请求就用账号固定值。
      if (accountRef) {
        try {
          ensureDeviceMidForAccountSync(accountRef);
        } catch {
          // 落盘失败不阻断切号。
        }
        // 切号后运行域跟随新账号 family（registry 按 providerFamilyDomain 过滤 provider；
        // 清空/残留旧 family 都会让 Start Plan/编程套餐被判「供应商不可用」）。
        // connectionSelections 是 family 级「连接方式选择」（不含账号身份），不动。
        try {
          await reconcileProviderFamilyDomain(accountRef);
        } catch {
          // 设置服务暂不可用时不阻断切号。
        }
      }
      // 切号后刷新 account 源，让 providerSettingsView / 套餐权益跟随新账号。
      void accountProviderConfigSource.refresh("oauth-account-switch").catch((error) => {
        // 刷新失败不阻断切号；由下一次 onDidChange/主动刷新收敛。
        console.warn("[oauth] account source refresh after switch failed", error);
      });
      // host 侧切号（含失败换号的自动跟随）也要让渲染进程刷新登录态快照
      // （左下角头像/账号名）；手动切号由 UI 自身更新，收不到也无碍。
      void broadcastService
        .send({ channel: OAUTH_ACTIVE_ACCOUNT_CHANGED_BROADCAST_CHANNEL, payload: {} })
        .catch((error) => {
          console.warn("[oauth] active account changed broadcast failed", error);
        });
    },
  });
  oauthServiceForAgentRotation = oauthService;
  // 迁移旧单账号数据为首条账号记录，并同步激活账号引用（供 X-Device-Mid 按账号读取）。
  void (async () => {
    try {
      const migrated = await oauthCredentialRepo.migrateLegacySingleAccount();
      activeAccountRef = migrated ?? (await oauthCredentialRepo.loadActiveAccountRef());
    } catch (error) {
      // 迁移失败不阻断；回退读取现有激活账号。
      try {
        activeAccountRef = await oauthCredentialRepo.loadActiveAccountRef();
      } catch {
        activeAccountRef = null;
      }
    }
    if (activeAccountRef) {
      try {
        ensureDeviceMidForAccountSync(activeAccountRef);
      } catch {
        // 落盘失败不阻断。
      }
      // 兜底校正：此前版本切号时把 providerFamilyDomain 清空过，会导致 registry
      // 过滤掉全部 family → Start Plan/编程套餐「供应商不可用」。启动时按激活账号
      // family 校正回来，自愈历史脏数据。
      try {
        await reconcileProviderFamilyDomain(activeAccountRef);
      } catch {
        // 校正失败不阻断启动。
      }
    }
  })();
  associatedProfileRefreshRef.current = async (expected) => {
    await oauthService.refreshAccountProfile(expected);
  };
  const zcodeJwtLogoutLogger = createServiceLogger("zcode-jwt-logout");
  zcodeJwtLogoutHandlerRef.current = (input, headers) => {
    // 条件退出本身已串行去重；不能丢弃等待旧候选期间到来的新凭据 401。
    void oauthService
      .logoutIfCurrentCredentialRequest(input, headers)
      .then((invalidated) => {
        // 401 分类后可能已完成新登录；只有队列内真正清理的旧会话才广播过期。
        if (invalidated) {
          void broadcastService.send({
            channel: XCODE_JWT_INVALID_BROADCAST_CHANNEL,
            payload: {},
          });
        }
      })
      .catch((error) => {
        zcodeJwtLogoutLogger.warn("XCode JWT logout failed", { error });
      });
  };
  // Desktop Host 曾从 Settings View 再扫描一次 Account Provider，既绕开
  // Registry 的 entitlement/executable 事实，也在多个套餐同时可见时无法唯一选择。
  // 闲时服务与 Host 派发必须共享同一个 Registry-backed 凭据解析闭包。
  const offPeakCredentialResolverDeps = {
    loadOAuthAccountMaterial,
    getRegistryRevision: () =>
      providerRuntime.registryService.getSnapshot()?.registry.revision ?? null,
    accountRequestAuthService,
    resolveAccountProvider: async () => {
      await providerRuntime.start();
      // start 缓存的是首次就绪；账号后到或切换后必须读 Registry 最近完成的快照。
      const snapshot = providerRuntime.registryService.getSnapshot()!;
      const providers = snapshot.resolution.registryProviders.filter(
        (candidate) =>
          candidate.config.access.type === "zhipu-account" &&
          (candidate.config.access.mode === "individual-coding-plan" ||
            candidate.config.access.mode === "team-coding-plan"),
      );
      if (providers.length !== 1) return null;
      const provider = providers[0]!;
      const config = provider.config;
      const staticAccess = zcodeProviderAccountAccessSchema.parse(config.access.toJSON());
      const access = await accountRequestAuthService.resolveAccessCurrent(staticAccess);
      if (!access) return null;
      return {
        providerId: provider.providerId,
        access: zcodeAccountAccessSchema.parse(access),
        ...(config.api?.baseUrl ? { baseURL: config.api.baseUrl } : {}),
      };
    },
  };
  const buildOffPeakRequestAuthForTicket: OffPeakRequestAuthBuilder = async (ticketId) =>
    buildOffPeakRequestAuth({
      credentials: await resolveOffPeakCredentials(offPeakCredentialResolverDeps),
      ticketId,
    });
  const fileService = createFileService({
    workspaceFileSearchFilter: options?.workspaceFileSearchFilter,
  });
  const mediaPreviewService = createMediaPreviewService({
    fileService,
    authorizeLocalMediaPreviewPath: options?.authorizeLocalMediaPreviewPath,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
  });
  const conversationShareClient = new ConversationShareHttpClient({
    // 分享运行时始终走真实 API；测试/Mock 场景应在 service 单测或 Web fixture 中显式注入，
    // 不能让开发环境默认生成仅存在于进程内存的 mock-share 链接。
    apiClient,
    baseUrl: buildRuntimeXCodeApiUrl(process.env, "/api/v1"),
    tokenProvider: async (): Promise<string | null> => {
      const activeProvider = await oauthCredentialRepo.getActiveProvider();
      if (!activeProvider) {
        return null;
      }
      const tokenSet = await oauthCredentialRepo.loadTokenSet(activeProvider);
      return tokenSet?.zcodeJwtToken ?? tokenSet?.accessToken ?? null;
    },
  });
  const conversationShareService: IConversationShareServiceType = isDesktopAttachedRemote
    ? createUnsupportedConversationShareService({
        message: "Conversation publishing is not available for remote workspaces",
      })
    : new ConversationShareService({
        zcodeAgentService,
        zcodeSessionService,
        client: conversationShareClient,
        artifactSource: createLocalConversationShareArtifactSource(),
      });
  // 注册链上的懒工厂（如 OffPeak）会各自创建 tasks-index sqlite repo；先收集到本数组，
  // services 集合建好后在 return 前统一登记进 sharedSqliteRepos 侧表

  const providerProxyBindingCache = new Map<
    string,
    { expiresAt: number; binding: ProviderProxyBinding | undefined }
  >();
  // 绑定变更走 setting/credential 广播 + saveProviderProxy，1s TTL 只是兜底防抖：
  // 一次请求链上可能连着打好几个端点，别每个都读一遍 provider settings view。
  const PROVIDER_PROXY_BINDING_TTL_MS = 1_000;
  const invalidateProviderProxyBinding = (providerId?: string): void => {
    if (providerId) providerProxyBindingCache.delete(providerId);
    else providerProxyBindingCache.clear();
  };
  const resolveProviderProxyBinding = async (
    providerId: string,
  ): Promise<ProviderProxyBinding | undefined> => {
    const cached = providerProxyBindingCache.get(providerId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.binding;
    }
    const view = await providerRuntime.providerSettings.getView();
    const binding =
      view.providers.find((item) => item.providerId === providerId)?.effectiveConfig.api?.proxy ??
      undefined;
    providerProxyBindingCache.set(providerId, {
      expiresAt: Date.now() + PROVIDER_PROXY_BINDING_TTL_MS,
      binding,
    });
    return binding;
  };
  const providerPoolFetch = createProviderPoolFetch({
    inheritFetch: hostApiNetworkTransport.fetch,
    resolveBinding: resolveProviderProxyBinding,
    resolveCaCertPath: async () => (await settingService.get()).httpProxyCaCertPath,
  });
  setProviderFetchResolver((providerId, accountId) =>
    providerPoolFetch.fetchFor(providerId, accountId),
  );
  // XCode fork：账号级代理出口覆盖领取/权益类平台 API。
  // marketing touch 与 zcode-plan claim/balance 走平台 apiClient（= 全局代理链），
  // 账号在账号管理里绑定的代理池对它们完全不生效 —— 用户设置了代理出口后
  // 领取依然直连。这里按 accountRef 解析账号所属 family 的成员 provider，
  // 用 providerPoolFetch 出口构造一个账号专属 NodeApiClient（鉴权/改写/401
  // 观察等行为与全局 apiClient 完全一致，只换出口）；未绑定池的账号回落全局链。
  const FAMILY_EGRESS_IDS = new Set(["zai", "bigmodel"]);
  const familyAccountApiClients = new Map<string, ApiClient>();
  const resolveFamilyMemberProviderId = async (family: string): Promise<string | undefined> => {
    const view = await providerRuntime.providerSettings.getView();
    return view.providers.find((item) => {
      const access = item.effectiveConfig.access;
      return access?.type === "zhipu-account" && access.accountType === family;
    })?.providerId;
  };
  const familyAccountApiClient = (accountRef: string): ApiClient => {
    const cached = familyAccountApiClients.get(accountRef);
    if (cached) return cached;
    const family = accountRef.split(":")[0] ?? "";
    const client = createNodeApiClient({
      fetchImpl: async (input, init) => {
        const memberProviderId = await resolveFamilyMemberProviderId(family);
        const poolFetch = memberProviderId
          ? providerPoolFetch.fetchFor(memberProviderId, accountRef)
          : hostApiNetworkTransport.fetch;
        return poolFetch(input, init);
      },
      onXcodeJwtInvalid: (input, headers) => zcodeJwtLogoutHandlerRef.current?.(input, headers),
      isXcodeJwtRequest: (input, headers) =>
        isCurrentOAuthCredentialRequest({ input, headers, credentialService }),
      isBusinessUnauthorizedRequest: (input, _headers) =>
        isOAuthBusinessRequest({ input, credentialService }),
      resolveBusinessCredentialValidationRequest: (input, headers) =>
        resolveOAuthBusinessCredentialValidationRequest({ input, headers, credentialService }),
      resolveXCodeEndpointOrigin: resolveCurrentXCodeEndpointOrigin,
      resolveAccountRef: () => accountRef,
      resolveClientLanguage: options?.resolveClientLanguage,
    });
    familyAccountApiClients.set(accountRef, client);
    return client;
  };
  /** 领取/权益类请求的出口：有 accountRef 或激活账号属于 zai/bigmodel 族时走账号绑定池。 */
  const accountAwareApiClient = (accountRef?: string): ApiClient => {
    // 未显式给账号时用「当前激活账号」（1103 版没有 fork 的 activeAccountRef 局部变量，
    // 这里直接读 oauth 仓库的激活账号指针，语义等价）。
    const ref = accountRef?.trim() || activeAccountRef;
    if (!ref) return apiClient;
    const family = ref.split(":")[0] ?? "";
    return FAMILY_EGRESS_IDS.has(family) ? familyAccountApiClient(ref) : apiClient;
  };
  // 绑定上面 codingPlanSubscriptionService 的前向引用：此刻装配已完整，
  // 之后 automatic claim / 手动领取都会走账号绑定代理出口。
  accountAwareApiClientRef.current = accountAwareApiClient;

  const sqliteReposToClose: Array<{ close(): void }> = [];
  const marketingAssets = createMarketingAssetRegistry({
    allowLoopback: XCODE_ENV === "test" || process.env.NODE_ENV === "development",
  });
  const services = new ServiceCollection()
    .register(
      IMarketingTouchService,
      createMarketingTouchService({
        apiClient,
        credentialService,
        accountApiClient: accountAwareApiClient,
        onSnapshot: (snapshot) => marketingAssets.accept(snapshot),
      }),
    )
    .register(
      IVoiceInputService,
      createVoiceInputService({
        apiClient,
        getToken: () => credentialService.load("zcodejwttoken"),
        resolveOrigin: resolveCurrentXCodeEndpointOrigin,
        createSocket: (url) => hostApiNetworkTransport.createWebSocket(url),
      }),
    )
    .register(IFileService, fileService)
    .register(IMediaPreviewService, mediaPreviewService)
    .register(
      ICloudContentService,
      createCloudContentService({
        publishedAssets: marketingAssets,
        cacheRoot: join(getContentAppConfigDir(), "cache", "content-bundles", randomUUID()),
      }),
    )
    .register(IGitService, gitService)
    .register(IManagedWorktreeService, managedWorktreeService)
    .register(IGitCheckpointService, gitCheckpointService)
    .register(ISystemService, systemService)
    .register(ITerminalService, terminalService)
    .register(ISettingService, settingService)
    .register(IOnboardingRecordService, onboardingRecordService)
    // RPC 根据运行时方法名分发，不能把 Host 私有批量凭据端口直接注册给 Renderer。
    .register(ICredentialService, {
      // 整库检查/恢复不按键读写；是否对当前连接开放由 exposeOnChannelServer 的恢复策略决定。
      inspectStore: () => credentialService.inspectStore(),
      recoverStore: (fingerprint) => credentialService.recoverStore(fingerprint),
      load: (key) => {
        if (key === OAUTH_LINKED_BIGMODEL_KEY) throw new Error("Host private credential");
        return credentialService.load(key);
      },
      save: (key, value) => {
        if (key === OAUTH_LINKED_BIGMODEL_KEY) throw new Error("Host private credential");
        return credentialService.save(key, value);
      },
      delete: (key) => {
        if (key === OAUTH_LINKED_BIGMODEL_KEY) throw new Error("Host private credential");
        return credentialService.delete(key);
      },
    })
    .register(IBroadcastService, broadcastService)
    .register(IXCodeTaskService, zcodeTaskService)
    .register(IXCodeAgentService, zcodeAgentService)
    .register(IXCodeSessionService, zcodeSessionService)
    .register(IProjectService, projectService)
    .register(ITaskGroupService, taskGroupService)
    .register(IRemoteProjectService, remoteProjectService)
    .register(ICuaPermissionService, cuaPermissionService)
    .register(ICuaPipSessionService, cuaPipSessionService)
    .register(IConversationShareService, conversationShareService)
    .register(
      IBotsService,
      createBotsService({
        repo: botsRepo,
        projectService,
        remoteProjectService,
        ownerHostId: options?.projectStorageHostId ?? "local",
        credentialService,
        zcodeTaskService,
        broadcastService,
        settingService,
        modelSelectionService: providerRuntime.modelSelection,
        remoteWorkspaceService: botRemoteWorkspaceService
          ? { ...botRemoteWorkspaceService, resolveWorkspace: options?.resolveBotRemoteWorkspace }
          : undefined,
        // 远端与本地 Bot 都读取所属 Environment 的 Model Selection View。
        // 远端启动期不再轮询旧 Preset，避免重新制造一套模型候选事实。
        runStartupBackgroundTasks: !isDesktopAttachedRemote,
      }),
    )
    .register(IFileWatcherService, createFileWatcherService())
    .register(IOAuthService, oauthService)
    .register(ISourceServerWorkspaceService, sourceServerWorkspaceService)
    .register(
      IUsageStatsService,
      createUsageStatsService({
        apiClient,
        loadOAuthAccountMaterial,
        accountRequestAuthService,
        zcodeAgentService,
        officialMcpCredentialSource,
      }),
    )
    .register(ICodingPlanSubscriptionService, codingPlanSubscriptionService)
    .register(
      IClientConfigService,
      createClientConfigService({
        apiClient,
        resolveXcodeJwtToken: () => credentialService.load("zcodejwttoken"),
        resolveRequestContext: async () => ({
          endpointOrigin: await resolveCurrentXCodeEndpointOrigin(),
          appVersion: XCODE_VERSION,
          platform: `${process.platform}-${process.arch}`,
        }),
      }),
    )
    .register(IClientScenesService, createClientScenesService({ apiClient }))
    .register(
      IOffPeakTaskService,
      (() => {
        // 闲时任务编排服务（与 automation 服务面独立）：
        // 单例属主在本集合，renderer 经 ProxyChannel 直连，host 派发经 getOptional 取同一实例。
        const offPeakLogger = createServiceLogger("off-peak");
        const resolveCredentials = () => resolveOffPeakCredentials(offPeakCredentialResolverDeps);
        const originResolver = createOffPeakOriginResolver({
          logger: offPeakLogger,
          resolveUpstream: () => resolveOffPeakMockUpstream(offPeakCredentialResolverDeps),
        });
        const offPeakTaskRepo = new OffPeakTaskRepo();
        // OffPeakTaskRepo 也持有 tasks-index.sqlite 连接；收集到链前数组，services 建好后统一登记
        // （工厂在注册链求值期执行，此时 services 常量尚未初始化，不能直接引用）
        sqliteReposToClose.push(offPeakTaskRepo);
        const offPeakTaskService = new OffPeakTaskService({
          prepareProjectExecution,
          repo: offPeakTaskRepo,
          client: createOffPeakServerClient({
            resolveOrigin: originResolver.resolveOrigin,
            resolveCredentials,
            logger: offPeakLogger,
            resolveClientLanguage: options?.resolveClientLanguage,
          }),
          resolveCodingPlanSupport: () =>
            resolveOffPeakCodingPlanSupport(offPeakCredentialResolverDeps),
          resolveTelemetryProviderName: async () =>
            resolveSafeTelemetryHostname(await originResolver.resolveOrigin()),
          resolveModelSelection: async (input) => {
            await providerRuntime.start();
            const support = await resolveOffPeakCodingPlanSupport(offPeakCredentialResolverDeps);
            const providerId = support.supported
              ? OFF_PEAK_PROVIDER_IDS[support.providerFamily]
              : undefined;
            const provider = providerId
              ? providerRuntime.registryService
                  .getView()
                  .providers.find((candidate) => candidate.providerId === providerId)
              : undefined;
            const modelId = input.modelId ?? provider?.models[0]?.modelId;
            if (!provider || !modelId) {
              return {
                ok: false as const,
                validation: {
                  ok: false as const,
                  code: "provider-not-found" as const,
                  providerId: OFF_PEAK_PROVIDER_IDS.zai,
                },
              };
            }
            // 旧行没有 Provider 身份；只能复用当前账号凭据链已裁定的 Account Family，
            // 不能靠 Registry/JSON 顺序在 Z.ai 与 BigModel 间猜测。
            const selection = {
              providerId: provider.providerId,
              modelId,
              ...(input.reasoningLevel
                ? { options: { reasoningLevel: input.reasoningLevel } }
                : {}),
            };
            const validation = providerRuntime.registryService.validateSelection(selection);
            return validation.ok
              ? { ok: true as const, selection }
              : { ok: false as const, validation };
          },
          logger: offPeakLogger,
          requestSchedulerWake: options?.onOffPeakSchedulerWakeRequested,
          stopRunningTask: async (params) => {
            await zcodeTaskService.stopGeneration({
              taskId: params.conversationId,
              workspacePath: params.workspacePath,
              ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
            });
          },
          onDispose: () => {
            void originResolver.close().catch(() => undefined);
          },
        });
        offPeakTaskService.startSync();
        // 回写前向引用，供 zcodeAgentService 的 offPeak/create、offPeak/list 协议 handler 调用。
        offPeakTaskServiceForAgent = offPeakTaskService;
        return offPeakTaskService;
      })(),
    )
    .register(
      IHighspeedCardService,
      (() => {
        const origin = resolveRuntimeXCodeEndpointOrigin(process.env);
        const rawMockScenario = process.env.XCODE_HIGHSPEED_MOCK_SCENARIO;
        const mockScenarios = new Set<HighspeedMockScenario>([
          "hit-fast",
          "miss",
          "hit-after-timeout",
          "hit-invalid-model",
          "hit-queue-edit",
          "existing-foreign-task-card",
          "expired-card",
        ]);
        const mockScenario = mockScenarios.has(rawMockScenario as HighspeedMockScenario)
          ? (rawMockScenario as HighspeedMockScenario)
          : null;
        const ownerKeyForUser = (userId: string) =>
          `v1:${createHash("sha256").update(userId).digest("hex")}`;
        const resolveHealthyIdentity = async () => {
          const identity = await oauthCredentialRepo.loadIdentityMaterial();
          return identity
            ? {
                ownerKey: ownerKeyForUser(identity.zcodeUserId),
                sessionScope: JSON.stringify(identity),
                zcodeJwt: identity.zcodeJwtToken,
              }
            : null;
        };
        const transport = mockScenario
          ? createHighspeedMockTransport({ scenario: mockScenario })
          : createHighspeedHttpTransport({
              drawUrl: `${origin}/api/v1/highspeed/draw`,
              healthyBaseUrl: `${origin}/api/v1/highspeed/`,
              logger: createServiceLogger("highspeed"),
              drawHeaders: async () => {
                const credentials = await resolveOffPeakCredentials(offPeakCredentialResolverDeps, {
                  allowMockCredentials: false,
                });
                return buildHighspeedCodingPlanAuthHeaders({
                  zcodeJwt: credentials.jwt,
                  codingPlanAuthorization: credentials.codingPlanAuthorization,
                  targetType:
                    credentials.organizationId && credentials.projectId ? "TEAM" : "PERSONAL",
                  ...(credentials.organizationId
                    ? { organizationId: credentials.organizationId }
                    : {}),
                  ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
                });
              },
              healthyHeaders: async () => {
                throw new Error("highspeed healthy requires captured identity");
              },
            });
        return new HighspeedCardService({
          transport,
          resolveHealthyIdentity,
          // 普通 mock 只验证抽卡 UI，不依赖隐藏执行 Provider；目录外模型与队列编辑场景
          // 必须走真实 Highspeed execution Selection，才能覆盖创建期退回和队列模型隔离。
          inferenceMode:
            mockScenario &&
            mockScenario !== "hit-invalid-model" &&
            mockScenario !== "hit-queue-edit"
              ? "session-default"
              : "highspeed",
          // 规则 11：draw 只对 Coding Plan 用户开放；mock 场景放行以便本地验证。
          resolveCodingPlanSupported: mockScenario
            ? async () => true
            : async () =>
                (await resolveOffPeakCodingPlanSupport(offPeakCredentialResolverDeps)).supported,
          // 规则 14：会话模型必须属于所选 Coding Plan Provider 的模型目录（Built-in Provider
          // Config 投影）才发起新 draw；mock 场景放行以便本地验证。
          resolveModelCovered: mockScenario
            ? async () => true
            : async (providerId, modelId) => {
                const view = await providerRuntime.modelSelection.getView();
                const provider = view.providers.find((item) => item.providerId === providerId);
                return provider?.models.some((model) => model.modelId === modelId) ?? false;
              },
          // 加速推理与 draw 走同一 highspeed 网关、同一 Coding Plan 双 JWT 契约：必须携带
          // zcode JWT + Coding Plan 业务 JWT + Team 身份头。此前只发 zcode JWT + 卡 ID，网关
          // 无法校验 Coding Plan 权益，返回 401 auth_failed。与 draw 头复用同一次 selected
          // connection 解析，避免把 ZAI 身份的卡打到 BigModel 加速 Provider。
          resolveInferenceAuth: async () => {
            const credentials = await resolveOffPeakCredentials(offPeakCredentialResolverDeps, {
              allowMockCredentials: false,
            });
            return {
              zcodeJwt: credentials.jwt,
              family: credentials.providerFamily,
              accountScope: credentials.accountScope,
              ...(credentials.zcodeUserId
                ? { ownerKey: ownerKeyForUser(credentials.zcodeUserId) }
                : {}),
              codingPlanAuthorization: credentials.codingPlanAuthorization,
              targetType: credentials.organizationId && credentials.projectId ? "TEAM" : "PERSONAL",
              ...(credentials.organizationId ? { organizationId: credentials.organizationId } : {}),
              ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
            };
          },
        });
      })(),
    )
    .register(ISkillsService, skillsService)
    .register(ISkillSyncService, createSkillSyncService())
    .register(IMcpSyncService, mcpSyncService)
    .register(
      IGenUiService,
      createGenUiService({ registerSandbox: options?.registerPluginSandbox }),
    )
    .register(IPluginUiBridgeService, pluginUiBridgeService)
    .register(IPluginUiSamplingService, pluginUiSamplingService)
    .register(IPluginUiAppToolsService, pluginUiAppToolsService)
    // 合并 MCP/Plugin Management 服务装配时误删了 plugin-sync 注册，
    // RemoteServiceAccess 仍会请求该频道，导致本地候选枚举超时、远端同步无法开始。
    .register(IPluginSyncService, pluginSyncService)
    // 数据同步：子智能体 / 命令 / 钩子共用的用户配置同步通道，本机与远端 Host 都经此注册。
    .register(IUserConfigSyncService, createUserConfigSyncService())
    .register(IPluginsService, createPluginsService({ isDesktopRuntime: true }))
    // 设置页插件管理薄服务——plugins/* 旧协议词的 host 侧唯一消费点。
    .register(
      IPluginManagementService,
      createPluginManagementService({
        zcodeAgentService,
        reportTelemetryEvent: options?.reportPluginTelemetryEvent,
        onMutationSucceeded: options?.onPluginManagementMutated,
      }),
    )
    .register(ISubagentsService, subagentsService)
    .register(ICommandsService, createCommandsService({ isDesktopRuntime: true }))
    .register(
      IHooksService,
      createHooksService({
        grantWorkspaceHookTrust: (params) => zcodeAgentService.grantWorkspaceHookTrust(params),
      }),
    )
    .register(IMemoryService, createMemoryService())
    .register(IOutputStyleService, createOutputStyleService())
    .register(ISettingsSyncService, createSettingsSyncService({ settingService }))
    .register(
      IFeedbackService,
      createFeedbackService({
        ...options?.feedback,
        apiClient,
        credentialService,
        oauthService,
      }),
    )
    .register(IPromptAttachmentTransferService, createLocalPromptAttachmentTransferService());

  // 即使初始配置关闭也必须登记 lifecycle disposer：terminal fence 需要早于任意延迟 setting/acquire
  // 恢复，不能把"当前还没有 Helper"误当成"不需要生命周期所有者"。dispose 时串行 stop host。
  registerManagedCuaHelperHostForDispose(services, {
    stop: async () => {
      await defaultCuaProductHelperLifecycle.dispose();
    },
  });
  registerHostApiNetworkTransportForDispose(services, hostApiNetworkTransport);
  registerProviderPoolFetchForDispose(services, providerPoolFetch);
  // disposer 注册完成后才排预热。若 createLocalServices 中途抛错，不能留下一个无人持有、却会在当前
  // 调用栈结束后才创建的高权限 Helper；若返回后立即 dispose，terminal fence 会先于 acquire 生效。
  // Helper 懒启动：不预热——Helper 由 SDK 首次 CUA 调用拉起（spawn env 注入
  // 稳定 socket），或用户显式授权流（restartHelper）拉起。启动即零 Helper 常驻。

  accountRequestAuthServices.set(services, accountRequestAuthService);
  offPeakRequestAuthBuilders.set(services, buildOffPeakRequestAuthForTicket);
  const pluginUserOptionsReader = getInProcessPluginUserOptionsReader(zcodeAgentService);
  if (pluginUserOptionsReader) pluginUserOptionsReaders.set(services, pluginUserOptionsReader);

  providerRuntimes.set(services, providerRuntime);
  providerProvisioningSources.set(services, providerProvisioningSource);
  providerProvisioningTriggerDisposers.set(services, providerProvisioningDisposers);
  // desktop-attached-remote 的组织态在远端 Host 库里，由远端自己的扫描器归档；本机不扫。
  if (!isDesktopAttachedRemote) {
    const stopSettingsRescan = settingService.onDidUpdate((event) => {
      if (shouldRescanTaskAutoArchive(event.keys)) {
        void taskAutoArchiveScheduler.scan().catch(() => {});
      }
    });
    taskAutoArchiveScheduler.start();
    taskAutoArchiveDisposers.set(services, () => {
      stopSettingsRescan();
      taskAutoArchiveScheduler.dispose();
    });
  }
  services
    .register(IProviderSettingsService, providerRuntime.providerSettings)
    .register(IModelSelectionService, providerRuntime.modelSelection)
    .register(
      IProxyPoolService,
      // 赋值表达式把单例回写到上面的前向引用 holder：zcodeAgentService 早于这里构造，
      // 只能靠这种惰性绑定把 ProxyPool 工具接到同一实例上。
      (proxyPoolServiceForAgent = createProxyPoolService({
        settingService,
        getProviderSettingsView: () => providerRuntime.providerSettings.getView(),
        // Provider overlay 是整份替换语义，直接传只带 proxy 的 config 会抹掉
        // baseUrl / headers / type。这里显式做 read-modify-write，只替换 api.proxy。
        saveProviderProxy: async (providerId, binding) => {
          const view = await providerRuntime.providerSettings.getView();
          const provider = view.providers.find((item) => item.providerId === providerId);
          if (!provider) {
            throw new Error(`Provider 不存在: ${providerId}`);
          }
          // savePersonalProviderOverlay 是**整份替换个人层**，不是 overlay 到内置层上。因此
          // 基线必须用 personalConfig：用 effectiveConfig 会把内置层的 access 一起写进个人层，
          // 而 `account:` 前缀的 provider（zai / bigmodel 各套餐）在个人层声明 access 会被
          // rule schema 直接拒绝（「固定 Account Provider 的 Access 只能由 Built-in Config 声明」）。
          const personal = provider.personalConfig ?? {};
          await providerRuntime.providerSettings.savePersonalProviderOverlay(providerId, {
            ...personal,
            api: {
              ...(personal.api ?? {}),
              proxy: binding ?? null,
            },
          });
          // 绑定刚落盘就让下次请求读到新的出口，别让 TTL 内的旧缓存把请求发错代理。
          invalidateProviderProxyBinding(providerId);
        },
        listProviderAccounts: async (providerId, requestProfile) => {
          // zai / bigmodel：账号是 family 级的 OAuth 账号，providerId 传的是 family id。
          // 注意 family 伪 id（"zai" / "bigmodel"）不在 providerId→family 的映射表里——那张表
          // 只认 `account:zai-start-plan` 这类真实 providerId，所以必须先用 resolveAccountFamilyProviderId
          // 认伪 id，再用映射表兜住真实 providerId 的调用。
          const family =
            resolveAccountFamilyProviderId(providerId) ??
            resolveModelProviderFamilyIdByProviderId(providerId);
          if (family) {
            const activeRef = await oauthCredentialRepo.loadActiveAccountRef();
            const accounts = (await oauthCredentialRepo.listAccounts()).filter(
              (account) => account.provider === family,
            );
            const result: ProxyProviderAccountView[] = [];
            for (const account of accounts) {
              const accountRef = `${account.provider}:${account.identity}`;
              // 只列当前有凭证的账号：登出后账号仍留在列表里，但不会再被轮询选中，给它
              // 一个出口绑定只会是一条永不生效的配置（与轮询候选保持同一套过滤）。
              const tokenSet = await oauthCredentialRepo.loadTokenSetForAccount(accountRef);
              if (!tokenSet?.accessToken?.trim()) {
                continue;
              }
              result.push({
                id: accountRef,
                displayName: account.displayName || account.username,
                active: accountRef === activeRef,
              });
            }
            return result;
          }
          // 只有 Qoder / CodeBuddy 有账号列表；其余供应商无账号概念，返回空数组走策略。
          if (!supportsAccountBinding(requestProfile, providerId)) {
            return [];
          }
          // 只列该供应商自己那一个区的账号：`other:qoder` 与 `other:qoder-cn` 是两份独立
          // 账号表。合并两区会让「共 N 个账号」与账号行数对不上，批量分配/轮流分配还会
          // 把绑定写到另一个区的账号 id 上。
          const region = providerNetworkRegion(providerId);
          if (!region) {
            return [];
          }
          const facade = providerRuntime.providerSettings;
          const { accounts } =
            requestProfile === "qoder"
              ? await facade.qoderListAccounts(region).catch(() => ({ accounts: [] as never[] }))
              : await facade
                  .codebuddyListAccounts(region)
                  .catch(() => ({ accounts: [] as never[] }));
          return accounts.map((account) => ({
            id: account.id,
            displayName: account.displayName,
            ...(account.email ? { email: account.email } : {}),
            active: account.active,
          }));
        },
        accountRotationSettings: {
          get: (providerId) => accountRotationService.getSettings(providerId),
          save: (providerId, settings) => accountRotationService.saveSettings(providerId, settings),
        },
      })),
    );

  if (isDesktopAttachedRemote || options.providerProvisioningTargetEnabled === true) {
    services.register(
      IProviderProvisioningTargetService,
      createProviderProvisioningTarget({
        providerRuntime,
        personalRepository: providerConfigRuntime.personalRepository,
        accountProviderSource: accountProviderConfigSource,
        credentialService,
        settingService,
        personalConfigFilePath: join(resolveAppConfigDir(), PERSONAL_PROVIDER_CONFIG_FILE_NAME),
        stateFilePath: join(resolveAppConfigDir(), "runtime", "provider", "provisioning.json"),
        listProvisioningCredentialKeys: () =>
          listProviderProvisioningCredentialKeys(resolveCredentialFilePath(resolveAppConfigDir())),
      }),
    );
  }
  const log = createServiceLogger("provider-runtime");
  void providerRuntime.start().then(
    () => {
      const snapshot = providerRuntime.registryService.getSnapshot()!;
      log.info("Provider Registry 已就绪", {
        configRevision: snapshot.sourceRevisions.config,
        providerCount: snapshot.registry.providers.length,
      });
    },
    (error: unknown) => {
      log.error("Provider 配置事实初始化失败", error);
    },
  );

  // 见 sharedSqliteRepos 声明处注释：登记全部 tasks-index sqlite 句柄，dispose 链统一关闭
  sqliteReposToClose.push(taskIndexRepo);
  sharedSqliteRepos.set(services, sqliteReposToClose);
  return services;
}

export function createTelemetryUserIdLoader(
  credentialService: Pick<ICredentialService, "load">,
): () => Promise<string> {
  const log = createServiceLogger("telemetry-user-id");
  return async () => {
    try {
      const activeProvider = (await credentialService.load("oauth:active_provider"))?.trim() ?? "";
      if (!activeProvider) {
        return "";
      }

      const rawUserInfo = await credentialService.load(`oauth:${activeProvider}:user_info`);
      return readTelemetryOAuthUserId(rawUserInfo);
    } catch (error) {
      if (!isCredentialDecryptError(error)) {
        throw error;
      }

      // Bugfix: telemetry 只是只读 userId 上报入口，不能抢在 host OAuthService 前
      // 对损坏凭据做半套清理；否则会漏掉派生模型 provider key 的 logout 收口。
      log.warn(undefined, "skip telemetry user id: OAuth credential decrypt failed", error);
      return "";
    }
  };
}

/** 仅给同一事件账号返回当前 XCode JWT；不缓存、不修改登录凭据。 */
export function createTelemetryAuthorizationLoader(
  credentialService: Pick<ICredentialService, "load">,
): (userId: string) => Promise<string | null> {
  return async (userId) => {
    if (!userId) return null;
    try {
      const provider = (await credentialService.load("oauth:active_provider"))?.trim();
      // 中国区同样持有 XCode 主 JWT；不能用旧的两渠道白名单阻断远控和上报。
      if (!provider || !isBuiltinOAuthProvider(provider)) return null;
      const readUserId = async () =>
        readTelemetryOAuthUserId(await credentialService.load(`oauth:${provider}:user_info`));
      if ((await readUserId()) !== userId) return null;
      const jwt = await credentialService.load("zcodejwttoken");
      // 退出/切账号可能发生在异步读取期间；禁止将旧身份的 token 附到其他账号事件上。
      if (
        (await credentialService.load("oauth:active_provider"))?.trim() !== provider ||
        (await readUserId()) !== userId
      )
        return null;
      return toBearerAuthorization(jwt);
    } catch {
      return null;
    }
  };
}

export function createTelemetryMarketingParamsLoader(
  credentialService: ICredentialService,
): () => Promise<import("@zcode/shared").OAuthLoginAttribution | null> {
  // 恢复原因：固定返回 null 会丢掉已保存的渠道归因，数仓应读取 OAuth 的同一份事实。
  const repo = new OAuthCredentialRepo(credentialService);
  return () => repo.loadLoginAttribution();
}

function readTelemetryOAuthUserId(rawUserInfo: string | null): string {
  if (!rawUserInfo) {
    return "";
  }

  try {
    const parsed = JSON.parse(rawUserInfo) as {
      id?: unknown;
      user_id?: unknown;
    };
    const id = typeof parsed.id === "string" ? parsed.id : "";
    const userId = typeof parsed.user_id === "string" ? parsed.user_id : "";
    return id.trim() || userId.trim();
  } catch {
    return "";
  }
}

export function disposeServiceResources(services: ServiceCollection): void {
  const content = services.getOptional(ICloudContentService);
  if (content && hasDisposeAllAndWait(content)) void content.disposeAllAndWait().catch(() => {});
  (
    services.getOptional(IGenUiService) as (IGenUiService & { dispose?(): void }) | undefined
  )?.dispose?.();
  // Bugfix: host process 退出前以前没有统一遍历本地服务做资源回收，
  // terminal/task wrapper 这类会拉起子进程的服务只能等宿主进程自己结束，时序上可能留下短暂残留。
  // 这里集中调用各服务的本地 disposeAll 钩子，把“退出 app = 回收所有托管资源”落成机械动作。
  const disposableServices = [
    services.getOptional(ITerminalService),
    services.getOptional(IXCodeTaskService),
    services.getOptional(IXCodeAgentService),
    services.getOptional(IXCodeSessionService),
    services.getOptional(IBotsService),
    services.getOptional(IFileWatcherService),
    services.getOptional(ISubagentsService),
    services.getOptional(IOffPeakTaskService),
  ].filter((service) => service !== undefined);

  for (const service of disposableServices) {
    if (hasDisposeAll(service)) {
      service.disposeAll();
    }
  }

  // 同步 best-effort：终止托管的 Computer Use Helper（不 await，避免阻断同步 dispose 路径）。
  const managedCuaHelperHost = managedCuaHelperHosts.get(services);
  if (managedCuaHelperHost) {
    void managedCuaHelperHost.stop().catch(() => {});
  }
  // 关闭共享 tasks-index sqlite 句柄（Windows 上悬着句柄会让后续目录清理撞 EBUSY）
  for (const repo of sharedSqliteRepos.get(services) ?? []) repo.close();
  sharedSqliteRepos.delete(services);
  providerRuntimes.get(services)?.dispose();
  for (const dispose of providerProvisioningTriggerDisposers.get(services) ?? []) dispose();
  providerProvisioningTriggerDisposers.delete(services);
  providerProvisioningSources.delete(services);
  taskAutoArchiveDisposers.get(services)?.();
  taskAutoArchiveDisposers.delete(services);
  managedHostApiNetworkTransports.get(services)?.dispose();
  managedProviderPoolFetches.get(services)?.dispose();
}

export async function disposeServiceResourcesAndWait(services: ServiceCollection): Promise<void> {
  (
    services.getOptional(IGenUiService) as (IGenUiService & { dispose?(): void }) | undefined
  )?.dispose?.();
  // app 关闭时 host 需要等 agent 进程树完成 graceful + force 清理。
  // 旧的同步 dispose 会在 host 退出时丢掉强杀 timer，导致 zcode-cli/app-server 变成孤儿进程。
  // CLI 的 EOF 宽限不能被云内容或终端清理消耗；先关闭 Agent admission 并完成进程回收。
  const disposableServices = [
    services.getOptional(IXCodeAgentService),
    services.getOptional(ICloudContentService),
    services.getOptional(ITerminalService),
    services.getOptional(IXCodeTaskService),
    services.getOptional(IXCodeSessionService),
    services.getOptional(IBotsService),
    services.getOptional(IFileWatcherService),
    services.getOptional(ISubagentsService),
    services.getOptional(IOffPeakTaskService),
  ].filter((service) => service !== undefined);

  for (const service of disposableServices) {
    if (hasDisposeAllAndWait(service)) {
      await service.disposeAllAndWait();
    } else if (hasDisposeAll(service)) {
      service.disposeAll();
    }
  }

  // 等待托管的 Computer Use Helper 终止（best-effort）：Helper 是长生命周期高权限进程，服务释放语义必须显式
  // 收口它，不能只靠 launcher-pid watchdog / 进程退出兜底。
  const managedCuaHelperHost = managedCuaHelperHosts.get(services);
  if (managedCuaHelperHost) {
    await managedCuaHelperHost.stop().catch(() => {});
  }
  // 关闭共享 tasks-index sqlite 句柄（同 disposeServiceResources，异步收口路径也要释放）
  for (const repo of sharedSqliteRepos.get(services) ?? []) repo.close();
  sharedSqliteRepos.delete(services);
  providerRuntimes.get(services)?.dispose();
  for (const dispose of providerProvisioningTriggerDisposers.get(services) ?? []) dispose();
  providerProvisioningTriggerDisposers.delete(services);
  providerProvisioningSources.delete(services);
  taskAutoArchiveDisposers.get(services)?.();
  taskAutoArchiveDisposers.delete(services);
  await managedHostApiNetworkTransports
    .get(services)
    ?.disposeAndWait()
    .catch(() => {});
  await managedProviderPoolFetches
    .get(services)
    ?.disposeAndWait()
    .catch(() => {});
}

/** 所有应用入口在开放 RPC / 调度器前等待；失败不启动业务写者。 */
export async function migrateApplicationStorage(
  settings?: Pick<AppSettings, "lastWorkspaceSession" | "recentProjects">,
  hostId?: string,
): Promise<{ backupSkipped: boolean }> {
  const automations = new AutomationRepo();
  const offPeak = new OffPeakTaskRepo();
  const tasks = new TaskIndexRepo(settings, hostId);
  try {
    await automations.ensureReady();
    await offPeak.ensureReady();
    await tasks.ensureReady();
    return {
      backupSkipped:
        tasks.migrationBackupSkipped ||
        automations.migrationBackupSkipped ||
        offPeak.migrationBackupSkipped,
    };
  } finally {
    tasks.close();
    offPeak.close();
    automations.close();
  }
}

export {
  bindRemoteProjectIdentities,
  createRemoteIdentityRegistrationCache,
} from "#src/project/index.js";

export { startupStorage } from "#src/startup-storage/index.js";

/** 独立 Server 共用迁移屏障与身份装配；入口不得以 local owner 开放远端项目 RPC。 */
export async function createServerHostServices(options: {
  topicResourceRelayChannel?: NonNullable<
    Parameters<typeof createLocalServices>[0]
  >["topicResourceRelayChannel"];
  sourceServerId: string;
  zcodeBuiltinProviderConfigFilePath: string;
  providerProvisioningTargetEnabled?: boolean;
  credentialCipherProvider?: CredentialCipher;
}) {
  // 无桌面环境不能等到首次登录或 Provisioning 才发现系统库缺失。
  const credentialCipherProvider =
    options.credentialCipherProvider ??
    (await createServerCredentialCipher({
      filePath: join(resolveAppConfigDir(), "credentials.json"),
    }));
  const projectStorageHostId = remoteHostIdFromWorkspaceIdentity(
    buildServerRemoteWorkspaceIdentity({ serverId: options.sourceServerId, workspacePath: "/" }),
  );
  if (!projectStorageHostId) throw new Error("Invalid Source Server storage identity");
  // Bug 原因：billing/balance 把 X-Device-Mid 当必填，而独立 Server 主机没有 Desktop main 写设备身份，
  // buildXCodeSourceHeaders() 又只读不生成。原修复只放在旧 stdio entry，SSH/WSL/Docker 的 Core 与
  // Lite HTTP 入口共用本装配却没有确保，首次 Start Plan 权益查询返回 400，Start 模型被判为不可用。
  // 收口到本装配，所有独立 Server 入口在创建 services 前得到本机自己的 deviceMid；失败只告警、不阻断启动、不伪造 ID。
  await ensureTelemetryDeviceMid().catch((error: unknown) => {
    createServiceLogger("server-host").warn(
      undefined,
      "deviceMid 初始化失败，XCode endpoint 请求将不带 X-Device-Mid:",
      error instanceof Error ? error.message : String(error),
    );
  });
  await migrateApplicationStorage(await createSettingService().get(), projectStorageHostId);
  const workspaceAliasRepo = new SourceServerWorkspaceAliasRepo();
  const workspaceIdentityMapper = new SourceServerWorkspaceIdentityMapper();
  const sourceServerWorkspaceService = createSourceServerWorkspaceService(workspaceAliasRepo, {
    defaultWorkspaceIdentity: (workspacePath) =>
      buildServerRemoteWorkspaceIdentity({ serverId: options.sourceServerId, workspacePath }),
    onResolved: ({ workspacePath, canonicalWorkspaceKey }) => {
      workspaceIdentityMapper.register({
        stableIdentity: buildServerRemoteWorkspaceIdentity({
          serverId: options.sourceServerId,
          workspacePath,
        }),
        canonicalIdentity: canonicalWorkspaceKey,
      });
    },
  });
  const migrationFailedPathCount = await workspaceAliasRepo.getFailedPathCount();
  const services = createLocalServices({
    credentialCipherProvider,
    zcodeBuiltinProviderConfigFilePath: options.zcodeBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: options.providerProvisioningTargetEnabled,
    serviceAuthorityMode: "standalone-server",
    topicResourceRelayChannel: options.topicResourceRelayChannel,
    projectStorageHostId,
    sourceServerWorkspaceService,
  });
  return { services, workspaceIdentityMapper, migrationFailedPathCount };
}

export { scopeConversationShareServiceForAttachment } from "./conversation-share/conversationShareConnectionScope.js";
export { localRuntimeNetworkCapture } from "./zcode-agent/localRuntimeNetworkCapture.js";

/** 只下发可打印 ASCII 的界面语言；缺失时不写该键，Agent 回落自身 Intl。 */
function buildAgentClientLanguageEnv(locale: string | undefined): Record<string, string> {
  const value = locale?.trim();
  return value && /^[\x20-\x7e]+$/.test(value) ? { [XCODE_CLIENT_LANGUAGE_ENV]: value } : {};
}
