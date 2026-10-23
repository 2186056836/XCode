// ============================================================
// Provider Account Tool Handler
// ============================================================
// 单工具 + action 枚举：把账号凭据导入/管理交给模型。
//
// 权限画像按 action 分档：
// - list 只读，无副作用，计划模式放行；
// - 其余写账号表（可能覆盖已有凭据），一律要确认。
//
// 凭据安全：handler 只把 ProviderAccountView 拼进输出，端口契约本身就不返回
// token 原文；这里额外在 message 里只提数量与账号 id，不回显任何令牌。

import {
  CoreErrorType,
  ProviderAccountInputJsonSchema,
  ProviderAccountInputSchema,
  ProviderAccountOutputJsonSchema,
  ProviderAccountOutputSchema,
  createCoreError,
  type ProviderAccountInput,
  type ProviderAccountOutput,
  type ProviderAccountSnapshot,
  type ToolPermissionSpec,
} from "@zcode/contracts";
import type {
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolRuntimePermissionCapability,
} from "../types.js";

const PROVIDER_ACCOUNT_TOOL_TIMEOUT_MS = 60_000;
const PROVIDER_ACCOUNT_MODEL_BYTES = 64_000;

function assertProviderAccountPort(
  context: ToolExecutionContext,
): asserts context is ToolExecutionContext & {
  providerAccountPort: NonNullable<ToolExecutionContext["providerAccountPort"]>;
} {
  if (context.providerAccountPort) return;
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    "ProviderAccountPort is not configured for ProviderAccount",
    {
      context: { toolCallId: context.toolCallId, toolName: "ProviderAccount" },
      recoverable: false,
    },
  );
}

function toOutput(
  snapshot: ProviderAccountSnapshot,
  message: string,
): ProviderAccountOutput {
  return {
    message,
    family: snapshot.family,
    region: snapshot.region,
    accounts: snapshot.accounts,
  } satisfies ProviderAccountOutput;
}

function describeAccounts(snapshot: ProviderAccountSnapshot): string {
  if (snapshot.accounts.length === 0) return "no accounts";
  return snapshot.accounts
    .map((account) => `${account.accountId}${account.active ? " (active)" : ""}`)
    .join(", ");
}

export const providerAccountHandler: ToolHandler = async (input, context) => {
  const parsed = ProviderAccountInputSchema.parse(input) as ProviderAccountInput;
  assertProviderAccountPort(context);
  const port = context.providerAccountPort;
  const target = {
    family: parsed.family,
    ...(parsed.region ? { region: parsed.region } : {}),
  };

  switch (parsed.action) {
    case "list": {
      const snapshot = await port.list(target);
      return toOutput(
        snapshot,
        `Read ${snapshot.accounts.length} account(s) for ${parsed.family}${snapshot.region ? ` (${snapshot.region})` : ""}: ${describeAccounts(snapshot)}. Tokens are never returned by this tool.`,
      );
    }

    case "import": {
      const snapshot = await port.import({
        family: parsed.family,
        ...(parsed.region ? { region: parsed.region } : {}),
        accessToken: parsed.accessToken as string,
        ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}),
        ...(parsed.expiresAt !== undefined ? { expiresAt: parsed.expiresAt } : {}),
        ...(parsed.machineId ? { machineId: parsed.machineId } : {}),
        ...(parsed.identity ? { identity: parsed.identity } : {}),
        ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
      });
      return toOutput(
        snapshot,
        `Imported a credential for ${parsed.family}${snapshot.region ? ` (${snapshot.region})` : ""}. The account table now holds ${snapshot.accounts.length} account(s): ${describeAccounts(snapshot)}.`,
      );
    }

    case "remove": {
      const snapshot = await port.remove({ ...target, accountId: parsed.accountId as string });
      return toOutput(
        snapshot,
        `Removed account "${parsed.accountId}" from ${parsed.family}. ${snapshot.accounts.length} account(s) remain: ${describeAccounts(snapshot)}.`,
      );
    }

    case "activate": {
      const snapshot = await port.activate({ ...target, accountId: parsed.accountId as string });
      return toOutput(
        snapshot,
        `Activated account "${parsed.accountId}" for ${parsed.family}.`,
      );
    }

    case "refresh": {
      const snapshot = await port.refresh({ ...target, accountId: parsed.accountId as string });
      return toOutput(
        snapshot,
        `Refreshed the access token for account "${parsed.accountId}" in ${parsed.family}.`,
      );
    }
  }
};

