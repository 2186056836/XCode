/**
 * 桌宠通知 → 打开会话 的应用级跳转桥。
 *
 * 桌宠状态绑定是 App 级非 React 消费者（sessions-index 订阅回调），拿不到
 * App 里的 handleSelectTask（它需要 tab 激活、remote workspace 解析、未读清理等
 * 一整套 context）。这里用一次性注册把 App 的跳转能力借给它，避免复制那套逻辑。
 */
export interface PetNotificationOpenTarget {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

type PetNotificationOpenHandler = (target: PetNotificationOpenTarget) => void;

let handler: PetNotificationOpenHandler | null = null;

/** App 注册；返回注销函数（handler 身份比对，避免热更新后误删新注册）。 */
export function registerPetNotificationOpenHandler(next: PetNotificationOpenHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function openPetNotificationTarget(target: PetNotificationOpenTarget): boolean {
  if (!handler) return false;
  handler(target);
  return true;
}
