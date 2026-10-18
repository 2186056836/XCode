import { createCipheriv, createHash, publicEncrypt, randomUUID, constants as cryptoConstants } from "node:crypto";
import { sortReasoningLevelsByIntensity } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";

/**
 * XCode fork：Qoder 上游模型目录（host 侧专用）。
 *
 * 为什么不能用通用的 `{baseUrl}/models`：Qoder 的模型目录端点是
 * `GET {chatBase}/algo/api/v2/model/list`，必须带 COSY 签名
 * （RSA+AES+MD5 + 20 个 Cosy-* 头），裸 Bearer 一律被拒。而配置里的
 * baseUrl 是 `https://api3.qoder.sh/algo/api/v2`，拼上 `/models` 得到的是
 * `.../algo/api/v2/models` —— 该端点不存在，必然 404。
 *
 * 本模块**只被 node.ts（host 入口）引用**，不进 renderer bundle，因此可以
 * 放心使用 node:crypto。执行链侧另有一份等价实现在
 * apps/zcode-cli/packages/adapters/src/model/qoderProtocol.ts（那边被
 * model-execution 使用，且受同构约束不能用 node:crypto，两处签名算法一致）。
 */

const log = createServiceLogger("qoder-upstream-models");

export type QoderUpstreamRegion = "cn" | "intl";

const REGION_CHAT_BASE: Record<QoderUpstreamRegion, string> = {
  cn: "https://gateway.qoder.com.cn",
  intl: "https://api3.qoder.sh",
};
const REGION_CHAT_BASE_ALT: Record<QoderUpstreamRegion, string | undefined> = {
  cn: undefined,
  intl: "https://api2.qoder.sh",
};

const MODEL_LIST_PATH = "/algo/api/v2/model/list";
const REQUEST_TIMEOUT_MS = 15_000;

// 与执行链（qoderProtocol.ts）保持一致的客户端指纹，取自 IDE 实机抓包。
const QODER_IDE_VERSION = "1.32.2";
const QODER_CLIENT_TYPE = "0";
const QODER_DATA_POLICY = "disagree";
const QODER_LOGIN_VERSION = "v2";
const QODER_MACHINE_OS = "x86_64_windows";
const QODER_MACHINE_TYPE = "945d1ba41479d5d140";

const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

export interface QoderCosyCredentials {
  userId: string;
  authToken: string;
  machineId: string;
  name?: string;
  email?: string;
}

function pkcs7Pad(data: Buffer, blockSize: number): Buffer {
  const padding = blockSize - (data.length % blockSize);
  const padded = Buffer.alloc(data.length + padding, padding);
  data.copy(padded, 0);
  return padded;
}

function aesEncryptCbcBase64(plaintext: string, keyStr: string): string {
  const keyBytes = Buffer.from(keyStr, "utf8");
  if (keyBytes.length !== 16) throw new Error("aes key must be 16 bytes");
  const cipher = createCipheriv("aes-128-cbc", keyBytes, keyBytes.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(pkcs7Pad(Buffer.from(plaintext, "utf8"), 16)),
    cipher.final(),
  ]).toString("base64");
}

function rsaEncryptBase64(data: string): string {
  return publicEncrypt(
    { key: QODER_RSA_PUBLIC_KEY, padding: cryptoConstants.RSA_PKCS1_PADDING },
    Buffer.from(data, "utf8"),
  ).toString("base64");
}

function md5Hex(input: Buffer | string): string {
  return createHash("md5").update(input).digest("hex");
}

/** 推理主机路由：jt- 任务令牌走 api2（api3 会以 "Login expired" 403 拒绝）。 */
export function resolveQoderModelListBase(
  region: QoderUpstreamRegion,
  accessToken: string,
): string {
  const base = REGION_CHAT_BASE[region];
  if (accessToken.startsWith("jt-")) {
    return REGION_CHAT_BASE_ALT[region] ?? base;
  }
  return base;
}

