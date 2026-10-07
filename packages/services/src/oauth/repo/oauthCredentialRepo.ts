/* eslint-disable max-lines -- OAuth 凭据仓储集中维护 ZAI/BigModel 登录镜像 key 边界，拆分会让鉴权事实源更难追踪。 */
import { Buffer } from "node:buffer";
import type {
  OAuthLoginAttribution,
  OAuthProviderId,
  OAuthTokenSet,
  OAuthUserProfile,
} from "@zcode/shared";
import { BIGMODEL_PROVIDER_ID, isCredentialDecryptError, ZAI_PROVIDER_ID } from "@zcode/shared";
import type { ICredentialService } from "../../credential/credential.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";

const ACTIVE_PROVIDER_KEY = "oauth:active_provider";
const ACTIVE_ACCOUNT_KEY = "oauth:active_account";
const ACCOUNT_LIST_KEY = "oauth:account_list";
const LOGIN_ATTRIBUTION_KEY = "oauth:login_attribution";
const XCODE_JWT_TOKEN_KEY = "zcodejwttoken";
const KNOWN_OAUTH_PROVIDER_IDS = [BIGMODEL_PROVIDER_ID, ZAI_PROVIDER_ID] as const;
const log = createServiceLogger("oauthCredentialRepo");

/** 账号引用：`{provider}:{identity}`。identity 用于 per-account 凭证命名空间，需可安全进 key。 */
function encodeIdentity(identity: string): string {
  return encodeURIComponent(identity);
}

function accountRefFromParts(provider: OAuthProviderId, identity: string): string {
  return `${provider}:${identity}`;
}

function accountRefProvider(accountRef: string): OAuthProviderId | null {
  const sep = accountRef.indexOf(":");
  if (sep <= 0) return null;
  const provider = accountRef.slice(0, sep);
  return provider === ZAI_PROVIDER_ID || provider === BIGMODEL_PROVIDER_ID ? provider : null;
}

function accountAccessTokenKey(accountRef: string): string {
  return `oauth:account:${accountRef}:access_token`;
}

function accountRefreshTokenKey(accountRef: string): string {
  return `oauth:account:${accountRef}:refresh_token`;
}

function accountUserInfoKey(accountRef: string): string {
  return `oauth:account:${accountRef}:user_info`;
}

function accountZcodeJwtKey(accountRef: string): string {
  return `zcodejwt:${accountRef}`;
}

function accountRefFromProviderProfile(provider: OAuthProviderId, identity: string): string {
  return accountRefFromParts(provider, identity);
}

interface OAuthCredentialRepoOptions {
  providerIds?: readonly OAuthProviderId[];
  onCorruptOAuthSessionCleared?: (providerIds: readonly OAuthProviderId[]) => Promise<void>;
}

function accessTokenKey(provider: OAuthProviderId): string {
  return `oauth:${provider}:access_token`;
}

function refreshTokenKey(provider: OAuthProviderId): string {
  return `oauth:${provider}:refresh_token`;
}

function userInfoKey(provider: OAuthProviderId): string {
  return `oauth:${provider}:user_info`;
}

function collectKnownOAuthProviderIds(
  providerIds: readonly OAuthProviderId[] = [],
): OAuthProviderId[] {
  const uniqueProviderIds = new Set<OAuthProviderId>(KNOWN_OAUTH_PROVIDER_IDS);
  for (const providerId of providerIds) {
    uniqueProviderIds.add(providerId);
  }
  return [...uniqueProviderIds];
}

