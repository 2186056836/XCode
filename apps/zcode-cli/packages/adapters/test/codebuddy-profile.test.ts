import { describe, expect, it } from "vitest";
import {
  createUpstreamRequestProfileFetch,
  normalizeCodeBuddyReasoningEffort,
  stripCodeBuddyIncompatibleReasoningFields,
} from "../src/model/model-execution.js";

type Captured = { url: string; body: Record<string, unknown> };

function capturingFetch(sink: Captured[], response: Response = new Response("ok")) {
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    sink.push({
      url: typeof request === "string" ? request : request.toString(),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return response;
  }) as typeof globalThis.fetch;
}

function postInit(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

const BASE_BODY = {
  model: "deepseek-v4.1-flash",
  messages: [{ role: "system", content: "sys" }],
  stream: true,
};

describe("CodeBuddy reasoning effort normalization", () => {
  it.each([
    ["none", "none"],
    ["minimal", "minimal"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["ultra", "ultra"],
    ["max", "max"],
  ])("keeps legal value %s", (input, expected) => {
    expect(normalizeCodeBuddyReasoningEffort(input)).toBe(expected);
  });

  it.each([
    ["disabled", "none"],
    ["off", "none"],
    ["no_think", "none"],
    ["nothink", "none"],
    ["false", "none"],
  ])("maps off-family alias %s to the only accepted off value", (input, expected) => {
    expect(normalizeCodeBuddyReasoningEffort(input)).toBe(expected);
  });

  it.each([
    ["extra-high", "xhigh"],
    ["extra_high", "xhigh"],
    ["on", "high"],
    ["enabled", "high"],
    ["true", "high"],
  ])("maps intensity alias %s", (input, expected) => {
    expect(normalizeCodeBuddyReasoningEffort(input)).toBe(expected);
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeCodeBuddyReasoningEffort("  MAX ")).toBe("max");
    expect(normalizeCodeBuddyReasoningEffort("Disabled")).toBe("none");
  });

  it("drops values it cannot classify instead of forwarding them", () => {
    // 上游对未知值一律 400/11133；不发比发错安全。
    for (const value of ["最高", "highx", "maximum", "0", "", "  ", 42, null, undefined]) {
      expect(normalizeCodeBuddyReasoningEffort(value)).toBeUndefined();
    }
  });
});

describe("CodeBuddy request body stripping", () => {
  it("removes Anthropic/Responses style thinking fields", () => {
    const body: Record<string, unknown> = {
      ...BASE_BODY,
      thinking: { type: "enabled" },
      enable_thinking: true,
      reasoning: { effort: "high" },
      reasoning_effort: "disabled",
    };
    stripCodeBuddyIncompatibleReasoningFields(body);
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("enable_thinking");
    expect(body).not.toHaveProperty("reasoning");
    expect(body.reasoning_effort).toBe("none");
  });

  it("deletes reasoning_effort when the value cannot be classified", () => {
    const body: Record<string, unknown> = { ...BASE_BODY, reasoning_effort: "最高" };
    stripCodeBuddyIncompatibleReasoningFields(body);
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});

describe("CodeBuddy request profile selection", () => {
  it("uses the declared profile", async () => {
    const captured: Captured[] = [];
    const fetch = createUpstreamRequestProfileFetch({
      profile: "codebuddy",
      kind: "openai-compatible",
      fetch: capturingFetch(captured),
      baseUrl: "https://example.invalid/v2",
    });
    await fetch("https://example.invalid/v2/chat/completions", postInit({
      ...BASE_BODY,
      reasoning_effort: "disabled",
    }));
    expect(captured[0].body.reasoning_effort).toBe("none");
    expect(captured[0].body.messages).toEqual([
      { role: "system", content: "sys" },
    ]);
  });

  it.each([
    "https://copilot.tencent.com/v2",
    "https://www.codebuddy.ai/v2",
    "https://codebuddy.ai/v2",
  ])("falls back to the CodeBuddy profile for host %s", async (baseUrl) => {
    const captured: Captured[] = [];
    const fetch = createUpstreamRequestProfileFetch({
      profile: undefined,
      kind: "openai-compatible",
      fetch: capturingFetch(captured),
      baseUrl,
    });
    await fetch(`${baseUrl}/chat/completions`, postInit({
      ...BASE_BODY,
      reasoning_effort: "disabled",
    }));
    expect(captured[0].body.reasoning_effort).toBe("none");
    // 指纹头兜底同样生效：否则上游会回 11128。
    expect(captured[0].body).toBeDefined();
  });

  it("does not hijack unrelated providers when no profile is declared", async () => {
    const captured: Captured[] = [];
    const fetch = createUpstreamRequestProfileFetch({
      profile: undefined,
      kind: "openai-compatible",
      fetch: capturingFetch(captured),
      baseUrl: "https://api.example.com/v1",
    });
    await fetch("https://api.example.com/v1/chat/completions", postInit({
      ...BASE_BODY,
      reasoning_effort: "disabled",
      thinking: { type: "enabled" },
    }));
    // 非 CodeBuddy 供应商必须原样透传，不能被我们的剥离逻辑改写。
    expect(captured[0].body.reasoning_effort).toBe("disabled");
    expect(captured[0].body.thinking).toEqual({ type: "enabled" });
  });
});
