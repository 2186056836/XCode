/**
 * 代理池（Proxy Pool）共享契约 —— 池条目、URL 校验、连接级绑定与出口解析的单一事实源。
 *
 * 分层对齐 9router（`src/lib/network/connectionProxy.js` + `dashboard/proxy-pools/page.js`）：
 * 1. **池条目** `ProxyPoolEntry`：全局共享的代理列表，存在 AppSettings.proxyPools（setting.json）。
 *    纯 CRUD + 连通性测试；不含任何供应商 UI，也不决定谁用它。
 * 2. **连接级绑定** `ProviderProxyBinding.bindings`：存在 provider config 的 `api.proxy`，把
 *    **单条连接**（= 一个账号 / 一份凭据，9router 的 connection）绑到**一个池条目**上。
 * 3. **供应商级绑定** `ProviderProxyBinding.provider`：给**没有连接/凭据**的免费供应商
 *    （OpenCode Free / Kilo Free）用。这类供应商没有账号可供逐条绑池，但上游会按出口 IP
 *    风控，因此按 9router 的 noAuth 路径（`src/sse/services/auth.js` 里
 *    `FREE_PROVIDERS[providerId].noAuth` → `pickProxyPoolId`）在**每次请求**上从候选池里
 *    轮询/随机挑一条。轮询游标是进程内 module-level Map，按 providerId 计数，restart 归零——
 *    与 9router 的 `rotateState` 同语义。
 *    只给**上游按出口 IP 风控的匿名共享档**（OpenCode Free / Kilo Free）开这个入口；
 *    自带 apiKey 的免费中转（如「冇名AI」）配额绑在 key 上，不给 provider 级出口，
 *    白名单见 services/proxy-pool/proxyPool.ts 的 supportsProviderBinding。
 *
 * 连接级与供应商级互不干扰：有账号身份时只看 `bindings[accountId]`；解析不出账号身份
 * （免费供应商）时才看 `provider`。这与 9router「有 connection 走 providerSpecificData，
 * noAuth 才走 providerStrategies」的分流一致。
 *
 * 为什么绑定把整条条目内联进 provider config（value 是完整 ProxyPoolEntry 而非一个 id）：
 * provider config 会随 Registry 下发到 agent 子进程，而 agent 读不到 host 的 setting.json。
 * 内联后 agent 侧自包含解析，不产生跨进程读设置的耦合；池条目改名/改 URL/被删除后由 host 侧
 * proxyPoolService.syncProviderBindings 把快照刷到最新。
 *
 * 与全局代理的关系：**绑定了池的连接独占出口**。全局 httpProxy 由 Electron session 与 agent
 * 子进程环境变量层管理；请求级的连接代理一旦生效就把它彻底排除（对齐 9router 的
 * `const envProxyUrl = connectionProxyUrl ? null : envProxy`）。**未绑定**的连接出口跟随
 * XCode 全局代理状态：全局配了就走它，没配就走直连。
 *
 * **停用一条池 = 引用它的连接回到「未绑定」**（不是「改为直连」）：停用是用户不想再用这条
 * 线路，此时该连接应当和从未绑过池一样跟随全局代理状态。绑定在池变更时由
 * refreshProviderProxyBinding 立即摘掉，UI 下拉也不再列出停用条目。
 *
 * 本文件必须保持 browser-safe（只依赖 zod），因为 renderer 侧 UI 直接消费这些类型与纯函数。
 */
import { z } from "zod";

/** 允许的代理 scheme 白名单；与 9router outboundProxy 的 ALLOWED_PROXY_SCHEMES 一致。 */
export const PROXY_POOL_ALLOWED_SCHEMES = [
  "http:",
  "https:",
  "socks5:",
  "socks4:",
  "socks5h:",
  "socks4a:",
] as const;

/**
 * 代理类型。用于 UI 展示与「能否被 Electron/undici 直连支持」的判定：
 * - http / https：Chromium 与 undici ProxyAgent 原生支持。
 * - socks4 / socks5：Chromium 原生支持；Node 侧经 socks-proxy-agent 建隧道（已实测）。
 */
export const PROXY_POOL_TYPES = ["http", "https", "socks5", "socks4"] as const;
export type ProxyPoolType = (typeof PROXY_POOL_TYPES)[number];

