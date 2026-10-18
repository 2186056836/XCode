import { createHash, createCipheriv, publicEncrypt, randomUUID, constants as cryptoConstants } from "node:crypto";
import { mapReasoningEffortForQoder } from "@zcode/shared";
/**
 * XCode fork：Qoder 推理协议移植（对齐 9router open-sse/shared/qoder +
 * executors/qoder.js）。
 *
 * Qoder 的聊天端点 `sse/agent_chat_generation` 不是 OpenAI 兼容格式：
 *   - 请求体需要 COSY 签名（RSA+AES+MD5 + ~17 个 Cosy-* 头）并用 WAF
 *     绕过编码（base64 三段重排 + 自定义字母表 + &Encode=1）发送；
 *   - 响应 SSE 是 `{statusCodeValue, body}` 信封，body 才是 OpenAI 形状
 *     的 chunk，且 usage 在 finish 之后的 choices:[] 帧上、socket 在
 *     终止帧后保持打开（keepalive）。
 * 本模块提供：区域端点、COSY 头构造、body 编码、model_config 目录
 * （COSY GET /algo/api/v2/model/list，必须存在否则上游静默换模型）、
 * OpenAI→Qoder payload 构造、以及信封 SSE→OpenAI SSE 的解包合并。
 *
 * 身份来源：调用方（requestProfile 分支）从 overlay 的内部身份头读取
 * userId/machineId/name/email，与 apiKey（dt- 设备令牌 / jt- 任务令牌 /
 * pt- 个人访问令牌）一起传入。
 */

export type QoderRegion = "cn" | "intl";

export interface QoderRegionEndpoints {
  /** 推理（chat + model list，COSY 签名）。 */
  chat: string;
  chatAlt?: string;
  openApi: string;
  login: string;
  /** PAT→job token 交换（非 COSY，纯 JSON POST）。 */
  jobTokenExchange: string;
}

const REGION_ENDPOINTS: Record<QoderRegion, QoderRegionEndpoints> = {
  cn: {
    chat: "https://gateway.qoder.com.cn",
    openApi: "https://openapi.qoder.com.cn",
    login: "https://qoder.com.cn/device/selectAccounts",
    jobTokenExchange: "https://openapi.qoder.com.cn/api/v1/jobToken/exchange",
  },
  intl: {
    chat: "https://api3.qoder.sh",
    chatAlt: "https://api2.qoder.sh",
    openApi: "https://openapi.qoder.sh",
    login: "https://qoder.com/device/selectAccounts",
    jobTokenExchange: "https://openapi.qoder.sh/api/v1/jobToken/exchange",
  },
};

// PRO 激活（ping / status / claim）由 packages/services 的 qoderAuth 独占实现，
// 本模块只负责推理链路的签名与信封解包，不重复一份。

function regionConfig(region: QoderRegion): QoderRegionEndpoints {
  return REGION_ENDPOINTS[region];
}

const CHAT_SIG_PATH = "/algo/api/v2/service/pro/sse/agent_chat_generation";
const MODEL_LIST_PATH = "/algo/api/v2/model/list";

// 客户端指纹常量。取值来自 Qoder IDE 2026-10-01 实机抓包（agent_chat_generation），
// 旧值（IDE 1.0.0 / clienttype 5 / machinetype 5）是 9router 原版从 CLIProxyAPIPlus
// 抄来的历史值，官方 IDE 早已不再使用，形状差异本身就是一个可检测特征。
const QODER_IDE_VERSION = "1.32.2";
const QODER_CLIENT_TYPE = "0";
const QODER_DATA_POLICY = "disagree";
const QODER_LOGIN_VERSION = "v2";
const QODER_MACHINE_OS = "x86_64_windows";
const QODER_MACHINE_TYPE = "945d1ba41479d5d140";
const FETCH_TIMEOUT_MS = 30_000;

/**
 * 该模型自己宣告的思考强度档位（`thinking_config.enabled.efforts` 的键）。
 *
 * 上游值域是**逐模型**的，不是全局的：实抓 `/model/list` 得到
 * `qmodel_38max`/`qfmodel` = {xhigh, low, medium}（没有 `high`）、
 * `gmodel`/`kmodel`/`dmodel` 系 = {high, low, max}（没有 `xhigh`）、
 * `ultimate`/`Sonus`/`Cantus` = {xhigh, high, low, max, medium}（两者并存）。
 * GLM 一路会真的按这个值域拒收越界档位，所以发请求前必须按它夹一次。
 *
 * 目录无 `enabled.efforts`（关闭/仅开关形态）时返回 undefined，表示
 * 「该模型没有可调档位信息」，由调用方按上游默认处理。
 */
function resolveModelThinkingEfforts(modelConfig: QoderModelConfig): string[] | undefined {
  const rawThinking = (modelConfig as Record<string, unknown>).thinking_config;
  if (!rawThinking || typeof rawThinking !== "object") return undefined;
  const enabled = (rawThinking as Record<string, unknown>).enabled;
  if (!enabled || typeof enabled !== "object") return undefined;
  const efforts = (enabled as Record<string, unknown>).efforts;
  if (!efforts || typeof efforts !== "object" || Array.isArray(efforts)) return undefined;
  const keys = Object.keys(efforts as Record<string, unknown>);
  return keys.length > 0 ? keys : undefined;
}

/**
 * 发给上游的上下文长度 = **该模型的最大档**：从目录 context_config（map 或
 * 数组形态）里取最大的 token_count，同时镜像到 parameters.context_length 与
 * model_config.max_input_tokens（官方形状：参数值与所选档位一致）。
 * 目录无档位信息时不发 context_length，model_config 保留目录原值。
 */
