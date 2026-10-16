/**
 * 代理池（Proxy Pool）共享契约 —— 池条目、URL 校验、供应商绑定与策略解析的单一事实源。
 *
 * 设计分层（两部分，互不耦合）：
 * 1. **池条目** `ProxyPoolEntry`：全局共享的代理列表，存在 AppSettings.proxyPools（setting.json）。
 *    纯 CRUD + 测试，本身不决定谁用它。
 * 2. **供应商绑定** `ProviderProxyBinding`：存在 provider config 的 `api.proxy`，决定某个供应商
 *    （Qoder / CodeBuddy / 自定义…）用池里的哪些条目、按什么策略、哪个账号绑哪个条目。
 *
 * 为什么绑定要内联条目（`entries`）：provider config 会随 Registry 下发到 agent 子进程，
 * 而 agent 无法读 host 的设置文件。内联后 agent 侧自包含解析，不产生跨进程读设置的耦合。
 * `entryIds` 与 `entries` 同时保留：entryIds 是 UI 的编辑意图（用户选了哪几个池），
 * entries 是保存时按当前池列表物化的快照（agent 只读它）。
 *
 * 与现有全局代理的关系：**完全独立**。全局 httpProxy 由 Electron session 与 agent 子进程
 * 环境变量层管理（重启生效）；供应商级代理是请求级的，不配置即直连，**不 fallback 到全局代理**。
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

/**
 * 供应商级轮询策略。
 * - fixed：固定用第一个（或账号绑定指定的那个）。
 * - round-robin：按供应商独立的内存计数轮询（重启重置）。
 * - random：均匀随机。
 */
export const PROVIDER_PROXY_STRATEGIES = ["fixed", "round-robin", "random"] as const;
export type ProviderProxyStrategy = (typeof PROVIDER_PROXY_STRATEGIES)[number];

/** 池条目；id 由服务层生成，UI 只读。 */
export interface ProxyPoolEntry {
  id: string;
  name: string;
  proxyUrl: string;
  /** 该条目的绕过规则；留空表示继承绑定的 noProxy。 */
  noProxy?: string;
  isActive: boolean;
  type: ProxyPoolType;
}

/** 全局池列表容器；存在 AppSettings.proxyPools。 */
export interface ProxyPoolSettings {
  pools: ProxyPoolEntry[];
}

export const DEFAULT_PROXY_POOL_SETTINGS: ProxyPoolSettings = { pools: [] };

/**
 * 供应商级代理绑定；存在 provider config 的 `api.proxy`。
 *
 * accountBindings 的 key 是**账号 id**，取值规则见 resolveProviderProxyAccountId：
 * - Qoder：内部身份头 `x-qoder-internal-user-id`
 * - CodeBuddy：apiKey（JWT）的 `sub`
 * - 其他供应商：无账号概念，不填 accountBindings，只走策略
 */
export interface ProviderProxyBinding {
  enabled: boolean;
  strategy: ProviderProxyStrategy;
  /** 用户选中的池条目 id（UI 编辑意图）。 */
  entryIds: string[];
  /** 保存时按池列表物化的条目快照；agent 侧只读这里。 */
  entries: ProxyPoolEntry[];
  /** accountId → entryId；命中的账号固定用该条目，忽略 strategy。 */
  accountBindings?: Record<string, string>;
  /** 该供应商的绕过规则；留空表示不绕过任何主机。 */
  noProxy?: string;
}

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
 * 把用户填写的绕过规则规范化为逗号分隔串；空值返回 undefined（表示「不覆盖」）。
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

export interface PickProviderProxyInput {
  binding: ProviderProxyBinding;
  /** 当前请求的账号 id；无账号概念时为 undefined。 */
  accountId?: string;
  /**
   * round-robin 计数的内存态。由调用方持有并跨请求复用（agent 进程内 per-provider Map）；
   * 传入 undefined 时退化为「取第一个」，保持本函数纯函数可用。
   */
  rotation?: { value: number };
}

/** 过滤出绑定中真正可用的条目：isActive 且 URL 通过白名单校验。 */
export function selectUsableProviderProxyEntries(
  binding: ProviderProxyBinding | undefined,
): ProxyPoolEntry[] {
  if (!binding?.enabled || !binding.entries?.length) {
    return [];
  }
  return binding.entries.filter(
    (entry) => entry.isActive && validateProxyPoolUrl(entry.proxyUrl).ok,
  );
}

