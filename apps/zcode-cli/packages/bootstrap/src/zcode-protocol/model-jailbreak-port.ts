// ============================================================
// Model Jailbreak Port - XCode Protocol implementation
// ============================================================
// 与 proxy-pool-port.ts 同款：agent 侧工具不直接持有 host 的 settingService，
// 只拿到这个窄端口，端口把每次调用转成一次 context.requestClient(modelJailbreak/*)。
//
// 所有方法都消费同一个结果快照（zcodeModelJailbreakSnapshotResultSchema），
// 按各自返回类型切片。

import type {
  ModelJailbreakPort,
  ModelJailbreakSnapshot,
} from "@zcode/contracts";
import {
  zcodeModelJailbreakSnapshotResultSchema,
  zcodeProtocolMethods,
  type XCodeModelJailbreakProtocolSnapshot,
  type XCodeProtocolMethod,
} from "@zcode/shared";
import type { XCodeProtocolAgentServerContext } from "./server-types.js";

export function createProtocolModelJailbreakPort(
  context: XCodeProtocolAgentServerContext,
): ModelJailbreakPort {
  const request = (method: XCodeProtocolMethod, params: unknown) =>
    context.requestClient(method, params, zcodeModelJailbreakSnapshotResultSchema);

  const toSnapshot = (
    snapshot: XCodeModelJailbreakProtocolSnapshot,
  ): ModelJailbreakSnapshot => ({
    state: snapshot.state,
    ...(snapshot.templates ? { templates: snapshot.templates } : {}),
  });

  return {
    async read() {
      return toSnapshot(await request(zcodeProtocolMethods.modelJailbreakList, {}));
    },
    async setIdentityPrompt(prompt) {
      return toSnapshot(
        await request(zcodeProtocolMethods.modelJailbreakSetIdentityPrompt, { prompt }),
      );
    },
    async applyTemplate(templateId) {
      return toSnapshot(
        await request(zcodeProtocolMethods.modelJailbreakApplyTemplate, { templateId }),
      );
    },
    async setPrefill(messages) {
      return toSnapshot(
        await request(zcodeProtocolMethods.modelJailbreakSetPrefill, { messages }),
      );
    },
    async setObfuscation(input) {
      return toSnapshot(
        await request(zcodeProtocolMethods.modelJailbreakSetObfuscation, {
          enabled: input.enabled,
          ...(input.tier ? { tier: input.tier } : {}),
        }),
      );
    },
  };
}
