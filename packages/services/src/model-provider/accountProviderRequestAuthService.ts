import type { RequestVerificationReason } from "@zcode/shared";
import { createHash } from "node:crypto";
import {
  BIGMODEL_PROVIDER_ID,
  type OAuthProviderId,
  type ProviderFamilyDomain,
  type ProjectAccessTokenMaterial,
  type ZCodeAccountAccess,
  type ZCodeProviderAccountAccess,
  ZAI_PROVIDER_ID,
} from "@zcode/shared";

export interface AccountRequestAuthMaterial {
  /** 私有传输字段兼容旧命名；套餐 OAuth 实际传入短期 Project Token。 */
  apiKey?: string;
  apiKeyId?: string;
  headers?: Record<string, string>;
  accountScope?: string;
  /** 账号轮询：本次选中的连接（账号）id。 */
  connectionId?: string;
  /** 账号轮询的失败换号策略；缺席 = 不换号（默认）。 */
  accountFailover?: { enabled: boolean; statusCodes: number[]; providerCodes?: string[] };
  /** 本次请求命中的账号显示名；「使用详情」按它区分多账号供应商。 */
  accountDisplayName?: string;
  /** 本次请求的出口代理池 id 与显示名；未绑定时缺席（跟随全局）。 */
  proxyPoolId?: string;
  proxyDisplayName?: string;
}

export interface AccountRequestAuthInput {
  providerId: string;
  modelId?: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
  expectedAccountScope?: string;
  rejectedProjectTokenFingerprint?: string;
  reason: RequestVerificationReason | "off-peak" | "usage";
  /**
   * 账号轮询选中的连接（账号），形如 `${provider}:${identity}`（与 oauthCredentialRepo 的
   * accountRefFromParts 同构）。**缺省表示「当前激活账号」**，即改造前的行为。
   *
   * 传入时，本服务会改用该账号自己的 OAuth 凭据与身份去解析材料，而不是读激活账号的镜像 key。
   */
  accountRef?: string;
  /**
   * 账号族的失败换号策略（由轮询服务随选号下发）。
   *
   * 账号族（zai / bigmodel）与 api-key 型供应商走不同分支：调用方这里拿到的是
   * `accountRef` 而不是完整 selection，所以策略必须显式透传；漏传会让 adapter
   * 永远收不到 `accountFailover`，UI 上的开关对账号族完全无效。
   */
  accountFailover?: { enabled: boolean; statusCodes: number[]; providerCodes?: string[] };
}

export interface AccountAccessIdentityInput {
  providerId: string;
  accountAccess: ZCodeProviderAccountAccess | ZCodeAccountAccess;
}

export class AccountRequestCredentialUnavailableError extends Error {
  constructor(readonly providerId: string) {
    super(`Account request credential is unavailable: ${providerId}`);
    this.name = "AccountRequestCredentialUnavailableError";
  }
}

export interface AccountRequestAuthResolver {
  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null>;
  resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial>;
  assertCurrent(input: AccountAccessIdentityInput): Promise<void>;
}

interface AccountProviderRequestAuthServiceOptions {
  resolveCurrentAccountAccess(
    access: ZCodeProviderAccountAccess,
    accountIdentity?: string,
  ): Promise<ZCodeAccountAccess | null>;
  loadOAuthTokenSet(
    providerId: OAuthProviderId,
    accountRef?: string,
  ): Promise<{
    accessToken?: string | null;
    zcodeJwtToken?: string | null;
    sessionRevision?: string | null;
    accountIdentity?: string;
    zcodeUserId?: string;
  } | null>;
  /** 账号显示名（user_info.displayName）；「使用详情」按它区分具体账号。缺省不填显示名。 */
  loadAccountDisplayName?(accountRef: string): Promise<string | null>;
  /** Start 只用共享 XCode JWT；不经过付费套餐的家族 token set。 */
  loadStartPlanXcodeJwt(family: ProviderFamilyDomain): Promise<string | null>;
  loadIndividualPlanMaterial(
    providerId: string,
    family: ProviderFamilyDomain,
    /** 该账号的 user_info.id；缺省时由实现方按「当前激活账号」解析。 */
    accountIdentity: string | undefined,
    rejectedProjectTokenFingerprint?: string,
  ): Promise<ProjectAccessTokenMaterial | null>;
  resolveTeamPlanMaterial(
    access: Extract<ZCodeAccountAccess, { planKind: "team-coding-plan" }>,
    rejectedProjectTokenFingerprint?: string,
  ): Promise<ProjectAccessTokenMaterial | null>;
}

class AccountProviderRequestAuthService implements AccountRequestAuthResolver {
  readonly #options: AccountProviderRequestAuthServiceOptions;

  constructor(options: AccountProviderRequestAuthServiceOptions) {
    this.#options = options;
  }

  resolveAccessCurrent(access: ZCodeProviderAccountAccess): Promise<ZCodeAccountAccess | null> {
    return this.#options.resolveCurrentAccountAccess(access);
  }

