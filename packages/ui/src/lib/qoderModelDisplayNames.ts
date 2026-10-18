/**
 * XCode fork：模型可读名与倍率的读取（**仅展示**）。
 *
 * 数据来源是拉取上游模型目录时的真实响应（`display_name` / `price_factor`），
 * 随「从上游获取」一起写进该 provider 的 personal overlay：
 *
 *   modelMeta["<modelId>"] = { name, priceFactor, tiers, efforts }
 *
 * 历史上存在 api.headers["X-Qoder-Model-Meta"]（JSON 字符串）里——那会随请求
 * 发往上游（越界指纹），且把 headers 变成强耦合通道；provider_config.json
 * schemaVersion 1→2 迁移已把它提升为独立的 modelMeta 字段。
 *
 * schema 只验「是张表」不验条目；这里负责归一化——坏条目静默丢弃，
 * 绝不让展示数据影响配置加载。
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

/** 读取并归一化 provider 配置里的模型元数据表；格式异常时返回空表（不抛）。 */
export function readProviderModelMetaTable(modelMeta: unknown): Record<string, QoderModelMeta> {
  if (!modelMeta || typeof modelMeta !== "object" || Array.isArray(modelMeta)) return {};
  const out: Record<string, QoderModelMeta> = {};
  for (const [modelId, value] of Object.entries(modelMeta as Record<string, unknown>)) {
    const entry = value && typeof value === "object" && !Array.isArray(value)
      ? normalizeModelMetaEntry(value as Record<string, unknown>)
      : undefined;
    if (entry) out[modelId] = entry;
  }
  return out;
}

function normalizeModelMetaEntry(record: Record<string, unknown>): QoderModelMeta | undefined {
  const name =
    typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined;
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
    return {
      ...(name ? { name } : {}),
      ...(priceFactor !== undefined ? { priceFactor } : {}),
      ...(tiers.length > 0 ? { tiers } : {}),
      ...(efforts?.length ? { efforts } : {}),
    };
  }
  return undefined;
}

/** 倍率的展示文案：0 表示免费，其余显示 0.2× 这样的相对值（去掉尾零）。 */
export function formatQoderPriceFactor(priceFactor: number): string {
  if (priceFactor === 0) return "免费";
  return `${Number(priceFactor.toFixed(2))}×`;
}
