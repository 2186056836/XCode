import { describe, expect, it } from "vitest";
import {
  countContextPrefixMessages,
  type RuntimeMessageEntry,
} from "../src/agent/message-history.js";
import { buildContextHistoryEntries } from "../src/runtime/methods/context-history-entries.js";
import type { ContextBuildResult } from "../src/runtime/deps.js";

function contextResult(overrides: Partial<ContextBuildResult> = {}): ContextBuildResult {
  return {
    systemMessages: [{ role: "system", content: "system prompt" }],
    metaUserAttachments: [
      { source: "context_prefix", content: "<system-reminder>meta</system-reminder>" },
    ],
    sections: [],
    totalChars: 0,
    totalTokens: 0,
    ...overrides,
  } as ContextBuildResult;
}

const PREFILL = {
  enabled: true,
  messages: [
    { role: "user" as const, content: "priming user" },
    { role: "assistant" as const, content: "priming assistant" },
    { role: "user" as const, content: "priming user 2" },
  ],
};

describe("godmode prefill as context prefix", () => {
  it("injects every priming turn after system and meta attachments", () => {
    const entries = buildContextHistoryEntries(contextResult(), PREFILL);
    // 前两条是 system + meta 附件；附件条目没有 message，用 kind 区分。
    const messageEntries = entries.filter(
      (entry): entry is RuntimeMessageEntry & { message: { role: string; content: string } } =>
        "message" in entry,
    );
    expect(messageEntries.map((entry) => entry.message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(messageEntries[2].message.content).toBe("priming assistant");
  });

  it("omits prefill entirely when disabled or empty", () => {
    const disabled = buildContextHistoryEntries(contextResult(), { ...PREFILL, enabled: false });
    expect(disabled).toHaveLength(2);
    const empty = buildContextHistoryEntries(contextResult(), { enabled: true, messages: [] });
    expect(empty).toHaveLength(2);
    const missing = buildContextHistoryEntries(contextResult());
    expect(missing).toHaveLength(2);
  });

  it("counts every prefill turn as part of the rebuildable prefix", () => {
    // 这是关键回归：assistant 角色的 priming 轮若不被计数，rebuild 时会被当成
    // 真实对话保留下来，于是每轮都重复注入一份 prefill。
    const entries = buildContextHistoryEntries(contextResult(), PREFILL);
    const conversation: RuntimeMessageEntry[] = [
      { message: { role: "user", content: "real question" } },
      { message: { role: "assistant", content: "real answer" } },
    ];
    const all = [...entries, ...conversation];
    expect(countContextPrefixMessages(all)).toBe(entries.length);
  });

  it("still stops counting at the first real user turn", () => {
    const entries = buildContextHistoryEntries(contextResult(), PREFILL);
    const conversation: RuntimeMessageEntry[] = [
      { message: { role: "user", content: "real question" } },
      { message: { role: "assistant", content: "real answer" } },
      { message: { role: "user", content: "follow-up" } },
    ];
    expect(countContextPrefixMessages([...entries, ...conversation])).toBe(entries.length);
  });

  it("is idempotent when the prefix is rebuilt from an existing history", () => {
    const first = buildContextHistoryEntries(contextResult(), PREFILL);
    const conversation: RuntimeMessageEntry[] = [
      { message: { role: "user", content: "real question" } },
    ];
    const history = [...first, ...conversation];
    const prefixCount = countContextPrefixMessages(history);
    const rebuilt = [
      ...buildContextHistoryEntries(contextResult(), PREFILL),
      ...history.slice(prefixCount),
    ];
    expect(rebuilt).toHaveLength(history.length);
    expect(countContextPrefixMessages(rebuilt)).toBe(first.length);
  });
});