/** 池条目；id 由服务层生成，UI 只读。 */
export interface ProxyPoolEntry {
  id: string;
  name: string;
  proxyUrl: string;
  /** 该条目的绕过规则；命中的目标不走池（语义与全局代理的 bypass 一致）。 */
  noProxy?: string;
  isActive: boolean;
  type: ProxyPoolType;
  /**
   * 严格模式（对齐 9router 池条目的 strictProxy）：代理建连失败时直接让请求失败，
   * 而不是回退直连。默认 false = 回退**裸直连**（回退目标永远不是全局代理）。
   */
  strictProxy?: boolean;
}

/** 全局池列表容器；存在 AppSettings.proxyPools。 */
export interface ProxyPoolSettings {
  pools: ProxyPoolEntry[];
}

export const DEFAULT_PROXY_POOL_SETTINGS: ProxyPoolSettings = { pools: [] };

/**
 * 供应商级出口策略（只对无账号身份的免费供应商生效）。
 *
 * - `none`：固定走 `pools[0]`（0/1 条）；UI 只让选一条。
 * - `round-robin`：每次请求按 providerId 的进程内游标轮换 `pools`。
 * - `random`：每次请求随机挑一条。
 */
export type ProviderProxyRotationStrategy = "none" | "round-robin" | "random";

export interface ProviderProxyRotation {
  strategy: ProviderProxyRotationStrategy;
  /**
   * 候选池快照。agent 读不到 host 的 setting.json，所以整条条目内联下发；
   * host 侧 refreshProviderProxyBinding 负责在池改名/改 URL/停用/删除后刷新。
   */
  pools: ProxyPoolEntry[];
}

/**
 * 代理绑定；存在 provider config 的 `api.proxy`。
 *
 * 连接级 accountId 的来源见 resolveProviderProxyAccountId：
 * - Qoder：内部身份头 `x-qoder-internal-user-id`
 * - CodeBuddy：apiKey（JWT）的 `sub`
 *
 * **键不存在 = 未绑定**：该连接的出口跟随 XCode 全局代理状态。
 * 没有「显式直连」这个额外状态——它与「未绑定」行为完全相同，多一个哨兵值只会让下拉框里
 * 出现两个选项做同一件事。
 */
export interface ProviderProxyBinding {
  bindings: Record<string, ProxyPoolEntry>;
  /** 无账号身份的供应商（OpenCode Free / Kilo Free）的 per-request 出口。 */
  provider?: ProviderProxyRotation;
}

/** 空绑定（= 所有连接都未绑定）。 */
export const EMPTY_PROVIDER_PROXY_BINDING: ProviderProxyBinding = { bindings: {} };

/**
 * 注入防护：拒绝换行、反引号与 `$`。
 *
 * 这些字符会进入 shell 环境变量与 HTTP 头/代理规则字符串：换行可截断 env 行，
 * 反引号/`$` 可触发 shell 命令替换，因此在校验阶段直接拒绝。
 */
