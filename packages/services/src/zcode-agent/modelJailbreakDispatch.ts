// ============================================================
// Model Jailbreak host dispatch
// ============================================================
// 与 dispatchProxyPoolRequest 同族：modelJailbreak/* 的唯一 host 侧映射。
//
// 数据落在 setting.json 的 `customSystemMessages`（与设置页同一份）：
// - cliPrefix    ← identityPrompt（模板套用后其正文也写这里）
// - prefill      ← priming turns
// - obfuscation  ← Parseltongue 档位
//
// 所有方法都回同一个快照（当前 state + 可选模板清单），模型改完立刻看到真值。

import {
  GODMODE_DEFAULT_PREFILL,
  GODMODE_TEMPLATES,
  PREFILL_TEMPLATES,
  zcodeModelJailbreakApplyTemplateParamsSchema,
  zcodeModelJailbreakSetObfuscationParamsSchema,
  zcodeModelJailbreakSetPrefillParamsSchema,
  zcodeModelJailbreakSetPromptParamsSchema,
  zcodeProtocolMethods,
  type CustomSystemMessagesSettings,
  type CustomPersonaTemplate,
  type XCodeModelJailbreakProtocolSnapshot,
} from "@zcode/shared";

/**
 * 内置默认身份行。与 apps/zcode-cli/packages/core/src/context/sections/cli-prefix.ts
 * 的 CLI_PREFIX_PROMPT 逐字同步——改 core 身份行时必须同步这里与 UI 的
 * CustomSystemMessagesSetting.tsx。
 */
export const DEFAULT_IDENTITY_PROMPT = "You are XCode, an interactive coding agent";

const DEFAULT_OBFUSCATION_TIER = "standard" as const;

/** host 侧只需要能读写 customSystemMessages 这一块。 */
export interface ModelJailbreakSettingStore {
  get(): Promise<{
    customSystemMessages?: CustomSystemMessagesSettings;
    /** 用户自定义身份模板（设置页「模型越狱」里新建的）。 */
    customPersonaTemplates?: CustomPersonaTemplate[];
  }>;
  update(patch: {
    customSystemMessages?: CustomSystemMessagesSettings;
  }): Promise<unknown>;
}

export type ModelJailbreakDispatchResult =
  | { ok: true; snapshot: XCodeModelJailbreakProtocolSnapshot }
  | { ok: false; message: string; data?: unknown };

export const MODEL_JAILBREAK_METHODS: ReadonlySet<string> = new Set([
  zcodeProtocolMethods.modelJailbreakList,
  zcodeProtocolMethods.modelJailbreakSetIdentityPrompt,
  zcodeProtocolMethods.modelJailbreakApplyTemplate,
  zcodeProtocolMethods.modelJailbreakSetPrefill,
  zcodeProtocolMethods.modelJailbreakSetObfuscation,
]);

export function isModelJailbreakProtocolMethod(method: string): boolean {
  return MODEL_JAILBREAK_METHODS.has(method);
}

function buildState(
  settings: CustomSystemMessagesSettings | undefined,
): XCodeModelJailbreakProtocolSnapshot["state"] {
  const cliPrefix = settings?.cliPrefix?.trim() ?? "";
  // 当前身份提示词与某个模板正文逐字相同时，认为「套用了该模板」。
  const applied = cliPrefix
    ? (GODMODE_TEMPLATES.find((template) => template.prompt === cliPrefix)?.id ?? null)
    : null;
  const prefillMessages = settings?.prefill?.messages ?? [];
  return {
    identityPrompt: cliPrefix || null,
    defaultIdentityPrompt: DEFAULT_IDENTITY_PROMPT,
    appliedTemplateId: applied,
    prefill: {
      enabled: settings?.prefill?.enabled === true && prefillMessages.length > 0,
      messages: prefillMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    },
    obfuscation: {
      enabled: settings?.obfuscation?.enabled === true,
      tier: settings?.obfuscation?.tier ?? DEFAULT_OBFUSCATION_TIER,
    },
  };
}

