// ============================================================
// Provider Account families - qoder / codebuddy / zai / bigmodel
// ============================================================
// 与 dispatch 拆开：四族的存取差异都在这里，dispatch 只做 action 路由。
// Qoder 的设备指纹补全是本文件最要紧的一段（见 importQoder）。

import {
  describeCodeBuddyAccessToken,
  listCodeBuddyAccounts,
  upsertCodeBuddyAccount,
  type CodeBuddyRegion,
} from "../model-provider/codebuddyAuth.js";
import {
  fetchQoderMachineIdentity,
  listQoderAccounts,
  upsertQoderAccount,
  type QoderAuthRegion,
} from "../model-provider/qoderAuth.js";
import { randomUUID } from "node:crypto";

import type {
  ProviderAccountFamily,
  ProviderAccountImportInput,
  ProviderAccountRegion,
  ProviderAccountSnapshot,
  ProviderAccountView,
} from "./providerAccountTypes.js";
import type { ProviderAccountStore } from "./providerAccountTypes.js";

export type { ProviderAccountStore } from "./providerAccountTypes.js";

export function requireRegion(
  family: ProviderAccountFamily,
  region: ProviderAccountRegion | undefined,
): ProviderAccountRegion {
  if (region) return region;
  throw new Error(`${family} requires region (cn or intl)`);
}

/** 从 JWT 里读 sub；非 JWT 返回 null。 */
export function readJwtSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const normalized = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const sub = payload.sub;
    return typeof sub === "string" && sub.trim() ? sub.trim() : null;
  } catch {
    return null;
  }
}

export async function listQoder(
  region: QoderAuthRegion,
): Promise<ProviderAccountSnapshot> {
  const { accounts } = await listQoderAccounts(region);
  return {
    family: "qoder",
    region,
    accounts: accounts.map(
      (account): ProviderAccountView => ({
        accountId: account.id,
        displayName: account.displayName,
        email: account.email ?? null,
        hasAccessToken: Boolean(account.accessToken),
        hasRefreshToken: Boolean(account.refreshToken),
        expiresAt: typeof account.expiresAt === "number" ? account.expiresAt : null,
        active: account.active,
      }),
    ),
  };
}

export async function listCodeBuddy(
  region: CodeBuddyRegion,
): Promise<ProviderAccountSnapshot> {
  const { accounts } = await listCodeBuddyAccounts(region);
  return {
    family: "codebuddy",
    region,
    accounts: accounts.map(
      (account): ProviderAccountView => ({
        accountId: account.id,
        displayName: account.displayName,
        email: account.email ?? null,
        hasAccessToken: Boolean(account.accessToken),
        hasRefreshToken: Boolean(account.refreshToken),
        expiresAt: typeof account.expiresAt === "number" ? account.expiresAt : null,
        active: account.active,
      }),
    ),
  };
}

/**
 * 导入 Qoder 账号。
 *
 * 设备身份分两层，别混：
 * 1. `machineId`（uuid）—— 请求签名用。`qoderProtocol.buildCosyHeaders` 里
 *    `Cosy-Machineid` / `Cosy-Machinetoken` 都直接取它，其余指纹由它确定性派生。
 *    **有它聊天链路就能跑**，凭据备份里通常都带。
 * 2. `machineToken`（官方铸造的 `P1gA...`）—— 只有 PRO 激活的 claim 接口校验它，
 *    本地自造会被判「不可领取」。只能从 mi-token 接口取。
 *
 * 因此导入策略：
 * - 调用方给了 machineId → 直接用它导入；三件套 best-effort 取，取不到只影响
 *   PRO 激活，不影响聊天（不再像早期实现那样因此整单失败）。
 * - 没给 machineId → 说明这份凭据确实缺设备身份，必须向 mi-token 取；取不到就
 *   中止，不存一个没有设备身份的账号。
 */
