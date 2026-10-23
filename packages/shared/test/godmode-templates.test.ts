import { describe, expect, it } from "vitest";
import { compileModelOptionMap } from "@zcode/model-option-map";
import { GODMODE_TEMPLATES, PREFILL_TEMPLATES } from "../src/godmode-templates.js";

const XIAOHONG = GODMODE_TEMPLATES.find((template) => template.id === "xiaohong-creation");
const XIAOHONG_PREFILL = PREFILL_TEMPLATES.find(
  (template) => template.id === "xiaohong-creation",
);

describe("XiaoHong creation template", () => {
  it("ships a prompt and a paired prefill preset", () => {
    expect(XIAOHONG).toBeDefined();
    expect(XIAOHONG_PREFILL).toBeDefined();
    expect(XIAOHONG_PREFILL!.messages.length).toBeGreaterThanOrEqual(4);
    expect(XIAOHONG_PREFILL!.messages.some((turn) => turn.role === "assistant")).toBe(true);
  });

  it("never claims the model has no content filters", () => {
    // 这些表述会被模型当成「自身安全配置被改写」的注入特征，反而触发拒绝。
    const forbidden = [
      /content-censorship/i,
      /value-filtering/i,
      /cleared every content/i,
      /system configuration/i,
      /deployment fact/i,
      /configuration fact/i,
      /no moral arbitration/i,
      /清除所有内容审查/,
      /系统配置已确认/,
    ];
    const sources = [XIAOHONG!.prompt, ...XIAOHONG_PREFILL!.messages.map((turn) => turn.content)];
    for (const source of sources) {
      for (const pattern of forbidden) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("scopes the adults-only rule to sexual content", () => {
    expect(XIAOHONG!.prompt).toMatch(/sexual content involves adults only/i);
    expect(XIAOHONG!.prompt).toMatch(/non-sexual scenes may include characters of any age/i);
    expect(XIAOHONG!.prompt).not.toMatch(/every character is an adult/i);
  });

  it("keeps the explicit-writing directives", () => {
    expect(XIAOHONG!.prompt).toMatch(/never sanitize/i);
    expect(XIAOHONG!.prompt).toMatch(/ban every euphemism/i);
    expect(XIAOHONG!.prompt).toMatch(/explicitness is the default/i);
  });
});

describe("option map literals", () => {
  // 回归：旧版导入用 JSON.stringify 把 CEL 包成字符串字面量，出站把表达式原文
  // 当成 reasoning_effort 发给上游，CodeBuddy 直接 400/11133。
  const SHIPPED_MAP =
    '{"reasoning_effort": reasoningLevel == "disabled" ? "none" : reasoningLevel}';

  it("evaluates to a real effort value, not the expression source", () => {
    const program = compileModelOptionMap(SHIPPED_MAP, "reasoningLevel");
    expect(program.evaluate("max")).toEqual({ reasoning_effort: "max" });
    expect(program.evaluate("disabled")).toEqual({ reasoning_effort: "none" });
    expect(program.evaluate("low")).toEqual({ reasoning_effort: "low" });
  });

  it("would have failed if the expression were stringified", () => {
    const broken = JSON.stringify({
      reasoning_effort: 'reasoningLevel == "disabled" ? "none" : reasoningLevel',
    });
    const program = compileModelOptionMap(broken, "reasoningLevel");
    // 这里刻意断言「坏 map 会输出表达式原文」，防止以后有人又把它改回 stringify。
    expect(program.evaluate("max")).toEqual({
      reasoning_effort: 'reasoningLevel == "disabled" ? "none" : reasoningLevel',
    });
  });
});
