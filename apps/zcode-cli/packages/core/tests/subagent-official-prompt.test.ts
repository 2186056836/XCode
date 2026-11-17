import { describe, expect, it } from "vitest";

import { buildExploreAgentPrompt } from "../src/subagent/explore.js";
import {
  SubagentContextBuilder,
  type SubagentContextBuilderConfig,
} from "../src/subagent/context-builder.js";
import { isOfficialSystemPromptProvider } from "../src/context/sections/cli-prefix.js";

/**
 * start-plan 端点对 system 逐字校验，任何 XCode 标识都会触发 405。
 * 子代理此前没有官方分支：CLI prefix 写死 XCode，Explore 身份行也是 XCode 品牌。
 * 这组用例把「start-plan 下的子代理 system 不含 XCode」钉住。
 */
const baseEnvInfo = {
  cwd: "/tmp",
  platform: "win32",
  shell: "bash",
  osVersion: "test",
  nodeVersion: "v24",
  isGitRepository: false,
} as const;

function buildConfig(overrides: Partial<SubagentContextBuilderConfig> = {}): SubagentContextBuilderConfig {
  return {
    agentPrompt: "You are a helper.",
    envInfo: { ...baseEnvInfo },
    ...overrides,
  };
}

describe("isOfficialSystemPromptProvider", () => {
  it("start-plan 两个 provider 命中", () => {
    expect(isOfficialSystemPromptProvider("account:zai-start-plan")).toBe(true);
    expect(isOfficialSystemPromptProvider("account:bigmodel-start-plan")).toBe(true);
  });

  it("其余 provider 不命中", () => {
    expect(isOfficialSystemPromptProvider("other:qoder")).toBe(false);
    expect(isOfficialSystemPromptProvider(undefined)).toBe(false);
  });
});

describe("子代理官方提示词", () => {
  it("officialSystemPrompt 时 CLI prefix 用 ZCode 身份行", () => {
    const result = new SubagentContextBuilder(
      buildConfig({ officialSystemPrompt: true }),
    ).build();
    const firstSystem = result.systemMessages[0]?.content ?? "";
    expect(firstSystem).toBe("You are ZCode, an interactive coding agent");
    expect(firstSystem).not.toMatch(/XCode/);
  });

  it("默认仍是 fork 的 XCode 身份行", () => {
    const result = new SubagentContextBuilder(buildConfig()).build();
    expect(result.systemMessages[0]?.content).toBe("You are XCode, an interactive coding agent");
  });

  it("officialSystemPrompt 时整组 system 消息不含 XCode", () => {
    const result = new SubagentContextBuilder(
      buildConfig({ officialSystemPrompt: true, agentPrompt: "Do the research." }),
    ).build();
    for (const message of result.systemMessages) {
      expect(message.content).not.toMatch(/XCode/);
    }
  });
});

describe("Explore 身份行品牌", () => {
  it("official 用上游原文（ZCode Explore / ZCode CLI）", () => {
    const prompt = buildExploreAgentPrompt({ official: true });
    expect(prompt).toContain(
      "You are ZCode Explore, a file search and codebase research specialist for ZCode CLI.",
    );
    expect(prompt).not.toMatch(/XCode/);
  });

  it("默认保持 fork 品牌", () => {
    const prompt = buildExploreAgentPrompt({});
    expect(prompt).toContain("You are XCode Explore");
    expect(prompt).toContain("for XCode CLI");
  });

  it("official 与默认的其余正文一致（只有品牌行不同）", () => {
    const official = buildExploreAgentPrompt({ official: true });
    const fork = buildExploreAgentPrompt({});
    const strip = (s: string) => s.replace(/ZCode/g, "@B@").replace(/XCode/g, "@B@");
    expect(strip(official)).toBe(strip(fork));
  });
});