export async function importQoder(
  input: ProviderAccountImportInput,
): Promise<ProviderAccountSnapshot> {
  const region = requireRegion("qoder", input.region);
  const identity = input.identity?.trim() || readJwtSubject(input.accessToken);
  if (!identity) {
    throw new Error(
      "qoder import needs identity: the access token is not a JWT with a sub claim, so pass identity explicitly",
    );
  }
  const providedMachineId = input.machineId?.trim();
  // 三件套 best-effort：端点在第三方服务上，不可用时不该挡住聊天链路。
  const machine = await fetchQoderMachineIdentity(region).catch(() => null);
  if (!providedMachineId && !machine) {
    throw new Error(
      "qoder import could not obtain a device fingerprint: no machineId was supplied and the mi-token endpoint is unavailable. Pass machineId explicitly (the uuid the credential was issued with), or retry when the endpoint is reachable.",
    );
  }
  await upsertQoderAccount(region, {
    id: identity,
    displayName: input.displayName?.trim() || "Qoder 账号",
    ...(input.email ? { email: input.email } : {}),
    accessToken: input.accessToken,
    refreshToken: input.refreshToken ?? "",
    expiresAt: input.expiresAt ?? 0,
    machineId: providedMachineId || randomUUID(),
    ...(machine
      ? {
          machineToken: machine.machineToken,
          machineType: machine.machineType,
          machineCode: machine.machineCode,
        }
      : {}),
  });
  return listQoder(region);
}

export async function importCodeBuddy(
  input: ProviderAccountImportInput,
): Promise<ProviderAccountSnapshot> {
  const region = requireRegion("codebuddy", input.region);
  const described = describeCodeBuddyAccessToken(input.accessToken);
  const identity = input.identity?.trim() || described?.sub;
  if (!identity) {
    throw new Error(
      "codebuddy import needs identity: the access token is not a JWT with a sub claim, so pass identity explicitly",
    );
  }
  await upsertCodeBuddyAccount(region, {
    id: identity,
    displayName: input.displayName?.trim() || described?.displayName || undefined,
    email: input.email ?? described?.email ?? undefined,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken ?? "",
    expiresAt: input.expiresAt ?? 0,
  });
  return listCodeBuddy(region);
}

export async function listOauthFamily(
  store: ProviderAccountStore,
  family: "zai" | "bigmodel",
): Promise<ProviderAccountSnapshot> {
  const [accounts, activeRef] = await Promise.all([
    store.oauth.listAccounts(),
    store.oauth.loadActiveAccountRef(),
  ]);
  const mine = accounts.filter((account) => account.provider === family);
  const views: ProviderAccountView[] = [];
  for (const account of mine) {
    const accountRef = `${account.provider}:${account.identity}`;
    const tokenSet = await store.oauth.loadTokenSetForAccount(accountRef);
    views.push({
      accountId: accountRef,
      displayName: account.displayName || account.username,
      email: null,
      hasAccessToken: Boolean(tokenSet?.accessToken?.trim()),
      hasRefreshToken: Boolean(tokenSet?.refreshToken?.trim()),
      // OAuth token set 不存 expiresAt：到期由上游拒绝时触发刷新。
      expiresAt: null,
      active: accountRef === activeRef,
    });
  }
  return { family, region: null, accounts: views };
}

export async function importOauthFamily(
  store: ProviderAccountStore,
  family: "zai" | "bigmodel",
  input: ProviderAccountImportInput,
): Promise<ProviderAccountSnapshot> {
  const identity = input.identity?.trim() || readJwtSubject(input.accessToken);
  if (!identity) {
    throw new Error(
      `${family} import needs identity: pass the OAuth subject/user id explicitly when the access token is not a JWT`,
    );
  }
  const accountRef = `${family}:${identity}`;
  const accounts = await store.oauth.listAccounts();
  const entry = {
    provider: family,
    identity,
    username: input.email?.trim() || identity,
    displayName: input.displayName?.trim() || identity,
  };
  const exists = accounts.some(
    (account) => account.provider === family && account.identity === identity,
  );
  await store.oauth.saveAccounts(
    exists
      ? accounts.map((account) =>
          account.provider === family && account.identity === identity ? entry : account,
        )
      : [...accounts, entry],
  );
  await store.oauth.saveTokenSetForAccount(accountRef, {
    accessToken: input.accessToken,
    ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
  });
  await store.oauth.saveUserProfileForAccount(accountRef, {
    id: identity,
    username: entry.username,
    displayName: entry.displayName,
  });
  // 与设置页登录语义一致：仅在当前没有激活账号时自动激活。
  const activeRef = await store.oauth.loadActiveAccountRef();
  if (!activeRef) await store.oauth.activateAccount(accountRef);
  return listOauthFamily(store, family);
}

