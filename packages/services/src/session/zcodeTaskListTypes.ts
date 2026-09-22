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

export type XCodeTaskGroupColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple";

export interface XCodeTaskGroup {
  id: string;
  title: string;
  color: XCodeTaskGroupColor;
  createdAt: number;
  updatedAt: number;
}

export interface XCodeGroupedTaskRef {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
}

export type XCodeGroupedTaskViewTopLevelNodeRef =
  | { type: "group"; groupId: string }
  | { type: "task"; task: XCodeGroupedTaskRef };

export type XCodeGroupedTaskViewNode =
  | {
      type: "group";
      group: XCodeTaskGroup;
      tasks: XCodeTaskListItem[];
      sortOrder?: number;
    }
  | {
      type: "task";
      task: XCodeTaskListItem;
      sortOrder?: number;
    };

export interface XCodeGroupedTaskView {
  nodes: XCodeGroupedTaskViewNode[];
}

export interface XCodeGroupedTaskViewQuery {
  workspaceScopes: XCodeTaskListWorkspaceScope[];
  includeAllWorkspaces?: boolean;
}

// ── grouped 原始结构（不 join tasks 表）──
// grouped 视图的任务数据源迁到 sessions-index 后，服务端只提供分组结构
// （task_groups / task_group_members / task_group_view_node_orders），
// 由客户端与 sessions-index 会话做 join。

/** 组成员引用（不含任务 meta；task 内容由 sessions-index 提供）。 */
export interface XCodeGroupedTaskViewStructureMember {
  groupId: string;
  /** 服务端口径 workspaceKey（resolveWorkspaceKey：identity ?? path），join 匹配键。 */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  /** null = 尚未落 sort_order（新加入组）；客户端按 addedAt 降序补内存序。 */
  sortOrder: number | null;
  addedAt: number;
}

/** 顶层节点排序（task_group_view_node_orders，node_key 已解析为结构化引用）。 */
export type XCodeGroupedTaskViewStructureTopOrder =
  | { type: "group"; groupId: string; sortOrder: number }
  | { type: "task"; workspaceKey: string; taskId: string; sortOrder: number };

export interface XCodeGroupedTaskViewStructure {
  /** 已按 workspaceScopes 可见性过滤的 group（bootstrap workspace group 只在其 workspace 可见）。 */
  groups: XCodeTaskGroup[];
  /** 全量组成员（含不可见 group 的成员——顶层排除规则需要全量判断）。 */
  members: XCodeGroupedTaskViewStructureMember[];
  topLevelOrders: XCodeGroupedTaskViewStructureTopOrder[];
}

export interface XCodeGroupedTaskViewOrderInput {
  workspaceScopes: XCodeTaskListWorkspaceScope[];
  topLevelNodes: XCodeGroupedTaskViewTopLevelNodeRef[];
  groups: Array<{
    groupId: string;
    taskRefs: XCodeGroupedTaskRef[];
  }>;
}

export interface XCodeWorkspaceEventSubscriptionParams {
  workspacePath: string;
  workspaceIdentity?: string;
}