function inferBase64ImageMimeType(decoded: Buffer): string {
  if (
    decoded.length >= 8 &&
    decoded[0] === 0x89 &&
    decoded[1] === 0x50 &&
    decoded[2] === 0x4e &&
    decoded[3] === 0x47
  ) {
    return "image/png";
  }

  if (decoded.length >= 3 && decoded[0] === 0xff && decoded[1] === 0xd8 && decoded[2] === 0xff) {
    return "image/jpeg";
  }

  if (decoded.length >= 6 && decoded.toString("ascii", 0, 3) === "GIF") {
    return "image/gif";
  }

  if (
    decoded.length >= 12 &&
    decoded.toString("ascii", 0, 4) === "RIFF" &&
    decoded.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return "image/png";
}

function toBase64ImageDataUrl(raw: string): string | null {
  const normalized = raw.replace(/\s/g, "");
  if (normalized.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length === 0) {
    return null;
  }

  const encoded = decoded.toString("base64").replace(/=+$/, "");
  if (encoded !== normalized.replace(/=+$/, "")) {
    return null;
  }

  return `data:${inferBase64ImageMimeType(decoded)};base64,${normalized}`;
}

function normalizeStoredZaiAvatarUrl(avatar: string | undefined): string | undefined {
  const trimmed = avatar?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^data:image\/[^;]+;base64,/i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const dataUrl = toBase64ImageDataUrl(trimmed);
  if (dataUrl) {
    return dataUrl;
  }

  return trimmed;
}

function toOAuthUserProfileFromRawZaiUser(raw: Record<string, unknown>): OAuthUserProfile | null {
  const id = typeof raw.user_id === "string" ? raw.user_id : "unknown";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const email = typeof raw.email === "string" ? raw.email : "";
  const username = name || email || id;
  const avatarUrl = normalizeStoredZaiAvatarUrl(
    typeof raw.avatar === "string" ? raw.avatar : undefined,
  );

  if (!name && !email && id === "unknown") {
    return null;
  }

  return {
    id,
    username,
    displayName: username,
    ...(avatarUrl ? { avatarUrl } : {}),
    rawProfile: raw,
  };
}

/** 账号列表条目（多账号）。identity = user_info.id。 */
export interface OAuthAccountEntry {
  provider: OAuthProviderId;
  identity: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

/** OAuth 凭据仓储：统一 provider 命名空间 */
export class OAuthCredentialRepo {
  private readonly knownProviderIds: OAuthProviderId[];

  constructor(
    private credentialService: ICredentialService,
    options: OAuthCredentialRepoOptions = {},
  ) {
    this.knownProviderIds = collectKnownOAuthProviderIds(options.providerIds);
    this.onCorruptOAuthSessionCleared = options.onCorruptOAuthSessionCleared;
  }

  private readonly onCorruptOAuthSessionCleared?: (
    providerIds: readonly OAuthProviderId[],
  ) => Promise<void>;

  async getActiveProvider(): Promise<OAuthProviderId | null> {
    return this.loadActiveProvider();
  }

  async setActiveProvider(provider: OAuthProviderId | null): Promise<void> {
    await this.saveActiveProvider(provider);
  }

  async loadActiveProvider(): Promise<OAuthProviderId | null> {
    try {
      return await this.credentialService.load(ACTIVE_PROVIDER_KEY);
    } catch (error) {
      if (!isCredentialDecryptError(error)) {
        throw error;
      }

      await this.clearCorruptOAuthSession();
      return null;
    }
  }

  async saveActiveProvider(provider: OAuthProviderId | null): Promise<void> {
    if (!provider) {
      await this.credentialService.delete(ACTIVE_PROVIDER_KEY);
      return;
    }

    // App 登录恢复为 oauth:* 镜像，active provider 是互斥 provider 域的唯一事实源。
    await this.credentialService.save(ACTIVE_PROVIDER_KEY, provider);
  }

  async loadActiveTokenSet(): Promise<OAuthTokenSet | null> {
    const provider = await this.loadActiveProvider();
    if (!provider) {
      return null;
    }

    const tokenSet = await this.loadTokenSet(provider);
    if (tokenSet) {
      return tokenSet;
    }

    return null;
  }

  async saveActiveTokenSet(tokenSet: OAuthTokenSet): Promise<void> {
    const provider = await this.loadActiveProvider();
    if (!provider) {
      throw new Error("保存当前登录 token 前缺少 active provider");
    }
    await this.saveTokenSet(provider, tokenSet);
  }

  async loadActiveUserProfile(): Promise<OAuthUserProfile | null> {
    const provider = await this.loadActiveProvider();
    if (!provider) {
      return null;
    }

    const profile = await this.loadUserProfile(provider);
    if (profile) {
      return profile;
    }

    return null;
  }

  async saveActiveUserProfile(profile: OAuthUserProfile): Promise<void> {
    const provider = await this.loadActiveProvider();
    if (!provider) {
      throw new Error("保存当前登录 user 前缺少 active provider");
    }
    await this.saveUserProfile(provider, profile);
  }

  // ------------------------------------------------------------------
  // 多账号支持：账号列表 + 激活账号指针 + per-account 凭证。
  // 保留旧的 provider 单值 key（oauth:active_provider / oauth:{provider}:* / zcodejwttoken）
  // 作为「当前激活账号」的镜像，切换账号时同步刷新，避免破坏既有消费方。
  // ------------------------------------------------------------------

  async listAccounts(): Promise<OAuthAccountEntry[]> {
    try {
      const raw = await this.credentialService.load(ACCOUNT_LIST_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is OAuthAccountEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as OAuthAccountEntry).provider === "string" &&
          typeof (entry as OAuthAccountEntry).identity === "string" &&
          typeof (entry as OAuthAccountEntry).username === "string" &&
          typeof (entry as OAuthAccountEntry).displayName === "string",
      );
    } catch (error) {
      if (!isCredentialDecryptError(error)) throw error;
      return [];
    }
  }

  async saveAccounts(accounts: OAuthAccountEntry[]): Promise<void> {
    await this.credentialService.save(ACCOUNT_LIST_KEY, JSON.stringify(accounts));
  }

  async loadActiveAccountRef(): Promise<string | null> {
    try {
      return await this.credentialService.load(ACTIVE_ACCOUNT_KEY);
    } catch (error) {
      if (!isCredentialDecryptError(error)) throw error;
      return null;
    }
  }

  async saveActiveAccountRef(accountRef: string | null): Promise<void> {
    if (!accountRef) {
      await this.credentialService.delete(ACTIVE_ACCOUNT_KEY);
    } else {
      await this.credentialService.save(ACTIVE_ACCOUNT_KEY, accountRef);
    }
  }

  async loadAccountEntry(accountRef: string): Promise<OAuthAccountEntry | null> {
    const accounts = await this.listAccounts();
    return (
      accounts.find((account) => accountRefFromParts(account.provider, account.identity) === accountRef) ??
      null
    );
  }

  async loadTokenSetForAccount(accountRef: string): Promise<OAuthTokenSet | null> {
    const accessToken = await this.safeLoad(accountAccessTokenKey(accountRef));
    if (!accessToken) return null;
    const refreshToken = await this.safeLoad(accountRefreshTokenKey(accountRef));
    const zcodeJwtToken = await this.safeLoad(accountZcodeJwtKey(accountRef));
    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(zcodeJwtToken ? { zcodeJwtToken } : {}),
    };
  }

  async saveTokenSetForAccount(accountRef: string, tokenSet: OAuthTokenSet): Promise<void> {
    await this.credentialService.save(accountAccessTokenKey(accountRef), tokenSet.accessToken);
    if (tokenSet.refreshToken) {
      await this.credentialService.save(accountRefreshTokenKey(accountRef), tokenSet.refreshToken);
    } else {
      await this.credentialService.delete(accountRefreshTokenKey(accountRef));
    }
    if (tokenSet.zcodeJwtToken) {
      await this.credentialService.save(accountZcodeJwtKey(accountRef), tokenSet.zcodeJwtToken);
    } else {
      await this.credentialService.delete(accountZcodeJwtKey(accountRef));
    }
    if ((await this.loadActiveAccountRef()) === accountRef) {
      await this.mirrorActiveAccount(accountRef);
    }
  }

  async loadUserProfileForAccount(accountRef: string): Promise<OAuthUserProfile | null> {
    const provider = accountRefProvider(accountRef);
    return this.loadUserProfileFromKey(accountUserInfoKey(accountRef), provider ?? undefined);
  }

  async saveUserProfileForAccount(accountRef: string, profile: OAuthUserProfile): Promise<void> {
    const provider = accountRefProvider(accountRef);
    const persist =
      provider === ZAI_PROVIDER_ID && profile.rawProfile ? profile.rawProfile : profile;
    await this.credentialService.save(accountUserInfoKey(accountRef), JSON.stringify(persist));
  }

  /** 仅清除该账号的登录态凭证（保留 user_info 与 account_list；登出=不删账号）。 */
  async clearAccountCredentials(accountRef: string): Promise<void> {
    await this.credentialService.delete(accountAccessTokenKey(accountRef));
    await this.credentialService.delete(accountRefreshTokenKey(accountRef));
    await this.credentialService.delete(accountZcodeJwtKey(accountRef));
    if ((await this.loadActiveAccountRef()) === accountRef) {
      await this.clearActiveSession();
    }
  }

  async clearAccount(accountRef: string): Promise<void> {
    await this.credentialService.delete(accountAccessTokenKey(accountRef));
    await this.credentialService.delete(accountRefreshTokenKey(accountRef));
    await this.credentialService.delete(accountUserInfoKey(accountRef));
    await this.credentialService.delete(accountZcodeJwtKey(accountRef));
    if ((await this.loadActiveAccountRef()) === accountRef) {
      await this.clearActiveSession();
    }
    const accounts = await this.listAccounts();
    await this.saveAccounts(
      accounts.filter((account) => accountRefFromParts(account.provider, account.identity) !== accountRef),
    );
  }

  /** 激活账号切换：更新激活指针并把 per-account 凭证镜像到旧 provider 单值 key。 */
  async activateAccount(accountRef: string): Promise<void> {
    await this.saveActiveAccountRef(accountRef);
    await this.mirrorActiveAccount(accountRef);
  }

  private async safeLoad(key: string): Promise<string | null> {
    try {
      return await this.credentialService.load(key);
    } catch (error) {
      if (!isCredentialDecryptError(error)) throw error;
      return null;
    }
  }

  private async mirrorActiveAccount(accountRef: string): Promise<void> {
    const provider = accountRefProvider(accountRef);
    if (!provider) return;
    // 无 tokenSet 也推进（写 active_provider / 清镜像），避免 active_account 已改而 active_provider 未改的半程状态。
    const tokenSet = await this.loadTokenSetForAccount(accountRef);
    if (tokenSet) {
      await this.credentialService.save(accessTokenKey(provider), tokenSet.accessToken);
      if (tokenSet.refreshToken) {
        await this.credentialService.save(refreshTokenKey(provider), tokenSet.refreshToken);
      } else {
        await this.credentialService.delete(refreshTokenKey(provider));
      }
      if (tokenSet.zcodeJwtToken) {
        await this.credentialService.save(XCODE_JWT_TOKEN_KEY, tokenSet.zcodeJwtToken);
      } else {
        await this.credentialService.delete(XCODE_JWT_TOKEN_KEY);
      }
    } else {
      await this.credentialService.delete(accessTokenKey(provider));
      await this.credentialService.delete(refreshTokenKey(provider));
      await this.credentialService.delete(XCODE_JWT_TOKEN_KEY);
    }
    // 关键：登录态/账号身份/套餐都读单值 oauth:{provider}:user_info，必须与激活账号镜像同步。
    const profile = await this.loadUserProfileForAccount(accountRef);
    if (profile) {
      const persist =
        provider === ZAI_PROVIDER_ID && profile.rawProfile ? profile.rawProfile : profile;
      await this.credentialService.save(userInfoKey(provider), JSON.stringify(persist));
    } else {
      await this.credentialService.delete(userInfoKey(provider));
    }
    await this.credentialService.save(ACTIVE_PROVIDER_KEY, provider);
  }

  /** 迁移旧的单账号数据（active_provider + provider 单值 token + 全局 zcodejwt）为首条账号记录。 */
  async migrateLegacySingleAccount(): Promise<string | null> {
    const accounts = await this.listAccounts();
    if (accounts.length > 0) return null;
    const provider = await this.loadActiveProvider();
    if (!provider) return null;
    const tokenSet = await this.loadTokenSet(provider);
    const profile = await this.loadUserProfile(provider);
    if (!profile?.id) return null;
    const accountRef = accountRefFromParts(provider, profile.id);
    if (tokenSet) await this.saveTokenSetForAccount(accountRef, tokenSet);
    await this.saveUserProfileForAccount(accountRef, profile);
    await this.saveAccounts([
      {
        provider,
        identity: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      },
    ]);
    await this.activateAccount(accountRef);
    return accountRef;
  }

  async saveLoginAttribution(attribution: OAuthLoginAttribution): Promise<void> {
    const persistAttribution = Object.fromEntries(
      Object.entries(attribution).flatMap(([key, value]) => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        return trimmed ? [[key, trimmed]] : [];
      }),
    );

    if (Object.keys(persistAttribution).length === 0) {
      return;
    }

    await this.credentialService.save(LOGIN_ATTRIBUTION_KEY, JSON.stringify(persistAttribution));
  }

  async loadLoginAttribution(): Promise<OAuthLoginAttribution | null> {
    let raw: string | null;
    try {
      raw = await this.credentialService.load(LOGIN_ATTRIBUTION_KEY);
    } catch (error) {
      if (!isCredentialDecryptError(error)) {
        throw error;
      }
      return null;
    }

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // 兼容本分支早期保存过的 { params, expiresAt } 结构；取消 TTL 后只读取 params。
      const storedParams =
        parsed.params && typeof parsed.params === "object"
          ? (parsed.params as Record<string, unknown>)
          : parsed;

      const params = Object.fromEntries(
        Object.entries(storedParams).flatMap(([key, value]) =>
          (key === "channel_id" || key === "utm_source" || key === "utm_campaign") &&
          typeof value === "string" &&
          value.trim()
            ? [[key, value.trim()]]
            : [],
        ),
      ) as OAuthLoginAttribution;
      if (Object.keys(params).length === 0) {
        await this.credentialService.delete(LOGIN_ATTRIBUTION_KEY);
        return null;
      }
      return params;
    } catch {
      await this.credentialService.delete(LOGIN_ATTRIBUTION_KEY);
      return null;
    }
  }

  async clearActiveSession(): Promise<void> {
    const activeProvider = await this.loadActiveProvider();
    if (activeProvider) {
      await this.clearProvider(activeProvider);
    }
    await this.credentialService.delete(ACTIVE_PROVIDER_KEY);
    // 登出后清激活账号指针，避免 loadActiveAccountRef 悬空指向已登出账号。
    await this.credentialService.delete(ACTIVE_ACCOUNT_KEY);
  }

  async loadTokenSet(provider: OAuthProviderId): Promise<OAuthTokenSet | null> {
    try {
      const accessToken = await this.credentialService.load(accessTokenKey(provider));
      if (!accessToken) {
        return null;
      }

      const refreshToken = await this.credentialService.load(refreshTokenKey(provider));

      const zcodeJwtToken =
        provider === ZAI_PROVIDER_ID || provider === BIGMODEL_PROVIDER_ID
          ? await this.credentialService.load(XCODE_JWT_TOKEN_KEY)
          : null;

      return {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(zcodeJwtToken ? { zcodeJwtToken } : {}),
      };
    } catch (error) {
      if (!isCredentialDecryptError(error)) {
        throw error;
      }

      await this.clearCorruptOAuthSession();
      return null;
    }
  }

  async saveTokenSet(provider: OAuthProviderId, tokenSet: OAuthTokenSet): Promise<void> {
    await this.credentialService.save(accessTokenKey(provider), tokenSet.accessToken);

    if (tokenSet.refreshToken) {
      await this.credentialService.save(refreshTokenKey(provider), tokenSet.refreshToken);
    } else {
      await this.credentialService.delete(refreshTokenKey(provider));
    }

    if (provider === ZAI_PROVIDER_ID || provider === BIGMODEL_PROVIDER_ID) {
      if (tokenSet.zcodeJwtToken) {
        // BigModel Start Plan 与 Z.ai Start Plan 一样消费 zcode JWT。
        // JWT 必须在 OAuth callback 阶段随 tokenSet 落盘，后续 balance/runtime 只读取它，
        // 不能再拿 BigModel access token 拼另一个 /oauth/token body 临时兑换。
        await this.credentialService.save(XCODE_JWT_TOKEN_KEY, tokenSet.zcodeJwtToken);
      } else {
        await this.credentialService.delete(XCODE_JWT_TOKEN_KEY);
      }
    }
  }

  async loadUserProfile(provider: OAuthProviderId): Promise<OAuthUserProfile | null> {
    return this.loadUserProfileFromKey(userInfoKey(provider), provider);
  }

  private async loadUserProfileFromKey(
    key: string,
    provider?: OAuthProviderId,
  ): Promise<OAuthUserProfile | null> {
    let raw: string | null;
    try {
      raw = await this.credentialService.load(key);
    } catch (error) {
      if (!isCredentialDecryptError(error)) {
        throw error;
      }

      await this.clearCorruptOAuthSession();
      return null;
    }

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<OAuthUserProfile>;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.username === "string" &&
        typeof parsed.displayName === "string"
      ) {
        const avatarUrl = typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : undefined;
        const rawProfile =
          typeof parsed.rawProfile === "object" && parsed.rawProfile !== null
            ? parsed.rawProfile
            : undefined;
        return {
          id: parsed.id,
          username: parsed.username,
          displayName: parsed.displayName,
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(rawProfile ? { rawProfile } : {}),
        };
      }

      if (provider === ZAI_PROVIDER_ID && typeof parsed === "object" && parsed !== null) {
        // ZAI user_info 现在按后端 data.user 原样持久化，
        // 启动恢复时需要从 user_id/name/avatar 重新映射展示字段。
        const zaiProfile = toOAuthUserProfileFromRawZaiUser(parsed as Record<string, unknown>);
        if (zaiProfile) {
          return zaiProfile;
        }
      }
    } catch {
      // ignore parse error and fallback to null
    }

    return null;
  }

  async saveUserProfile(provider: OAuthProviderId, profile: OAuthUserProfile): Promise<void> {
    // ZAI 后端返回的 data.user 是后续账号态排查与恢复的源数据，
    // 之前只保存归一化展示字段会丢失 email/name/avatar 原始结构。
    const persistProfile =
      provider === ZAI_PROVIDER_ID && profile.rawProfile ? profile.rawProfile : profile;

    await this.credentialService.save(userInfoKey(provider), JSON.stringify(persistProfile));
  }

  async clearUserProfile(provider: OAuthProviderId): Promise<void> {
    await this.credentialService.delete(userInfoKey(provider));
  }

  async clearProvider(provider: OAuthProviderId): Promise<void> {
    await this.credentialService.delete(accessTokenKey(provider));
    await this.credentialService.delete(refreshTokenKey(provider));
    await this.credentialService.delete(userInfoKey(provider));
    if (shouldClearXcodeJwtOnLogout(provider)) {
      await this.credentialService.delete(XCODE_JWT_TOKEN_KEY);
    }
  }

  async clearAll(providers: OAuthProviderId[]): Promise<void> {
    for (const provider of providers) {
      await this.clearProvider(provider);
    }

    await this.saveActiveProvider(null);
  }

  private async clearCorruptOAuthSession(): Promise<void> {
    // AES-GCM 解密失败说明当前运行时已经无法信任本地 OAuth 登录态。
    // 等价于强制登出已注册 OAuth provider：先清 provider 命名空间与共享 zcode JWT，
    // 再通知 service 层清理 Start/Coding Plan 这类派生模型凭据，同时避免误删 SSH 等其他独立凭据。
    for (const provider of this.knownProviderIds) {
      await this.clearProvider(provider);
    }
    await this.credentialService.delete(ACTIVE_PROVIDER_KEY);
    try {
      await this.onCorruptOAuthSessionCleared?.(this.knownProviderIds);
    } catch (error) {
      // 派生模型 provider 清理失败不能阻断 OAuth 损坏态恢复。
      // 主 OAuth 凭据已经删除，用户必须能回到可重新登录的未登录态。
      log.warn(undefined, "clear derived provider keys after corrupt OAuth session failed", error);
    }
  }
}

function shouldClearXcodeJwtOnLogout(provider: OAuthProviderId): boolean {
  return provider === ZAI_PROVIDER_ID || provider === BIGMODEL_PROVIDER_ID;
}