  async resolveCurrent(input: AccountRequestAuthInput): Promise<AccountRequestAuthMaterial> {
    const providerId = input.providerId.trim();
    const accountRef = input.accountRef?.trim() || undefined;
    const accountIdentity = accountIdentityFromRef(accountRef);
    const access = await this.#resolveAccess(input.accountAccess, accountIdentity);
    if (!access) throw new AccountRequestCredentialUnavailableError(providerId);

    // 「使用详情」要显示账号名而不是 accountRef；显示名读 per-account user_info，
    // 与凭据同源，读取失败不阻断鉴权（缺席时 UI 回退显示 accountRef）。
    const accountDisplayName = await (async () => {
      try {
        return (await this.#options.loadAccountDisplayName?.(accountRef ?? "")) || undefined;
      } catch {
        return undefined;
      }
    })();

    if (access.planKind === "start-plan") {
      const tokenSet = await this.#options.loadOAuthTokenSet(
        resolveOAuthProviderId(access.family),
        accountRef,
      );
      return {
        apiKey: requireApiKey(tokenSet?.zcodeJwtToken, providerId),
        ...(accountRef ? { connectionId: accountRef } : {}),
        ...(accountDisplayName ? { accountDisplayName } : {}),
        ...(input.accountFailover ? { accountFailover: input.accountFailover } : {}),
      };
    }

    const scoped = input.reason !== "usage" || input.expectedAccountScope !== undefined;
    if (input.rejectedProjectTokenFingerprint && !input.expectedAccountScope)
      throw new Error("project_token_scope_invalidated");
    const accountScope = scoped ? await this.#scope(access, accountRef) : undefined;
    if (input.expectedAccountScope !== undefined && input.expectedAccountScope !== accountScope)
      throw new Error("project_token_scope_invalidated");
    const material =
      access.planKind === "individual-coding-plan"
        ? await this.#options.loadIndividualPlanMaterial(
            providerId,
            access.family,
            accountIdentity,
            input.rejectedProjectTokenFingerprint,
          )
        : await this.#options.resolveTeamPlanMaterial(
            access,
            input.rejectedProjectTokenFingerprint,
          );
    if (scoped) {
      // 换证 IO 前后校验原请求身份，避免 401 重试或闲时票据串用新账号/项目。
      const latest = await this.#resolveAccess(input.accountAccess, accountIdentity);
      if (!latest || accountScope !== (await this.#scope(latest, accountRef)))
        throw new Error("project_token_scope_invalidated");
    }
    return {
      apiKey: requireApiKey(material?.token, providerId),
      apiKeyId: material?.apiKeyId,
      ...(accountScope ? { accountScope } : {}),
      ...(accountRef ? { connectionId: accountRef } : {}),
      ...(accountDisplayName ? { accountDisplayName } : {}),
      ...(input.accountFailover ? { accountFailover: input.accountFailover } : {}),
    };
  }

  async #scope(access: ZCodeAccountAccess, accountRef?: string): Promise<string> {
    const login = await this.#options.loadOAuthTokenSet(
      resolveOAuthProviderId(access.family),
      accountRef,
    );
    if (!login?.accessToken?.trim())
      throw new AccountRequestCredentialUnavailableError(access.family);
    return createHash("sha256")
      .update(
        JSON.stringify([
          access.family,
          access.planKind,
          access.planKind === "team-coding-plan"
            ? [access.organizationId, access.projectId, access.productId]
            : null,
          login.accessToken.trim(),
          login.zcodeJwtToken?.trim() ?? null,
          login.sessionRevision ?? null,
          login.accountIdentity ?? null,
          login.zcodeUserId ?? null,
        ]),
      )
      .digest("hex");
  }

  async assertCurrent(input: AccountAccessIdentityInput): Promise<void> {
    if (!(await this.#resolveAccess(input.accountAccess))) {
      throw new AccountRequestCredentialUnavailableError(input.providerId);
    }
  }

  #resolveAccess(
    access: ZCodeProviderAccountAccess | ZCodeAccountAccess,
    accountIdentity?: string,
  ): Promise<ZCodeAccountAccess | null> {
    return "mode" in access
      ? this.#options.resolveCurrentAccountAccess(access, accountIdentity)
      : Promise.resolve(access);
  }
}

/**
 * 从 accountRef（`${provider}:${identity}`）取出 identity。
 *
 * 与 oauthCredentialRepo 的 accountRefFromParts/accountRefProvider 同构：只切第一个冒号，
 * identity 自身含冒号也能完整还原。不是 accountRef 形状时返回 undefined，调用方回落到
 * 「当前激活账号」。
 */
function accountIdentityFromRef(accountRef: string | undefined): string | undefined {
  if (!accountRef) {
    return undefined;
  }
  const separator = accountRef.indexOf(":");
  if (separator <= 0 || separator === accountRef.length - 1) {
    return undefined;
  }
  return accountRef.slice(separator + 1);
}

function resolveOAuthProviderId(family: ProviderFamilyDomain): OAuthProviderId {
  return family === "zai" ? ZAI_PROVIDER_ID : BIGMODEL_PROVIDER_ID;
}

function requireApiKey(value: string | null | undefined, providerId: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new AccountRequestCredentialUnavailableError(providerId);
  }
  return normalized;
}

export function createAccountProviderRequestAuthService(
  options: AccountProviderRequestAuthServiceOptions,
): AccountProviderRequestAuthService {
  return new AccountProviderRequestAuthService(options);
}
