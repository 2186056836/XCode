/**
 * 供应商网络出口（browser-safe 契约 + 进程内解析器）。
 *
 * 为什么需要这一层：Host 侧与供应商相关的网络调用（Qoder / CodeBuddy 的登录、签到、
 * 额度、上游模型目录）过去清一色是裸 `fetch` —— 既不认 XCode 全局代理，也无从知道
 * 该供应商配了代理池。这里给出唯一的解析入口：
 *
 * - 供应商配了代理池 → 走池（见 providerPoolFetch.ts，host 装配）
 * - 未配置 / 账号选「直连」→ 跟随 XCode 全局代理状态
 *
 * 本文件会被 UI 拖进 renderer bundle（providerFacadeServices → qoderAuth 等），
 * 因此**不得** import 任何 node 内置模块或 undici：只持有解析器引用与类型。
 */
/** 供应商 id 常量：与 config/provider/zcode-builtin.json 的 providerId 一一对应。 */export const PROVIDER_ID_QODER_INTL = "other:qoder";
export const PROVIDER_ID_QODER_CN = "other:qoder-cn";
export const PROVIDER_ID_CODEBUDDY_INTL = "other:codebuddy";
export const PROVIDER_ID_CODEBUDDY_CN = "other:codebuddy-cn";

export type ProviderNetworkRegion = "cn" | "intl";

/** Qoder 的 region → providerId。两区是两个独立供应商，代理绑定也各自独立。 */
export function qoderProviderId(region: ProviderNetworkRegion): string {
  return region === "cn" ? PROVIDER_ID_QODER_CN : PROVIDER_ID_QODER_INTL;
}

export function codeBuddyProviderId(region: ProviderNetworkRegion): string {
  return region === "cn" ? PROVIDER_ID_CODEBUDDY_CN : PROVIDER_ID_CODEBUDDY_INTL;
}

/**
 * providerId → region，qoderProviderId / codeBuddyProviderId 的逆函数。
 *
 * 账号表按区分开：`other:qoder` 与 `other:qoder-cn` 各有自己的账号，互不可见。
 * 列账号时必须用本函数定位到该供应商自己那一个区，不能把两区合并——否则
 * 「共 N 个账号」会大于账号行数，批量分配也会写到另一个区的账号 id 上。
 *
 * 非账号型供应商返回 undefined（调用方据此返回空列表）。
 */
export function providerNetworkRegion(providerId: string): ProviderNetworkRegion | undefined {
  switch (providerId) {
    case PROVIDER_ID_QODER_CN:
    case PROVIDER_ID_CODEBUDDY_CN:
      return "cn";
    case PROVIDER_ID_QODER_INTL:
    case PROVIDER_ID_CODEBUDDY_INTL:
      return "intl";
    default:
      return undefined;
  }
}

export type ProviderFetchResolver = (providerId: string, accountId?: string) => typeof fetch;

let resolveProviderFetch: ProviderFetchResolver | null = null;

/** node.ts 装配时注入。传 null 表示取消装配（测试/回退）。 */
export function setProviderFetchResolver(resolver: ProviderFetchResolver | null): void {
  resolveProviderFetch = resolver;
}

/**
 * 取某供应商（可指定账号）的出口 fetch。
 *
 * 未装配解析器时回退裸 `fetch`，与引入本模块前的行为完全一致 ——
 * 这样单测与 renderer 侧（不做真实请求）不会因为缺装配而炸。
 */
export function providerFetch(providerId: string, accountId?: string): typeof fetch {
  if (!resolveProviderFetch) return fetch;
  return resolveProviderFetch(providerId, accountId);
}

const QODER_IDENTITY_USER_ID_HEADER = "x-qoder-internal-user-id";

/**
 * 从请求上下文解析账号 id —— 与 agent 侧 resolveProviderProxyAccountId 同规则：
 * Qoder 读内部身份头，CodeBuddy 读 JWT（apiKey/accessToken）的 `sub`。
 *
 * 只用于「选哪条代理」，不参与任何鉴权判定，因此不做签名校验。
 */
export function resolveProviderAccountId(input: {
  headers?: Record<string, string> | undefined;
  token?: string | undefined;
}): string | undefined {
  if (input.headers) {
    for (const [key, value] of Object.entries(input.headers)) {
      if (key.toLowerCase() === QODER_IDENTITY_USER_ID_HEADER) {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (trimmed) return trimmed;
      }
    }
  }
  return readJwtSubject(input.token);
}

function readJwtSubject(token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  const payload = trimmed.split(".")[1];
  if (!payload) return undefined;
  // atob / TextDecoder 都是 web 标准全局：本模块不得碰 Buffer 等 node 内置。
  if (typeof atob !== "function" || typeof TextDecoder !== "function") return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object") return undefined;
    const sub = (parsed as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.trim() ? sub.trim() : undefined;
  } catch {
    return undefined;
  }
}