function buildCosyHeaders(
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

  // sigPath 去掉 /algo 前缀（qodercli 约定）。
  let sigPath = "";
  try {
    const pathname = new URL(requestUrl).pathname || "";
    sigPath = pathname.startsWith("/algo") ? pathname.slice("/algo".length) : pathname;
  } catch {
    sigPath = "";
  }

  // 签名输入必须是 latin1 字节：body 经WAF 编码后虽全为 ASCII，但一旦将来
  // 接入非 ASCII 载荷，UTF-8 与 latin1 会得出不同的 sig。
  const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyBuf.toString("latin1")}\n${sigPath}`;
  const sig = md5Hex(Buffer.from(sigInput, "latin1"));

  // 设备指纹由 machineId 确定性派生——每次请求换身份比稳定的假指纹更像伪造。
  // 空值直接报错而不随机兜底：本函数每请求调用一次，随机值会让指纹逐请求刷新。
  const machineId = creds.machineId;
  if (!machineId) throw new Error("cosy: machineId is empty (identity not configured)");
  const deviceSeed = md5Hex(`qoder-device:${machineId}`);
  const clientIp =
    `192.168.${parseInt(deviceSeed.slice(0, 2), 16) % 254 + 1}` +
    `.${parseInt(deviceSeed.slice(2, 4), 16) % 254 + 1}`;

  return {
    // Authorization 必须来自 COSY 签名，不能被普通 Bearer 覆盖。
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userId,
    "Cosy-Date": timestamp,
    "Cosy-Version": QODER_IDE_VERSION,
    "Cosy-Machineid": machineId,
    "Cosy-Machinetoken": machineId,
    "Cosy-Machinetype": QODER_MACHINE_TYPE,
    "Cosy-Machineos": QODER_MACHINE_OS,
    "Cosy-Machinecode": deviceSeed.slice(0, 18),
    "Cosy-Machinehostname": `DESKTOP-${deviceSeed.slice(18, 25).toUpperCase()}`,
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
    traceparent:
      `00-${md5Hex(`trace:${requestId}`).slice(0, 32)}` +
      `-${md5Hex(`span:${requestId}:${Date.now()}`).slice(0, 16)}-01`,
    baggage: "Eagleeye-Prpc=,Eagleeye-Pappname=fit0dygksm@5deca4ebd39a6e7",
  };
}

/** 单个上下文档位（来自 context_config，升序）。 */
export interface QoderContextTier {
  name: string;
  tokenCount: number;
  isDefault?: boolean;
}

export interface QoderCatalogModel {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  isReasoning?: boolean;
  /** 全部上下文档位（升序），来自 context_config；缺失时无该字段。 */
  contextTiers?: QoderContextTier[];
  /**
   * 思考强度档位（thinking_config.enabled.efforts 的键，如 low/medium/xhigh）；
   * thinking_config.disabled（无可调档位）时无该字段。
   */
  thinkingEfforts?: string[];
  /** 默认思考强度（efforts 里 is_default 的键）。 */
  thinkingDefault?: string;
  /** 上游 display_name（qmodel_38max → "Qwen3.8-Max"）。仅用于展示。 */
  displayName?: string;
  /** 上游 price_factor：相对倍率，0 表示免费（实测区间 0~8）。仅用于展示。 */
  priceFactor?: number;
}

/**
 * 从 `/model/list` 响应里提取模型。
 *
 * 上游形状是 `{ chat: [{ key, is_reasoning, max_output_tokens, context_config }] }`
 * —— 用 `key` 而非 `id`，且 context_config 可能是**按档位名索引的 map**
 * （{"200K":{token_count,is_default}}），要先归一化再取默认档。
 */
export function parseQoderCatalog(payload: unknown): QoderCatalogModel[] {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const chat = Array.isArray(record.chat)
    ? record.chat
    : Array.isArray(record.data)
      ? record.data
      : [];
  const out: QoderCatalogModel[] = [];
  const seen = new Set<string>();
  for (const item of chat) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id =
      typeof entry.key === "string"
        ? entry.key
        : typeof entry.id === "string"
          ? entry.id
          : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // context_config 有两种形态：按档位名索引的 map（{"200K":{...}}）或数组。
    // 统一解析为升序档位数组：contextWindow 一律取**最大档**写入模型配置
    // （聊天请求的 context_length 同样取最大档，两处保持一致），
    // 全部档位随模型返回仅供内部使用。
    const rawContext = entry.context_config;
    const tiers: Array<{ name: string; tokenCount: number; isDefault?: boolean }> = [];
    if (rawContext && typeof rawContext === "object") {
      const pushTier = (name: string, record: Record<string, unknown> | undefined) => {
        if (!record) return;
        const tokenCount =
          typeof record.token_count === "number"
            ? record.token_count
            : typeof record.max_input_tokens === "number"
              ? record.max_input_tokens
              : undefined;
        if (!tokenCount || tokenCount <= 0) return;
        tiers.push({
          name,
          tokenCount,
          ...(record.is_default === true ? { isDefault: true } : {}),
        });
      };
      if (Array.isArray(rawContext)) {
        rawContext.forEach((tier, index) => {
          if (!tier || typeof tier !== "object") return;
          const record = tier as Record<string, unknown>;
          pushTier(String(record.name ?? record.key ?? `tier${index + 1}`), record);
        });
      } else {
        for (const [name, value] of Object.entries(rawContext as Record<string, unknown>)) {
          if (!value || typeof value !== "object") continue;
          pushTier(name, value as Record<string, unknown>);
        }
      }
      tiers.sort((x, y) => x.tokenCount - y.tokenCount);
    }
    let contextWindow: number | undefined;
    if (tiers.length > 0) {
      contextWindow = tiers[tiers.length - 1]?.tokenCount;
    }

    // thinking_config：enabled.efforts 的键即思考强度档位（官方客户端据此渲染
    // 思考强度选择器）；disabled 形态（无 enabled）按无档位处理。
    const rawThinking = entry.thinking_config;
    let thinkingEfforts: string[] | undefined;
    let thinkingDefault: string | undefined;
    if (rawThinking && typeof rawThinking === "object") {
      const enabled = (rawThinking as Record<string, unknown>).enabled;
      const effortsObj =
        enabled && typeof enabled === "object"
          ? ((enabled as Record<string, unknown>).efforts as Record<string, unknown> | undefined)
          : undefined;
      if (effortsObj) {
        const keys = Object.keys(effortsObj);
        if (keys.length > 0) {
          // XCode fork：按强度升序，不透传 Object.keys() 的上游序列化序
          // （Go map 遍历序，与强度无关，会让 UI 出现非单调的档位序列）。
          thinkingEfforts = sortReasoningLevelsByIntensity(keys);
          const defaulted = Object.entries(effortsObj).find(
            ([, v]) => (v as Record<string, unknown> | null)?.is_default === true,
          );
          thinkingDefault = defaulted?.[0];
        }
      }
    }

    const maxOutputTokens =
      typeof entry.max_output_tokens === "number" && entry.max_output_tokens > 0
        ? entry.max_output_tokens
        : undefined;

    out.push({
      id,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(entry.is_reasoning === true ? { isReasoning: true } : {}),
      ...(typeof entry.display_name === "string" && entry.display_name.trim()
        ? { displayName: entry.display_name.trim() }
        : {}),
      ...(typeof entry.price_factor === "number" && Number.isFinite(entry.price_factor)
        ? { priceFactor: entry.price_factor }
        : {}),
      ...(tiers.length > 0 ? { contextTiers: tiers } : {}),
      ...(thinkingEfforts ? { thinkingEfforts, thinkingDefault } : {}),
    });
  }
  return out;
}

export async function fetchQoderUpstreamModels(input: {
  region: QoderUpstreamRegion;
  accessToken: string;
  creds: QoderCosyCredentials;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<QoderCatalogModel[]> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const base = resolveQoderModelListBase(input.region, input.accessToken);
  const url = `${base}${MODEL_LIST_PATH}`;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        ...buildCosyHeaders(Buffer.alloc(0), url, input.creds),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn(undefined, "qoder model list failed", { status: response.status });
      return [];
    }
    return parseQoderCatalog(await response.json());
  } catch (error) {
    log.warn(undefined, "qoder model list request failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
/**
 * CN 专属：PRO 状态查询走 **gateway + COSY 签名**。
 *
 * CN 官方客户端抓包（2026-10-11）：plan 与 quota/usage 挂在
 * `gateway.qoder.com.cn/algo/api/v2/*` 且带完整 COSY 头；openapi.qoder.com.cn
 * 上不存在这两个端点（国际版才是 openapi + 裸 Bearer）。因此 CN 的 PRO 判定
 * 不能走 qoderAuth 的 Bearer 查询，必须到这里用 COSY 签名打网关。
 *
 * machineId 决定 COSY 设备指纹（与推理链路同源，一号一绑）；cosy-machinetoken
 * 头在 CN 官方网关请求里为空串，这里同样发空，保持形状一致。
 */
