import { describe, expect, it } from "vitest";
import {
  createAccountRotationService,
  DEFAULT_ACCOUNT_ROTATION_SETTINGS,
  normalizeAccountRotationSettings,
  type AccountRotationCandidate,
  type AccountRotationProfile,
  type AccountRotationSettings,
} from "../src/model-provider/accountRotation.js";

function makeStore() {
  const map = new Map<string, string>();
  return {
    load: async (key: string) => map.get(key) ?? null,
    save: async (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function makeSource(
  profile: AccountRotationProfile,
  candidates: AccountRotationCandidate[],
): Parameters<typeof createAccountRotationService>[0]["source"] {
  return {
    listCandidates: async () => ({ requestProfile: profile, candidates }),
  };
}

const CANDIDATES: AccountRotationCandidate[] = [
  { id: "conn-a", accessToken: "token-a", active: true },
  { id: "conn-b", accessToken: "token-b", active: false },
];

describe("normalizeAccountRotationSettings", () => {
  it("缺省时业务码为空集合，状态码回落默认 [429]", () => {
    const settings = normalizeAccountRotationSettings(null);
    expect(settings).toEqual({
      strategy: "fill-first",
      stickyLimit: 3,
      failoverOnError: false,
      failoverStatusCodes: [429],
      failoverProviderCodes: [],
    });
  });

  it("业务码去重并丢弃未知码，未知输入不影响既有字段", () => {
    const settings = normalizeAccountRotationSettings({
      failoverOnError: true,
      failoverStatusCodes: [429, 429],
      failoverProviderCodes: ["1005", "9999", "1005", 42],
    });
    expect(settings.failoverOnError).toBe(true);
    expect(settings.failoverStatusCodes).toEqual([429]);
    expect(settings.failoverProviderCodes).toEqual(["1005"]);
  });

  it("显式空业务码集合保持为空（允许只按状态码换号）", () => {
    const settings = normalizeAccountRotationSettings({ failoverProviderCodes: [] });
    expect(settings.failoverProviderCodes).toEqual([]);
    expect(settings.failoverStatusCodes).toEqual([...DEFAULT_ACCOUNT_ROTATION_SETTINGS.failoverStatusCodes]);
  });
});

describe("createAccountRotationService.select failover 策略下发", () => {
  it("家族画像（zai）不下发状态码触发，只下发业务码", async () => {
    const service = createAccountRotationService({
      source: makeSource("zai", CANDIDATES),
      store: makeStore(),
    });
    await service.saveSettings("account:zai-start-plan", {
      strategy: "fill-first",
      stickyLimit: 3,
      failoverOnError: true,
      failoverStatusCodes: [429],
      failoverProviderCodes: ["1005"],
    });
    const selection = await service.select({
      providerId: "account:zai-start-plan",
      modelId: "GLM-5.3",
    });
    expect(selection?.failover).toEqual({
      enabled: true,
      statusCodes: [],
      providerCodes: ["1005"],
    });
    // fill-first 选中激活账号：active 标记为真，不触发跟随切换。
    expect(selection?.active).toBe(true);
  });

  it("失败换号重选到非激活账号时 active 为 false（跟随切换的依据）", async () => {
    const service = createAccountRotationService({
      source: makeSource("zai", CANDIDATES),
      store: makeStore(),
    });
    await service.saveSettings("account:zai-start-plan", {
      strategy: "fill-first",
      stickyLimit: 3,
      failoverOnError: true,
      failoverStatusCodes: [429],
      failoverProviderCodes: ["1005"],
    });
    await service.select({
      providerId: "account:zai-start-plan",
      modelId: "GLM-5.3",
      lastFailure: { connectionId: "conn-a", providerErrorCode: "1005" },
    });
    const next = await service.select({
      providerId: "account:zai-start-plan",
      modelId: "GLM-5.3",
    });
    expect(next?.connectionId).toBe("conn-b");
    expect(next?.active).toBe(false);
  });

  it("api-key 画像（qoder）继续下发状态码白名单", async () => {
    const service = createAccountRotationService({
      source: makeSource("qoder", CANDIDATES),
      store: makeStore(),
    });
    await service.saveSettings("other:qoder", {
      strategy: "fill-first",
      stickyLimit: 3,
      failoverOnError: true,
      failoverStatusCodes: [429, 401],
      failoverProviderCodes: [],
    });
    const selection = await service.select({
      providerId: "other:qoder",
      modelId: "claude-x",
    });
    expect(selection?.failover).toEqual({
      enabled: true,
      statusCodes: [401, 429],
      providerCodes: [],
    });
  });
});

describe("createAccountRotationService.select 失败冷却锁", () => {
  const settings: AccountRotationSettings = {
    strategy: "fill-first",
    stickyLimit: 3,
    failoverOnError: true,
    failoverStatusCodes: [429],
    failoverProviderCodes: ["1005"],
  };

  it("额度耗尽（业务码 1005）写 10 分钟模型锁，下次选择跳过该账号", async () => {
    const service = createAccountRotationService({
      source: makeSource("zai", CANDIDATES),
      store: makeStore(),
    });
    await service.saveSettings("account:zai-start-plan", settings);
    await service.select({
      providerId: "account:zai-start-plan",
      modelId: "GLM-5.3",
      lastFailure: { connectionId: "conn-a", providerErrorCode: "1005" },
    });
    const next = await service.select({
      providerId: "account:zai-start-plan",
      modelId: "GLM-5.3",
    });
    expect(next?.connectionId).toBe("conn-b");
  });

  it("非额度业务码（如并发 3008）不写锁", async () => {
    const service = createAccountRotationService({
      source: makeSource("zai", CANDIDATES),
      store: makeStore(),
    });
    await service.saveSettings("account:zai-start-plan", settings);
    await service.select({
      providerId: "account:zai-start-plan",
      modelId: "GLM-5.3",
      lastFailure: { connectionId: "conn-a", providerErrorCode: "3008" },
    });
    const next = await service.select({
      providerId: "account:zai-start-plan",
      modelId: "GLM-5.3",
    });
    expect(next?.connectionId).toBe("conn-a");
  });
});
