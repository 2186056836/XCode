import { describe, expect, it } from "vitest";

import { shouldAttachProviderEgressRefresh } from "../src/model/runner.js";

const roundRobin = { provider: { strategy: "round-robin", pools: [{ id: "pool-a" }] } };

describe("shouldAttachProviderEgressRefresh", () => {
  it("无账号供应商配了 provider 级出口时接入刷新回调", () => {
    // 这是「OpenCode Free 开轮询但使用详情显示跟随全局」的回归点：
    // 不接入回调 → host 侧 resolveConnectionEgress 不执行 → 记账永远是跟随全局。
    expect(
      shouldAttachProviderEgressRefresh({
        accessType: "api-key",
        proxy: roundRobin,
        hasRuntimeHeadersPort: true,
      }),
    ).toBe(true);
  });

  it("没有出口策略时不接入", () => {
    expect(
      shouldAttachProviderEgressRefresh({
        accessType: "api-key",
        proxy: null,
        hasRuntimeHeadersPort: true,
      }),
    ).toBe(false);
  });

  it("策略里没有候选池时不接入", () => {
    expect(
      shouldAttachProviderEgressRefresh({
        accessType: "api-key",
        proxy: { provider: { strategy: "round-robin", pools: [] } },
        hasRuntimeHeadersPort: true,
      }),
    ).toBe(false);
  });

  it("CLI 侧没有 runtime headers 端口时不接入（避免空回调）", () => {
    expect(
      shouldAttachProviderEgressRefresh({
        accessType: "api-key",
        proxy: roundRobin,
        hasRuntimeHeadersPort: false,
      }),
    ).toBe(false);
  });

  it("zhipu-account 不重复接入（它有自己的鉴权刷新分支）", () => {
    expect(
      shouldAttachProviderEgressRefresh({
        accessType: "zhipu-account",
        proxy: roundRobin,
        hasRuntimeHeadersPort: true,
      }),
    ).toBe(false);
  });
});
