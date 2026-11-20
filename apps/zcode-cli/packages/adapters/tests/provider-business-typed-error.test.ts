import { describe, expect, it } from "vitest";
import { classifyModelFailure } from "../src/model/failure-classifier.js";
import {
  ProviderBusinessError,
  createProviderBusinessErrorFetch,
} from "../src/model/model-execution.js";

describe("typed error envelope provider body", () => {
  it("turns type=error bodies into business errors so 429 上游文案能透传", async () => {
    // OpenCode 免费档额度耗尽：既无 success:false 也无业务码，只有 type/error.type。
    const body = JSON.stringify({
      type: "error",
      error: {
        type: "FreeUsageLimitError",
        message: "Free usage limit reached. Free models work in OpenCode.",
      },
    });
    const fetch = createProviderBusinessErrorFetch({
      fetch: async () =>
        new Response(body, {
          headers: { "content-type": "application/json", "retry-after": "68700" },
          status: 429,
        }),
      providerId: "free:opencode-free",
      providerKind: "openai-compatible",
    });

    let error: unknown;
    try {
      await fetch("https://example.test/inference/openai/v1/chat/completions");
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      message: "Free usage limit reached. Free models work in OpenCode.",
      name: "ProviderBusinessError",
      responseStatus: 429,
      responseHeaders: { "retry-after": "68700" },
    } satisfies Partial<ProviderBusinessError>);

    const failure = classifyModelFailure(error);
    expect(failure).toMatchObject({
      code: "model_rate_limited",
      message: "Free usage limit reached. Free models work in OpenCode.",
      retryable: true,
      statusCode: 429,
      retryAfterMs: 68_700_000,
    });
  });
});
