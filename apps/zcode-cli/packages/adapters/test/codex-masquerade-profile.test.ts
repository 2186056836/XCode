import { describe, expect, it } from "vitest";
import { createUpstreamRequestProfileFetch } from "../src/model/model-execution.js";

type Captured = { url: string; headers: Record<string, string> };

function capturingFetch(sink: Captured[]) {
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.headers;
    const headers: Record<string, string> = {};
    if (raw instanceof Headers) {
      raw.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(raw)) {
      for (const [key, value] of raw) headers[key] = value;
    } else if (raw && typeof raw === "object") {
      Object.assign(headers, raw);
    }
    sink.push({
      url: typeof request === "string" ? request : request.toString(),
      headers,
    });
    return new Response("ok");
  }) as typeof globalThis.fetch;
}

function profileFetch(sink: Captured[]) {
  return createUpstreamRequestProfileFetch({
    profile: "codex-masquerade",
    kind: "openai",
    fetch: capturingFetch(sink),
  });
}

const RESPONSES_INIT: RequestInit = {
  method: "POST",
  headers: { "Content-Type": "application/json", "User-Agent": "XCode/3.15.2 ai-sdk/2" },
  body: JSON.stringify({ model: "gpt-6.2-sol", input: "say OK", stream: true }),
};

describe("codex masquerade profile", () => {
  it("injects the required client fingerprints and replaces the product UA", async () => {
    const captured: Captured[] = [];
    const fetch = profileFetch(captured);
    await fetch("https://gateway.example/v1/responses", RESPONSES_INIT);

    const headers = captured[0]!.headers;
    expect(headers["User-Agent"]).toMatch(/^codex_cli_rs\/0\.153\.4 /);
    expect(headers.originator).toBe("codex_cli_rs");
    expect(headers.version).toBe("0.153.4");
    expect(headers["x-codex-window-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(headers["OpenAI-Beta"]).toBe("responses=experimental");
    // 用户显式配的非伪装头不能被丢掉。
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("mints a fresh window id per request", async () => {
    const captured: Captured[] = [];
    const fetch = profileFetch(captured);
    await fetch("https://gateway.example/v1/responses", RESPONSES_INIT);
    await fetch("https://gateway.example/v1/responses", RESPONSES_INIT);
    expect(captured[0]!.headers["x-codex-window-id"]).not.toBe(
      captured[1]!.headers["x-codex-window-id"],
    );
  });

  it("keeps explicitly provided codex-shaped UA and headers", async () => {
    const captured: Captured[] = [];
    const fetch = profileFetch(captured);
    await fetch("https://gateway.example/v1/responses", {
      ...RESPONSES_INIT,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "codex_cli_rs/0.150.0 (Linux; x86_64) codex_cli_rs/0.150.0",
        originator: "codex_exec",
        "x-codex-window-id": "6f1c2f8e-91a4-4a5b-9f0e-1c2d3e4f5a6b",
      },
    });

    const headers = captured[0]!.headers;
    expect(headers["User-Agent"]).toBe(
      "codex_cli_rs/0.150.0 (Linux; x86_64) codex_cli_rs/0.150.0",
    );
    expect(headers.originator).toBe("codex_exec");
    expect(headers["x-codex-window-id"]).toBe("6f1c2f8e-91a4-4a5b-9f0e-1c2d3e4f5a6b");
  });
});
