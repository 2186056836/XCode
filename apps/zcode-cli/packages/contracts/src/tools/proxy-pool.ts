// ============================================================
// Proxy Pool tools - agent-facing proxy-pool configuration
// ============================================================
// 与 off-peak.ts 兄弟并列。单一工具 + 扁平 action 枚举（而不是判别联合）：判别联合在
// JSON Schema 里会退化成 anyOf，部分上游对 anyOf 的 provider 化很差；扁平对象 + refine
// 既保住 provider 稳健性，又能在 handler 里做同样的严格校验。
//
// 「配置」的完整语义写在 action 的 description 里——模型看得到的只有 JSON Schema，
// 每个 action 必填哪些字段必须在这一处讲清，不能藏在文档里。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

const nonEmptyString = z.string().trim().min(1);

export const ProxyPoolActionSchema = z.enum([
  "list",
  "save",
  "delete",
  "set_active",
  "test",
  "bind_account",
  "unbind_account",
  "apply_to_all",
  "clear_all",
  "distribute",
]);
export type ProxyPoolAction = z.infer<typeof ProxyPoolActionSchema>;

export const ProxyPoolInputSchema = z
  .object({
    action: ProxyPoolActionSchema.describe(
      [
        "Which proxy-pool operation to perform. Required fields per action:",
        "`list` — none (omit providerId to get the whole catalog; pass providerId for one provider's connections and their current bindings).",
        "`save` — poolName + proxyUrl; poolId to update an existing pool, omit to create one (the host generates the id).",
        "`delete` — poolId.",
        "`set_active` — poolId + isActive.",
        "`test` — poolId, or proxyUrl for an unsaved address; optional testUrl.",
        "`bind_account` — providerId + accountId + poolId.",
        "`unbind_account` — providerId + accountId.",
        "`apply_to_all` — providerId + poolId.",
        "`clear_all` — providerId.",
        "`distribute` — providerId; poolIds optional (omit to rotate over every active pool in list order).",
      ].join(" "),
    ),
    providerId: nonEmptyString
      .optional()
      .describe(
        "Provider id in its canonical prefixed form, exactly as returned by `list` (for example `other:qoder`, `other:qoder-cn`, `other:codebuddy`, `other:codebuddy-cn`). Only providers whose summary has supportsConnections=true have accounts and can be bound.",
      ),
    poolId: nonEmptyString
      .optional()
      .describe(
        "Proxy pool entry id, exactly as returned by `list` (for example `pool-m1k2j3-a7b8c9`). Never invent one: an unknown id creates a new pool in `save` and fails elsewhere.",
      ),
    poolName: nonEmptyString
      .optional()
      .describe(
        "Human-readable pool name shown in Settings, for example 'AWS Sydney 01'. Required by `save`.",
      ),
    proxyUrl: nonEmptyString
      .optional()
      .describe(
        "Full proxy URL including scheme and credentials, for example `http://user:pass@203.0.113.10:7897`. Required by `save`. Allowed schemes: http, https, socks4, socks4a, socks5, socks5h; a bare `host:port` is accepted and read as http. Control characters, backticks and `$` are rejected.",
      ),
    noProxy: z
      .string()
      .optional()
      .describe(
        "Comma-separated bypass rules for this pool, for example `localhost,127.0.0.1,*.internal`. Targets matching it skip the pool. Omit for none.",
      ),
    isActive: z
      .boolean()
      .optional()
      .describe(
        "Pool enabled flag. `save` defaults to true; `set_active` requires it. An inactive pool is still listed and still shown as bound on its connections, but those connections then fall back to a hard direct connection — never to the global proxy.",
      ),
    strictProxy: z
      .boolean()
      .optional()
      .describe(
        "Strict mode. When true, a connection that cannot reach this pool fails the request instead of falling back to a direct connection. When false (default), the fallback is a bare direct connection, never the global proxy.",
      ),
    accountId: nonEmptyString
      .optional()
      .describe(
        "Connection (account) id, exactly as returned for the provider. For Qoder it is the `x-qoder-internal-user-id` value; for CodeBuddy it is the JWT `sub` claim. Copy it from the provider detail, never guess it.",
      ),
    poolIds: z
      .array(nonEmptyString)
      .optional()
      .describe(
        "Ordered pool ids for `distribute`. Each connection gets one fixed pool, cycling through this list in order — that is how rotation works here; it is not a per-request switch. Omit to use every active pool in catalog order.",
      ),
    testUrl: nonEmptyString
      .optional()
      .describe(
        "Optional probe target for `test`; defaults to an IP echo service so the result reports the real exit IP.",
      ),
  })
  .strict()
  .refine((input) => input.action !== "save" || (input.poolName && input.proxyUrl), {
    message: "`save` requires poolName and proxyUrl",
  })
  .refine((input) => !["delete", "set_active"].includes(input.action) || input.poolId, {
    message: "`delete` / `set_active` require poolId",
  })
  .refine((input) => input.action !== "set_active" || typeof input.isActive === "boolean", {
    message: "`set_active` requires isActive",
  })
  .refine((input) => input.action !== "test" || input.poolId || input.proxyUrl, {
    message: "`test` requires poolId or proxyUrl",
  })
  .refine(
    (input) =>
      !input.action.startsWith("bind") && input.action !== "apply_to_all"
        ? true
        : Boolean(input.providerId),
    { message: "`bind_account` / `unbind_account` / `apply_to_all` require providerId" },
  )
  // bind_account 的两个必填放在同一条里：分两条时模型补完 poolId 才会被告知还缺 accountId，
  // 白白多一个来回。unbind_account 只要 accountId（它没有 poolId 可传）。
  .refine(
    (input) => input.action !== "bind_account" || (Boolean(input.accountId) && Boolean(input.poolId)),
    { message: "`bind_account` requires accountId and poolId" },
  )
  .refine((input) => input.action !== "unbind_account" || Boolean(input.accountId), {
    message: "`unbind_account` requires accountId",
  });

