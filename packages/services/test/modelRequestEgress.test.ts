import { describe, expect, it } from "vitest";
import { resolveConnectionEgress } from "../src/zcode-agent/modelRequestEgress.js";

function makeService(input: {
  accounts?: Array<{ id: string; displayName: string }>;
  binding?: unknown;
}) {
  return {
    getProviderBinding: async () => ({
      providerId: "p",
      providerName: "p",
      accounts: input.accounts ?? [],
      pools: [],
      supportsConnections: true,
      supportsProviderBinding: false,
    }),
    getProviderProxyBinding: async () => input.binding,
  } as never;
}

describe("resolveConnectionEgress", () => {
  it("reads the connection-level binding", async () => {
    const egress = await resolveConnectionEgress(
      makeService({
        accounts: [{ id: "acct-1", displayName: "我的 Qoder 账号" }],
        binding: {
          bindings: {
            "acct-1": { id: "pool-aws2-syd", name: "AWS2 悉尼" },
          },
        },
      }),
      "other:qoder",
      "acct-1",
    );
    expect(egress).toEqual({
      accountDisplayName: "我的 Qoder 账号",
      proxyPoolId: "pool-aws2-syd",
      proxyDisplayName: "AWS2 悉尼",
    });
  });

  it("falls back to the provider-level egress for accountless providers", async () => {
    const egress = await resolveConnectionEgress(
      makeService({
        binding: {
          bindings: {},
          provider: { pools: [{ id: "pool-hk", name: "香港 BGP" }] },
        },
      }),
      "free:kilo-free",
      undefined,
    );
    expect(egress).toEqual({ proxyPoolId: "pool-hk", proxyDisplayName: "香港 BGP" });
  });

  it("does not report a candidate snapshot for multi-pool rotation", async () => {
    const egress = await resolveConnectionEgress(
      makeService({
        binding: {
          bindings: {},
          provider: {
            strategy: "round-robin",
            pools: [
              { id: "pool-aws2-syd", name: "AWS2 悉尼" },
              { id: "pool-hk", name: "香港 BGP" },
              { id: "pool-sg", name: "新加坡" },
            ],
          },
        },
      }),
      "free:opencode-free",
      undefined,
    );
    // 实际出口每个请求在 CLI 侧轮换：写死第一条会永远显示同一个池，
    // 写「轮询 3 个池」也不是节点名。真实命中的节点由 adapter 回报，
    // host 在这里只能保持沉默。「使用详情」据此回落到「跟随全局」而不是编造出口。
    expect(egress).toEqual({});
  });

  it("pins the only pool when rotation has a single candidate", async () => {
    const egress = await resolveConnectionEgress(
      makeService({
        binding: {
          bindings: {},
          provider: {
            strategy: "round-robin",
            pools: [{ id: "pool-aws2-syd", name: "AWS2 悉尼" }],
          },
        },
      }),
      "free:opencode-free",
      undefined,
    );
    expect(egress).toEqual({ proxyPoolId: "pool-aws2-syd", proxyDisplayName: "AWS2 悉尼" });
  });

  it("returns nothing when no binding exists (follows global proxy)", async () => {
    const egress = await resolveConnectionEgress(
      makeService({ binding: undefined }),
      "free:opencode-free",
      undefined,
    );
    expect(egress).toEqual({});
  });
});
