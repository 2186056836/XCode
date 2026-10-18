/**
 * XCode fork：Qoder 模型可读名与倍率的读取（**仅展示**）。
 *
 * 数据来源是拉取上游模型目录时的真实响应（`display_name` / `price_factor`），
 * 随「从上游获取」一起写进该 provider 的 personal overlay：
 *
 *   api.headers["X-Qoder-Model-Meta"] = JSON.stringify({ "<modelId>": {name, priceFactor} })
 *
 * 为什么不写进模型规则（modelConfigRules）：那套 schema 是 strict 的，加字段会
 * 波及所有 provider 的 personal 配置解析——未知键一旦被拒，整层配置加载失败，
 * 所有供应商的模型会一起消失。曾踩过这个坑，改为放在 overlay 的自由格式
 * headers 里（与 X-Qoder-Internal-User-Id 同一通道），不经过模型规则校验。
 *
 * 请求上游始终发原始 modelId，可读名与倍率都不参与。
 */

/** 单个上下文档位。 */
export interface QoderContextTier {
  readonly name: string;
  readonly tokenCount: number;
}

/** 单个模型的展示元数据。 */
export interface QoderModelMeta {
  /** 上游 display_name，如 "Qwen3.8-Max"。 */
  readonly name?: string;
  /** 上游 price_factor：相对倍率，0 表示免费（实测区间 0~8）。 */
  readonly priceFactor?: number;
  /** 上下文档位（升序），如 200K/400K/1M。 */
  readonly tiers?: ReadonlyArray<QoderContextTier>;
  /** 思考强度档位（升序展示顺序与上游一致）。 */
  readonly efforts?: ReadonlyArray<string>;
}

/** 存放模型元数据的 overlay header 键（大小写不敏感匹配）。 */
const QODER_MODEL_META_HEADER = "x-qoder-model-meta";

export function isQoderModelMetaHeader(key: string): boolean {
  return key.toLowerCase() === QODER_MODEL_META_HEADER;
}

export function readQoderModelMetaHeaderValue(headers: unknown): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (isQoderModelMetaHeader(key) && typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

/** 解析 overlay 里的模型元数据表；格式异常时返回空表（不抛）。 */
export function parseQoderModelMeta(raw: string | undefined): Record<string, QoderModelMeta> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, QoderModelMeta> = {};
    for (const [modelId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined;
      const priceFactor =
        typeof record.priceFactor === "number" && Number.isFinite(record.priceFactor)
          ? record.priceFactor
          : undefined;
      const efforts =
        Array.isArray(record.efforts) && record.efforts.every((e) => typeof e === "string")
          ? (record.efforts as string[])
          : undefined;
      const rawTiers = Array.isArray(record.tiers) ? record.tiers : [];
      const tiers = rawTiers
        .map((tier) => {
          if (!tier || typeof tier !== "object") return null;
          const t = tier as Record<string, unknown>;
          const tierName = typeof t.name === "string" ? t.name : "";
          const tokenCount = typeof t.tokenCount === "number" && t.tokenCount > 0 ? t.tokenCount : undefined;
          return tierName && tokenCount ? { name: tierName, tokenCount } : null;
        })
        .filter((tier): tier is QoderContextTier => tier !== null);
      if (name || priceFactor !== undefined || tiers.length > 0 || (efforts?.length ?? 0) > 0) {
        out[modelId] = {
          ...(name ? { name } : {}),
          ...(priceFactor !== undefined ? { priceFactor } : {}),
          ...(tiers.length > 0 ? { tiers } : {}),
          ...(efforts?.length ? { efforts } : {}),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 倍率的展示文案：0 表示免费，其余显示 0.2× 这样的相对值（去掉尾零）。 */
export function formatQoderPriceFactor(priceFactor: number): string {
  if (priceFactor === 0) return "免费";
  return `${Number(priceFactor.toFixed(2))}×`;
}
