/**
 * 身份模板变量：把提示词 / PreFill 里的 `{{name}}` 替换成用户填写的助手名字。
 *
 * 占位符属于模板原文，助手名字是模板的变量值（存在 `customPersonaTemplates[].assistantName`）。
 * 只有**应用模板**时才展开，设置页里保留 `{{name}}`，这样换名字不用重写提示词。
 * 名字为空时保持占位符原样，避免把 `{{name}}` 静默替换成空串。
 */
import type { ModelJailbreakPrefillMessage } from "./protocol.js";

export const PERSONA_TEMPLATE_NAME_PLACEHOLDER = "{{name}}";

/** 兼容手写时的空格：`{{name}}`、`{{ name }}` 都认。 */
const NAME_PLACEHOLDER_PATTERN = /\{\{\s*name\s*\}\}/g;

export function resolvePersonaTemplateText(text: string, assistantName?: string): string {
  const name = assistantName?.trim();
  if (!name) return text;
  return text.replace(NAME_PLACEHOLDER_PATTERN, name);
}

export function resolvePersonaTemplateMessages(
  messages: readonly ModelJailbreakPrefillMessage[] | undefined,
  assistantName?: string,
): ModelJailbreakPrefillMessage[] {
  return (messages ?? []).map((message) => ({
    ...message,
    content: resolvePersonaTemplateText(message.content, assistantName),
  }));
}

export interface PersonaTemplatePlaceholderSource {
  cliPrefix: string;
  assistantName?: string;
  prefill?: {
    enabled?: boolean;
    messages?: readonly ModelJailbreakPrefillMessage[];
  };
}

/** 应用模板前的展开：返回可直接写进 `customSystemMessages` 的提示词与 PreFill。 */
export function resolvePersonaTemplatePlaceholders(
  template: PersonaTemplatePlaceholderSource,
): {
  cliPrefix: string;
  prefill?: { enabled?: boolean; messages?: ModelJailbreakPrefillMessage[] };
} {
  return {
    cliPrefix: resolvePersonaTemplateText(template.cliPrefix, template.assistantName),
    ...(template.prefill
      ? {
          prefill: {
            enabled: template.prefill.enabled,
            ...(template.prefill.messages
              ? {
                  messages: resolvePersonaTemplateMessages(
                    template.prefill.messages,
                    template.assistantName,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
}