function resolveMaxContextTokens(modelConfig: QoderModelConfig): number | undefined {
  const rawContext = (modelConfig as Record<string, unknown>).context_config;
  if (!rawContext || typeof rawContext !== "object") return undefined;
  const values: number[] = [];
  const collect = (record: Record<string, unknown>) => {
    const tokenCount =
      typeof record.token_count === "number"
        ? record.token_count
        : typeof record.max_input_tokens === "number"
          ? record.max_input_tokens
          : undefined;
    if (tokenCount && tokenCount > 0) values.push(tokenCount);
  };
  if (Array.isArray(rawContext)) {
    for (const tier of rawContext) {
      if (tier && typeof tier === "object") collect(tier as Record<string, unknown>);
    }
  } else {
    for (const value of Object.values(rawContext as Record<string, unknown>)) {
      if (value && typeof value === "object") collect(value as Record<string, unknown>);
    }
  }
  return values.length > 0 ? Math.max(...values) : undefined;
}

// qodercli 内嵌的 RSA 公钥（仅用于加密随 COSY-Key 上行的 AES 会话钥）。
const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

/** 推理主机路由：CN 单网关；Intl 设备/任务令牌走 api3，任务令牌走 api2。 */
export function qoderInferenceBase(
  region: QoderRegion,
  tokenKind: QoderTokenKind,
): string {
  const endpoints = REGION_ENDPOINTS[region];
  if (region === "cn") return endpoints.chat;
  return tokenKind === "jt" ? (endpoints.chatAlt ?? endpoints.chat) : endpoints.chat;
}

export function qoderDeviceTokenUrl(region: QoderRegion): string {
  return `${REGION_ENDPOINTS[region].openApi}/api/v1/deviceToken/poll`;
}

export function qoderUserInfoUrl(region: QoderRegion): string {
  return `${REGION_ENDPOINTS[region].openApi}/api/v1/userinfo`;
}

export function qoderLoginUrl(region: QoderRegion): string {
  return `${REGION_ENDPOINTS[region].login}/device/selectAccounts`.replace(
    "/device/device/",
    "/device/",
  );
}

export function qoderJobTokenExchangeUrl(region: QoderRegion): string {
  return REGION_ENDPOINTS[region].jobTokenExchange;
}

// ---------------------------------------------------------------------------
// COSY 签名
// ---------------------------------------------------------------------------

function pkcs7Pad(data: Buffer, blockSize: number): Buffer {
  const padding = blockSize - (data.length % blockSize);
  const padded = Buffer.alloc(data.length + padding, padding);
  data.copy(padded, 0);
  return padded;
}

