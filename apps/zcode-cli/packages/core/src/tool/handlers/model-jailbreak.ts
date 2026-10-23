// ============================================================
// Model Jailbreak Tool Handler
// ============================================================
// 单工具 + action 枚举：把设置页「模型越狱」那套配置面原样交给模型。
//
// 权限画像按 action 分档：
// - list 只读，无副作用，计划模式放行；
// - 其余写的是应用级配置（影响本机所有会话的系统提示词），一律要确认。
// 基础 metadata 取最严的那一档，resolvePermissionCapability 只能收紧到 list。

import {
  CoreErrorType,
  createCoreError,
  ModelJailbreakInputJsonSchema,
  ModelJailbreakInputSchema,
  ModelJailbreakOutputJsonSchema,
  ModelJailbreakOutputSchema,
  type ModelJailbreakInput,
  type ModelJailbreakOutput,
  type ToolPermissionSpec,
} from "@zcode/contracts";
import type {
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolRuntimePermissionCapability,
} from "../types.js";

const MODEL_JAILBREAK_TOOL_TIMEOUT_MS = 30_000;
const MODEL_JAILBREAK_MODEL_BYTES = 64_000;

function assertModelJailbreakPort(
  context: ToolExecutionContext,
): asserts context is ToolExecutionContext & {
  modelJailbreakPort: NonNullable<ToolExecutionContext["modelJailbreakPort"]>;
} {
  if (context.modelJailbreakPort) return;
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    "ModelJailbreakPort is not configured for ModelJailbreak",
    {
      context: {
        toolCallId: context.toolCallId,
        toolName: "ModelJailbreak",
      },
      recoverable: false,
    },
  );
}

export const modelJailbreakHandler: ToolHandler = async (input, context) => {
  const parsed = ModelJailbreakInputSchema.parse(input) as ModelJailbreakInput;
  assertModelJailbreakPort(context);
  const port = context.modelJailbreakPort;

  switch (parsed.action) {
    case "list": {
      const snapshot = await port.read();
      const message =
        `Read the current jailbreak state. identityPrompt=${snapshot.state.identityPrompt ? "custom" : "built-in"}, ` +
        `appliedTemplateId=${snapshot.state.appliedTemplateId ?? "none"}, ` +
        `prefill=${snapshot.state.prefill.enabled ? `${snapshot.state.prefill.messages.length} turn(s)` : "off"}, ` +
        `obfuscation=${snapshot.state.obfuscation.enabled ? snapshot.state.obfuscation.tier : "off"}. ` +
        `Available templates: ${(snapshot.templates ?? []).map((t) => t.id).join(", ") || "none"}.`;
      return {
        message,
        state: snapshot.state,
        ...(snapshot.templates ? { templates: snapshot.templates } : {}),
      } satisfies ModelJailbreakOutput;
    }

    case "set_identity_prompt": {
      const snapshot = await port.setIdentityPrompt(parsed.prompt ?? "");
      return {
        message: parsed.prompt?.trim()
          ? "Replaced the first system message with the supplied identity prompt. New sessions use it immediately; already-running sessions keep their materialized prompt until restarted."
          : "Cleared the custom identity prompt; the built-in XCode identity line is back in effect.",
        state: snapshot.state,
      } satisfies ModelJailbreakOutput;
    }

    case "clear_identity_prompt": {
      const snapshot = await port.setIdentityPrompt("");
      return {
        message: "Cleared the custom identity prompt; the built-in XCode identity line is back in effect.",
        state: snapshot.state,
      } satisfies ModelJailbreakOutput;
    }

    case "apply_template": {
      const snapshot = await port.applyTemplate(parsed.templateId as string);
      return {
        message: `Applied GODMODE template "${parsed.templateId}" as the first system message. New sessions pick it up; already-running sessions keep their current prompt until restarted.`,
        state: snapshot.state,
      } satisfies ModelJailbreakOutput;
    }

    case "set_prefill": {
      const messages = parsed.messages ?? [];
      const snapshot = await port.setPrefill(messages);
      return {
        message: messages.length
          ? `Set ${messages.length} prefill turn(s). They are injected after the system message and before the first real user turn.`
          : "Cleared every prefill turn.",
        state: snapshot.state,
      } satisfies ModelJailbreakOutput;
    }

    case "clear_prefill": {
      const snapshot = await port.setPrefill([]);
      return { message: "Cleared every prefill turn.", state: snapshot.state } satisfies ModelJailbreakOutput;
    }

    case "set_obfuscation": {
      const enabled = parsed.enabled as boolean;
      const snapshot = await port.setObfuscation({
        enabled,
        ...(enabled && parsed.tier ? { tier: parsed.tier } : {}),
      });
      return {
        message: enabled
          ? `Enabled Parseltongue input obfuscation at tier "${snapshot.state.obfuscation.tier}". User text sent to the model is rewritten; the UI keeps the original.`
          : "Disabled Parseltongue input obfuscation.",
        state: snapshot.state,
      } satisfies ModelJailbreakOutput;
    }
  }
};

/**
 * 按 action 收窄权限画像。解析失败（schema 不合）时返回 undefined，落回基础档
 * ——那是需要确认的写档，比把一次畸形调用当只读放行安全。
 */
