// ============================================================
// Model Jailbreak tools - agent-facing jailbreak / identity config
// ============================================================
// 与 proxy-pool.ts 兄弟并列：单一工具 + 扁平 action 枚举。
//
// 这个工具把设置页「模型越狱」的四件事原样交给模型：
// 1. Agent 提示词（更改 XCode 身份设定）——整段替换第 1 条 system 消息；
// 2. GODMODE 系统提示词模板——一键套用预设；
// 3. Prefill（预置对话）——system 之后、首个真实 user 之前；
// 4. Parseltongue 输入混淆——改写发给模型的 user 文本。
//
// 「模板」的正文不放进 JSON Schema：预设内容在 UI 侧（godmodeTemplates.ts），
// agent 只需要知道模板 id。清单通过 `list` 返回，避免模型凭空编 id。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

const nonEmptyString = z.string().trim().min(1);

export const ModelJailbreakActionSchema = z.enum([
  "list",
  "set_identity_prompt",
  "clear_identity_prompt",
  "apply_template",
  "set_prefill",
  "clear_prefill",
  "set_obfuscation",
]);
export type ModelJailbreakAction = z.infer<typeof ModelJailbreakActionSchema>;

export const ModelJailbreakPrefillMessageSchema = z.object({
  role: z.enum(["user", "assistant"]).describe("Prefill turn role."),
  content: z.string().describe("Full text of this priming turn."),
});

export const ModelJailbreakInputSchema = z
  .object({
    action: ModelJailbreakActionSchema.describe(
      [
        "Which jailbreak operation to perform. Required fields per action:",
        "`list` — none. Returns the current state plus every available GODMODE template id.",
        "`set_identity_prompt` — prompt: the full replacement for the first system message.",
        "`clear_identity_prompt` — none. Reverts to the built-in XCode identity line.",
        "`apply_template` — templateId, exactly as returned by `list`.",
        "`set_prefill` — messages: the priming turns (system is inserted after these).",
        "`clear_prefill` — none.",
        "`set_obfuscation` — enabled, and tier when enabled is true.",
      ].join(" "),
    ),
    prompt: z
      .string()
      .max(65535)
      .optional()
      .describe(
        "Replacement for the first system message (the XCode identity line). Required by `set_identity_prompt`. An empty or whitespace-only value clears the override.",
      ),
    templateId: nonEmptyString
      .optional()
      .describe(
        "GODMODE template id, exactly as returned by `list` (for example `xiaomei-ctf`). Never invent one. Required by `apply_template`.",
      ),
    messages: z
      .array(ModelJailbreakPrefillMessageSchema)
      .max(50)
      .optional()
      .describe(
        "Priming turns injected after the system message and before the first real user turn. Required by `set_prefill`. Pass an empty array to clear.",
      ),
    enabled: z
      .boolean()
      .optional()
      .describe("Whether Parseltongue input obfuscation is active. Required by `set_obfuscation`."),
    tier: z
      .enum(["light", "standard", "heavy"])
      .optional()
      .describe(
        "Obfuscation strength. Required by `set_obfuscation` when enabled is true; ignored when false.",
      ),
  })
  .refine(
    (value) => {
      switch (value.action) {
        case "set_identity_prompt":
          return typeof value.prompt === "string";
        case "apply_template":
          return value.templateId !== undefined;
        case "set_prefill":
          return Array.isArray(value.messages);
        case "set_obfuscation":
          return typeof value.enabled === "boolean";
        default:
          return true;
      }
    },
    {
      message:
        "Missing required field for the chosen action: set_identity_prompt needs prompt, apply_template needs templateId, set_prefill needs messages, set_obfuscation needs enabled.",
    },
  )
  .refine((value) => value.action !== "set_obfuscation" || value.enabled !== true || value.tier !== undefined, {
    message: "set_obfuscation with enabled=true requires tier (light / standard / heavy).",
  });

export type ModelJailbreakInput = z.infer<typeof ModelJailbreakInputSchema>;

export const ModelJailbreakTemplateViewSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const ModelJailbreakPrefillViewSchema = z.object({
  enabled: z.boolean(),
  messages: z.array(ModelJailbreakPrefillMessageSchema),
});

export const ModelJailbreakObfuscationViewSchema = z.object({
  enabled: z.boolean(),
  tier: z.enum(["light", "standard", "heavy"]),
});

export const ModelJailbreakStateSchema = z.object({
  /** 当前生效的身份提示词；null = 使用内置默认。 */
  identityPrompt: z.string().nullable(),
  /** 内置默认身份行（清空自定义后回落到的内容）。 */
  defaultIdentityPrompt: z.string(),
  /** 当前套用的模板 id；null = 未套用预设。 */
  appliedTemplateId: z.string().nullable(),
  prefill: ModelJailbreakPrefillViewSchema,
  obfuscation: ModelJailbreakObfuscationViewSchema,
});

export const ModelJailbreakOutputSchema = z.object({
  message: z.string(),
  state: ModelJailbreakStateSchema,
  /** 可用模板清单（仅 `list` 返回，其余 action 省略）。 */
  templates: z.array(ModelJailbreakTemplateViewSchema).optional(),
});

export type ModelJailbreakOutput = z.infer<typeof ModelJailbreakOutputSchema>;
export type ModelJailbreakState = z.infer<typeof ModelJailbreakStateSchema>;
export type ModelJailbreakTemplateView = z.infer<typeof ModelJailbreakTemplateViewSchema>;
export type ModelJailbreakPrefillMessage = z.infer<typeof ModelJailbreakPrefillMessageSchema>;
export type ModelJailbreakPrefillView = z.infer<typeof ModelJailbreakPrefillViewSchema>;
export type ModelJailbreakObfuscationView = z.infer<typeof ModelJailbreakObfuscationViewSchema>;

export const ModelJailbreakInputJsonSchema = toToolJsonSchema(ModelJailbreakInputSchema);
export const ModelJailbreakOutputJsonSchema = toToolJsonSchema(ModelJailbreakOutputSchema);
