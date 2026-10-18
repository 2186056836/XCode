// ============================================================
// Proxy Pool Tool Handler
// ============================================================
// 单工具 + action 枚举：把设置页「代理池配置 / 代理出口」那套配置面原样交给模型。
//
// 权限画像按 action 分档（与 bash 的 resolvePermissionCapability 同款机制）：
// - list   只读，无副作用，计划模式放行；
// - test   只读但会发一个真实出网请求（探测出口 IP），按 WebFetch 同档要确认；
// - 其余   改的是应用级配置（agent 全局可见，不属于任何一个 workspace），一律要确认。
// 基础 metadata 取最严的那一档，resolvePermissionCapability 只能收紧到 list/test。

import {
  CoreErrorType,
  createCoreError,
  ProxyPoolInputJsonSchema,
  ProxyPoolInputSchema,
  ProxyPoolOutputJsonSchema,
  ProxyPoolOutputSchema,
  type ProxyPoolInput,
  type ProxyPoolOutput,
  type ToolPermissionSpec,
} from "@zcode/contracts";
import type {
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolRuntimePermissionCapability,
} from "../types.js";

const PROXY_POOL_TOOL_TIMEOUT_MS = 30_000;
const PROXY_POOL_MODEL_BYTES = 32_000;

function assertProxyPoolPort(
  context: ToolExecutionContext,
): asserts context is ToolExecutionContext & {
  proxyPoolPort: NonNullable<ToolExecutionContext["proxyPoolPort"]>;
} {
  if (context.proxyPoolPort) return;
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    "ProxyPoolPort is not configured for ProxyPool",
    {
      context: {
        toolCallId: context.toolCallId,
        toolName: "ProxyPool",
      },
      recoverable: false,
    },
  );
}

