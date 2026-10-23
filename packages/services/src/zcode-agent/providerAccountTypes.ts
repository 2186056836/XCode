// ============================================================
// Provider Account types (services-side mirror)
// ============================================================
// services 层不依赖 @zcode/contracts（那是 CLI 侧包）；这里声明同形类型，
// bootstrap 的 port 实现按结构兼容即可。

import type { CodeBuddyRegion } from "../model-provider/codebuddyAuth.js";
import type { QoderAuthRegion } from "../model-provider/qoderAuth.js";

export type ProviderAccountFamily = "qoder" | "codebuddy" | "zai" | "bigmodel";
export type ProviderAccountRegion = "cn" | "intl";

export interface ProviderAccountView {
  accountId: string;
  displayName: string;
  email: string | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt: number | null;
  active: boolean;
}

export interface ProviderAccountSnapshot {
  family: ProviderAccountFamily;
  region: ProviderAccountRegion | null;
  accounts: ProviderAccountView[];
}

export interface ProviderAccountImportInput {
  family: ProviderAccountFamily;
  region?: ProviderAccountRegion;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  /** Qoder only：账号稳定的 machineId；缺省由 host 生成确定性回退值。 */
  machineId?: string;
  identity?: string;
  displayName?: string;
  email?: string;
}

/** host 侧只需要账号表的读写与 zai/bigmodel 的 OAuth 仓储。 */
export interface ProviderAccountStore {
  /** zai / bigmodel：OAuth 账号仓储（与设置页账号管理同一份）。 */
  oauth: {
    listAccounts(): Promise<
      Array<{
        provider: string;
        identity: string;
        username: string;
        displayName: string;
        avatarUrl?: string;
      }>
    >;
    saveAccounts(
      accounts: Array<{
        provider: string;
        identity: string;
        username: string;
        displayName: string;
        avatarUrl?: string;
      }>,
    ): Promise<void>;
    loadActiveAccountRef(): Promise<string | null>;
    saveActiveAccountRef(accountRef: string | null): Promise<void>;
    loadTokenSetForAccount(accountRef: string): Promise<{
      accessToken: string;
      refreshToken?: string;
      zcodeJwtToken?: string;
    } | null>;
    saveTokenSetForAccount(
      accountRef: string,
      tokenSet: { accessToken: string; refreshToken?: string; zcodeJwtToken?: string },
    ): Promise<void>;
    activateAccount(accountRef: string): Promise<void>;
    clearAccount(accountRef: string): Promise<void>;
    saveUserProfileForAccount(
      accountRef: string,
      profile: {
        id: string;
        username: string;
        displayName: string;
        avatarUrl?: string;
      },
    ): Promise<void>;
  };
  /** Qoder / CodeBuddy 的令牌刷新（各自实现里已有）。 */
  refreshQoder?: (region: QoderAuthRegion, accountId: string) => Promise<boolean>;
  refreshCodeBuddy?: (region: CodeBuddyRegion, accountId: string) => Promise<boolean>;
}