function aesEncryptCbcBase64(plaintext: string, keyStr: string): string {
  const keyBytes = Buffer.from(keyStr, "utf8");
  if (keyBytes.length !== 16) throw new Error(`aes key must be 16 bytes`);
  const iv = keyBytes.subarray(0, 16);
  const cipher = createCipheriv("aes-128-cbc", keyBytes, iv);
  cipher.setAutoPadding(false);
  const padded = pkcs7Pad(Buffer.from(plaintext, "utf8"), 16);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function rsaEncryptBase64(data: string): string {
  return publicEncrypt(
    { key: QODER_RSA_PUBLIC_KEY, padding: cryptoConstants.RSA_PKCS1_PADDING },
    Buffer.from(data, "utf8"),
  ).toString("base64");
}

function md5Hex(input: string | Buffer): string {
  return createHash("md5").update(input).digest("hex");
}

/** 去掉路径开头的 /algo 前缀（qodercli 约定）。 */
function computeSigPath(requestUrl: string): string {
  let pathname = "";
  try {
    pathname = new URL(requestUrl).pathname || "";
  } catch {
    return "";
  }
  return pathname.startsWith("/algo") ? pathname.slice("/algo".length) : pathname;
}

export interface QoderCosyCredentials {
  userId: string;
  authToken: string;
  name?: string;
  email?: string;
  machineId?: string;
}

/** 构造一次 Qoder 请求的完整 Cosy-* 头集合（签名基于编码后的 body 字节）。 */
export function buildCosyHeaders(
  bodyBuf: Buffer,
  requestUrl: string,
  creds: QoderCosyCredentials,
): Record<string, string> {
  if (!creds.userId) throw new Error("cosy: user id is empty");
  if (!creds.authToken) throw new Error("cosy: auth token is empty");

  const aesKey = randomUUID().slice(0, 16);
  const info = aesEncryptCbcBase64(
    JSON.stringify({
      uid: creds.userId,
      security_oauth_token: creds.authToken,
      name: creds.name || "",
      aid: "",
      email: creds.email || "",
    }),
    aesKey,
  );
  const cosyKey = rsaEncryptBase64(aesKey);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = randomUUID();
  const payloadB64 = Buffer.from(
    JSON.stringify({
      version: "v1",
      requestId,
      info,
      cosyVersion: QODER_IDE_VERSION,
      ideVersion: "",
    }),
    "utf8",
  ).toString("base64");

  const sigPath = computeSigPath(requestUrl);
  const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyBuf.toString("latin1")}\n${sigPath}`;
  const sig = md5Hex(sigInput);

  // 设备指纹必须稳定：同一账号每次请求呈现同一台设备。这里对空值**直接报错**
  // 而不再随机兜底——buildCosyHeaders 每请求调用一次，随机兜底会让指纹逐请求
  // 刷新（上游看到"一个账号一天用了上千台机器"）。稳定兜底由调用方
  // readQoderIdentity 按 userId 提供。
  const machineId = creds.machineId;
  if (!machineId) throw new Error("cosy: machineId is empty (identity not configured)");

  // 设备指纹（live capture 2026-10-01）。这些值必须由 machineId **确定性派生**：
  // 每次请求都换一套指纹比稳定的假指纹更像伪造客户端。
  // 反代场景下 127.0.0.1 这类回环地址是最明显的"我不在IDE 里"信号，
  // 真实 IDE 报的是 NAT 后面的局域网 IP。
  const deviceSeed = md5Hex(`qoder-device:${machineId}`);
  const machineCode = deviceSeed.slice(0, 18);
  const machineHostname = `DESKTOP-${deviceSeed.slice(18, 25).toUpperCase()}`;
  const clientIp =
    `192.168.${parseInt(deviceSeed.slice(0, 2), 16) % 254 + 1}` +
    `.${parseInt(deviceSeed.slice(2, 4), 16) % 254 + 1}`;
  // Alibaba EagleEye 链路追踪头，官方 IDE 恒发。
  const traceparent =
    `00-${md5Hex(`trace:${requestId}`).slice(0, 32)}` +
    `-${md5Hex(`span:${requestId}:${Date.now()}`).slice(0, 16)}-01`;

  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userId,
    "Cosy-Date": timestamp,
    "Cosy-Version": QODER_IDE_VERSION,
    "Cosy-Machineid": machineId,
    "Cosy-Machinetoken": machineId,
    "Cosy-Machinetype": QODER_MACHINE_TYPE,
    "Cosy-Machineos": QODER_MACHINE_OS,
    "Cosy-Machinecode": machineCode,
    "Cosy-Machinehostname": machineHostname,
    "Cosy-Clienttype": QODER_CLIENT_TYPE,
    "Cosy-Clientip": clientIp,
    "Cosy-Bodyhash": md5Hex(bodyBuf),
    "Cosy-Bodylength": String(bodyBuf.length),
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QODER_DATA_POLICY,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QODER_LOGIN_VERSION,
    "X-Request-Id": randomUUID(),
    traceparent,
    baggage: "Eagleeye-Prpc=,Eagleeye-Pappname=fit0dygksm@5deca4ebd39a6e7",
  };
}

// ---------------------------------------------------------------------------
// WAF 绕过 body 编码
// ---------------------------------------------------------------------------

const QODER_STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const QODER_CUSTOM_ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";

const QODER_S2C = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) {
    table[QODER_STD_ALPHABET.charCodeAt(i)] = QODER_CUSTOM_ALPHABET.charCodeAt(i);
  }
  table["=".charCodeAt(0)] = "$".charCodeAt(0);
  return table;
})();

/** base64 → 三段重排（[尾][中][头]）→ 自定义字母表替换（防阿里云 WAF）。 */
export function qoderEncodeBody(plaintext: Buffer | Uint8Array | string): string {
  const buf =
    Buffer.isBuffer(plaintext)
      ? plaintext
      : typeof plaintext === "string"
        ? Buffer.from(plaintext, "utf8")
        : Buffer.from(plaintext);
  const std = buf.toString("base64");
  const n = std.length;
  const a = Math.floor(n / 3);
  const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const code = rearranged.charCodeAt(i);
    out[i] = code < 128 && QODER_S2C[code] >= 0 ? QODER_S2C[code] : code;
  }
  return out.toString("latin1");
}

// ---------------------------------------------------------------------------
// model_config 目录（COSY GET /algo/api/v2/model/list，缓存 1h）
// ---------------------------------------------------------------------------

export interface QoderModelConfig {
  key: string;
  is_reasoning: boolean;
  max_output_tokens: number;
  context_config?: { tiers?: Array<{ name: string; max_input_tokens: number }> };
  [key: string]: unknown;
}

interface QoderCatalog {
  rawConfigs: Map<string, QoderModelConfig>;
  expiresAt: number;
}

const catalogCaches = new Map<string, QoderCatalog>();
const catalogInflight = new Map<string, Promise<QoderCatalog | undefined>>();

function cosyCredsFrom(identity: QoderRequestIdentity): QoderCosyCredentials {
  return {
    userId: identity.userId,
    authToken: identity.accessToken,
    name: identity.name,
    email: identity.email,
    machineId: identity.machineId,
  };
}

async function fetchQoderCatalog(
  region: QoderRegion,
  identity: QoderRequestIdentity,
  fetchImpl: typeof globalThis.fetch,
  log?: { warn(message: string): void },
): Promise<QoderCatalog | undefined> {
  const endpoints = REGION_ENDPOINTS[region];
  const config = regionConfig(region);
  const tokenKind = describeQoderTokenKind(identity.accessToken);
  const base = qoderInferenceBase(region, tokenKind);
  const modelListUrl = `${base}${MODEL_LIST_PATH}`;
  const creds = cosyCredsFrom(identity);
  if (!creds.userId || !creds.authToken) return undefined;

  let response: Response;
  try {
    response = await fetchImpl(modelListUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        // Authorization 必须来自 COSY 签名（Bearer COSY.<payload>.<sig>），
        // 不能被普通 Bearer 覆盖——否则 Cosy-Key/Date/Bodyhash 等签名头还在、
        // 令牌却是无签名的，上游解析必然失败，模型目录恒空。
        ...buildCosyHeaders(Buffer.alloc(0), modelListUrl, creds),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    // 网络层失败（DNS/TLS/超时）同样必须留痕：与 HTTP 非 2xx 一样会让
    // 聊天报 "model_config not available"。
    console.warn(
      `[qoder] model list fetch threw: region=${region} url=${modelListUrl} error=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
  if (!response.ok) {
    // 必须保留：catalog 失败会让聊天报 "model_config not available"，而模型
    // 连通性测试不走这里——症状就是「测试正常、聊天挂」，没有这行日志无从定位。
    console.warn(
      `[qoder] model list fetch failed: region=${region} status=${response.status} url=${modelListUrl}`,
    );
    return undefined;
  }
  const body = (await response.json().catch(() => null)) as { chat?: Array<Record<string, unknown>> } | null;
  if (!body || !Array.isArray(body.chat)) {
    console.warn(`[qoder] model list payload shape unexpected: region=${region}`);
    return undefined;
  }

  const rawConfigs = new Map<string, QoderModelConfig>();
  for (const entry of body.chat) {
    if (!entry || typeof entry !== "object") continue;
    const key = entry.key;
    if (typeof key !== "string" || !key) continue;
    rawConfigs.set(key, { ...entry, key } as QoderModelConfig);
  }
  return { rawConfigs, expiresAt: Date.now() + 60 * 60 * 1000 };
}