export async function fetchQoderProStatusViaGateway(input: {
  region: QoderUpstreamRegion;
  accessToken: string;
  userId: string;
  machineId: string;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<{
  isPro: boolean;
  userType: string;
  planTier: string;
  quotaRemaining?: number;
  quotaTotal?: number;
  isQuotaExceeded?: boolean;
}> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const base = REGION_CHAT_BASE[input.region];
  const creds: QoderCosyCredentials = {
    userId: input.userId,
    authToken: input.accessToken,
    machineId: input.machineId,
  };

  const signedGet = async (path: string): Promise<Record<string, unknown>> => {
    const url = `${base}${path}`;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          ...buildCosyHeaders(Buffer.alloc(0), url, creds),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        log.warn(undefined, "qoder gateway pro query failed", { path, status: response.status });
        return {};
      }
      const parsed: unknown = await response.json();
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (error) {
      log.warn(undefined, "qoder gateway pro query request failed", {
        path,
        message: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  };

  const [plan, quota] = await Promise.all([
    signedGet("/algo/api/v2/user/plan"),
    signedGet("/algo/api/v2/quota/usage"),
  ]);

  const userType = typeof plan.user_type === "string" ? plan.user_type : "";
  const planTier = typeof plan.plan_tier_name === "string" ? plan.plan_tier_name : "";
  const userQuota =
    quota.userQuota && typeof quota.userQuota === "object"
      ? (quota.userQuota as Record<string, unknown>)
      : {};
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const haystack = `${userType} ${planTier}`.toLowerCase();
  const isPro = ["professional", "premium", "trial", "paid", "pro"].some((key) =>
    haystack.includes(key),
  );

  return {
    isPro,
    userType,
    planTier,
    ...(num(userQuota.remaining) !== undefined ? { quotaRemaining: num(userQuota.remaining) } : {}),
    ...(num(userQuota.total) !== undefined ? { quotaTotal: num(userQuota.total) } : {}),
    ...(typeof quota.isQuotaExceeded === "boolean"
      ? { isQuotaExceeded: quota.isQuotaExceeded }
      : {}),
  };
}
