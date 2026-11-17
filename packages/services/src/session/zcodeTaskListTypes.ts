import type { WorkspacePurpose, XCodeTaskMeta } from "@zcode/shared";

export type XCodeTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type XCodeTaskListSortBy = "created" | "updated";

export interface XCodeTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface XCodeTaskListQuery {
  kind: XCodeTaskListKind | "all";
  /** host 由存储 owner 确定全部范围，不接受 UI 已打开工作区作为历史目录。 */
  workspaceScopes: XCodeTaskListWorkspaceScope[] | "host";
  sortBy: XCodeTaskListSortBy;
  search?: string;
  limit?: number;
  /** 只返回这些会话（例如分享管理按来源会话 ID 解析跳转目标）；空数组返回空结果。 */
  taskIds?: readonly string[];
}

export type XCodeTaskListItem = XCodeTaskMeta & {
  searchSnippet?: string;
  searchSnippets?: string[];
};

export interface XCodeTaskListResult {
  items: XCodeTaskListItem[];
  total: number;
  hasMore: boolean;
}

export interface XCodeWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
