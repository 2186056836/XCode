// ============================================================
// Provider Account host dispatch
// ============================================================
// 与 dispatchProxyPoolRequest / dispatchModelJailbreakRequest 同族：providerAccount/*
// 的唯一 host 侧映射。四族的存取差异在 providerAccountFamilies.ts。
//
// 安全：所有返回值都经过脱敏视图，token 原文永不出现在 dispatch 结果里。

import {
  removeCodeBuddyAccount,
  switchCodeBuddyAccount,
} from "../model-provider/codebuddyAuth.js";
import {
  removeQoderAccount,
  switchQoderAccount,
} from "../model-provider/qoderAuth.js";
import {
  requireRegion,
  importCodeBuddy,
  importOauthFamily,
  importQoder,
  listCodeBuddy,
  listOauthFamily,
  listQoder,
} from "./providerAccountFamilies.js";
import type {
  ProviderAccountFamily,
  ProviderAccountImportInput,
  ProviderAccountRegion,
  ProviderAccountSnapshot,
  ProviderAccountStore,
} from "./providerAccountTypes.js";

export type { ProviderAccountStore } from "./providerAccountTypes.js";

export type ProviderAccountDispatchResult =
  | { ok: true; snapshot: ProviderAccountSnapshot }
  | { ok: false; message: string; data?: unknown };

function isOauthFamily(family: ProviderAccountFamily): family is "zai" | "bigmodel" {
  return family === "zai" || family === "bigmodel";
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export async function dispatchProviderAccountRequest(
  store: ProviderAccountStore,
  request: { method: string; params?: unknown },
): Promise<ProviderAccountDispatchResult> {
  const fail = (message: string, data?: unknown): ProviderAccountDispatchResult => ({
    ok: false,
    message,
    ...(data === undefined ? {} : { data }),
  });

  const params = (request.params ?? {}) as Record<string, unknown>;
  const family = params.family as ProviderAccountFamily | undefined;
  if (!family) return fail("providerAccount request requires family");
  const region = params.region as ProviderAccountRegion | undefined;
  const action = params.action as string | undefined;

  try {
    switch (action) {
      case "list": {
        if (isOauthFamily(family)) {
          return { ok: true, snapshot: await listOauthFamily(store, family) };
        }
        const resolved = requireRegion(family, region);
        return {
          ok: true,
          snapshot:
            family === "qoder"
              ? await listQoder(resolved)
              : await listCodeBuddy(resolved),
        };
      }

      case "import": {
        const input: ProviderAccountImportInput = {
          family,
          ...(region ? { region } : {}),
          accessToken: String(params.accessToken ?? ""),
          ...(typeof params.refreshToken === "string"
            ? { refreshToken: params.refreshToken }
            : {}),
          ...(typeof params.expiresAt === "number" ? { expiresAt: params.expiresAt } : {}),
          ...(typeof params.machineId === "string" ? { machineId: params.machineId } : {}),
          ...(typeof params.identity === "string" ? { identity: params.identity } : {}),
          ...(typeof params.displayName === "string"
            ? { displayName: params.displayName }
            : {}),
          ...(typeof params.email === "string" ? { email: params.email } : {}),
        };
        if (!input.accessToken.trim()) return fail("import requires accessToken");
        if (isOauthFamily(family)) {
          return { ok: true, snapshot: await importOauthFamily(store, family, input) };
        }
        return {
          ok: true,
          snapshot:
            family === "qoder"
              ? await importQoder(input)
              : await importCodeBuddy(input),
        };
      }

      case "remove": {
        const accountId = String(params.accountId ?? "");
        if (!accountId) return fail("remove requires accountId");
        if (isOauthFamily(family)) {
          await store.oauth.clearAccount(accountId);
          return { ok: true, snapshot: await listOauthFamily(store, family) };
        }
        const resolved = requireRegion(family, region);
        if (family === "qoder") {
          await removeQoderAccount(resolved, accountId);
          return { ok: true, snapshot: await listQoder(resolved) };
        }
        await removeCodeBuddyAccount(resolved, accountId);
        return { ok: true, snapshot: await listCodeBuddy(resolved) };
      }

      case "activate": {
        const accountId = String(params.accountId ?? "");
        if (!accountId) return fail("activate requires accountId");
        if (isOauthFamily(family)) {
          await store.oauth.activateAccount(accountId);
          return { ok: true, snapshot: await listOauthFamily(store, family) };
        }
        const resolved = requireRegion(family, region);
        if (family === "qoder") {
          const switched = await switchQoderAccount(resolved, accountId);
          if (!switched) return fail(`qoder account not found: ${accountId}`);
          return { ok: true, snapshot: await listQoder(resolved) };
        }
        const switched = await switchCodeBuddyAccount(resolved, accountId);
        if (!switched) return fail(`codebuddy account not found: ${accountId}`);
        return { ok: true, snapshot: await listCodeBuddy(resolved) };
      }

      case "refresh": {
        const accountId = String(params.accountId ?? "");
        if (!accountId) return fail("refresh requires accountId");
        if (isOauthFamily(family)) {
          return fail(`${family} refreshes its OAuth token on demand; no manual refresh needed`);
        }
        const resolved = requireRegion(family, region);
        if (family === "qoder") {
          if (!store.refreshQoder) return fail("qoder refresh is unavailable on this host");
          const ok = await store.refreshQoder(resolved, accountId);
          if (!ok) return fail(`qoder token refresh failed for ${accountId}`);
          return { ok: true, snapshot: await listQoder(resolved) };
        }
        if (!store.refreshCodeBuddy) {
          return fail("codebuddy refresh is unavailable on this host");
        }
        const ok = await store.refreshCodeBuddy(resolved, accountId);
        if (!ok) return fail(`codebuddy token refresh failed for ${accountId}`);
        return { ok: true, snapshot: await listCodeBuddy(resolved) };
      }

      default:
        return fail(`unknown providerAccount action: ${String(action)}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** 供 host 注册表判断：哪些协议方法归本 dispatch 管。 */
export const PROVIDER_ACCOUNT_METHOD = "providerAccount/manage";