export const proxyPoolHandler: ToolHandler = async (input, context) => {
  const parsed = ProxyPoolInputSchema.parse(input) as ProxyPoolInput;
  assertProxyPoolPort(context);
  const port = context.proxyPoolPort;

  // 每个 action 都回当前全量池与供应商摘要：改完立刻看到真值，不需要模型再读一次。
  const collect = async (): Promise<Pick<ProxyPoolOutput, "pools" | "providers" | "provider">> => {
    const catalog = await port.listCatalog();
    const provider = parsed.providerId
      ? await port.getProvider(parsed.providerId).catch(() => undefined)
      : undefined;
    return {
      pools: catalog.pools,
      providers: catalog.providers,
      ...(provider ? { provider } : {}),
    };
  };

  switch (parsed.action) {
    case "list": {
      const snapshot = await collect();
      const message =
        `Read ${snapshot.pools.length} proxy pool(s) and ${snapshot.providers.length} provider(s). ` +
        `Bindings are per connection: a bound connection exits through its pool and ignores the global proxy; ` +
        `an unbound connection follows the global proxy state.`;
      return { message, ...snapshot } satisfies ProxyPoolOutput;
    }

    case "save": {
      // refine 已保证 poolName / proxyUrl 在场；这里再收窄一次类型。
      if (!parsed.poolName || !parsed.proxyUrl) {
        throw createCoreError(CoreErrorType.ConfigurationError, "`save` requires poolName and proxyUrl", {
          context: { toolCallId: context.toolCallId, toolName: "ProxyPool" },
          recoverable: false,
        });
      }
      const created = !parsed.poolId;
      await port.save({
        ...(parsed.poolId ? { poolId: parsed.poolId } : {}),
        name: parsed.poolName,
        proxyUrl: parsed.proxyUrl,
        ...(parsed.noProxy === undefined ? {} : { noProxy: parsed.noProxy }),
        ...(parsed.isActive === undefined ? {} : { isActive: parsed.isActive }),
        ...(parsed.strictProxy === undefined ? {} : { strictProxy: parsed.strictProxy }),
      });
      const snapshot = await collect();
      const message = created
        ? `Created proxy pool "${parsed.poolName}" (${parsed.proxyUrl}).`
        : `Updated proxy pool ${parsed.poolId}.`;
      return { message, ...snapshot } satisfies ProxyPoolOutput;
    }

    case "delete": {
      await port.remove(parsed.poolId as string);
      const snapshot = await collect();
      return {
        message: `Deleted proxy pool ${parsed.poolId}. Every connection bound to it now follows the global proxy state again.`,
        ...snapshot,
      } satisfies ProxyPoolOutput;
    }

    case "set_active": {
      await port.setActive(parsed.poolId as string, parsed.isActive as boolean);
      const snapshot = await collect();
      return {
        message: parsed.isActive
          ? `Enabled proxy pool ${parsed.poolId}. Connections bound to it exit through it again.`
          : `Disabled proxy pool ${parsed.poolId}. Connections still bound to it now use a direct connection — never the global proxy.`,
        ...snapshot,
      } satisfies ProxyPoolOutput;
    }

    case "test": {
      const test = await port.test({
        ...(parsed.poolId ? { poolId: parsed.poolId } : {}),
        ...(parsed.proxyUrl ? { proxyUrl: parsed.proxyUrl } : {}),
        ...(parsed.testUrl ? { testUrl: parsed.testUrl } : {}),
      });
      const snapshot = await collect();
      const target = parsed.poolId ?? parsed.proxyUrl;
      const message = test.ok
        ? `Proxy ${target} is reachable${test.exitIp ? ` and exits at ${test.exitIp}` : ""}${typeof test.elapsedMs === "number" ? ` (${test.elapsedMs} ms)` : ""}.`
        : `Proxy ${target} failed: ${test.error ?? "unknown error"}.`;
      return { message, ...snapshot, test } satisfies ProxyPoolOutput;
    }

    case "bind_account": {
      const provider = await port.bindAccount({
        providerId: parsed.providerId as string,
        accountId: parsed.accountId as string,
        poolId: parsed.poolId as string,
      });
      const catalog = await port.listCatalog();
      return {
        message: `Bound account ${parsed.accountId} to proxy pool ${parsed.poolId}. Its requests now exit through that pool and no longer use the global proxy.`,
        pools: catalog.pools,
        providers: catalog.providers,
        provider,
      } satisfies ProxyPoolOutput;
    }

    case "unbind_account": {
      const provider = await port.bindAccount({
        providerId: parsed.providerId as string,
        accountId: parsed.accountId as string,
        poolId: null,
      });
      const catalog = await port.listCatalog();
      return {
        message: `Unbound account ${parsed.accountId}. Its exit now follows the XCode global proxy state.`,
        pools: catalog.pools,
        providers: catalog.providers,
        provider,
      } satisfies ProxyPoolOutput;
    }

    case "apply_to_all": {
      const provider = await port.applyToAll({
        providerId: parsed.providerId as string,
        poolId: parsed.poolId as string,
      });
      const catalog = await port.listCatalog();
      return {
        message: `Applied proxy pool ${parsed.poolId} to every account of ${parsed.providerId}.`,
        pools: catalog.pools,
        providers: catalog.providers,
        provider,
      } satisfies ProxyPoolOutput;
    }

    case "clear_all": {
      const provider = await port.applyToAll({
        providerId: parsed.providerId as string,
        poolId: null,
      });
      const catalog = await port.listCatalog();
      return {
        message: `Cleared every account binding of ${parsed.providerId}; all of its accounts now follow the global proxy state.`,
        pools: catalog.pools,
        providers: catalog.providers,
        provider,
      } satisfies ProxyPoolOutput;
    }

    case "distribute": {
      const provider = await port.distribute({
        providerId: parsed.providerId as string,
        // 空数组 = 由 host 取当前全部启用的池，按列表顺序。
        poolIds: parsed.poolIds ?? [],
      });
      const catalog = await port.listCatalog();
      return {
        message: `Distributed proxy pools across the accounts of ${parsed.providerId}; each account keeps one fixed pool (rotation happens per account, not per request).`,
        pools: catalog.pools,
        providers: catalog.providers,
        provider,
      } satisfies ProxyPoolOutput;
    }
  }
};

/**
 * 按 action 收窄权限画像。解析失败（schema 不合）时返回 undefined，落回基础档
 * ——那是需要确认的写档，比把一次畸形调用当只读放行安全。
 */
function resolveProxyPoolPermissionCapability(
  input: unknown,
): ToolRuntimePermissionCapability | undefined {
  const parsed = ProxyPoolInputSchema.safeParse(input);
  if (!parsed.success) return undefined;
  if (parsed.data.action === "list") {
    return {
      readOnly: true,
      destructive: false,
      needsApproval: false,
      riskLevel: "low",
      sideEffectScope: "none",
      allowedInPlanMode: true,
      permission: proxyPoolPermission("proxy.pool.read", "none", "low", false),
    };
  }
  if (parsed.data.action === "test") {
    // 只读视图，但会真的发一个出网请求去回显出口 IP——与 WebFetch 同档。
    return {
      readOnly: true,
      destructive: false,
      needsApproval: true,
      riskLevel: "medium",
      sideEffectScope: "network",
      allowedInPlanMode: true,
      permission: proxyPoolPermission("proxy.pool.test", "network", "medium", true),
    };
  }
  return {
    readOnly: false,
    destructive: parsed.data.action === "delete",
    needsApproval: true,
    riskLevel: "medium",
    sideEffectScope: "system",
    allowedInPlanMode: false,
    permission: proxyPoolPermission("proxy.pool.config", "system", "medium", true),
  };
}