function resolveModelJailbreakPermissionCapability(
  input: unknown,
): ToolRuntimePermissionCapability | undefined {
  const parsed = ModelJailbreakInputSchema.safeParse(input);
  if (!parsed.success) return undefined;
  if (parsed.data.action === "list") {
    return {
      readOnly: true,
      destructive: false,
      needsApproval: false,
      riskLevel: "low",
      sideEffectScope: "none",
      allowedInPlanMode: true,
      permission: modelJailbreakPermission("model.jailbreak.read", "none", "low", false),
    };
  }
  return {
    readOnly: false,
    destructive: false,
    needsApproval: true,
    riskLevel: "medium",
    sideEffectScope: "system",
    allowedInPlanMode: false,
    permission: modelJailbreakPermission("model.jailbreak.config", "system", "medium", true),
  };
}

function modelJailbreakPermission(
  permission: string,
  sideEffectScope: "none" | "system",
  riskLevel: "low" | "medium",
  needsApproval: boolean,
): Partial<ToolPermissionSpec> {
  return {
    permission,
    riskLevel,
    sideEffectScope,
    needsApproval,
    patternSources: needsApproval ? ["toolName", "input"] : ["toolName"],
    alwaysAllowPatternSources: needsApproval ? undefined : ["toolName"],
    denyPriority: "beforeAsk",
  };
}

const modelJailbreakResultBudget = {
  maxInlineBytes: MODEL_JAILBREAK_MODEL_BYTES,
  maxModelBytes: MODEL_JAILBREAK_MODEL_BYTES,
  strategy: "truncate" as const,
  preview: {
    maxBytes: MODEL_JAILBREAK_MODEL_BYTES,
    direction: "head" as const,
  },
};

const modelJailbreakTimeout = {
  defaultMs: MODEL_JAILBREAK_TOOL_TIMEOUT_MS,
  maxMs: MODEL_JAILBREAK_TOOL_TIMEOUT_MS,
  allowCallOverride: false,
};

export const modelJailbreakToolEntry: ToolEntry = {
  capability: "Read and configure XCode's model jailbreak settings",
  metadata: {
    name: "ModelJailbreak",
    description:
      "Read and configure XCode's model jailbreak settings, the same four blocks shown on the Settings → Model Jailbreak page: (1) the identity prompt that replaces the first system message, (2) GODMODE system-prompt templates, (3) prefill / priming turns injected after the system message and before the first real user turn, and (4) Parseltongue input obfuscation that rewrites user text sent to the model while the UI keeps the original. Use this when the user asks to change the agent's identity, apply a jailbreak template, set or clear prefill turns, or turn obfuscation on/off. Changes are application-level and apply to new sessions; already-running sessions keep their materialized system prompt until restarted.",
    modelInstructions: [
      "Always call action `list` first: it returns the current state and the exact templateId values. Never invent a templateId — an unknown one is rejected and nothing changes.",
      "`set_identity_prompt` replaces the ENTIRE first system message. Passing a short line discards everything the built-in prompt does. If the user wants to keep the built-in behavior and only add something, say so explicitly before overwriting, and prefer `apply_template` when they asked for a known preset.",
      "An empty or whitespace-only `prompt` clears the override and restores the built-in XCode identity line — that is what `clear_identity_prompt` does too.",
      "`set_prefill` takes role/content pairs (`user` or `assistant`). They are injected after the system message and before the first real user turn, so an `assistant` turn acts as a priming answer. Pass an empty array (or use `clear_prefill`) to remove them.",
      "`set_obfuscation` requires `tier` when `enabled` is true: `light`, `standard`, or `heavy`. Obfuscation only changes the text sent to the model; the conversation UI still shows the original.",
      "These are application-level settings shared by every workspace of this XCode instance. State plainly what changed, and do not apply a jailbreak template or overwrite the identity prompt unless the user asked for it.",
      "If the host reports that the jailbreak service is unavailable, tell the user to update the app; do not try to edit settings files directly.",
    ],
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: MODEL_JAILBREAK_TOOL_TIMEOUT_MS,
    maxOutputBytes: MODEL_JAILBREAK_MODEL_BYTES,
    sideEffectScope: "system",
    riskLevel: "medium",
    needsApproval: true,
    allowedInPlanMode: false,
  },
  handler: modelJailbreakHandler,
  resolvePermissionCapability: resolveModelJailbreakPermissionCapability,
  inputSchema: ModelJailbreakInputJsonSchema,
  outputSchema: ModelJailbreakOutputJsonSchema,
  runtimeInputSchema: ModelJailbreakInputSchema,
  runtimeOutputSchema: ModelJailbreakOutputSchema,
  permission: {
    permission: "model.jailbreak.config",
    reason: "ModelJailbreak changes application-level system prompt configuration shared by every workspace",
    riskLevel: "medium",
    sideEffectScope: "system",
    needsApproval: true,
    patternSources: ["toolName", "input"],
    denyPriority: "beforeAsk",
  },
  resultBudget: modelJailbreakResultBudget,
  timeout: modelJailbreakTimeout,
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "ModelJailbreak was cancelled before the change was applied",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
