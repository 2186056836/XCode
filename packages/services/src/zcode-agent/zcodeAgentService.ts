import {
  v4SessionDeletionPreviewSchema,
  v4SessionDeletionResultSchema,
} from "@zcode/shared/zcode-protocol-v4";
import { sessionLifecycleSnapshotSchema, type SessionLifecycleSnapshot } from "@zcode/shared";
import { credentialCipherRequestSchema } from "@zcode/shared";
import {
  executeCredentialCipherRequest,
  type CredentialCipher,
} from "@zcode/shared/credential-security";
import {
  getNetworkErrorCodes,
  isNetworkFailure,
} from "#src/providers/api/networkErrorClassifier.js";
import {
  XCODE_PROVIDER_CONFIG_NETWORK_ERROR,
  zcodeProviderRuntimeHeadersErrorCode,
} from "@zcode/shared";
import { RemoteConversationTelemetry } from "#src/conversation-telemetry/remoteConversationTelemetry.js";
import {
  remoteConversationTelemetryEventSchema,
  type RemoteConversationTelemetryEvent,
} from "@zcode/shared/conversation-telemetry";
import { resolveWorkspaceTelemetryDetail } from "@zcode/shared";
import { isAuxiliarySessionKind } from "@zcode/shared";
import { createAppControlReverseRpc } from "#src/app-control/index.js";
import type { AppControlService } from "#src/app-control/contract.js";
import { SessionControlError } from "@zcode/session-control/contracts";
import {
  pluginUiToolResultNotificationSchema,
  type PluginUiToolResultNotification,
} from "@zcode/shared/mcp-apps";
import {
  supportsHistoryFirst,
  supportsPluginDiscoveryUi,
  supportsPluginExtensionSummary,
  ensureGenUiContextSupport,
  supportsHighspeedCardOwner,
} from "./independentPlanSupport.js";
import { supportsResidentRowsRange } from "./resident-rows-range/contract.js";
import {
  offPeakControlParamsSchema,
  offPeakControlResultSchema,
  offPeakLifecycleNotificationSchema,
  type OffPeakLifecycleNotification,
  type OffPeakControlParams,
} from "@zcode/shared";
import {
  requiresRequestVerification,
  type RequestVerificationConfig,
  allowRequestVerificationHeaders,
  requestVerificationInteractionAvailable,
} from "@zcode/shared";
import { zcodeMcpUiSamplingResultSchema } from "@zcode/shared";
import { MCP_APPS_SAMPLING_TRANSPORT_TIMEOUT_MS } from "@zcode/shared/mcp-apps";
import {
  channelReplyRequestSchema,
  type ChannelReplyHostRequest,
  type ChannelReplyResult,
} from "@zcode/shared";
import { requestPluginReferenceCatalog } from "#src/zcode-agent/pluginReferenceCatalogRequest.js";
import {
  localTtftFactsSchema,
  sessionDebugSnapshotSchema,
  type LocalTtftFacts,
} from "@zcode/shared";
/* oxlint-disable eslint(max-lines) -- XCode Protocol transport、通知 wiring 和 app-facing session 方法必须共享同一个 client/emitter 上下文。 */
import { ensureIndependentPlanSupport } from "./independentPlanSupport.js";
import { isRemoteInputPredictionEnabled } from "./inputPredictionSwitch.js";
import { randomUUID } from "node:crypto";
import { createTopicResourceBridge } from "./topicResourceBridge.js";
import { uploadTopicResourceToClient } from "./topicResourceUpload.js";
import {
  zcodeTopicResourceCancelParamsSchema,
  type XCodeTopicResourceReadParams,
  type XCodeProtocolTrace,
  type XCodePromptAttachment,
} from "@zcode/shared";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Emitter } from "@zcode/rpc";
import type { IDisposable } from "@zcode/rpc";
import type {
  AccountProviderConfigSnapshot,
  ModelSelectionView,
  ProviderSource,
} from "@zcode/provider";
import { completeNewModelSelection } from "@zcode/provider";
import type { OffPeakClientConfig } from "#src/coding-plan-subscription/codingPlanSubscription.js";
import {
  subagentRuntimeConfigSchema,
  zcodeSubagentsReadRuntimeConfigParamsSchema,
  type SubagentRuntimeConfig,
  XCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
  formatLogPrefix,
  resolveWorkspaceKey,
  type TraceId,
  XCODE_AGENT_PROVIDER,
  XCODE_AGENT_PROVIDER_NOT_READY_CODE,
  XCODE_AGENT_PROVIDER_NOT_READY_REASON,
  XCODE_MODEL_REASONING_SEPARATOR,
  isRemoteWorkspaceIdentity,
  XCODE_PROTOCOL_NAME,
  XCODE_PROTOCOL_VERSION,
  zcodeMcpListResultSchema,
  zcodeWorkspaceMcpTrustResultSchema,
  zcodePermissionRequestParamsSchema,
  zcodeBrowserListParamsSchema,
  zcodeBrowserExecuteParamsSchema,
  zcodePluginsConfigureResultSchema,
  zcodePluginsInstallResultSchema,
  zcodePluginsListResultSchema,
  zcodePluginsMarketplaceMutationResultSchema,
  zcodePluginsOverviewResultSchema,
  zcodeProcessChildProcessesResultSchema,
  type XCodeProcessChildProcess,
  zcodeSkillsReferenceCatalogResultSchema,
  zcodeMcpReadResourceResultSchema,
  zcodeMcpUiCallToolResultSchema,
  zcodeMcpUiCancelCallResultSchema,
  zcodeMcpUiReadResourceResultSchema,
  zcodeMcpUiListResourcesResultSchema,
  zcodeMcpUiAppToolAcceptedResultSchema,
  zcodeMcpUiRegisterAppToolsResultSchema,
  zcodeMcpUiUnregisterAppToolsResultSchema,
  zcodeMcpUiListResourceTemplatesResultSchema,
  zcodeMcpUiResourceSubscriptionResultSchema,
  zcodePluginsListUiSurfacesResultSchema,
  zcodeWorkflowsDeleteResultSchema,
  zcodeWorkflowsForRunResultSchema,
  zcodeWorkflowsGetResultSchema,
  zcodeWorkflowsListResultSchema,
  zcodeWorkflowsMoveResultSchema,
  zcodeWorkflowsRunsResultSchema,
  zcodeWorkflowsSaveResultSchema,
  zcodeWorkflowsUpdateMetaResultSchema,
  zcodePluginsResolveSuggestedReferenceResultSchema,
  zcodePluginOperationProgressNotificationSchema,
  zcodePluginsRestoreBuiltinResultSchema,
  zcodePluginsSetEnabledResultSchema,
  zcodePluginsCancelOperationResultSchema,
  zcodePluginsUninstallResultSchema,
  zcodePluginsValidateResultSchema,
  zcodePluginsDescribeResultSchema,
  zcodeAutomationCheckTaskBindingParamsSchema,
  zcodeAutomationCreateParamsSchema,
  zcodeAutomationDeleteParamsSchema,
  zcodeAutomationPauseParamsSchema,
  zcodeAutomationListParamsSchema,
  zcodeAutomationUpdateParamsSchema,
  zcodeOffPeakCreateParamsSchema,
  zcodeOffPeakListParamsSchema,
  zcodeProxyPoolApplyToAllParamsSchema,
  zcodeProxyPoolBindParamsSchema,
  zcodeProxyPoolDeleteParamsSchema,
  zcodeProxyPoolDistributeParamsSchema,
  zcodeProxyPoolListParamsSchema,
  zcodeProxyPoolSaveParamsSchema,
  zcodeProxyPoolSetActiveParamsSchema,
  zcodeProxyPoolTestParamsSchema,
  type ProxyPoolEntry,
  type XCodeProxyPoolProtocolSnapshot,
  OFF_PEAK_PROVIDER_IDS,
  zcodeComputerUseOperationEventSchema,
  zcodeProviderRuntimeHeadersCancelledSchema,
  zcodeProviderRuntimeHeadersRequestParamsSchema,
  zcodeProviderRefreshRegistryResultSchema,
  zcodeProviderTestModelConnectivityResultSchema,
  zcodeOfficialMcpAuthHeadersRequestParamsSchema,
  type OfficialAuthConsumerKind,
  summarizeOfficialMcpIdentityHeaders,
  zcodeProtocolEmptyResultSchema,
  zcodeProtocolMethods,
  zcodeProtocolNotifications,
  zcodeMcpTelemetryEventSchema,
  zcodeMcpResourceSamplesSchema,
  zcodeToolExecResourceSchema,
  zcodeProcessResourceSampleSchema,
  zcodeSessionCloseResultSchema,
  zcodeSessionReleaseUnderDirectoryResultSchema,
  zcodeSessionCompactResultSchema,
  zcodeSessionEventsResultSchema,
  zcodeSessionGoalResultSchema,
  zcodeSessionListResultSchema,
  zcodeSessionSubagentsResultSchema,
  zcodeSessionMessagesResultSchema,
  zcodeSessionEventSchema,
  zcodeSessionSendResultSchema,
  zcodeSessionRequestRuntimePreferencesParamsSchema,
  zcodeRuntimeCapabilitiesSchema,
  zcodeSessionRuntimePreferencesResultSchema,
  zcodeSessionStateSnapshotSchema,
  zcodeSessionSubscribeResultSchema,
  zcodeStateUpdatedNotificationSchema,
  zcodeUserInputRequestParamsSchema,
  zcodeWorkspacePresentationSchema,
  zcodeWorkspaceCancelGenerateTextResultSchema,
  zcodeWorkspaceGenerateTextResultSchema,
  zcodeWorkspaceHookTrustGrantResultSchema,
  zcodeWorkspaceUpdateInteractionPreferencesResultSchema,
  zcodeWorkspaceUpdateModelIoPreferencesResultSchema,
  zcodeProviderUpdateAccountConfigResultSchema,
  type XCodeSessionStateSnapshot,
  type XCodeAutomation,
  type XCodeAutomationRun,
  zcodeWorkspaceUpdateOffPeakToolPolicyResultSchema,
  zcodeWorkspaceUpdateDynamicWorkflowPolicyResultSchema,
  type DynamicWorkflowClientConfig,
  type DynamicWorkflowMode,
  applyDynamicWorkflowUserMode,
  createDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  isDynamicWorkflowModeEnabled,
  normalizeDynamicWorkflowMode,
  type AgentLaneResourceSample,
  type ProcessResourceCliLane,
  type XCodeMcpTelemetryEvent,
  type XCodeMcpResourceSample,
  type XCodeToolExecResource,
  type XCodePluginOperationProgressNotification,
  type XCodeTaskMode,
} from "@zcode/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { createOfficialMcpIssuanceAudit } from "#src/official-mcp/officialMcpIssuanceAudit.js";
import type {
  AccountRequestAuthMaterial,
  IAccountRequestAuthService,
} from "#src/model-provider/accountRequestAuthService.js";
import type { AccountRotationService } from "#src/model-provider/accountRotation.js";
import {
  mergeAutomationMutationToolDenylist,
  mergeOffPeakMutationToolDenylist,
} from "#src/zcode-agent/automationToolPolicy.js";
import { XCODE_AGENT_RUNTIME_UNAVAILABLE_CODE } from "./zcodeAgent.js";
import { createContextCompositionClient } from "#src/zcode-agent/contextCompositionClient.js";
import {
  createPluginHostQueriesClient,
  type PluginUserOptionsReader,
} from "#src/zcode-agent/pluginHostQueriesClient.js";
import type {
  XCodeProtocolRequestId,
  ModelSelection,
  XCodeProviderRuntimeHeadersRequestParams,
  XCodeProviderRuntimeHeadersCancelled,
  XCodeSessionEvent,
  XCodeSessionRuntimePreferencesScope,
  XCodeSavedWorkflowScope,
  XCodeStateUpdatedNotification,
  XCodeWorkspacePresentation,
  XCodeWorkspaceRef,
  XCodeSessionRuntimePreferencesResult,
} from "@zcode/shared";
import type {
  IXCodeAgentService,
  XCodeAgentBackgroundBashOutputParams,
  XCodeAgentAppRuntimePreferences,
  XCodeAgentRuntimeExitedEvent,
  XCodeAgentRuntimeLifecycleEvent,
  XCodeAgentAddPluginMarketplaceParams,
  XCodeAgentAppUsageParams,
  XCodeAgentCancelPluginOperationParams,
  XCodeAgentCompactParams,
  XCodeAgentConfigurePluginParams,
  XCodeAgentResetPluginConfigParams,
  XCodeAgentCreateSessionParams,
  XCodeAgentInstallPluginParams,
  XCodeAgentGenerateWorkspaceTextParams,
  XCodeAgentTestModelConnectivityParams,
  XCodeAgentGoalParams,
  XCodeAgentGrantWorkspaceHookTrustParams,
  XCodeAgentInitializeResult,
  XCodeAgentListSessionsParams,
  XCodeAgentListSessionSubagentsParams,
  XCodeAgentReadWorkspacePresentationParams,
  XCodeAgentReadSessionEventsParams,
  XCodeAgentReadSessionMessagesParams,
  XCodeAgentReadSessionParams,
  XCodeAgentRemovePluginMarketplaceParams,
  ZCodeAgentRespondProviderRuntimeHeadersParams,
  XCodeAgentRespondSessionRuntimePreferencesParams,
  XCodeAgentResumeSessionParams,
  XCodeAgentSendPromptParams,
  XCodeAgentServiceEvent,
  ZCodeAgentProviderRuntimeHeadersRequest,
  XCodeAgentSessionSubscribeParams,
  XCodeAgentSessionTarget,
  XCodeAgentSessionRuntimePreferencesRequest,
  XCodeAgentTaskTokenUsageParams,
  XCodeAgentUsageRequestDetailsParams,
  XCodeAgentSetModeParams,
  XCodeAgentSetModelParams,
  XCodeAgentSetPluginEnabledParams,
  XCodeAgentSetThoughtLevelParams,
  XCodeAgentSetPersonaParams,
  XCodeAgentSetPrefillParams,
  XCodeAgentPluginReferenceCatalogParams,
  XCodeAgentSkillReferenceCatalogParams,
  XCodeAgentReadMcpResourceParams,
  XCodeAgentCallMcpToolForUiParams,
  XCodeAgentCancelMcpToolCallForUiParams,
  XCodeAgentReadMcpResourceForUiParams,
  XCodeAgentListMcpResourcesForUiParams,
  XCodeAgentAppToolCallForUiParams,
  XCodeAgentAppToolInstanceForUiParams,
  XCodeAgentRegisterAppToolsForUiParams,
  XCodeAgentResolveAppToolCallForUiParams,
  XCodeAgentMcpResourceSubscriptionForUiParams,
  XCodeAgentDeleteSavedWorkflowParams,
  XCodeAgentFindSavedWorkflowForRunParams,
  XCodeAgentGetSavedWorkflowParams,
  XCodeAgentListSavedWorkflowRunsParams,
  XCodeAgentListSavedWorkflowsParams,
  XCodeAgentMoveSavedWorkflowParams,
  XCodeAgentSaveSavedWorkflowFromRunParams,
  XCodeAgentSavedWorkflowTarget,
  XCodeAgentUpdateSavedWorkflowMetaParams,
  XCodeAgentResolveSuggestedPluginReferenceParams,
  XCodeAgentPluginViewParams,
  XCodeAgentUninstallPluginParams,
  XCodeAgentUpdatePluginParams,
  XCodeAgentRestoreBuiltinPluginParams,
  XCodeAgentUpdatePluginMarketplaceParams,
  XCodeAgentValidatePluginParams,
  XCodeAgentDescribePluginParams,
  XCodeAgentListMcpServerStatusesParams,
  XCodeAgentWorkspaceTarget,
  XCodeAgentCuaPermissionObservation,
  XCodeAgentCreateAutomationParams,
  XCodeAgentUpdateAutomationParams,
  XCodeAgentAutomationIdParams,
  XCodeAgentSetAutomationEnabledParams,
  XCodeAgentDeleteAutomationRunParams,
  XCodeAgentAttachmentBeginParams,
  XCodeAgentAttachmentChunkParams,
  XCodeAgentAttachmentReadParams,
  XCodeAgentConversationAttachmentReadParams,
  XCodeAgentConversationAttachmentStatParams,
  XCodeAgentAttachmentPreviewSourceParams,
  XCodeAgentAttachmentTerminalParams,
  XCodeAgentConversationCommandParams,
  XCodeAgentCommandsQueryParams,
  XCodeAgentConversationFileChangesParams,
  XCodeAgentConversationFileRewindPreviewParams,
  XCodeAgentConversationRowsRangeParams,
  XCodeAgentConversationPlansParams,
  ZCodeAgentConversationInputPredictionParams,
  XCodeAgentConversationWorkflowRunEventsParams,
  XCodeAgentConversationWorkflowRunArtifactDataParams,
  XCodeAgentConversationWorkflowRunArtifactReadParams,
  XCodeAgentConversationWorkflowRunArtifactsParams,
  XCodeAgentConversationWorkflowRunNodeResultParams,
  XCodeAgentConversationWorkflowRunWorkspaceParams,
  XCodeAgentConversationWorkflowRunsParams,
  XCodeAgentConversationResyncParams,
  XCodeAgentConversationSubscribeParams,
  XCodeAgentConversationUnsubscribeParams,
  XCodeAgentConnectionFlowParams,
  XCodeAgentSessionsIndexSubscribeParams,
  XCodeAgentWorkspaceConfigSubscribeParams,
} from "./zcodeAgent.js";
import { HOST_WORKTREE_COMMAND } from "./zcodeAgent.js";
import {
  backgroundBashOutputResultSchema,
  v4BackgroundBashOutputParamsSchema,
  V4_WIRE_PROTOCOL_VERSION,
  PROTOCOL_V4_LIMITS,
  clientHelloSchema,
  commandAckSchema,
  commandPayloadSchemas,
  commandsQueryParamsSchema,
  commandsQueryResultSchema,
  conversationTopic,
  parseConversationTopic,
  parseSessionsIndexTopic,
  parseWorkspaceConfigTopic,
  conversationTopicWireCandidateSchema,
  conversationTelemetryFactSchema,
  cuaPermissionObservationSchema,
  sessionsIndexTopic,
  sessionsIndexReconcileResultSchema,
  sessionsIndexTopicWireCandidateSchema,
  MAX_LEGACY_TASK_IDS_PER_SUBSCRIBE,
  V4_METHODS,
  V4_NOTIFICATIONS,
  v4AttachmentAbortResultSchema,
  v4AttachmentBeginResultSchema,
  v4AttachmentChunkResultSchema,
  v4AttachmentCommitResultSchema,
  v4AttachmentPreviewSourceParamsSchema,
  v4AttachmentPreviewSourceResultSchema,
  v4AttachmentReadParamsSchema,
  v4AttachmentReadResultSchema,
  v4ConversationAttachmentReadParamsSchema,
  v4ConversationAttachmentReadResultSchema,
  v4ConversationAttachmentStatParamsSchema,
  v4ConversationAttachmentStatResultSchema,
  v4ConnectionFlowResultSchema,
  v4ConversationFileChangesResultSchema,
  v4ConversationFileRewindPreviewResultSchema,
  v4ConversationRowsRangeResultSchema,
  v4ConversationPlansResultSchema,
  v4ConversationInputPredictionResultSchema,
  emptyInputPredictionResult,
  v4ConversationWorkflowRunEventsResultSchema,
  v4ConversationWorkflowRunArtifactDataResultSchema,
  v4ConversationWorkflowRunArtifactReadResultSchema,
  v4ConversationWorkflowRunArtifactsResultSchema,
  v4ConversationWorkflowRunNodeResultResultSchema,
  v4ConversationWorkflowRunWorkspaceResultSchema,
  v4ConversationWorkflowRunsResultSchema,
  v4ConversationResyncResultSchema,
  v4ConversationSubscribeResultSchema,
  v4ConversationUsageResultSchema,
  v4SessionsIndexSubscribeResultSchema,
  v4UsageRequestDetailsResultSchema,
  v4UsageStatsResultSchema,
  v4SessionDataMeasureResultSchema,
  v4SessionDataPurgeResultSchema,
  v4WorkspaceConfigSubscribeResultSchema,
  workspaceConfigTopic,
  workspaceConfigTopicWireCandidateSchema,
  utf8JsonByteLength,
  XCODE_ATTACHMENT_FAULT_CODES,
  XCodeAttachmentFaultError,
  type CommandAck,
  type ConversationTopicWireCandidate,
  type ConversationTelemetryFact,
  type SessionsIndexTopicWireCandidate,
  type WorkspaceConfigTopicWireCandidate,
  type CommandEnvelope,
} from "@zcode/shared/zcode-protocol-v4";
import {
  readTrustedXCodeAgentV4Connection,
  readTrustedXCodeAgentV4UnsubscribeRoute,
  type XCodeAgentV4ConnectionContext,
} from "./zcodeAgentConnectionScope.js";
import { createBackgroundSessionEventCoalescer } from "#src/zcode-agent/zcodeSessionEventCoalescer.js";
import { AutomationService } from "#src/session/automationService.js";
import { AutomationRepo } from "#src/session/automationRepo.js";
import { TaskIndexRepo } from "#src/session/taskIndexRepo.js";
import {
  XCodeAgentModelSelectionBasisUnsupportedError,
  XCodeAgentMcpStatusModeUnsupportedError,
} from "#src/zcode-agent/zcodeAgentErrors.js";
import { XCodeAgentProcessManager } from "./zcodeAgentProcessManager.js";
import type { XCodeAgentProcessManagerOptions } from "./zcodeAgentProcessManager.js";
import type { IOffPeakTaskService } from "#src/session/offPeakTask.js";
import type { IProxyPoolService, ProxyPoolState, ProxyProviderBindingView } from "#src/proxy-pool/proxyPool.js";
import {
  XCodeProtocolRequestTimeoutError,
  type XCodeProtocolClient,
} from "./zcodeProtocolClient.js";
import { getDataBaseDir } from "../paths.js";
import { resolveConnectionEgress } from "./modelRequestEgress.js";
import {
  dispatchModelJailbreakRequest,
  isModelJailbreakProtocolMethod,
  type ModelJailbreakDispatchResult,
  type ModelJailbreakSettingStore,
} from "./modelJailbreakDispatch.js";
import {
  dispatchProviderAccountRequest,
  PROVIDER_ACCOUNT_METHOD,
  type ProviderAccountDispatchResult,
  type ProviderAccountStore,
} from "./providerAccountDispatch.js";
import {
  collectBrowserAmbientContext,
  type BrowserAmbientContextExecutor,
} from "./zcodeAgentBrowserAmbientContext.js";
import {
  createCuaOperationTurnTracker,
  type CuaOperationWorkspaceTarget,
  type CuaOperationStateReporter,
} from "./cuaOperationTurnTracker.js";
import type { PipSessionEvent } from "@zcode/zcode-cua/pip-session";
import { registerMemoryDiagnosticsProvider } from "#src/memoryDiagnostics.js";

import {
  zcodeMcpUiResourceSubscriptionResultSchema as mcpUiEmptyResultSchema,
  zcodeMcpUiCloseInstanceResultSchema,
  zcodeMcpUiOpenInstanceResultSchema,
} from "@zcode/shared";
const logger = createServiceLogger("zcode-agent-service");
const cuaOperationLogger = createServiceLogger("cua-operation-turn");
const PLUGIN_MANAGEMENT_WORKSPACE_DIR_NAME = "plugin-workspace";
// 状态探测完成后释放闲置的 MCP 子进程；只作用于控制面，不回收会话进程。
const MCP_STATUS_LANE_IDLE_TIMEOUT_MS = 5 * 60_000;
// 官方 Claude marketplace 首次接入需要 clone/copy GitHub 仓库，30s 默认协议超时会杀掉健康 agent。
// 插件市场管理属于低频网络 I/O 操作，单独放宽超时，不影响普通会话消息的实时失败边界。
const PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS = 5 * 60_000;
/** 资源管理器每秒刷新；子进程映射是纯内存请求，超时就当本轮无映射，不能拖慢采样节拍。 */
const CHILD_PROCESSES_REQUEST_TIMEOUT_MS = 800;
const PLUGIN_OPERATION_CANCEL_REQUEST_TIMEOUT_MS = 5_000;
const SESSION_COMPACT_REQUEST_TIMEOUT_MS = 5 * 60_000;

interface PendingPermissionRequest {
  client: XCodeProtocolClient;
  protocolRequestId: XCodeProtocolRequestId;
}

interface PendingProviderRuntimeHeadersRequest extends PendingPermissionRequest {
  request: ZCodeAgentProviderRuntimeHeadersRequest;
  interactionRequired?: boolean;
  responding?: boolean;
}

interface PendingSessionRuntimePreferencesRequest extends PendingPermissionRequest {
  workspace: XCodeAgentWorkspaceTarget;
  request: XCodeAgentSessionRuntimePreferencesRequest;
  timeout: ReturnType<typeof setTimeout>;
  workspaceKey: string;
}

type SessionCreateCompatField =
  | "persistence"
  | "thoughtLevel"
  | "mcpServers"
  | "toolAllowlist"
  | "toolDenylist"
  | "offPeakToolEnabled"
  | "dynamicWorkflowEnabled"
  | "dynamicWorkflowMode";
type SessionResumeCompatField =
  | "thoughtLevel"
  | "mcpServers"
  | "toolAllowlist"
  | "toolDenylist"
  | "offPeakToolEnabled"
  | "dynamicWorkflowEnabled"
  | "dynamicWorkflowMode";
type SessionSendCompatField =
  | "browserAmbientContext"
  | "automationId"
  | "offPeakTaskId"
  | "offPeakRunType"
  | "botDeliveryTarget"
  | "toolDenylist";

const SESSION_CREATE_OPTIONAL_COMPAT_FIELDS = new Set<SessionCreateCompatField>([
  "persistence",
  "thoughtLevel",
  "mcpServers",
  // CUA 工具隔离新增：buildSessionCreateParams 会带 toolAllowlist/toolDenylist。若旧 app-server
  // 的 .strict() schema 不认，需可降级重试而不是整个 createSession 硬失败。
  "toolAllowlist",
  "toolDenylist",
  // Off-Peak 工具面 flag 同为可降级字段；旧 app-server 不认时省略重试（工具随之不注册，fail-closed）。
  "offPeakToolEnabled",
  // 动态工作流灰度 flag 同理：旧 CLI 不认时
  // 省略重试，工作流工具簇随之不注册，绝不让整个 create 硬失败。
  "dynamicWorkflowEnabled",
  // 灰度 mode（launch.md「On demand: activation」）：只认布尔的 CLI 省略它后按 alwaysOn 行事。
  "dynamicWorkflowMode",
]);
const SESSION_RESUME_OPTIONAL_COMPAT_FIELDS = new Set<SessionResumeCompatField>([
  "thoughtLevel",
  "mcpServers",
  // 冷恢复也带工具面约束；旧 app-server 不认时降级重试而不是硬失败（与 create 一致）。
  "toolAllowlist",
  "toolDenylist",
  "offPeakToolEnabled",
  "dynamicWorkflowEnabled",
  "dynamicWorkflowMode",
]);
const SESSION_SEND_OPTIONAL_COMPAT_FIELDS = new Set<SessionSendCompatField>([
  "browserAmbientContext",
  "automationId",
  "offPeakTaskId",
  "offPeakRunType",
  "botDeliveryTarget",
  "toolDenylist",
]);
// onDynamicSessionEvent 建立上游订阅时若 getClient / sessionSubscribe 瞬时失败
// （agent 进程刚启动、runtime 抛 "Session is not active" 竞态、transport 抖动），
// 直接 .catch(() => {}) 静默吞掉且不重试的话，调用方（含 syncer shadow 订阅）会把
// emitter.event 当作"订阅成功"缓存，永不重建——这条 session 的终态事件再也到不了，
// sqlite 停在旧状态、侧边栏 spinner 转不停。这里改为有限次指数退避重试，覆盖瞬时失败窗口。
const SESSION_SUBSCRIBE_RETRY_BASE_DELAY_MS = 500;
const SESSION_SUBSCRIBE_RETRY_MAX_DELAY_MS = 5_000;
const SESSION_SUBSCRIBE_MAX_ATTEMPTS = 8;
const MAX_TRACKED_SESSION_EVENT_IDS = 10_000;
const SSH_REMOTE_WORKSPACE_IDENTITY_PREFIX = "remote:ssh:";
const WSL_REMOTE_WORKSPACE_IDENTITY_PREFIX = "remote:wsl:";

export function supportsLegacyRemoteTaskAllowlist(workspaceIdentity: string | undefined): boolean {
  return Boolean(
    workspaceIdentity?.startsWith(SSH_REMOTE_WORKSPACE_IDENTITY_PREFIX) ||
    workspaceIdentity?.startsWith(WSL_REMOTE_WORKSPACE_IDENTITY_PREFIX),
  );
}

function isClosedStdioTransportError(error: unknown): boolean {
  return error instanceof Error && error.message === "XCode agent stdio transport is closed";
}

interface SessionEventSequenceState {
  assignedSeqByEventId: Map<string, number>;
  assignedSeqEventIds: string[];
  liveEventIds: Set<string>;
  liveEventIdOrder: string[];
  lastAssignedSeq: number;
}

function isProtocolMethodNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === -32601
  );
}

function buildWorkspaceRef(params: XCodeAgentWorkspaceTarget): XCodeWorkspaceRef {
  return {
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity,
    remoteSessionId: params.remoteSessionId,
    workspaceKey: resolveWorkspaceKey(params),
  };
}

/**
 * 会触发冷恢复的 V4 查询与命令信封带上当前 attachment 的 workspace（docs/git/worktree.md §9.3）。
 * 修复原因：只有 subscribe 带它；runtime 卸载后先到的计划目录、行分页、附件等查询让 CLI 按存储的
 * cwd 重建身份，受管 worktree 会话的 key 变成 worktree 路径，之后的反向请求被判为"不属于本 CLI"，
 * 任务打不开也不能发送。只对本地 workspace 注入：远程 Source Server 可能是不认识该字段的旧版本
 * （部分 schema 是 strict），worktree 也只支持本地。
 */
function coldResumeWorkspace(params: XCodeAgentWorkspaceTarget): {
  workspace?: XCodeWorkspaceRef;
} {
  return params.workspaceIdentity?.trim() || params.remoteSessionId
    ? {}
    : { workspace: buildWorkspaceRef(params) };
}

// 已保存工作流的 target 是否带 workspace：项目档、以及
// GUI 项目组里明说 `scope:"global"` 的动作都带 workspacePath；只给 `{ scope: "global" }` 的
// 全局组动作不带，交给 services 自选载体。
function savedWorkflowTargetHasWorkspace(
  params: XCodeAgentSavedWorkflowTarget,
): params is XCodeAgentWorkspaceTarget & { scope?: XCodeSavedWorkflowScope } {
  return typeof (params as Partial<XCodeAgentWorkspaceTarget>).workspacePath === "string";
}

// 只在 `scope` 有定义时下推到 RPC params：不给 scope 的项目档保持与今天逐字一致的线上形状。
function savedWorkflowScopeParam(params: XCodeAgentSavedWorkflowTarget): {
  scope?: XCodeSavedWorkflowScope;
} {
  return params.scope === undefined ? {} : { scope: params.scope };
}

function ensurePluginManagementWorkspacePath(): string {
  const workspacePath = join(getDataBaseDir(), ".xcode", PLUGIN_MANAGEMENT_WORKSPACE_DIR_NAME);
  // 插件管理是控制面能力，不能复用可能因真实 workspace 被删而 EPIPE 的会话进程。
  // 这里给它固定一个内部 cwd；真实 workspace 仍通过协议参数传给 CLI 做 workspace-scope 判定。
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

// NOTE: this counts ONLY the per-session MCP servers passed through the XCode Protocol
// session/create params (the app→protocol channel). It is deliberately independent of the
// CLI/bootstrap MCP servers configured in ~/.xcode/cli/config.json (mcp.servers), which the agent
// runtime connects separately and reports via the `mcp.server.connected`/toolCount events. So a
// createSession log line with mcpServerCount:0 is EXPECTED when zcode-cua is a CLI-config MCP server
// (e.g. the product Helper broker path injected through the gated bootstrap env): the model still receives those
// tools — the two numbers describe different channels, not a missing tool set. Verified on-machine:
// real kimi-k2.6 turns call mcp__zcode-cua__* tools (get_app_state/type/open_application, status
// completed) in sessions whose createSession logged mcpServerCount:0.
function getMcpServerCount(params: { mcpServers?: readonly unknown[] }): number {
  return params.mcpServers?.length ?? 0;
}

function getMcpServerNames(params: { mcpServers?: readonly { name: string }[] }): string[] {
  return params.mcpServers?.map((server) => server.name) ?? [];
}

function parseInvalidParamsIssues(error: unknown): unknown[] {
  const errorLike = error as {
    code?: unknown;
    data?: unknown;
    message?: unknown;
  };
  const message = errorLike.message;
  if (
    errorLike.code !== -32602 ||
    typeof message !== "string" ||
    (message !== "Invalid params" && !message.startsWith("Invalid params — "))
  ) {
    return [];
  }
  const data = errorLike.data;
  if (!data || typeof data !== "object") {
    return [];
  }
  // 新版 Agent 会把 Zod 摘要附加到顶层 message，旧兼容解析却只接受严格等于
  // "Invalid params"，导致 App/Agent 版本错位时无法省略新增字段重试。字段判断仍只信任
  // data 中的结构化 issues，不能从可变的人类可读摘要里猜字段名。
  const serializedIssues = (data as { message?: unknown }).message;
  if (typeof serializedIssues !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(serializedIssues) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getUnrecognizedTopLevelKeys(error: unknown): string[] {
  const keys = new Set<string>();
  for (const issue of parseInvalidParamsIssues(error)) {
    if (!issue || typeof issue !== "object") {
      continue;
    }
    const issueLike = issue as {
      code?: unknown;
      keys?: unknown;
      path?: unknown;
    };
    if (
      issueLike.code !== "unrecognized_keys" ||
      (Array.isArray(issueLike.path) && issueLike.path.length > 0) ||
      !Array.isArray(issueLike.keys)
    ) {
      continue;
    }
    for (const key of issueLike.keys) {
      if (typeof key === "string") {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function getSessionCreateCompatFields(error: unknown): SessionCreateCompatField[] {
  const keys = getUnrecognizedTopLevelKeys(error);
  if (keys.length === 0) {
    return [];
  }
  if (
    !keys.every((key): key is SessionCreateCompatField =>
      SESSION_CREATE_OPTIONAL_COMPAT_FIELDS.has(key as SessionCreateCompatField),
    )
  ) {
    return [];
  }
  return keys;
}

function getSessionResumeCompatFields(error: unknown): SessionResumeCompatField[] {
  const keys = getUnrecognizedTopLevelKeys(error);
  if (keys.length === 0) {
    return [];
  }
  if (
    !keys.every((key): key is SessionResumeCompatField =>
      SESSION_RESUME_OPTIONAL_COMPAT_FIELDS.has(key as SessionResumeCompatField),
    )
  ) {
    return [];
  }
  return keys;
}

function getSessionSendCompatFields(error: unknown): SessionSendCompatField[] {
  const keys = getUnrecognizedTopLevelKeys(error);
  if (keys.length === 0) {
    return [];
  }
  if (
    !keys.every((key): key is SessionSendCompatField =>
      SESSION_SEND_OPTIONAL_COMPAT_FIELDS.has(key as SessionSendCompatField),
    )
  ) {
    return [];
  }
  return keys;
}

function isProtocolRequestTimeout(error: unknown, method: string): boolean {
  if (error instanceof XCodeProtocolRequestTimeoutError) {
    return error.method === method;
  }
  return error instanceof Error && error.message === `XCode Protocol request timed out: ${method}`;
}

function assertV4AttachmentNdjsonEnvelope(method: string, params: unknown): void {
  // 实际 CLI request id 是递增整数；这里用更宽的 32-char id 做保守 exact-JSON meter。
  const bytes = utf8JsonByteLength({ id: "9".repeat(32), method, params }) + 1; // NDJSON newline
  if (bytes > PROTOCOL_V4_LIMITS.maxFrameBytes) {
    throw new Error("proto.frameTooLarge");
  }
}

function buildSessionCreateParams(
  params: XCodeAgentCreateSessionParams & {
    offPeakToolEnabled?: boolean;
    dynamicWorkflowEnabled?: boolean;
    dynamicWorkflowMode?: DynamicWorkflowMode;
  },
  omittedFields: ReadonlySet<SessionCreateCompatField> = new Set(),
) {
  // 工作区来源是权限边界，旧 Agent 不支持时不能省略后自动执行本地配置。
  if (
    omittedFields.has("mcpServers") &&
    params.mcpServers?.some((server) => server.scope === "workspace")
  ) {
    throw new Error("workspace_mcp_trust_unavailable");
  }
  return {
    sessionId: params.sessionId,
    additionalDirectories: params.additionalDirectories,
    workspace: buildWorkspaceRef(params),
    parentSessionId: params.parentSessionId,
    mode: params.mode,
    model: params.model,
    ...(params.persistence !== undefined && !omittedFields.has("persistence")
      ? { persistence: params.persistence }
      : {}),
    ...(params.thoughtLevel !== undefined && !omittedFields.has("thoughtLevel")
      ? { thoughtLevel: params.thoughtLevel }
      : {}),
    ...(params.titleGenerationEnabled !== undefined
      ? { titleGenerationEnabled: params.titleGenerationEnabled }
      : {}),
    // desktop-continuous 首发/恢复走 session service，不经过 legacy task adapter。
    // 之前这里没有把 UI 已解析的 MCP 带进 strict protocol params，runtimeConfig 只能看到空 MCP。
    // MCP 是 runtime 启动期配置，必须在 create/resume 请求边界显式传递，后续 sendPrompt 无法补上。
    ...(params.mcpServers !== undefined && !omittedFields.has("mcpServers")
      ? { mcpServers: params.mcpServers }
      : {}),
    // CUA 工具隔离字段是可降级的：旧 app-server 的 .strict() schema 若不认，兼容重试会把它们放进
    // omittedFields 省略后重试（而不是硬失败）。故这里必须同样受 omittedFields 门控。
    ...(params.toolAllowlist !== undefined && !omittedFields.has("toolAllowlist")
      ? { toolAllowlist: params.toolAllowlist }
      : {}),
    ...(params.toolDenylist !== undefined && !omittedFields.has("toolDenylist")
      ? { toolDenylist: params.toolDenylist }
      : {}),
    // importedHistory 是导入历史的完整性边界，不能像 thoughtLevel/persistence
    // 那样在旧协议兼容重试里省略，否则会创建一个可切模型但没有历史内容的空 session。
    ...(params.importedHistory !== undefined ? { importedHistory: params.importedHistory } : {}),
    // 只在灰度命中时下发 true（缺省不发字段）；旧 CLI strict schema 不认时经 compat 省略。
    ...(params.offPeakToolEnabled === true && !omittedFields.has("offPeakToolEnabled")
      ? { offPeakToolEnabled: true }
      : {}),
    // 动态工作流灰度：同 Off-Peak 的下发形状，
    // 关闭时不写字段——CLI 的缺省就是不注册那九个工具。
    ...(params.dynamicWorkflowEnabled === true && !omittedFields.has("dynamicWorkflowEnabled")
      ? { dynamicWorkflowEnabled: true }
      : {}),
    ...buildDynamicWorkflowModeField(params, omittedFields),
  };
}

/**
 * 灰度 mode 与布尔同行（launch.md「On demand: activation」）：只在开启时写，且只在布尔也在写时
 * 写——mode 单独出现对 CLI 没有意义。旧 CLI strict schema 不认时经 compat 省略，按 alwaysOn 行事。
 */
function buildDynamicWorkflowModeField(
  params: { dynamicWorkflowEnabled?: boolean; dynamicWorkflowMode?: DynamicWorkflowMode },
  omittedFields: ReadonlySet<SessionCreateCompatField | SessionResumeCompatField>,
): { dynamicWorkflowMode?: DynamicWorkflowMode } {
  return params.dynamicWorkflowEnabled === true &&
    params.dynamicWorkflowMode !== undefined &&
    !omittedFields.has("dynamicWorkflowEnabled") &&
    !omittedFields.has("dynamicWorkflowMode")
    ? { dynamicWorkflowMode: params.dynamicWorkflowMode }
    : {};
}

function buildSessionResumeParams(
  params: XCodeAgentResumeSessionParams & {
    offPeakToolEnabled?: boolean;
    dynamicWorkflowEnabled?: boolean;
    dynamicWorkflowMode?: DynamicWorkflowMode;
  },
  omittedFields: ReadonlySet<SessionResumeCompatField> = new Set(),
) {
  // 工作区来源是权限边界，旧 Agent 不支持时不能省略后自动执行本地配置。
  if (
    omittedFields.has("mcpServers") &&
    params.mcpServers?.some((server) => server.scope === "workspace")
  ) {
    throw new Error("workspace_mcp_trust_unavailable");
  }
  return {
    sessionId: params.sessionId,
    additionalDirectories: params.additionalDirectories,
    workspace: buildWorkspaceRef(params),
    ...(params.thoughtLevel !== undefined && !omittedFields.has("thoughtLevel")
      ? { thoughtLevel: params.thoughtLevel }
      : {}),
    // 冷恢复 session 时 app-server 可能重新创建 runtime；MCP 同样需要随 resume 请求下发。
    ...(params.mcpServers !== undefined && !omittedFields.has("mcpServers")
      ? { mcpServers: params.mcpServers }
      : {}),
    // 工具面约束必须和 create 路径一致随 resume 下发，否则冷恢复重建 runtime 后会丢失 allow/deny
    // 隔离（CUA 会话会重新可见 Bash 等被禁工具）。旧 app-server 不认时经 omittedFields 降级。
    ...(params.toolAllowlist !== undefined && !omittedFields.has("toolAllowlist")
      ? { toolAllowlist: params.toolAllowlist }
      : {}),
    ...(params.toolDenylist !== undefined && !omittedFields.has("toolDenylist")
      ? { toolDenylist: params.toolDenylist }
      : {}),
    // resume 不带该 flag 会让冷恢复丢 Off-Peak 工具面（与 toolAllowlist 同因）。
    ...(params.offPeakToolEnabled === true && !omittedFields.has("offPeakToolEnabled")
      ? { offPeakToolEnabled: true }
      : {}),
    // 同因：resume 不带该 flag 会让冷恢复丢掉工作流工具簇。
    ...(params.dynamicWorkflowEnabled === true && !omittedFields.has("dynamicWorkflowEnabled")
      ? { dynamicWorkflowEnabled: true }
      : {}),
    ...buildDynamicWorkflowModeField(params, omittedFields),
  };
}

function buildSessionSendParams(
  params: XCodeAgentSendPromptParams,
  omittedFields: ReadonlySet<SessionSendCompatField> = new Set(),
) {
  return {
    sessionId: params.sessionId,
    // 执行身份/约束不是可忽略的兼容字段；旧 Worker 不支持时必须失败，不能静默剥掉。
    ...(params.modelSelection ? { modelSelection: params.modelSelection } : {}),
    ...(params.modelSelectionBasis ? { modelSelectionBasis: params.modelSelectionBasis } : {}),
    ...(params.modelExecution ? { modelExecution: params.modelExecution } : {}),
    inputId: params.inputId,
    queryId: params.queryId,
    content: params.content,
    attachments: params.attachments,
    ...(params.browserAmbientContext !== undefined && !omittedFields.has("browserAmbientContext")
      ? { browserAmbientContext: params.browserAmbientContext }
      : {}),
    expectedRevision: params.expectedRevision,
    expectedProviderRevision: params.expectedProviderRevision,
    ...(params.automationId !== undefined && !omittedFields.has("automationId")
      ? { automationId: params.automationId }
      : {}),
    ...(params.offPeakTaskId !== undefined && !omittedFields.has("offPeakTaskId")
      ? { offPeakTaskId: params.offPeakTaskId }
      : {}),
    ...(params.offPeakRunType !== undefined && !omittedFields.has("offPeakRunType")
      ? { offPeakRunType: params.offPeakRunType }
      : {}),
    ...(params.botDeliveryTarget !== undefined && !omittedFields.has("botDeliveryTarget")
      ? { botDeliveryTarget: params.botDeliveryTarget }
      : {}),
    ...(params.toolDenylist !== undefined && !omittedFields.has("toolDenylist")
      ? { toolDenylist: params.toolDenylist }
      : {}),
  };
}

function buildSessionCompactParams(params: XCodeAgentCompactParams) {
  return {
    sessionId: params.sessionId,
    inputId: params.inputId,
    instructions: params.instructions,
    expectedRevision: params.expectedRevision,
  };
}

function formatModelSelectionForLog(ref: ModelSelection | undefined): string | null {
  if (!ref) {
    return null;
  }

  const base = `${ref.providerId}/${ref.modelId}`;
  const reasoningLevel = ref.options?.reasoningLevel;
  return reasoningLevel ? `${base}${XCODE_MODEL_REASONING_SEPARATOR}${reasoningLevel}` : base;
}

function sessionEventKey(params: XCodeAgentSessionTarget): string {
  return `${resolveWorkspaceKey(params)}\u0000${params.sessionId}`;
}

function rememberBoundedEventId(ids: Set<string>, order: string[], eventId: string): boolean {
  if (ids.has(eventId)) {
    return false;
  }
  ids.add(eventId);
  order.push(eventId);
  while (order.length > MAX_TRACKED_SESSION_EVENT_IDS) {
    const removed = order.shift();
    if (removed) {
      ids.delete(removed);
    }
  }
  return true;
}

function permissionRequestKey(params: XCodeAgentSessionTarget & { requestId: string }): string {
  return `${sessionEventKey(params)}\u0000${params.requestId}`;
}

function userInputRequestKey(params: XCodeAgentSessionTarget & { requestId: string }): string {
  return `${sessionEventKey(params)}\u0000${params.requestId}`;
}

function providerRuntimeHeadersRequestKey(
  params: XCodeAgentSessionTarget & { requestId: string },
): string {
  return `${sessionEventKey(params)}\u0000${params.requestId}`;
}

/**
 * 进程级 Provider Registry 的只读选择投影。
 *
 * 本地 Worker 自己持有完整 Registry；Host 只用这份投影判断模型执行是否可以启动，
 * 不能再把它扩张成 runtimeModel 并覆盖 Worker 的执行事实源。
 */
interface ModelSelectionReadinessSource {
  getView(): Promise<ModelSelectionView>;
  onDidChange?: (listener: (view: ModelSelectionView) => void) => IDisposable;
}

interface XCodeAgentProviderReadinessSnapshot {
  readonly providerCount: number;
  readonly revision: string;
  readonly readiness: {
    readonly ready: boolean;
    readonly providerId?: string;
    readonly modelId?: string;
  };
}

function createProviderReadinessSnapshotFromSelectionView(
  view: ModelSelectionView,
): XCodeAgentProviderReadinessSnapshot {
  for (const provider of view.providers) {
    const model = provider.models[0];
    if (!model) continue;
    return {
      providerCount: view.providers.length,
      revision: `model-selection:${view.revision}`,
      readiness: {
        ready: true,
        providerId: provider.providerId,
        modelId: model.modelId,
      },
    };
  }
  return {
    providerCount: view.providers.length,
    revision: `model-selection:${view.revision}`,
    readiness: { ready: false },
  };
}

interface WaitingWorkspaceStartup {
  cancelled: boolean;
  lastLoggedRevision?: string;
  starting?: Promise<XCodeProtocolClient>;
  workspace: XCodeAgentWorkspaceTarget;
}

interface ActiveWorkspaceClient {
  client: XCodeProtocolClient;
  interactionPreferencesReady?: Promise<void>;
  /**
   * 只记录该进程生命周期内是否曾通过 provider/model 启动门禁。
   * 只读 topic 可以先启动 CLI，但不能因此让后续 create/command 绕过门禁。
   */
  modelExecutionEnabled: boolean;
  workspace: XCodeAgentWorkspaceTarget;
  /**
   * 该 CLI 进程当前持有的动态工作流策略（launch.md「The user's choice」）。CLI 启动时缺省关闭，
   * 只在 workspace/updateDynamicWorkflowPolicy 成功后更新；重同步据此跳过没有变化的请求。
   */
  dynamicWorkflowPolicyMode: DynamicWorkflowMode;
}

function requiresProviderRegistryRefresh(commandType: string): boolean {
  // Bug 原因：模型切换遗漏刷新屏障，会用存量 Worker 的旧 Registry 校验新下发的 Provider。
  // 复用同一刷新队列，成功后才下发切换命令，失败则直接拒绝本次切换。
  switch (commandType) {
    case "createSession":
    case "createSelectionSideSession":
    case "sendText":
    case "sendGoalCommand":
    case "compact":
    case "forkAssistant":
    case "editUserQuery":
    case "retryTurn":
    case "sendQueuedNow":
    case "switchModelConfig":
      return true;
    default:
      return false;
  }
}

/** 与 CLI V4SessionNotResidentError 同一 reasonCode 文本，手机按它识别「不在内存，跳过」。 */
function sessionNotResidentError(sessionId: string): Error {
  return new Error(`session is not resident: ${sessionId} (proto.sessionNotResident)`);
}

function createRuntimeUnavailableError(params: XCodeAgentWorkspaceTarget): Error & {
  code: typeof XCODE_AGENT_RUNTIME_UNAVAILABLE_CODE;
  workspaceKey: string;
} {
  const error = new Error("XCode Agent runtime is not running.") as Error & {
    code: typeof XCODE_AGENT_RUNTIME_UNAVAILABLE_CODE;
    workspaceKey: string;
  };
  error.code = XCODE_AGENT_RUNTIME_UNAVAILABLE_CODE;
  error.workspaceKey = resolveWorkspaceKey(params);
  return error;
}

// 配置 GET 尚未发送模型请求；只恢复可证实的网络/服务暂时不可用，不能把认证或坏配置当成断网。
function isTemporaryVerificationConfigFailure(error: unknown): boolean {
  const failure = error as { status?: number; cause?: unknown } | null;
  // 200 只说明响应头成功；读取正文仍可能断流，必须继续检查结构化传输错误。
  if (typeof failure?.status === "number" && failure.status >= 400) {
    return failure.status === 408 || failure.status === 429 || failure.status >= 500;
  }
  if (isNetworkFailure(error)) return true;
  if (
    getNetworkErrorCodes(error).some((code) =>
      ["UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "EAI_AGAIN"].includes(
        code,
      ),
    )
  )
    return true;
  // 配置读取端口不接收用户 AbortSignal，这里的 AbortError 来自该 GET 的传输超时。
  return (
    failure?.cause instanceof Error && ["AbortError", "TimeoutError"].includes(failure.cause.name)
  );
}

/**
 * 配置读取失败要能在日志里定位，又不能写入异常原文：底层 ApiError 的 message 会夹带
 * 完整 URL、query 和远端响应正文。这里只保留类型、HTTP 状态和长度供排障归类。
 */
function describeVerificationConfigError(cause: unknown): {
  name: string;
  status?: number;
  messageLength?: number;
} {
  const error = cause instanceof Error ? cause : undefined;
  const status = (error as { status?: unknown } | undefined)?.status;
  return {
    name: error?.name ?? typeof cause,
    ...(typeof status === "number" ? { status } : {}),
    ...(error ? { messageLength: error.message.length } : {}),
  };
}

// 账号鉴权先用配置快照判定 Start Plan 是否需要界面验证；只注入服务会让每个
// Start Plan 请求都在运行时失败且没有装配期提示，因此两者必须成对注入。
type AccountRequestAuthOptions =
  | { accountRequestAuthService?: undefined; readRequestVerificationConfig?: undefined }
  | {
      accountRequestAuthService: IAccountRequestAuthService;
      readRequestVerificationConfig: () => Promise<RequestVerificationConfig | null>;
    };

type CreateXCodeAgentServiceOptions = CreateZCodeAgentServiceBaseOptions &
  AccountRequestAuthOptions;

interface CreateZCodeAgentServiceBaseOptions extends Omit<
  XCodeAgentProcessManagerOptions,
  "idleTimeoutMs"
> {
  /** 仅供 MCP 状态探测进程使用，不能把空闲回收传给 chat。 */
  mcpStatusIdleTimeoutMs?: number;
  accountProviderConfigSource?: ProviderSource<AccountProviderConfigSnapshot>;

  /** Desktop Host 请求 Main 登记 Agent 已授权的精确本地视频路径。 */
  authorizeLocalMediaPreviewPath?: (path: string) => Promise<string>;
  modelSelectionReadinessSource?: ModelSelectionReadinessSource;
  prepareRuntimeWorkspace?: (workspace: XCodeAgentWorkspaceTarget) => Promise<void>;
  readSubagentRuntimeConfig?: (workspace: {
    workspacePath: string;
    workspaceIdentity?: string;
  }) => Promise<SubagentRuntimeConfig>;
  sessionRuntimePreferencesAuthority?: "local" | "external";
  prepareProjectExecution?: (
    projectId: string,
  ) => Promise<import("@zcode/shared").ProjectExecutionSnapshot>;
  prepareSessionCreation?: (
    target: Omit<XCodeAgentSessionTarget, "sessionId"> & {
      sessionId?: string;
      projectId: string | null;
      creationCommand?: { clientId: string; commandId: string };
      additionalDirectories?: string[];
    },
  ) => Promise<{ sessionId: string; additionalDirectories: string[] }>;
  /** fork 提交后、ACK 返回前完成 Host 归属交接；duplicate 重放须幂等。 */
  prepareForkCreation?: (
    target: XCodeAgentSessionTarget & { parentSessionId: string },
  ) => Promise<void>;
  resolveSessionDirectories?: (target: XCodeAgentSessionTarget) => Promise<string[]>;
  /**
   * 会话操作闸门（受管 worktree 删除租约，docs/git/worktree.md §8.3）：会话命令与冷订阅经它执行，
   * 会话 cwd 位于删除中的 worktree 时被拒绝。由受管 worktree 服务提供。
   */
  runSessionOperation?: <T>(
    target: XCodeAgentSessionTarget,
    operation: () => Promise<T>,
  ) => Promise<T>;
  resolveSessionRuntimePreferences?: (
    scope: XCodeSessionRuntimePreferencesScope,
  ) => Promise<XCodeSessionRuntimePreferencesResult>;
  /** manual run 落库后由当前 host 直接派发；返回时 prompt 必须已被 session 接受。 */
  onAutomationManualRunRequested?: (params: {
    automation: XCodeAutomation;
    run: XCodeAutomationRun;
  }) => Promise<void>;
  /**
   * Off-Peak 会话内创建。config 同时承担曝光门（enabled && Selection View 非空 →
   * session create/resume 下发 offPeakToolEnabled）与缺省解析（model=白名单末位 /
   * thoughtLevel=最高档）；service 供 offPeak/create、offPeak/list 协议 handler 调用。
   * 两者任一缺省即整体关闭（纯 CLI / desktop-attached-remote 装配不传）。
   */
  resolveOffPeakClientConfig?: () => Promise<OffPeakClientConfig | undefined>;
  /**
   * 动态工作流灰度快照。Host 是唯一裁决者：
   * 结果既作为 workspace 级事实下发给 CLI，也决定 session create/resume/v4 是否带
   * dynamicWorkflowEnabled。缺省不传（纯 CLI 装配）= 永远关闭，与 CLI 缺省一致。
   */
  resolveDynamicWorkflowClientConfig?: () => Promise<DynamicWorkflowClientConfig | undefined>;
  /**
   * 用户选择的读取点（launch.md「The user's choice」）：拥有设置权威的 Host 注入，每次使用时读取
   * 设置文件。desktop-attached remote Host 不注入，改用 desktop 推来的值（syncDynamicWorkflowUserMode）。
   */
  resolveDynamicWorkflowUserMode?: () => Promise<DynamicWorkflowMode | undefined>;
  /** 用户选择同步后交给装配层转发（Desktop Host 推给本窗口的远程 Host）；值取自本机设置。 */
  forwardDynamicWorkflowUserMode?: (mode: DynamicWorkflowMode | undefined) => void;
  resolveOffPeakTaskService?: () =>
    | Pick<IOffPeakTaskService, "createTask" | "list" | "getCodingPlanSupport">
    | undefined;
  /**
   * 多账号轮询（Qoder / CodeBuddy）。adapter 只在账号级失败后经由
   * `excludedConnectionIds` 触发换号；正常请求也走它返回当前激活账号的材料，
   * 保证「选的账号」与请求实际使用的 token 一致。
   */
  accountRotationService?: AccountRotationService;
  /**
   * 桌宠控制端口（agent PetControl 工具的落地）：读写悬浮宠物的行为状态、
   * 触发挥手。由 node.ts 接到桌面主进程的宠物控制器；缺席 = 工具不注册。
   */
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
   * 失败换号重选到非激活账号时，把「当前登录态（激活）账号」跟随切到新账号。
   * 只在带 lastFailure 的换号重选上触发，正常请求永远选中的是激活账号不会调用。
   * oauth 家族的实现是 oauthService.switchAccount（激活指针 + 镜像 + UI 通知）。
   */
  followRotatedAccount?: (accountRef: string) => Promise<void>;
  /**
   * 代理池服务：agent 的 ProxyPool 工具经 proxyPool/* 协议落到这里。
   * node.ts 直接注入本来就注册在 DI 里的 IProxyPoolService 实例；缺省（未装配代理池的
   * host）不注入，协议回 -32601，工具侧报能力不可用而不是静默失败。
   */
  resolveProxyPoolService?: () => IProxyPoolService | undefined;
  /**
   * 模型越狱配置：agent 的 ModelJailbreak 工具经 modelJailbreak/* 协议落到这里。
   * node.ts 注入一个只读写 customSystemMessages 的窄 store；缺省（未装配的 host）
   * 不注入，协议回 -32601，工具侧报能力不可用而不是静默失败。
   */
  resolveModelJailbreakStore?: () => ModelJailbreakSettingStore | undefined;
  /**
   * 账号凭据：agent 的 ProviderAccount 工具经 providerAccount/manage 协议落到这里。
   * node.ts 注入账号表 + OAuth 仓储的窄 store；缺省（未装配的 host）不注入，
   * 协议回 -32601，工具侧报能力不可用而不是静默失败。
   */
  resolveProviderAccountStore?: () => ProviderAccountStore | undefined;
  /**
   * browser-use 执行桥：把 agent 的 interaction/browserExecute 反向请求转发到 main
   * （WebContentsView+CDP）。desktop host 装配时注入；缺省（纯 CLI/远控无 main）则
   * browser 命令返回 backend_unavailable，不影响其它功能。
   */
  browserControlExecutor?: BrowserAmbientContextExecutor;
  /** App 工具只在受信 Host 装配；handler 不接受模型自报权限。 */
  resolveAppControlService?: () => AppControlService | undefined;
  appControlSourceServerId?: string;
  channelReplyExecutor?: (request: ChannelReplyHostRequest) => Promise<ChannelReplyResult>;
  topicResourceExecutor?: (
    request: XCodeTopicResourceReadParams &
      XCodeAgentWorkspaceTarget & { trace?: XCodeProtocolTrace },
    signal: AbortSignal,
  ) => Promise<XCodePromptAttachment>;
  topicResourceValidator?: (
    request: XCodeTopicResourceReadParams &
      XCodeAgentWorkspaceTarget & { trace?: XCodeProtocolTrace },
    signal: AbortSignal,
  ) => Promise<void>;
  /**
   * 官方 Server MCP 身份头解析器。Agent 进程不持有用户身份权威，
   * 经 interaction/requestOfficialMcpAuthHeaders 向 host 索取本次请求的身份头。
   *
   * 缺省时该请求一律返回 official_auth_unavailable，绝不降级为匿名请求——
   * 例如 standalone CLI 没有 host auth port 的场景。
   */
  officialMcpAuthHeadersResolver?: {
    resolveHeaders(request: {
      /** plugin-command 按「套餐可选」解析：没有套餐时只返回 XCode 登录身份。 */
      consumer: OfficialAuthConsumerKind;
      mcpKey: string;
      pluginId: string;
      targetOrigin: string;
      workspace: { workspaceIdentity?: string; workspaceKey: string; workspacePath: string };
    }): Promise<
      | { ok: true; headers: Record<string, string> }
      | { ok: false; reason: "official_auth_unavailable" | "official_auth_plan_required" }
    >;
  };
  /**
   * 官方 MCP 可信 Origin 校验器。**host 是身份权威边界**，因此
   * targetOrigin 的校验必须在这里执行，不能只依赖 agent adapter 的 fetch wrapper——那等于让
   * 被审查方自己当审查者。desktop-attached remote 场景下 agent 跑在远端而 host 持有本地用户身份。
   *
   * 此校验约束凭据请求的目标 origin，不提供逐插件权限控制。
   * HTTP 鉴权由宿主 fetch wrapper 注入，stdio 鉴权会将凭据交给插件进程；后者
   * 必须按受信任的可执行代码管理。服务端仍须校验每次调用的身份、权限和配额。
   *
   * 缺省时一律拒绝（fail closed），不退化为"只做 schema 校验就发凭据"。
   */
  officialMcpTrustedOrigins?: {
    isTrusted(input: { pluginId: string; mcpKey: string; origin: string }): Promise<{
      detail?: string;
      trusted: boolean;
    }>;
  };
  /** 已连接的内置 CLI 复用宿主加解密，不直接访问桌面系统钥匙串。 */
  credentialCipherProvider?: CredentialCipher;
  /** desktop-local Host 注入；只消费已校验、已去重的 live session event。 */
  cuaOperationStateReporter?: CuaOperationStateReporter;
  onCuaPipSessionLifecycle?: (
    workspace: CuaOperationWorkspaceTarget,
    event: Exclude<PipSessionEvent, { kind: "focus-changed" }>,
  ) => void;
}

function toProtocolAutomation(automation: XCodeAutomation) {
  return {
    automationId: automation.automationId,
    title: automation.title,
    cronExpr: automation.cronExpr,
    prompt: automation.prompt,
    modelSelection: automation.modelSelection,
    mode: automation.mode,
    targetTaskId: automation.targetTaskId,
    enabled: automation.enabled,
    lifecycleStatus: automation.lifecycleStatus,
    nextRunAt: automation.nextRunAt,
    lastRunAt: automation.lastRunAt,
    runCount: automation.runCount,
    recurring: automation.recurring,
    maxRuns: automation.maxRuns,
    // 透传权威 scheduleRule；会话卡片必须读到本字段才能展示 cron 无法表达的真实间隔
    // （如每50小时、每40天），否则只能从兼容 cronExpr 推断出「每小时的第00分」等错误展示。
    scheduleRule: automation.scheduleRule,
  };
}

export function toProtocolOffPeakTaskSnapshot(task: {
  offPeakTaskId: string;
  title: string;
  status: "queued" | "paused" | "running" | "completed" | "failed" | "cancelled";
  queuePosition?: number;
  sessionId?: string;
  createdAt: number;
}) {
  // 协议最小面：不暴露 serverTicketId / providerName / workspace 细节。
  return {
    offPeakTaskId: task.offPeakTaskId,
    title: task.title,
    status: task.status,
    ...(typeof task.queuePosition === "number" && task.queuePosition > 0
      ? { queuePosition: task.queuePosition }
      : {}),
    ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    createdAt: task.createdAt,
  };
}

export const OFF_PEAK_INTERNAL_ERROR_CODE = "offpeak_internal_error";
export const OFF_PEAK_INTERNAL_ERROR_MESSAGE = "Internal off-peak service error";

/**
 * offPeak/create、offPeak/list 的兜底 catch 不得把跨层异常文本（SQLite/文件路径/
 * 上游响应片段）原样回传协议——它会进入 CLI 日志与模型可见错误。原始错误只进服务端日志，
 * 对外固定稳定错误码 + 通用文案；业务失败分类仍走 respond({ok:false}) 不经此处。
 */
async function respondOffPeakInternalError(
  client: Pick<XCodeProtocolClient, "respondError">,
  request: { id: XCodeProtocolRequestId; method: string },
  workspace: XCodeAgentWorkspaceTarget,
  error: unknown,
): Promise<void> {
  logger.warn(undefined, "Off-peak 协议请求处理失败", {
    method: request.method,
    workspaceKey: resolveWorkspaceKey(workspace),
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  await client.respondError(request.id, {
    code: -32603,
    message: OFF_PEAK_INTERNAL_ERROR_MESSAGE,
    data: { errorCode: OFF_PEAK_INTERNAL_ERROR_CODE },
  });
}

// ------------------------------------------------------------
// 代理池配置（proxyPool/*）
// ------------------------------------------------------------
// agent 的 ProxyPool 工具经这一族方法落到 host 的 IProxyPoolService —— 与设置页
// 「代理池配置 / 代理出口」是同一份服务、同一份落盘数据，不存在第二套写入路径。
// 语义与设置页逐字一致：绑定某池 = 该连接独占池出口且不再走全局代理；未绑定 = 跟随全局
// 代理状态；绑定但池停用或地址无效 = 硬直连（绝不回落全局代理）。
//
// 每个方法都回同一个 snapshot（全量池 + 支持连接的供应商摘要，外加该供应商详情 / 探针结果），
// 模型改完立刻看到真值，不必再读一次。入参类错误（池名缺失、URL scheme 不支持等）按稳定
// errorCode 过协议，不收敛成「内部错误」——模型要靠它修正入参。

export const PROXY_POOL_INTERNAL_ERROR_CODE = "proxypool_internal_error";
export const PROXY_POOL_INTERNAL_ERROR_MESSAGE = "Internal proxy pool service error";

const PROXY_POOL_METHODS: ReadonlySet<string> = new Set([
  zcodeProtocolMethods.proxyPoolList,
  zcodeProtocolMethods.proxyPoolSave,
  zcodeProtocolMethods.proxyPoolDelete,
  zcodeProtocolMethods.proxyPoolSetActive,
  zcodeProtocolMethods.proxyPoolTest,
  zcodeProtocolMethods.proxyPoolBindAccount,
  zcodeProtocolMethods.proxyPoolApplyToAll,
  zcodeProtocolMethods.proxyPoolDistribute,
  zcodeProtocolMethods.petControlGet,
  zcodeProtocolMethods.petControlSetState,
  zcodeProtocolMethods.petControlWave,
]);
const PET_CONTROL_METHODS: ReadonlySet<string> = new Set([
  zcodeProtocolMethods.petControlGet,
  zcodeProtocolMethods.petControlSetState,
  zcodeProtocolMethods.petControlWave,
]);

/**
 * 服务层为「入参可修正」抛出的稳定错误码（shared validateProxyPoolUrl / savePool）。
 * 只有这些原样回给模型；其它异常按内部错误收敛，不外泄文件路径与栈。
 */
const PROXY_POOL_REJECTION_CODES: ReadonlySet<string> = new Set([
  "proxy-pool-name-required",
  "proxy-url-required",
  "proxy-url-invalid",
  "proxy-url-invalid-characters",
  "proxy-url-unparsable",
  "proxy-url-unsupported-scheme",
  "proxy-url-missing-host",
]);

export function isProxyPoolProtocolMethod(method: string): boolean {
  return PROXY_POOL_METHODS.has(method);
}

export function isPetControlProtocolMethod(method: string): boolean {
  return PET_CONTROL_METHODS.has(method);
}

function toProxyPoolProtocolEntry(pool: ProxyPoolEntry) {
  return {
    id: pool.id,
    name: pool.name,
    proxyUrl: pool.proxyUrl,
    ...(pool.noProxy ? { noProxy: pool.noProxy } : {}),
    isActive: pool.isActive,
    type: pool.type,
    ...(pool.strictProxy ? { strictProxy: pool.strictProxy } : {}),
  };
}

function toProxyPoolProtocolProvider(view: ProxyProviderBindingView) {
  return {
    providerId: view.providerId,
    providerName: view.providerName,
    ...(view.requestProfile ? { requestProfile: view.requestProfile } : {}),
    supportsConnections: view.supportsConnections,
    pools: view.pools.map(toProxyPoolProtocolEntry),
    accounts: view.accounts.map((account) => ({
      id: account.id,
      displayName: account.displayName,
      ...(account.email ? { email: account.email } : {}),
      active: account.active,
      ...(account.boundEntryId ? { boundEntryId: account.boundEntryId } : {}),
    })),
  };
}

/**
 * 视图 → 协议 snapshot。刻意只挑字段：ProxyProviderBindingView 上的 `binding`
 * 是「已绑定条目的快照」，协议里用不到，带过去会被 strict schema 拒。
 */
function toProxyPoolSnapshot(
  state: ProxyPoolState,
  provider?: ProxyProviderBindingView,
): XCodeProxyPoolProtocolSnapshot {
  return {
    pools: state.pools.map(toProxyPoolProtocolEntry),
    providers: state.providers.map((view) => ({
      providerId: view.providerId,
      providerName: view.providerName,
      ...(view.requestProfile ? { requestProfile: view.requestProfile } : {}),
      supportsConnections: view.supportsConnections,
      accountCount: view.accounts.length,
      boundAccountCount: view.accounts.filter((account) => account.boundEntryId).length,
    })),
    ...(provider ? { provider: toProxyPoolProtocolProvider(provider) } : {}),
  };
}

type ProxyPoolDispatchResult =
  | { ok: true; snapshot: XCodeProxyPoolProtocolSnapshot }
  | { ok: false; message: string; data?: unknown };

/** 导出给测试：这条 switch 是 proxyPool/* 的唯一 host 侧映射，协议快照的字段裁剪也在里面。 */
export async function dispatchProxyPoolRequest(
  service: IProxyPoolService,
  request: { method: string; params?: unknown },
): Promise<ProxyPoolDispatchResult> {
  const invalid = (message: string, data?: unknown): ProxyPoolDispatchResult => ({
    ok: false,
    message,
    ...(data === undefined ? {} : { data }),
  });

  /** 绑定类操作的收尾：连接级绑定一定回该供应商视图；null 说明 providerId 不存在。 */
  const finishProviderMutation = async (
    providerId: string,
    view: ProxyProviderBindingView | null,
  ): Promise<ProxyPoolDispatchResult> => {
    if (!view) {
      return invalid(
        `Unknown provider id: ${providerId}. Pass one of the providerId values returned by list.`,
      );
    }
    return { ok: true, snapshot: toProxyPoolSnapshot(await service.getState(), view) };
  };

  switch (request.method) {
    case zcodeProtocolMethods.proxyPoolList: {
      const parsed = zcodeProxyPoolListParamsSchema.safeParse(request.params ?? {});
      if (!parsed.success) return invalid("Invalid proxy pool list params", parsed.error.flatten());
      const state = await service.getState();
      if (!parsed.data.providerId) {
        return { ok: true, snapshot: toProxyPoolSnapshot(state) };
      }
      const provider = await service.getProviderBinding(parsed.data.providerId);
      if (!provider) {
        return invalid(
          `Unknown provider id: ${parsed.data.providerId}. Pass one of the providerId values returned by list.`,
        );
      }
      return { ok: true, snapshot: toProxyPoolSnapshot(state, provider) };
    }

    case zcodeProtocolMethods.proxyPoolSave: {
      const parsed = zcodeProxyPoolSaveParamsSchema.safeParse(request.params);
      if (!parsed.success) return invalid("Invalid proxy pool save params", parsed.error.flatten());
      const state = await service.savePool({
        ...(parsed.data.poolId ? { id: parsed.data.poolId } : {}),
        name: parsed.data.name,
        proxyUrl: parsed.data.proxyUrl,
        ...(parsed.data.noProxy === undefined ? {} : { noProxy: parsed.data.noProxy }),
        ...(parsed.data.isActive === undefined ? {} : { isActive: parsed.data.isActive }),
        ...(parsed.data.strictProxy === undefined ? {} : { strictProxy: parsed.data.strictProxy }),
      });
      return { ok: true, snapshot: toProxyPoolSnapshot(state) };
    }

    case zcodeProtocolMethods.proxyPoolDelete: {
      const parsed = zcodeProxyPoolDeleteParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid proxy pool delete params", parsed.error.flatten());
      }
      const state = await service.deletePool(parsed.data.poolId);
      return { ok: true, snapshot: toProxyPoolSnapshot(state) };
    }

    case zcodeProtocolMethods.proxyPoolSetActive: {
      const parsed = zcodeProxyPoolSetActiveParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid proxy pool setActive params", parsed.error.flatten());
      }
      const state = await service.setPoolActive(parsed.data.poolId, parsed.data.isActive);
      return { ok: true, snapshot: toProxyPoolSnapshot(state) };
    }

    case zcodeProtocolMethods.proxyPoolTest: {
      const parsed = zcodeProxyPoolTestParamsSchema.safeParse(request.params);
      if (!parsed.success) return invalid("Invalid proxy pool test params", parsed.error.flatten());
      if (!parsed.data.poolId && !parsed.data.proxyUrl) {
        return invalid("proxyPool/test requires poolId or proxyUrl");
      }
      const test = await service.testPool({
        ...(parsed.data.poolId ? { poolId: parsed.data.poolId } : {}),
        ...(parsed.data.proxyUrl ? { proxyUrl: parsed.data.proxyUrl } : {}),
        ...(parsed.data.testUrl ? { testUrl: parsed.data.testUrl } : {}),
      });
      return {
        ok: true,
        snapshot: { ...toProxyPoolSnapshot(await service.getState()), test },
      };
    }

    case zcodeProtocolMethods.proxyPoolBindAccount: {
      const parsed = zcodeProxyPoolBindParamsSchema.safeParse(request.params);
      if (!parsed.success) return invalid("Invalid proxy pool bind params", parsed.error.flatten());
      const view = await service.saveAccountBinding(
        parsed.data.providerId,
        parsed.data.accountId,
        parsed.data.poolId,
      );
      return finishProviderMutation(parsed.data.providerId, view);
    }

    case zcodeProtocolMethods.proxyPoolApplyToAll: {
      const parsed = zcodeProxyPoolApplyToAllParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid proxy pool applyToAll params", parsed.error.flatten());
      }
      const view = await service.applyPoolToAllAccounts(
        parsed.data.providerId,
        parsed.data.poolId,
      );
      return finishProviderMutation(parsed.data.providerId, view);
    }

    case zcodeProtocolMethods.proxyPoolDistribute: {
      const parsed = zcodeProxyPoolDistributeParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid proxy pool distribute params", parsed.error.flatten());
      }
      // 空数组 = 用当前全部启用的池，按列表顺序（镜像设置页「按序轮流分配」按钮的行为）。
      const poolIds =
        parsed.data.poolIds.length > 0
          ? parsed.data.poolIds
          : (await service.getState()).pools
              .filter((pool) => pool.isActive)
              .map((pool) => pool.id);
      if (poolIds.length === 0) {
        return invalid("There is no active proxy pool to distribute; create or enable one first.");
      }
      const view = await service.distributePools(parsed.data.providerId, poolIds);
      return finishProviderMutation(parsed.data.providerId, view);
    }

    default:
      return invalid(`Unsupported proxy pool method: ${request.method}`);
  }
}

/** 内部错误收敛：原始异常只进服务端日志，对外固定稳定错误码。 */
async function respondProxyPoolInternalError(
  client: Pick<XCodeProtocolClient, "respondError">,
  request: { id: XCodeProtocolRequestId; method: string },
  workspace: XCodeAgentWorkspaceTarget,
  error: unknown,
): Promise<void> {
  logger.warn(undefined, "代理池协议请求处理失败", {
    method: request.method,
    workspaceKey: resolveWorkspaceKey(workspace),
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });
  await client.respondError(request.id, {
    code: -32603,
    message: PROXY_POOL_INTERNAL_ERROR_MESSAGE,
    data: { errorCode: PROXY_POOL_INTERNAL_ERROR_CODE },
  });
}

/** D49-8/SG-02：只有灰度有效开启且白名单非空才算"可创建"；其余一律视为关闭（空数组）。 */
export function resolveOffPeakAllowedModels(
  grayConfig: OffPeakClientConfig | undefined,
  providerId?: string,
): readonly string[] {
  if (grayConfig?.enabled !== true) return [];
  return grayConfig.modelSelectionView.providers
    .filter((provider) => providerId === undefined || provider.providerId === providerId)
    .flatMap((provider) => provider.models.map((model) => model.modelId));
}

/**
 * model 解析：省略 → 白名单末位（服务端顺序末位≈最新最强）；显式 → trim + 大小写不敏感匹配，
 * 命中返回白名单原写法，未命中返回 null（调用方回 model_not_allowed）。
 */
export function resolveOffPeakCreateModel(
  allowedModels: readonly string[],
  requested: string | undefined,
): string | null {
  const wanted = requested?.trim();
  if (!wanted) return allowedModels[allowedModels.length - 1] ?? null;
  const lower = wanted.toLowerCase();
  return allowedModels.find((model) => model.trim().toLowerCase() === lower) ?? null;
}

/**
 * 新工具任务复用公共最高档补全；旧 metadata/型号特判会偏离 values 的语义顺序。
 * 显式档位留给 createTask 的现有校验，不在入口擅自换档。
 */
export function resolveOffPeakToolSelection(
  view: ModelSelectionView,
  providerId: string,
  modelId: string,
  thoughtLevel?: string,
): ModelSelection | undefined {
  const selection = completeNewModelSelection(view, { providerId, modelId });
  if (!selection) return undefined;
  return thoughtLevel === undefined
    ? selection
    : { ...selection, options: { reasoningLevel: thoughtLevel } };
}
function isHostWorktreeCommand(params: XCodeAgentConversationCommandParams): boolean {
  return (params as { [HOST_WORKTREE_COMMAND]?: unknown })[HOST_WORKTREE_COMMAND] === true;
}

function assertNoHostOnlyWorktreeFields(envelope: CommandEnvelope): void {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const forbidden =
    envelope.type === "createSession"
      ? payload.cwd !== undefined || payload.worktreeCreation !== undefined
      : envelope.type === "forkAssistant" && payload.targetCwd !== undefined;
  if (forbidden) throw new Error("worktree.host-only-field");
}

export function createXCodeAgentService(
  options?: CreateXCodeAgentServiceOptions,
): IXCodeAgentService & { disposeAllAndWait(): Promise<void> } {
  const processManager = new XCodeAgentProcessManager(options);
  // Windows indicator 与 macOS producer lifecycle client 共用已校验、去重的 sideband facts。
  const cuaOperationTurnTracker =
    options?.cuaOperationStateReporter || options?.onCuaPipSessionLifecycle
      ? createCuaOperationTurnTracker({
          ...(options?.cuaOperationStateReporter
            ? { reporter: options.cuaOperationStateReporter }
            : {}),
          ...(options?.onCuaPipSessionLifecycle
            ? { onPipSessionLifecycle: options.onCuaPipSessionLifecycle }
            : {}),
          logger: {
            debug: (message) => cuaOperationLogger.debug(undefined, message),
            info: (message) => cuaOperationLogger.info(undefined, message),
            warn: (message) => cuaOperationLogger.warn(undefined, message),
          },
        })
      : undefined;
  // AutomationRepo 也持有 tasks-index.sqlite 连接，disposeAll 需一并收口（见下方 disposeAll 注释）
  const automationRepo = new AutomationRepo();
  const automationService = new AutomationService(automationRepo, options?.prepareProjectExecution);
  const automationTaskIndexRepo = new TaskIndexRepo();
  const pluginProcessManager = new XCodeAgentProcessManager({
    commandResolver: options?.commandResolver,
    presentationSurface: options?.presentationSurface,
    requestTimeoutMs: options?.requestTimeoutMs,
    resolveSpawnEnv: options?.resolveSpawnEnv,
    waitForSpawnAdmission: options?.waitForSpawnAdmission,
  });
  // 合并时误删了独立进程：mcp/list 的慢握手会堵住串行 stdio 队列，连带卡住插件卸载。
  // 恢复专用控制面进程及空闲回收；共享 workspace 路径，不共享请求队列或 watchdog。
  const mcpStatusProcessManager = new XCodeAgentProcessManager({
    commandResolver: options?.commandResolver,
    presentationSurface: options?.presentationSurface,
    processLifecycleReporter: options?.processLifecycleReporter,
    requestTimeoutMs: options?.requestTimeoutMs,
    resolveSpawnEnv: options?.resolveSpawnEnv,
    waitForSpawnAdmission: options?.waitForSpawnAdmission,
    lane: "mcp-status",
    idleTimeoutMs: options?.mcpStatusIdleTimeoutMs ?? MCP_STATUS_LANE_IDLE_TIMEOUT_MS,
  });
  const sessionEmitters = new Map<string, Emitter<XCodeAgentServiceEvent>>();
  /**
   * 已经记过"首次发放官方身份头"审计日志的 (pluginId, mcpKey, workspaceKey)。
   *
   * 存在理由：成功路径不能只记 debug——生产构建的最低级别是 Info，事后无法回答
   * "凭据被哪个插件取走过"。但每次 initialize / tools\_list / tools\_call 都会触发一次发放，
   * 全量记 info 就是消息量级的日志膨胀。折中：每个三元组只在本进程内首次发放时记一条 info，
   * 之后仍走 debug。审计线索到"哪个插件、哪个 workspace、什么时候第一次拿"这个粒度。
   */
  const officialMcpIssuanceAudit = createOfficialMcpIssuanceAudit();
  const providerRuntimeHeadersWorkspaceEmitters = new Map<
    string,
    Emitter<ZCodeAgentProviderRuntimeHeadersRequest>
  >();
  const providerRuntimeHeadersCancelledEmitters = new Map<
    string,
    Emitter<XCodeProviderRuntimeHeadersCancelled>
  >();
  function cancelProviderRuntimeHeaders(
    key: string,
    pending: PendingProviderRuntimeHeadersRequest,
  ): void {
    pendingProviderRuntimeHeaders.delete(key);
    const { requestId, sessionId, workspace } = pending.request;
    // 先删除再投递，确保晚订阅不会重新启动已取消的请求校验。
    providerRuntimeHeadersCancelledEmitters
      .get(resolveWorkspaceKey(workspace))
      ?.fire({ requestId, sessionId, workspace });
    logger.info(undefined, "请求校验已取消", {
      requestId,
      sessionId,
      workspaceKey: resolveWorkspaceKey(workspace),
    });
  }
  const sessionRuntimePreferencesRequestEmitter =
    new Emitter<XCodeAgentSessionRuntimePreferencesRequest>();
  const processResourceSampleEmitter = new Emitter<AgentLaneResourceSample>();
  const pluginStartupDegradedEmitter = new Emitter<{
    workspaceKey: string;
    client: XCodeProtocolClient;
  }>();
  const toolExecResourceEmitter = new Emitter<XCodeToolExecResource>();
  const mcpResourceSamplesEmitter = new Emitter<XCodeMcpResourceSample[]>();
  const mcpTelemetryEmitter = new Emitter<XCodeMcpTelemetryEvent>();
  const pluginOperationProgressEmitters = new Map<
    string,
    Emitter<XCodePluginOperationProgressNotification>
  >();
  // v4 conversation 帧 fan-out：workspace 级 emitter，renderer 侧按 topic 自行路由。
  const sessionLifecycleEmitter = new Emitter<{
    workspaceKey: string;
    snapshot: SessionLifecycleSnapshot;
  }>();
  const conversationFrameEmitters = new Map<string, Emitter<ConversationTopicWireCandidate>>();
  const localTtftFactsEmitter = new Emitter<{ workspaceKey: string; facts: LocalTtftFacts }>();
  const conversationTelemetryFactEmitters = new Map<string, Emitter<ConversationTelemetryFact>>();
  const contextComposition = createContextCompositionClient({
    getExistingClient: (target) => getReadOnlyClient(target, "existing-only"),
    isRuntimeUnavailableError: (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === XCODE_AGENT_RUNTIME_UNAVAILABLE_CODE,
    resolveWorkspaceKey,
    logger,
  });
  // 插件宿主查询：user 层设置走插件管理面进程；`@` 候选项走持有会话的工作区 CLI（existing-only）。
  const pluginHostQueries = createPluginHostQueriesClient({
    getPluginManagementClient: () => getPluginManagementClient(),
    getExistingClient: (target) => getReadOnlyClient(target, "existing-only"),
  });
  const remoteConversationTelemetryEmitter = new Emitter<RemoteConversationTelemetryEvent>();
  const remoteConversationTelemetry = new Map<string, RemoteConversationTelemetry>();
  function collectRemoteConversationFact(
    workspace: XCodeAgentWorkspaceTarget,
    fact: ConversationTelemetryFact,
  ): boolean {
    const key = resolveWorkspaceKey(workspace);
    let collector = remoteConversationTelemetry.get(key);
    if (!collector) {
      collector = new RemoteConversationTelemetry({
        workspaceScopeKey: `${v4ConnectionId}\0${key}`,
        workspaceTelemetryDetail: resolveWorkspaceTelemetryDetail(workspace),
        report: async (event) =>
          remoteConversationTelemetryEmitter.fire(
            remoteConversationTelemetryEventSchema.parse(event),
          ),
      });
      remoteConversationTelemetry.set(key, collector);
    }
    return collector.acceptFact(fact);
  }

  const offPeakLifecycleEmitters = new Map<string, Emitter<OffPeakLifecycleNotification>>();
  const pluginUiToolResultEmitter = new Emitter<
    PluginUiToolResultNotification & XCodeAgentWorkspaceTarget
  >();
  const cuaPermissionObservationEmitter = new Emitter<XCodeAgentCuaPermissionObservation>();
  // sessions-index 帧 fan-out：与 conversation 同一 conversationFrame 通知，按 topic 前缀分流到此 emitter。
  const sessionsIndexFrameEmitters = new Map<string, Emitter<SessionsIndexTopicWireCandidate>>();
  // workspace-config 帧 fan-out：配置目录活性（task-index syncer 消费），同一通知按前缀分流。
  const workspaceConfigFrameEmitters = new Map<
    string,
    Emitter<WorkspaceConfigTopicWireCandidate>
  >();
  // v4 订阅替换按 (connectionId, topic) 判定；每个 host process 服务一个
  // renderer 窗口，一个稳定 connectionId 即可让重订阅天然替换旧订阅。
  const v4ConnectionId = `host-${randomUUID()}`;
  interface V4SubscriptionRoute {
    workspaceKey: string;
    topic: string;
    subscriptionId: string;
    connectionId: string;
  }
  const v4SubscriptionRoutes = new Map<string, V4SubscriptionRoute>();
  const v4RouteKeyByOwnership = new Map<string, string>();
  const v4RouteRuntimeRestartDisposable = processManager.onRuntimeRestarted(({ workspaceKey }) => {
    clearV4SubscriptionRoutes(workspaceKey);
    cuaOperationTurnTracker?.clearWorkspaceKey(workspaceKey);
  });
  const sessionEventSequenceStates = new Map<string, SessionEventSequenceState>();
  const wiredClients = new WeakSet<XCodeProtocolClient>();
  const clientWorkspaces = new WeakMap<
    XCodeProtocolClient,
    Map<string, XCodeAgentWorkspaceTarget>
  >();
  const clientSessions = new WeakMap<XCodeProtocolClient, Map<string, string>>();

  function rememberClientTarget(
    client: XCodeProtocolClient,
    target: XCodeAgentWorkspaceTarget,
    sessionId?: string,
  ): void {
    let workspaces = clientWorkspaces.get(client);
    if (!workspaces) clientWorkspaces.set(client, (workspaces = new Map()));
    const key = resolveWorkspaceKey(target);
    // 运行归属只保存地址，避免长寿命共享连接保留首发 envelope 与完整消息内容。
    workspaces.set(key, {
      workspacePath: target.workspacePath,
      ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
      ...(target.remoteSessionId ? { remoteSessionId: target.remoteSessionId } : {}),
    });
    const request = target as XCodeAgentWorkspaceTarget & {
      sessionId?: string;
      envelope?: { sessionId?: string | null };
    };
    const id = sessionId ?? request.sessionId ?? request.envelope?.sessionId;
    if (!id) return;
    let sessions = clientSessions.get(client);
    if (!sessions) clientSessions.set(client, (sessions = new Map()));
    const previous = sessions.get(id);
    if (previous && previous !== key)
      throw new Error("Session workspace does not match its runtime owner");
    sessions.set(id, key);
  }

  function routeClientMessage(
    client: XCodeProtocolClient,
    value: unknown,
  ): XCodeAgentWorkspaceTarget | undefined {
    const workspaces = clientWorkspaces.get(client);
    if (!workspaces) return undefined;
    const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    let key: string | undefined;
    if (data.workspace && typeof data.workspace === "object") {
      const ref = data.workspace as {
        workspaceKey?: unknown;
        workspacePath?: unknown;
        workspaceIdentity?: unknown;
      };
      // Bug 根因：worktree 任务的 ref 中 workspacePath 是会话 cwd（worktree），workspaceKey 才是
      // 所属 workspace（项目，docs/git/worktree.md §1.1）。按 identity || path 重新计算会得到
      // worktree 路径，把项目 CLI 的反向请求误拒为"不属于本 CLI"。ref 自带的 workspaceKey 是唯一身份。
      if (typeof ref.workspaceKey === "string" && ref.workspaceKey.trim()) key = ref.workspaceKey;
      else if (typeof ref.workspacePath === "string")
        key =
          (typeof ref.workspaceIdentity === "string" && ref.workspaceIdentity.trim()) ||
          ref.workspacePath;
    }
    if (!key && typeof data.workspacePath === "string") {
      key =
        (typeof data.workspaceIdentity === "string" && data.workspaceIdentity.trim()) ||
        data.workspacePath;
    }
    if (typeof data.topic === "string")
      key ??=
        parseSessionsIndexTopic(data.topic) ?? parseWorkspaceConfigTopic(data.topic) ?? undefined;
    const sessionId =
      typeof data.sessionId === "string"
        ? data.sessionId
        : typeof data.taskId === "string"
          ? data.taskId
          : typeof data.targetTaskId === "string"
            ? data.targetTaskId
            : typeof data.boundSessionId === "string"
              ? data.boundSessionId
              : typeof data.topic === "string"
                ? (parseConversationTopic(data.topic) ?? undefined)
                : undefined;
    const sessionWorkspaceKey = sessionId ? clientSessions.get(client)?.get(sessionId) : undefined;
    if (key && sessionWorkspaceKey && key !== sessionWorkspaceKey) return undefined;
    key ??= sessionWorkspaceKey;
    if (!key && typeof data.directorySessionId === "string")
      key = clientSessions.get(client)?.get(data.directorySessionId);
    // 单工作区兼容旧 CLI；共享连接有明确归属却无法解析时，禁止借用首次连接目录。
    if (!key && workspaces.size === 1) key = workspaces.keys().next().value;
    if (!key) return undefined;
    const target = workspaces.get(key);
    if (!target) return undefined;
    const current = activeClientsByWorkspaceKey.get(key);
    if (current && current.client !== client) return undefined;
    const workspace = current?.workspace ?? target;
    if (sessionId) rememberClientTarget(client, workspace, sessionId);
    return workspace;
  }

  const clientDisposables = new WeakMap<XCodeProtocolClient, IDisposable[]>();
  const pendingPermissions = new Map<string, PendingPermissionRequest>();
  const pendingUserInputs = new Map<string, PendingPermissionRequest>();
  // 内存诊断计数器：只读各 per-session 镜像表的 size。
  const memoryDiagnostics = registerMemoryDiagnosticsProvider("agent", () => ({
    sessionEmitters: sessionEmitters.size,
    seqStates: sessionEventSequenceStates.size,
    pendingPermissions: pendingPermissions.size,
    pendingUserInputs: pendingUserInputs.size,
  }));
  const pendingProviderRuntimeHeaders = new Map<string, PendingProviderRuntimeHeadersRequest>();
  const pendingSessionRuntimePreferences = new Map<
    string,
    PendingSessionRuntimePreferencesRequest
  >();
  const activeClientsByWorkspaceKey = new Map<string, ActiveWorkspaceClient>();
  const interactionPreferenceSyncByClient = new WeakMap<XCodeProtocolClient, Promise<void>>();
  let latestAppRuntimePreferences: XCodeAgentAppRuntimePreferences | undefined;
  /** 服务端「提供」的进程内单次读取；见 resolveDynamicWorkflowGate 的注释。 */
  let dynamicWorkflowOffer: Promise<DynamicWorkflowClientConfig | undefined> | undefined;
  /** desktop 推来的用户选择；只在没有本机设置权威（未注入 resolveDynamicWorkflowUserMode）时使用。 */
  let pushedDynamicWorkflowUserMode: DynamicWorkflowMode | undefined;
  /** 每个物理 CLI 的策略同步链：后入队的步骤在前一步落地后才读取生效模式并发送。 */
  const dynamicWorkflowPolicySyncByClient = new WeakMap<XCodeProtocolClient, Promise<void>>();
  const waitingWorkspaceStartups = new Map<string, WaitingWorkspaceStartup>();
  /** 在 runtime/capabilities 中声明 worktreeCwd 的 CLI 连接（docs/git/worktree.md §9.3）。 */
  const worktreeCwdClients = new WeakSet<XCodeProtocolClient>();
  /**
   * 在 runtime/capabilities 中声明 extensionInputSource 的 CLI 连接
   * （apps/zcode-cli/docs/design/v2/conversation-input-source.md §7）。
   */
  const extensionInputSourceClients = new WeakSet<XCodeProtocolClient>();
  /** 在 runtime/capabilities 中声明 conversationQuoteComment 的 CLI 连接（选区批注）。 */
  const conversationQuoteCommentClients = new WeakSet<XCodeProtocolClient>();
  function cancelWaitingWorkspaceStartup(workspaceKey: string): void {
    const waiting = waitingWorkspaceStartups.get(workspaceKey);
    if (waiting) {
      waiting.cancelled = true;
      waitingWorkspaceStartups.delete(workspaceKey);
    }
  }
  function cancelAllWaitingWorkspaceStartups(): void {
    for (const waiting of waitingWorkspaceStartups.values()) {
      waiting.cancelled = true;
    }
    waitingWorkspaceStartups.clear();
  }
  const accountConfigSyncByClient = new WeakMap<XCodeProtocolClient, Promise<void>>();
  // 此缓存只去重已交付的账号快照，不表示 Worker 的 Registry 已应用该版本。
  const accountConfigReceivedRevisionByClient = new WeakMap<XCodeProtocolClient, string>();
  const sessionTraceIdBySessionKey = new Map<string, TraceId>();
  const accountRequestAuthService = options?.accountRequestAuthService;
  const accountRotationService = options?.accountRotationService;
  const accountProviderConfigSource = options?.accountProviderConfigSource;
  const modelSelectionReadinessSource = options?.modelSelectionReadinessSource;
  const sessionRuntimePreferencesAuthority = options?.sessionRuntimePreferencesAuthority ?? "local";
  const resolveSessionRuntimePreferences = options?.resolveSessionRuntimePreferences;

  function invalidateWorkspaceClient(workspaceKey: string, client: XCodeProtocolClient): void {
    for (const [key, pending] of pendingPermissions) {
      if (pending.client === client) {
        pendingPermissions.delete(key);
      }
    }
    for (const [key, pending] of pendingUserInputs) {
      if (pending.client === client) {
        pendingUserInputs.delete(key);
      }
    }
    for (const [key, pending] of pendingProviderRuntimeHeaders) {
      if (pending.client === client) {
        cancelProviderRuntimeHeaders(key, pending);
      }
    }
    for (const [key, pending] of pendingSessionRuntimePreferences) {
      if (pending.client === client) {
        clearTimeout(pending.timeout);
        pendingSessionRuntimePreferences.delete(key);
      }
    }
    for (const disposable of clientDisposables.get(client) ?? []) {
      disposable.dispose();
    }
    clientDisposables.delete(client);

    const active = activeClientsByWorkspaceKey.get(workspaceKey);
    if (active?.client !== client) {
      // Runtime lifecycle 事件可能与下一代启动交错；旧 client 的迟到清理只能释放
      // 自身绑定，绝不能删除同 workspace 已登记的新 client 与新 runtime 状态。
      return;
    }
    activeClientsByWorkspaceKey.delete(workspaceKey);
    // Interaction preference 是 CLI 进程内存态；runtime 换代后即使 app revision
    // 未变化也必须重新同步，不能沿用旧 client 的完成 Promise。
  }

  const runtimeLifecycleDisposable = processManager.onRuntimeLifecycle((event) => {
    if (event.state !== "unavailable") return;
    // 协议关闭、进程崩溃或请求超时时，runtime 可能不会再发送 turn-failed/
    // session-closed，也不一定能成功启动下一代 runtime。必须在 unavailable 这个权威
    // 生命周期边界清掉 CUA tracker，否则 Windows 顶部提示和 Helper 恢复门控会永久残留。
    cuaOperationTurnTracker?.clearWorkspaceKey(event.workspaceKey);
    const active = activeClientsByWorkspaceKey.get(event.workspaceKey);
    if (!active) return;
    // Process manager 只会为当前 available runtime 发布 unavailable；这里再绑定当前
    // active client 做第二层 identity guard，避免旧 runtime 的迟到回收误伤换代结果。
    invalidateWorkspaceClient(event.workspaceKey, active.client);
  });

  /**
   * XCode fork：zai / bigmodel（Coding Plan 账号族）的轮询选号。
   *
   * 只有**允许换号**的语境才选：
   * - 带 `expectedAccountScope` 的是 PAT 刷新重试，必须留在同一账号，换号会串身份；
   * - 带 `rejectedProjectTokenFingerprint` 的是项目 Token 被拒后的换证，同样不能换号；
   * - `reason=usage` 是配额查询，换号会读到别的账号的额度并白推轮询游标；
   * - `team-coding-plan` 的材料按组织/项目解析，与账号身份无关，不参与轮询。
   *
   * 命中时返回 accountRef（`${family}:${identity}`，与账号管理页同一套 id），由
   * accountRequestAuthService 用该账号自己的 OAuth 凭据与身份解析材料。选不出账号时返回
   * undefined，回落「当前激活账号」，即改造前行为。
   *
   * adapter 的账号级重试会把已失败的连接放进 `excludedConnectionIds` 再来一次，因此这里的
   * 第一次尝试选中的一定是当前激活账号（fill-first/round-robin 都把 active 排在最前），
   * 换号只发生在真的失败之后。
   */
  async function resolveRotatedAccountRef(
    request: XCodeProviderRuntimeHeadersRequestParams,
  ): Promise<
    { accountRef: string; accountFailover: { enabled: boolean; statusCodes: number[]; providerCodes?: string[] } } | undefined
  > {
    const access = request.accountAccess;
    const rotation = accountRotationService;
    if (!access || !rotation) return undefined;
    if (request.expectedAccountScope !== undefined) return undefined;
    if (request.rejectedProjectTokenFingerprint !== undefined) return undefined;
    // reason 在这条路径上只可能是 "model-request"（协议层枚举就这一个值）：配额查询走的是
    // 宿主的独立查询接口，不经过这里，所以不需要额外的 reason 判定。
    if (access.mode !== "start-plan" && access.mode !== "individual-coding-plan") return undefined;
    try {
      const selection = await rotation.select({
        providerId: request.providerId,
        modelId: request.modelSelection.modelId,
        ...(request.excludedConnectionIds && request.excludedConnectionIds.length > 0
          ? { excludedConnectionIds: request.excludedConnectionIds }
          : {}),
        ...(request.lastFailure ? { lastFailure: request.lastFailure } : {}),
      });
      // 账号族这条路径交给 adapter 的只有 accountRef，不像 api-key 型供应商能带整个
      // selection，所以换号策略必须在这里一起取出并显式透传。
      if (selection && request.lastFailure && !selection.active) {
        // 失败换号重选到了非激活账号：把「当前登录态」也跟随切过去，否则激活指针
        // 仍停在刚失败的账号上（fill-first 永远先试它），UI 显示的当前账号也不对。
        try {
          await options?.followRotatedAccount?.(selection.connectionId);
        } catch (error) {
          // 跟随切换失败不影响本次请求——本次已用新账号的材料出码。
          logger.warn(undefined, "换号后跟随激活账号失败", {
            providerId: request.providerId,
            accountRef: selection.connectionId,
            error,
          });
        }
      }
      return selection
        ? { accountRef: selection.connectionId, accountFailover: selection.failover }
        : undefined;
    } catch (error) {
      // 账号族轮的只是「换哪个账号」，与 Qoder 那类「没账号就没法鉴权」不同：选号失败时
      // 当前激活账号仍可正常出码，因此这里降级而不是把请求打死。
      logger.warn(undefined, "账号轮询选号失败，回落当前激活账号", {
        providerId: request.providerId,
        error,
      });
      return undefined;
    }
  }

  async function resolveAccountRequestAuth(
    request: XCodeProviderRuntimeHeadersRequestParams,
  ): Promise<AccountRequestAuthMaterial | undefined> {
    if (request.accountAccess) {
      if (!accountRequestAuthService) {
        return undefined;
      }
      const rotated = await resolveRotatedAccountRef(request);
      const material = await accountRequestAuthService.resolveCurrent({
        providerId: request.providerId,
        modelId: request.modelSelection.modelId,
        accountAccess: request.accountAccess,
        expectedAccountScope: request.expectedAccountScope,
        rejectedProjectTokenFingerprint: request.rejectedProjectTokenFingerprint,
        reason: request.reason,
        ...(rotated
          ? { accountRef: rotated.accountRef, accountFailover: rotated.accountFailover }
          : {}),
      });
      // 账号族路径同样要记账账号与出口代理。
      const egress = await resolveConnectionEgress(
        options?.resolveProxyPoolService?.(),
        request.providerId,
        rotated?.accountRef,
      );
      return { ...material, ...egress };
    }
    // XCode fork：Qoder / CodeBuddy 是 api-key 型多账号供应商，没有 accountAccess。
    // 由轮询服务选择本次使用的连接；不支持轮询的供应商返回 undefined。
    if (!accountRotationService) {
      return undefined;
    }
    const selection = await accountRotationService.select({
      providerId: request.providerId,
      modelId: request.modelSelection.modelId,
      ...(request.excludedConnectionIds && request.excludedConnectionIds.length > 0
        ? { excludedConnectionIds: request.excludedConnectionIds }
        : {}),
      ...(request.lastFailure ? { lastFailure: request.lastFailure } : {}),
    });
    if (!selection) {
      // 供应商支持轮询但当前选不出账号（例如账号列表尚未加载 / 全部被排除）：
      // 返回空材料而不是 undefined——adapter 会保留 provider config 里的静态鉴权，
      // 与改造前行为一致；undefined 会被协议层当作「刷新失败」，把可用的请求打死。
      // 无账号概念的免费供应商（Kilo Free 等）也走这里：出口代理仍要能记账。
      const egress = await resolveConnectionEgress(
        options?.resolveProxyPoolService?.(),
        request.providerId,
        undefined,
      );
      return { ...egress };
    }
    const egress = await resolveConnectionEgress(
      options?.resolveProxyPoolService?.(),
      request.providerId,
      selection.connectionId,
    );
    return {
      apiKey: selection.accessToken,
      connectionId: selection.connectionId,
      ...(selection.displayName ? { accountDisplayName: selection.displayName } : {}),
      ...egress,
      accountFailover: selection.failover,
      ...(selection.requestProfile === "qoder"
        ? {
            headers: {
              // Qoder 的内部身份头必须与 apiKey（accessToken）同源；否则 COSY 签名
              // 用的 userId/machineId 会停留在旧账号上。发往上游前会被 adapter 剥掉。
              "X-Qoder-Internal-User-Id": selection.connectionId,
              ...(selection.machineId
                ? { "X-Qoder-Internal-Machine-Id": selection.machineId }
                : {}),
            },
          }
        : {}),
    };
  }

  async function respondAccountRequestAuthWithoutInteraction(params: {
    key: string;
    pending: PendingProviderRuntimeHeadersRequest;
  }): Promise<void> {
    params.pending.responding = true;
    try {
      const requestAuth = await resolveAccountRequestAuth(params.pending.request);
      // 账号解析是异步 IO；取消/进程退出后不能把迟到材料发给已撤销的请求。
      if (pendingProviderRuntimeHeaders.get(params.key) !== params.pending) return;
      if (!requestAuth) {
        throw new Error("Account request auth resolver returned no material");
      }
      await params.pending.client.respond(params.pending.protocolRequestId, {
        headersApplied: true,
        requestAuth,
      });
      logger.info(undefined, "XCode provider runtime headers 已应用", {
        modelId: params.pending.request.modelSelection.modelId,
        providerId: params.pending.request.providerId,
        requestId: params.pending.request.requestId,
        sessionId: params.pending.request.sessionId,
        workspaceKey: resolveWorkspaceKey(params.pending.request.workspace),
      });
    } catch (error) {
      if (pendingProviderRuntimeHeaders.get(params.key) !== params.pending) return;
      logger.warn(undefined, "XCode provider runtime headers 应用失败", {
        modelId: params.pending.request.modelSelection.modelId,
        providerId: params.pending.request.providerId,
        requestId: params.pending.request.requestId,
        sessionId: params.pending.request.sessionId,
        error: error instanceof Error ? error.message : String(error),
        workspaceKey: resolveWorkspaceKey(params.pending.request.workspace),
      });
      await params.pending.client.respond(params.pending.protocolRequestId, {
        headersApplied: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (pendingProviderRuntimeHeaders.get(params.key) === params.pending) {
        pendingProviderRuntimeHeaders.delete(params.key);
      }
    }
  }

  async function routeProviderRuntimeHeadersRequest(
    key: string,
    pending: PendingProviderRuntimeHeadersRequest,
    workspace: XCodeAgentWorkspaceTarget,
  ): Promise<void> {
    let configFailureCode:
      | (typeof zcodeProviderRuntimeHeadersErrorCode)[keyof typeof zcodeProviderRuntimeHeadersErrorCode]
      | undefined;
    try {
      const access = pending.request.accountAccess;
      if (requiresRequestVerification(access)) {
        let config: RequestVerificationConfig | null;
        try {
          config = (await options?.readRequestVerificationConfig?.()) ?? null;
        } catch (error) {
          // 根因：底层 fetch/远端错误正文不能进入 Agent 与界面可见的 errorMessage。
          // 稳定文案让 Agent 仍能区分“读取失败”和“凭据缺失”，原始异常只随 cause 进 Host 日志。
          configFailureCode = isTemporaryVerificationConfigFailure(error)
            ? zcodeProviderRuntimeHeadersErrorCode.configNetwork
            : zcodeProviderRuntimeHeadersErrorCode.configInvalid;
          throw new Error(
            configFailureCode === zcodeProviderRuntimeHeadersErrorCode.configNetwork
              ? "Request verification configuration read failed"
              : "Request verification configuration is invalid",
            { cause: error },
          );
        }
        if (pendingProviderRuntimeHeaders.get(key) !== pending) return;
        if (!config) {
          configFailureCode = zcodeProviderRuntimeHeadersErrorCode.configInvalid;
          throw new Error("Request verification configuration is invalid");
        }
        // 根因：关闭开关原来由 Renderer 判定，后台界面延迟也会耗尽鉴权 RPC 时限。
        // Host 绑定同一快照后再决定是否投递；跳过时直接复用账号鉴权，不等待界面。
        pending.request = { ...pending.request, requestVerificationConfig: config };
      }
      // 账号轮询（Qoder / CodeBuddy）没有 accountAccess，但同样必须由 Host 自动应答：
      // 它们的材料来自 host 的账号列表，不是 renderer 的请求校验交互。漏掉这一条会让
      // 每次模型请求都去等一个 UI 订阅者，无 pane 的后台任务直接超时。
      const accountRotationEligible = !access && accountRotationService !== undefined;
      if (
        accountRotationEligible ||
        (accountRequestAuthService &&
          access &&
          !requiresRequestVerification(access, pending.request.requestVerificationConfig))
      ) {
        await respondAccountRequestAuthWithoutInteraction({ key, pending });
        return;
      }
      if (!requestVerificationInteractionAvailable)
        throw new Error("Provider request auth is unavailable");
      // 只在决策完成后开放补投；配置 IO 期间的晚订阅不能抢先启动界面验证。
      pending.interactionRequired = true;
      emitSessionEvent(workspace, pending.request.sessionId, {
        type: "providerRuntimeHeaders.request",
        request: pending.request,
      });
      // session listener 可能同步应答或取消，不能再向 workspace 投递已撤销的请求。
      if (pendingProviderRuntimeHeaders.get(key) !== pending || pending.responding) return;
      providerRuntimeHeadersWorkspaceEmitters
        .get(resolveWorkspaceKey(workspace))
        ?.fire(pending.request);
    } catch (error) {
      if (pendingProviderRuntimeHeaders.get(key) !== pending) return;
      pendingProviderRuntimeHeaders.delete(key);
      const errorMessage = error instanceof Error ? error.message : String(error);
      // 配置读取异常的原文来自底层 HTTP 层，可能带 URL、query、token 或响应正文；
      // 日志落盘且会被采集，只保留可安全归类的字段，用户可见 errorMessage 用稳定文案。
      const cause = error instanceof Error ? error.cause : undefined;
      const loggedError =
        cause === undefined ? errorMessage : describeVerificationConfigError(cause);
      logger.warn(undefined, "XCode provider runtime headers 应用失败", {
        modelId: pending.request.modelSelection.modelId,
        providerId: pending.request.providerId,
        requestId: pending.request.requestId,
        sessionId: pending.request.sessionId,
        error: loggedError,
        workspaceKey: resolveWorkspaceKey(pending.request.workspace),
      });
      if (configFailureCode === zcodeProviderRuntimeHeadersErrorCode.configNetwork) {
        await pending.client.respondError(pending.protocolRequestId, {
          code: XCODE_PROVIDER_CONFIG_NETWORK_ERROR,
          message: errorMessage,
        });
        return;
      }
      await pending.client.respond(pending.protocolRequestId, {
        headersApplied: false,
        errorMessage,
      });
    }
  }

  function takePendingSessionRuntimePreferences(
    requestId: string,
  ): PendingSessionRuntimePreferencesRequest | undefined {
    const pending = pendingSessionRuntimePreferences.get(requestId);
    if (!pending) {
      return undefined;
    }
    pendingSessionRuntimePreferences.delete(requestId);
    clearTimeout(pending.timeout);
    return pending;
  }

  function expireSessionRuntimePreferencesRequest(requestId: string): void {
    const pending = takePendingSessionRuntimePreferences(requestId);
    if (!pending) {
      return;
    }
    // 远端 Host transport 仍存活但设置 responder 不返回时，旧 pending
    // 没有终止条件，会阻塞 Session 生命周期。超时只结束本次请求，不重试或降级。
    logger.warn(undefined, "运行时偏好请求等待 Host 响应超时", {
      event: "zcode_agent.runtime_preferences.host_response_timeout",
      module: "services.zcode_agent",
      requestId,
      scope: pending.request.scope,
      sessionId: pending.request.sessionId,
      timeoutMs: XCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
      workspaceKey: pending.workspaceKey,
    });
    void pending.client
      .respondError(pending.protocolRequestId, {
        code: -32022,
        message: "Session runtime preferences request timed out",
        data: {
          timeoutMs: XCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
        },
      })
      .catch((error: unknown) => {
        logger.debug(undefined, "运行时偏好超时响应发送失败", {
          error: error instanceof Error ? error.message : String(error),
          requestId,
          scope: pending.request.scope,
          sessionId: pending.request.sessionId,
        });
      });
  }

  let modelSelectionSubscription = modelSelectionReadinessSource?.onDidChange?.((view) => {
    void handleProviderReadinessChanged({
      reason: "model_selection_changed",
      snapshot: createProviderReadinessSnapshotFromSelectionView(view),
    }).catch((error) => {
      logger.warn(undefined, "model selection readiness 热同步失败", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
  let accountProviderConfigUnsubscribe = accountProviderConfigSource?.onDidChange((reason) => {
    void handleAccountProviderConfigChanged(reason).catch((error) => {
      logger.warn(undefined, "account provider config 热同步失败", {
        message: error instanceof Error ? error.message : String(error),
        reason,
      });
    });
  });

  async function syncAccountProviderConfigToClient(params: {
    client: XCodeProtocolClient;
    reason: string;
    refreshRegistry?: boolean;
  }): Promise<void> {
    if (!accountProviderConfigSource) return;
    const previous = accountConfigSyncByClient.get(params.client) ?? Promise.resolve();
    const current = previous
      .catch(() => {
        // 前一次失败不能阻断后续较新的 Account Config；当前调用会重新尝试。
      })
      .then(async () => {
        // 排队前异步读取可能晚返回，把旧结果排在新结果之后。读取与交付
        // 共用现有 Client 串行队列；不新增发送屏障，也不按内容 revision 猜测时间先后。
        const snapshot = await accountProviderConfigSource.read();
        if (accountConfigReceivedRevisionByClient.get(params.client) !== snapshot.revision) {
          const result = await params.client.request(
            zcodeProtocolMethods.providerUpdateAccountConfig,
            {
              revision: snapshot.revision,
              basedOnXCodeBuiltinRevision: snapshot.basedOnXCodeBuiltinRevision,
              // Account 是运行时事实信封，不是磁盘 Provider 规则集合；保持原有协议字典。
              providers: Object.fromEntries(
                [...snapshot.providers.entries()].map(([providerId, config]) => [
                  providerId,
                  config.toJSON(),
                ]),
              ),
              states: snapshot.states ?? {},
            },
            zcodeProviderUpdateAccountConfigResultSchema,
          );
          if (result.receivedRevision !== snapshot.revision) {
            throw new Error("Account Config 接收回执版本与交付版本不一致");
          }
          accountConfigReceivedRevisionByClient.set(params.client, result.receivedRevision);
          logger.info(undefined, "account provider config 已交付到 XCode agent", {
            providerCount: result.providerCount,
            reason: params.reason,
            receivedRevision: result.receivedRevision,
            status: result.status,
          });
        }
        if (params.refreshRegistry) {
          await params.client.request(
            zcodeProtocolMethods.providerRefreshRegistry,
            { reason: params.reason },
            zcodeProviderRefreshRegistryResultSchema,
          );
        }
      });
    accountConfigSyncByClient.set(params.client, current);
    try {
      await current;
    } finally {
      if (accountConfigSyncByClient.get(params.client) === current) {
        accountConfigSyncByClient.delete(params.client);
      }
    }
  }

  async function ensureAccountProviderConfigSynced(params: {
    client: XCodeProtocolClient;
    reason: string;
    workspace: XCodeAgentWorkspaceTarget;
    refreshRegistry?: boolean;
  }): Promise<void> {
    await syncAccountProviderConfigToClient({
      client: params.client,
      reason: params.reason,
      refreshRegistry: params.refreshRegistry,
    });
  }

  async function handleAccountProviderConfigChanged(reason: string): Promise<void> {
    await Promise.all(
      Array.from(activeClientsByWorkspaceKey.values()).map(async (active) => {
        await syncAccountProviderConfigToClient({
          client: active.client,
          reason,
        });
      }),
    );
  }

  function enqueueInteractionPreferenceSync(params: {
    client: XCodeProtocolClient;
    preferences: XCodeAgentAppRuntimePreferences;
    workspace: XCodeAgentWorkspaceTarget;
  }): Promise<void> {
    // 同一物理连接上的全局偏好必须串行，防止旧工作区快照覆盖新设置。
    const previous = interactionPreferenceSyncByClient.get(params.client) ?? Promise.resolve();
    const current = previous
      .catch(() => {
        // 前一次失败不能打乱之后开关提交的顺序；当前快照仍需继续尝试。
      })
      .then(async () => {
        await params.client.request(
          zcodeProtocolMethods.workspaceUpdateInteractionPreferences,
          {
            workspace: buildWorkspaceRef(params.workspace),
            preferences: {
              askUserQuestionAutoResolutionEnabled:
                params.preferences.askUserQuestionAutoResolutionEnabled,
            },
          },
          zcodeWorkspaceUpdateInteractionPreferencesResultSchema,
        );
        try {
          await params.client.request(
            zcodeProtocolMethods.workspaceUpdateModelIoPreferences,
            {
              workspace: buildWorkspaceRef(params.workspace),
              preferences: {
                fullRetentionEnabled: params.preferences.modelIoFullRetentionEnabled === true,
              },
            },
            zcodeWorkspaceUpdateModelIoPreferencesResultSchema,
          );
        } catch (error) {
          // 新 Host 兼容尚未升级的 CLI：只有 method-not-found 可降级，其他同步失败仍需上抛。
          if (!isProtocolMethodNotFoundError(error)) throw error;
        }
      });
    interactionPreferenceSyncByClient.set(params.client, current);
    void current.then(
      () => {
        if (interactionPreferenceSyncByClient.get(params.client) === current) {
          interactionPreferenceSyncByClient.delete(params.client);
        }
      },
      () => {
        if (interactionPreferenceSyncByClient.get(params.client) === current) {
          interactionPreferenceSyncByClient.delete(params.client);
        }
      },
    );
    return current;
  }

  async function handleProviderReadinessChanged(event: {
    reason: string;
    snapshot: XCodeAgentProviderReadinessSnapshot;
  }): Promise<void> {
    if (event.snapshot.readiness.ready) {
      await Promise.allSettled(
        Array.from(waitingWorkspaceStartups.entries()).map(async ([workspaceKey, waiting]) => {
          // ready 事件可能赶在旧 readiness 读取返回前到达。先收口旧尝试，再读取新状态，
          // 避免事件复用一个即将以 provider-not-ready 失败的 Promise 而丢失唯一的 ready 通知。
          try {
            await waiting.starting;
          } catch (error) {
            if (!isProviderNotReadyError(error)) throw error;
          }
          // Bug 根因：provider-ready 事件会先快照 waiting 列表再异步启动；workspace 在
          // await 期间被移除后，旧快照仍会把已释放的 Agent 重新拉起。只允许当前
          // waiting identity 对应的 generation 继续，删除或换代后的回调必须失效。
          if (waiting.cancelled || waitingWorkspaceStartups.get(workspaceKey) !== waiting) {
            return;
          }
          const { workspace } = waiting;
          const client = await getClient(workspace);
          await ensureAccountProviderConfigSynced({
            client,
            reason: `startup_ready:${event.reason}`,
            workspace,
            refreshRegistry: true,
          });
          logger.info(undefined, "provider/model 就绪后已启动等待中的 XCode agent", {
            providerCount: event.snapshot.providerCount,
            reason: event.reason,
            revision: event.snapshot.revision,
            workspaceKey: resolveWorkspaceKey(workspace),
            workspacePath: workspace.workspacePath,
          });
        }),
      );
    }
  }

  function getSessionEmitter(params: XCodeAgentSessionTarget) {
    const key = sessionEventKey(params);
    const existing = sessionEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<XCodeAgentServiceEvent>();
    sessionEmitters.set(key, created);
    return created;
  }

  function getPluginOperationProgressEmitter(operationId: string) {
    const existing = pluginOperationProgressEmitters.get(operationId);
    if (existing) return existing;
    let created: Emitter<XCodePluginOperationProgressNotification>;
    created = new Emitter({
      onDidRemoveLastListener: () => {
        if (pluginOperationProgressEmitters.get(operationId) !== created) return;
        pluginOperationProgressEmitters.delete(operationId);
        created.dispose();
      },
    });
    pluginOperationProgressEmitters.set(operationId, created);
    return created;
  }

  function getConversationFrameEmitter(workspace: XCodeAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = conversationFrameEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<ConversationTopicWireCandidate>();
    conversationFrameEmitters.set(key, created);
    return created;
  }

  function getProviderRuntimeHeadersWorkspaceEmitter(workspace: XCodeAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = providerRuntimeHeadersWorkspaceEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<ZCodeAgentProviderRuntimeHeadersRequest>();
    providerRuntimeHeadersWorkspaceEmitters.set(key, created);
    return created;
  }

  function getConversationTelemetryFactEmitter(workspace: XCodeAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = conversationTelemetryFactEmitters.get(key);
    if (existing) return existing;
    const created = new Emitter<ConversationTelemetryFact>();
    conversationTelemetryFactEmitters.set(key, created);
    return created;
  }

  function getOffPeakLifecycleEmitter(workspace: XCodeAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    let emitter = offPeakLifecycleEmitters.get(key);
    if (!emitter) {
      emitter = new Emitter<OffPeakLifecycleNotification>();
      offPeakLifecycleEmitters.set(key, emitter);
    }
    return emitter;
  }

  function getSessionsIndexFrameEmitter(workspace: XCodeAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = sessionsIndexFrameEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<SessionsIndexTopicWireCandidate>();
    sessionsIndexFrameEmitters.set(key, created);
    return created;
  }

  function getWorkspaceConfigFrameEmitter(workspace: XCodeAgentWorkspaceTarget) {
    const key = resolveWorkspaceKey(workspace);
    const existing = workspaceConfigFrameEmitters.get(key);
    if (existing) {
      return existing;
    }
    const created = new Emitter<WorkspaceConfigTopicWireCandidate>();
    workspaceConfigFrameEmitters.set(key, created);
    return created;
  }

  /** v4 订阅 connectionId：同 host 进程内多个独立消费者（renderer/syncer）用 scope 后缀区分。 */
  function v4ConnectionIdFor(subscriberScope?: string): string {
    return subscriberScope ? `${v4ConnectionId}#${subscriberScope}` : v4ConnectionId;
  }

  function resolveV4Connection(
    params: unknown,
    fallbackConnectionId: string = v4ConnectionId,
  ): XCodeAgentV4ConnectionContext {
    return (
      readTrustedXCodeAgentV4Connection(params) ?? {
        // 没有可信 carrier 就是宿主内部直调：按旧消费者订阅（整键 patch），不猜能力。
        connectionId: fallbackConnectionId,
        clientMode: "desktop-continuous" as const,
      }
    );
  }

  function v4SubscriptionRouteKey(route: V4SubscriptionRoute): string {
    return `${route.workspaceKey}\0${route.topic}\0${route.subscriptionId}\0${route.connectionId}`;
  }

  function v4SubscriptionOwnershipKey(route: V4SubscriptionRoute): string {
    return `${route.workspaceKey}\0${route.topic}\0${route.connectionId}`;
  }

  function rememberV4SubscriptionRoute(
    workspace: XCodeAgentWorkspaceTarget,
    topic: string,
    subscriptionId: string,
    connectionId: string,
  ): void {
    const route: V4SubscriptionRoute = {
      workspaceKey: resolveWorkspaceKey(workspace),
      topic,
      subscriptionId,
      connectionId,
    };
    const ownershipKey = v4SubscriptionOwnershipKey(route);
    const previous = v4RouteKeyByOwnership.get(ownershipKey);
    if (previous) v4SubscriptionRoutes.delete(previous);
    const routeKey = v4SubscriptionRouteKey(route);
    v4RouteKeyByOwnership.set(ownershipKey, routeKey);
    v4SubscriptionRoutes.set(routeKey, route);
  }

  function forgetV4SubscriptionRoute(route: V4SubscriptionRoute): void {
    const routeKey = v4SubscriptionRouteKey(route);
    v4SubscriptionRoutes.delete(routeKey);
    const ownershipKey = v4SubscriptionOwnershipKey(route);
    if (v4RouteKeyByOwnership.get(ownershipKey) === routeKey) {
      v4RouteKeyByOwnership.delete(ownershipKey);
    }
  }

  function isCurrentV4SubscriptionRoute(route: V4SubscriptionRoute): boolean {
    return v4SubscriptionRoutes.get(v4SubscriptionRouteKey(route)) === route;
  }

  function clearV4SubscriptionRoutes(workspaceKey?: string): void {
    for (const route of v4SubscriptionRoutes.values()) {
      if (workspaceKey !== undefined && route.workspaceKey !== workspaceKey) {
        continue;
      }
      forgetV4SubscriptionRoute(route);
    }
  }

  function resolveV4UnsubscribeRoute(
    params: XCodeAgentConversationUnsubscribeParams | XCodeAgentConversationResyncParams,
    topicPrefix: string,
  ): V4SubscriptionRoute | null {
    const expectedWorkspaceKey = resolveWorkspaceKey(params);
    const trusted = readTrustedXCodeAgentV4UnsubscribeRoute(params);
    if (trusted) {
      if (!trusted.topic.startsWith(topicPrefix)) return null;
      const route: V4SubscriptionRoute = {
        workspaceKey: expectedWorkspaceKey,
        topic: trusted.topic,
        subscriptionId: params.subscriptionId,
        connectionId: trusted.connectionId,
      };
      return v4SubscriptionRoutes.get(v4SubscriptionRouteKey(route)) ?? null;
    }
    // base service 的内部直连消费者没有 facade carrier；只在 method topic 域内唯一
    // 命中时兼容，碰撞则拒绝猜测，更不能多 publisher 广播删除。
    const matches = [...v4SubscriptionRoutes.values()].filter(
      (route) =>
        route.workspaceKey === expectedWorkspaceKey &&
        route.subscriptionId === params.subscriptionId &&
        route.topic.startsWith(topicPrefix),
    );
    return matches.length === 1 ? matches[0]! : null;
  }

  async function unsubscribeV4Route(
    params: XCodeAgentConversationUnsubscribeParams,
    topicPrefix: string,
  ): Promise<void> {
    const route = resolveV4UnsubscribeRoute(params, topicPrefix);
    if (!route) return;
    const client = await getReadOnlyClient(params, params.runtimePolicy);
    // getReadOnlyClient 可能在 await 中拉起新 runtime；restart listener 已清旧 route，且新
    // runtime 可能复用相同 key/subId。必须以对象身份复核，不能拿局部旧 route 发给新 CLI。
    if (!isCurrentV4SubscriptionRoute(route)) return;
    await client.request(
      V4_METHODS.conversationUnsubscribe,
      {
        topic: route.topic,
        subscriptionId: route.subscriptionId,
        connectionId: route.connectionId,
      },
      zcodeProtocolEmptyResultSchema,
    );
    // request 在途时 runtime restart/重订阅可用相同 route key 建立新对象；
    // 迟到旧 response 只能清理它自己的 generation，不能按复合 key 删除新 route。
    if (isCurrentV4SubscriptionRoute(route)) forgetV4SubscriptionRoute(route);
  }

  async function resyncV4Route(params: XCodeAgentConversationResyncParams, topicPrefix: string) {
    const route = resolveV4UnsubscribeRoute(params, topicPrefix);
    if (!route) throw new Error("fault.subscription.notOwned");
    const client = await getReadOnlyClient(params, params.runtimePolicy);
    if (!isCurrentV4SubscriptionRoute(route)) {
      throw new Error("fault.subscription.notOwned");
    }
    const result = await client.request(
      V4_METHODS.conversationResync,
      {
        topic: route.topic,
        connectionId: route.connectionId,
        subscriptionId: route.subscriptionId,
        base: params.base,
        ...(params.forceSnapshot !== undefined ? { forceSnapshot: params.forceSnapshot } : {}),
      },
      v4ConversationResyncResultSchema,
    );
    // resync ACK 只对发起时的 route generation 有效。若 await 期间已 restart/重订阅，
    // 返回 stale success 会让 consumer 把旧 recovery 当作新 subscription 的恢复结果。
    if (!isCurrentV4SubscriptionRoute(route)) {
      throw new Error("fault.subscription.notOwned");
    }
    return result;
  }

  function emitSessionEvent(
    workspace: XCodeAgentWorkspaceTarget,
    sessionId: string,
    event: XCodeAgentServiceEvent,
  ): void {
    sessionEmitters.get(sessionEventKey({ ...workspace, sessionId }))?.fire(event);
  }

  function emitWorkspaceEvent(
    workspace: XCodeAgentWorkspaceTarget,
    event: XCodeAgentServiceEvent,
  ): void {
    const workspaceKey = resolveWorkspaceKey(workspace);
    for (const [key, emitter] of sessionEmitters) {
      if (key.startsWith(`${workspaceKey}\u0000`)) {
        emitter.fire(event);
      }
    }
  }

  function getSessionEventSequenceState(
    workspace: XCodeAgentWorkspaceTarget,
    sessionId: string,
  ): SessionEventSequenceState {
    const key = sessionEventKey({ ...workspace, sessionId });
    const existing = sessionEventSequenceStates.get(key);
    if (existing) {
      return existing;
    }
    const created: SessionEventSequenceState = {
      assignedSeqByEventId: new Map<string, number>(),
      assignedSeqEventIds: [],
      liveEventIds: new Set<string>(),
      liveEventIdOrder: [],
      lastAssignedSeq: 0,
    };
    sessionEventSequenceStates.set(key, created);
    return created;
  }

  function normalizeSessionEventSeq(
    workspace: XCodeAgentWorkspaceTarget,
    event: XCodeSessionEvent,
  ): XCodeSessionEvent {
    const state = getSessionEventSequenceState(workspace, event.sessionId);
    if (event.seq > 0) {
      state.lastAssignedSeq = Math.max(state.lastAssignedSeq, event.seq);
      return event;
    }

    const assignedSeq = state.assignedSeqByEventId.get(event.eventId);
    if (assignedSeq !== undefined) {
      return { ...event, seq: assignedSeq };
    }

    const nextSeq = state.lastAssignedSeq + 1;
    state.lastAssignedSeq = nextSeq;
    state.assignedSeqByEventId.set(event.eventId, nextSeq);
    state.assignedSeqEventIds.push(event.eventId);
    while (state.assignedSeqEventIds.length > MAX_TRACKED_SESSION_EVENT_IDS) {
      const removed = state.assignedSeqEventIds.shift();
      if (removed) {
        state.assignedSeqByEventId.delete(removed);
      }
    }
    // 旧 agent live sink 会把 createSessionEvent 默认 seq=0 直接发给 app，
    // 而 replay/read 走 event store 后才补号。这里只做旧版本兼容；新 runtime 的顺序事实源仍是 event store。
    return { ...event, seq: nextSeq };
  }

  function shouldDeliverLiveSessionEvent(
    workspace: XCodeAgentWorkspaceTarget,
    event: XCodeSessionEvent,
  ): boolean {
    const state = getSessionEventSequenceState(workspace, event.sessionId);
    return rememberBoundedEventId(state.liveEventIds, state.liveEventIdOrder, event.eventId);
  }

  function handleSessionEvent(
    workspace: XCodeAgentWorkspaceTarget,
    event: XCodeSessionEvent,
  ): void {
    const normalizedEvent = normalizeSessionEventSeq(workspace, event);
    if (!shouldDeliverLiveSessionEvent(workspace, normalizedEvent)) {
      return;
    }
    emitSessionEvent(workspace, normalizedEvent.sessionId, {
      type: "session.event",
      event: normalizedEvent,
    });
  }

  function handleStateUpdated(
    workspace: XCodeAgentWorkspaceTarget,
    notification: XCodeStateUpdatedNotification,
  ): void {
    if (notification.sessionId) {
      emitSessionEvent(workspace, notification.sessionId, {
        type: "state.updated",
        notification,
      });
      return;
    }
    emitWorkspaceEvent(workspace, { type: "state.updated", notification });
  }

  function wireClient(
    client: XCodeProtocolClient,
    initialWorkspace: XCodeAgentWorkspaceTarget,
    /**
     * 该 client 所属的进程泳道。CLI 进程不知道自己被哪个进程管理器拉起，
     * 因此资源样本的 lane 只能在这里按调用方补齐。
     */
    lane: ProcessResourceCliLane,
  ): void {
    rememberClientTarget(client, initialWorkspace);
    if (wiredClients.has(client)) {
      return;
    }
    wiredClients.add(client);
    const topicResources = new Map<string, ReturnType<typeof createTopicResourceBridge>>();
    const getTopicResources = (workspace: XCodeAgentWorkspaceTarget) => {
      const key = resolveWorkspaceKey(workspace);
      const existing = topicResources.get(key);
      if (existing) return existing;
      // 每个逻辑工作区独立取消域；物理连接只安装一组监听。
      const bridge = createTopicResourceBridge(() => {
        const active = activeClientsByWorkspaceKey.get(key);
        const resourceWorkspace = active?.client === client ? active.workspace : workspace;
        return {
          validate: (request, signal, trace) => {
            if (!options?.topicResourceValidator)
              throw new Error("Topic resource authorization is unavailable");
            return options.topicResourceValidator(
              { ...request, ...resourceWorkspace, trace },
              signal,
            );
          },
          read: (request, signal, trace) => {
            if (!options?.topicResourceExecutor)
              throw new Error("Topic attachment retrieval is unavailable on this host");
            return options.topicResourceExecutor(
              { ...request, ...resourceWorkspace, trace },
              signal,
            );
          },
          upload: (request, attachment, signal, trace) =>
            uploadTopicResourceToClient(
              client,
              v4ConnectionId,
              { ...resourceWorkspace, sessionId: request.taskId },
              attachment,
              signal,
              trace,
            ),
        };
      });
      topicResources.set(key, bridge);
      return bridge;
    };
    const appControlConnectionId = `app-control:${randomUUID()}`;
    const appControl = createAppControlReverseRpc({
      client,
      service: () => options?.resolveAppControlService?.(),
      onResponseError: (error) =>
        // 这条是唯一记录包装前原因的地方；debug 在生产构建里是 no-op，排查冷会话读取失败时
        // 完全看不到原因（2026-11-03 现场）。失败是可恢复的单次调用，用 warn 保留原因。
        logger.warn(undefined, "App control response failed", { error: String(error) }),
      bind: async ({ callerSessionId, callId, turnId, trace, signal }) => {
        // 共享 CLI 会承载多个 workspace，首次连接目录不再代表调用者。
        // 只按 Host 已登记的 session→workspace 归属路由，随后仍用持久会话事实复核。
        const callerWorkspace = routeClientMessage(client, { sessionId: callerSessionId });
        if (!callerWorkspace)
          throw new SessionControlError(
            "forbidden",
            "App caller workspace is not owned by this CLI",
          );
        const callerWorkspaceKey = resolveWorkspaceKey(callerWorkspace);
        const assertCurrent = () => {
          const active = activeClientsByWorkspaceKey.get(callerWorkspaceKey);
          if (active?.client !== client || client.isDisposed || signal.aborted)
            throw new SessionControlError("forbidden", "App caller connection is no longer active");
        };
        assertCurrent();
        const currentWorkspace = activeClientsByWorkspaceKey.get(callerWorkspaceKey)!.workspace;
        // callerSessionId 来自 CLI 工具运行上下文，但仍须由同一个实际连接的持久事实核对。
        // 不能信任模型参数或把未知 root 降级为当前路径中的任意会话。
        const { sessions } = await client.request(
          zcodeProtocolMethods.sessionList,
          { workspace: buildWorkspaceRef(currentWorkspace), sessionIds: [callerSessionId] },
          zcodeSessionListResultSchema,
        );
        const session = sessions.find((item) => item.sessionId === callerSessionId);
        if (
          !session ||
          isAuxiliarySessionKind(session.sessionKind) ||
          session.workspace.workspacePath !== currentWorkspace.workspacePath ||
          resolveWorkspaceKey(session.workspace) !== resolveWorkspaceKey(currentWorkspace)
        )
          throw new SessionControlError(
            "forbidden",
            "App caller is not a bound product root session",
          );
        assertCurrent();
        return {
          workspacePath: currentWorkspace.workspacePath,
          workspaceIdentity: currentWorkspace.workspaceIdentity,
          remoteSessionId: currentWorkspace.remoteSessionId,
          callerSessionId,
          callId,
          turnId,
          trace,
          signal,
          assertCurrent,
          sourceServerId: options?.appControlSourceServerId ?? "local",
          connectionId: appControlConnectionId,
        };
      },
    });
    const disposables = [
      {
        dispose() {
          for (const bridge of topicResources.values()) bridge.dispose();
          topicResources.clear();
        },
      },
      appControl,
      client.onNotification((message) => {
        const routed = routeClientMessage(client, message.params);
        const data = message.params as {
          sessionId?: unknown;
          taskId?: unknown;
          topic?: unknown;
          workspace?: unknown;
        } | null;
        if (!routed && (data?.sessionId || data?.taskId || data?.topic || data?.workspace)) return;
        const workspace = routed ?? initialWorkspace;
        if (message.method === zcodeProtocolMethods.sessionLifecycleChanged) {
          if (activeClientsByWorkspaceKey.get(resolveWorkspaceKey(workspace))?.client !== client)
            return;
          const parsed = sessionLifecycleSnapshotSchema.safeParse(message.params);
          if (parsed.success)
            sessionLifecycleEmitter.fire({
              workspaceKey: resolveWorkspaceKey(workspace),
              snapshot: parsed.data,
            });
          return;
        }
        if (message.method === zcodeProtocolNotifications.pluginStartupDegraded) {
          if (client.pluginStartupDegraded && !client.isDisposed)
            pluginStartupDegradedEmitter.fire({
              workspaceKey: resolveWorkspaceKey(workspace),
              client,
            });
          return;
        }
        if (message.method === zcodeProtocolNotifications.providerRuntimeHeadersCancelled) {
          const parsed = zcodeProviderRuntimeHeadersCancelledSchema.safeParse(message.params);
          if (
            !parsed.success ||
            resolveWorkspaceKey(parsed.data.workspace) !== resolveWorkspaceKey(workspace)
          )
            return;
          const key = providerRuntimeHeadersRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const pending = pendingProviderRuntimeHeaders.get(key);
          // 旧 client 或同路径不同 identity 的取消不能删除新 runtime/其他工作区的请求。
          if (pending?.client === client) cancelProviderRuntimeHeaders(key, pending);
          return;
        }
        if (message.method === zcodeProtocolNotifications.processResourceSample) {
          const parsed = zcodeProcessResourceSampleSchema.safeParse(message.params);
          if (parsed.success) {
            processResourceSampleEmitter.fire({ ...parsed.data, lane });
          } else {
            logger.debug(undefined, "丢弃无效 XCode CLI 资源样本", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path.join("."),
              })),
            });
          }
          return;
        }

        if (message.method === zcodeProtocolNotifications.toolExecResource) {
          const parsed = zcodeToolExecResourceSchema.safeParse(message.params);
          if (parsed.success) toolExecResourceEmitter.fire(parsed.data);
          return;
        }
        if (message.method === zcodeProtocolNotifications.mcpResourceSamples) {
          const parsed = zcodeMcpResourceSamplesSchema.safeParse(message.params);
          if (parsed.success) mcpResourceSamplesEmitter.fire(parsed.data);
          else logger.debug(undefined, "丢弃无效 MCP 资源样本");
          return;
        }

        if (message.method === zcodeProtocolNotifications.mcpTelemetry) {
          const parsed = zcodeMcpTelemetryEventSchema.safeParse(message.params);
          if (parsed.success) {
            mcpTelemetryEmitter.fire(parsed.data);
          } else {
            logger.debug(undefined, "丢弃无效 XCode CLI MCP 遥测事件", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path.join("."),
              })),
            });
          }
          return;
        }

        if (message.method === zcodeProtocolNotifications.pluginOperationProgress) {
          const parsed = zcodePluginOperationProgressNotificationSchema.safeParse(message.params);
          if (parsed.success) {
            pluginOperationProgressEmitters.get(parsed.data.operationId)?.fire(parsed.data);
          } else {
            logger.warn(undefined, "丢弃无效 XCode Protocol 插件操作进度", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
            });
          }
          return;
        }

        if (message.method === zcodeProtocolMethods.computerUseOperationEvent) {
          const parsed = zcodeComputerUseOperationEventSchema.safeParse(message.params);
          if (parsed.success) {
            // v4 会话不会投影 legacy session/event，CUA 提示必须直接消费 runtime sideband，
            // 避免把两条独立事件流的 sequenceNumber/seq 混为同一顺序域。
            cuaOperationTurnTracker?.accept(workspace, parsed.data);
          } else {
            logger.warn(undefined, "丢弃无效 XCode Protocol Computer Use operation event", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }

        if (message.method === "session/event") {
          const parsed = zcodeSessionEventSchema.safeParse(message.params);
          if (parsed.success) {
            handleSessionEvent(workspace, parsed.data);
          } else {
            const rawParams =
              typeof message.params === "object" && message.params !== null
                ? (message.params as Record<string, unknown>)
                : {};
            logger.warn(
              typeof rawParams.traceId === "string" ? rawParams.traceId : undefined,
              "丢弃无效 XCode Protocol session event",
              {
                eventId: rawParams.eventId,
                issues: parsed.error.issues.map((issue) => ({
                  code: issue.code,
                  message: issue.message,
                  path: issue.path.join("."),
                })),
                sessionId: rawParams.sessionId,
                type: rawParams.type,
              },
            );
          }
          return;
        }

        if (message.method === "state.updated") {
          const parsed = zcodeStateUpdatedNotificationSchema.safeParse(message.params);
          if (parsed.success) {
            handleStateUpdated(workspace, parsed.data);
          }
          return;
        }

        if (message.method === V4_NOTIFICATIONS.localTtftFacts) {
          const parsed = localTtftFactsSchema.safeParse(message.params);
          if (parsed.success && !workspace.remoteSessionId && !workspace.workspaceIdentity?.trim())
            localTtftFactsEmitter.fire({
              workspaceKey: resolveWorkspaceKey(workspace),
              facts: parsed.data,
            });
          return;
        }
        if (contextComposition.handleNotification(workspace, message)) return;
        if (message.method === V4_NOTIFICATIONS.conversationTelemetryFact) {
          const parsed = conversationTelemetryFactSchema.safeParse(message.params);
          if (parsed.success) {
            // 远控事实由执行服务独占，避免桌面同时打开该会话时重复计 step。
            if (!collectRemoteConversationFact(workspace, parsed.data))
              getConversationTelemetryFactEmitter(workspace).fire(parsed.data);
          } else {
            // 严格丢弃未知字段，避免 CLI runtime 新字段未经审计穿透到 renderer reporter。
            logger.warn(undefined, "丢弃无效 v4 conversation telemetry fact", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }
        if (message.method === V4_NOTIFICATIONS.offPeakLifecycle) {
          const parsed = offPeakLifecycleNotificationSchema.safeParse(message.params);
          if (parsed.success) getOffPeakLifecycleEmitter(workspace).fire(parsed.data);
          else
            logger.warn(undefined, "丢弃无效闲时生命周期通知", {
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          return;
        }

        if (message.method === V4_NOTIFICATIONS.pluginUiToolResult) {
          const parsed = pluginUiToolResultNotificationSchema.safeParse(message.params);
          // 只接受当前本地 runtime；旧进程迟到结果和远程客户端不能在本窗口创建 UI。
          if (
            parsed.success &&
            !workspace.remoteSessionId &&
            !isRemoteWorkspaceIdentity(workspace.workspaceIdentity ?? "") &&
            activeClientsByWorkspaceKey.get(resolveWorkspaceKey(workspace))?.client === client
          ) {
            pluginUiToolResultEmitter.fire({
              ...parsed.data,
              workspacePath: workspace.workspacePath,
              ...(workspace.workspaceIdentity
                ? { workspaceIdentity: workspace.workspaceIdentity }
                : {}),
            });
          }
          return;
        }
        if (message.method === V4_NOTIFICATIONS.cuaPermissionObservation) {
          const parsed = cuaPermissionObservationSchema.safeParse(message.params);
          if (
            parsed.success &&
            !workspace.remoteSessionId &&
            !(workspace.workspaceIdentity && isRemoteWorkspaceIdentity(workspace.workspaceIdentity))
          ) {
            cuaPermissionObservationEmitter.fire({
              ...parsed.data,
              workspacePath: workspace.workspacePath,
              ...(workspace.workspaceIdentity
                ? { workspaceIdentity: workspace.workspaceIdentity }
                : {}),
            });
          } else if (!parsed.success) {
            // 原因：权限观察会触发 renderer 副作用，未知字段必须 fail closed，不能宽松透传。
            logger.warn(undefined, "丢弃无效 v4 CUA 权限观察", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }

        if (message.method === V4_NOTIFICATIONS.conversationFrame) {
          // 同一通知也载 sessions-index 帧，按 topic 前缀分流到列表 emitter
          // （否则会被 conversation schema 校验丢弃）。
          const topic = (message.params as { topic?: unknown } | null)?.topic;
          if (typeof topic === "string" && topic.startsWith("sessions-index/")) {
            const indexParsed = sessionsIndexTopicWireCandidateSchema.safeParse(message.params);
            if (indexParsed.success) {
              getSessionsIndexFrameEmitter(workspace).fire(indexParsed.data);
            } else {
              logger.warn(undefined, "丢弃无效 v4 sessions-index frame", {
                issues: indexParsed.error.issues.map((issue) => ({
                  code: issue.code,
                  message: issue.message,
                  path: issue.path.join("."),
                })),
                workspaceKey: resolveWorkspaceKey(workspace),
              });
            }
            return;
          }
          if (typeof topic === "string" && topic.startsWith("workspace-config/")) {
            const configParsed = workspaceConfigTopicWireCandidateSchema.safeParse(message.params);
            if (configParsed.success) {
              getWorkspaceConfigFrameEmitter(workspace).fire(configParsed.data);
            } else {
              logger.warn(undefined, "丢弃无效 v4 workspace-config frame", {
                issues: configParsed.error.issues.map((issue) => ({
                  code: issue.code,
                  message: issue.message,
                  path: issue.path.join("."),
                })),
                workspaceKey: resolveWorkspaceKey(workspace),
              });
            }
            return;
          }
          const parsed = conversationTopicWireCandidateSchema.safeParse(message.params);
          if (parsed.success) {
            getConversationFrameEmitter(workspace).fire(parsed.data);
          } else {
            logger.warn(undefined, "丢弃无效 v4 conversation frame", {
              issues: parsed.error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                path: issue.path.join("."),
              })),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          }
          return;
        }
      }),
      client.onRequest((request) => {
        if (request.method === zcodeProtocolMethods.interactionRequestCredentialCipher) {
          const parsed = credentialCipherRequestSchema.safeParse(request.params);
          if (!parsed.success || !options?.credentialCipherProvider) {
            void client
              .respondError(request.id, {
                code: -32602,
                message: "Credential cipher is unavailable",
              })
              .catch(() => {});
            return;
          }
          // 该私有能力属于已建立的 stdio 进程连接，不转发至 UI，也不记录载荷。
          void executeCredentialCipherRequest(options.credentialCipherProvider, parsed.data)
            .then((reply) => client.respond(request.id, reply))
            .catch(() => {});
          return;
        }
        // App 控制反向请求不带 sessionId/workspace 顶层字段；共享 CLI 的路由守卫会误拒它。
        // 它在 bind 中按调用者 session 单独路由，因此必须先于守卫处理。
        if (appControl.handle(request)) return;
        const mcpStatusAuth =
          lane === "mcp-status" &&
          request.method === zcodeProtocolMethods.interactionRequestOfficialMcpAuthHeaders
            ? zcodeOfficialMcpAuthHeadersRequestParamsSchema.safeParse(request.params)
            : undefined;
        // 设置探测有独立 CLI，不是项目的聊天 owner。只允许合法 MCP 授权回调使用
        // Host 出站前登记的目标；不能因存在聊天 runtime 而拒绝，也不能由回调自建归属。
        const routed = mcpStatusAuth
          ? mcpStatusAuth.success && (mcpStatusAuth.data.consumer ?? "mcp-server") === "mcp-server"
            ? clientWorkspaces.get(client)?.get(resolveWorkspaceKey(mcpStatusAuth.data.workspace))
            : undefined
          : routeClientMessage(client, request.params);
        const data = request.params as {
          sessionId?: unknown;
          taskId?: unknown;
          workspace?: unknown;
        } | null;
        if (
          !routed &&
          (mcpStatusAuth ||
            (clientWorkspaces.get(client)?.size ?? 0) > 1 ||
            data?.sessionId ||
            data?.taskId ||
            data?.workspace)
        ) {
          if (request.method === zcodeProtocolMethods.interactionRequestOfficialMcpAuthHeaders) {
            logger.warn(request.trace?.traceId, "官方 MCP 身份头请求未通过工作区路由", {
              lane,
              stage: "workspace-routing",
              code: -32602,
              protocolRequestId: request.id,
              registeredWorkspaceCount: clientWorkspaces.get(client)?.size ?? 0,
            });
          }
          void client.respondError(request.id, {
            code: -32602,
            message: "Request workspace is not owned by this CLI",
          });
          return;
        }
        const workspace = routed ?? initialWorkspace;
        if (request.method === zcodeProtocolMethods.subagentsReadRuntimeConfig) {
          void (async () => {
            const parsed = zcodeSubagentsReadRuntimeConfigParamsSchema.safeParse(request.params);
            if (!parsed.success) {
              await client.respondError(request.id, {
                code: -32602,
                message: "Invalid subagent runtime config request",
              });
              return;
            }
            let configuration: SubagentRuntimeConfig;
            try {
              if (!options?.readSubagentRuntimeConfig)
                throw new Error("Subagent runtime config is unavailable on this Host");
              configuration = subagentRuntimeConfigSchema.parse(
                await options.readSubagentRuntimeConfig(workspace),
              );
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
              return;
            }
            await client.respond(request.id, configuration);
          })().catch((error) =>
            logger.debug(undefined, "Subagent 配置响应发送失败", { error: String(error) }),
          );
          return;
        }
        if (request.method === zcodeProtocolMethods.channelReply) {
          void (async () => {
            const params = channelReplyRequestSchema.parse(request.params);
            if (!options?.channelReplyExecutor) throw new Error("Channel reply unavailable");
            const active = activeClientsByWorkspaceKey.get(resolveWorkspaceKey(workspace));
            if (active?.client !== client)
              throw new Error("Channel reply client is no longer active");
            const currentWorkspace = active.workspace;
            const result = await options.channelReplyExecutor({
              ...params,
              // 活跃连接还携带 V4 envelope 等内部字段；跨回复契约只能投影工作区身份，不能展开整个对象。
              workspacePath: currentWorkspace.workspacePath,
              workspaceIdentity: currentWorkspace.workspaceIdentity,
              remoteSessionId: currentWorkspace.remoteSessionId,
              trace: request.trace,
            });
            await client.respond(request.id, result);
          })().catch((error: unknown) =>
            client.respondError(request.id, {
              code: -32603,
              message: error instanceof Error ? error.message : "Channel reply failed",
            }),
          );
          return;
        }
        if (request.method === zcodeProtocolMethods.topicResourceRead) {
          void getTopicResources(workspace)
            .read(request.params, request.trace)
            .then((result) => client.respond(request.id, result))
            .catch((error: unknown) =>
              client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : "Topic resource read failed",
              }),
            );
          return;
        }
        if (request.method === zcodeProtocolMethods.topicResourceCancel) {
          const parsed = zcodeTopicResourceCancelParamsSchema.safeParse(request.params);
          void client.respond(request.id, {
            cancelled:
              parsed.success &&
              (topicResources.get(resolveWorkspaceKey(workspace))?.cancel(parsed.data) ?? false),
          });
          return;
        }
        if (request.method === zcodeProtocolMethods.sessionRequestRuntimePreferences) {
          const reportResponseFailure = (error: unknown): void => {
            logger.debug(undefined, "运行时偏好响应发送失败", {
              error: error instanceof Error ? error.message : String(error),
              workspaceKey: resolveWorkspaceKey(workspace),
            });
          };
          const parsed = zcodeSessionRequestRuntimePreferencesParamsSchema.safeParse(
            request.params,
          );
          if (!parsed.success) {
            void client
              .respondError(request.id, {
                code: -32602,
                message: "Invalid session runtime preferences request params",
                data: parsed.error.flatten(),
              })
              .catch(reportResponseFailure);
            return;
          }
          if (sessionRuntimePreferencesAuthority === "local") {
            void (async () => {
              let preferences: XCodeSessionRuntimePreferencesResult;
              try {
                preferences = zcodeSessionRuntimePreferencesResultSchema.parse(
                  // 同一 RPC 承载 runtime 创建与首次执行两个时机；必须继续传递
                  // 已校验的 scope，避免首次执行为了 Shell 再次等待远端 client config。
                  (await resolveSessionRuntimePreferences?.(parsed.data.scope)) ?? {
                    askUserQuestionAutoResolutionEnabled: true,
                    nativeSearchEnhancementsEnabled: true,
                    memoryEnabled: false,
                  },
                );
                if (
                  parsed.data.scope === "runtime-materialization" &&
                  options?.resolveSessionDirectories
                ) {
                  preferences.additionalDirectories = await resolveSessionDirectories(
                    { ...workspace, sessionId: parsed.data.sessionId },
                    parsed.data.directorySessionId,
                  );
                }
                // 修复：这里曾按 workspace 身份排除远程。R3 远端 Core 也走本分支，它的 workspace 都是远端身份，
                // 子智能体快照因此从不交给 CLI，推送或远端设置页新建的子智能体要新建 task 才能用。
                // CLI 由本 Host 在本机启动、读本机文件，是否提供只看本 Host 是否持有快照。
                preferences.subagentRuntimeConfigEnabled = Boolean(
                  options?.readSubagentRuntimeConfig,
                );
                preferences.appControlEnabled = Boolean(options?.resolveAppControlService?.());
              } catch (error) {
                await client.respondError(request.id, {
                  code: -32603,
                  message: error instanceof Error ? error.message : String(error),
                });
                return;
              }
              // 响应发送失败表示 transport 已关闭，不能再把它当成设置读取失败
              // 并尝试发送第二个 error response。
              await client.respond(request.id, preferences);
            })().catch(reportResponseFailure);
            return;
          }

          const requestId = randomUUID();
          const dynamicRequest: XCodeAgentSessionRuntimePreferencesRequest = {
            ...parsed.data,
            requestId,
          };
          pendingSessionRuntimePreferences.set(requestId, {
            client,
            protocolRequestId: request.id,
            request: dynamicRequest,
            workspace,
            timeout: setTimeout(
              () => expireSessionRuntimePreferencesRequest(requestId),
              XCODE_SESSION_RUNTIME_PREFERENCES_REQUEST_TIMEOUT_MS,
            ),
            workspaceKey: resolveWorkspaceKey(workspace),
          });
          logger.info(undefined, "运行时偏好请求已转发给 Host", {
            event: "zcode_agent.runtime_preferences.host_request_dispatched",
            module: "services.zcode_agent",
            requestId,
            scope: dynamicRequest.scope,
            sessionId: dynamicRequest.sessionId,
            workspaceKey: resolveWorkspaceKey(workspace),
          });
          sessionRuntimePreferencesRequestEmitter.fire(dynamicRequest);
          return;
        }

        if (request.method === zcodeProtocolMethods.interactionRequestPermission) {
          const parsed = zcodePermissionRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid permission request params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const key = permissionRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const wasPending = pendingPermissions.has(key);
          pendingPermissions.set(key, {
            client,
            protocolRequestId: request.id,
          });
          if (!wasPending) {
            emitSessionEvent(workspace, parsed.data.sessionId, {
              type: "permission.request",
              request: parsed.data,
            });
          }
          return;
        }

        if (request.method === zcodeProtocolMethods.interactionRequestUserInput) {
          const parsed = zcodeUserInputRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid user input request params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const key = userInputRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const wasPending = pendingUserInputs.has(key);
          pendingUserInputs.set(key, { client, protocolRequestId: request.id });
          if (!wasPending) {
            // agent 为恢复丢失的 protocol id 会重发同一业务 requestId。
            // host 需要刷新可响应的 protocolRequestId，但不能重复广播给 UI，
            // 否则多问题 AskUserQuestion 会在用户翻到后续问题时被重置回第一页。
            emitSessionEvent(workspace, parsed.data.sessionId, {
              type: "userInput.request",
              request: parsed.data,
            });
          }
          return;
        }

        if (request.method === zcodeProtocolMethods.interactionRequestProviderRuntimeHeaders) {
          const parsed = zcodeProviderRuntimeHeadersRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid provider runtime headers request params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const pendingKey = providerRuntimeHeadersRequestKey({
            ...workspace,
            sessionId: parsed.data.sessionId,
            requestId: parsed.data.requestId,
          });
          const pending = {
            client,
            protocolRequestId: request.id,
            request: parsed.data,
          };
          pendingProviderRuntimeHeaders.set(pendingKey, pending);
          logger.info(request.trace?.traceId, "收到 XCode provider runtime headers 请求", {
            modelId: parsed.data.modelSelection.modelId,
            providerId: parsed.data.providerId,
            requestId: parsed.data.requestId,
            sessionId: parsed.data.sessionId,
            turnId: parsed.data.turnId ?? null,
            workspaceKey: resolveWorkspaceKey(workspace),
            workspacePath: workspace.workspacePath,
          });
          // 根因：路由失败时 catch 要 await 失败响应，transport 已关闭或写入失败会让
          // respond 拒绝，void 调用把它变成未处理拒绝。拒绝前 pending 已删除，这里只
          // 记录，不能再补发第二个响应。
          void routeProviderRuntimeHeadersRequest(pendingKey, pending, workspace).catch(
            (error: unknown) => {
              logger.warn(undefined, "XCode provider runtime headers 响应发送失败", {
                modelId: parsed.data.modelSelection.modelId,
                providerId: parsed.data.providerId,
                requestId: parsed.data.requestId,
                sessionId: parsed.data.sessionId,
                error: error instanceof Error ? error.message : String(error),
                workspaceKey: resolveWorkspaceKey(workspace),
              });
            },
          );
          return;
        }

        // 官方 Server MCP 身份头：纯 RPC 中继，host 自动解析并响应。
        // 不 emitSessionEvent、不进 pending map——该请求没有 UI 语义，renderer 不参与。
        if (request.method === zcodeProtocolMethods.interactionRequestOfficialMcpAuthHeaders) {
          const parsed =
            mcpStatusAuth ??
            zcodeOfficialMcpAuthHeadersRequestParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid interaction/requestOfficialMcpAuthHeaders params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const authWorkspace = mcpStatusAuth
            ? buildWorkspaceRef(workspace)
            : parsed.data.workspace;
          // 命令进程（plugin-command）没有 MCP：mcpKey 留空，只用 pluginId 归属；
          // 可信判定不看这两个字段，只看 targetOrigin。
          const consumer = parsed.data.consumer ?? "mcp-server";
          const mcpKey = parsed.data.mcpKey ?? "";
          // host 侧二次校验必须发生在**读取凭据之前**：未命中即返回，resolveHeaders 不被调用，
          // 因此不会有任何凭据被读入内存。
          void (async () => {
            const trustedOrigins = options?.officialMcpTrustedOrigins;
            const trust = trustedOrigins
              ? await trustedOrigins
                  .isTrusted({
                    mcpKey,
                    origin: parsed.data.targetOrigin,
                    pluginId: parsed.data.pluginId,
                  })
                  // 判定自身异常也按不可信处理，绝不因为校验失败就放行。
                  .catch(() => ({ detail: "validator_error", trusted: false }))
              : { detail: "validator_missing", trusted: false };
            if (!trust.trusted) {
              // 只记录非敏感的请求上下文；凭据未被读取，自然也无从泄露。
              logger.warn(request.trace?.traceId, "官方 MCP 身份头请求未通过 host 侧可信校验", {
                detail: trust.detail ?? "unknown",
                mcpKey,
                consumer,
                pluginId: parsed.data.pluginId,
                requestId: parsed.data.requestId,
                targetOrigin: parsed.data.targetOrigin,
                workspaceKey: authWorkspace.workspaceKey,
              });
              void client.respond(request.id, {
                ok: false,
                reason: "official_mcp_origin_untrusted",
              });
              return;
            }
            const resolver = options?.officialMcpAuthHeadersResolver;
            if (!resolver) {
              void client.respond(request.id, {
                ok: false,
                reason: "official_auth_unavailable",
              });
              return;
            }
            try {
              const resolveStartedAt = Date.now();
              const result = await resolver.resolveHeaders({
                mcpKey,
                consumer,
                pluginId: parsed.data.pluginId,
                targetOrigin: parsed.data.targetOrigin,
                workspace: authWorkspace,
              });
              // host 侧不能只在失败时留日志，成功路径完全静默会无法回答"到底发了哪几个头"。
              // 只记 header 名与套餐维度：凭证值绝不入日志（日志留存周期不受控）。
              if (result.ok) {
                const firstIssuance = officialMcpIssuanceAudit.markFirst(
                  parsed.data.pluginId,
                  mcpKey,
                  authWorkspace.workspaceKey,
                );
                const logIssuance = firstIssuance ? logger.info : logger.debug;
                logIssuance(request.trace?.traceId, "官方 MCP 身份头已解析", {
                  lane,
                  firstIssuance,
                  ...summarizeOfficialMcpIdentityHeaders(result.headers),
                  mcpKey,
                  consumer,
                  pluginId: parsed.data.pluginId,
                  requestId: parsed.data.requestId,
                  resolveDurationMs: Date.now() - resolveStartedAt,
                  targetOrigin: parsed.data.targetOrigin,
                });
              } else {
                logger.info(request.trace?.traceId, "官方 MCP 身份头不可用", {
                  mcpKey,
                  consumer,
                  pluginId: parsed.data.pluginId,
                  reason: result.reason,
                  requestId: parsed.data.requestId,
                  resolveDurationMs: Date.now() - resolveStartedAt,
                  targetOrigin: parsed.data.targetOrigin,
                });
              }
              void client.respond(request.id, result);
            } catch (error: unknown) {
              // 解析异常按不可用返回而非 respondError：adapter 只按可枚举 reason 分流，
              // 且此处绝不能让 MCP 退化成匿名请求。凭证原文不进日志。
              logger.warn(request.trace?.traceId, "官方 MCP 身份头解析失败", {
                error: error instanceof Error ? error.message : String(error),
                mcpKey,
                consumer,
                pluginId: parsed.data.pluginId,
                requestId: parsed.data.requestId,
                targetOrigin: parsed.data.targetOrigin,
              });
              void client.respond(request.id, {
                ok: false,
                reason: "official_auth_unavailable",
              });
            }
          })();
          return;
        }

        // browser-use discovery：backend 在线状态与 plugin/skill 是否暴露是两层状态。
        // executor 缺省时返回空列表，禁止 facade 伪造 IAB available。
        if (request.method === zcodeProtocolMethods.interactionBrowserList) {
          const parsed = zcodeBrowserListParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid interaction/browserList params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const executor = options?.browserControlExecutor;
          if (!executor) {
            void client.respond(request.id, { browsers: [] });
            return;
          }
          void executor
            .list(parsed.data)
            .then((browsers) => client.respond(request.id, { browsers }))
            .catch((error: unknown) => {
              void client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            });
          return;
        }

        // browser-use：agent 的 agent.browsers.* 经 interaction/browserExecute 到达这里。
        // 纯 RPC 中继——转发给 main（WebContentsView+CDP）执行后 respondResult，不 emitSessionEvent、
        // 不进 pending map（区别于 permission 的 UI 阻塞语义）。executor 缺省则 backend_unavailable。
        if (request.method === zcodeProtocolMethods.interactionBrowserExecute) {
          const parsed = zcodeBrowserExecuteParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid interaction/browserExecute params",
              data: parsed.error.flatten(),
            });
            return;
          }
          const executor = options?.browserControlExecutor;
          if (!executor) {
            void client.respond(request.id, {
              ...(parsed.data.command.method === "openScope" && parsed.data.controlScopeId
                ? { scope: { id: parsed.data.controlScopeId, state: "rejected" } }
                : {}),
              ok: false,
              error: {
                code: "backend_unavailable",
                message: "browser control not available",
              },
              elapsedMs: 0,
            });
            return;
          }
          void executor
            .execute({
              requestId: parsed.data.requestId,
              controlScopeId: parsed.data.controlScopeId,
              ...(parsed.data.browserId ? { browserId: parsed.data.browserId } : {}),
              ...(parsed.data.browserGeneration !== undefined
                ? { browserGeneration: parsed.data.browserGeneration }
                : {}),
              sessionId: parsed.data.sessionId,
              ...(parsed.data.turnId ? { turnId: parsed.data.turnId } : {}),
              workspaceKey: parsed.data.workspaceKey ?? resolveWorkspaceKey(workspace),
              workspacePath: parsed.data.workspacePath ?? workspace.workspacePath,
              ...((parsed.data.workspaceIdentity ?? workspace.workspaceIdentity)
                ? {
                    workspaceIdentity: parsed.data.workspaceIdentity ?? workspace.workspaceIdentity,
                  }
                : {}),
              ...(parsed.data.remoteSessionId
                ? { remoteSessionId: parsed.data.remoteSessionId }
                : {}),
              clientMode: parsed.data.clientMode ?? "desktop-continuous",
              sessionContext: parsed.data.sessionContext ?? "live",
              command: parsed.data.command,
            })
            .then((result) => client.respond(request.id, result))
            .catch((error: unknown) => {
              void client.respond(request.id, {
                ok: false,
                error: {
                  code: "execution_error",
                  message: error instanceof Error ? error.message : String(error),
                },
                elapsedMs: 0,
              });
            });
          return;
        }

        if (request.method === zcodeProtocolMethods.automationCreate) {
          const parsed = zcodeAutomationCreateParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation create params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const automation = await automationService.create({
                title: parsed.data.title ?? "",
                cronExpr: parsed.data.cronExpr,
                relativeDelayMinutes: parsed.data.relativeDelayMinutes,
                // 会话侧长间隔 carrier（intervalUnit+interval）透传给 service 归一化为权威 scheduleRule。
                intervalUnit: parsed.data.intervalUnit,
                interval: parsed.data.interval,
                prompt: parsed.data.prompt,
                modelSelection: parsed.data.modelSelection,
                mode: parsed.data.mode,
                targetTaskId: parsed.data.targetTaskId,
                botDeliveryTarget: parsed.data.botDeliveryTarget,
                workspacePath: workspace.workspacePath,
                workspaceIdentity: workspace.workspaceIdentity,
                recurring: parsed.data.recurring ?? true,
                maxRuns: parsed.data.maxRuns,
              });
              if (automation.targetTaskId) {
                const taskMeta = await automationTaskIndexRepo
                  .getTaskMeta({
                    workspacePath: automation.workspacePath,
                    workspaceIdentity: automation.workspaceIdentity,
                    taskId: automation.targetTaskId,
                  })
                  .catch(() => null);
                if (taskMeta) {
                  await automationTaskIndexRepo.updateTaskPresentation({
                    ...taskMeta,
                    presentation: {
                      // 会话内创建的 automation 复用当前 session；显式写入标记供 V4 侧栏展示。
                      cronAutomationId: automation.automationId,
                    },
                  });
                }
              }
              await client.respond(request.id, {
                automation: toProtocolAutomation(automation),
              });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === zcodeProtocolMethods.offPeakCreate) {
          const parsed = zcodeOffPeakCreateParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid off-peak create params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const offPeakTaskService = options?.resolveOffPeakTaskService?.();
              if (!offPeakTaskService) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Off-peak task service is unavailable on this host",
                });
                return;
              }
              const grayConfig = await options
                ?.resolveOffPeakClientConfig?.()
                .catch(() => undefined);
              // 工具注册后灰度被关闭/配置解析失败时，不能继续走"白名单为空"的推导
              // （显式 model 会误报 model_not_allowed，省略 model 会以空模型落库）；直接返回稳定分类。
              // 模型视图可同时包含两个域；必须用已有支持快照确认归属，不能从首个 Provider 猜。
              const support =
                resolveOffPeakAllowedModels(grayConfig).length > 0
                  ? await offPeakTaskService.getCodingPlanSupport()
                  : undefined;
              const providerId = support?.supported
                ? OFF_PEAK_PROVIDER_IDS[support.providerFamily]
                : undefined;
              const allowedModels = providerId
                ? resolveOffPeakAllowedModels(grayConfig, providerId)
                : [];
              if (allowedModels.length === 0) {
                await client.respond(request.id, {
                  ok: false,
                  failureStage: "client_validation",
                  errorCategory: "client_validation",
                  errorCode: "offpeak_disabled",
                });
                return;
              }
              // model 白名单预校：显式入参不在白名单返回稳定分类，
              // 复用 client_validation 分类 + 专用 errorCode，不扩分类枚举。
              // 匹配与 thoughtLevel/UI 同语义（trim + 大小写不敏感），命中后回写白名单原写法。
              const model = resolveOffPeakCreateModel(allowedModels, parsed.data.model);
              if (model === null) {
                await client.respond(request.id, {
                  ok: false,
                  failureStage: "client_validation",
                  errorCategory: "client_validation",
                  errorCode: "model_not_allowed",
                });
                return;
              }
              const modelSelection =
                grayConfig && providerId
                  ? resolveOffPeakToolSelection(
                      grayConfig.modelSelectionView,
                      providerId,
                      model,
                      parsed.data.thoughtLevel,
                    )
                  : undefined;
              if (!modelSelection) {
                await client.respond(request.id, {
                  ok: false,
                  failureStage: "client_validation",
                  errorCategory: "client_validation",
                  errorCode: "model_not_allowed",
                });
                return;
              }
              const result = await offPeakTaskService.createTask({
                title: parsed.data.title,
                prompt: parsed.data.prompt,
                permissionMode: parsed.data.permissionMode ?? "yolo",
                modelSelection,
                // 会话内创建绑定当前会话，派发时 resume 该会话执行。
                ...(parsed.data.boundSessionId
                  ? { boundSessionId: parsed.data.boundSessionId }
                  : {}),
                // workspace 由 host 从当前 session 注入（对称 automation/create），不进协议参数。
                workspacePath: workspace.workspacePath,
                ...(workspace.workspaceIdentity
                  ? { workspaceIdentity: workspace.workspaceIdentity }
                  : {}),
              });
              if (!result.ok) {
                // 失败分类原样过协议（不 respondError），供 CLI handler 翻译为稳定错误。
                await client.respond(request.id, {
                  ok: false,
                  failureStage: result.failureStage,
                  errorCategory: result.errorCategory,
                  errorCode: result.errorCode,
                });
                return;
              }
              await client.respond(request.id, {
                ok: true,
                task: toProtocolOffPeakTaskSnapshot(result.task),
              });
            } catch (error) {
              await respondOffPeakInternalError(client, request, workspace, error);
            }
          })();
          return;
        }

        if (request.method === zcodeProtocolMethods.offPeakList) {
          const parsed = zcodeOffPeakListParamsSchema.safeParse(request.params ?? {});
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid off-peak list params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const offPeakTaskService = options?.resolveOffPeakTaskService?.();
              if (!offPeakTaskService) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Off-peak task service is unavailable on this host",
                });
                return;
              }
              const workspaceKey = resolveWorkspaceKey(workspace);
              const tasks = (await offPeakTaskService.list())
                .filter((task) => task.workspaceKey === workspaceKey)
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 20);
              await client.respond(request.id, {
                tasks: tasks.map(toProtocolOffPeakTaskSnapshot),
              });
            } catch (error) {
              await respondOffPeakInternalError(client, request, workspace, error);
            }
          })();
          return;
        }

        if (isProxyPoolProtocolMethod(request.method)) {
          void (async () => {
            try {
              const proxyPoolService = options?.resolveProxyPoolService?.();
              if (!proxyPoolService) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Proxy pool service is unavailable on this host",
                });
                return;
              }
              let outcome: ProxyPoolDispatchResult;
              try {
                outcome = await dispatchProxyPoolRequest(proxyPoolService, request);
              } catch (error) {
                const code = error instanceof Error ? error.message : String(error);
                if (!PROXY_POOL_REJECTION_CODES.has(code)) throw error;
                // 入参可修正的拒绝：稳定错误码原样过协议，模型据此改正后再试。
                await client.respondError(request.id, {
                  code: -32602,
                  message: `Proxy pool request rejected: ${code}`,
                  data: { errorCode: code },
                });
                return;
              }
              if (!outcome.ok) {
                await client.respondError(request.id, {
                  code: -32602,
                  message: outcome.message,
                  ...(outcome.data === undefined ? {} : { data: outcome.data }),
                });
                return;
              }
              await client.respond(request.id, outcome.snapshot);
            } catch (error) {
              await respondProxyPoolInternalError(client, request, workspace, error);
            }
          })();
          return;
        }

        if (isPetControlProtocolMethod(request.method)) {
          void (async () => {
            try {
              const petControl = options?.resolvePetControl?.();
              if (!petControl) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Pet control is unavailable on this host",
                });
                return;
              }
              const method = request.method;
              let outcome: { enabled: boolean; petId: string; behaviorState: string };
              if (method === zcodeProtocolMethods.petControlGet) {
                outcome = await petControl.getSnapshot();
              } else if (method === zcodeProtocolMethods.petControlSetState) {
                const requestedState =
                  typeof (request.params as { state?: unknown } | undefined)?.state === "string"
                    ? (request.params as { state: string }).state
                    : "";
                if (requestedState === "") {
                  await client.respondError(request.id, {
                    code: -32602,
                    message: "Invalid petControl/set-state params: state is required",
                  });
                  return;
                }
                outcome = await petControl.setBehaviorState(requestedState);
              } else {
                outcome = await petControl.triggerWave();
              }
              await client.respond(request.id, {
                ok: true,
                enabled: outcome.enabled,
                petId: outcome.petId,
                behaviorState: outcome.behaviorState,
              });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32000,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }


        if (isModelJailbreakProtocolMethod(request.method)) {
          void (async () => {
            try {
              const store = options?.resolveModelJailbreakStore?.();
              if (!store) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Model jailbreak settings are unavailable on this host",
                });
                return;
              }
              let outcome: ModelJailbreakDispatchResult;
              try {
                outcome = await dispatchModelJailbreakRequest(store, request);
              } catch (error) {
                await client.respondError(request.id, {
                  code: -32603,
                  message:
                    error instanceof Error ? error.message : "Internal model jailbreak error",
                });
                return;
              }
              if (!outcome.ok) {
                await client.respondError(request.id, {
                  code: -32602,
                  message: outcome.message,
                  ...(outcome.data === undefined ? {} : { data: outcome.data }),
                });
                return;
              }
              await client.respond(request.id, outcome.snapshot);
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message:
                  error instanceof Error ? error.message : "Internal model jailbreak error",
              });
            }
          })();
          return;
        }

        if (request.method === PROVIDER_ACCOUNT_METHOD) {
          void (async () => {
            try {
              const store = options?.resolveProviderAccountStore?.();
              if (!store) {
                await client.respondError(request.id, {
                  code: -32601,
                  message: "Provider accounts are unavailable on this host",
                });
                return;
              }
              let outcome: ProviderAccountDispatchResult;
              try {
                outcome = await dispatchProviderAccountRequest(store, request);
              } catch (error) {
                await client.respondError(request.id, {
                  code: -32603,
                  message:
                    error instanceof Error ? error.message : "Internal provider account error",
                });
                return;
              }
              if (!outcome.ok) {
                await client.respondError(request.id, {
                  code: -32602,
                  message: outcome.message,
                  ...(outcome.data === undefined ? {} : { data: outcome.data }),
                });
                return;
              }
              await client.respond(request.id, outcome.snapshot);
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message:
                  error instanceof Error ? error.message : "Internal provider account error",
              });
            }
          })();
          return;
        }

        if (request.method === zcodeProtocolMethods.automationList) {
          const parsed = zcodeAutomationListParamsSchema.safeParse(request.params ?? {});
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation list params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const automations = await automationService.list(workspace);
              await client.respond(request.id, {
                automations: automations.map(toProtocolAutomation),
              });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === zcodeProtocolMethods.automationCheckTaskBinding) {
          const parsed = zcodeAutomationCheckTaskBindingParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation task binding params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const bound = await automationService.hasTaskBinding({
                workspacePath: workspace.workspacePath,
                workspaceIdentity: workspace.workspaceIdentity,
                targetTaskId: parsed.data.targetTaskId,
              });
              await client.respond(request.id, { bound });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === zcodeProtocolMethods.automationUpdate) {
          const parsed = zcodeAutomationUpdateParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation update params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const automation = await automationService.update(
                parsed.data.automationId,
                {
                  title: parsed.data.title,
                  cronExpr: parsed.data.cronExpr,
                  prompt: parsed.data.prompt,
                  recurring: parsed.data.recurring,
                  maxRuns: parsed.data.maxRuns,
                  // 会话侧长间隔 carrier（intervalUnit+interval）透传给 service 归一化为权威 scheduleRule。
                  intervalUnit: parsed.data.intervalUnit,
                  interval: parsed.data.interval,
                },
                workspace,
              );
              if (!automation) {
                throw new Error("Scheduled task not found in the current workspace.");
              }
              await client.respond(request.id, {
                automation: toProtocolAutomation(automation),
              });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === zcodeProtocolMethods.automationDelete) {
          const parsed = zcodeAutomationDeleteParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation delete params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              const deleted = await automationService.delete(parsed.data.automationId, workspace);
              await client.respond(request.id, { deleted });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        if (request.method === zcodeProtocolMethods.automationPause) {
          const parsed = zcodeAutomationPauseParamsSchema.safeParse(request.params);
          if (!parsed.success) {
            void client.respondError(request.id, {
              code: -32602,
              message: "Invalid automation pause params",
              data: parsed.error.flatten(),
            });
            return;
          }
          void (async () => {
            try {
              // CronPauseSelf 的目标来自 CLI loop 的本轮 automationId；Host 只做当前 workspace
              // 内的条件暂停，不存在的 / 非 active 的任务返回 paused=false 而不是错误。
              const paused = await automationService.pause(parsed.data.automationId, workspace);
              await client.respond(request.id, { paused });
            } catch (error) {
              await client.respondError(request.id, {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
          return;
        }

        void client.respondError(request.id, {
          code: -32601,
          message: `Unsupported XCode Protocol request: ${request.method}`,
        });
      }),
      client.onClose(() => {
        for (const key of clientWorkspaces.get(client)?.keys() ?? [])
          invalidateWorkspaceClient(key, client);
        clientWorkspaces.delete(client);
        clientSessions.delete(client);
      }),
    ];
    clientDisposables.set(client, disposables);
  }

  function rememberSessionTrace(
    target: XCodeAgentSessionTarget,
    snapshot: XCodeSessionStateSnapshot,
  ): TraceId | undefined {
    const traceId = snapshot.session.traceId as TraceId | undefined;
    if (traceId) {
      sessionTraceIdBySessionKey.set(sessionEventKey(target), traceId);
    }
    return traceId;
  }

  function getSessionTraceId(target: XCodeAgentSessionTarget): TraceId | undefined {
    return sessionTraceIdBySessionKey.get(sessionEventKey(target));
  }

  function createProviderNotReadyError(params: {
    snapshot?: XCodeAgentProviderReadinessSnapshot;
    workspace: XCodeAgentWorkspaceTarget;
  }): Error & {
    code: typeof XCODE_AGENT_PROVIDER_NOT_READY_CODE;
    data: {
      providerCount: number;
      reason: typeof XCODE_AGENT_PROVIDER_NOT_READY_REASON;
      revision: string | null;
      workspaceKey: string;
      workspacePath: string;
    };
  } {
    const workspaceKey = resolveWorkspaceKey(params.workspace);
    const error = new Error("当前没有可用的模型供应商和模型，请先登录或配置 API Key。") as Error & {
      code: typeof XCODE_AGENT_PROVIDER_NOT_READY_CODE;
      data: {
        providerCount: number;
        reason: typeof XCODE_AGENT_PROVIDER_NOT_READY_REASON;
        revision: string | null;
        workspaceKey: string;
        workspacePath: string;
      };
    };
    error.code = XCODE_AGENT_PROVIDER_NOT_READY_CODE;
    error.data = {
      providerCount: params.snapshot?.providerCount ?? 0,
      reason: XCODE_AGENT_PROVIDER_NOT_READY_REASON,
      revision: params.snapshot?.revision ?? null,
      workspaceKey,
      workspacePath: params.workspace.workspacePath,
    };
    return error;
  }

  function isProviderNotReadyError(
    error: unknown,
  ): error is Error & { code: typeof XCODE_AGENT_PROVIDER_NOT_READY_CODE } {
    return (
      error instanceof Error &&
      (error as { code?: unknown }).code === XCODE_AGENT_PROVIDER_NOT_READY_CODE
    );
  }

  async function resolveStartupReadiness(): Promise<
    XCodeAgentProviderReadinessSnapshot | undefined
  > {
    if (modelSelectionReadinessSource) {
      return createProviderReadinessSnapshotFromSelectionView(
        await modelSelectionReadinessSource.getView(),
      );
    }
    return undefined;
  }

  /**
   * stop/取消 RPC 超时或 watchdog 会回收 client/进程，但进程异步退出，
   * client.onClose 尚未触发时 activeClientsByWorkspaceKey 仍指向已 disposed 的 client。
   * 所有复用 active entry 的路径必须先经过本检查；disposed 时清理 stale entry 并返回 false，
   * 让调用方重新拉起进程（start-if-needed）或按“无运行时”处理（existing-only）。
   */
  function isReusableActiveClientEntry(
    params: XCodeAgentWorkspaceTarget,
    active: ActiveWorkspaceClient | undefined,
  ): boolean {
    if (!active) {
      return false;
    }
    if (!active.client.isDisposed) {
      return true;
    }
    const workspaceKey = resolveWorkspaceKey(params);
    activeClientsByWorkspaceKey.delete(workspaceKey);
    logger.warn(undefined, "复用的 XCode Protocol client 已 disposed，清理 stale entry", {
      workspaceKey,
      workspacePath: params.workspacePath,
    });
    return false;
  }

  async function resolveSessionDirectories(
    target: XCodeAgentSessionTarget,
    directorySessionId = target.sessionId,
  ): Promise<string[] | undefined> {
    return options?.resolveSessionDirectories?.({ ...target, sessionId: directorySessionId });
  }

  async function readSessionDirectories(
    client: XCodeProtocolClient,
    params: XCodeAgentSessionTarget,
  ): Promise<string[] | undefined> {
    let directorySessionId = params.sessionId;
    if (options?.resolveSessionDirectories) {
      // 子会话按设计不进主任务索引；直接查 child 的项目会被远端必选项目校验拒绝。
      // 旧 child 索引也不能证明主任务身份；只信 Agent 持久化父链，再执行原项目校验。
      const visited = new Set<string>();
      while (true) {
        if (visited.has(directorySessionId)) throw new Error("project.session-lineage-invalid");
        visited.add(directorySessionId);
        const { sessions } = await client.request(
          zcodeProtocolMethods.sessionList,
          { workspace: buildWorkspaceRef(params), sessionIds: [directorySessionId] },
          zcodeSessionListResultSchema,
        );
        const session = sessions.find((entry) => entry.sessionId === directorySessionId);
        if (!session) {
          if (directorySessionId !== params.sessionId)
            throw new Error("project.session-lineage-invalid");
          break;
        }
        if (
          resolveWorkspaceKey(session.workspace) !== resolveWorkspaceKey(params) ||
          session.workspace.workspacePath !== params.workspacePath
        )
          throw new Error("project.session-lineage-invalid");
        if (session.directorySessionId) {
          directorySessionId = session.directorySessionId;
          break;
        }
        // 旧 CLI 未协商目录来源时保留原查询合同；新版只信 CLI 的持久化父链结果。
        if (!isAuxiliarySessionKind(session.sessionKind)) break;
        if (!session.parentSessionId) throw new Error("project.session-lineage-invalid");
        directorySessionId = session.parentSessionId;
      }
    }
    return resolveSessionDirectories(params, directorySessionId);
  }

  async function getOrStartReadOnlyClient(
    params: XCodeAgentWorkspaceTarget,
    existingClient?: XCodeProtocolClient,
  ): Promise<ActiveWorkspaceClient> {
    const workspaceKey = resolveWorkspaceKey(params);
    const active = activeClientsByWorkspaceKey.get(workspaceKey);
    if (active && isReusableActiveClientEntry(params, active)) {
      active.workspace = params;
      await active.interactionPreferencesReady;
      return active;
    }

    const client = existingClient ?? (await processManager.getClient(params));
    wireClient(client, params, "chat");

    // processManager 会按 workspaceKey 对并发启动 single-flight。await 期间若另一条
    // read/write 路径已登记同一 client，必须复用现有 entry，不能把已提升的写能力降回 false。
    const concurrent = activeClientsByWorkspaceKey.get(workspaceKey);
    if (concurrent && isReusableActiveClientEntry(params, concurrent)) {
      concurrent.workspace = params;
      await concurrent.interactionPreferencesReady;
      return concurrent;
    }

    const entry: ActiveWorkspaceClient = {
      client,
      modelExecutionEnabled: false,
      workspace: params,
      dynamicWorkflowPolicyMode: "disabled",
    };
    activeClientsByWorkspaceKey.set(workspaceKey, entry);
    const interactionPreferencesReady = (async () => {
      let appliedSnapshot: XCodeAgentAppRuntimePreferences | undefined;
      while (latestAppRuntimePreferences && latestAppRuntimePreferences !== appliedSnapshot) {
        const snapshot = latestAppRuntimePreferences;
        await enqueueInteractionPreferenceSync({
          client,
          preferences: { ...snapshot },
          workspace: params,
        });
        appliedSnapshot = snapshot;
      }
    })();
    // Off-Peak 本地支持能力是 workspace 级事实，在允许任何 session 工作前同步到 CLI，
    // 让 v4 冷恢复（没有 per-request flag 通道）也能拿到工具面。旧 CLI method-not-found 降级忽略。
    // CLI 缺省即 false；共享池仅包含本地工作区，支持条件一致。门禁关闭时不发请求（对未实现该
    // 方法的旧 CLI/测试假客户端零打扰）。
    const offPeakToolPolicyReady = (async () => {
      if (!isOffPeakToolSupported(params)) return;
      try {
        await client.request(
          zcodeProtocolMethods.workspaceUpdateOffPeakToolPolicy,
          { workspace: buildWorkspaceRef(params), enabled: true },
          zcodeWorkspaceUpdateOffPeakToolPolicyResultSchema,
        );
      } catch (error) {
        // 策略同步是尽力而为的能力分发，失败方向是 fail-closed（CLI 缺省不注册工具），
        // 超时/暂时性 IPC 错误不得阻断客户端就绪；-32601 是旧 CLI 的正常降级。
        if (!isProtocolMethodNotFoundError(error)) {
          logger.warn(undefined, "Off-Peak 工具策略同步失败，CLI 维持缺省关闭", {
            workspaceKey,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    // 动态工作流灰度门禁：与 Off-Peak 同一
    // 模式的 workspace 级事实，在允许任何 session 工作前同步给 CLI，v4 冷恢复也才拿得到工具面。
    // 生效模式为关闭时不发请求（CLI 缺省即关闭，对旧 CLI/测试假客户端零打扰）；之后用户改选择时
    // 经同一条 workspace 串行链重发（launch.md「The user's choice」）。
    const dynamicWorkflowPolicyReady = enqueueDynamicWorkflowPolicySync(entry);
    // 复用启动屏障：回调与元数据只在双方确认能力后携带目录来源，旧 Host 不收新字段。
    const directorySourceReady = (async () => {
      try {
        const capabilities = await client.request(
          zcodeProtocolMethods.runtimeCapabilities,
          {
            hostCapabilities: {
              sessionDirectorySource: Boolean(options?.resolveSessionDirectories),
            },
          },
          zcodeRuntimeCapabilitiesSchema,
        );
        // worktree 任务只在 CLI 声明该能力时启用：旧 CLI 会静默丢弃 cwd / targetCwd，
        // 把会话建在 workspace 目录（docs/git/worktree.md §9.3），所以 Host 不能盲发。
        if (capabilities.worktreeCwd === true) worktreeCwdClients.add(client);
        // 扩展来源只发给声明该能力的 CLI：旧 CLI 对 sendText 整条拒绝，对 createSession.firstInput
        // 静默剥掉来源，消息会被当成用户亲自输入。
        if (capabilities.extensionInputSource === true) extensionInputSourceClients.add(client);
        // 旧 CLI 会静默剥掉引用上的 comment / agent：用户看到批注而模型收不到，入口只对声明者开放。
        if (capabilities.conversationQuoteComment === true) {
          conversationQuoteCommentClients.add(client);
        }
        if (capabilities.sessionWorkspaceRouting) {
          await client.request(
            zcodeProtocolMethods.runtimeCapabilities,
            { hostCapabilities: { sessionWorkspaceRouting: true } },
            zcodeRuntimeCapabilitiesSchema,
          );
        } else if (processManager.isSharedRuntime(params)) {
          throw new Error("This Agent version does not support shared task workspace routing");
        }
      } catch (error) {
        if (processManager.isSharedRuntime(params) || !isProtocolMethodNotFoundError(error))
          throw error;
      }
    })();
    entry.interactionPreferencesReady = Promise.all([
      // 共享 CLI 的进程 cwd 不代表任务目录；每个逻辑工作区都必须先准备自己的配置快照。
      options?.prepareRuntimeWorkspace?.(params),
      directorySourceReady,
      interactionPreferencesReady,
      offPeakToolPolicyReady,
      dynamicWorkflowPolicyReady,
    ]).then(() => undefined);
    try {
      // 新建或重启 runtime 在允许任何 session 工作前追平缓存；同步期间的新开关
      // 会因 entry 已登记而进入同一 workspace 串行队列，不会丢失提交顺序。
      await entry.interactionPreferencesReady;
    } catch (error) {
      if (activeClientsByWorkspaceKey.get(workspaceKey) === entry) {
        activeClientsByWorkspaceKey.delete(workspaceKey);
      }
      throw error;
    } finally {
      delete entry.interactionPreferencesReady;
    }
    logger.info(undefined, "为只读会话控制面启动 XCode agent", {
      workspaceKey,
      workspacePath: params.workspacePath,
    });
    return entry;
  }

  async function getClient(params: XCodeAgentWorkspaceTarget) {
    const client = await getExecutionClient(params);
    rememberClientTarget(client, params);
    return client;
  }

  async function getExecutionClient(params: XCodeAgentWorkspaceTarget) {
    const workspaceKey = resolveWorkspaceKey(params);
    const active = activeClientsByWorkspaceKey.get(workspaceKey);
    if (active?.modelExecutionEnabled && isReusableActiveClientEntry(params, active)) {
      active.workspace = params;
      return active.client;
    }

    const waiting: WaitingWorkspaceStartup = waitingWorkspaceStartups.get(workspaceKey) ?? {
      cancelled: false,
      workspace: params,
    };
    waiting.workspace = params;
    waitingWorkspaceStartups.set(workspaceKey, waiting);

    // Bug 根因：并发调用各自 await readiness，先成功的一条会删除等待记录，迟到调用
    // 因而把成功误判成 workspace 已释放。共享整个启动 Promise，取消仍由 waiting identity 控制。
    const starting = (waiting.starting ??= startModelExecutionClient(params, waiting));
    try {
      return await starting;
    } finally {
      if (waiting.starting === starting) delete waiting.starting;
    }
  }

  async function startModelExecutionClient(
    params: XCodeAgentWorkspaceTarget,
    waiting: WaitingWorkspaceStartup,
  ): Promise<XCodeProtocolClient> {
    const workspaceKey = resolveWorkspaceKey(params);
    const active = activeClientsByWorkspaceKey.get(workspaceKey);

    const readinessSnapshot = await resolveStartupReadiness();
    // readiness 读取可能与 workspace release 交错；release 删除 waiting identity 后，
    // 旧 continuation 不能创建新进程。未来重新打开同一路径会获得新的 identity，互不误伤。
    if (waiting.cancelled || waitingWorkspaceStartups.get(workspaceKey) !== waiting) {
      throw createRuntimeUnavailableError(params);
    }
    const readiness = readinessSnapshot?.readiness;
    if (!readinessSnapshot || !readiness?.ready) {
      const revision = readinessSnapshot?.revision ?? "missing";
      if (waiting.lastLoggedRevision !== revision) {
        waiting.lastLoggedRevision = revision;
        logger.info(
          undefined,
          active
            ? "provider/model 尚未就绪，XCode agent 保持只读"
            : "provider/model 尚未就绪，XCode agent 保持未启动",
          {
            providerCount: readinessSnapshot?.providerCount ?? 0,
            revision: readinessSnapshot?.revision ?? null,
            workspaceKey,
            workspacePath: params.workspacePath,
          },
        );
      }
      throw createProviderNotReadyError({ snapshot: readinessSnapshot, workspace: params });
    }

    const entry = await getOrStartReadOnlyClient(params);
    if (waiting.cancelled) {
      throw createRuntimeUnavailableError(params);
    }
    entry.modelExecutionEnabled = true;
    processManager.markReady(params, entry.client);
    entry.workspace = params;
    waitingWorkspaceStartups.delete(workspaceKey);
    logger.info(undefined, "provider/model 就绪，允许 XCode agent 模型执行", {
      modelId: readiness.modelId,
      providerId: readiness.providerId,
      revision: readinessSnapshot.revision,
      workspaceKey,
      workspacePath: params.workspacePath,
    });
    return entry.client;
  }

  /**
   * 只读热会话的 rowsRange：只复用已运行的工作区 CLI（existing-only），执行端还要认识 residency；
   * 任一不满足都报 proto.sessionNotResident，调用方（手机预加载）跳过，绝不为预加载拉起进程。
   */
  async function getResidentRowsClient(params: XCodeAgentConversationRowsRangeParams) {
    let client: XCodeProtocolClient;
    try {
      client = await getReadOnlyClient(params, "existing-only");
    } catch {
      throw sessionNotResidentError(params.sessionId);
    }
    if (!(await supportsResidentRowsRange(client))) throw sessionNotResidentError(params.sessionId);
    return client;
  }

  async function getReadOnlyClient(
    params: XCodeAgentWorkspaceTarget,
    runtimePolicy: "start-if-needed" | "existing-only" = "start-if-needed",
  ) {
    const client = await getReadOnlyRuntimeClient(params, runtimePolicy);
    rememberClientTarget(client, params);
    return client;
  }

  async function getReadOnlyRuntimeClient(
    params: XCodeAgentWorkspaceTarget,
    runtimePolicy: "start-if-needed" | "existing-only" = "start-if-needed",
  ) {
    if (runtimePolicy === "existing-only") {
      const workspaceKey = resolveWorkspaceKey(params);
      const active = activeClientsByWorkspaceKey.get(workspaceKey);
      // 观察者路径同样要拒绝 disposed 的 stale entry；清理后按“无运行时”处理，
      // 绝不为观察者拉起新进程（保持 existing-only 语义）。
      if (active && isReusableActiveClientEntry(params, active)) {
        active.workspace = params;
        return active.client;
      }
      // runtime available 可能先于原启动调用的 await continuation 到达。这里允许把
      // process manager 已登记的 client 提升为 service active entry，但绝不创建新进程。
      const existingClient = processManager.getExistingClient(params);
      if (!existingClient) {
        throw createRuntimeUnavailableError(params);
      }
      // 共享进程 available 事件可能抢先触发订阅；复用同一准备屏障，不能登记一个未初始化的工作区。
      return (await getOrStartReadOnlyClient(params, existingClient)).client;
    }
    return (await getOrStartReadOnlyClient(params)).client;
  }

  async function getPluginManagementClient(): Promise<XCodeProtocolClient> {
    const workspace = { workspacePath: ensurePluginManagementWorkspacePath() };
    const client = await pluginProcessManager.getClient(workspace);
    wireClient(client, workspace, "plugin");
    return client;
  }

  // 全局工作流的载体运行时选择：
  // 调用方只给 `{ scope: "global" }` 不带 workspace 时，先复用任一已活跃的**本地** runtime
  // （existing-only 语义：只看 activeClientsByWorkspaceKey，绝不为此拉起新进程），否则回落到
  // 管理面 workspace——照 getPluginManagementClient 先例用专用 pluginProcessManager 拉一个控制面
  // runtime。选它而非 getOrStartReadOnlyClient 的理由：workflows/* 是无会话、不依赖 provider/model
  // 就绪的 workspace 级方法，管理面进程正是为这种「不寄居真实项目」的控制面能力准备的，且不会因
  // 真实 workspace 生命周期被 watchdog 回收；getOrStartReadOnlyClient 反而会把这个合成 workspace
  // 塞进 activeClientsByWorkspaceKey 并跑一遍交互偏好同步，污染会话 client map。两条路径都在本机，
  // homedir() 即用户家目录，全局根 `~/.xcode/workflows/` 因此解析到真实目录。
  // 远程 runtime（SSH/WSL identity 或带 remoteSessionId）的 home 不是本机，绝不选它当载体。
  function isLocalActiveWorkspaceClient(workspace: XCodeAgentWorkspaceTarget): boolean {
    return (
      !workspace.remoteSessionId &&
      !(workspace.workspaceIdentity && isRemoteWorkspaceIdentity(workspace.workspaceIdentity))
    );
  }

  async function resolveGlobalSavedWorkflowCarrier(): Promise<{
    client: XCodeProtocolClient;
    workspace: XCodeWorkspaceRef;
  }> {
    for (const active of activeClientsByWorkspaceKey.values()) {
      if (!isLocalActiveWorkspaceClient(active.workspace)) {
        continue;
      }
      // disposed / stale entry 的清理语义与 getReadOnlyClient(existing-only) 一致：
      // isReusableActiveClientEntry 会顺手清掉已回收的 entry，然后我们跳过它继续找。
      if (!isReusableActiveClientEntry(active.workspace, active)) {
        continue;
      }
      return { client: active.client, workspace: buildWorkspaceRef(active.workspace) };
    }
    const managementWorkspace = { workspacePath: ensurePluginManagementWorkspacePath() };
    const client = await getPluginManagementClient();
    return { client, workspace: buildWorkspaceRef(managementWorkspace) };
  }

  // 五个 workflows/* 方法的载体：带 workspace 就直通（项目档，或 GUI 项目组里明说 scope 的动作），
  // 只给 `scope:"global"` 时交给 services 自选本机载体。
  async function resolveSavedWorkflowCarrier(
    params: XCodeAgentSavedWorkflowTarget,
  ): Promise<{ client: XCodeProtocolClient; workspace: XCodeWorkspaceRef }> {
    if (savedWorkflowTargetHasWorkspace(params)) {
      return { client: await getReadOnlyClient(params), workspace: buildWorkspaceRef(params) };
    }
    return resolveGlobalSavedWorkflowCarrier();
  }

  // mcp/list 专用：与插件管理命令隔离进程，见 mcpStatusProcessManager 处的说明。
  async function getMcpStatusClient(): Promise<XCodeProtocolClient> {
    const workspace = { workspacePath: ensurePluginManagementWorkspacePath() };
    const client = await mcpStatusProcessManager.getClient(workspace);
    wireClient(client, workspace, "mcp-status");
    return client;
  }

  function disposeLocalState(): void {
    accountProviderConfigUnsubscribe?.();
    accountProviderConfigUnsubscribe = undefined;
    modelSelectionSubscription?.dispose();
    modelSelectionSubscription = undefined;
    memoryDiagnostics.dispose();
    for (const emitter of sessionEmitters.values()) {
      emitter.dispose();
    }
    sessionEmitters.clear();
    for (const emitter of providerRuntimeHeadersWorkspaceEmitters.values()) {
      emitter.dispose();
    }
    providerRuntimeHeadersWorkspaceEmitters.clear();
    for (const emitter of providerRuntimeHeadersCancelledEmitters.values()) emitter.dispose();
    providerRuntimeHeadersCancelledEmitters.clear();
    sessionRuntimePreferencesRequestEmitter.dispose();
    processResourceSampleEmitter.dispose();
    mcpTelemetryEmitter.dispose();
    toolExecResourceEmitter.dispose();
    mcpResourceSamplesEmitter.dispose();
    pluginStartupDegradedEmitter.dispose();
    for (const emitter of pluginOperationProgressEmitters.values()) {
      emitter.dispose();
    }
    pluginOperationProgressEmitters.clear();
    for (const emitter of conversationFrameEmitters.values()) {
      emitter.dispose();
    }
    conversationFrameEmitters.clear();
    sessionLifecycleEmitter.dispose();
    for (const emitter of conversationTelemetryFactEmitters.values()) {
      emitter.dispose();
    }
    conversationTelemetryFactEmitters.clear();
    contextComposition.dispose();
    for (const collector of remoteConversationTelemetry.values()) collector.dispose();
    remoteConversationTelemetry.clear();
    remoteConversationTelemetryEmitter.dispose();
    for (const emitter of offPeakLifecycleEmitters.values()) emitter.dispose();
    offPeakLifecycleEmitters.clear();
    localTtftFactsEmitter.dispose();
    cuaPermissionObservationEmitter.dispose();
    pluginUiToolResultEmitter.dispose();
    for (const emitter of workspaceConfigFrameEmitters.values()) {
      emitter.dispose();
    }
    workspaceConfigFrameEmitters.clear();
    for (const emitter of sessionsIndexFrameEmitters.values()) {
      emitter.dispose();
    }
    sessionsIndexFrameEmitters.clear();
    sessionEventSequenceStates.clear();
    pendingPermissions.clear();
    pendingUserInputs.clear();
    pendingProviderRuntimeHeaders.clear();
    for (const pending of pendingSessionRuntimePreferences.values()) {
      clearTimeout(pending.timeout);
    }
    pendingSessionRuntimePreferences.clear();
    activeClientsByWorkspaceKey.clear();
    cancelAllWaitingWorkspaceStartups();
    cuaOperationTurnTracker?.clearAll();
    clearV4SubscriptionRoutes();
    v4RouteRuntimeRestartDisposable.dispose();
    runtimeLifecycleDisposable.dispose();
  }

  // 3.12.2：远端灰度读取不能放进客户端就绪与创建命令：失败时串行重试会阻塞普通聊天。
  // 注册只判断本地支持能力；灰度、套餐与模型准入仍由 offPeak/create handler 在取号前校验。
  function isOffPeakToolSupported(params: {
    workspaceIdentity?: string;
    remoteSessionId?: string;
  }): boolean {
    if (!options?.resolveOffPeakClientConfig || !options.resolveOffPeakTaskService) return false;
    if (params.remoteSessionId) return false;
    return !params.workspaceIdentity || !isRemoteWorkspaceIdentity(params.workspaceIdentity);
  }

  /**
   * 服务端「提供」（docs/dynamic-workflow/launch.md「Gray release」）：Host 读取一次并在本进程内固定。
   * 三点理由：
   *   1. 判定落在 client 就绪路径上，不能每次建会话都等远端——3.12.2 已因此回归过一次；
   *   2. 读取失败 fail-closed 且不再重试，避免离线时每条 create 都赔上一次请求超时；
   *   3. 服务端翻转灰度按设计在下一个 Host 进程生效（provider 侧另有 1h 快照与 forceRefresh）。
   * 与 Off-Peak 不同：远程 workspace 同样可用，所以这里不看 workspaceIdentity / remoteSessionId。
   */
  function resolveDynamicWorkflowOffer(): Promise<DynamicWorkflowClientConfig | undefined> {
    const resolve = options?.resolveDynamicWorkflowClientConfig;
    if (!resolve) return Promise.resolve(undefined);
    dynamicWorkflowOffer ??= (async () => {
      try {
        return await resolve();
      } catch (error) {
        logger.warn(undefined, "动态工作流灰度读取失败，按关闭处理", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    })();
    return dynamicWorkflowOffer;
  }

  /** 用户选择（launch.md「The user's choice」）：本机设置权威每次现读；否则用 desktop 推来的值。 */
  async function resolveDynamicWorkflowUserMode(): Promise<DynamicWorkflowMode | undefined> {
    const read = options?.resolveDynamicWorkflowUserMode;
    if (!read) return pushedDynamicWorkflowUserMode;
    try {
      return normalizeDynamicWorkflowMode(await read());
    } catch (error) {
      // 设置读失败不能把功能关掉，也不能阻断建会话：按「跟随服务端」处理。
      logger.warn(undefined, "动态工作流用户选择读取失败，按跟随服务端处理", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * 生效模式 = 闩住的「提供」+ 此刻的用户选择。策略同步与三条创建路径同源调用，所以不会出现
   * "策略说开、create 说关"的裂口；选择不闩，改设置后下一次建会话立刻拿到新值。
   * `onDemand` 原样送到 CLI：它决定十个工具是首请求就注册还是等首次 `/workflow`。
   *
   * 用户选择永远生效（launch.md「The user's choice」）：提供读取失败或拿不到值时按默认 disabled
   * 处理，再套用户选择——过去这里直接返回 disabled，离线启动的 Host 会连用户明确打开的功能一起关掉。
   * 没装配 resolver 的 Host 不接这个功能，选择不生效。
   */
  async function resolveDynamicWorkflowGate(): Promise<DynamicWorkflowMode> {
    if (!options?.resolveDynamicWorkflowClientConfig) return "disabled";
    const offer =
      (await resolveDynamicWorkflowOffer()) ??
      createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default");
    return applyDynamicWorkflowUserMode(offer, await resolveDynamicWorkflowUserMode()).mode;
  }

  /**
   * 把生效模式同步给一个 workspace 的 CLI（launch.md「The user's choice」）。同一 CLI 串行：
   * 每一步在执行时才读生效模式，后入队的步骤必然读到更新的选择，慢请求不会在新结论之后落地。
   * 与 CLI 已持有的策略相同就不发；关闭时发 enabled:false，让在线 CLI 的斜杠目录去掉 workflow。
   */
  function enqueueDynamicWorkflowPolicySync(entry: ActiveWorkspaceClient): Promise<void> {
    const workspaceKey = resolveWorkspaceKey(entry.workspace);
    const previous = dynamicWorkflowPolicySyncByClient.get(entry.client) ?? Promise.resolve();
    const current = previous.then(async () => {
      const mode = await resolveDynamicWorkflowGate();
      if (mode === entry.dynamicWorkflowPolicyMode) return;
      const enabled = isDynamicWorkflowModeEnabled(mode);
      try {
        await entry.client.request(
          zcodeProtocolMethods.workspaceUpdateDynamicWorkflowPolicy,
          // mode 与布尔同行（launch.md「On demand: activation」）；只认布尔的旧 CLI 的 strict
          // schema 会拒绝 mode，走下面的 warn 分支保持缺省关闭——与其它非 -32601 错误同判。
          { workspace: buildWorkspaceRef(entry.workspace), enabled, ...(enabled ? { mode } : {}) },
          zcodeWorkspaceUpdateDynamicWorkflowPolicyResultSchema,
        );
        entry.dynamicWorkflowPolicyMode = mode;
      } catch (error) {
        // 与 Off-Peak 同判据：-32601 是旧 CLI 的正常降级（其 z.object 也会丢掉 session flag，
        // 整体退回 disabled）；其它错误只记 warn，不阻断客户端就绪。
        if (!isProtocolMethodNotFoundError(error)) {
          logger.warn(undefined, "动态工作流策略同步失败，CLI 维持原策略", {
            workspaceKey,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
    dynamicWorkflowPolicySyncByClient.set(entry.client, current);
    return current;
  }

  /** 三条创建路径共用：布尔 + mode 的下发对（关闭时两者都缺席）。 */
  async function resolveDynamicWorkflowSessionFlags(): Promise<{
    dynamicWorkflowEnabled: boolean;
    dynamicWorkflowMode?: DynamicWorkflowMode;
  }> {
    const mode = await resolveDynamicWorkflowGate();
    return isDynamicWorkflowModeEnabled(mode)
      ? { dynamicWorkflowEnabled: true, dynamicWorkflowMode: mode }
      : { dynamicWorkflowEnabled: false };
  }

  async function buildConversationCommandEnvelope(
    params: XCodeAgentConversationCommandParams,
  ): Promise<CommandEnvelope> {
    const envelope = params.envelope;
    // cwd / worktreeCreation / targetCwd 只允许 Host 的 worktree 服务设置（docs/git/worktree.md §5.1）：
    // 渲染进程与手机经 RPC 传来的 JSON 无法携带 Symbol 键，因此不能伪造。
    if (!isHostWorktreeCommand(params)) assertNoHostOnlyWorktreeFields(envelope);
    if (envelope.type === "createSession") {
      const { dynamicWorkflowEnabled, dynamicWorkflowMode } =
        await resolveDynamicWorkflowSessionFlags();
      const payload = commandPayloadSchemas.createSession.parse(envelope.payload);
      if (params.projectId !== undefined && !options?.prepareSessionCreation)
        throw new Error("project.creation-unavailable");
      // 旧请求缺少 ID，必须由持库 Host 原子分配并记住；CLI 去重发生在预留之后。
      const prepared = await options?.prepareSessionCreation?.({
        ...params,
        sessionId: payload.sessionId,
        projectId: params.projectId ?? null,
        creationCommand: { clientId: envelope.clientId, commandId: envelope.commandId },
        additionalDirectories: payload.additionalDirectories,
      });
      const sessionId = prepared?.sessionId ?? payload.sessionId;
      const additionalDirectories =
        prepared?.additionalDirectories ?? payload.additionalDirectories;
      const offPeakToolEnabled = isOffPeakToolSupported(params);
      return {
        ...envelope,
        payload: {
          ...payload,
          ...(dynamicWorkflowEnabled ? { dynamicWorkflowEnabled: true, dynamicWorkflowMode } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(additionalDirectories !== undefined ? { additionalDirectories } : {}),
          ...(offPeakToolEnabled ? { offPeakToolEnabled: true } : {}),
        },
      };
    }
    if (envelope.type !== "sendText") return envelope;

    const payload = commandPayloadSchemas.sendText.parse(envelope.payload);
    // 读取持久化 cronAutomationId 后不能把整个绑定会话永久视为 automation
    // 执行上下文。用户后续主动输入也因此丢失 CronUpdate/CronDelete。这里只认 Host 调度器在
    // 本轮 payload 显式注入的身份；runId/inputId 是追踪字段，CLI 不得用它恢复授权身份。
    if (payload.automationId) {
      // desktop continuous 的 automation 派发不一定经过 task adapter；在协议信封处合并本轮
      // denylist，且不覆盖调用方已有策略。
      return {
        ...envelope,
        payload: {
          ...payload,
          toolDisallowlist: mergeAutomationMutationToolDenylist(payload.toolDisallowlist ?? []),
        },
      };
    }
    if (payload.offPeakTaskId) {
      // 闲时派发轮同型纵深——只 deny OffPeakCreate（OffPeakList 只读保留）。
      return {
        ...envelope,
        payload: {
          ...payload,
          toolDisallowlist: mergeOffPeakMutationToolDenylist(payload.toolDisallowlist ?? []),
        },
      };
    }
    return envelope;
  }

  const service: IXCodeAgentService & { disposeAllAndWait(): Promise<void> } = {
    async prepareStorage(params) {
      const client = await processManager.getClient(params);
      wireClient(client, params, "chat");
      await client.storageStartup.wait();
    },
    async getStorageStartupState(params) {
      return processManager.getStorageStartupState(params);
    },
    onDynamicStorageStartupState(params) {
      const workspaceKey = resolveWorkspaceKey(params);
      return (listener) =>
        processManager.onStorageStartupChanged((event) => {
          if (event.workspaceKey === workspaceKey) listener(event.snapshot);
        });
    },
    hasActiveCuaOperationTurn(): boolean {
      return cuaOperationTurnTracker?.hasActiveTurn() ?? false;
    },
    async initialize(params: XCodeAgentWorkspaceTarget): Promise<XCodeAgentInitializeResult> {
      const workspaceKey = resolveWorkspaceKey(params);
      const startedAt = Date.now();
      logger.info(undefined, "开始初始化 XCode agent", {
        workspaceKey,
        workspacePath: params.workspacePath,
      });
      try {
        const client = await getClient(params);
        logger.info(undefined, "XCode agent 初始化完成", {
          durationMs: Date.now() - startedAt,
          transportKind: client.transportKind === "websocket" ? "websocket" : "stdio",
          workspaceKey,
          workspacePath: params.workspacePath,
        });
        return {
          available: true,
          workspaceKey,
          protocolName: XCODE_PROTOCOL_NAME,
          protocolVersion: XCODE_PROTOCOL_VERSION,
          transportKind: client.transportKind === "websocket" ? "websocket" : "stdio",
        };
      } catch (error) {
        const providerNotReady = isProviderNotReadyError(error);
        logger[providerNotReady ? "info" : "warn"](
          undefined,
          providerNotReady ? "XCode agent 等待 provider/model 就绪" : "XCode agent 初始化失败",
          {
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
            workspaceKey,
            workspacePath: params.workspacePath,
          },
        );
        // initialize 现在承担 host 启动预热职责，但首屏不能因为 agent 缺失直接崩溃。
        // 保留 available=false 结果，让 UI/调用方沿用既有的可恢复错误路径。
        return {
          available: false,
          workspaceKey,
          protocolName: XCODE_PROTOCOL_NAME,
          protocolVersion: XCODE_PROTOCOL_VERSION,
          reason: error instanceof Error ? error.message : String(error),
          ...(providerNotReady ? { reasonCode: XCODE_AGENT_PROVIDER_NOT_READY_REASON } : {}),
        };
      }
    },

    async syncDynamicWorkflowUserMode(params: { mode?: DynamicWorkflowMode }): Promise<void> {
      // launch.md「The user's choice」：本机有设置权威时传入值只是变更信号，以设置文件为准；
      // desktop-attached remote Host 没有本机设置，推来的值就是选择。
      pushedDynamicWorkflowUserMode = normalizeDynamicWorkflowMode(params.mode);
      options?.forwardDynamicWorkflowUserMode?.(await resolveDynamicWorkflowUserMode());
      // 修复原因：这里原先 await 每个在线 CLI 的策略应答。CLI 正忙（如在途的 readPresentation）
      // 或还在启动时，调用迟迟不返回，renderer 的可用性快照就一直停在旧模式——用户选「关闭」后
      // 自动化页仍显示「工作流」标签（DWG-23）。快照只由 Host 的服务端提供与用户选择算出，与 CLI
      // 无关，所以选择记下即返回；CLI 重发仍走各自的串行链，不等它。
      for (const entry of activeClientsByWorkspaceKey.values()) {
        enqueueDynamicWorkflowPolicySync(entry).catch((error: unknown) => {
          logger.warn(undefined, "动态工作流策略重发失败", {
            workspaceKey: resolveWorkspaceKey(entry.workspace),
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        });
      }
    },

    async syncAppRuntimePreferences(preferences: XCodeAgentAppRuntimePreferences): Promise<void> {
      const normalizedPreferences: XCodeAgentAppRuntimePreferences = {
        ...preferences,
        modelIoFullRetentionEnabled: preferences.modelIoFullRetentionEnabled === true,
        pluginAutoRecommendationEnabled: preferences.pluginAutoRecommendationEnabled === true,
      };
      latestAppRuntimePreferences = normalizedPreferences;
      const activeClients = [...activeClientsByWorkspaceKey.values()];
      await Promise.all(
        activeClients.map((entry) =>
          enqueueInteractionPreferenceSync({
            client: entry.client,
            preferences: { ...normalizedPreferences },
            workspace: entry.workspace,
          }),
        ),
      );
    },

    async getWorkspaceRuntimeIdentity(params: XCodeAgentWorkspaceTarget) {
      // 查询 runtime identity 只能观察现有进程，不能把 dormant workspace 变成活动进程。
      await getReadOnlyClient(params, "existing-only");
      return await processManager.getRuntimeIdentity(params);
    },

    async createSession(params: XCodeAgentCreateSessionParams) {
      if (options?.prepareSessionCreation) {
        const prepared = await options.prepareSessionCreation({
          ...params,
          projectId: params.projectId ?? null,
        });
        params = {
          ...params,
          sessionId: prepared.sessionId,
          additionalDirectories: params.additionalDirectories ?? prepared.additionalDirectories,
        };
      } else if (params.projectId !== undefined) {
        throw new Error("project.creation-unavailable");
      }
      const startedAt = Date.now();
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "session_create",
        workspace: params,
        refreshRegistry: true,
      });
      const sessionTraceId = params.sessionTraceId;
      logger.info(sessionTraceId, "开始请求 XCode Protocol session/create", {
        hasInitialModel: params.model !== undefined,
        hasInitialThoughtLevel: params.thoughtLevel !== undefined,
        initialModel: formatModelSelectionForLog(params.model),
        mcpServerCount: getMcpServerCount(params),
        mcpServerNames: getMcpServerNames(params),
        persistence: params.persistence,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      const offPeakToolEnabled = isOffPeakToolSupported(params);
      // 灰度在 client 就绪时已判定，这里是进程内已解析 promise 的再次 await（不打远端）。
      const dynamicWorkflowFlags = await resolveDynamicWorkflowSessionFlags();
      try {
        const snapshot = await client.request(
          zcodeProtocolMethods.sessionCreate,
          buildSessionCreateParams({ ...params, offPeakToolEnabled, ...dynamicWorkflowFlags }),
          zcodeSessionStateSnapshotSchema,
          sessionTraceId ? { trace: { traceId: sessionTraceId } } : undefined,
        );
        rememberSessionTrace({ ...params, sessionId: snapshot.session.sessionId }, snapshot);
        logger.info(sessionTraceId, "XCode Protocol session/create 完成", {
          durationMs: Date.now() - startedAt,
          messageCount: snapshot.messages.length,
          modelCurrent: formatModelSelectionForLog(snapshot.settings.model.current),
          mcpServerCount: getMcpServerCount(params),
          persistence: params.persistence,
          sessionId: snapshot.session.sessionId,
          snapshotTraceId: snapshot.session.traceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      } catch (error) {
        const compatFields = getSessionCreateCompatFields(error);
        if (compatFields.length === 0) {
          logger.warn(sessionTraceId, "XCode Protocol session/create 失败", {
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
            persistence: params.persistence,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          throw error;
        }
        logger.warn(sessionTraceId, "XCode Protocol session/create 命中新旧协议兼容重试", {
          compatFields,
          durationMs: Date.now() - startedAt,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        // host/UI 可能已经发送新版 session/create 可选字段，但本地打包、
        // 远端部署或仍存活的旧 app-server 还在使用旧 strict schema。只对已知
        // 可选字段降级重试，避免 thoughtLevel/persistence 版本差阻塞首发创建。
        const snapshot = await client.request(
          zcodeProtocolMethods.sessionCreate,
          buildSessionCreateParams(
            { ...params, offPeakToolEnabled, ...dynamicWorkflowFlags },
            new Set(compatFields),
          ),
          zcodeSessionStateSnapshotSchema,
          sessionTraceId ? { trace: { traceId: sessionTraceId } } : undefined,
        );
        rememberSessionTrace({ ...params, sessionId: snapshot.session.sessionId }, snapshot);
        if (!compatFields.includes("thoughtLevel") || !params.thoughtLevel) {
          logger.info(sessionTraceId, "XCode Protocol session/create 兼容重试完成", {
            durationMs: Date.now() - startedAt,
            sessionId: snapshot.session.sessionId,
            snapshotTraceId: snapshot.session.traceId ?? null,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          return snapshot;
        }
        // 旧 create schema 不认识 thoughtLevel 时，创建后再走旧协议已有的
        // session/setThoughtLevel，保证首轮 prompt 仍使用用户在工具栏选择的推理强度。
        const snapshotWithThoughtLevel = await client.request(
          zcodeProtocolMethods.sessionSetThoughtLevel,
          {
            sessionId: snapshot.session.sessionId,
            thoughtLevel: params.thoughtLevel,
            persistAsWorkspaceLastUsed: true,
          },
          zcodeSessionStateSnapshotSchema,
          sessionTraceId ? { trace: { traceId: sessionTraceId } } : undefined,
        );
        rememberSessionTrace(
          { ...params, sessionId: snapshotWithThoughtLevel.session.sessionId },
          snapshotWithThoughtLevel,
        );
        logger.info(
          sessionTraceId,
          "XCode Protocol session/create 兼容重试后设置 thoughtLevel 完成",
          {
            durationMs: Date.now() - startedAt,
            sessionId: snapshot.session.sessionId,
            snapshotTraceId: snapshotWithThoughtLevel.session.traceId ?? null,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          },
        );
        return snapshotWithThoughtLevel;
      }
    },

    async resumeSession(params: XCodeAgentResumeSessionParams) {
      const client = await getClient(params);
      params = {
        ...params,
        additionalDirectories:
          params.additionalDirectories ?? (await readSessionDirectories(client, params)),
      };
      const startedAt = Date.now();
      await ensureAccountProviderConfigSynced({
        client,
        reason: "session_resume",
        workspace: params,
        refreshRegistry: true,
      });
      const cachedTraceId = getSessionTraceId(params);
      const offPeakToolEnabled = isOffPeakToolSupported(params);
      // 冷恢复同样按 Host 的灰度判定下发，否则恢复出来的会话会丢掉工作流工具簇。
      const dynamicWorkflowFlags = await resolveDynamicWorkflowSessionFlags();
      logger.info(cachedTraceId, "开始请求 XCode Protocol session/resume", {
        mcpServerCount: getMcpServerCount(params),
        mcpServerNames: getMcpServerNames(params),
        modelHint: params.model ?? null,
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const snapshot = await client.request(
          zcodeProtocolMethods.sessionResume,
          buildSessionResumeParams({ ...params, offPeakToolEnabled, ...dynamicWorkflowFlags }),
          zcodeSessionStateSnapshotSchema,
        );
        const sessionTraceId = rememberSessionTrace(params, snapshot) ?? cachedTraceId;
        logger.info(sessionTraceId, "XCode Protocol session/resume 完成", {
          durationMs: Date.now() - startedAt,
          messageCount: snapshot.messages.length,
          modelCurrent: formatModelSelectionForLog(snapshot.settings.model.current),
          mcpServerCount: getMcpServerCount(params),
          sessionId: params.sessionId,
          snapshotTraceId: snapshot.session.traceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      } catch (error) {
        const compatFields = getSessionResumeCompatFields(error);
        if (compatFields.length === 0) {
          logger.warn(cachedTraceId, "XCode Protocol session/resume 失败", {
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
            sessionId: params.sessionId,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          throw error;
        }
        logger.warn(cachedTraceId, "XCode Protocol session/resume 命中新旧协议兼容重试", {
          compatFields,
          durationMs: Date.now() - startedAt,
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        const snapshot = await client.request(
          zcodeProtocolMethods.sessionResume,
          buildSessionResumeParams(
            { ...params, offPeakToolEnabled, ...dynamicWorkflowFlags },
            new Set(compatFields),
          ),
          zcodeSessionStateSnapshotSchema,
        );
        const sessionTraceId = rememberSessionTrace(params, snapshot) ?? cachedTraceId;
        logger.info(sessionTraceId, "XCode Protocol session/resume 兼容重试完成", {
          durationMs: Date.now() - startedAt,
          sessionId: params.sessionId,
          snapshotTraceId: snapshot.session.traceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      }
    },

    async listSessions(params: XCodeAgentListSessionsParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      const result = await client.request(
        zcodeProtocolMethods.sessionList,
        {
          workspace: buildWorkspaceRef(params),
          limit: params.limit,
          ...(params.sessionIds ? { sessionIds: params.sessionIds } : {}),
        },
        zcodeSessionListResultSchema,
      );
      for (const session of result.sessions) {
        if (session.traceId) {
          sessionTraceIdBySessionKey.set(
            sessionEventKey({ ...params, sessionId: session.sessionId }),
            session.traceId as TraceId,
          );
        }
      }
      return result.sessions;
    },

    async listSessionSubagents(params: XCodeAgentListSessionSubagentsParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.sessionSubagents,
        {
          sessionId: params.sessionId,
          endedCursor: params.endedCursor,
          endedLimit: params.endedLimit ?? 20,
        },
        zcodeSessionSubagentsResultSchema,
      );
    },

    async getAppUsageStats(params: XCodeAgentAppUsageParams) {
      // usage 表位于全局 session 库；复用任意已连接的 workspace client 即可拿到全应用范围数据。
      const active = activeClientsByWorkspaceKey.values().next().value;
      if (!active) {
        throw new Error("no_active_workspace");
      }
      // usage/stats → v4/usage/stats（additive query，事实源在 CLI usage store，
      // 载荷同形；旧词消费清零，CLI 旧 case 留到旧词删除之时）。
      return active.client.request(
        V4_METHODS.usageStats,
        { range: params.range, timeZone: params.timeZone },
        v4UsageStatsResultSchema,
      );
    },

    async getUsageRequestDetails(params: XCodeAgentUsageRequestDetailsParams) {
      // usage 表位于全局 session 库；复用任意已连接的 workspace client 即可拿到全应用范围数据。
      const active = activeClientsByWorkspaceKey.values().next().value;
      if (!active) {
        throw new Error("no_active_workspace");
      }
      // 「使用详情」→ v4/usage/requestDetails（additive query，同 usage/stats 的事实源）。
      return active.client.request(
        V4_METHODS.usageRequestDetails,
        {
          page: params.page,
          pageSize: params.pageSize,
          ...(params.since !== undefined ? { since: params.since } : {}),
          ...(params.until !== undefined ? { until: params.until } : {}),
          ...(params.providerId ? { providerId: params.providerId } : {}),
          ...(params.modelId ? { modelId: params.modelId } : {}),
          ...(params.sessionId ? { sessionId: params.sessionId } : {}),
          ...(params.status ? { status: params.status } : {}),
        },
        v4UsageRequestDetailsResultSchema,
      );
    },

    async previewSessionDeletion(params) {
      const client = isLocalActiveWorkspaceClient(params.workspace)
        ? await getReadOnlyClient(params.workspace, "existing-only").catch(() =>
            getPluginManagementClient(),
          )
        : await getReadOnlyClient(params.workspace, "existing-only");
      return client.request(
        V4_METHODS.sessionDeletionPreview,
        params,
        v4SessionDeletionPreviewSchema,
      );
    },
    async executeSessionDeletion(params) {
      const client = isLocalActiveWorkspaceClient(params.workspace)
        ? await getReadOnlyClient(params.workspace, "existing-only").catch(() =>
            getPluginManagementClient(),
          )
        : await getReadOnlyClient(params.workspace, "existing-only");
      return client.request(
        V4_METHODS.sessionDeletionExecute,
        params,
        v4SessionDeletionResultSchema,
      );
    },

    async measureSessionData(params) {
      // 只读测量：和全局工作流同一载体选择（本机已活跃 runtime，否则管理面进程）。
      const { client } = await resolveGlobalSavedWorkflowCarrier();
      return client.request(
        V4_METHODS.sessionDataMeasure,
        { sessionIds: params.sessionIds, directories: params.directories },
        v4SessionDataMeasureResultSchema,
      );
    },

    async purgeSessionData({ workspace, ...params }) {
      if (!isLocalActiveWorkspaceClient(workspace)) throw new Error("project.data-local-only");
      // 会话可能已加载在该 cwd 的 Agent 进程里：必须由那个进程删除，它才能判断运行中并释放会话；
      // 绝不为删除拉起该项目的 Agent（文件夹可能已不存在），没有进程时交给管理面进程。
      const client = await getReadOnlyClient(workspace, "existing-only").catch(() =>
        getPluginManagementClient(),
      );
      return client.request(V4_METHODS.sessionDataPurge, params, v4SessionDataPurgeResultSchema);
    },

    async getTaskTokenUsage(params: XCodeAgentTaskTokenUsageParams) {
      const client = await getReadOnlyClient(params);
      // session/usage → v4/conversation/usage（同上；task 是 UI 投影概念，
      // v4 名字空间落位 conversation）。
      return client.request(
        V4_METHODS.conversationUsage,
        { sessionId: params.sessionId },
        v4ConversationUsageResultSchema,
      );
    },

    async readSession(params: XCodeAgentReadSessionParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      // task-index 为补正文索引调用 readSession 时，默认策略会在 runtime
      // 已被回收后重新拉起 Agent；这条观察路径不应改变 session 生命周期。只有显式
      // 的普通读取才同步 provider registry，existing-only 读取必须保持纯观察语义。
      if (params.runtimePolicy !== "existing-only") {
        await ensureAccountProviderConfigSynced({
          client,
          reason: "session_read",
          workspace: params,
        });
      }
      const snapshot = await client.request(
        zcodeProtocolMethods.sessionRead,
        {
          sessionId: params.sessionId,
          deliveryKind: params.deliveryKind,
          messageLimit: params.messageLimit,
          afterSeq: params.afterSeq,
          contentProfile: params.contentProfile,
        },
        zcodeSessionStateSnapshotSchema,
      );
      rememberSessionTrace(params, snapshot);
      return snapshot;
    },

    async readSessionMessages(params: XCodeAgentReadSessionMessagesParams) {
      const client = await getReadOnlyClient(params);
      const result = await client.request(
        zcodeProtocolMethods.sessionMessages,
        {
          sessionId: params.sessionId,
          afterMessageId: params.afterMessageId,
          limit: params.limit,
          direction: params.direction,
        },
        zcodeSessionMessagesResultSchema,
      );
      return result.messages;
    },

    async readSessionDebug(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      return client.request(
        zcodeProtocolMethods.sessionDebug,
        { sessionId: params.sessionId },
        sessionDebugSnapshotSchema,
      );
    },

    async readSessionEvents(params: XCodeAgentReadSessionEventsParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      const result = await client.request(
        zcodeProtocolMethods.sessionEvents,
        {
          sessionId: params.sessionId,
          afterSeq: params.afterSeq,
          limit: params.limit,
        },
        zcodeSessionEventsResultSchema,
      );
      return result.events;
    },

    async readWorkspacePresentation(params: XCodeAgentReadWorkspacePresentationParams) {
      const startedAt = Date.now();
      logger.info(undefined, "开始请求 XCode Protocol workspace/readPresentation", {
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        let presentation: XCodeWorkspacePresentation | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const client = await getReadOnlyClient(params);
          try {
            await ensureAccountProviderConfigSynced({
              client,
              reason: "workspace_read_presentation",
              workspace: params,
            });
            presentation = await client.request(
              zcodeProtocolMethods.workspaceReadPresentation,
              { workspace: buildWorkspaceRef(params) },
              zcodeWorkspacePresentationSchema,
            );
            break;
          } catch (error) {
            if (attempt > 0 || !isClosedStdioTransportError(error)) {
              throw error;
            }
            // 读取 workspace 状态时，配置更新可能正好重启该 workspace Agent。
            // 旧 client 已取得但尚未发送请求，stdio transport 就被关闭；只读请求重新获取
            // 当前 client 并重试一次，避免把生命周期竞态直接暴露给用户。
            logger.warn(
              undefined,
              "workspace/readPresentation 命中已关闭 transport，重新获取 Agent",
              {
                workspaceKey: resolveWorkspaceKey(params),
                workspacePath: params.workspacePath,
              },
            );
            const workspaceKey = resolveWorkspaceKey(params);
            if (activeClientsByWorkspaceKey.get(workspaceKey)?.client === client) {
              // transport.send 可能先观察到关闭，而 onClose 清理尚未执行；统一走 identity-
              // guarded invalidation，避免只删 active entry 却遗留 preference/model sync 状态。
              invalidateWorkspaceClient(workspaceKey, client);
            }
          }
        }
        if (!presentation) {
          throw new Error("XCode Protocol workspace/readPresentation did not return a result");
        }
        logger.info(undefined, "XCode Protocol workspace/readPresentation 完成", {
          durationMs: Date.now() - startedAt,
          slashCommandCount: presentation.slashCommands.length,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return presentation;
      } catch (error) {
        logger.warn(undefined, "XCode Protocol workspace/readPresentation 失败", {
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async grantWorkspaceHookTrust(params: XCodeAgentGrantWorkspaceHookTrustParams) {
      // 没有 task 时仍允许显式预信任，但只启动 read-only Agent 控制面；不能为了
      // Settings 操作伪造 session，也不能要求 provider/model 已就绪。
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.workspaceHookTrustGrant,
        {
          workspace: buildWorkspaceRef(params),
          bundleDigest: params.bundleDigest,
          hookDeclarationDigest: params.hookDeclarationDigest,
        },
        zcodeWorkspaceHookTrustGrantResultSchema,
      );
    },

    async setWorkspaceMcpTrust(params) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.workspaceMcpTrust,
        {
          workspace: buildWorkspaceRef(params),
          serverName: params.serverName,
          declarationDigest: params.declarationDigest,
          trusted: params.trusted,
        },
        zcodeWorkspaceMcpTrustResultSchema,
      );
    },

    async listMcpServerStatuses(params: XCodeAgentListMcpServerStatusesParams) {
      const requestMcpList = async (options?: { omitMcpServers?: boolean; omitMode?: boolean }) => {
        const client = await getMcpStatusClient();
        // 管理目录只是进程载体；先登记本次实际探测目标，反向授权才能精确校验归属。
        // 放在重试闭包内，兼容重试和进程重建都不会遗漏登记。
        rememberClientTarget(client, params);
        return client.request(
          zcodeProtocolMethods.mcpList,
          {
            workspace: buildWorkspaceRef(params),
            ...(params.mcpServers !== undefined && !options?.omitMcpServers
              ? { mcpServers: params.mcpServers }
              : {}),
            ...(params.mode !== undefined && !options?.omitMode ? { mode: params.mode } : {}),
          },
          zcodeMcpListResultSchema,
        );
      };
      try {
        return await requestMcpList();
      } catch (error) {
        const unrecognizedKeys = getUnrecognizedTopLevelKeys(error);
        if (params.mode === "status" && unrecognizedKeys.includes("mode")) {
          // 旧 Agent 不认识 status-only 时，省略 mode 重试会退回默认 connect，
          // 重新执行 replace 收敛并可能断开 UI 显式下发但旧 Agent 配置中不存在的 MCP；
          // 稳定错误码会跨 host RPC 保留，供 UI 停止不可能成功的轮询。
          logger.warn(undefined, "旧 Agent 不支持 MCP status-only，跳过会改变连接集合的兼容重试", {
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          throw new XCodeAgentMcpStatusModeUnsupportedError();
        }
        if (
          (params.mode !== undefined && unrecognizedKeys.includes("mode")) ||
          (params.mcpServers !== undefined && unrecognizedKeys.includes("mcpServers"))
        ) {
          const omitMode = unrecognizedKeys.includes("mode");
          const omitMcpServers = unrecognizedKeys.includes("mcpServers");
          if (omitMcpServers && params.mcpServers?.some((server) => server.scope === "workspace")) {
            throw new Error("workspace_mcp_trust_unavailable");
          }
          logger.warn(undefined, "MCP 状态列表命中新旧协议兼容重试", {
            omittedKeys: [...(omitMode ? ["mode"] : []), ...(omitMcpServers ? ["mcpServers"] : [])],
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          return await requestMcpList({
            omitMcpServers,
            omitMode,
          });
        }
        if (!isProtocolRequestTimeout(error, zcodeProtocolMethods.mcpList)) {
          throw error;
        }
        logger.warn(undefined, "MCP 状态列表请求超时，重启无响应 agent 后重试一次", {
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
          message: error instanceof Error ? error.message : String(error),
        });
        return await requestMcpList();
      }
    },

    async listPlugins(params: XCodeAgentPluginViewParams) {
      const requestPluginsList = async () => {
        const client = await getPluginManagementClient();
        // plugins/list 只读取本地 plugin metadata，与 mcp/list 一样走默认协议超时，
        // 这样 stale client 能在合理时间内触发回收并重试，而不是被 5 分钟市场 I/O 超时拖住。
        return client.request(
          zcodeProtocolMethods.pluginsList,
          {
            workspace: buildWorkspaceRef(params),
            ...(params.configScope ? { configScope: params.configScope } : {}),
          },
          zcodePluginsListResultSchema,
        );
      };
      try {
        return await requestPluginsList();
      } catch (error) {
        if (!isProtocolRequestTimeout(error, zcodeProtocolMethods.pluginsList)) {
          throw error;
        }
        logger.warn(undefined, "插件列表请求超时，重启无响应 agent 后重试一次", {
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
          message: error instanceof Error ? error.message : String(error),
        });
        // 插件列表只读取 CLI plugin metadata。若旧 agent 进程还活着但协议不回包，
        // 第一次 plugins/list 超时后不能继续复用 stale client。process manager 会在超时时回收该 client，
        // 这里对幂等的列表请求重试一次，让设置页可从重新拉起的 app-server 自动恢复。
        return await requestPluginsList();
      }
    },

    async getPluginReferenceCatalog(params: XCodeAgentPluginReferenceCatalogParams) {
      // Plugin 引用 catalog 必须打到持有 session 记录的 workspace agent client
      // （getReadOnlyClient 优先复用 active client），不能走独立 plugin management 进程——
      // 那个进程没有任何 session，session-owned catalog 会永远查不到。
      const client = await getReadOnlyClient(params);
      return requestPluginReferenceCatalog(client, {
        workspace: buildWorkspaceRef(params),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      });
    },

    async getSkillReferenceCatalog(params: XCodeAgentSkillReferenceCatalogParams) {
      // 与 Plugin 引用一样，Session 快照只存在于 workspace agent 进程；独立管理进程
      // 没有 resident Session，不能作为对话 authority。
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.skillsReferenceCatalog,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        },
        zcodeSkillsReferenceCatalogResultSchema,
      );
    },

    async openMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiOpenInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          accountContext: params.accountContext,
          resourceUri: params.resourceUri,
          ownerWebContentsId: params.ownerWebContentsId,
        },
        zcodeMcpUiOpenInstanceResultSchema,
      );
    },
    async validateMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      await client.request(
        zcodeProtocolMethods.mcpUiValidateInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          instance: params.instance,
        },
        mcpUiEmptyResultSchema,
      );
    },
    async recycleMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      const result = await client.request(
        zcodeProtocolMethods.mcpUiCloseInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          instance: params.instance,
          onlyIfIdle: true,
        },
        zcodeMcpUiCloseInstanceResultSchema,
      );
      return result.closed;
    },
    async closeMcpUiInstance(params) {
      const client = await getReadOnlyClient(params);
      await client.request(
        zcodeProtocolMethods.mcpUiCloseInstance,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          pluginId: params.pluginId,
          serverName: params.serverName,
          instance: params.instance,
        },
        zcodeMcpUiCloseInstanceResultSchema,
      );
    },
    async readMcpResource(params: XCodeAgentReadMcpResourceParams) {
      // 与 Skill / Plugin 引用一样，session 冻结 catalog 只存在于 workspace agent 进程。
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpReadResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          uri: params.uri,
        },
        zcodeMcpReadResourceResultSchema,
      );
    },

    async sampleMcpApp(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      const { workspacePath: _path, workspaceIdentity: _identity, ...bound } = params;
      const wire = { ...bound, workspace: buildWorkspaceRef(params) };
      try {
        return await client.request(
          zcodeProtocolMethods.mcpUiSampling,
          wire,
          zcodeMcpUiSamplingResultSchema,
          { timeoutMs: MCP_APPS_SAMPLING_TRANSPORT_TIMEOUT_MS },
        );
      } catch (error) {
        // 超时/通道失败只取消原调用，不能恢复 Agent 并重新发起采样。
        const { request: _request, ...cancelParams } = wire;
        void client
          .request(
            zcodeProtocolMethods.mcpUiCancelSampling,
            cancelParams,
            zcodeMcpUiCancelCallResultSchema,
          )
          .catch(() => undefined);
        throw error;
      }
    },
    async cancelMcpAppSampling(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      const { workspacePath: _path, workspaceIdentity: _identity, ...bound } = params;
      return client.request(
        zcodeProtocolMethods.mcpUiCancelSampling,
        { ...bound, workspace: buildWorkspaceRef(params) },
        zcodeMcpUiCancelCallResultSchema,
      );
    },
    async callMcpToolForUi(params: XCodeAgentCallMcpToolForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiCallTool,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          toolName: params.toolName,
          ...(params.arguments ? { arguments: params.arguments } : {}),
          callId: params.callId,
        },
        zcodeMcpUiCallToolResultSchema,
      );
    },

    async cancelMcpToolCallForUi(params: XCodeAgentCancelMcpToolCallForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiCancelCall,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          callId: params.callId,
        },
        zcodeMcpUiCancelCallResultSchema,
      );
    },

    async readMcpResourceForUi(params: XCodeAgentReadMcpResourceForUiParams) {
      // 与 callMcpToolForUi 同一进程：归属（pluginId ↔ serverName）、mimeType 白名单与 8 MiB 上限都在 agent 侧 fail closed。
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiReadResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          uri: params.uri,
        },
        zcodeMcpUiReadResourceResultSchema,
      );
    },

    async listMcpResourcesForUi(params: XCodeAgentListMcpResourcesForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiListResources,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
        zcodeMcpUiListResourcesResultSchema,
      );
    },

    async listMcpResourceTemplatesForUi(params: XCodeAgentListMcpResourcesForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiListResourceTemplates,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
        zcodeMcpUiListResourceTemplatesResultSchema,
      );
    },

    async subscribeMcpResourceForUi(params: XCodeAgentMcpResourceSubscriptionForUiParams) {
      // 订阅登记在 agent 侧（按 server / uri 引用计数并随重连重放）；host 只转发身份三元组。
      const client = await getReadOnlyClient(params);
      await client.request(
        zcodeProtocolMethods.mcpUiSubscribeResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          uri: params.uri,
        },
        zcodeMcpUiResourceSubscriptionResultSchema,
      );
    },

    async unsubscribeMcpResourceForUi(params: XCodeAgentMcpResourceSubscriptionForUiParams) {
      const client = await getReadOnlyClient(params);
      await client.request(
        zcodeProtocolMethods.mcpUiUnsubscribeResource,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          uri: params.uri,
        },
        zcodeMcpUiResourceSubscriptionResultSchema,
      );
    },

    async registerAppToolsForUi(params: XCodeAgentRegisterAppToolsForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiRegisterAppTools,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          tools: params.tools,
        },
        zcodeMcpUiRegisterAppToolsResultSchema,
      );
    },

    async unregisterAppToolsForUi(params: XCodeAgentAppToolInstanceForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiUnregisterAppTools,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
        },
        zcodeMcpUiUnregisterAppToolsResultSchema,
      );
    },

    async claimAppToolCallForUi(params: XCodeAgentAppToolCallForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiClaimAppToolCall,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          callId: params.callId,
        },
        zcodeMcpUiAppToolAcceptedResultSchema,
      );
    },

    async resolveAppToolCallForUi(params: XCodeAgentResolveAppToolCallForUiParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.mcpUiResolveAppToolCall,
        {
          workspace: buildWorkspaceRef(params),
          sessionId: params.sessionId,
          instance: params.instance,
          pluginId: params.pluginId,
          serverName: params.serverName,
          scopeId: params.scopeId,
          generation: params.generation,
          callId: params.callId,
          ...(params.result ? { result: params.result } : {}),
          ...(params.error ? { error: params.error } : {}),
        },
        zcodeMcpUiAppToolAcceptedResultSchema,
      );
    },

    async listPluginUiSurfaces(params: XCodeAgentWorkspaceTarget) {
      // 面板只在已有会话时可打开，此时 workspace agent 必然存在；走 read-only client 读它解析好的清单，
      // 不用独立插件管理进程（那边没有本 workspace 的启停状态上下文，与 mcp/readResource 同理）。
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.pluginsListUiSurfaces,
        { workspace: buildWorkspaceRef(params) },
        zcodePluginsListUiSurfacesResultSchema,
      );
    },

    // 已保存工作流的 GUI 中枢：与 Skill catalog 同一条
    // workspace agent client 路径；文件在 workspace 里，远程 workspace 就在远端进程里扫。
    // 全局档：载体由 resolveSavedWorkflowCarrier 选，
    // `scope` 只在有定义时下推。
    async listSavedWorkflows(params: XCodeAgentListSavedWorkflowsParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        zcodeProtocolMethods.workflowsList,
        { workspace, ...savedWorkflowScopeParam(params) },
        zcodeWorkflowsListResultSchema,
      );
    },

    async getSavedWorkflow(params: XCodeAgentGetSavedWorkflowParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        zcodeProtocolMethods.workflowsGet,
        { workspace, name: params.name, ...savedWorkflowScopeParam(params) },
        zcodeWorkflowsGetResultSchema,
      );
    },

    async updateSavedWorkflowMeta(params: XCodeAgentUpdateSavedWorkflowMetaParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        zcodeProtocolMethods.workflowsUpdateMeta,
        { workspace, name: params.name, meta: params.meta, ...savedWorkflowScopeParam(params) },
        zcodeWorkflowsUpdateMetaResultSchema,
      );
    },

    async deleteSavedWorkflow(params: XCodeAgentDeleteSavedWorkflowParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        zcodeProtocolMethods.workflowsDelete,
        { workspace, name: params.name, ...savedWorkflowScopeParam(params) },
        zcodeWorkflowsDeleteResultSchema,
      );
    },

    async listSavedWorkflowRuns(params: XCodeAgentListSavedWorkflowRunsParams) {
      const { client, workspace } = await resolveSavedWorkflowCarrier(params);
      return client.request(
        zcodeProtocolMethods.workflowsRuns,
        {
          workspace,
          ...(params.name === undefined ? {} : { name: params.name }),
          limit: params.limit,
          ...savedWorkflowScopeParam(params),
        },
        zcodeWorkflowsRunsResultSchema,
      );
    },

    // 把全局档搬回项目档（只此一向）：
    // `workspace` 必带，既是载体又是目标项目（协议处理器据它算项目根），因此走
    // getReadOnlyClient(params) 直通，不经全局载体选择。
    async moveSavedWorkflow(params: XCodeAgentMoveSavedWorkflowParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.workflowsMove,
        { workspace: buildWorkspaceRef(params), name: params.name },
        zcodeWorkflowsMoveResultSchema,
      );
    },

    // 完成卡的「直接保存」（docs/dynamic-workflow/transcript-and-notifications.md）：必须打到
    // **这次 run 所属 workspace** 的 agent client——脚本从那个进程的 journal 里读，全局档也一样
    // （落点由 agent 按 scope 算，与载体无关）。因此走 getReadOnlyClient 直通，不经全局载体选择。
    async saveSavedWorkflowFromRun(params: XCodeAgentSaveSavedWorkflowFromRunParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.workflowsSave,
        {
          workspace: buildWorkspaceRef(params),
          runId: params.runId,
          name: params.name,
          meta: params.meta,
          ...(params.scope === undefined ? {} : { scope: params.scope }),
          ...(params.overwrite === undefined ? {} : { overwrite: params.overwrite }),
        },
        zcodeWorkflowsSaveResultSchema,
      );
    },

    async findSavedWorkflowForRun(params: XCodeAgentFindSavedWorkflowForRunParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        zcodeProtocolMethods.workflowsForRun,
        {
          workspace: buildWorkspaceRef(params),
          runId: params.runId,
          ...(params.candidates === undefined ? {} : { candidates: [...params.candidates] }),
        },
        zcodeWorkflowsForRunResultSchema,
      );
    },

    async resolveSuggestedPluginReference(params: XCodeAgentResolveSuggestedPluginReferenceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsResolveSuggestedReference,
        {
          workspace: buildWorkspaceRef(params),
          stableId: params.stableId,
          operationId: params.operationId,
          clientMode: params.clientMode,
          deliveryKind: params.deliveryKind,
        },
        zcodePluginsResolveSuggestedReferenceResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    onDynamicPluginOperationProgress(operationId: string) {
      return getPluginOperationProgressEmitter(operationId).event;
    },

    async collectLocalRuntimeChildProcesses(signal?: AbortSignal) {
      const managed = [processManager, pluginProcessManager, mcpStatusProcessManager]
        .flatMap((manager) => manager.listManagedProcesses())
        .filter(
          (runtime) => !runtime.client.isDisposed && !runtime.client.storageStartup.isWaiting,
        );
      return Promise.all(
        managed.map(async (runtime) => {
          let children: XCodeProcessChildProcess[] = [];
          try {
            const result = await runtime.client.request(
              zcodeProtocolMethods.processChildProcesses,
              {},
              zcodeProcessChildProcessesResultSchema,
              { timeoutMs: CHILD_PROCESSES_REQUEST_TIMEOUT_MS, lifecycle: "observation", signal },
            );
            children = result.processes;
          } catch {
            // 旧 CLI 不认识该方法或 runtime 正忙：本轮该 Agent 的后代全部归 cli，不影响其它 runtime。
          }
          return {
            pid: runtime.pid,
            provider: XCODE_AGENT_PROVIDER,
            workspacePath: runtime.workspacePath,
            ...(runtime.lane ? { lane: runtime.lane } : {}),
            children,
          };
        }),
      );
    },

    async getPluginsOverview(params: XCodeAgentPluginViewParams) {
      const client = await getPluginManagementClient();
      // 扩展摘要只向声明了能力位的 CLI 要（docs/plugins/plugin-publishing.md §4.3）：参数与结果都是
      // strict，旧 CLI 收到新参数整条拒绝；不要时 CLI 也不带，旧 services 不会解析到新键。
      const includeExtensionSummary = await supportsPluginExtensionSummary(client);
      return client.request(
        zcodeProtocolMethods.pluginsOverview,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.configScope ? { configScope: params.configScope } : {}),
          ...(includeExtensionSummary ? { includeExtensionSummary: true } : {}),
        },
        zcodePluginsOverviewResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async addPluginMarketplace(params: XCodeAgentAddPluginMarketplaceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsMarketplaceAdd,
        {
          workspace: buildWorkspaceRef(params),
          source: params.source,
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
          ...(params.operationId ? { operationId: params.operationId } : {}),
        },
        zcodePluginsMarketplaceMutationResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async removePluginMarketplace(params: XCodeAgentRemovePluginMarketplaceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsMarketplaceRemove,
        {
          workspace: buildWorkspaceRef(params),
          marketplace: params.marketplace,
        },
        zcodePluginsMarketplaceMutationResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async updatePluginMarketplace(params: XCodeAgentUpdatePluginMarketplaceParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsMarketplaceUpdate,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
          ...(params.operationId ? { operationId: params.operationId } : {}),
        },
        zcodePluginsMarketplaceMutationResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async installPlugin(params: XCodeAgentInstallPluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsInstall,
        {
          workspace: buildWorkspaceRef(params),
          pluginName: params.pluginName,
          marketplace: params.marketplace,
          ...(params.scope ? { scope: params.scope } : {}),
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
          ...(params.operationId ? { operationId: params.operationId } : {}),
        },
        zcodePluginsInstallResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async cancelPluginOperation(params: XCodeAgentCancelPluginOperationParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsCancelOperation,
        { operationId: params.operationId },
        zcodePluginsCancelOperationResultSchema,
        { timeoutMs: PLUGIN_OPERATION_CANCEL_REQUEST_TIMEOUT_MS },
      );
    },

    async uninstallPlugin(params: XCodeAgentUninstallPluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsUninstall,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.pluginId ? { pluginId: params.pluginId } : {}),
          ...(params.pluginName ? { pluginName: params.pluginName } : {}),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
          ...(params.removeCache !== undefined ? { removeCache: params.removeCache } : {}),
        },
        zcodePluginsUninstallResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async updatePlugin(params: XCodeAgentUpdatePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsUpdate,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.pluginId ? { pluginId: params.pluginId } : {}),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
        },
        zcodePluginsInstallResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async restoreBuiltinPlugin(params: XCodeAgentRestoreBuiltinPluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsRestoreBuiltin,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
        },
        zcodePluginsRestoreBuiltinResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async configurePlugin(params: XCodeAgentConfigurePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsConfigure,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
          options: params.options,
          ...(params.clearOptionKeys?.length ? { clearOptionKeys: params.clearOptionKeys } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
          ...(params.dryRun !== undefined ? { dryRun: params.dryRun } : {}),
        },
        zcodePluginsConfigureResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async resetPluginConfig(params: XCodeAgentResetPluginConfigParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsResetConfig,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
          ...(params.scope ? { scope: params.scope } : {}),
        },
        zcodePluginsConfigureResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async validatePlugin(params: XCodeAgentValidatePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsValidate,
        {
          workspace: buildWorkspaceRef(params),
          ...(params.pluginName ? { pluginName: params.pluginName } : {}),
          ...(params.marketplace ? { marketplace: params.marketplace } : {}),
          ...(params.source ? { source: params.source } : {}),
        },
        zcodePluginsValidateResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async describePlugin(params: XCodeAgentDescribePluginParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsDescribe,
        {
          workspace: buildWorkspaceRef(params),
          marketplace: params.marketplace,
          pluginName: params.pluginName,
        },
        zcodePluginsDescribeResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async setPluginEnabled(params: XCodeAgentSetPluginEnabledParams) {
      const client = await getPluginManagementClient();
      return client.request(
        zcodeProtocolMethods.pluginsSetEnabled,
        {
          workspace: buildWorkspaceRef(params),
          pluginId: params.pluginId,
          enabled: params.enabled,
          ...(params.operationId ? { operationId: params.operationId } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
        },
        zcodePluginsSetEnabledResultSchema,
        { timeoutMs: PLUGIN_MANAGEMENT_REQUEST_TIMEOUT_MS },
      );
    },

    async listAutomations(params: XCodeAgentWorkspaceTarget) {
      return automationService.list(params);
    },

    async listAllAutomations() {
      return automationService.list();
    },

    async createAutomation(params: XCodeAgentCreateAutomationParams) {
      return automationService.create({
        projectId: params.projectId,
        title: params.title,
        cronExpr: params.cronExpr,
        relativeDelayMinutes: params.relativeDelayMinutes,
        prompt: params.prompt,
        modelSelection: params.modelSelection,
        mode: params.mode as XCodeTaskMode | undefined,
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
        recurring: params.recurring ?? true,
        maxRuns: params.maxRuns,
        endAt: params.endAt,
        scheduleRule: params.scheduleRule,
      });
    },

    async updateAutomation(params: XCodeAgentUpdateAutomationParams) {
      return automationService.update(
        params.automationId,
        {
          title: params.title,
          cronExpr: params.cronExpr,
          prompt: params.prompt,
          modelSelection: params.modelSelection,
          mode: params.mode === null ? null : (params.mode as XCodeTaskMode | undefined),
          recurring: params.recurring,
          maxRuns: params.maxRuns,
          endAt: params.endAt,
          scheduleRule: params.scheduleRule,
          scheduleEditedByUser: params.scheduleEditedByUser,
        },
        // 归属校验：写操作必须限定在调用方当前 workspace，禁止跨 workspace 越权。
        {
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        },
      );
    },

    async deleteAutomation(params: XCodeAgentAutomationIdParams) {
      await automationService.delete(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async setAutomationEnabled(params: XCodeAgentSetAutomationEnabledParams) {
      return automationService.setEnabled(params.automationId, params.enabled, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async restartAutomation(params: XCodeAgentAutomationIdParams) {
      return automationService.restart(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async runAutomationNow(params: XCodeAgentAutomationIdParams) {
      const dispatch = options?.onAutomationManualRunRequested;
      if (!dispatch) {
        // runNow 会先写 manual run 并占用 single-flight claim；dispatcher
        // 缺失是同步可判定的配置错误，必须在认领前失败，不能依赖 stale 崩溃回收。
        throw new Error("Automation immediate dispatcher is unavailable.");
      }
      const claimed = await automationService.runNow(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
      if (!claimed) {
        // single-flight 已拒绝重复运行时，旧的空成功返回会被 UI 误判为
        // 新 run 已入队，导致每次重复点击都展示一次“已触发”。
        return { status: "duplicate" as const };
      }
      await dispatch(claimed);
      return { status: "queued" as const };
    },

    async listAutomationRuns(params: XCodeAgentAutomationIdParams) {
      return automationService.listRuns(params.automationId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async deleteAutomationRun(params: XCodeAgentDeleteAutomationRunParams) {
      return automationService.deleteRun(params.runId, {
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
      });
    },

    async generateWorkspaceText(params: XCodeAgentGenerateWorkspaceTextParams) {
      const client = await getClient(params);
      // Worker 自己读取 XCode Built-in / Personal Config；Host 只在执行前确保账号状态形成的
      // Account Config Overlay 已同步，避免新进程先按旧套餐状态创建 Model。
      await ensureAccountProviderConfigSynced({
        client,
        reason: "workspace_generate_text",
        workspace: params,
        refreshRegistry: true,
      });
      // 跨 RPC 调用时 AbortSignal 过不了结构化克隆（到手只剩一个空对象），
      // 调用方只能用 requestTimeoutMs 表达 deadline。这里把它落成本地
      // AbortController：既登记 operationId（Core 收到 signal 后不再套 60s
      // 硬超时），也保留到点取消的能力。
      const callerSignal =
        params.signal && typeof (params.signal as AbortSignal).addEventListener === "function"
          ? params.signal
          : undefined;
      const deadlineMs = params.requestTimeoutMs;
      const deadlineController = !callerSignal && deadlineMs ? new AbortController() : undefined;
      const signal = callerSignal ?? deadlineController?.signal;
      const deadlineTimer = deadlineController
        ? setTimeout(
            () =>
              deadlineController.abort(
                new DOMException("Workspace model request deadline reached", "AbortError"),
              ),
            deadlineMs,
          )
        : undefined;
      const operationId = signal ? randomUUID() : undefined;
      const cancel = () => {
        if (!operationId) return;
        void client
          .request(
            zcodeProtocolMethods.workspaceCancelGenerateText,
            { operationId },
            zcodeWorkspaceCancelGenerateTextResultSchema,
            { timeoutMs: 5_000 },
          )
          .catch((error: unknown) => {
            // 取消是 best-effort 控制面操作，失败不能覆盖调用方原本的 AbortError；
            // 保留 debug 轨迹用于区分“本地停止等待”和“CLI 已收到取消”。
            logger.debug(undefined, "workspace 模型请求取消通知失败", {
              operationId,
              workspaceKey: resolveWorkspaceKey(params),
              error: error instanceof Error ? error.message : String(error),
            });
          });
      };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        return await client.request(
          zcodeProtocolMethods.workspaceGenerateText,
          {
            workspace: buildWorkspaceRef(params),
            selection: params.selection,
            ...(params.prompt ? { prompt: params.prompt } : {}),
            ...(params.messages ? { messages: params.messages } : {}),
            ...(params.tools ? { tools: params.tools } : {}),
            querySource: params.querySource,
            ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
            ...(operationId ? { operationId } : {}),
          },
          zcodeWorkspaceGenerateTextResultSchema,
          // 不传 timeoutMs 时协议 client 默认 3 分钟超时会对 thinking 模型的长请求
          // 先于调用方自身 deadline 触发，并被 onRequestTimeout 误判 stale 杀进程。
          // 调用方显式传入 requestTimeoutMs（自身 deadline + 取消缓冲）时以其为准。
          {
            signal,
            ...(params.requestTimeoutMs ? { timeoutMs: params.requestTimeoutMs } : {}),
          },
        );
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        signal?.removeEventListener("abort", cancel);
      }
    },

    async testModelConnectivity(params: XCodeAgentTestModelConnectivityParams) {
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "provider_test_model_connectivity",
        workspace: params,
        refreshRegistry: true,
      });
      return client.request(
        zcodeProtocolMethods.providerTestModelConnectivity,
        {
          workspace: buildWorkspaceRef(params),
          selection: params.selection,
        },
        zcodeProviderTestModelConnectivityResultSchema,
        { signal: params.signal },
      );
    },

    async sendPrompt(params: XCodeAgentSendPromptParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      await ensureAccountProviderConfigSynced({
        client,
        reason: "session_send",
        workspace: params,
        refreshRegistry: true,
      });
      const sessionTraceId = params.sessionTraceId?.trim() || getSessionTraceId(params);
      const logTraceId = sessionTraceId ?? params.inputId;
      const browserAmbientContext =
        params.browserAmbientContext ??
        (await collectBrowserAmbientContext(options?.browserControlExecutor, {
          sessionId: params.sessionId,
          workspacePath: params.workspacePath,
          ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
          ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
          ...(params.clientMode ? { clientMode: params.clientMode } : {}),
        }));
      const protocolParams: XCodeAgentSendPromptParams = {
        ...params,
        ...(browserAmbientContext ? { browserAmbientContext } : {}),
      };
      logger.info(logTraceId, "XCode Agent session/send 开始", {
        attachmentCount: params.attachments?.length ?? 0,
        hasBrowserAmbientContext: browserAmbientContext !== undefined,
        inputId: params.inputId,
        queryId: params.queryId ?? null,
        sessionId: params.sessionId,
        sessionTraceId: sessionTraceId ?? null,
        textLength: params.content.length,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const result = await client.request(
          zcodeProtocolMethods.sessionSend,
          buildSessionSendParams(protocolParams),
          zcodeSessionSendResultSchema,
        );
        logger.info(logTraceId, "XCode Agent session/send ACK", {
          durationMs: Date.now() - startedAt,
          inputId: params.inputId,
          queryId: params.queryId ?? null,
          sessionId: params.sessionId,
          sessionTraceId: sessionTraceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return result;
      } catch (error) {
        // 旧 CLI 拒绝 basis 时，剥离重试会重新接纳异步解析前的旧模型。
        // 必须先于可选字段兼容处理明确失败；首次 schema 拒绝尚未接纳输入。
        if (
          protocolParams.modelSelectionBasis &&
          getUnrecognizedTopLevelKeys(error).includes("modelSelectionBasis")
        ) {
          throw new XCodeAgentModelSelectionBasisUnsupportedError(error);
        }
        const compatFields = getSessionSendCompatFields(error);
        if (compatFields.length > 0) {
          logger.warn(logTraceId, "XCode Agent session/send 命中新旧协议兼容重试", {
            compatFields,
            durationMs: Date.now() - startedAt,
            sessionId: params.sessionId,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          const result = await client.request(
            zcodeProtocolMethods.sessionSend,
            buildSessionSendParams(protocolParams, new Set(compatFields)),
            zcodeSessionSendResultSchema,
          );
          return result;
        }
        logger.warn(logTraceId, "XCode Agent session/send 失败", {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          inputId: params.inputId,
          queryId: params.queryId ?? null,
          sessionId: params.sessionId,
          sessionTraceId: sessionTraceId ?? null,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async compactSession(params: XCodeAgentCompactParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      const sessionTraceId = getSessionTraceId(params);
      logger.info(sessionTraceId ?? params.inputId, "XCode Protocol session/compact 开始", {
        inputId: params.inputId,
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const result = await client.request(
          zcodeProtocolMethods.sessionCompact,
          buildSessionCompactParams(params),
          zcodeSessionCompactResultSchema,
          {
            // compact 的模型维护态可能进入分钟级窗口；这里放宽的是 ACK 边界，
            // 终态仍由 session timeline / snapshot 推送，不能把它当作同步 compact 结果。
            timeoutMs: SESSION_COMPACT_REQUEST_TIMEOUT_MS,
          },
        );
        logger.info(sessionTraceId ?? params.inputId, "XCode Protocol session/compact ACK", {
          durationMs: Date.now() - startedAt,
          inputId: params.inputId,
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return result;
      } catch (error) {
        logger.warn(sessionTraceId ?? params.inputId, "XCode Protocol session/compact 失败", {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          inputId: params.inputId,
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async goalSession(params: XCodeAgentGoalParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      logger.info(params.inputId, "开始请求 XCode Protocol session/goal", {
        action: params.action,
        hasObjective: Boolean(params.objective?.trim()),
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const result = await client.request(
          zcodeProtocolMethods.sessionGoal,
          {
            sessionId: params.sessionId,
            inputId: params.inputId,
            action: params.action,
            objective: params.objective,
            expectedRevision: params.expectedRevision,
          },
          zcodeSessionGoalResultSchema,
        );
        logger.info(params.inputId, "XCode Protocol session/goal 完成", {
          action: params.action,
          durationMs: Date.now() - startedAt,
          messageCount: result.snapshot.messages.length,
          responseLength: result.response?.length ?? 0,
          sessionId: params.sessionId,
          startedTurn: result.startedTurn,
          status: result.snapshot.session.status,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return result;
      } catch (error) {
        logger.warn(params.inputId, "XCode Protocol session/goal 失败", {
          action: params.action,
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async closeSession(
      params: XCodeAgentSessionTarget & {
        expectedPersistence?: "deferred" | "immediate";
      },
    ): Promise<boolean> {
      const client = await getClient(params);
      const result = await client.request(
        zcodeProtocolMethods.sessionClose,
        {
          sessionId: params.sessionId,
          ...(params.expectedPersistence
            ? { expectedPersistence: params.expectedPersistence }
            : {}),
        },
        zcodeSessionCloseResultSchema,
      );
      // 兼容尚未返回 closed 字段、但已成功执行普通 close 的 Agent。
      return result.closed ?? true;
    },

    async releaseSessionsUnderDirectory(params) {
      // 绝不为卸载拉起 CLI：没有进程时没有驻留会话。
      const client = processManager.getExistingClient(params);
      if (!client || client.isDisposed) return { released: [], busy: [] };
      return await client.request(
        zcodeProtocolMethods.sessionReleaseUnderDirectory,
        { directory: params.directory },
        zcodeSessionReleaseUnderDirectoryResultSchema,
      );
    },

    async queryCommandResult(params) {
      // 命令结果是 CLI 的事实；进程已退出时以只读方式拉起，读取持久化的命令记录。
      const client = await getReadOnlyClient(params);
      const result = await client.request(
        V4_METHODS.commandsQuery,
        commandsQueryParamsSchema.parse({ commands: [params.key] }),
        commandsQueryResultSchema,
      );
      return result.results[0]?.result ?? "unknown";
    },

    async setModel(params: XCodeAgentSetModelParams) {
      const startedAt = Date.now();
      const client = await getClient(params);
      logger.info(undefined, "开始请求 XCode Protocol session/setModel", {
        expectedRevision: params.expectedRevision ?? null,
        persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed ?? null,
        requestedModel: formatModelSelectionForLog(params.model),
        sessionId: params.sessionId,
        workspaceKey: resolveWorkspaceKey(params),
        workspacePath: params.workspacePath,
      });
      try {
        const snapshot = await client.request(
          zcodeProtocolMethods.sessionSetModel,
          {
            sessionId: params.sessionId,
            model: params.model,
            expectedRevision: params.expectedRevision,
            persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed,
          },
          zcodeSessionStateSnapshotSchema,
        );
        logger.info(undefined, "XCode Protocol session/setModel 完成", {
          durationMs: Date.now() - startedAt,
          requestedModel: formatModelSelectionForLog(params.model),
          sessionId: params.sessionId,
          snapshotModel: formatModelSelectionForLog(snapshot.settings.model.current),
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        return snapshot;
      } catch (error) {
        logger.warn(undefined, "XCode Protocol session/setModel 失败", {
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
          requestedModel: formatModelSelectionForLog(params.model),
          sessionId: params.sessionId,
          workspaceKey: resolveWorkspaceKey(params),
          workspacePath: params.workspacePath,
        });
        throw error;
      }
    },

    async setThoughtLevel(params: XCodeAgentSetThoughtLevelParams) {
      const client = await getClient(params);
      const snapshot = await client.request(
        zcodeProtocolMethods.sessionSetThoughtLevel,
        {
          sessionId: params.sessionId,
          thoughtLevel: params.thoughtLevel,
          expectedRevision: params.expectedRevision,
          persistAsWorkspaceLastUsed: params.persistAsWorkspaceLastUsed,
        },
        zcodeSessionStateSnapshotSchema,
      );
      return snapshot;
    },

    async setPersona(params: XCodeAgentSetPersonaParams) {
      const client = await getClient(params);
      return client.request(
        zcodeProtocolMethods.sessionSetPersona,
        {
          sessionId: params.sessionId,
          personaMode: params.personaMode,
          ...(params.templateId ? { templateId: params.templateId } : {}),
          ...(params.inherited ? { inherited: params.inherited } : {}),
          ...(params.custom ? { custom: params.custom } : {}),
          expectedRevision: params.expectedRevision,
        },
        zcodeSessionStateSnapshotSchema,
      );
    },

    async setPrefill(params: XCodeAgentSetPrefillParams) {
      const client = await getClient(params);
      return client.request(
        zcodeProtocolMethods.sessionSetPrefill,
        {
          sessionId: params.sessionId,
          prefillMode: params.prefillMode,
          expectedRevision: params.expectedRevision,
        },
        zcodeSessionStateSnapshotSchema,
      );
    },

    async setMode(params: XCodeAgentSetModeParams) {
      const client = await getClient(params);
      return client.request(
        zcodeProtocolMethods.sessionSetMode,
        {
          sessionId: params.sessionId,
          mode: params.mode,
          expectedRevision: params.expectedRevision,
        },
        zcodeSessionStateSnapshotSchema,
      );
    },

    async respondSessionRuntimePreferences(
      params: XCodeAgentRespondSessionRuntimePreferencesParams,
    ): Promise<void> {
      const pending = takePendingSessionRuntimePreferences(params.requestId);
      if (!pending) {
        logger.warn(undefined, "运行时偏好响应找不到 pending 请求", {
          event: "zcode_agent.runtime_preferences.response_without_pending",
          module: "services.zcode_agent",
          requestId: params.requestId,
        });
        throw new Error(`XCode session runtime preferences request not found: ${params.requestId}`);
      }
      const responseContext = {
        event: "zcode_agent.runtime_preferences.host_response_received",
        module: "services.zcode_agent",
        requestId: params.requestId,
        scope: pending.request.scope,
        sessionId: pending.request.sessionId,
        workspaceKey: pending.workspaceKey,
      };
      if (params.resolution.status === "failed") {
        logger.warn(undefined, "Host 返回运行时偏好失败", {
          ...responseContext,
          error: params.resolution.message,
        });
        await pending.client.respondError(pending.protocolRequestId, {
          code: -32603,
          message: params.resolution.message,
        });
        return;
      }
      let preferences: XCodeSessionRuntimePreferencesResult;
      try {
        preferences = zcodeSessionRuntimePreferencesResultSchema.parse(
          params.resolution.preferences,
        );
        // App 控制能力属于当前 Host 装配，不能由外部设置应答方声明。
        preferences.appControlEnabled = Boolean(options?.resolveAppControlService?.());
        // 远端组织态由远端 Host 读取；客户端设置回包不能覆盖本机目录事实。
        if (
          pending.request.scope === "runtime-materialization" &&
          options?.resolveSessionDirectories
        ) {
          preferences.additionalDirectories = await resolveSessionDirectories(
            { ...pending.workspace, sessionId: pending.request.sessionId },
            pending.request.directorySessionId,
          );
        }
      } catch (error) {
        logger.warn(undefined, "Host 返回运行时偏好格式非法", {
          ...responseContext,
          error: error instanceof Error ? error.message : String(error),
        });
        await pending.client.respondError(pending.protocolRequestId, {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      // 发送失败表示 transport 已关闭，不能误判为偏好校验失败并发送第二个响应。
      await pending.client.respond(pending.protocolRequestId, preferences);
      logger.info(undefined, "运行时偏好响应已回传 Agent", responseContext);
    },

    onDynamicWorkspaceProviderRuntimeHeadersCancelled(params: XCodeAgentWorkspaceTarget) {
      const key = resolveWorkspaceKey(params);
      let emitter = providerRuntimeHeadersCancelledEmitters.get(key);
      if (!emitter) {
        emitter = new Emitter<XCodeProviderRuntimeHeadersCancelled>();
        providerRuntimeHeadersCancelledEmitters.set(key, emitter);
      }
      return emitter.event;
    },

    onDynamicSessionRuntimePreferencesRequest() {
      return (listener) => {
        const disposable = sessionRuntimePreferencesRequestEmitter.event(listener);
        for (const pending of pendingSessionRuntimePreferences.values()) {
          listener(pending.request);
        }
        return disposable;
      };
    },

    async respondProviderRuntimeHeaders(
      params: ZCodeAgentRespondProviderRuntimeHeadersParams,
    ): Promise<void> {
      const key = providerRuntimeHeadersRequestKey(params);
      const pending = pendingProviderRuntimeHeaders.get(key);
      if (!pending) {
        throw new Error(`XCode provider runtime headers request not found: ${params.requestId}`);
      }
      if (!pending.interactionRequired) {
        throw new Error("Provider runtime headers request does not require interaction");
      }
      if (pending.responding) {
        throw new Error(
          `XCode provider runtime headers response already pending: ${params.requestId}`,
        );
      }
      // 不能在等待账号 IO 前删除 pending，否则新合入的取消通知找不到请求；
      // 保留身份直到解析完成，同时避免 workspace/session 两个消费者重复应答。
      pending.responding = true;
      if (!params.response.headersApplied) {
        pendingProviderRuntimeHeaders.delete(key);
        await pending.client.respond(pending.protocolRequestId, {
          headersApplied: false,
          ...(params.response.errorMessage ? { errorMessage: params.response.errorMessage } : {}),
        });
        return;
      }
      let accountRequestAuth: AccountRequestAuthMaterial | undefined;
      try {
        accountRequestAuth = await resolveAccountRequestAuth(pending.request);
      } catch (error) {
        if (pendingProviderRuntimeHeaders.get(key) !== pending) return;
        pendingProviderRuntimeHeaders.delete(key);
        logger.warn(undefined, "XCode provider runtime headers 应用失败", {
          modelId: pending.request.modelSelection.modelId,
          providerId: pending.request.providerId,
          requestId: pending.request.requestId,
          sessionId: pending.request.sessionId,
          error: error instanceof Error ? error.message : String(error),
          workspaceKey: resolveWorkspaceKey(pending.request.workspace),
        });
        await pending.client.respond(pending.protocolRequestId, {
          headersApplied: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if (pendingProviderRuntimeHeaders.get(key) !== pending) return;
      pendingProviderRuntimeHeaders.delete(key);
      const requestHeaders = {
        ...accountRequestAuth?.headers,
      };
      Object.assign(
        requestHeaders,
        allowRequestVerificationHeaders(params.response.runtimeProviderHeaders ?? {}),
      );
      // 账号轮询可能返回空材料（{}）：这表示「保留静态 provider config 鉴权」，
      // 不是失败。只有完全没解析出材料（undefined）才回 headersApplied:false。
      const requestAuth =
        accountRequestAuth !== undefined
          ? {
              ...(accountRequestAuth.apiKey ? { apiKey: accountRequestAuth.apiKey } : {}),
              ...(accountRequestAuth.apiKeyId ? { apiKeyId: accountRequestAuth.apiKeyId } : {}),
              ...(accountRequestAuth.accountScope
                ? { accountScope: accountRequestAuth.accountScope }
                : {}),
              ...(accountRequestAuth.connectionId
                ? { connectionId: accountRequestAuth.connectionId }
                : {}),
              // 账号 / 出口代理只用于「使用详情」记账；这里漏传会让 core 永远记成
              // 「无账号 + 跟随全局」，即使 host 已经按代理池选好了实际出口。
              ...(accountRequestAuth.accountDisplayName
                ? { accountDisplayName: accountRequestAuth.accountDisplayName }
                : {}),
              ...(accountRequestAuth.proxyPoolId
                ? { proxyPoolId: accountRequestAuth.proxyPoolId }
                : {}),
              ...(accountRequestAuth.proxyDisplayName
                ? { proxyDisplayName: accountRequestAuth.proxyDisplayName }
                : {}),
              ...(Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : {}),
            }
          : undefined;
      await pending.client.respond(
        pending.protocolRequestId,
        requestAuth
          ? { headersApplied: true, requestAuth }
          : { headersApplied: false, errorMessage: "Provider request auth is missing" },
      );
      const logContext = {
        modelId: pending.request.modelSelection.modelId,
        providerId: pending.request.providerId,
        requestId: pending.request.requestId,
        sessionId: pending.request.sessionId,
        ...(params.response.errorMessage ? { error: params.response.errorMessage } : {}),
        workspaceKey: resolveWorkspaceKey(pending.request.workspace),
      };
      if (requestAuth) {
        logger.info(undefined, "XCode provider runtime headers 已应用", logContext);
      } else {
        logger.warn(undefined, "XCode provider runtime headers 应用失败", logContext);
      }
    },

    onDynamicProviderRuntimeHeadersRequest(params: XCodeAgentSessionTarget) {
      const emitter = getSessionEmitter(params);
      return (listener) => {
        const disposable = emitter.event((event) => {
          if (event.type !== "providerRuntimeHeaders.request") {
            return;
          }
          listener(event.request);
        });
        // Bug 原因：draft 首发会先启动 turn，再把新 sessionId 绑定到 React pane；
        // provider runtime headers 请求可能早于 pane 的 live 订阅，旧实现只 fire event，
        // 导致请求虽留在 pending map，请求校验消费者却永远收不到，真实模型请求无法发出。
        // 必须先注册 live listener，再补投递当前 session 的 pending 请求，封住前后两个窗口。
        const pendingSessionPrefix = `${sessionEventKey(params)}\u0000`;
        for (const [key, pending] of pendingProviderRuntimeHeaders) {
          if (
            key.startsWith(pendingSessionPrefix) &&
            pending.interactionRequired &&
            !pending.responding
          ) {
            listener(pending.request);
          }
        }
        return disposable;
      };
    },

    onDynamicWorkspaceProviderRuntimeHeadersRequest(params: XCodeAgentWorkspaceTarget) {
      const emitter = getProviderRuntimeHeadersWorkspaceEmitter(params);
      return (listener) => {
        const disposable = emitter.event((request) => {
          listener(request);
        });
        // Bug 原因（2026-08-16 web 远控卡死）：session 级入口要求订阅方知道 sessionId，
        // 而 web 远控新建的会话在桌面没有任何 pane，桌面侧无人订阅，headers 请求
        // 永远滞留 pending。workspace 级订阅与 session 级同语义：先注册 live listener，
        // 再按 workspaceKey 前缀补投 pending，封住请求先于订阅到达的窗口；
        // 隔离按 workspaceKey（identity 优先），禁止把远程同路径 workspace 的请求互投。
        const pendingWorkspacePrefix = `${resolveWorkspaceKey(params)}\u0000`;
        for (const [key, pending] of pendingProviderRuntimeHeaders) {
          if (
            key.startsWith(pendingWorkspacePrefix) &&
            pending.interactionRequired &&
            !pending.responding
          ) {
            listener(pending.request);
          }
        }
        return disposable;
      };
    },

    onDynamicSessionEvent(params: XCodeAgentSessionSubscribeParams) {
      const emitter = getSessionEmitter(params);
      return (listener) => {
        // cancelled / retryTimer 的作用域是单个订阅者：调用方 dispose 时取消自己的重试，
        // 不影响共享 emitter 上的其他订阅者。
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let subscriptionReady = false;
        const pendingLiveEvents: XCodeAgentServiceEvent[] = [];
        const deliveredEventIds = new Set<string>();
        const deliveredEventIdOrder: string[] = [];
        const eventCoalescer =
          params.eventCoalescing?.mode === "background-summary"
            ? createBackgroundSessionEventCoalescer({
                emit: listener,
                flushDelayMs: params.eventCoalescing.intervalMs,
              })
            : null;

        const deliverToListener = (event: XCodeAgentServiceEvent): void => {
          if (cancelled) {
            return;
          }
          if (event.type === "session.event") {
            const firstDelivery = rememberBoundedEventId(
              deliveredEventIds,
              deliveredEventIdOrder,
              event.event.eventId,
            );
            if (!firstDelivery) {
              return;
            }
          }
          // 性能优化：后台 task 只需要低频摘要，不能让不可见任务的 token/progress
          // 同频唤醒 renderer；active 订阅没有 eventCoalescing，仍保持实时 continuous。
          if (eventCoalescer) {
            eventCoalescer.accept(event);
            return;
          }
          listener(event);
        };

        const releaseBufferedLiveEvents = (): void => {
          if (subscriptionReady) {
            return;
          }
          subscriptionReady = true;
          const bufferedEvents = pendingLiveEvents.splice(0);
          for (const event of bufferedEvents) {
            deliverToListener(event);
          }
        };

        const subscription = emitter.event((event) => {
          if (cancelled) {
            return;
          }
          if (!subscriptionReady) {
            pendingLiveEvents.push(event);
            return;
          }
          deliverToListener(event);
        });

        const establishSubscription = async (attempt: number): Promise<void> => {
          if (cancelled) {
            return;
          }
          try {
            const client = await getReadOnlyClient(params);
            if (cancelled) {
              return;
            }
            const result = await client.request(
              zcodeProtocolMethods.sessionSubscribe,
              {
                sessionId: params.sessionId,
                deliveryKind: params.deliveryKind,
                afterSeq: params.afterSeq,
                includeSnapshot: params.includeSnapshot ?? false,
              },
              zcodeSessionSubscribeResultSchema,
            );
            if (cancelled) {
              return;
            }
            const replayEvents = result.events
              .map((event) => normalizeSessionEventSeq(params, event))
              .sort((left, right) => left.seq - right.seq || left.timestamp - right.timestamp);
            // session/subscribe 返回的是当前订阅者自己的 replay 缺口。
            // replay 不能 fire 到共享 emitter：会把历史事件重新广播给其他 live 订阅者，
            // 造成 UI 时间线里已完成工具被插回到当前模型输出之后。
            for (const event of replayEvents) {
              deliverToListener({ type: "session.event", event });
            }
            if (result.snapshot) {
              deliverToListener({
                type: "snapshot",
                snapshot: result.snapshot,
              });
            }
            releaseBufferedLiveEvents();
          } catch (error) {
            if (cancelled) {
              return;
            }
            if (attempt >= SESSION_SUBSCRIBE_MAX_ATTEMPTS - 1) {
              // 彻底失败时打 warn 让问题可观测，而不是无声失效。
              console.warn(
                formatLogPrefix("zcode-agent", process.pid),
                "session 订阅建立失败，已达最大重试次数，放弃",
                {
                  sessionId: params.sessionId,
                  workspaceKey: resolveWorkspaceKey(params),
                  attempts: attempt + 1,
                  message: error instanceof Error ? error.message : String(error),
                },
              );
              // 订阅失败后不再无限压住 live 事件；此时没有 replay 权威补洞，只能恢复 continuous 流。
              releaseBufferedLiveEvents();
              return;
            }
            const delay = Math.min(
              SESSION_SUBSCRIBE_RETRY_BASE_DELAY_MS * 2 ** attempt,
              SESSION_SUBSCRIBE_RETRY_MAX_DELAY_MS,
            );
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              void establishSubscription(attempt + 1);
            }, delay);
          }
        };

        void establishSubscription(0);

        return {
          dispose() {
            cancelled = true;
            if (retryTimer) {
              clearTimeout(retryTimer);
              retryTimer = undefined;
            }
            pendingLiveEvents.length = 0;
            eventCoalescer?.dispose();
            subscription.dispose();
          },
        };
      };
    },

    // ── v4 conversation 通道（竖切）：host 只做透传，不落任何业务状态 ──

    async helloConversationV4() {
      return {
        kind: "hello" as const,
        protocolVersion: V4_WIRE_PROTOCOL_VERSION,
        connectionId: v4ConnectionId,
        clientMode: "desktop-continuous" as const,
        deliveryProfile: "continuous" as const,
        serverTime: Date.now(),
        capabilities: {
          nativeDialogs: true,
          localTerminal: true,
          binaryFrames: false,
          compression: "none" as const,
          workspaceHookReview: true,
          independentPlanState: true,
          genUiContext: true,
          // 与 connection scope 的 hello 同一份能力集：直连 base service 的宿主内部消费者
          // 也能收到 `workflowRun.*` 增量（是否真收由它自己的 clientHello 决定）。
          workflowRunDeltas: true,
          historyFirst: true,
          residentRowsRange: true,
        },
        auth: {},
      };
    },

    async initializeConversationV4(rawClientHello) {
      clientHelloSchema.parse(rawClientHello);
    },

    async setConnectionFlowStateV4(params: XCodeAgentConnectionFlowParams) {
      const trusted = readTrustedXCodeAgentV4Connection(params);
      if (!trusted) throw new Error("fault.connection.flowControlUntrusted");
      const client = await getReadOnlyClient(params);
      await client.request(
        V4_METHODS.connectionFlow,
        { connectionId: trusted.connectionId, state: params.state },
        v4ConnectionFlowResultSchema,
      );
    },

    async subscribeConversationV4(params: XCodeAgentConversationSubscribeParams) {
      const subscribeStartedAt = performance.now();
      const existingClient = processManager.getExistingClient(params);
      const cliProcessState: "reused" | "spawned" =
        existingClient && !existingClient.isDisposed ? "reused" : "spawned";
      const cliBootstrapStartedAt = performance.now();
      // 历史 topic 是任务列表点击后的只读事实源。provider/model 未配置时若复用
      // 模型执行门禁，列表虽然能出现但点击后仍无法打开；订阅只启动 CLI，不提升写能力。
      const client = await getReadOnlyClient(params);
      const cliBootstrapMs =
        cliProcessState === "spawned"
          ? Math.max(0, Math.round(performance.now() - cliBootstrapStartedAt))
          : undefined;
      // conversation 冷订阅会在 CLI 内部直接恢复历史 Session 并立即发布首帧。
      // 若 Account Config 尚未到达，首帧会先按缺少 Account Overlay 的 Registry 解析；这里只建立
      // Account Config 顺序屏障，不提升模型执行权限。XCode Built-in / Personal 仍由 Worker 维护。
      const providerRegistryStartedAt = performance.now();
      await ensureAccountProviderConfigSynced({
        client,
        reason: "conversation_subscribe",
        workspace: params,
        refreshRegistry: true,
      });
      const providerRegistrySyncMs = Math.max(
        0,
        Math.round(performance.now() - providerRegistryStartedAt),
      );
      const connection = resolveV4Connection(params);
      const historyFirst = connection.historyFirst === true && (await supportsHistoryFirst(client));
      const topic = conversationTopic(params.sessionId);
      const taskMetaStartedAt = performance.now();
      const resumeThoughtLevel = await automationTaskIndexRepo
        .getTaskMeta({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
          taskId: params.sessionId,
        })
        .then((meta) => meta?.thoughtLevel?.trim() || undefined)
        .catch((error) => {
          // desktop-continuous 的 V4 冷订阅绕过 task adapter，旧 session 没有
          // Agent durable selection 时也就丢了 task-local thought。索引读取失败仍允许只读恢复。
          logger.warn(undefined, "读取 V4 cold resume thought hint 失败，继续无 hint 订阅", {
            error: error instanceof Error ? error.message : String(error),
            event: "v4.conversation.subscribe.resume_thought_hint_failed",
            sessionId: params.sessionId,
            workspaceIdentity: params.workspaceIdentity ?? null,
            workspaceKey: resolveWorkspaceKey(params),
            workspacePath: params.workspacePath,
          });
          return undefined;
        });
      const additionalDirectories = await readSessionDirectories(client, params);
      const taskMetaReadMs = Math.max(0, Math.round(performance.now() - taskMetaStartedAt));
      const cliRequestStartedAt = performance.now();
      const result = await client.request(
        V4_METHODS.conversationSubscribe,
        {
          topic,
          connectionId: connection.connectionId,
          clientMode: connection.clientMode,
          // 与 clientMode 同族的可信位（10 §3.1）：只由这里从连接的 clientHello 注入。
          // 缺席即 CLI 按旧消费者发整键 patch，并先裁到旧界——重订阅、recovery、手机
          // relay attachment 都走这一条 subscribe，所以这一处写全即可。
          ...(connection.workflowRunDeltas === true ? { workflowRunDeltas: true } : {}),
          ...(connection.pluginDiscoveryUi && (await supportsPluginDiscoveryUi(client))
            ? { pluginDiscoveryUi: true }
            : {}),
          ...(historyFirst
            ? {
                historyFirst: true,
                ...(params.retryInitialization
                  ? { retryInitialization: params.retryInitialization }
                  : {}),
              }
            : {}),
          // Bug 根因：冷订阅过去只传 sessionId，CLI 只能从历史 session.path 反推
          // workspace 身份；该路径已可能被 path.resolve 改写。当前 attachment 才是权威来源。
          workspace: buildWorkspaceRef(params),
          ...(resumeThoughtLevel ? { resumeThoughtLevel } : {}),
          ...(additionalDirectories !== undefined ? { additionalDirectories } : {}),
          ...(params.base ? { base: params.base } : {}),
          ...(params.visibility ? { visibility: params.visibility } : {}),
        },
        v4ConversationSubscribeResultSchema,
      );
      const cliRequestMs = Math.max(0, Math.round(performance.now() - cliRequestStartedAt));
      const hostPrepareMs = Math.max(0, Math.round(cliRequestStartedAt - subscribeStartedAt));
      const openTiming = {
        ...(result.ack.openTiming ? result.ack.openTiming : {}),
        version: 1 as const,
        hostPrepareMs,
        ...(cliBootstrapMs !== undefined ? { cliBootstrapMs } : {}),
        cliProcessState,
        providerRegistrySyncMs,
        taskMetaReadMs,
        cliRequestMs,
      };
      rememberV4SubscriptionRoute(
        params,
        topic,
        result.ack.subscriptionId,
        connection.connectionId,
      );
      return {
        ...result,
        ack: {
          ...result.ack,
          openTiming,
        },
      };
    },

    async unsubscribeConversationV4(params: XCodeAgentConversationUnsubscribeParams) {
      await unsubscribeV4Route(params, "conversation/");
    },

    async resyncConversationV4(params: XCodeAgentConversationResyncParams) {
      return resyncV4Route(params, "conversation/");
    },

    async sendConversationCommandV4(params: XCodeAgentConversationCommandParams) {
      const ttft =
        !params.workspaceIdentity?.trim() &&
        !params.remoteSessionId &&
        (readTrustedXCodeAgentV4Connection(params)?.clientMode ??
          params.clientMode ??
          "desktop-continuous") === "desktop-continuous"
          ? params.envelope.ttft
          : undefined;
      const logStage = (phase: string, status: string, at: number, durationMs?: number) => {
        if (!ttft) return;
        try {
          logger.info(undefined, "[ttft]", {
            event: "ttft.phase",
            observationId: ttft.observationId,
            commandId: params.envelope.commandId,
            sessionId: params.envelope.sessionId,
            phase,
            status,
            source: "host",
            at,
            durationMs,
            pid: process.pid,
          });
        } catch {
          /* 观测失败不改变命令裁决。 */
        }
      };
      const measure = async <T>(phase: string, operation: () => Promise<T>): Promise<T> => {
        if (!ttft) return operation();
        const start = performance.timeOrigin + performance.now();
        logStage(phase, "started", start);
        try {
          const result = await operation();
          const end = performance.timeOrigin + performance.now();
          logStage(phase, "completed", end, end - start);
          return result;
        } catch (error) {
          const end = performance.timeOrigin + performance.now();
          logStage(phase, "failed", end, end - start);
          throw error;
        }
      };
      const client = await measure("host.runtime", () => getClient(params));
      // 新 Host 可能连接旧 CLI；先检查执行端，避免 z.object 静默丢弃状态后仍执行用户输入。
      const genUiContext = (params.envelope.payload as { genUiContext?: unknown } | null)
        ?.genUiContext;
      if (
        params.envelope.type === "sendText" &&
        Array.isArray(genUiContext) &&
        genUiContext.length > 0
      ) {
        await ensureGenUiContextSupport(client);
      }
      const planPayload = params.envelope.payload as {
        planEnabled?: boolean;
        config?: { planEnabled?: boolean };
        firstInput?: { planEnabled?: boolean };
      };
      if (
        planPayload.planEnabled ||
        planPayload.config?.planEnabled ||
        planPayload.firstInput?.planEnabled
      ) {
        await measure("host.plan_support", () => ensureIndependentPlanSupport(client));
      }
      // RPC facade 会清掉调用方可伪造的顶层 clientMode，再用 trusted carrier 注入 host
      // 真值；host 内部 adapter 直调仍兼容显式 clientMode。
      const commandClientMode =
        readTrustedXCodeAgentV4Connection(params)?.clientMode ??
        params.clientMode ??
        "desktop-continuous";
      let envelope = {
        ...(await measure("host.envelope", () => buildConversationCommandEnvelope(params))),
        inputOrigin:
          commandClientMode === "web-remote-replayable"
            ? ("mobile" as const)
            : ("desktop" as const),
      };
      // 来自 UI 的同名字段永远不是授权；relay 透传的是下游握手。旧 CLI 严格校验，缺席比发送 false 安全。
      delete envelope.pluginDiscoveryUi;
      if (
        envelope.type === "createSession" &&
        envelope.payload &&
        typeof envelope.payload === "object"
      ) {
        const { pluginDiscoveryToolEnabled: _untrusted, ...payload } = envelope.payload as Record<
          string,
          unknown
        >;
        envelope.payload = payload;
      }
      if (
        readTrustedXCodeAgentV4Connection(params)?.pluginDiscoveryUi &&
        (await supportsPluginDiscoveryUi(client))
      ) {
        // 偏好控制下一次输入的工具面；已展示的确认卡片仍可完成或跳过，避免关开关后卡住旧轮。
        if (
          latestAppRuntimePreferences?.pluginAutoRecommendationEnabled === true ||
          envelope.type === "resolveInteraction"
        ) {
          envelope.pluginDiscoveryUi = true;
        }
      }
      const highspeedPayload = envelope.payload as { highspeedMeta?: { ownerKey?: string } };
      if (highspeedPayload.highspeedMeta?.ownerKey && !(await supportsHighspeedCardOwner(client))) {
        // 旧执行端strict schema会拒绝新字段；只剥离归属，不改变本轮发送和加速材料。
        const { ownerKey: _ownerKey, ...legacyMeta } = highspeedPayload.highspeedMeta;
        envelope = { ...envelope, payload: { ...highspeedPayload, highspeedMeta: legacyMeta } };
      }
      if (requiresProviderRegistryRefresh(envelope.type)) {
        await measure("host.provider_sync", () =>
          ensureAccountProviderConfigSynced({
            client,
            reason: "v4_command",
            workspace: params,
            refreshRegistry: true,
          }),
        );
      }
      // TTFT 首版只允许可信桌面本地 continuous，手机/远端透传不能开启本地观测。
      if (
        commandClientMode !== "desktop-continuous" ||
        params.workspaceIdentity?.trim() ||
        params.remoteSessionId
      ) {
        const { ttft: _ttft, ...withoutTtft } = envelope;
        envelope = withoutTtft;
      }
      if (envelope.type === "sendText" && envelope.sessionId) {
        const sessionId = envelope.sessionId;
        const payload = {
          ...commandPayloadSchemas.sendText.parse(envelope.payload),
          inputOrigin:
            commandClientMode === "web-remote-replayable"
              ? ("mobile" as const)
              : ("desktop" as const),
        };
        envelope = { ...envelope, payload };
        const browserAmbientContext = await measure("host.browser_context", () =>
          collectBrowserAmbientContext(options?.browserControlExecutor, {
            sessionId,
            workspacePath: params.workspacePath,
            ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
            ...(params.remoteSessionId ? { remoteSessionId: params.remoteSessionId } : {}),
            clientMode: commandClientMode,
          }),
        );
        if (browserAmbientContext) {
          envelope = {
            ...envelope,
            payload: { ...payload, browserAmbientContext },
          };
        }
      }
      if (envelope.type === "createSession") {
        const payload = commandPayloadSchemas.createSession.parse(envelope.payload);
        if (payload.sessionId) rememberClientTarget(client, params, payload.sessionId);
      }
      envelope = { ...envelope, ...coldResumeWorkspace(params) };
      // ACK 往返可与执行重叠，诊断单列，不能与六个 TTFT 主阶段相加。
      const ack: CommandAck = await measure("host.cli_ack", () =>
        client.request(V4_METHODS.command, envelope, commandAckSchema),
      );
      if (
        envelope.type === "forkAssistant" &&
        envelope.sessionId &&
        // fork 到新 worktree 已由 Host 在发送前预留目标 cwd；ACK 不能再按父目录继承并覆盖它。
        !commandPayloadSchemas.forkAssistant.parse(envelope.payload).targetCwd &&
        (ack.status === "accepted" || ack.status === "duplicate") &&
        ack.result?.type === "forkAssistant"
      ) {
        // 正文提交不代表 Host 组织态已写入；等待归属交接再允许界面立即打开，失败可重放同一 ACK。
        await options?.prepareForkCreation?.({
          ...params,
          sessionId: ack.result.sessionId,
          parentSessionId: envelope.sessionId,
        });
      }
      // Prompt command 在 committed TurnStarted 或 committed WorkspaceHookReviewRequested
      // 任一 authority 到达后即返回；人工审核不能占用 Host RPC，因此继续使用统一默认
      // timeout/watchdog。放宽到审核领域 deadline 只会掩盖串行协议队列死锁。
      // duplicate 只证明 commandId 曾处理过，不证明其目标仍是当前 session 配置。
      // 旧 B 命令在用户已切 C 后重放时，不能借 duplicate 把派生缓存再改回 B。
      return ack;
    },

    async queryConversationCommandsV4(params: XCodeAgentCommandsQueryParams) {
      if (!readTrustedXCodeAgentV4Connection(params)) {
        throw new Error("fault.command.queryConnectionUntrusted");
      }
      const query = commandsQueryParamsSchema.parse({
        commands: params.commands,
        ...(params.clock ? { clock: true } : {}),
      });
      const client = await getReadOnlyClient(params);
      return client.request(V4_METHODS.commandsQuery, query, commandsQueryResultSchema);
    },

    async attachmentBeginV4(params: XCodeAgentAttachmentBeginParams) {
      const trusted = readTrustedXCodeAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        ...coldResumeWorkspace(params),
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
        fileName: params.fileName,
        mime: params.mime,
        totalBytes: params.totalBytes,
        totalChunks: params.totalChunks,
        checksum: params.checksum,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentBegin, wireParams);
      return client.request(V4_METHODS.attachmentBegin, wireParams, v4AttachmentBeginResultSchema);
    },

    async attachmentChunkV4(params: XCodeAgentAttachmentChunkParams) {
      const trusted = readTrustedXCodeAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
        chunkIndex: params.chunkIndex,
        dataBase64: params.dataBase64,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentChunk, wireParams);
      return client.request(V4_METHODS.attachmentChunk, wireParams, v4AttachmentChunkResultSchema);
    },

    async attachmentCommitV4(params: XCodeAgentAttachmentTerminalParams) {
      const trusted = readTrustedXCodeAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentCommit, wireParams);
      return client.request(
        V4_METHODS.attachmentCommit,
        wireParams,
        v4AttachmentCommitResultSchema,
      );
    },

    async attachmentAbortV4(params: XCodeAgentAttachmentTerminalParams) {
      const trusted = readTrustedXCodeAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.connectionUntrusted");
      const client = await getClient(params);
      const wireParams = {
        connectionId: trusted.connectionId,
        uploadId: params.uploadId,
        sessionId: params.sessionId,
      };
      assertV4AttachmentNdjsonEnvelope(V4_METHODS.attachmentAbort, wireParams);
      await client.request(V4_METHODS.attachmentAbort, wireParams, v4AttachmentAbortResultSchema);
    },

    async attachmentReadV4(params: XCodeAgentAttachmentReadParams) {
      if (!readTrustedXCodeAgentV4Connection(params)) {
        throw new Error("fault.attachment.readConnectionUntrusted");
      }
      const wireParams = v4AttachmentReadParamsSchema.parse({
        ...coldResumeWorkspace(params),
        sessionId: params.sessionId,
        ref: params.ref,
        ...(params.target ? { target: params.target } : {}),
        ...(params.attachmentIndex !== undefined
          ? { attachmentIndex: params.attachmentIndex }
          : {}),
        offset: params.offset,
        limit: params.limit,
      });
      const client = await getReadOnlyClient(params);
      return client.request(V4_METHODS.attachmentRead, wireParams, v4AttachmentReadResultSchema);
    },

    async conversationAttachmentReadV4(params: XCodeAgentConversationAttachmentReadParams) {
      if (!readTrustedXCodeAgentV4Connection(params)) {
        throw new XCodeAttachmentFaultError(
          XCODE_ATTACHMENT_FAULT_CODES.shareReadConnectionUntrusted,
        );
      }
      const wireParams = v4ConversationAttachmentReadParamsSchema.parse({
        ...coldResumeWorkspace(params),
        sessionId: params.sessionId,
        ref: params.ref,
        target: params.target,
        attachmentIndex: params.attachmentIndex,
        offset: params.offset,
        limit: params.limit,
      });
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationAttachmentRead,
        wireParams,
        v4ConversationAttachmentReadResultSchema,
      );
    },

    async conversationAttachmentStatV4(params: XCodeAgentConversationAttachmentStatParams) {
      if (!readTrustedXCodeAgentV4Connection(params)) {
        throw new XCodeAttachmentFaultError(
          XCODE_ATTACHMENT_FAULT_CODES.shareStatConnectionUntrusted,
        );
      }
      const wireParams = v4ConversationAttachmentStatParamsSchema.parse({
        ...coldResumeWorkspace(params),
        sessionId: params.sessionId,
        ref: params.ref,
        target: params.target,
        attachmentIndex: params.attachmentIndex,
      });
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationAttachmentStat,
        wireParams,
        v4ConversationAttachmentStatResultSchema,
      );
    },

    async attachmentPreviewSourceV4(params: XCodeAgentAttachmentPreviewSourceParams) {
      const trusted = readTrustedXCodeAgentV4Connection(params);
      if (!trusted) throw new Error("fault.attachment.previewSourceConnectionUntrusted");
      if (trusted.clientMode !== "desktop-continuous" || params.remoteSessionId) {
        return { kind: "chunked" } as const;
      }
      const wireParams = v4AttachmentPreviewSourceParamsSchema.parse({
        ...coldResumeWorkspace(params),
        sessionId: params.sessionId,
        ref: params.ref,
        ...(params.target ? { target: params.target } : {}),
        ...(params.attachmentIndex !== undefined
          ? { attachmentIndex: params.attachmentIndex }
          : {}),
        clientMode: trusted.clientMode,
      });
      const client = await getReadOnlyClient(params);
      const source = await client.request(
        V4_METHODS.attachmentPreviewSource,
        wireParams,
        v4AttachmentPreviewSourceResultSchema,
      );
      if (source.kind !== "local_path") return source;
      if (!options?.authorizeLocalMediaPreviewPath) {
        throw new Error("fault.attachment.previewPathAuthorizationUnavailable");
      }
      return {
        ...source,
        path: await options.authorizeLocalMediaPreviewPath(source.path),
      };
    },

    // 行分页：只读 query 透传（超时重发安全，无订阅状态）。
    async conversationRowsRangeV4(params: XCodeAgentConversationRowsRangeParams) {
      const trusted = readTrustedXCodeAgentV4Connection(params);
      if (!trusted) throw new Error("fault.conversation.rowsRangeConnectionUntrusted");
      const residentOnly = params.residency === "resident-only";
      const client = residentOnly
        ? await getResidentRowsClient(params)
        : await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationRowsRange,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          clientMode: trusted.clientMode,
          ...(params.beforeRowId !== undefined ? { beforeRowId: params.beforeRowId } : {}),
          limit: params.limit,
          ...(residentOnly ? { residency: "resident-only" as const } : {}),
        },
        v4ConversationRowsRangeResultSchema,
      );
    },

    // 只读计划目录沿现有 workspace attachment 透传，不建立新 runtime。
    async conversationPlansV4(params: XCodeAgentConversationPlansParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationPlans,
        { ...coldResumeWorkspace(params), sessionId: params.sessionId },
        v4ConversationPlansResultSchema,
      );
    },

    // 输入预测：只读 query；绝不为它拉起运行时（existing-only）。开关关闭、无运行时、
    // 旧 CLI 不认识方法、模型失败都降级为空结果——ghost hint 是可有可无的建议。
    async conversationInputPredictionV4(params: ZCodeAgentConversationInputPredictionParams) {
      if (!isRemoteInputPredictionEnabled()) {
        return emptyInputPredictionResult("unavailable", params.requestId);
      }
      try {
        const client = await getReadOnlyClient(params, "existing-only");
        return await client.request(
          V4_METHODS.conversationInputPrediction,
          {
            sessionId: params.sessionId,
            revision: params.revision,
            ...(params.draft !== undefined ? { draft: params.draft } : {}),
            ...(params.requestId !== undefined ? { requestId: params.requestId } : {}),
          },
          v4ConversationInputPredictionResultSchema,
        );
      } catch {
        return emptyInputPredictionResult("unavailable", params.requestId);
      }
    },

    // workflow run 事件日志：同样是只读 query，沿现有 workspace attachment 透传。
    // 分页发生在存储层（JournalStorePort.listEvents 带 afterSequence/limit），这里不切片；
    // 在 RPC 层切等于每翻一页把整条 journal 读进内存。
    async conversationWorkflowRunEventsV4(params: XCodeAgentConversationWorkflowRunEventsParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunEvents,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          runId: params.runId,
          ...(params.afterSequence !== undefined ? { afterSequence: params.afterSequence } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        v4ConversationWorkflowRunEventsResultSchema,
      );
    },

    // workflow run 枚举：journal-backed 的重启后发现面（workflowRuns 投影跨进程不存活）。
    async conversationWorkflowRunsV4(params: XCodeAgentConversationWorkflowRunsParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRuns,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        v4ConversationWorkflowRunsResultSchema,
      );
    },

    // dwf 用户面产物的三条读面。
    // ⚠ 术语：artifact = 脚本发布给用户看的产出，不是 run 的顶层返回值。
    // 三条与 plans / workflowRunEvents 同族：只读、无状态、超时重发安全，走只读客户端。
    async conversationWorkflowRunArtifactsV4(
      params: XCodeAgentConversationWorkflowRunArtifactsParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunArtifacts,
        { ...coldResumeWorkspace(params), sessionId: params.sessionId, runId: params.runId },
        v4ConversationWorkflowRunArtifactsResultSchema,
      );
    },

    // 看板取数：limit 的缺省与钳制在 CLI 网关侧，这里只透传——两处各钳一次，
    // 同一个 limit 迟早会在两层上得到不同的页大小。
    async conversationWorkflowRunArtifactDataV4(
      params: XCodeAgentConversationWorkflowRunArtifactDataParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunArtifactData,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          runId: params.runId,
          artifactId: params.artifactId,
          ...(params.afterSequence !== undefined ? { afterSequence: params.afterSequence } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        v4ConversationWorkflowRunArtifactDataResultSchema,
      );
    },

    // 字节：一次一块（≤ 512 KiB），拼接归 renderer 的 hook。授权全在 CLI 侧——
    // 这里传下去的 id 只用于在 journal 里查行，绝不成为路径。
    async conversationWorkflowRunArtifactReadV4(
      params: XCodeAgentConversationWorkflowRunArtifactReadParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunArtifactRead,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          runId: params.runId,
          artifactId: params.artifactId,
          version: params.version,
          offset: params.offset,
          limit: params.limit,
        },
        v4ConversationWorkflowRunArtifactReadResultSchema,
      );
    },

    // dwf 工作区 transcript 的两条读面。同族：
    // 只读、无状态、超时重发安全，走只读客户端。maxBytes 的缺省与钳制在 CLI 网关侧。
    async conversationWorkflowRunWorkspaceV4(
      params: XCodeAgentConversationWorkflowRunWorkspaceParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunWorkspace,
        { ...coldResumeWorkspace(params), sessionId: params.sessionId, runId: params.runId },
        v4ConversationWorkflowRunWorkspaceResultSchema,
      );
    },

    async conversationWorkflowRunNodeResultV4(
      params: XCodeAgentConversationWorkflowRunNodeResultParams,
    ) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationWorkflowRunNodeResult,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          runId: params.runId,
          siteId: params.siteId,
          ordinal: params.ordinal,
          ...(params.maxBytes !== undefined ? { maxBytes: params.maxBytes } : {}),
        },
        v4ConversationWorkflowRunNodeResultResultSchema,
      );
    },

    async backgroundBashOutputV4(params: XCodeAgentBackgroundBashOutputParams) {
      if (!readTrustedXCodeAgentV4Connection(params))
        throw new Error("fault.bashOutput.connectionUntrusted");
      const wireParams = v4BackgroundBashOutputParamsSchema.parse({
        sessionId: params.sessionId,
        workId: params.workId,
      });
      try {
        const client = await getReadOnlyClient(params, "existing-only");
        return await client.request(
          V4_METHODS.backgroundBashOutput,
          wireParams,
          backgroundBashOutputResultSchema,
        );
      } catch (error) {
        if (isProtocolMethodNotFoundError(error))
          return { kind: "unsupported", workId: params.workId };
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === XCODE_AGENT_RUNTIME_UNAVAILABLE_CODE
        ) {
          return { kind: "unavailable", workId: params.workId };
        }
        throw error;
      }
    },

    async conversationFileChangesV4(params: XCodeAgentConversationFileChangesParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationFileChanges,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          target: params.target,
          baseRevision: params.baseRevision,
          baseLogEpoch: params.baseLogEpoch,
        },
        v4ConversationFileChangesResultSchema,
      );
    },

    async conversationFileRewindPreviewV4(params: XCodeAgentConversationFileRewindPreviewParams) {
      const client = await getReadOnlyClient(params);
      return client.request(
        V4_METHODS.conversationFileRewindPreview,
        {
          ...coldResumeWorkspace(params),
          sessionId: params.sessionId,
          target: params.target,
          baseRevision: params.baseRevision,
          baseLogEpoch: params.baseLogEpoch,
        },
        v4ConversationFileRewindPreviewResultSchema,
      );
    },

    async getSessionLifecycle(params) {
      const client = await getReadOnlyClient(params);
      try {
        return await client.sessionLifecycle.getState(params.sessionId);
      } catch (error) {
        // 较旧 CLI 尚无该协议；只对 method-not-found 回落旧订阅，不吞掉断线或真实初始化错误。
        if (error instanceof Error && "code" in error && error.code === -32601) return null;
        throw error;
      }
    },
    async ensureSessionReady(params) {
      const client = await getClient(params);
      await client.sessionLifecycle.ensureReady(params.sessionId, buildWorkspaceRef(params));
    },
    async stopSessionRuntime(params) {
      const client = await getClient(params);
      await client.sessionLifecycle.stop(params.sessionId);
    },
    async restartSessionRuntime(params) {
      const client = await getClient(params);
      try {
        await client.sessionLifecycle.restart(params.sessionId, buildWorkspaceRef(params));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === -32601)
          throw new Error("fault.sessionLifecycle.unsupported", { cause: error });
        throw error;
      }
    },
    onDynamicSessionLifecycle(params) {
      return (listener: (snapshot: SessionLifecycleSnapshot) => void) =>
        sessionLifecycleEmitter.event((event) => {
          if (event.workspaceKey === resolveWorkspaceKey(params)) listener(event.snapshot);
        });
    },
    onDynamicConversationFrame(params: XCodeAgentWorkspaceTarget) {
      return getConversationFrameEmitter(params).event;
    },

    onDynamicLocalTtftFacts(params: XCodeAgentWorkspaceTarget) {
      return (listener: (facts: LocalTtftFacts) => void) =>
        localTtftFactsEmitter.event((event) => {
          if (event.workspaceKey === resolveWorkspaceKey(params)) listener(event.facts);
        });
    },
    onDynamicRemoteConversationTelemetry() {
      return remoteConversationTelemetryEmitter.event;
    },
    onDynamicConversationTelemetryFact(params: XCodeAgentWorkspaceTarget) {
      return getConversationTelemetryFactEmitter(params).event;
    },
    getContextComposition: (params) => contextComposition.getContextComposition(params),
    getPluginMentionItems: (params) => pluginHostQueries.getPluginMentionItems(params),
    onDynamicContextCompositionChanged: (target) => contextComposition.onDidChange(target),
    onDynamicModelRequestMetrics: (target) => contextComposition.onModelRequestMetrics(target),
    onDynamicOffPeakLifecycle(params: XCodeAgentWorkspaceTarget) {
      return getOffPeakLifecycleEmitter(params).event;
    },
    async controlOffPeakExecutionV4(
      params: XCodeAgentWorkspaceTarget & { control: OffPeakControlParams },
    ) {
      const control = offPeakControlParamsSchema.parse(params.control);
      const client = await getReadOnlyClient(params, "existing-only");
      return client.request(V4_METHODS.offPeakControl, control, offPeakControlResultSchema);
    },

    onDynamicPluginUiToolResult() {
      return pluginUiToolResultEmitter.event;
    },
    onDynamicCuaPermissionObservation() {
      return cuaPermissionObservationEmitter.event;
    },

    // ── sessions-index 通道（列表活性）：复用 conversationSubscribe RPC，
    // 按 topic 前缀由 CLI server 分派 ──

    async reconcileSessionsIndexV4(params) {
      const client = await getReadOnlyClient(params, "existing-only");
      return client.request(
        V4_METHODS.sessionsIndexReconcile,
        { workspaceId: resolveWorkspaceKey(params), sessionIds: params.sessionIds },
        sessionsIndexReconcileResultSchema,
      );
    },

    async subscribeSessionsIndexV4(params: XCodeAgentSessionsIndexSubscribeParams) {
      // 侧栏会同时登记所有 restored workspace。被动订阅若使用启动型 client，
      // workspace 数量会直接放大成 CLI 数量；existing-only 缺 runtime 时只进入 dormant。
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      const connection = resolveV4Connection(params, v4ConnectionIdFor(params.subscriberScope));
      const topic = sessionsIndexTopic(resolveWorkspaceKey(params));
      // 3.3.6 的 CLI session 未写 remote workspace_id，但同版本 host task index
      // 已按完整 identity 隔离。升级时必须用当前 workspaceKey 下的 taskId 作归属证明；
      // 禁止只把 workspacePath 传给 CLI，否则同路径不同 SSH/WSL authority 会互相认领历史。
      let legacyTaskIds: string[] = [];
      if (supportsLegacyRemoteTaskAllowlist(params.workspaceIdentity)) {
        try {
          legacyTaskIds = (
            await automationTaskIndexRepo.listTaskMetas({
              workspacePath: params.workspacePath,
              workspaceIdentity: params.workspaceIdentity,
              provider: "glm",
            })
          )
            .slice(0, MAX_LEGACY_TASK_IDS_PER_SUBSCRIBE)
            .map((task) => task.taskId);
        } catch (error) {
          // 归属证明只用于升级迁移；task index 不可用时仍要让已有完整
          // identity 的 3.4 会话走严格查询，不能让兼容读取故障变成整个列表不可用。
          logger.warn(undefined, "读取远端历史任务归属证明失败，继续按严格 identity 订阅", {
            error: error instanceof Error ? error.message : String(error),
            event: "sessions_index.legacy_remote_allowlist_read_failed",
            workspaceIdentity: params.workspaceIdentity,
            workspacePath: params.workspacePath,
          });
        }
      }
      // 本地 worktree 任务的 cwd 不是 workspace 目录，CLI 按 directory 冷扫描看不到它们；
      // 从 tasks-index 精确提供 id（docs/git/worktree.md §6.6.2）。读取失败只影响这些任务的摘要。
      let worktreeSessionIds: string[] = [];
      if (!params.workspaceIdentity?.trim()) {
        try {
          worktreeSessionIds = (
            await automationTaskIndexRepo.listTaskMetas({
              workspacePath: params.workspacePath,
              provider: "glm",
            })
          )
            .filter((task) => Boolean(task.worktreeRoot))
            .slice(0, MAX_LEGACY_TASK_IDS_PER_SUBSCRIBE)
            .map((task) => task.taskId);
        } catch (error) {
          logger.warn(
            undefined,
            "读取 worktree 任务列表失败，sessions-index 不含这些任务的冷摘要",
            {
              error: error instanceof Error ? error.message : String(error),
              event: "sessions_index.worktree_task_ids_read_failed",
              workspacePath: params.workspacePath,
            },
          );
        }
      }
      const result = await client.request(
        V4_METHODS.conversationSubscribe,
        {
          topic,
          connectionId: connection.connectionId,
          clientMode: connection.clientMode,
          ...(legacyTaskIds.length > 0 ? { legacyTaskIds } : {}),
          ...(worktreeSessionIds.length > 0 ? { worktreeSessionIds } : {}),
          ...(params.base ? { base: params.base } : {}),
          ...(params.visibility ? { visibility: params.visibility } : {}),
        },
        v4SessionsIndexSubscribeResultSchema,
      );
      rememberV4SubscriptionRoute(
        params,
        topic,
        result.ack.subscriptionId,
        connection.connectionId,
      );
      return result;
    },

    async unsubscribeSessionsIndexV4(params: XCodeAgentConversationUnsubscribeParams) {
      await unsubscribeV4Route(params, "sessions-index/");
    },

    async resyncSessionsIndexV4(params: XCodeAgentConversationResyncParams) {
      return resyncV4Route(params, "sessions-index/");
    },

    onDynamicSessionsIndexFrame(params: XCodeAgentWorkspaceTarget) {
      return getSessionsIndexFrameEmitter(params).event;
    },

    // ── workspace-config 通道（配置目录活性）：复用 conversationSubscribe RPC，
    // 按 topic 前缀由 CLI server 分派 ──

    async subscribeWorkspaceConfigV4(params: XCodeAgentWorkspaceConfigSubscribeParams) {
      const client = await getReadOnlyClient(params, params.runtimePolicy);
      const connection = resolveV4Connection(params, v4ConnectionIdFor(params.subscriberScope));
      const topic = workspaceConfigTopic(resolveWorkspaceKey(params));
      const result = await client.request(
        V4_METHODS.conversationSubscribe,
        {
          topic,
          connectionId: connection.connectionId,
          clientMode: connection.clientMode,
          ...(params.base ? { base: params.base } : {}),
          ...(params.visibility ? { visibility: params.visibility } : {}),
        },
        v4WorkspaceConfigSubscribeResultSchema,
      );
      rememberV4SubscriptionRoute(
        params,
        topic,
        result.ack.subscriptionId,
        connection.connectionId,
      );
      return result;
    },

    async unsubscribeWorkspaceConfigV4(params: XCodeAgentConversationUnsubscribeParams) {
      await unsubscribeV4Route(params, "workspace-config/");
    },

    async resyncWorkspaceConfigV4(params: XCodeAgentConversationResyncParams) {
      return resyncV4Route(params, "workspace-config/");
    },

    onDynamicWorkspaceConfigFrame(params: XCodeAgentWorkspaceTarget) {
      return getWorkspaceConfigFrameEmitter(params).event;
    },

    onDynamicProcessResourceSample() {
      return processResourceSampleEmitter.event;
    },

    onDynamicToolExecResource() {
      return toolExecResourceEmitter.event;
    },
    onDynamicMcpResourceSamples() {
      return mcpResourceSamplesEmitter.event;
    },

    onDynamicMcpTelemetry() {
      return mcpTelemetryEmitter.event;
    },
    onDynamicPluginStartupDegraded(params: XCodeAgentWorkspaceTarget) {
      return (listener) => {
        const key = resolveWorkspaceKey(params);
        let seen: XCodeProtocolClient | undefined;
        const accept = (client: XCodeProtocolClient) => {
          if (client.isDisposed || !client.pluginStartupDegraded || seen === client) return;
          seen = client;
          listener();
        };
        const disposable = pluginStartupDegradedEmitter.event((event) => {
          if (event.workspaceKey === key) accept(event.client);
        });
        // 先订阅再回放，覆盖预热早于 UI 挂载和手机晚接入；只读取当前工作区进程。
        for (const runtime of processManager.listManagedProcesses()) {
          if (resolveWorkspaceKey(runtime) === key) accept(runtime.client);
        }
        return disposable;
      };
    },

    // （CLI 重连重订）：进程换代直通 process manager；v4 订阅方（task-index
    // syncer 等）据此重发 subscribe——订阅活在 CLI 进程内存，换代即静默失活。
    onAgentRuntimeRestarted(listener) {
      return processManager.onRuntimeRestarted(listener);
    },

    onAgentRuntimeLifecycle(listener: (event: XCodeAgentRuntimeLifecycleEvent) => void) {
      return processManager.onRuntimeLifecycle(listener);
    },

    onAgentRuntimeExited(listener: (event: XCodeAgentRuntimeExitedEvent) => void) {
      return processManager.onRuntimeExited(listener);
    },

    async disposeWorkspace(params): Promise<void> {
      const workspaces = processManager.getRuntimeWorkspaces(params);
      if (params.releasePreparation && processManager.isSharedRuntime(params)) {
        cancelWaitingWorkspaceStartup(resolveWorkspaceKey(params));
        const client = processManager.getExistingClient(params);
        if (client) {
          for (const [sessionId, key] of clientSessions.get(client) ?? []) {
            if (key !== resolveWorkspaceKey(params)) continue;
            await client.request(
              zcodeProtocolMethods.sessionClose,
              { sessionId, expectedPersistence: "deferred" },
              zcodeSessionCloseResultSchema,
              { invalidateConnectionOnTimeout: false },
            );
          }
        }
        return;
      }
      for (const target of workspaces.length ? workspaces : [params]) {
        const workspaceKey = resolveWorkspaceKey(target);
        // 释放不仅要终止当前进程，还要让已排队的 provider-ready continuation 失效；
        // 否则它会在 dispose 完成后把同一个 workspace 的 Agent 再次启动。
        cancelWaitingWorkspaceStartup(workspaceKey);
        clearV4SubscriptionRoutes(workspaceKey);
        cuaOperationTurnTracker?.clearWorkspaceKey(workspaceKey);
        const active = activeClientsByWorkspaceKey.get(workspaceKey);
        if (active) {
          invalidateWorkspaceClient(workspaceKey, active.client);
        }
        // 该入口被 restartWorkspaceProcess 用作 runtime invalidation，并非
        // workspace/service 真 teardown。销毁 workspace emitter 会让既有 UI/task-index
        // listener 永久绑在死对象上；emitters 只由 disposeLocalState/disposeAll 释放。
        remoteConversationTelemetry.get(workspaceKey)?.dispose();
        remoteConversationTelemetry.delete(workspaceKey);
      }
      await processManager.disposeWorkspace(params);
    },

    async supportsWorktreeCwd(target) {
      // 能力集合在 getClient 的启动屏障内写入，这里读到的是本次连接协商后的结果。
      const client = await getClient(target);
      return worktreeCwdClients.has(client);
    },

    async supportsExtensionInputSource(target) {
      // 与 supportsWorktreeCwd 同一启动屏障；CLI 换代后 getClient 返回新连接，结果随之重算。
      const client = await getClient(target);
      return extensionInputSourceClients.has(client);
    },

    async supportsConversationQuoteComment(target) {
      // 与 worktreeCwd 相同：能力集合在 getClient 的启动屏障内写入。
      const client = await getClient(target);
      return conversationQuoteCommentClients.has(client);
    },

    disposeAll(): void {
      processManager.disposeAll();
      pluginProcessManager.disposeAll();
      mcpStatusProcessManager.disposeAll();
      // automation 专用的 AutomationRepo / TaskIndexRepo 各持 tasks-index.sqlite
      // 连接句柄，dispose 后必须收口，否则 Windows 上句柄悬着（临时目录清理撞 EBUSY）
      automationRepo.close();
      automationTaskIndexRepo.close();
      disposeLocalState();
    },

    async disposeAllAndWait(): Promise<void> {
      await Promise.all([
        processManager.disposeAllAndWait(),
        pluginProcessManager.disposeAllAndWait(),
        mcpStatusProcessManager.disposeAllAndWait(),
      ]);
      automationRepo.close();
      automationTaskIndexRepo.close();
      disposeLocalState();
    },
  };

  // 删除 worktree 期间拒绝其中会话的新命令与冷订阅，避免在正被删除的目录里启动 turn 或恢复会话（§8.3）。
  const runSessionOperation = options?.runSessionOperation;
  if (runSessionOperation) {
    const send = service.sendConversationCommandV4.bind(service);
    service.sendConversationCommandV4 = (params) => {
      const sessionId = params.envelope.sessionId;
      return sessionId
        ? runSessionOperation(sessionTargetOf(params, sessionId), () => send(params))
        : send(params);
    };
    const subscribe = service.subscribeConversationV4.bind(service);
    service.subscribeConversationV4 = (params) =>
      runSessionOperation(sessionTargetOf(params, params.sessionId), () => subscribe(params));
  }
  // 敏感设置读取不挂在 service 对象上：service 会整体登记进 ServiceCollection 并经 RPC 暴露，
  // ProxyChannel 按属性名分派，所以只放进侧表，由 Window Host 进程内取用。
  inProcessPluginUserOptionsReaders.set(service, {
    readPluginUserOptions: (params) => pluginHostQueries.readPluginUserOptions(params),
  });
  return service;
}

/**
 * Window Host 进程内的插件 user 层设置读取（含敏感值），键是 createXCodeAgentService 返回的对象。
 * WeakMap 条目不是任何对象的属性，RPC 的 ProxyChannel 无法按名字触达。
 */
const inProcessPluginUserOptionsReaders = new WeakMap<
  IXCodeAgentService,
  PluginUserOptionsReader
>();

/** 只由 node.ts 的 Local Host 装配调用；远端或测试替身的 agent 服务没有条目，返回 undefined。 */
export function getInProcessPluginUserOptionsReader(
  service: IXCodeAgentService,
): PluginUserOptionsReader | undefined {
  return inProcessPluginUserOptionsReaders.get(service);
}

function sessionTargetOf(
  workspace: { workspacePath: string; workspaceIdentity?: string },
  sessionId: string,
): XCodeAgentSessionTarget {
  return {
    workspacePath: workspace.workspacePath,
    ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}),
    sessionId,
  };
}
