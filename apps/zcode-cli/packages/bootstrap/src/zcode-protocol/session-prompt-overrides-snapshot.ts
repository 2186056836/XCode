import type { Logger, SessionId, SessionStorePort } from "@zcode/contracts";
import type { SessionCustomSystemMessages } from "./server-types.js";

/**
 * 会话级身份 / PreFill 覆盖的持久化快照。
 *
 * 为什么需要：`record.personaOverride` / `prefillOverride` / `customSystemMessages`
 * 只活在内存 record 上，resume 时 `materializeSessionRecord` 会从 setting.json 的
 * 全局偏好重建 record——于是重启后所有会话都退回「跟随全局」，用户在同一会话里
 * 选的模板和 PreFill 开关全部丢失。
 *
 * 与 `runtime/model_selection` 同构：写进 session_entry，冷恢复时读回。
 * 语义是「会话物化时冻结」：快照存的是当时解析后的正文 + 来源标记，之后改全局
 * 设置或改内置模板都不会回灌到已有会话。
 */
export const SESSION_ENTRY_SYSTEM_PROMPT_OVERRIDES = "runtime/system_prompt_overrides";

const ENTRY_ID_SUFFIX = "runtime:system_prompt_overrides";

export interface PersistedPromptOverrides {
  /** inherit = 未覆盖（跟随全局）；builtin = 显式内置；template = 内置或自定义模板 id。 */
  personaMode: "inherit" | "builtin" | "template";
  personaId?: string;
  prefillMode: "inherit" | "on" | "off";
  /** 首次覆盖前的 enabled，供「跟随全局」恢复；与 record 同字段。 */
  prefillInheritedEnabled?: boolean;
  /** 当时生效的完整正文；inherit 时也保留，避免恢复后正文变空。 */
  customSystemMessages?: SessionCustomSystemMessages;
}

interface PromptOverridesRecord {
  /** draft 会话尚未落库；session_entry 有外键，写入会直接失败。 */
  persistence?: "immediate" | "deferred";
  personaOverride?: string | null;
  prefillOverride?: boolean;
  prefillInheritedEnabled?: boolean;
  customSystemMessages?: SessionCustomSystemMessages;
}

export function snapshotPromptOverrides(
  record: PromptOverridesRecord,
): PersistedPromptOverrides {
  const personaMode =
    record.personaOverride === undefined
      ? "inherit"
      : record.personaOverride === null
        ? "builtin"
        : "template";
  return {
    personaMode,
    ...(personaMode === "template" && typeof record.personaOverride === "string"
      ? { personaId: record.personaOverride }
      : {}),
    prefillMode:
      record.prefillOverride === undefined ? "inherit" : record.prefillOverride ? "on" : "off",
    ...(record.prefillInheritedEnabled !== undefined
      ? { prefillInheritedEnabled: record.prefillInheritedEnabled }
      : {}),
    ...(record.customSystemMessages
      ? { customSystemMessages: cloneCustomSystemMessages(record.customSystemMessages) }
      : {}),
  };
}

export async function persistSessionPromptOverrides(options: {
  logger?: Logger;
  record: PromptOverridesRecord;
  sessionId: SessionId;
  sessionStore: SessionStorePort | undefined;
}): Promise<void> {
  const store = options.sessionStore;
  if (!store?.saveSessionEntry || options.record.persistence === "deferred") {
    return;
  }
  const timestamp = Date.now();
  try {
    await store.saveSessionEntry({
      id: `${options.sessionId}:${ENTRY_ID_SUFFIX}`,
      sessionID: options.sessionId,
      type: SESSION_ENTRY_SYSTEM_PROMPT_OVERRIDES,
      // 切换身份不是任务活动；不能把会话列表的「刚刚」刷成当前时间。
      touchSession: false,
      time: { created: timestamp, updated: timestamp },
      data: snapshotPromptOverrides(options.record),
    });
  } catch (error) {
    // 已生效的覆盖不会因为落盘失败而回滚；下次切换会重写同一条 entry。
    options.logger?.warn("Session prompt overrides persistence failed", {
      error: error instanceof Error ? error.message : String(error),
      event: "session.prompt_overrides.persist_failed",
      sessionId: options.sessionId,
      status: "failed",
    });
  }
}