/**
 * 按绑定解析本次请求使用的池条目。
 *
 * 优先级（对齐 9router 的 account → strategy 两级）：
 * 1. enabled 为 false → 不用代理
 * 2. 当前账号在 accountBindings 里且该条目可用 → 用它（固定）
 * 3. 否则按 strategy：fixed 取第一个 / round-robin 内存计数 / random 随机
 * 4. 无可用条目 → 不用代理
 *
 * 注意：**不 fallback 到全局 httpProxy**。供应商级代理没配就是直连，
 * 全局代理由 Electron session 与 agent 子进程环境变量层自己管。
 */
export function pickProviderProxyEntry(
  input: PickProviderProxyInput,
): ProxyPoolEntry | undefined {
  const { binding, accountId, rotation } = input;
  const usable = selectUsableProviderProxyEntries(binding);
  if (usable.length === 0) {
    return undefined;
  }

  const boundEntryId = accountId ? binding.accountBindings?.[accountId] : undefined;
  if (boundEntryId) {
    const bound = usable.find((entry) => entry.id === boundEntryId);
    if (bound) {
      return bound;
    }
    // 绑定指向的条目被停用/删除时继续走策略：账号级绑定失效不应让该账号完全无法请求。
  }

  if (usable.length === 1 || binding.strategy === "fixed") {
    return usable[0];
  }
  if (binding.strategy === "round-robin") {
    if (!rotation) {
      return usable[0];
    }
    rotation.value = (rotation.value + 1) % usable.length;
    return usable[rotation.value];
  }
  // random（以及未知策略）
  return usable[Math.floor(Math.random() * usable.length)];
}

/**
 * 把 entryIds 物化成条目快照。
 *
 * 保存供应商绑定时调用：按当前池列表把用户选中的 id 展开成完整条目，
 * 让 provider config 自包含。找不到的 id 静默丢弃（池被删除后绑定自然收敛）。
 */
export function materializeProviderProxyEntries(
  entryIds: readonly string[],
  pools: readonly ProxyPoolEntry[],
): ProxyPoolEntry[] {
  const byId = new Map(pools.map((pool) => [pool.id, pool]));
  const seen = new Set<string>();
  const entries: ProxyPoolEntry[] = [];
  for (const id of entryIds) {
    if (seen.has(id)) continue;
    const pool = byId.get(id);
    if (!pool) continue;
    seen.add(id);
    entries.push(pool);
  }
  return entries;
}

/**
 * 池列表变化后，把绑定里的 entries 快照刷新到最新。
 *
 * 返回 undefined 表示「无需改动」，调用方据此跳过写盘。
 * accountBindings 里指向已删除条目的键会被清掉，避免长期积累死绑定。
 */
export function refreshProviderProxyEntries(
  binding: ProviderProxyBinding | undefined,
  pools: readonly ProxyPoolEntry[],
): ProviderProxyBinding | undefined {
  if (!binding?.enabled || binding.entryIds.length === 0) {
    return undefined;
  }
  const nextEntries = materializeProviderProxyEntries(binding.entryIds, pools);
  const liveIds = new Set(nextEntries.map((entry) => entry.id));
  const currentBindings = binding.accountBindings ?? {};
  const nextBindings: Record<string, string> = {};
  let bindingsChanged = false;
  for (const [accountId, entryId] of Object.entries(currentBindings)) {
    if (liveIds.has(entryId)) {
      nextBindings[accountId] = entryId;
    } else {
      bindingsChanged = true;
    }
  }
  if (
    !bindingsChanged &&
    JSON.stringify(nextEntries) === JSON.stringify(binding.entries)
  ) {
    return undefined;
  }
  return {
    ...binding,
    entries: nextEntries,
    ...(Object.keys(nextBindings).length > 0
      ? { accountBindings: nextBindings }
      : { accountBindings: undefined }),
  };
}

// ── 持久化 schema ──

const proxyPoolTypeSchema = z.enum(PROXY_POOL_TYPES);
const providerProxyStrategySchema = z.enum(PROVIDER_PROXY_STRATEGIES);

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
});

export const proxyPoolSettingsSchema = z.object({
  pools: z.array(proxyPoolEntrySchema).default([]),
});

/** 供应商级绑定 schema；同时用于 provider config 的 api.proxy 字段。 */
export const providerProxyBindingSchema = z.object({
  enabled: z.boolean().default(false),
  strategy: providerProxyStrategySchema.default("fixed"),
  entryIds: z.array(z.string().trim().min(1)).default([]),
  entries: z.array(proxyPoolEntrySchema).default([]),
  accountBindings: z.record(z.string(), z.string()).optional(),
  noProxy: z.string().trim().min(1).optional(),
});

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
