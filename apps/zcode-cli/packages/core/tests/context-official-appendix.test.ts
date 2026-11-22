import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../src/context/builder.js";
import type { ContextBuilderConfig } from "../src/context/types.js";

// start-plan 官方提示词通路：闸门只接受官方原文保留的 system 块，自定义文本
// 只能追加进 identity 段尾部（2026-11-21 zcode.z.ai 实测，见 builder 内注释）。
const VOID_PREAMBLE_MARKER = "wrapped in curly braces below";
function baseConfig(extra: Partial<ContextBuilderConfig> = {}): ContextBuilderConfig {
  return {
    workingDirectory: "/tmp",
    envInfo: {
      cwd: "/tmp",
      platform: "darwin",
      shell: "zsh",
      osVersion: "Darwin 25.4.0",
      nodeVersion: "v24.14.0",
    },
    presentationSurface: "terminal",
    officialSystemPrompt: true,
    ...extra,
  } as ContextBuilderConfig;
}

describe("officialSystemPrompt 尾部追加", () => {
  it("无自定义时保持官方三块形态", () => {
    const result = new ContextBuilder(baseConfig()).build();
    expect(result.systemMessages[0]?.content).toBe("You are ZCode, an interactive agent");
    expect(result.systemMessages[1]?.content).toContain("You are an agent working with the user");
    expect(result.systemMessages[1]?.content).toContain("# Harness");
    expect(result.systemMessages[2]?.content).toContain("# Context management");
    expect(result.systemMessages).toHaveLength(3);
  });

  it("身份模板覆盖追加进 identity 段尾部，不新增块", () => {
    const result = new ContextBuilder(
      baseConfig({
        systemPromptOverrides: { cliPrefix: "你是小美，一位专注于 CTF 的助手。" },
      }),
    ).build();
    // 官方身份行与 Harness 原样保留在块首（闸门按官方原文校验）。
    expect(result.systemMessages[1]?.content.startsWith("\nYou are an agent working with the user")).toBe(true);
    expect(result.systemMessages[1]?.content).toContain("# Harness");
    // 中和前导（{} 只引用块 1 身份行 + SECURITY_NOTICE，q5 形态）在最前，"# Identity"
    // 标题引出身份模板（q6 实测带标题生效）。
    const content = String(result.systemMessages[1]?.content);
    expect(content).toContain(VOID_PREAMBLE_MARKER);
    expect(content).toContain("{\nYou are ZCode, an interactive agent\nIMPORTANT: Assist with authorized security testing");
    expect(content.indexOf(VOID_PREAMBLE_MARKER)).toBeLessThan(content.indexOf("# Identity"));
    expect(content).toContain("# Identity\n你是小美，一位专注于 CTF 的助手。");
    expect(content.endsWith("你是小美，一位专注于 CTF 的助手。")).toBe(true);
    expect(result.systemMessages).toHaveLength(3);
  });

  it("含 XCode/ZCode 字样的追加文本不跳过（品牌词不是闸门触发器）", () => {
    const result = new ContextBuilder(
      baseConfig({
        systemPromptOverrides: { cliPrefix: "Built on the XCode fork runtime." },
      }),
    ).build();
    expect(result.systemMessages[1]?.content).toContain("Built on the XCode fork runtime.");
  });

  it("整段自定义 system prompt 也改为尾部追加，且保留官方动态段", () => {
    const result = new ContextBuilder(
      baseConfig({ customSystemPrompt: "全程使用中文回答。" }),
    ).build();
    const content = String(result.systemMessages[1]?.content);
    expect(content).toContain("# Harness");
    expect(content.indexOf(VOID_PREAMBLE_MARKER)).toBeLessThan(content.indexOf("# Identity"));
    expect(content).toContain("# Identity\n全程使用中文回答。");
    expect(content.endsWith("全程使用中文回答。")).toBe(true);
    expect(result.systemMessages[2]?.content).toContain("# Context management");
  });

  it("无追加文本时不带中和前导，保持纯官方形态", () => {
    const result = new ContextBuilder(baseConfig()).build();
    expect(result.systemMessages[1]?.content).not.toContain(VOID_PREAMBLE_MARKER);
  });

  it("官方身份段的 Harness 第三条随模型 MCS 能力动态二选一", () => {
    // MCS 关闭（模型不支持或配置关闭）时用 system-reminder 文案；t6 实测两种官方变体闸门都放行。
    const result = new ContextBuilder(baseConfig({ midConversationSystem: false })).build();
    const content = String(result.systemMessages[1]?.content);
    expect(content).toContain("`<system-reminder>` tags in messages and tool results are injected by the harness");
    expect(content).not.toContain("mid-conversation system turns. These are system-controlled");
    // 默认（未配置）仍是 MCS=true 文案。
    const defaultResult = new ContextBuilder(baseConfig()).build();
    expect(String(defaultResult.systemMessages[1]?.content)).toContain(
      "mid-conversation system turns. These are system-controlled",
    );
  });

  it("非官方 provider 的身份覆盖仍是整段替换，不受影响", () => {
    const result = new ContextBuilder(
      baseConfig({
        officialSystemPrompt: false,
        systemPromptOverrides: { cliPrefix: "你是小美。" },
      }),
    ).build();
    expect(result.systemMessages[0]?.content).toBe("你是小美。");
    expect(result.systemMessages[1]?.content).toContain("You are an agent working with the user");
  });
});