export async function getQoderModelConfig(
  region: QoderRegion,
  identity: QoderRequestIdentity,
  modelKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<QoderModelConfig | null> {
  await ensureQoderPatExchanged(region, identity, fetchImpl);
  const cacheKey = `${region}:${identity.userId}:${identity.accessToken.slice(0, 24)}`;
  let catalog = catalogCaches.get(cacheKey);
  if (!catalog || catalog.expiresAt <= Date.now()) {
    const existing = catalogInflight.get(cacheKey);
    const pending: Promise<QoderCatalog | undefined> = existing ?? fetchQoderCatalog(region, identity, fetchImpl);
    if (!existing) catalogInflight.set(cacheKey, pending);
    catalog = await pending;
    catalogInflight.delete(cacheKey);
    if (catalog) catalogCaches.set(cacheKey, catalog);
  }
  const config = catalog?.rawConfigs.get(modelKey);
  return config ? { ...config, key: modelKey } : null;
}

// ---------------------------------------------------------------------------
// PAT（pt-）→ job token（jt-）交换
// ---------------------------------------------------------------------------

interface QoderPatExchangeResult {
accessToken: string;
  userId: string;
  /** job token 失效时间戳；到期需重新交换。 */
  expiresAt: number;
}

const patExchanges = new Map<string, QoderPatExchangeResult>();

export type QoderTokenKind = "dt" | "jt" | "pt" | "other";

export function describeQoderTokenKind(token: string): QoderTokenKind {
  if (token.startsWith("pt-")) return "pt";
  if (token.startsWith("jt-")) return "jt";
  if (token.startsWith("dt-")) return "dt";
  return "other";
}

/** PAT 换取的 job token 默认有效期（上游未给 expires_at 时的兜底）。 */
const PAT_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
/** 剩余有效期低于此值即重新交换，避免边界上用到刚失效的令牌。 */
const PAT_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** PAT 不能直接签 COSY：先换短生命周期 job token（结果按 PAT 缓存到过期前）。 */
export async function ensureQoderPatExchanged(
  region: QoderRegion,
  identity: QoderRequestIdentity,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  if (describeQoderTokenKind(identity.accessToken) !== "pt") return;
  const pat = identity.accessToken;
  const cached = patExchanges.get(pat);
  if (cached && cached.expiresAt - Date.now() > PAT_REFRESH_BUFFER_MS) {
    identity.accessToken = cached.accessToken;
    // userId 一律以交换结果为准：PAT 路径下头部残留的旧 userId 属于
    // 上一个账号，沿用会让 COSY 签名以错误身份发出。
    identity.userId = cached.userId || identity.userId;
    return;
  }
  const response = await fetchImpl(qoderJobTokenExchangeUrl(region), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "qodercli/1.0.0",
      "Cosy-Version": QODER_IDE_VERSION,
      "Cosy-ClientType": QODER_CLIENT_TYPE,
    },
    // 字段名是 personal_token，不是 token。
    body: JSON.stringify({ personal_token: pat }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`qoder PAT exchange failed: ${response.status} ${text.slice(0, 200)}`);
  }
  let body: {
    token?: string;
    refresh_token?: string;
    expires_at?: string;
    expires_in?: number;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error("qoder PAT exchange returned non-JSON body");
  }
  // 响应里是 token / refresh_token，不是 data.accessToken。
  if (!body.token) throw new Error("qoder PAT exchange returned no job token");

  let expiresAt = Date.now() + PAT_DEFAULT_TTL_MS;
  if (typeof body.expires_at === "string") {
    const parsed = Date.parse(body.expires_at);
    if (!Number.isNaN(parsed)) expiresAt = parsed;
  } else if (typeof body.expires_in === "number" && body.expires_in > 0) {
    expiresAt = Date.now() + body.expires_in;
  }

  // job token 同样需要 userId 才能签 COSY，交换响应里没有——补拉一次 userinfo。
  const userId = await fetchQoderUserId(region, body.token, fetchImpl);
  patExchanges.set(pat, { accessToken: body.token, userId, expiresAt });
  identity.accessToken = body.token;
  if (!identity.userId) identity.userId = userId;
}

/** 用 job token 查 userId（COSY 签名必需）。失败返回空串，由调用方兜底。 */
async function fetchQoderUserId(
  region: QoderRegion,
  accessToken: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string> {
  try {
    const response = await fetchImpl(qoderUserInfoUrl(region), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "qodercli/1.0.0",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      userId?: string;
      user_id?: string;
    };
    return data.id ?? data.userId ?? data.user_id ?? "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// OpenAI 请求体 → Qoder payload
// ---------------------------------------------------------------------------

export interface QoderRequestIdentity {
  accessToken: string;
  userId: string;
  machineId?: string;
  name?: string;
  email?: string;
}

interface OpenAiMessage {
  role?: string;
  content?: unknown;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) return String(content);
  // type:"text" 是标准形态，但也有不带 type 只带 text 的块——一并收。
  // 多块之间必须换行分隔，直接相加会把 "a" + "b" 粘成 "ab"。
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (typeof record.text === "string" && record.text) parts.push(record.text);
  }
  return parts.join("\n");
}

function stableHash(input: string): string {
  return createHash("md5").update(input).digest("hex").slice(0, 16);
}

/**
 * 会话记录 ID——必须**内容寻址**。
 *
 * 早期实现是 `md5(userId + model + 消息条数)`，于是同一账号、同模型下任何两条
 * 消息数相同但内容不同的会话都会拿到同一个 id；上游用它标识一条聊天线程，
 * 不同会话会被视作同一线程（上下文串台）。这里对齐 9router fix 版的
 * `stableChatRecordId`：sha256(model + 每条 role/content + tools + maxTokens)。
 */
function stableChatRecordId(
  model: string,
  messages: Array<Record<string, unknown>>,
  tools: unknown,
  maxTokens: number,
): string {
  const hash = createHash("sha256");
  hash.update("qoder-record\0");
  hash.update(String(model));
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role) {
      hash.update("\0");
      hash.update(String(message.role));
    }
    if (typeof message.content === "string" && message.content) {
      hash.update("\0");
      hash.update(message.content);
    }
  }
  if (tools) {
    hash.update("\0");
    try {
      hash.update(JSON.stringify(tools));
    } catch {
      // 工具定义不可序列化时跳过，不影响 id 生成。
    }
  }
  hash.update(`\0mt=${maxTokens}`);
  return hash.digest("hex").slice(0, 16);
}

