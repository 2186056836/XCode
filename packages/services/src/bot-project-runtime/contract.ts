import type { IXCodeTaskService } from "#src/index.js";
import type { IModelSelectionService } from "#src/model-provider/providerFacadeServices.js";
import type {
  IXCodeAgentService,
  XCodeAgentAppRuntimePreferences,
} from "#src/zcode-agent/zcodeAgent.js";
import type { IRemoteProjectService } from "#src/remote-projects/contract.js";
export type { IXCodeTaskService, XCodeAgentAppRuntimePreferences };
export type BotRemoteTarget = { workspacePath: string; workspaceIdentity: string; hostId?: string };
export type BotRuntimeSubscription = { dispose(): void };
export interface BotProjectConnection {
  /** 物理连接的代际标识；router 不拥有或关闭该连接。 */
  owner: object;
  taskService: IXCodeTaskService;
  modelSelectionService: Pick<IModelSelectionService, "getView">;
  agentService: Pick<IXCodeAgentService, "syncAppRuntimePreferences">;
  bindWorkspace(target: BotRemoteTarget): Promise<void>;
}
export interface BotProjectRuntimePort {
  remoteProjectService: Pick<IRemoteProjectService, "readDirectory" | "connectHost">;
  resolveOnline(hostId: string): BotProjectConnection | undefined;
  onConnectionsChanged(listener: () => void): BotRuntimeSubscription;
  readBoundTargets(): Promise<readonly BotRemoteTarget[]>;
  readRuntimePreferences(): Promise<XCodeAgentAppRuntimePreferences>;
  warn(message: string): void;
}
/** 只路由现有 Source；不创建 workspace/session/Agent，不拥有 accepted queue。 */
export interface BotRemoteRuntimeService {
  isConnected(target: BotRemoteTarget): Promise<boolean>;
  ensureConnected(target: BotRemoteTarget): Promise<{ ok: boolean; message?: string }>;
  getXCodeTaskService(target: BotRemoteTarget): Promise<IXCodeTaskService | null>;
  getModelSelectionService(
    target: BotRemoteTarget,
  ): Promise<Pick<IModelSelectionService, "getView"> | null>;
  syncAppRuntimePreferences(preferences: XCodeAgentAppRuntimePreferences): Promise<void>;
}
