import type {
  XCodeAgentMcpServer,
  XCodeAutomationScheduleRule,
  XCodeMcpListMode,
  ModelSelection,
} from "@zcode/shared";

export interface XCodeAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  /** 远程 workspace 的运行时会话身份；只用于隔离/路由，不能替代 workspacePath。 */
  remoteSessionId?: string;
}

export interface XCodeAgentPluginViewParams extends XCodeAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface XCodeAgentListMcpServerStatusesParams extends XCodeAgentWorkspaceTarget {
  mcpServers?: XCodeAgentMcpServer[];
  mode?: XCodeMcpListMode;
}

export interface XCodeAgentAddPluginMarketplaceParams extends XCodeAgentWorkspaceTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface XCodeAgentRemovePluginMarketplaceParams extends XCodeAgentWorkspaceTarget {
  marketplace: string;
}

export interface XCodeAgentUpdatePluginMarketplaceParams extends XCodeAgentWorkspaceTarget {
  marketplace?: string;
  operationId?: string;
}

export interface XCodeAgentInstallPluginParams extends XCodeAgentWorkspaceTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface XCodeAgentCancelPluginOperationParams {
  operationId: string;
}

export interface XCodeAgentUninstallPluginParams extends XCodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface XCodeAgentUpdatePluginParams extends XCodeAgentWorkspaceTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface XCodeAgentRestoreBuiltinPluginParams extends XCodeAgentWorkspaceTarget {
  pluginId: string;
}

export interface XCodeAgentConfigurePluginParams extends XCodeAgentWorkspaceTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface XCodeAgentResetPluginConfigParams extends XCodeAgentWorkspaceTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface XCodeAgentValidatePluginParams extends XCodeAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface XCodeAgentDescribePluginParams extends XCodeAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface XCodeAgentSetPluginEnabledParams extends XCodeAgentWorkspaceTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

// Plugin 对话引用 catalog：
// 带 sessionId → session-owned 冻结 catalog（必须路由到持有该 session 的 workspace client）；
// 不带 → workspace 当前 catalog（新建草稿 Picker）。
export interface XCodeAgentPluginReferenceCatalogParams extends XCodeAgentWorkspaceTarget {
  sessionId?: string;
}

// Composer Skill catalog：与 Plugin 引用相同，以 sessionId 区分 workspace 当前目录和
// resident Session runtime 快照；不参与 Settings 管理目录。
export interface XCodeAgentSkillReferenceCatalogParams extends XCodeAgentWorkspaceTarget {
  sessionId?: string;
}
export interface XCodeAgentResolveSuggestedPluginReferenceParams extends XCodeAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

// ---- 定时任务(automation)管理参数 ----

export interface XCodeAgentCreateAutomationParams extends XCodeAgentWorkspaceTarget {
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: XCodeAutomationScheduleRule;
}

export interface XCodeAgentUpdateAutomationParams extends XCodeAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: XCodeAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface XCodeAgentAutomationIdParams extends XCodeAgentWorkspaceTarget {
  automationId: string;
}

export interface XCodeAgentSetAutomationEnabledParams extends XCodeAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface XCodeAgentDeleteAutomationRunParams extends XCodeAgentWorkspaceTarget {
  runId: string;
}