export async function readPersistedSessionPromptOverrides(options: {
  logger?: Logger;
  sessionId: SessionId;
  sessionStore: SessionStorePort | undefined;
}): Promise<PersistedPromptOverrides | undefined> {
  const store = options.sessionStore;
  if (!store?.sessionEntries) return undefined;
  try {
    const entries = await store.sessionEntries({
      sessionID: options.sessionId,
      type: SESSION_ENTRY_SYSTEM_PROMPT_OVERRIDES,
    });
    const latest = entries.at(-1);
    if (!latest) return undefined;
    return parsePersistedPromptOverrides(latest.data);
  } catch (error) {
    options.logger?.warn("Session prompt overrides read failed", {
      error: error instanceof Error ? error.message : String(error),
      event: "session.prompt_overrides.read_failed",
      sessionId: options.sessionId,
      status: "failed",
    });
    return undefined;
  }
}

interface PromptOverridesTarget extends PromptOverridesRecord {
  app: {
    runtime: {
      updateConfig(patch: { systemPromptOverrides?: SessionCustomSystemMessages }): void;
    };
  };
}

/** 把持久化快照写回 record 与 runtime；调用方保证 runtime 已创建。 */
export function applyPersistedPromptOverrides(
  record: PromptOverridesTarget,
  persisted: PersistedPromptOverrides,
): void {
  if (persisted.personaMode === "inherit") {
    delete record.personaOverride;
  } else if (persisted.personaMode === "builtin") {
    record.personaOverride = null;
  } else if (persisted.personaId) {
    record.personaOverride = persisted.personaId;
  } else {
    delete record.personaOverride;
  }

  if (persisted.prefillMode === "inherit") {
    delete record.prefillOverride;
    delete record.prefillInheritedEnabled;
  } else {
    record.prefillOverride = persisted.prefillMode === "on";
    if (persisted.prefillInheritedEnabled !== undefined) {
      record.prefillInheritedEnabled = persisted.prefillInheritedEnabled;
    }
  }

  if (persisted.customSystemMessages) {
    record.customSystemMessages = cloneCustomSystemMessages(persisted.customSystemMessages);
    record.app.runtime.updateConfig({
      systemPromptOverrides: cloneCustomSystemMessages(persisted.customSystemMessages),
    });
  } else {
    delete record.customSystemMessages;
    record.app.runtime.updateConfig({ systemPromptOverrides: undefined });
  }
}

function parsePersistedPromptOverrides(value: unknown): PersistedPromptOverrides | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const personaMode = raw.personaMode;
  const prefillMode = raw.prefillMode;
  if (
    personaMode !== "inherit" &&
    personaMode !== "builtin" &&
    personaMode !== "template"
  ) {
    return undefined;
  }
  if (prefillMode !== "inherit" && prefillMode !== "on" && prefillMode !== "off") {
    return undefined;
  }
  return {
    personaMode,
    ...(personaMode === "template" && typeof raw.personaId === "string"
      ? { personaId: raw.personaId }
      : {}),
    prefillMode,
    ...(typeof raw.prefillInheritedEnabled === "boolean"
      ? { prefillInheritedEnabled: raw.prefillInheritedEnabled }
      : {}),
    ...(isCustomSystemMessages(raw.customSystemMessages)
      ? { customSystemMessages: cloneCustomSystemMessages(raw.customSystemMessages) }
      : {}),
  };
}

function isCustomSystemMessages(value: unknown): value is SessionCustomSystemMessages {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneCustomSystemMessages(
  value: SessionCustomSystemMessages,
): SessionCustomSystemMessages {
  return {
    ...(value.cliPrefix !== undefined ? { cliPrefix: value.cliPrefix } : {}),
    ...(value.prefill
      ? {
          prefill: {
            ...(value.prefill.enabled !== undefined ? { enabled: value.prefill.enabled } : {}),
            ...(value.prefill.messages
              ? { messages: value.prefill.messages.map((message) => ({ ...message })) }
              : {}),
          },
        }
      : {}),
    ...(value.obfuscation ? { obfuscation: { ...value.obfuscation } } : {}),
  };
}
