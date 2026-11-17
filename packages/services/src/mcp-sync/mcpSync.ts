import type {
  LoadCliMcpFromUserDirectoryRequest,
  LoadCliMcpFromUserDirectoryResult,
  McpDataSyncPayload,
  McpSyncCandidateListResult,
  McpSyncExportResult,
  McpSyncExportedServer,
  McpSyncImportResult,
  McpSyncRemoteStatusResult,
  RemoteSyncWriteAccessResult,
  SaveCliMcpToUserDirectoryRequest,
  XCodeAgentMcpServer,
  XCodeMcpListMode,
  XCodeMcpListResult,
  WorkspaceMcpTrustDecision,
  ZCodeWorkspaceMcpTrustResult,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import type { IDataSyncCategoryService } from "../data-sync/contract.js";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * MCP 通道：设置页配置读写 + 数据同步（IDataSyncCategoryService，docs/remote/data-sync.md「MCP 服务器」）。
 */
export interface IMcpSyncService extends IDataSyncCategoryService<McpDataSyncPayload> {
  loadMcpFromUserDirectory(
    request?: LoadCliMcpFromUserDirectoryRequest,
  ): Promise<LoadCliMcpFromUserDirectoryResult>;
  /**
   * workspace MCP server 运行态状态列表（原 UI 直调 zcodeAgentService 的
   * mcp/list）。真实 connect/listTools 检查必须发生在 agent 进程（PATH/cwd 是
   * workspace 环境），本服务只是 UI 的注入面——mcp/list 词的 host 消费收拢到实现一处。
   */
  listWorkspaceMcpServerStatuses(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    mcpServers?: XCodeAgentMcpServer[];
    mode?: XCodeMcpListMode;
  }): Promise<XCodeMcpListResult>;
  setWorkspaceMcpTrust?(params: WorkspaceMcpTrustDecision): Promise<ZCodeWorkspaceMcpTrustResult>;
  saveMcpToUserDirectory(payload: SaveCliMcpToUserDirectoryRequest): Promise<void>;
  // ---- Legacy per-category sync API (fork UI: RemoteMcpSyncDialog) ----
  listLocalUserMcpCandidates(): Promise<McpSyncCandidateListResult>;
  listRemoteUserMcpStatuses(params: { names: string[] }): Promise<McpSyncRemoteStatusResult>;
  exportMcpServers(params: { serverIds: string[] }): Promise<McpSyncExportResult>;
  importMcpServers(params: {
    servers: McpSyncExportedServer[];
    localHomeDir: string;
    localWorkspacePath?: string;
    remoteWorkspacePath?: string;
    overwrite?: false;
  }): Promise<McpSyncImportResult>;
  checkRemoteUserMcpWriteAccess(): Promise<RemoteSyncWriteAccessResult>;
}

export const IMcpSyncService = createServiceDescriptor<IMcpSyncService>(ServiceChannels.McpSync);