export interface BuiltQoderRequest {
  url: string;
  bodyBuf: Buffer;
  cosyHeaders: Record<string, string>;
  modelKey: string;
}

/** 由 OpenAI 聊天体构造 Qoder payload，并完成编码 + COSY 签名。 */
export async function buildSignedQoderRequest(params: {
  region: QoderRegion;
  model: string;
  openAiBody: Record<string, unknown>;
  identity: QoderRequestIdentity;
  fetchImpl: typeof globalThis.fetch;
}): Promise<BuiltQoderRequest> {
  const { region, openAiBody, identity, fetchImpl } = params;
  const modelKey = String(openAiBody.model ?? "").replace(/^qoder\//, "");

  await ensureQoderPatExchanged(region, identity, fetchImpl);
  if (!identity.userId) {
    throw new Error("qoder credential is missing userId; reconnect the account");
  }

  const modelConfig = await getQoderModelConfig(region, identity, modelKey, fetchImpl);
  if (!modelConfig) {
    // 这条是聊天报 provider_error(reason=unknown) 的最常见来源：模型目录拉不到
    // 就等于拿不到该模型的 thinking_config/参数模板。上面 fetchQoderCatalog 的
    // warn 会给出 HTTP 状态或网络错误，两条一起看即可定位。
    console.warn(
      `[qoder] model_config missing: region=${region} model=${modelKey} tokenKind=${describeQoderTokenKind(
        identity.accessToken,
      )}`,
    );
    throw new Error(`qoder: model_config for "${modelKey}" not available (model list fetch failed)`);
  }

  // 系统消息保留在 messages 数组内。Qoder **不支持**顶层 `system` 字段——
  // 9router 原版把role:"system" 提上去，上游直接忽略，等于所有系统提示静默丢失。
  const incoming = Array.isArray(openAiBody.messages) ? openAiBody.messages : [];
  const messages: Array<Record<string, unknown>> = [];
  for (const raw of incoming) {
    const message = raw as OpenAiMessage;
    if (!message || typeof message !== "object") continue;
    // 保留消息对象上的其余字段：assistant 的 tool_calls、tool 消息的
    // tool_call_id、name 等。只挑 {role, content} 会让工具结果无法关联回
    // 具体调用，多轮工具调用直接失效。
    messages.push({ ...message, content: extractText(message.content) });
  }

  // patches 里的 edit_system_prompt 是**服务端 persona 路由**通道：官方客户端把
  // system prompt 同时写进 messages[0] 和 patches.g51（并在"o*" slot 放第二份拷贝）。
  // 只写 messages 的话上游仍可能按无 persona 路径处理。
  const lead = messages[0];
  const leadIsSystem = lead?.role === "system";
  const personaText = leadIsSystem ? String(lead?.content ?? "") : "";
  const patches = personaText
    ? {
        g51: [{ action: "edit_system_prompt", content: personaText }],
        "o*": [{ action: "edit_system_prompt", content: personaText }],
      }
    : undefined;

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const lastUser = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";

  const isReasoning = !!modelConfig.is_reasoning;
  const maxOutput = Number(modelConfig.max_output_tokens) || 0;
  let maxTokens = maxOutput > 0 ? maxOutput : 32_768;
  for (const key of ["max_tokens", "max_completion_tokens"]) {
    const value = openAiBody[key];
    if (typeof value === "number" && value > 0 && value < maxTokens) maxTokens = value;
  }

  // 思考强度跟随客户端：模型选项层已把用户的思考强度写成 body.reasoning_effort
  // （关闭族→"none"/"disabled"、开关式旧值→"on"、自定义档位名原样）。
  // 这里按 **白名单** 翻译到 Qoder 的合法值域，绝不原样透传：
  // 上游目录里的档位名（thinking_config.efforts 的键）不受我们控制，
  // 透传一个陌生键会让 Qoder 用 400 拒掉整个请求（2026-10-12 实测原文：
  // 网关层 "expected one of none, minimal, low, medium, high, xhigh, ultra, max"，
  // 下游供应商层更窄、不含 ultra）。
  // 表外的值（关闭族 + 任何未知值）一律不发该字段，上游按自身默认思考。
  //
  // 再夹一层**该模型自己的** efforts 值域：上游值域是逐模型的，实抓目录显示
  // Qwen 系 = {xhigh,low,medium}（没有 high）、GLM/Kimi/DeepSeek 系 = {high,low,max}
  // （没有 xhigh）。GLM 一路会真按目录拒收——gmodel 收到 xhigh 返回
  // 400 code 1210「该模型始终思考…请使用 low、high 或 max。」。
  const reasoningEffort = mapReasoningEffortForQoder(
    openAiBody.reasoning_effort,
    resolveModelThinkingEfforts(modelConfig),
  );

  // 上游上下文 = 该模型最大档（CN 与国际版同规则）
  const maxContextTokens = resolveMaxContextTokens(modelConfig);

  const tools = Array.isArray(openAiBody.tools) ? openAiBody.tools : [];
  const sessionId = stableHash(`qoder-session:${identity.userId}:${modelKey}`);
  const recordId = stableChatRecordId(modelKey, messages, tools, maxTokens);

    // CN 官方 IDE 抓包（2026-10-11，gateway.qoder.com.cn agent_chat_generation）：
    // session_type/business/task_definition_type/metadata 与国际版 CLI 形状不同，
    // 按 region 分流对齐；其余字段两区一致，维持国际版形状。
    const isCn = region === "cn";

    const payload = {
    request_id: randomUUID(),
    request_set_id: recordId,
    chat_record_id: recordId,
    session_id: sessionId,
    stream: true,
    chat_task: "FREE_INPUT",
    is_reply: true,
    is_retry: false,
    source: 1,
    version: "3",
    session_type: isCn ? "assistant" : "qodercli",
    agent_id: "agent_common",
    task_id: "common",
    code_language: "",
    chat_prompt: "",
    image_urls: null,
    aliyun_user_type: "",
    // Qoder 不读顶层 system；系统提示全部走 messages 数组。
    system: "",
    messages,
    tools,
    ...(patches ? { patches } : {}),
    ...(isCn
      ? {
          // CN 官方恒发（agent 模式 + 工作区画像）
          task_definition_type: "system",
          metadata: {
            mode: "agent",
            workspace: { file_count: 0, languages: [], domains: ["non_coding"] },
          },
        }
      : {}),
    parameters: {
      max_tokens: maxTokens,
      max_new_tokens: maxTokens,
      // 上下文 = 模型最大档；目录无档位信息时不发（上游按默认档）。
      ...(maxContextTokens ? { context_length: maxContextTokens } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    },
    chat_context: {
      chatPrompt: "",
      imageUrls: null,
      extra: {
        context: [],
        modelConfig: { key: modelKey, is_reasoning: isReasoning },
        originalContent: lastUser,
      },
      features: [],
      text: lastUser,
    },
    model_config: {
      ...modelConfig,
      enable: true,
      // 与 parameters.context_length 保持一致（官方形状：两者同值同档）。
      ...(maxContextTokens ? { max_input_tokens: maxContextTokens } : {}),
    },
    business: isCn
      ? {
          // CN 官方自报 IDE 身份，name 为完整用户问题
          product: "ide",
          version: QODER_IDE_VERSION,
          type: "agent",
          stage: "start",
          id: randomUUID(),
          name: lastUser,
          begin_at: Date.now(),
          relation: {},
        }
      : {
          product: "cli",
          // business 层自报 CLI 版本，与product 保持自洽；COSY 头里的
          // cosy-version 才是 IDE 版本（1.32.2）。两者混用会产出
          // product:"cli" + version:"1.32.2" 这种自相矛盾的画像。
          version: "1.0.0",
          type: "agent",
          stage: "start",
          id: randomUUID(),
          name: lastUser.slice(0, 30),
          begin_at: Date.now(),
        },
  };

  const endpoints = REGION_ENDPOINTS[region];
  const tokenKind = describeQoderTokenKind(identity.accessToken);
  const base = qoderInferenceBase(region, tokenKind);
  const url = `${base}${CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;

  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const encoded = Buffer.from(qoderEncodeBody(plain), "latin1");
  const cosyHeaders = buildCosyHeaders(encoded, url, cosyCredsFrom(identity));
  return { url, bodyBuf: encoded, cosyHeaders, modelKey };
}

// ---------------------------------------------------------------------------
// 响应信封解包：{statusCodeValue, body} SSE → OpenAI SSE
// ---------------------------------------------------------------------------

function canonicalizeQoderUsage(usage: unknown): Record<string, unknown> | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const prompt = num(record.prompt_tokens ?? record.input_tokens);
  const completion = num(record.completion_tokens ?? record.output_tokens);
  if (prompt == null && completion == null) return null;
  return {
    prompt_tokens: prompt ?? 0,
    completion_tokens: completion ?? 0,
    total_tokens: num(record.total_tokens) ?? (prompt ?? 0) + (completion ?? 0),
  };
}

function finishReasonOf(parsed: Record<string, unknown>): string | null {
  const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  return (
    (choice?.finish_reason as string | undefined) ||
    ((choice?.delta as Record<string, unknown> | undefined)?.finish_reason as string | undefined) ||
    (parsed.finish_reason as string | undefined) ||
    null
  );
}

function hasValuableDelta(parsed: Record<string, unknown>): boolean {
  const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
  const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
  if (!delta) return false;
  if (typeof delta.content === "string" && delta.content.length > 0) return true;
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) return true;
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
  return !!delta.role;
}

/**
 * Qoder 把真实失败藏在 HTTP 200 的 SSE 信封里（`{statusCodeValue, body}`），
 * 且 body 常常是 `{"error":{code,message,type}}` 或再嵌一层
 * `{"error":{...,details:"..."}}`。这里最多下钻 5 层把内层 code/type/message
 * 取出来。
 *
 * 只做**提取**不做**改写**：错误文案一律保持上游原文，本函数仅负责把嵌套
 * 里的 code 捞出来外抛，让上层的业务错误分类（失败分类器 / 供应商错误表）
 * 去决定最终展示与处置。本项目不维护自定义错误文案表。
 *
 * code 必须同时接受数字和字符串：实测 406 会以数字出现，只按字符串匹配会漏判。
 */
/**
 * 把 Qoder 的 HTTP 状态码映射成上层能识别的标准错误码。
 *
 * 上游的 `code` 字段对限流/额度耗尽一律报 `provider_error`（实测 429 +
 * `{"code":"provider_error","message":"All backends failed"}`），语义全丢。
 * 状态码本身才是有效信号，映射成 OpenAI 风格错误码后：
 *   - 429 → rate_limit_exceeded：上层标 retryable 并提示限流（Qoder 的
 *     "All backends failed" 多数是模型级并发/配额限流，换模型或稍后重试即可）；
 *   - 402/403 → insufficient_quota：额度耗尽，重试无意义；
 *   - 401 → invalid_api_key：凭证过期，需重新登录；
 *   - 其余保留原 code，不臆造语义。
 */
function qoderErrorCodeForStatus(status: number, upstreamCode: string | undefined): string {
  switch (status) {
    case 429:
      return "rate_limit_exceeded";
    case 402:
    case 403:
      return "insufficient_quota";
    case 401:
      return "invalid_api_key";
    case 500:
    case 502:
    case 503:
    case 504:
      return "upstream_unavailable";
    default:
      return upstreamCode || String(status);
  }
}

function classifyQoderInnerError(
  inner: unknown,
  depth = 0,
): { code: string; type: string; message: string; deepMessage: string } | null {
  if (depth >= 5) return null;
  let node: Record<string, unknown> | null = null;
  if (typeof inner === "string") {
    const text = inner.trim();
    if (!text || text === "[DONE]") return null;
    try {
      const parsed: unknown = JSON.parse(text);
      node = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      // 不是 JSON —— 当作纯文本 message
      return { code: "", type: "", message: text, deepMessage: "" };
    }
  } else if (inner && typeof inner === "object") {
    node = inner as Record<string, unknown>;
  }
  if (!node) return null;

  const code = node.code != null ? String(node.code) : "";
  const type = typeof node.type === "string" ? node.type : "";
  const message = typeof node.message === "string" ? node.message : "";

  // details 常常是「字符串化的 JSON」，里面才是真正的失败原因
  let deepMessage = "";
  if (typeof node.details === "string" && node.details.trim().startsWith("{")) {
    const deep = classifyQoderInnerError(node.details, depth + 1);
    if (deep) deepMessage = deep.deepMessage || deep.message;
  } else if (node.details && typeof node.details === "object") {
    const deep = classifyQoderInnerError(node.details, depth + 1);
    if (deep) deepMessage = deep.deepMessage || deep.message;
  }

  if (!code && !type && !message && !deepMessage) {
    return classifyQoderInnerError(node.error, depth + 1);
  }
  return { code, type, message, deepMessage };
}

/**
 * 取上游原始错误文案，不做任何改写。
 *
 * 优先用 details 里下钻出的深层原因（上游把真正原因嵌在那里），否则用
 * message；都没有就回落到整个内层 body 的原文。没有内置文案表——错误
 * 语义由上层的业务错误分类决定，本项目只负责把原文和 code 完整传上去。
 */
function upstreamQoderErrorMessage(
  classified: { code: string; type: string; message: string; deepMessage: string } | null,
  fallbackBody: string,
  fallbackStatus: string,
): string {
  if (!classified) return fallbackBody || fallbackStatus;
  return classified.deepMessage || classified.message || fallbackBody || fallbackStatus;
}

/**
 * 把 Qoder 的 `{statusCodeValue, body}` 信封 SSE 解包成 OpenAI SSE。
 * usage 晚于 finish 到达（choices:[] 帧），按 9router 的合并语义等齐后
 * 补发一个 include_usage 风格的终止 chunk；终止后主动取消上游
 * （socket 有 keepalive，不取消会一直挂着）。
 */
export function unwrapQoderSseStream(response: Response, fallbackModel: string): Response {
  // 非 2xx 必须原样放行：错误 body 里没有 `data:` 行，进解包器会什么都
  // 不转发，flush 再补一个 [DONE]，最终产出一条"成功但正文为空"的流——
  // 真实失败（403 队列 / 401 过期 / 5xx 网关）就被伪装成了空回复。
  if (!response.ok || !response.body) return response;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = "";
  let pendingFinish: string | null = null;
  let pendingUsage: Record<string, unknown> | null = null;
  let finishForwarded = false;
  let doneEmitted = false;
  let lastMeta: { id: string | null; created: number | null; model: string | null } = {
    id: null,
    created: null,
    model: fallbackModel,
  };
  let sawTerminal = false;

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, obj: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj).replace(/\r?\n/g, "")}\n\n`));
  };
  const emitDone = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (doneEmitted) return;
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    doneEmitted = true;
  };
  const emitTerminal = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!pendingFinish && !pendingUsage) return;
    emit(controller, {
      id: lastMeta.id ?? `qoder-${Date.now()}`,
      object: "chat.completion.chunk",
      created: lastMeta.created ?? Math.floor(Date.now() / 1000),
      model: lastMeta.model ?? fallbackModel,
      choices: [{ index: 0, delta: {}, finish_reason: pendingFinish ?? "stop" }],
      ...(pendingUsage ? { usage: pendingUsage } : {}),
    });
    pendingFinish = null;
    pendingUsage = null;
  };

  const handleEnvelope = (
    envelope: Record<string, unknown>,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): boolean => {
    if (doneEmitted) return true;
    const rawStatus = Number(envelope.statusCodeValue);
    const statusVal = Number.isNaN(rawStatus) ? 200 : rawStatus;
    const body = envelope.body;
    const inner =
      typeof body === "string" ? body : body != null ? JSON.stringify(body) : "";

    if (statusVal !== 200) {
      // 信封内错误：内层常见 `{"error":{code,message,type}}`，再嵌 details。
      // 文案保持上游原文，只把内层 code 提取到标准 code 字段外抛，
      // 交给上层业务错误分类决定展示与处置。
      const classified = classifyQoderInnerError(body);
      emit(controller, {
        error: {
          message: upstreamQoderErrorMessage(classified, inner, `upstream status ${statusVal}`),
          type: classified?.type || "upstream_error",
          // code 必须带上 HTTP 状态语义：上游把限流/额度耗尽也报成通用
          // `provider_error`（Qoder 实测 429 + {"code":"provider_error",
          // "message":"All backends failed"}），若原样透传，上层分类器只看到
          // 一个不认识的字符串，只能降级成 reason=unknown、retryable=false，
          // UI 既不提示限流也不重试。这里把状态码映射成标准 OpenAI 错误码，
          // 让分类器能给出 rate_limit 语义（并保留原 code 便于排查）。
          code: qoderErrorCodeForStatus(statusVal, classified?.code),
          param: null,
        },
      });
      emitDone(controller);
      sawTerminal = true;
      return true;
    }
    if (inner === "[DONE]") {
      emitTerminal(controller);
      emitDone(controller);
      sawTerminal = true;
      return true;
    }
    let parsed: Record<string, unknown> | null = null;
    if (inner) {
      try {
        const candidate: unknown = JSON.parse(inner);
        parsed = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
    }
    if (!parsed) return false;

    // Qoder 最常见的失败形态：**HTTP 200 + statusCodeValue 200**，真实错误
    // 藏在 body 的 {"error":{code,...}} 里（额度用尽、内容拦截、排队都走
    // 这条）。只在外层 statusVal !== 200 时处理会完全漏掉它们——错误帧既
    // 没有 choices 也没有 delta，会被当作空帧静默丢弃，最终表现为一路
    // [DONE] 的空回复。文案保留上游原文，code 外抛。
    const innerError = classifyQoderInnerError(parsed.error ?? parsed);
    if (innerError && (innerError.code || innerError.type || innerError.message)) {
      if (!parsed.choices) {
        // 内层同样可能自带状态语义（部分失败帧把 statusCodeValue 放进 body），
        // 优先取它，取不到再用外层信封状态——避免又把 429 报成 provider_error。
        const innerStatus = Number(
          (parsed.statusCodeValue ?? (parsed.error as Record<string, unknown> | undefined)?.statusCodeValue) ?? NaN,
        );
        emit(controller, {
          error: {
            message: upstreamQoderErrorMessage(innerError, inner, "qoder upstream error"),
            type: innerError.type || "upstream_error",
            code: Number.isNaN(innerStatus)
              ? innerError.code || "upstream_error"
              : qoderErrorCodeForStatus(innerStatus, innerError.code),
            param: null,
          },
        });
        emitDone(controller);
        sawTerminal = true;
        return true;
      }
    }

    if (typeof parsed.id === "string" && parsed.id) lastMeta.id = parsed.id;
    if (typeof parsed.created === "number") lastMeta.created = parsed.created;
    if (typeof parsed.model === "string" && parsed.model) lastMeta.model = parsed.model;

    const usage = canonicalizeQoderUsage(parsed.usage);
    if (usage) pendingUsage = usage;

    const finish = finishReasonOf(parsed);
    if (hasValuableDelta(parsed)) {
      emit(controller, parsed);
      if (finish) {
        finishForwarded = true;
        // 无条件记住真实 finish_reason：上游常先发带 finish 的帧、usage 帧
        // 之后才到。此处若因usage 未到而丢弃，稍后补发时只能兜底成 "stop"，
        // 真实的 "tool_calls" 就被抹掉了，工具调用解析器会被误导。
        pendingFinish = finish;
      }
    } else if (finish) {
      pendingFinish = finish;
    }
    if ((pendingFinish || finishForwarded) && pendingUsage) {
      if (!pendingFinish) pendingFinish = "stop";
      emitTerminal(controller);
      emitDone(controller);
      sawTerminal = true;
      return true;
    }
    return false;
  };

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, controller) => {
      if (sawTerminal) return;
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      // Qoder 会把原始换行嵌进 thinking 内容和 110 错误的巨大嵌套 details 里，
      // 单条 JSON 极易被切断成多行。解析失败先缓冲，等下一段拼接后重试。
      let partialData = "";
      for (const line of lines) {
        const trimmed = line.replace(/\r$/, "");
        if (!trimmed.startsWith("data:")) continue;
        const piece = trimmed.slice(5).trim();
        // 空 data: 是心跳。必须直接跳过——若让它进入 partialData 缓冲，
        // 后面所有帧会被拼成不可解析字符串而静默丢弃，整个回复变空。
        if (!piece) continue;
        // 裸 [DONE] 同样不能进缓冲：它 JSON.parse 会失败，于是被拼成
        // "[DONE]{...}"，其后的每一帧都解析失败并被静默丢弃。Qoder 终止
        // 后会保持 socket 打开，裸 [DONE] 恰好是最可能紧跟心跳出现的帧。
        if (piece === "[DONE]") {
          if (!sawTerminal) {
            emitTerminal(controller);
            emitDone(controller);
            sawTerminal = true;
          }
          return;
        }
        let candidate = partialData ? partialData + piece : piece;
        partialData = "";
        let envelope: Record<string, unknown>;
        try {
          envelope = JSON.parse(candidate) as Record<string, unknown>;
        } catch {
          partialData = candidate;
          continue;
        }
        if (handleEnvelope(envelope, controller) && response.body) {
          // 终止帧已发：取消上游 keepalive，避免 drain 挂死。
          void response.body.cancel().catch(() => {});
        }
      }
    },
    flush: (controller) => {
      // 流结束时若还挂着未闭合的半截 JSON，按最后一次尝试处理，
      // 避免上游异常截断导致的片段被静默吞掉。
      if (doneEmitted) return;
      emitTerminal(controller);
      emitDone(controller);
    },
  });

  return new Response(response.body.pipeThrough(stream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
