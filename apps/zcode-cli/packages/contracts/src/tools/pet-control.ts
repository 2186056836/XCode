// ============================================================
// Pet Control tools - agent-facing desktop pet control
// ============================================================
// 与 proxy-pool.ts 同构：单一工具 + 扁平 action 枚举。宠物控制改的是本机
// 悬浮宠物的行为状态（running/waiting/failed/review/idle）与动画（wave），
// 无文件/网络副作用。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

const nonEmptyString = z.string().trim().min(1);

export const PetControlActionSchema = z.enum(["get_state", "set_state", "wave"]);
export type PetControlAction = z.infer<typeof PetControlActionSchema>;

export const PetControlStateSchema = z.enum([
  "idle",
  "running",
  "waiting",
  "failed",
  "review",
]);
export type PetControlState = z.infer<typeof PetControlStateSchema>;

export const PetControlInputSchema = z
  .object({
    action: PetControlActionSchema.describe(
      [
        "Which pet operation to perform:",
        "`get_state` — none. Returns the floating pet's current state.",
        "`set_state` — state (idle | running | waiting | failed | review). Overrides the automatic conversation-phase mapping until the next turn event.",
        "`wave` — none. Makes the pet wave once (greeting).",
      ].join(" "),
    ),
    state: PetControlStateSchema.optional().describe(
      "Target behavior state; required for action `set_state`, omit otherwise.",
    ),
  })
  .strict();
export type PetControlInput = z.infer<typeof PetControlInputSchema>;

export const PetControlOutputSchema = z
  .object({
    message: nonEmptyString,
    enabled: z.boolean(),
    petId: nonEmptyString,
    behaviorState: nonEmptyString,
  })
  .strict();
export type PetControlOutput = z.infer<typeof PetControlOutputSchema>;
export const PetControlOutputJsonSchema = toToolJsonSchema(PetControlOutputSchema);

export const PetControlInputJsonSchema = toToolJsonSchema(PetControlInputSchema);
