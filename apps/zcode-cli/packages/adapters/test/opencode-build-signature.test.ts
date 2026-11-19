import { describe, expect, it } from "vitest";
import { applyBuildAgentSignature } from "../src/model/opencode-build-agent.js";
import { OPENCODE_BUILD_PROMPT_MARKER } from "../src/model/opencode-build-prompt.generated.js";

describe("OpenCode free build signature", () => {
  it("prepends the official build prompt while keeping the product system text", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "XCode 自己的系统提示词" },
        { role: "user", content: "hi" },
      ],
    };
    applyBuildAgentSignature(body);

    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain(OPENCODE_BUILD_PROMPT_MARKER);
    expect(messages[0]!.content).toContain("<env>");
    expect(messages[0]!.content).toContain("Working directory:");
    expect(messages[0]!.content).toContain("XCode 自己的系统提示词");
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
    expect(messages[0]!.content).toContain(OPENCODE_BUILD_PROMPT_MARKER);
  });

  it("does not double-inject when the signature is already present", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "system", content: `${OPENCODE_BUILD_PROMPT_MARKER}...` }],
    };
    applyBuildAgentSignature(body);
    const messages = body.messages as Array<{ content: string }>;
    expect(messages[0]!.content.split(OPENCODE_BUILD_PROMPT_MARKER).length - 1).toBe(1);
  });

  it("still unions the official tool names and normalizes token limits", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "xcode_tool" } }],
      max_completion_tokens: 100,
    };
    applyBuildAgentSignature(body);
    const names = (body.tools as Array<{ function: { name: string } }>).map(
      (tool) => tool.function.name,
    );
    expect(names).toContain("xcode_tool");
    expect(names).toContain("read");
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.max_tokens).toBe(32000);
    expect(body.tool_choice).toBe("auto");
  });
});
