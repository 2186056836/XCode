import type { IXCodeSessionService } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useXCodeSessionService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IXCodeSessionService {
  // useWorkspaceServices 内部自带 unscoped 回退（workspacePath 为空时等价 useServices），
  // 无条件调用以满足 rules-of-hooks（1112 起 react/rules-of-hooks 升级为 error）。
  const services = useWorkspaceServices(workspacePath, preferredRemoteSessionId, workspaceIdentity);
  return services.zcodeSessionService;
}
