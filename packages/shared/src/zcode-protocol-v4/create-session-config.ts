import { z } from "zod";
import { modelSelectionSchema } from "../model-selection.js";
import { sessionPersonaConfigSchema } from "./session-config.js";

export const createSessionRequestedConfigSchema = z.object({
  modelSelection: modelSelectionSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  thought: z.string().optional(),
  followupMode: z.enum(["queue", "guide"]).optional(),
  // Bugfix：createSession.config 表达“请求覆盖字段”，不能复用 snapshot 的
  // sessionConfigStateSchema.partial()；snapshot 为兼容旧快照给 mode 设了 default("build")，
  // 会把“没传 mode”误变成“请求切回 build”，覆盖 workspace 默认 yolo。
  mode: z.string().optional(),
  planEnabled: z.boolean().optional(),
  /** XCode fork：草稿态会话身份（在首条输入之前应用）。 */
  persona: sessionPersonaConfigSchema.optional(),
  /** XCode fork：草稿态 PreFill 开关（在首条输入之前应用）。 */
  prefillMode: z.enum(["inherit", "on", "off"]).optional(),
});
