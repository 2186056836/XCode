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
