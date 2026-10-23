import { z } from "zod";
import { modelSelectionSchema } from "../model-selection.js";

// ── config──
/**
 * XCode fork：会话身份覆盖（三态）。
 * - inherit：跟随全局；inherited 是 UI 解析好的全局 customSystemMessages；
 * - builtin：内置身份；
 * - template：内置模板 id；
 * - custom：UI 解析好的自定义模板。
 */
export const sessionPersonaConfigSchema = z
  .object({
    mode: z.enum(["inherit", "builtin", "template", "custom"]),
    templateId: z.string().min(1).optional(),
    inherited: z
      .object({
        cliPrefix: z.string().max(65535).optional(),
        prefill: z
          .object({
            enabled: z.boolean().optional(),
            messages: z
              .array(
                z
                  .object({ role: z.enum(["user", "assistant"]), content: z.string() })
                  .strict(),
              )
              .optional(),
          })
          .strict()
          .optional(),
        obfuscation: z
          .object({
            enabled: z.boolean().optional(),
            tier: z.enum(["light", "standard", "heavy"]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    custom: z
      .object({
        id: z.string().min(1),
        cliPrefix: z.string().max(65535),
        prefill: z
          .object({
            enabled: z.boolean().optional(),
            messages: z
              .array(
                z
                  .object({ role: z.enum(["user", "assistant"]), content: z.string() })
                  .strict(),
              )
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const sessionConfigStateSchema = z.object({
  /** Session 接受并持久化的稀疏选择意图；provider/model/thought 仅为 UI effective 投影。 */
  modelSelection: modelSelectionSchema.optional(),
  provider: z.string(),
  model: z.string(),
  thought: z.string(),
  // 思考档位是当前模型的能力，不是 workspace/UI 偏好。
  // default 仅用于兼容旧快照；新 agent 必须从 runtime 投影实际集合。
  thoughtLevels: z.array(z.string()).default([]),
  followupMode: z.enum(["queue", "guide"]),
  // additive（冻结面演进，同 meta 的裁决口径）：agent 协作模式（core CollaborationMode）。
  // 必须带 default 才不破坏旧快照/旧发送端的解析；投影经 SessionModeChanged 事件更新。
  mode: z.string().default("build"),
  planEnabled: z.boolean().optional(),
  /** 明确审批结果；草稿按 interactionId 消费一次，普通 mode 更新不重置它。 */
  permissionGrant: z.object({ interactionId: z.string().min(1) }).optional(),
  /** XCode fork：草稿态先行选择的会话身份；createSession 时在首条输入前应用。 */
  persona: sessionPersonaConfigSchema.optional(),
  /**
   * XCode fork：会话级 PreFill 开关。缺省 = 跟随会话物化时继承的全局值；
   * on/off 由 createSession 或 session/setPrefill 写入。
   */
  prefillMode: z.enum(["inherit", "on", "off"]).optional(),
  /** 最近工具转换的关联，供草稿定向同步；不新增可见历史事件。 */
  planTransition: z
    .object({
      toolCallId: z.string(),
      planEnabled: z.boolean(),
    })
    .optional(),
});
export type SessionConfigState = z.infer<typeof sessionConfigStateSchema>;
export type SessionPersonaConfig = z.infer<typeof sessionPersonaConfigSchema>;

export const sessionModelTransitionSchema = z.object({
  eventId: z.string().min(1),
  origin: z.literal("registryFallback"),
  from: z.object({
    provider: z.string(),
    model: z.string(),
  }),
  to: z.object({
    provider: z.string(),
    model: z.string(),
  }),
});
export type SessionModelTransition = z.infer<typeof sessionModelTransitionSchema>;
