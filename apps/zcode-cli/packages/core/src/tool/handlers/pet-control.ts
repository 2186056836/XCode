// ============================================================
// Pet Control Tool Handler
// ============================================================
// 桌宠悬浮窗的 agent 面：读取/覆盖行为状态、触发挥手。改的是本机 UI
// 状态（宠物动画），无文件/网络副作用，不需要用户确认。

import {
  PetControlInputJsonSchema,
  PetControlOutputJsonSchema,
  PetControlInputSchema,
  PetControlOutputSchema,
  type PetControlInput,
  type PetControlOutput,
  type PetControlState,
} from "@zcode/contracts";

import type { ToolEntry, ToolExecutionContext, ToolHandler } from "../types.js";

const PET_CONTROL_MODEL_BYTES = 8_000;

function assertPetControlPort(
  context: ToolExecutionContext,
): asserts context is ToolExecutionContext & {
  petControlPort: NonNullable<ToolExecutionContext["petControlPort"]>;
} {
  if (context.petControlPort) return;
  throw new Error("PetControlPort is not configured for PetControl (desktop pet overlay unavailable)");
}

export const petControlHandler: ToolHandler = async (input, context) => {
  const parsed = PetControlInputSchema.parse(input) as PetControlInput;
  assertPetControlPort(context);
  const port = context.petControlPort;

  let snapshot: { enabled: boolean; petId: string; behaviorState: string };
  let message: string;
  switch (parsed.action) {
    case "get_state": {
      snapshot = await port.getSnapshot();
      message = snapshot.enabled
        ? `Floating pet "${snapshot.petId}" is showing state "${snapshot.behaviorState}".`
        : "The floating pet is currently tucked away (disabled). Enable it in Settings -> Pets.";
      break;
    }
    case "set_state": {
      const state = parsed.state as PetControlState;
      snapshot = await port.setBehaviorState(state);
      message = `Floating pet "${snapshot.petId}" now shows state "${snapshot.behaviorState}".`;
      break;
    }
    case "wave": {
      snapshot = await port.wave();
      message = `Floating pet "${snapshot.petId}" waved.`;
      break;
    }
  }

  const output: PetControlOutput = {
    message,
    enabled: snapshot.enabled,
    petId: snapshot.petId,
    behaviorState: snapshot.behaviorState,
  };
  return PetControlOutputSchema.parse(output);
};

const petControlTimeout = {
  defaultMs: 10_000,
  maxMs: 10_000,
  allowCallOverride: false,
};

export const petControlToolEntry: ToolEntry = {
  capability: "Read and control the XCode floating desktop pet (behavior state and animations)",
  metadata: {
    name: "PetControl",
    description:
      "Read and control XCode's floating desktop pet. The pet mirrors conversation progress automatically; this tool lets you read its current state, override the behavior state shown by its animation (idle | running | waiting | failed | review), or make it wave once as a greeting. Use it when the user asks to make the pet react, celebrate, wave, or change what it is doing. Settings UI shows the same configuration.",
    modelInstructions: [
      "The pet's behavior state normally follows the conversation phase automatically; a `set_state` override lasts until the next turn event re-maps it.",
      "`wave` is transient: the pet plays the waving animation once and returns to its behavior state.",
      "If the output reports enabled=false, the pet is tucked away; tell the user to enable it in Settings -> Pets instead of retrying.",
      "Never fabricate pet ids: the petId in the output is the single source of truth.",
    ],
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: 10_000,
    maxOutputBytes: PET_CONTROL_MODEL_BYTES,
    sideEffectScope: "workspace",
    riskLevel: "low",
    needsApproval: false,
    allowedInPlanMode: true,
  },
  handler: petControlHandler,
  inputSchema: PetControlInputJsonSchema,
  outputSchema: PetControlOutputJsonSchema,
  runtimeInputSchema: PetControlInputSchema,
  runtimeOutputSchema: PetControlOutputSchema,
  timeout: petControlTimeout,
  permission: {
    permission: "pet.control",
    reason: "PetControl only changes the local floating pet's animation state",
    riskLevel: "low",
    sideEffectScope: "workspace",
    needsApproval: false,
    patternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
} as unknown as ToolEntry;
