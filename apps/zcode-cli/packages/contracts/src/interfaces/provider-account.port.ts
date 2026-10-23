// ============================================================
// Provider Account Port - agent-side account/credential boundary
// ============================================================
// 与 ProxyPoolPort / ModelJailbreakPort 兄弟并列：只放窄类型，不 import services
// 的账号实现类型。
//
// 铁律：这个端口**不返回任何凭据原文**。读操作只回 ProviderAccountView
// （有无 token、到期时间、显示名、是否激活），写操作只接受 token 入参。

import type {
  ProviderAccountFamily,
  ProviderAccountView,
} from "../tools/provider-account.js";

export type { ProviderAccountFamily, ProviderAccountView } from "../tools/provider-account.js";

export type ProviderAccountRegion = "cn" | "intl";

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

export interface ProviderAccountPort {
  /** 列出某族的账号（脱敏视图）。 */
  list(input: {
    family: ProviderAccountFamily;
    region?: ProviderAccountRegion;
  }): Promise<ProviderAccountSnapshot>;
  /** 导入一份凭据并写入账号表；返回导入后的完整列表。 */
  import(input: ProviderAccountImportInput): Promise<ProviderAccountSnapshot>;
  /** 删除账号；返回删除后的完整列表。 */
  remove(input: {
    family: ProviderAccountFamily;
    region?: ProviderAccountRegion;
    accountId: string;
  }): Promise<ProviderAccountSnapshot>;
  /** 切换激活账号；返回切换后的完整列表。 */
  activate(input: {
    family: ProviderAccountFamily;
    region?: ProviderAccountRegion;
    accountId: string;
  }): Promise<ProviderAccountSnapshot>;
  /** 用 refreshToken 换新 accessToken；返回刷新后的完整列表。 */
  refresh(input: {
    family: ProviderAccountFamily;
    region?: ProviderAccountRegion;
    accountId: string;
  }): Promise<ProviderAccountSnapshot>;
}
