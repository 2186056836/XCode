import { ServiceChannels } from "@zcode/shared";
import type {
  TraceId,
  XCodeAgentMcpServer,
  XCodeDeliveryKind,
  XCodeMessageWithParts,
  ModelSelection,
  XCodePermissionRequestParams,
  XCodeUserInputRequestParams,
  XCodeUserInputResponse,
  XCodeSessionInfo,
  XCodeSessionImportHistory,
  XCodeSessionEvent,
  XCodeSessionMode,
  XCodeSessionPersistence,
  XCodeSessionStateSnapshot,
  XCodeStateUpdatedNotification,
  XCodeWorkspacePresentation,
} from "@zcode/shared";
import { createServiceDescriptor } from "#src/descriptors.js";

export interface XCodeSessionWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export type XCodeSessionReadWorkspacePresentationParams = XCodeSessionWorkspaceTarget;

export interface XCodeTaskTarget extends XCodeSessionWorkspaceTarget {
  sessionId: string;
}

export interface XCodeSessionCreateParams extends XCodeSessionWorkspaceTarget {
  /** 仅导入事务使用的预分配 ID；普通新会话继续由 Agent 分配。 */
  sessionId?: string;
  sessionTraceId?: TraceId;
  parentSessionId?: string;
  mode?: XCodeSessionMode;
  model?: ModelSelection;
  persistence?: XCodeSessionPersistence;
  thoughtLevel?: string;
  mcpServers?: XCodeAgentMcpServer[];
  importedHistory?: XCodeSessionImportHistory;
}

export interface XCodeSessionResumeParams extends XCodeTaskTarget {
  model?: ModelSelection;
  thoughtLevel?: string;
  mcpServers?: XCodeAgentMcpServer[];
  /**
   * 默认广播 resume 得到的历史快照，并让 shadow 订阅请求初始 snapshot。
   * 续聊发送前的 runtime 预恢复会关闭它，避免旧终态快照覆盖本地已开始的新输入运行态。
   */
  broadcastSnapshot?: boolean;
}

export interface XCodeSessionListParams extends XCodeSessionWorkspaceTarget {
  includeArchived?: boolean;
  limit?: number;
}

export interface XCodeSessionReadParams extends XCodeTaskTarget {
  deliveryKind?: XCodeDeliveryKind;
  messageLimit?: number;
  afterSeq?: number;
}

export interface XCodeSessionMessagesParams extends XCodeTaskTarget {
  afterMessageId?: string;
  limit?: number;
}

export interface XCodeSessionEventsParams extends XCodeTaskTarget {
  afterSeq?: number;
  limit?: number;
}

export interface XCodeSessionSetModelParams extends XCodeTaskTarget {
  model: ModelSelection;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface XCodeSessionSetThoughtLevelParams extends XCodeTaskTarget {
  thoughtLevel?: string;
  expectedRevision?: number;
  persistAsWorkspaceLastUsed?: boolean;
}

export interface XCodeSessionSetModeParams extends XCodeTaskTarget {
  mode: XCodeSessionMode;
  expectedRevision?: number;
}

export interface XCodeSessionSubscribeParams extends XCodeTaskTarget {
  deliveryKind: XCodeDeliveryKind;
  afterSeq?: number;
  includeSnapshot?: boolean;
  eventCoalescing?: {
    mode: "background-summary";
    intervalMs?: number;
  };
}

export type XCodeSessionServiceEvent =
  | { type: "session.event"; event: XCodeSessionEvent }
  | { type: "state.updated"; notification: XCodeStateUpdatedNotification }
  | { type: "permission.request"; request: XCodePermissionRequestParams }
  | { type: "userInput.request"; request: XCodeUserInputRequestParams }
  | {
      type: "userInput.response";
      requestId: string;
      response: XCodeUserInputResponse;
    }
  | { type: "snapshot"; snapshot: XCodeSessionStateSnapshot };

export interface XCodeSessionInitializeResult {
  available: boolean;
  workspaceKey: string;
  protocolName?: string;
  protocolVersion?: number;
  transportKind?: "stdio" | "websocket";
  reason?: string;
  reasonCode?: "provider_not_ready";
}

export interface XCodeSessionWorkspaceRuntimeIdentity {
  generation: number;
  identity: string;
  processId?: number;
  workspaceKey: string;
}

export interface IXCodeSessionService {
  initializeWorkspace(params: XCodeSessionWorkspaceTarget): Promise<XCodeSessionInitializeResult>;
  getWorkspaceRuntimeIdentity(
    params: XCodeSessionWorkspaceTarget,
  ): Promise<XCodeSessionWorkspaceRuntimeIdentity>;
  readWorkspacePresentation(
    params: XCodeSessionReadWorkspacePresentationParams,
  ): Promise<XCodeWorkspacePresentation>;
  createSession(params: XCodeSessionCreateParams): Promise<XCodeSessionStateSnapshot>;
  resumeSession(params: XCodeSessionResumeParams): Promise<XCodeSessionStateSnapshot>;
  listSessions(params: XCodeSessionListParams): Promise<XCodeSessionInfo[]>;
  readSession(params: XCodeSessionReadParams): Promise<XCodeSessionStateSnapshot>;
  readSessionMessages(params: XCodeSessionMessagesParams): Promise<XCodeMessageWithParts[]>;
  readSessionEvents(params: XCodeSessionEventsParams): Promise<XCodeSessionEvent[]>;
  promoteDeferredDraftSession(params: XCodeTaskTarget): Promise<void>;
  closeSession(params: XCodeTaskTarget): Promise<void>;
  closeDeferredDraftSession(params: XCodeTaskTarget): Promise<boolean>;
  setModel(params: XCodeSessionSetModelParams): Promise<XCodeSessionStateSnapshot>;
  setThoughtLevel(params: XCodeSessionSetThoughtLevelParams): Promise<XCodeSessionStateSnapshot>;
  setMode(params: XCodeSessionSetModeParams): Promise<XCodeSessionStateSnapshot>;
  // renderer 订阅面走 agentService 的 conversation/sessions-index 帧通道。
}

export const IXCodeSessionService = createServiceDescriptor<IXCodeSessionService>(
  ServiceChannels.XCodeSession,
);
