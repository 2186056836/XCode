// ============================================================
// Provider Account Port - XCode Protocol implementation
// ============================================================
// 与 model-jailbreak-port.ts 同款：agent 侧工具不直接持有 host 的账号服务，
// 只拿到这个窄端口，端口把每次调用转成一次 context.requestClient(providerAccount/*)。
//
// 所有方法都消费同一个结果快照（zcodeProviderAccountSnapshotResultSchema），
// 按各自返回类型切片。

import type {
  ProviderAccountPort,
  ProviderAccountSnapshot,
} from "@zcode/contracts";
import {
  zcodeProviderAccountSnapshotResultSchema,
  zcodeProtocolMethods,
  type XCodeProtocolMethod,
} from "@zcode/shared";
import type { XCodeProtocolAgentServerContext } from "./server-types.js";

export function createProtocolProviderAccountPort(
  context: XCodeProtocolAgentServerContext,
): ProviderAccountPort {
  const request = (params: unknown) =>
    context.requestClient(
      zcodeProtocolMethods.providerAccountManage,
      params,
      zcodeProviderAccountSnapshotResultSchema,
    );

  const toSnapshot = (
    snapshot: Awaited<ReturnType<typeof request>>,
  ): ProviderAccountSnapshot => ({
    family: snapshot.family,
    region: snapshot.region,
    accounts: snapshot.accounts,
  });

  return {
    async list(input) {
      return toSnapshot(
        await request({
          action: "list",
          family: input.family,
          ...(input.region ? { region: input.region } : {}),
        }),
      );
    },
    async import(input) {
      return toSnapshot(
        await request({
          action: "import",
          family: input.family,
          ...(input.region ? { region: input.region } : {}),
          accessToken: input.accessToken,
          ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
          ...(input.machineId ? { machineId: input.machineId } : {}),
          ...(input.identity ? { identity: input.identity } : {}),
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.email ? { email: input.email } : {}),
        }),
      );
    },
    async remove(input) {
      return toSnapshot(
        await request({
          action: "remove",
          family: input.family,
          ...(input.region ? { region: input.region } : {}),
          accountId: input.accountId,
        }),
      );
    },
    async activate(input) {
      return toSnapshot(
        await request({
          action: "activate",
          family: input.family,
          ...(input.region ? { region: input.region } : {}),
          accountId: input.accountId,
        }),
      );
    },
    async refresh(input) {
      return toSnapshot(
        await request({
          action: "refresh",
          family: input.family,
          ...(input.region ? { region: input.region } : {}),
          accountId: input.accountId,
        }),
      );
    },
  };
}
