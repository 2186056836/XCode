// ============================================================
// Provider Account tools - agent-facing account/credential import
// ============================================================
// 与 proxy-pool.ts / model-jailbreak.ts 兄弟并列：单一工具 + 扁平 action 枚举。
//
// 覆盖四类账号，导入方式不同：
// - Qoder / CodeBuddy：登录型（浏览器授权 → 轮询换 token），凭据落在各自的
//   region 账号表里；导入 = 直接写入 accessToken / refreshToken / expiresAt。
// - zai / bigmodel：Coding Plan OAuth，凭据落在 oauthCredentialRepo，
//   账号键是 accountRef = `${provider}:${identity}`。
//
// 凭据本身**永远不回显**：list 只返回脱敏后的账号视图（有无 token、到期时间、
// 身份标签），导入接口只写不读。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

const nonEmptyString = z.string().trim().min(1);

/** 支持账号导入的供应商族。 */
export const ProviderAccountFamilySchema = z.enum(["qoder", "codebuddy", "zai", "bigmodel"]);
export type ProviderAccountFamily = z.infer<typeof ProviderAccountFamilySchema>;

export const ProviderAccountActionSchema = z.enum([
  "list",
  "import",
  "remove",
  "activate",
  "refresh",
]);
export type ProviderAccountAction = z.infer<typeof ProviderAccountActionSchema>;

export const ProviderAccountInputSchema = z
  .object({
    action: ProviderAccountActionSchema.describe(
      [
        "Which account operation to perform. Required fields per action:",
        "`list` — family. Returns every account for that family with masked credential state.",
        "`import` — family + accessToken; optional refreshToken, expiresAt (epoch ms), identity, displayName, email, region (qoder/codebuddy only).",
        "`remove` — family + accountId.",
        "`activate` — family + accountId.",
        "`refresh` — family + accountId (qoder/codebuddy only; zai/bigmodel refresh on demand).",
      ].join(" "),
    ),
    family: ProviderAccountFamilySchema.describe(
      "Account family. `qoder` / `codebuddy` are login-based providers with per-region account tables; `zai` / `bigmodel` are Coding Plan OAuth accounts keyed by accountRef.",
    ),
    region: z
      .enum(["cn", "intl"])
      .optional()
      .describe(
        "Required for `qoder` and `codebuddy` (they have separate CN and Intl account tables). Omit for `zai` / `bigmodel`.",
      ),
    accessToken: z
      .string()
      .optional()
      .describe(
        "Bearer access token to import. Required by `import`. This is the token the provider's own client sends; for Qoder it is the `token` field, for CodeBuddy the `accessToken` field, for zai/bigmodel the OAuth access_token.",
      ),
    refreshToken: z
      .string()
      .optional()
      .describe(
        "Refresh token paired with the access token. Optional but strongly recommended: without it the account cannot self-refresh and will need re-import when the access token expires.",
      ),
    expiresAt: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Access-token expiry as epoch milliseconds. Optional; when omitted the account is treated as valid until the provider rejects it.",
      ),
    machineId: nonEmptyString
      .optional()
      .describe(
        "Qoder only: the account's stable machine id (uuid). Pass the one the credential was issued with — COSY signing derives the device fingerprint from it, and inventing a new one makes the account look like a different device. When omitted the host falls back to a deterministic local value.",
      ),
    identity: nonEmptyString
      .optional()
      .describe(
        "Stable account identity used to key the account. For zai/bigmodel this is the OAuth subject / user id and becomes part of accountRef. For qoder/codebuddy it defaults to the JWT `sub` when the token is a JWT, else a generated id.",
      ),
    displayName: z
      .string()
      .optional()
      .describe("Human-readable label shown in Settings → Accounts. Optional."),
    email: z.string().optional().describe("Account email for display only. Optional."),
    accountId: nonEmptyString
      .optional()
      .describe(
        "Target account id, exactly as returned by `list`. Required by `remove`, `activate`, and `refresh`.",
      ),
  })
  .refine(
    (value) => {
      switch (value.action) {
        case "import":
          return typeof value.accessToken === "string" && value.accessToken.trim().length > 0;
        case "remove":
        case "activate":
        case "refresh":
          return value.accountId !== undefined;
        default:
          return true;
      }
    },
    {
      message:
        "Missing required field for the chosen action: import needs accessToken, remove/activate/refresh need accountId.",
    },
  )
  .refine(
    (value) =>
      value.family !== "qoder" && value.family !== "codebuddy" ? true : value.region !== undefined,
    {
      message: "qoder and codebuddy require region (cn or intl); they have separate account tables.",
    },
  );

export type ProviderAccountInput = z.infer<typeof ProviderAccountInputSchema>;

export const ProviderAccountViewSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  /** 是否有可用 accessToken。令牌值本身永不出现在输出里。 */
  hasAccessToken: z.boolean(),
  hasRefreshToken: z.boolean(),
  /** accessToken 到期时间（epoch ms）；null = 未知/未设置。 */
  expiresAt: z.number().nullable(),
  active: z.boolean(),
});

export const ProviderAccountOutputSchema = z.object({
  message: z.string(),
  family: ProviderAccountFamilySchema,
  region: z.enum(["cn", "intl"]).nullable(),
  accounts: z.array(ProviderAccountViewSchema),
});

export type ProviderAccountOutput = z.infer<typeof ProviderAccountOutputSchema>;
export type ProviderAccountView = z.infer<typeof ProviderAccountViewSchema>;

export const ProviderAccountInputJsonSchema = toToolJsonSchema(ProviderAccountInputSchema);
export const ProviderAccountOutputJsonSchema = toToolJsonSchema(ProviderAccountOutputSchema);
