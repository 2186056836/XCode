import type { XCodeSessionStateSnapshot } from "@zcode/shared";
import type {
  XCodeSessionWorkspaceTarget,
  XCodeTaskTarget,
} from "#src/zcode-session/zcodeSession.js";

function getWorkspaceKey(target: XCodeSessionWorkspaceTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}

function getSessionScopedKey(target: XCodeTaskTarget): string {
  return `${getWorkspaceKey(target)}\0${target.sessionId}`;
}

export function createXCodeDeferredDraftRegistry() {
  const sessionKeys = new Set<string>();

  return {
    remember(params: XCodeSessionWorkspaceTarget, snapshot: XCodeSessionStateSnapshot): void {
      sessionKeys.add(
        getSessionScopedKey({
          workspacePath: snapshot.session.workspace.workspacePath,
          workspaceIdentity:
            snapshot.session.workspace.workspaceIdentity ?? params.workspaceIdentity,
          sessionId: snapshot.session.sessionId,
        }),
      );
    },

    has(target: XCodeTaskTarget): boolean {
      return sessionKeys.has(getSessionScopedKey(target));
    },

    forget(target: XCodeTaskTarget): void {
      sessionKeys.delete(getSessionScopedKey(target));
    },
  };
}
