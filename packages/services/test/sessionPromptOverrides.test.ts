import { describe, expect, it } from "vitest";
import {
  applyPersistedPromptOverrides,
  persistSessionPromptOverrides,
  readPersistedSessionPromptOverrides,
  snapshotPromptOverrides,
  SESSION_ENTRY_SYSTEM_PROMPT_OVERRIDES,
} from "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-prompt-overrides-snapshot.js";

interface Row {
  id: string;
  sessionID: string;
  type: string;
  data: unknown;
  time: { created: number; updated: number };
}

function makeStore() {
  const rows = new Map<string, Row>();
  let sessionEntriesCalls = 0;
  return {
    rows,
    get sessionEntriesCalls() {
      return sessionEntriesCalls;
    },
    saveSessionEntry: async (input: Row) => {
      rows.set(input.id, input);
    },
    sessionEntries: async (input: { sessionID: string; type?: string }) => {
      sessionEntriesCalls += 1;
      return [...rows.values()].filter(
        (row) =>
          row.sessionID === input.sessionID && (input.type === undefined || row.type === input.type),
      );
    },
  };
}

function makeRecord(overrides: Record<string, unknown> = {}) {
  const runtimeCalls: unknown[] = [];
  const record = {
    persistence: "immediate" as const,
    app: {
      runtime: {
        updateConfig: (patch: unknown) => {
          runtimeCalls.push(patch);
        },
      },
    },
    ...overrides,
  };
  return { record, runtimeCalls };
}

const PREFIX = "# Identity: Meimei";
const PREFILL = {
  enabled: true,
  messages: [{ role: "user" as const, content: "报身份" }],
};

describe("session prompt overrides snapshot", () => {
  it("round-trips template persona plus prefill override through the session entry", async () => {
    const store = makeStore();
    const { record } = makeRecord({
      personaOverride: "meimei",
      prefillOverride: true,
      prefillInheritedEnabled: false,
      customSystemMessages: { cliPrefix: PREFIX, prefill: PREFILL },
    });

    await persistSessionPromptOverrides({
      record,
      sessionId: "sess-1",
      sessionStore: store as never,
    });
    expect(store.rows.size).toBe(1);
    expect([...store.rows.values()][0]!.type).toBe(SESSION_ENTRY_SYSTEM_PROMPT_OVERRIDES);

    const restored = await readPersistedSessionPromptOverrides({
      sessionId: "sess-1",
      sessionStore: store as never,
    });
    expect(restored).toEqual({
      personaMode: "template",
      personaId: "meimei",
      prefillMode: "on",
      prefillInheritedEnabled: false,
      customSystemMessages: { cliPrefix: PREFIX, prefill: PREFILL },
    });

    // 模拟重启：record 从全局偏好重建（无覆盖），再把快照写回。
    const fresh = makeRecord();
    applyPersistedPromptOverrides(fresh.record, restored!);
    expect(fresh.record).toMatchObject({ personaOverride: "meimei", prefillOverride: true });
    expect(fresh.record.customSystemMessages).toEqual({ cliPrefix: PREFIX, prefill: PREFILL });
    expect(fresh.runtimeCalls.at(-1)).toEqual({
      systemPromptOverrides: { cliPrefix: PREFIX, prefill: PREFILL },
    });
  });

  it("keeps builtin and inherit distinct", async () => {
    const store = makeStore();
    const builtin = makeRecord({ personaOverride: null }).record;
    await persistSessionPromptOverrides({ record: builtin, sessionId: "s1", sessionStore: store as never });
    const inherit = makeRecord({ prefillOverride: false }).record;
    await persistSessionPromptOverrides({ record: inherit, sessionId: "s2", sessionStore: store as never });

    const builtinSnap = await readPersistedSessionPromptOverrides({
      sessionId: "s1",
      sessionStore: store as never,
    });
    const inheritSnap = await readPersistedSessionPromptOverrides({
      sessionId: "s2",
      sessionStore: store as never,
    });
    expect(builtinSnap?.personaMode).toBe("builtin");
    expect(inheritSnap?.personaMode).toBe("inherit");
    expect(inheritSnap?.prefillMode).toBe("off");

    const restoredBuiltin = makeRecord().record;
    applyPersistedPromptOverrides(restoredBuiltin, builtinSnap!);
    expect(restoredBuiltin.personaOverride).toBeNull();
    expect(restoredBuiltin.customSystemMessages).toBeUndefined();
  });

  it("skips persistence while the session is still a draft", async () => {
    const store = makeStore();
    const { record } = makeRecord({ persistence: "deferred", personaOverride: "meimei" });
    await persistSessionPromptOverrides({ record, sessionId: "s-draft", sessionStore: store as never });
    expect(store.rows.size).toBe(0);
  });

  it("returns undefined when nothing was ever persisted", async () => {
    const store = makeStore();
    await expect(
      readPersistedSessionPromptOverrides({ sessionId: "missing", sessionStore: store as never }),
    ).resolves.toBeUndefined();
  });
});

describe("snapshotPromptOverrides", () => {
  it("derives the three persona modes", () => {
    expect(snapshotPromptOverrides({}).personaMode).toBe("inherit");
    expect(snapshotPromptOverrides({ personaOverride: null }).personaMode).toBe("builtin");
    expect(snapshotPromptOverrides({ personaOverride: "custom-abc" })).toMatchObject({
      personaMode: "template",
      personaId: "custom-abc",
    });
  });

  it("does not alias the stored prefill messages", () => {
    const source = { cliPrefix: PREFIX, prefill: PREFILL };
    const snap = snapshotPromptOverrides({ customSystemMessages: source });
    expect(snap.customSystemMessages).not.toBe(source);
    expect(snap.customSystemMessages?.prefill?.messages).not.toBe(PREFILL.messages);
  });
});
