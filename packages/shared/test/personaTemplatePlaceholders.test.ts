import { describe, expect, it } from "vitest";
import {
  PERSONA_TEMPLATE_NAME_PLACEHOLDER,
  resolvePersonaTemplateMessages,
  resolvePersonaTemplatePlaceholders,
  resolvePersonaTemplateText,
} from "../src/personaTemplatePlaceholders.js";

describe("persona template {{name}} placeholder", () => {
  it("replaces the placeholder in text and prefill turns", () => {
    const resolved = resolvePersonaTemplatePlaceholders({
      assistantName: "小美",
      cliPrefix: `你是${PERSONA_TEMPLATE_NAME_PLACEHOLDER}，一个桌面助手。`,
      prefill: {
        enabled: true,
        messages: [
          { role: "user", content: "{{ name }}，你好" },
          { role: "assistant", content: "主人好，我是{{name}}" },
        ],
      },
    });
    expect(resolved.cliPrefix).toBe("你是小美，一个桌面助手。");
    expect(resolved.prefill?.messages).toEqual([
      { role: "user", content: "小美，你好" },
      { role: "assistant", content: "主人好，我是小美" },
    ]);
    expect(resolved.prefill?.enabled).toBe(true);
  });

  it("keeps the placeholder when the assistant name is blank", () => {
    const text = "你是{{name}}";
    expect(resolvePersonaTemplateText(text, "   ")).toBe(text);
    expect(resolvePersonaTemplateText(text, undefined)).toBe(text);
  });

  it("leaves content without the placeholder untouched", () => {
    expect(resolvePersonaTemplateText("You are XCode", "小美")).toBe("You are XCode");
    expect(resolvePersonaTemplateMessages(undefined, "小美")).toEqual([]);
  });
});