const PROXY_URL_INJECTION_PATTERN = /[\n\r`$]/;

export interface ProxyUrlValidationResult {
  ok: boolean;
  /** 校验通过时给出规范化后的 href；失败时为空。 */
  normalizedUrl?: string;
  /** 失败原因（稳定的机器码，供 UI 映射文案）。 */
  error?: string;
}

/**
 * 校验代理 URL：scheme 白名单 + 注入字符拒绝 + `new URL()` 解析。
 *
 * 裸 `host:port` 会按 http:// 补全（与设置页 httpProxy 的输入习惯一致），
 * 显式写了 scheme 时必须是白名单内的一种。
 */
export function validateProxyPoolUrl(value: string | undefined): ProxyUrlValidationResult {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return { ok: false, error: "proxy-url-required" };
  }
  if (PROXY_URL_INJECTION_PATTERN.test(raw)) {
    return { ok: false, error: "proxy-url-invalid-characters" };
  }
  // 只有出现 "scheme://" 形式才视为显式 scheme；`host:port` 里的冒号不能当 scheme 解析。
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "proxy-url-unparsable" };
  }
  if (!(PROXY_POOL_ALLOWED_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return { ok: false, error: "proxy-url-unsupported-scheme" };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "proxy-url-missing-host" };
  }
  return { ok: true, normalizedUrl: parsed.href };
}

/** 从 URL 推断代理类型；无法识别时回退 http。 */
export function inferProxyPoolType(proxyUrl: string | undefined): ProxyPoolType {
  const raw = typeof proxyUrl === "string" ? proxyUrl.trim() : "";
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  switch (match?.[1]?.toLowerCase()) {
    case "https":
      return "https";
    case "socks5":
    case "socks5h":
      return "socks5";
    case "socks4":
    case "socks4a":
      return "socks4";
    default:
      return "http";
  }
}

/**
 * 把用户填写的绕过规则规范化为逗号分隔串；空值返回 undefined（表示「不绕过任何主机」）。
 * 与 desktopNetworkPolicy 的 normalizeProxyBypassRules 同语义，避免多处各自实现漂移。
 */
export function normalizeProxyPoolNoProxy(value: string | undefined): string | undefined {
  const tokens = value
    ?.split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens && tokens.length > 0 ? tokens.join(",") : undefined;
}

/** 命中 noProxy 规则时应当直连；规则语义与 http-config 的 shouldBypassProxy 一致。 */
export function proxyNoProxyMatches(requestUrl: string, noProxy: string | undefined): boolean {
  const normalized = normalizeProxyPoolNoProxy(noProxy);
  if (!normalized) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  for (const token of normalized.split(",")) {
    if (token === "*") return true;
    const [ruleHost = "", rulePort] = token.toLowerCase().split(":");
    const suffix = ruleHost.replace(/^\*\.?/, "").replace(/^\./, "");
    if (!suffix) continue;
    if (rulePort && rulePort !== port) continue;
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

/**
 * 该绑定是否真的一条连接都没绑。
 *
 * 空绑定等价于「没配代理池」：请求原样交给全局代理链，零开销。
 */
export function isProviderProxyBindingConfigured(
  binding: ProviderProxyBinding | undefined,
): boolean {
  if (!binding) {
    return false;
  }
  return (
    Object.keys(binding.bindings).length > 0 || (binding.provider?.pools.length ?? 0) > 0
  );
}

/** 取某条连接绑定的池条目；无账号身份或未绑定时返回 undefined。 */
export function resolveProviderProxyBindingEntry(
  binding: ProviderProxyBinding | undefined,
  accountId: string | undefined,
): ProxyPoolEntry | undefined {
  const key = accountId?.trim();
  if (!key || !binding) {
    return undefined;
  }
  return binding.bindings[key];
}

/**
 * 供应商级轮询游标：进程内、按 providerId 计数、restart 归零。
 * 与 9router `pickProxyPoolId` 的 `rotateState` 同语义（单进程单线程，同步读改写即原子）。
 */
const providerRotationCursor = new Map<string, number>();

/**
 * 按策略挑一条供应商级池条目。
 *
 * - `none`：固定第一条（UI 只允许配一条）。
 * - `round-robin`：cursor 先自增再取模；空列表返回 undefined。
 * - `random`：`random()` 可注入以便测试。
 *
 * 返回值可能包含「已停用 / URL 非法」的条目——路由分类交给
 * resolveProviderProxyRoute，避免这里静默换线。
 */
export function pickProviderProxyRotationEntry(
  rotation: ProviderProxyRotation,
  providerId: string,
  random: () => number = Math.random,
): ProxyPoolEntry | undefined {
  const pools = rotation.pools;
  if (pools.length === 0) {
    return undefined;
  }
  if (rotation.strategy === "round-robin" && pools.length > 1) {
    const key = providerId || "_default";
    const next = ((providerRotationCursor.get(key) ?? -1) + 1) % pools.length;
    providerRotationCursor.set(key, next);
    return pools[next];
  }
  if (rotation.strategy === "random" && pools.length > 1) {
    return pools[Math.floor(random() * pools.length)];
  }
  return pools[0];
}

/**
 * 解析本次请求的出口。这是 XCode 侧对 9router `resolveConnectionProxyConfig` +
 * `proxyAwareFetch` 优先级规则的复刻：
 *
 * 9router 的规则是 `const envProxyUrl = connectionProxyUrl ? null : envProxy`——
 * **连接级代理一旦生效就彻底屏蔽环境/全局代理**。XCode 的对应规则：
 * 1. 账号身份命中连接级绑定 → 只走池；
 * 2. 无账号身份（免费供应商）且配了供应商级轮询 → 按策略挑池；
 * 3. 其余 → 跟随全局代理状态。
 *
 * 供应商级只在**解析不出账号身份**时生效：有账号的供应商一旦没绑定，就不该被
 * 供应商级配置偷偷接管（那会变成「所有账号共享一条池」的隐式兜底）。
 */
export function resolveProviderProxyRoute(input: ResolveProviderProxyRouteInput): ProviderProxyRoute {
  const entry = resolveProviderProxyBindingEntry(input.binding, input.accountId);
  if (entry) {
    // 停用 = 用户明确表示这条线路先别用：等价于未绑定，跟随全局代理状态。
    // agent 侧单独判断一次（而不是只依赖 host 摘绑定）：agent 拿到的是 provider config
    // 快照，host 落盘之前它可能还持有指向停用池的旧绑定，两处判断必须同源。
    if (!entry.isActive) {
      return { kind: "inherit" };
    }
    return isProxyPoolEntryUsable(entry) ? { kind: "pool", entry } : { kind: "no-proxy" };
  }
  if (input.accountId?.trim()) {
    return { kind: "inherit" };
  }
  const rotation = input.binding?.provider;
  if (!rotation) {
    return { kind: "inherit" };
  }
  const picked = pickProviderProxyRotationEntry(rotation, input.providerId ?? "");
  if (!picked) {
    return { kind: "inherit" };
  }
  if (!picked.isActive) {
    return { kind: "inherit" };
  }
  if (!isProxyPoolEntryUsable(picked)) {
    return { kind: "no-proxy" };
  }
  return { kind: "pool", entry: picked };
}

/**
 * 该池条目此刻是否可用：启用中且 URL 通过白名单校验。
 *
 * URL 单独再校验一次而不是只信任写入路径：provider config 可能被手工编辑或被旧版本写入，
 * 落地点是 `ProxyAgent` / `socks-proxy-agent` 的构造，非法值会直接抛。
 */
export function isProxyPoolEntryUsable(entry: ProxyPoolEntry | undefined): entry is ProxyPoolEntry {
  return Boolean(entry?.isActive && validateProxyPoolUrl(entry.proxyUrl).ok);
}

/**
 * 本次请求的出口决策结果。
 *
 * - `pool`：用这条池条目。**全局代理被完全排除**。
 * - `no-proxy`：这条连接绑了池，但该池的 URL 非法（手工改过配置）。直连，
 *   **同样不回落到全局代理**——线路已经配坏，偷偷改走全局代理比失败更难排查。
 *   （9router 在这里会退回 envProxy；XCode 选更保守的一侧：宁可直连也不静默换线路。）
 * - `inherit`：该连接未绑定（或请求没有账号身份、绑定的池已停用），出口跟随
 *   XCode 全局代理状态：全局配了代理就走它，没配就直连。
 *
 * 「停用」与「URL 非法」刻意区别对待：停用是用户的明确意图（这条线路先别用），
 * 因此等价于未绑定；URL 非法是配置错误，不能猜用户想走哪条线路。
 */
export type ProviderProxyRoute =
  | { kind: "pool"; entry: ProxyPoolEntry }
  | { kind: "no-proxy" }
  | { kind: "inherit" };

export interface ResolveProviderProxyRouteInput {
  binding: ProviderProxyBinding | undefined;
  /** 本次请求所属的账号 id；无账号身份（解析不出）时才启用供应商级轮询。 */
  accountId?: string | undefined;
  /** 供应商 id；供应商级轮询游标的键。 */
  providerId?: string | undefined;
}

/**
 * 池列表变化后，把绑定表里的快照刷到最新。
 *
 * 指向**已删除或已停用**条目的键会被丢掉（该连接回到「未绑定」= 跟随全局代理）；
 * 条目改名 / 改 URL / 改 noProxy / 改 strictProxy 会被就地更新。
 * 供应商级候选池同样按 id 刷新并剔除失效条目；候选清空则整块 provider 掉线。
 * 返回 undefined 表示绑定已空。
 */
export function refreshProviderProxyBinding(
  binding: ProviderProxyBinding | undefined,
  pools: readonly ProxyPoolEntry[],
): ProviderProxyBinding | undefined {
  if (!binding) {
    return undefined;
  }
  const byId = new Map(pools.map((pool) => [pool.id, pool]));
  const bindings: Record<string, ProxyPoolEntry> = {};
  for (const [accountId, entry] of Object.entries(binding.bindings)) {
    const next = byId.get(entry.id);
    if (next && next.isActive) {
      bindings[accountId] = next;
    }
  }

  let provider: ProviderProxyRotation | undefined;
  if (binding.provider) {
    if (binding.provider.strategy === "none") {
      // 固定线路：只保留用户选中的那一条（按 id 刷新快照）。
      const first = binding.provider.pools[0]
        ? byId.get(binding.provider.pools[0].id)
        : undefined;
      if (first && first.isActive) {
        provider = { strategy: "none", pools: [first] };
      }
    } else {
      // 轮询/随机：候选 = 用户显式选中的子集（按 id 刷新快照），只保留仍然启用中的。
      // 用户配了「只用这几条线路轮换」就只该用这几条；把所有启用池都塞进来会让
      // 刚加的、或明确不想用的池混进轮换队列。选中的池全部失效时退回全量启用池，
      // 否则供应商会静默变成「跟随全局」，与用户选过轮询的意图相反。
      const selected = binding.provider.pools
        .map((entry) => byId.get(entry.id))
        .filter((entry): entry is ProxyPoolEntry => Boolean(entry?.isActive));
      const rotated = selected.length > 0 ? selected : pools.filter((pool) => pool.isActive);
      if (rotated.length > 0) {
        provider = { strategy: binding.provider.strategy, pools: rotated };
      }
    }
  }

  if (Object.keys(bindings).length === 0 && !provider) {
    return undefined;
  }
  return {
    bindings,
    ...(provider ? { provider } : {}),
  };
}

/**
 * 设置（或清除）供应商级轮询配置。
 *
 * `rotation` 为 undefined = 清除供应商级出口（回到「跟随全局代理状态」），
 * 已被停用的条目在这里同样按「不存在」处理。
 * 连接级绑定保持原样。
 */
export function assignProviderProxyRotation(
  binding: ProviderProxyBinding | undefined,
  rotation: ProviderProxyRotation | undefined,
): ProviderProxyBinding | undefined {
  const bindings = { ...(binding?.bindings ?? {}) };
  if (rotation && rotation.pools.length > 0) {
    return { bindings, provider: rotation };
  }
  if (Object.keys(bindings).length === 0) {
    return undefined;
  }
  return { bindings };
}

/**
 * 摘掉供应商级轮询配置，只留连接级绑定；摘空则返回 undefined。
 *
 * 用于「该供应商不支持 provider 级出口」时的 read-repair：给它配过池（或早期版本配过）的
 * 供应商必须真的回到「跟随全局代理状态」，而不是只把 UI 入口藏起来——否则 agent 侧仍会按
 * 存量配置绕池，UI 与真实出口不一致。
 */
export function dropProviderProxyRotation(
  binding: ProviderProxyBinding | undefined,
): ProviderProxyBinding | undefined {
  if (!binding?.provider) {
    return binding;
  }
  if (Object.keys(binding.bindings).length === 0) {
    return undefined;
  }
  return { bindings: binding.bindings };
}

/**
 * 批量：把同一条池套用到给定连接。
 *
 * `entry` 为 undefined = 清除这些连接的绑定（回到「跟随全局代理状态」）。
 * 不在 accountIds 里的连接保持原样。
 */
export function assignProxyPoolToBindings(
  binding: ProviderProxyBinding | undefined,
  accountIds: readonly string[],
  entry: ProxyPoolEntry | undefined,
): ProviderProxyBinding | undefined {
  const bindings: Record<string, ProxyPoolEntry> = { ...(binding?.bindings ?? {}) };
  for (const accountId of accountIds) {
    const key = accountId.trim();
    if (!key) continue;
    if (entry) {
      bindings[key] = entry;
    } else {
      delete bindings[key];
    }
  }
  if (Object.keys(bindings).length === 0) {
    return binding?.provider ? { bindings, provider: binding.provider } : undefined;
  }
  return { bindings, ...(binding?.provider ? { provider: binding.provider } : {}) };
}

/**
 * 批量：按顺序把多个池轮流分配到给定连接。
 *
 * 这就是 9router 实现「连接级轮询」的方式——每条连接固定绑一个池，不同连接拿不同池；
 * 而不是让单条连接的请求在多个池之间漂移。重复点击结果稳定（每次都从第一个池开始）。
 */
export function distributeProxyPoolsToBindings(
  binding: ProviderProxyBinding | undefined,
  accountIds: readonly string[],
  entries: readonly ProxyPoolEntry[],
): ProviderProxyBinding | undefined {
  if (entries.length === 0) {
    return binding;
  }
  const bindings: Record<string, ProxyPoolEntry> = { ...(binding?.bindings ?? {}) };
  for (const [index, accountId] of accountIds.entries()) {
    const key = accountId.trim();
    if (!key) continue;
    bindings[key] = entries[index % entries.length]!;
  }
  return { bindings, ...(binding?.provider ? { provider: binding.provider } : {}) };
}

// ── 持久化 schema ──

const proxyPoolTypeSchema = z.enum(PROXY_POOL_TYPES);

/**
 * 池条目 schema。
 *
 * proxyUrl 只做「非空 + 无注入字符」的宽松校验，不做 scheme 白名单——
 * 存量配置若出现不受支持的 scheme，schema 拒绝会让**整份 setting.json** 回退默认值
 * （settingService 的 safeParse 失败即整体丢弃），代价远大于收益。
 * 白名单只在写入路径与生效路径（validateProxyPoolUrl）上强制。
 */
export const proxyPoolEntrySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  proxyUrl: z.string().trim().min(1),
  noProxy: z.string().trim().min(1).optional(),
  isActive: z.boolean().default(true),
  type: proxyPoolTypeSchema.default("http"),
  strictProxy: z.boolean().optional(),
});

export const proxyPoolSettingsSchema = z.object({
  pools: z.array(proxyPoolEntrySchema).default([]),
});

const providerProxyRotationSchema = z
  .object({
    strategy: z.enum(["none", "round-robin", "random"]).default("none"),
    pools: z.array(proxyPoolEntrySchema).default([]),
  })
  .strict();

/**
 * 代理绑定 schema；同时用于 provider config 的 api.proxy 字段。
 *
 * preprocess 把无法识别的形状（旧版供应商级绑定 enabled/strategy/entryIds/entries[]/
 * accountBindings，以及任何脏数据）一律降级为 `null`（= 未绑定），而不是让 safeParse 失败：
 * provider config 是整份 overlay 一起校验的，一个存量 `api.proxy` 解析失败会把该 Provider 的
 * baseUrl / headers / 模型列表一起丢掉。降级的代价只是用户重新绑一次池，行为是
 * 「跟随全局代理」这个可解释的默认值。
 *
 * `provider` 单独校验：坏掉的轮询配置只丢这一块，不连累连接级 bindings。
 */
export const providerProxyBindingSchema = z.preprocess(
  (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const bindings = (value as { bindings?: unknown }).bindings;
      const provider = (value as { provider?: unknown }).provider;
      const bindingsValid =
        bindings && typeof bindings === "object" && !Array.isArray(bindings);
      const providerParsed = providerProxyRotationSchema.safeParse(provider);
      const providerValid = providerParsed.success && providerParsed.data.pools.length > 0;
      // 旧版形状（enabled/strategy/entryIds/accountBindings）里既没有 bindings 也没有
      // 可用的 provider：整块降级为 null，保持改动前的 read-repair 行为。
      if (!bindingsValid && !providerValid) {
        return null;
      }
      const result: { bindings: unknown; provider?: unknown } = {
        bindings: bindingsValid ? bindings : {},
      };
      if (providerValid) {
        result.provider = providerParsed.data;
      }
      return result;
    }
    return null;
  },
  z
    .object({
      bindings: z.record(z.string().trim().min(1), proxyPoolEntrySchema).default({}),
      provider: providerProxyRotationSchema.optional(),
    })
    .strict()
    .nullable(),
);

/** 读取侧规范化：丢掉不合法的池条目而不是让整份设置回退默认。 */
export function sanitizeProxyPoolSettings(value: unknown): ProxyPoolSettings {
  const parsed = proxyPoolSettingsSchema.safeParse(value);
  if (!parsed.success) {
    return { ...DEFAULT_PROXY_POOL_SETTINGS, pools: [] };
  }
  return { pools: parsed.data.pools };
}

/** 生成池条目 id；renderer/host 两侧都可用（不依赖 node:crypto）。 */
export function createProxyPoolId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `pool-${Date.now().toString(36)}-${random}`;
}