/** 导出给测试：这条 switch 是 modelJailbreak/* 的唯一 host 侧映射。 */
export async function dispatchModelJailbreakRequest(
  store: ModelJailbreakSettingStore,
  request: { method: string; params?: unknown },
): Promise<ModelJailbreakDispatchResult> {
  const invalid = (message: string, data?: unknown): ModelJailbreakDispatchResult => ({
    ok: false,
    message,
    ...(data === undefined ? {} : { data }),
  });

  const readSettings = async (): Promise<CustomSystemMessagesSettings | undefined> =>
    (await store.get()).customSystemMessages;

  /** 每次写操作都回最新快照；list 额外带模板清单。 */
  const snapshot = async (
    withTemplates: boolean,
  ): Promise<ModelJailbreakDispatchResult> => {
    const settings = await store.get();
    const state = buildState(settings.customSystemMessages);
    return {
      ok: true,
      snapshot: {
        state,
        ...(withTemplates
          ? {
              templates: [
                ...GODMODE_TEMPLATES.map(({ id, name }) => ({ id, name })),
                ...(settings.customPersonaTemplates ?? []).map(({ id, name }) => ({
                  id,
                  name,
                })),
              ],
            }
          : {}),
      },
    };
  };

  switch (request.method) {
    case zcodeProtocolMethods.modelJailbreakList:
      return snapshot(true);

    case zcodeProtocolMethods.modelJailbreakSetIdentityPrompt: {
      const parsed = zcodeModelJailbreakSetPromptParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid identity prompt params", parsed.error.flatten());
      }
      const trimmed = parsed.data.prompt.trim();
      const current = (await readSettings()) ?? {};
      await store.update({
        customSystemMessages: {
          ...current,
          // 空串 = 清除自定义，回落内置默认（与 UI 的「恢复默认」同语义）。
          cliPrefix: trimmed || undefined,
        },
      });
      return snapshot(false);
    }

    case zcodeProtocolMethods.modelJailbreakApplyTemplate: {
      const parsed = zcodeModelJailbreakApplyTemplateParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid apply template params", parsed.error.flatten());
      }
      const settings = await store.get();
      const template = GODMODE_TEMPLATES.find((item) => item.id === parsed.data.templateId);
      const customTemplate = (settings.customPersonaTemplates ?? []).find(
        (item) => item.id === parsed.data.templateId,
      );
      if (!template && !customTemplate) {
        return invalid(
          `Unknown template id: ${parsed.data.templateId}. Call list first and pass one of the returned ids.`,
        );
      }
      const current = settings.customSystemMessages ?? {};
      await store.update({
        customSystemMessages: {
          ...current,
          cliPrefix: template?.prompt ?? customTemplate!.cliPrefix,
          ...(template
            ? (() => {
                const prefillTemplate = PREFILL_TEMPLATES.find(
                  (item) => item.id === template.id,
                );
                return prefillTemplate
                  ? {
                      prefill: {
                        enabled: true,
                        messages: prefillTemplate.messages.map((message) => ({
                          ...message,
                        })),
                      },
                    }
                  : {};
              })()
            : customTemplate?.prefill
              ? { prefill: customTemplate.prefill }
              : {}),
        },
      });
      return snapshot(false);
    }

    case zcodeProtocolMethods.modelJailbreakSetPrefill: {
      const parsed = zcodeModelJailbreakSetPrefillParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid prefill params", parsed.error.flatten());
      }
      const current = (await readSettings()) ?? {};
      const messages = parsed.data.messages;
      await store.update({
        customSystemMessages: {
          ...current,
          prefill: {
            enabled: messages.length > 0,
            messages: messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          },
        },
      });
      return snapshot(false);
    }

    case zcodeProtocolMethods.modelJailbreakSetObfuscation: {
      const parsed = zcodeModelJailbreakSetObfuscationParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return invalid("Invalid obfuscation params", parsed.error.flatten());
      }
      if (parsed.data.enabled && !parsed.data.tier) {
        return invalid("`tier` is required when `enabled` is true (light / standard / heavy)");
      }
      const current = (await readSettings()) ?? {};
      await store.update({
        customSystemMessages: {
          ...current,
          obfuscation: {
            enabled: parsed.data.enabled,
            ...(parsed.data.tier ? { tier: parsed.data.tier } : {}),
          },
        },
      });
      return snapshot(false);
    }

    default:
      return invalid(`Unsupported model jailbreak method: ${request.method}`);
  }
}

/** 默认 prefill（供 UI 与工具保持一致）。 */
export { GODMODE_DEFAULT_PREFILL };
