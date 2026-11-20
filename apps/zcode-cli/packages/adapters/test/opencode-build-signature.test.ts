import { describe, expect, it } from "vitest";
import { applyBuildAgentSignature } from "../src/model/opencode-build-agent.js";

describe("OpenCode free env signature", () => {
  it("prepends the env block while keeping the product system text", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "XCode 自己的系统提示词" },
        { role: "user", content: "hi" },
      ],
    };
    applyBuildAgentSignature(body);

    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe("system");
    // 2026-11-20 晚复测：官方 build prompt 不参与校验，只拼 env 连续 3 轮 200。
    expect(messages[0]!.content).toContain("<env>");
    expect(messages[0]!.content).toContain("</env>");
    expect(messages[0]!.content).toContain("Working directory: /");
    expect(messages[0]!.content).toContain("XCode 自己的系统提示词");
    expect(messages[0]!.content).not.toContain("You are opencode, an interactive CLI tool");
    // 不新增 system 消息，避免改变消息顺序语义。
    expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
  });

  it("inserts a system message when the request has none", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hi" }],
    };
    applyBuildAgentSignature(body);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("Working directory:");
  });

  it("does not double-inject when an env signature is already present", () => {
    const body: Record<string, unknown> = {
      messages: [
        {
          role: "system",
          content:
            "Here is some useful information about the environment you are running in:\n<env>\n  Working directory: /tmp\n</env>",
        },
      ],
    };
    applyBuildAgentSignature(body);
    const messages = body.messages as Array<{ content: string }>;
    expect(messages[0]!.content.split("<env>").length - 1).toBe(1);
  });

  it("injects into array-shaped system content once", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "system", content: [{ type: "text", text: "XCode 系统提示词" }] }],
    };
    applyBuildAgentSignature(body);
    const messages = body.messages as Array<{ content: Array<{ type: string; text: string }> }>;
    expect(messages[0]!.content[0]!.text).toContain("<env>");
    expect(messages[0]!.content[1]!.text).toBe("XCode 系统提示词");
  });

  it("renames gated tools and still unions the official tool names", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        // appendChatFingerprintTools 会先把 Read/Edit 小写成 read/edit。
        { type: "function", function: { name: "read" } },
        { type: "function", function: { name: "edit" } },
        { type: "function", function: { name: "LocalToolSearch" } },
        { type: "function", function: { name: "DeferredToolCall" } },
        { type: "function", function: { name: "xcode_tool" } },
      ],
      max_completion_tokens: 100,
    };
    applyBuildAgentSignature(body);
    const names = (body.tools as Array<{ function: { name: string } }>).map(
      (tool) => tool.function.name,
    );
    // 出站别名：read+file_path / edit+old_string / 两工具组合都是上游 429 的触发签名。
    expect(names).toContain("ReadFile");
    expect(names).toContain("EditFile");
    expect(names).toContain("SearchTools");
    expect(names).toContain("Defer");
    expect(names).not.toContain("Read");
    expect(names).not.toContain("Edit");
    expect(names).toContain("xcode_tool");
    expect(names).toContain("read");
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.max_tokens).toBe(32000);
    expect(body.tool_choice).toBe("auto");
  });

  it("keeps the original tool object when the rename target already exists", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { type: "function", function: { name: "Read" } },
        { type: "function", function: { name: "ReadFile" } },
      ],
    };
    applyBuildAgentSignature(body);
    const names = (body.tools as Array<{ function: { name: string } }>).map(
      (tool) => tool.function.name,
    );
    expect(names.filter((name) => name === "ReadFile")).toHaveLength(1);
    expect(names).toContain("Read");
  });
});
