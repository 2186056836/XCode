import { describe, expect, it } from "vitest";
import { applyBuildAgentSignature } from "../src/model/opencode-build-agent.js";
import { OPENCODE_BUILD_PROMPT_MARKER } from "../src/model/opencode-build-prompt.generated.js";

describe("OpenCode free env signature", () => {
  it("prepends the minimal env block while keeping the product system text", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: "XCode 自己的系统提示词" },
        { role: "user", content: "hi" },
      ],
    };
    applyBuildAgentSignature(body);

    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("<env>");
    expect(messages[0]!.content).toContain("</env>");
    expect(messages[0]!.content).toContain("Working directory: /");
    expect(messages[0]!.content).toContain("XCode 自己的系统提示词");
    // 2026-11-20 消融：官方 prompt 全文不参与校验，不再发送。
    expect(messages[0]!.content).not.toContain(OPENCODE_BUILD_PROMPT_MARKER);
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
    expect(messages[0]!.content).toContain("<env>");
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
