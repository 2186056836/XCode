import { resolveWorkspaceKey, type RemoteTarget, type WorkspacePurpose } from "@zcode/shared";
import { isWorkspaceTab, isWorkspaceTabReadOnly, type WindowTabState } from "@/store/tabStore.js";

export interface AutomationWorkspaceOption {
  projectId?: string | null;
  hostId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: RemoteTarget;
  label: string;
  workspacePurpose?: WorkspacePurpose;
}

export function resolveAutomationWorkspaceSelectionKey(
  workspace: Pick<
    AutomationWorkspaceOption,
    "workspacePath" | "workspaceIdentity" | "projectId" | "hostId"
  >,
): string {
  return workspace.projectId
    ? JSON.stringify([workspace.hostId ?? "local", workspace.projectId])
    : resolveWorkspaceKey(workspace);
}

export function findAutomationWorkspaceOptionByKey(
  options: readonly AutomationWorkspaceOption[],
  workspaceKey: string | null,
): AutomationWorkspaceOption | undefined {
  return options.find((option) => resolveAutomationWorkspaceSelectionKey(option) === workspaceKey);
}

/**
 * 新建表单的项目选择只能落在当前有效候选中。
 * 候选变化时保留仍有效的选择，否则依次回落到有效默认项目、首个有效项目或 null。
 */
export function reconcileAutomationWorkspaceSelectionKey(
  options: readonly AutomationWorkspaceOption[],
  currentWorkspaceKey: string | null,
  preferredWorkspace?: Pick<
    AutomationWorkspaceOption,
    "workspacePath" | "workspaceIdentity" | "projectId" | "hostId"
  >,
): string | null {
  const current = findAutomationWorkspaceOptionByKey(options, currentWorkspaceKey);
  if (current) return resolveAutomationWorkspaceSelectionKey(current);

  const preferredKey = preferredWorkspace
    ? resolveAutomationWorkspaceSelectionKey(preferredWorkspace)
    : null;
  const preferred = findAutomationWorkspaceOptionByKey(options, preferredKey);
  if (preferred) return resolveAutomationWorkspaceSelectionKey(preferred);

  const first = options[0];
  return first ? resolveAutomationWorkspaceSelectionKey(first) : null;
}

function workspaceLabelFromPath(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

/**
 * 构建纯项目候选，供不允许“无项目会话”的边界使用。
 * 定时任务表单额外展示的单一“无项目会话”目标由 useAutomationProjectOptions 显式归并；
 * recentProjects、conversation backing 与失效目录不能作为普通项目混入这里。
 *
 * 1019 上游把这里换成了「项目目录 + host」模型（useAutomationProjectOptions /
 * useSavedWorkflowProjectOptions），但 fork 的 run 保存控件仍按「已打开的工作区页签」取候选，
 * 因此这里保留 fork 独有的页签口径实现，不回退上游的新模型。
 */
export function buildAutomationWorkspaceOptions(
  tabs: readonly WindowTabState[],
): AutomationWorkspaceOption[] {
  const byKey = new Map<string, AutomationWorkspaceOption>();
  for (const tab of tabs) {
    if (
      !isWorkspaceTab(tab) ||
      tab.workspacePurpose === "conversation" ||
      isWorkspaceTabReadOnly(tab)
    ) {
      continue;
    }
    const key = resolveWorkspaceKey({
      workspacePath: tab.workspacePath,
      workspaceIdentity: tab.workspaceIdentity,
    });
    if (byKey.has(key)) continue;
    byKey.set(key, {
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
      ...(tab.remoteTarget ? { remoteTarget: tab.remoteTarget } : {}),
      label: tab.label || workspaceLabelFromPath(tab.workspacePath),
    });
  }
  return [...byKey.values()];
}
