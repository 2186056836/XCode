// ============================================================
// Pet Control Port - XCode Protocol implementation
// ============================================================
// 与 proxy-pool-port.ts 同款：agent 侧工具不直接持有桌面主进程的宠物控制器，
// 每次调用转成一次 context.requestClient(petControl/*)。

import type { PetControlPort, PetControlState } from "@zcode/contracts";
import {
  zcodePetControlResultSchema,
  zcodeProtocolMethods,
  type XCodeProtocolMethod,
} from "@zcode/shared";
import type { XCodeProtocolAgentServerContext } from "./server-types.js";

export function createProtocolPetControlPort(context: XCodeProtocolAgentServerContext): PetControlPort {
  const request = (method: XCodeProtocolMethod, params: unknown) =>
    context.requestClient(method, params, zcodePetControlResultSchema);

  const toSnapshot = () => async (method: XCodeProtocolMethod, params: unknown) => {
    const result = await request(method, params);
    if (!result.ok) {
      throw new Error(`${method} reported the pet overlay is unavailable`);
    }
    return { enabled: result.enabled, petId: result.petId, behaviorState: result.behaviorState };
  };

  const snapshotOf = toSnapshot();

  return {
    async getSnapshot() {
      return snapshotOf(zcodeProtocolMethods.petControlGet, {});
    },
    async setBehaviorState(state: PetControlState) {
      return snapshotOf(zcodeProtocolMethods.petControlSetState, { state });
    },
    async wave() {
      return snapshotOf(zcodeProtocolMethods.petControlWave, {});
    },
  };
}