export type ProxyPoolInput = z.infer<typeof ProxyPoolInputSchema>;
export const ProxyPoolInputJsonSchema = toToolJsonSchema(ProxyPoolInputSchema);

/** 池条目的客户端镜像；type 由 host 从 proxyUrl 推导。 */
export const ProxyPoolEntryViewSchema = z
  .object({
    // 输出侧刻意用宽松 string：读的是 host 的存量配置，一条被手工编辑过的池条目
    // 不该让整份输出校验失败（那会把只读的 list 也一起打死）。
    id: z.string(),
    name: z.string(),
    proxyUrl: z.string(),
    noProxy: z.string().optional(),
    isActive: z.boolean(),
    type: z.string(),
    strictProxy: z.boolean().optional(),
  })
  .strict();
export type ProxyPoolEntryView = z.infer<typeof ProxyPoolEntryViewSchema>;

/** 可绑定连接的客户端镜像；boundEntryId 缺席即「未绑定 = 跟随全局代理」。 */
export const ProxyPoolAccountViewSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    email: z.string().optional(),
    active: z.boolean(),
    boundEntryId: z.string().optional(),
  })
  .strict();
export type ProxyPoolAccountView = z.infer<typeof ProxyPoolAccountViewSchema>;

export const ProxyPoolProviderSummarySchema = z
  .object({
    providerId: nonEmptyString,
    providerName: z.string(),
    requestProfile: z.string().optional(),
    supportsConnections: z.boolean(),
    accountCount: z.number().int().nonnegative(),
    boundAccountCount: z.number().int().nonnegative(),
  })
  .strict();
export type ProxyPoolProviderSummary = z.infer<typeof ProxyPoolProviderSummarySchema>;

export const ProxyPoolProviderViewSchema = z
  .object({
    providerId: nonEmptyString,
    providerName: z.string(),
    requestProfile: z.string().optional(),
    supportsConnections: z.boolean(),
    pools: z.array(ProxyPoolEntryViewSchema),
    accounts: z.array(ProxyPoolAccountViewSchema),
  })
  .strict();
export type ProxyPoolProviderView = z.infer<typeof ProxyPoolProviderViewSchema>;

export const ProxyPoolTestOutcomeSchema = z
  .object({
    ok: z.boolean(),
    status: z.number().int().optional(),
    statusText: z.string().optional(),
    url: z.string().optional(),
    elapsedMs: z.number().nonnegative().optional(),
    exitIp: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
export type ProxyPoolTestOutcome = z.infer<typeof ProxyPoolTestOutcomeSchema>;

/**
 * 单一输出形状覆盖所有 action：每次调用都回当前全量池 + 供应商摘要，
 * 涉及 providerId 时再带上该供应商详情，test 时带上探针结果。
 * 这样模型改完配置立刻看到新状态，不需要额外读一次。
 */
export const ProxyPoolOutputSchema = z
  .object({
    message: nonEmptyString,
    pools: z.array(ProxyPoolEntryViewSchema),
    providers: z.array(ProxyPoolProviderSummarySchema),
    provider: ProxyPoolProviderViewSchema.optional(),
    test: ProxyPoolTestOutcomeSchema.optional(),
  })
  .strict();
export type ProxyPoolOutput = z.infer<typeof ProxyPoolOutputSchema>;
export const ProxyPoolOutputJsonSchema = toToolJsonSchema(ProxyPoolOutputSchema);
