// ============================================================
// Proxy Pool Port - XCode Protocol implementation
// ============================================================
// 与 offpeak-port.ts 同款：agent 侧工具不直接持有 host 的 IProxyPoolService，
// 只拿到这个窄端口，端口把每次调用转成一次 context.requestClient(proxyPool/*)。
//
// 所有方法都消费同一个结果快照（zcodeProxyPoolSnapshotResultSchema），
// 按各自返回类型切片——host 端因此只需要一套 snapshot 映射，不必为每个方法造形状。

import type {
  ProxyPoolCatalog,
  ProxyPoolPort,
  ProxyPoolProviderView,
  ProxyPoolSaveRequest,
} from "@zcode/contracts";
import {
  zcodeProtocolMethods,
  zcodeProxyPoolSnapshotResultSchema,
  type XCodeProtocolMethod,
  type XCodeProxyPoolProtocolSnapshot,
} from "@zcode/shared";
import type { XCodeProtocolAgentServerContext } from "./server-types.js";

function requireProvider(
  snapshot: XCodeProxyPoolProtocolSnapshot,
  method: XCodeProtocolMethod,
): ProxyPoolProviderView {
  if (!snapshot.provider) {
    // 协议上 providerId 生效的操作必定回带该供应商详情；缺失说明 host 侧映射漏了字段，
    // 不能静默降级成「操作成功但看不到结果」。
    throw new Error(`${method} did not return the provider view`);
  }
  return snapshot.provider;
}

function toCatalog(snapshot: XCodeProxyPoolProtocolSnapshot): ProxyPoolCatalog {
  return { pools: snapshot.pools, providers: snapshot.providers };
}

export function createProtocolProxyPoolPort(context: XCodeProtocolAgentServerContext): ProxyPoolPort {
  const request = (method: XCodeProtocolMethod, params: unknown) =>
    context.requestClient(method, params, zcodeProxyPoolSnapshotResultSchema);

  return {
    async listCatalog() {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolList, {});
      return toCatalog(snapshot);
    },
    async getProvider(providerId) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolList, { providerId });
      return requireProvider(snapshot, zcodeProtocolMethods.proxyPoolList);
    },
    async save(input: ProxyPoolSaveRequest) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolSave, {
        ...(input.poolId ? { poolId: input.poolId } : {}),
        name: input.name,
        proxyUrl: input.proxyUrl,
        ...(input.noProxy === undefined ? {} : { noProxy: input.noProxy }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.strictProxy === undefined ? {} : { strictProxy: input.strictProxy }),
      });
      return toCatalog(snapshot);
    },
    async remove(poolId) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolDelete, { poolId });
      return toCatalog(snapshot);
    },
    async setActive(poolId, isActive) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolSetActive, { poolId, isActive });
      return toCatalog(snapshot);
    },
    async test(input) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolTest, {
        ...(input.poolId ? { poolId: input.poolId } : {}),
        ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
        ...(input.testUrl ? { testUrl: input.testUrl } : {}),
      });
      if (!snapshot.test) {
        throw new Error(`${zcodeProtocolMethods.proxyPoolTest} did not return a test result`);
      }
      return snapshot.test;
    },
    async bindAccount(input) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolBindAccount, {
        providerId: input.providerId,
        accountId: input.accountId,
        poolId: input.poolId,
      });
      return requireProvider(snapshot, zcodeProtocolMethods.proxyPoolBindAccount);
    },
    async applyToAll(input) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolApplyToAll, {
        providerId: input.providerId,
        poolId: input.poolId,
      });
      return requireProvider(snapshot, zcodeProtocolMethods.proxyPoolApplyToAll);
    },
    async distribute(input) {
      const snapshot = await request(zcodeProtocolMethods.proxyPoolDistribute, {
        providerId: input.providerId,
        poolIds: input.poolIds,
      });
      return requireProvider(snapshot, zcodeProtocolMethods.proxyPoolDistribute);
    },
  };
}
