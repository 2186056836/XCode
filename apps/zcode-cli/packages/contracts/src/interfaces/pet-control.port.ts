import type { PetControlState } from "../tools/pet-control.js";

/**
 * 桌宠控制端口：agent 工具经协议方法驱动本机悬浮宠物的行为状态。
 * 实现在 bootstrap（zcode-protocol 端口），最终落到桌面主进程的宠物控制器。
 */
export interface PetControlPort {
  /** 当前宠物与行为状态快照（悬浮窗未启用时 enabled=false）。 */
  getSnapshot(): Promise<{
    enabled: boolean;
    petId: string;
    behaviorState: string;
  }>;
  /** 设置行为状态（idle/running/waiting/failed/review），覆盖自动映射直到下一个 turn 事件。 */
  setBehaviorState(state: PetControlState): Promise<{
    enabled: boolean;
    petId: string;
    behaviorState: string;
  }>;
  /** 触发一次挥手动画。 */
  wave(): Promise<{
    enabled: boolean;
    petId: string;
    behaviorState: string;
  }>;
}
