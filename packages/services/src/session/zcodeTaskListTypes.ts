import type { WorkspacePurpose, XCodeTaskMeta } from "@zcode/shared";

export type XCodeTaskListKind = "pinned" | "archived" | "timeline" | "active";
export type XCodeTaskListSortBy = "created" | "updated";

export interface XCodeTaskListWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface XCodeTaskListQuery {
  kind: XCodeTaskListKind;
  workspaceScopes: XCodeTaskListWorkspaceScope[];
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