/** 按 action 收窄权限画像；schema 不合时落回写档（比误放行安全）。 */
function resolveProviderAccountPermissionCapability(
  input: unknown,
): ToolRuntimePermissionCapability | undefined {
  const parsed = ProviderAccountInputSchema.safeParse(input);
  if (!parsed.success) return undefined;
  if (parsed.data.action === "list") {
    return {
      readOnly: true,
      destructive: false,
      needsApproval: false,
      riskLevel: "low",
      sideEffectScope: "none",
      allowedInPlanMode: true,
      permission: providerAccountPermission("provider.account.read", "none", "low", false),
    };
  }
  return {
    readOnly: false,
    destructive: parsed.data.action === "remove",
    needsApproval: true,
    riskLevel: "medium",
    sideEffectScope: "system",
    allowedInPlanMode: false,
    permission: providerAccountPermission("provider.account.write", "system", "medium", true),
  };
}

function providerAccountPermission(
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

const providerAccountResultBudget = {
  maxInlineBytes: PROVIDER_ACCOUNT_MODEL_BYTES,
  maxModelBytes: PROVIDER_ACCOUNT_MODEL_BYTES,
  strategy: "truncate" as const,
  preview: { maxBytes: PROVIDER_ACCOUNT_MODEL_BYTES, direction: "head" as const },
};

const providerAccountTimeout = {
  defaultMs: PROVIDER_ACCOUNT_TOOL_TIMEOUT_MS,
  maxMs: PROVIDER_ACCOUNT_TOOL_TIMEOUT_MS,
  allowCallOverride: false,
};

export const providerAccountToolEntry: ToolEntry = {
  capability: "Import and manage provider account credentials",
  metadata: {
    name: "ProviderAccount",
    description:
      "Import and manage account credentials for XCode's built-in account families: `qoder` and `codebuddy` (login-based, separate CN/Intl tables) and `zai` / `bigmodel` (Coding Plan OAuth accounts keyed by accountRef). Use this to bulk-import access tokens the user already has (for example exported from another client), list which accounts exist, switch the active account, remove one, or force a token refresh. Credential values are write-only: this tool never returns an access or refresh token, only masked account views.",
    modelInstructions: [
      "Always call action `list` first to see the exact accountId values and whether a token is already present. Never invent an accountId.",
      "`import` is upsert-by-identity: importing the same identity again replaces that account's tokens instead of creating a duplicate. Pass `identity` explicitly for zai/bigmodel (it becomes part of accountRef); for qoder/codebuddy it defaults to the JWT subject when the token is a JWT.",
      "`region` is mandatory for `qoder` and `codebuddy` — they keep separate CN and Intl account tables, and the same token is only valid in the region it was issued for. Omit it for `zai` / `bigmodel`.",
      "Always pass `refreshToken` when the user has one. Without it the account cannot self-refresh and will need a fresh import once the access token expires.",
      "Never echo a token back to the user, and never write tokens into a file or a shell command. This tool is the only supported write path.",
      "`remove` is destructive: confirm the accountId with the user before calling it, unless they named the exact account to delete.",
      "Changes apply to the running app immediately; already-created sessions keep using the credential they were started with until the next request.",
    ],
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: PROVIDER_ACCOUNT_TOOL_TIMEOUT_MS,
    maxOutputBytes: PROVIDER_ACCOUNT_MODEL_BYTES,
    sideEffectScope: "system",
    riskLevel: "medium",
    needsApproval: true,
    allowedInPlanMode: false,
  },
  handler: providerAccountHandler,
  resolvePermissionCapability: resolveProviderAccountPermissionCapability,
  inputSchema: ProviderAccountInputJsonSchema,
  outputSchema: ProviderAccountOutputJsonSchema,
  runtimeInputSchema: ProviderAccountInputSchema,
  runtimeOutputSchema: ProviderAccountOutputSchema,
  permission: {
    permission: "provider.account.write",
    reason:
      "ProviderAccount writes provider credentials shared by every workspace of this XCode instance",
    riskLevel: "medium",
    sideEffectScope: "system",
    needsApproval: true,
    patternSources: ["toolName", "input"],
    denyPriority: "beforeAsk",
  },
  resultBudget: providerAccountResultBudget,
  timeout: providerAccountTimeout,
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "ProviderAccount was cancelled before the credential change was applied",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