function proxyPoolPermission(
  permission: string,
  sideEffectScope: "none" | "network" | "system",
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

const proxyPoolResultBudget = {
  maxInlineBytes: PROXY_POOL_MODEL_BYTES,
  maxModelBytes: PROXY_POOL_MODEL_BYTES,
  strategy: "truncate" as const,
  preview: {
    maxBytes: PROXY_POOL_MODEL_BYTES,
    direction: "head" as const,
  },
};

const proxyPoolTimeout = {
  defaultMs: PROXY_POOL_TOOL_TIMEOUT_MS,
  maxMs: PROXY_POOL_TOOL_TIMEOUT_MS,
  allowCallOverride: false,
};

export const proxyPoolToolEntry: ToolEntry = {
  capability: "Read and configure XCode proxy pools and per-connection proxy bindings",
  metadata: {
    name: "ProxyPool",
    description:
      "Read and configure XCode's proxy pools and the proxy binding of each provider connection (account). A pool is a named proxy URL (http/https/socks4/socks5, with optional bypass rules and strict mode). A binding is per connection, never per provider: a connection bound to a pool sends its provider traffic (sign-in, model requests, check-ins) through that pool and stops using XCode's global proxy entirely; an unbound connection follows the global proxy state; a connection bound to a disabled or invalid pool uses a direct connection and never falls back to the global proxy. Use this when the user asks to add/edit/enable/disable/test a proxy pool, to assign pools to accounts, to distribute pools across accounts, or to explain why some account's traffic ignores the global proxy. Settings UI shows the same state; changes take effect on the next request, no restart.",
    modelInstructions: [
      "Always resolve ids from the tool itself: call action `list` first to get poolId values, and pass providerId to get that provider's accountId values. Never invent a poolId or accountId — an unknown poolId silently creates a new pool in `save`, and a wrong accountId binds nothing that will ever be used.",
      "providerId must be the canonical prefixed form returned by `list` (for example `other:qoder`, `other:qoder-cn`, `other:codebuddy`, `other:codebuddy-cn`). `other:qoder` and `other:qoder-cn` are two independent account tables — bind in the same region you read the account from.",
      "Only providers whose summary reports supportsConnections=true have accounts (Qoder and CodeBuddy). For every other provider there is no account and therefore no proxy-pool binding; the global proxy applies.",
      "The three connection states are exhaustive and must be described the same way in Chinese as the UI: 绑定某池 = 该连接独占该池出口且不再走全局代理; 未绑定 = 跟随 XCode 全局代理状态; 绑定但池被停用/地址无效 = 硬直连，绝不回落全局代理.",
      "`distribute` assigns one fixed pool per account by cycling through the given pool ids — that is what rotation means here. It is not a per-request proxy switch; do not describe it as one.",
      "Prefer `test` after saving a new pool, and report back the returned exit IP: it is the only way to confirm traffic really leaves through that pool. If test fails, tell the user the pool is unreachable instead of retrying with different parameters.",
      "Writes change application-level configuration that affects every workspace of this XCode instance, so state plainly what changed. Do not create pools or reassign bindings unless the user asked for it, and never embed credentials in your reply beyond the proxy URL the user themselves supplied.",
      "A bundled skill named `xcode-proxy-pool` carries the full action table, the validation error codes and the common pitfalls of this config surface. Load it with the Skill tool when the user asks for an explanation or wants a multi-step change — do not guess ids or file paths from memory.",
      "If the host reports that the proxy pool service is unavailable, tell the user to update the app; do not try to edit settings files directly.",
    ],
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: PROXY_POOL_TOOL_TIMEOUT_MS,
    maxOutputBytes: PROXY_POOL_MODEL_BYTES,
    sideEffectScope: "system",
    riskLevel: "medium",
    needsApproval: true,
    allowedInPlanMode: false,
  },
  handler: proxyPoolHandler,
  resolvePermissionCapability: resolveProxyPoolPermissionCapability,
  inputSchema: ProxyPoolInputJsonSchema,
  outputSchema: ProxyPoolOutputJsonSchema,
  runtimeInputSchema: ProxyPoolInputSchema,
  runtimeOutputSchema: ProxyPoolOutputSchema,
  permission: {
    permission: "proxy.pool.config",
    reason: "ProxyPool changes application-level proxy configuration shared by every workspace",
    riskLevel: "medium",
    sideEffectScope: "system",
    needsApproval: true,
    patternSources: ["toolName", "input"],
    denyPriority: "beforeAsk",
  },
  resultBudget: proxyPoolResultBudget,
  timeout: proxyPoolTimeout,
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "ProxyPool was cancelled before the change was applied",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
