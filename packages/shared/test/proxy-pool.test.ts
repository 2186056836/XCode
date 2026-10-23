import { describe, expect, it } from "vitest";

import { refreshProviderProxyBinding, type ProxyPoolEntry } from "../src/proxy-pool.js";

function pool(id: string, isActive = true): ProxyPoolEntry {
  return {
    id,
    name: id,
    proxyUrl: "http://127.0.0.1:7890",
    isActive,
    type: "http",
  };
}

describe("refreshProviderProxyBinding 的轮询候选集", () => {
  it("只保留用户显式选中的子集，不把全部启用池塞进轮换", () => {
    const binding = {
      bindings: {},
      provider: {
        strategy: "round-robin" as const,
        pools: [pool("a"), pool("c")],
      },
    };
    const refreshed = refreshProviderProxyBinding(binding, [pool("a"), pool("b"), pool("c")]);

    // b 也是启用中的池，但用户没选它，就不该参与轮换。
    expect(refreshed?.provider?.pools.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(refreshed?.provider?.strategy).toBe("round-robin");
  });

  it("随机策略同样只认选中的子集", () => {
    const binding = {
      bindings: {},
      provider: { strategy: "random" as const, pools: [pool("b")] },
    };
    const refreshed = refreshProviderProxyBinding(binding, [pool("a"), pool("b")]);

    expect(refreshed?.provider?.pools.map((entry) => entry.id)).toEqual(["b"]);
    expect(refreshed?.provider?.strategy).toBe("random");
  });

  it("选中的池被停用时从候选中摘掉", () => {
    const binding = {
      bindings: {},
      provider: { strategy: "round-robin" as const, pools: [pool("a"), pool("b")] },
    };
    const refreshed = refreshProviderProxyBinding(binding, [pool("a"), pool("b", false)]);

    expect(refreshed?.provider?.pools.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("选中的池全部失效时退回全量启用池，避免静默变成跟随全局", () => {
    const binding = {
      bindings: {},
      provider: { strategy: "round-robin" as const, pools: [pool("a")] },
    };
    const refreshed = refreshProviderProxyBinding(binding, [pool("a", false), pool("b")]);

    expect(refreshed?.provider?.pools.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("固定线路仍然只保留第一条", () => {
    const binding = {
      bindings: {},
      provider: { strategy: "none" as const, pools: [pool("a"), pool("b")] },
    };
    const refreshed = refreshProviderProxyBinding(binding, [pool("a"), pool("b")]);

    expect(refreshed?.provider?.pools.map((entry) => entry.id)).toEqual(["a"]);
  });
});
