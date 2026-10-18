/**
 * XCode fork：推理强度（reasoning level / thinking effort）的规范顺序与供应商值域映射。
 *
 * 存在的原因（用户报告的「档位顺序错乱」根因）：
 *   上游把思考档位放在 **JSON 对象的键**里（Qoder 的
 *   `thinking_config.enabled.efforts`、CodeBuddy 的 `reasoning.supportedEfforts`），
 *   `Object.keys()` 拿到的是上游序列化顺序（Go map 的遍历序），**与强度无关**。
 *   该数组原样写进模型的 `optionSpecs.reasoningLevel.values`，
 *   再原样流到 UI 的思考强度下拉，于是出现「关闭 / 极高 / 低 / 中 / 高」这种非单调序列。
 *   排序必须发生在**读取边界**（已经写坏的历史配置也要能显示对），
 *   写入口排序只保证新配置不再写坏。
 */

/**
 * 关闭思考的档位别名。UI 一律显示「关闭」；请求侧一律**不发**该字段
 * （Qoder / CodeBuddy 网关都没有 none 档，发了会被 400 拒绝）。
 */
const OFF_REASONING_LEVELS: ReadonlySet<string> = new Set([
  "disabled",
  "none",
  "off",
  "no",
  "false",
  "nothink",
  "no-think",
  "no_think",
]);

/**
 * 档位强度秩：值越小越弱。UI 下拉按此升序排列，保证「低 → 中 → 高 → 极高」单调递增。
 *
 * 秩的**相对次序取自上游自己声明的枚举顺序**，不是猜的：Qoder 网关的
 * `reasoning_effort` 反序列化报错原文按此序列出全部合法值——
 * `expected one of none, minimal, low, medium, high, xhigh, ultra, max`
 * （2026-10-12 实测，api3.qoder.sh）。该序列即上游的强度次序。
 *
 * - `xhigh`（极高）严格高于 `high`（高）：两者在上游值域里是**并存的两个档位**，
 *   不是别名。实测 `ultimate`/`Sonus`/`Cantus` 的 efforts 同时列出 `high` 与 `xhigh`，
 *   而 Qwen 系（`qmodel_38max`/`qfmodel`）只有 `xhigh` 没有 `high`、
 *   GLM/Kimi/DeepSeek 系只有 `high` 没有 `xhigh`——两个互不相交的家族，
 *   恰好证明它们是不同的强度而不是同一强度的两种叫法。
 * - `ultra` 排在 `xhigh` 与 `max` **之间**（照上游枚举序），不是最高档。
 *   2026-10-12 之前的代码把 `ultra` 排在 `max` 之上，是在上游枚举里还没有
 *   `ultra` 时按字面语义做的猜测；现在上游已明确把它列在 `max` 之前。
 * - `on` / `enable` / `enabled` / `true` 语义等于 `high`：旧版思考强度是开关
 *   （开=high、关=none），新版是档位。两套值可能同时出现在同一模型配置里，
 *   给同一秩，稳定排序保持其原有相对次序。
 * - 未知值取 `Infinity` 排到末尾并保持原有相对次序——不丢档位，也不猜强度。
 */
const REASONING_LEVEL_INTENSITY: Readonly<Record<string, number>> = {
  ...Object.fromEntries([...OFF_REASONING_LEVELS].map((level) => [level, 0])),
  minimal: 10,
  low: 20,
  medium: 30,
  high: 40,
  on: 40,
  enable: 40,
  enabled: 40,
  true: 40,
  xhigh: 50,
  "extra-high": 50,
  extra_high: 50,
  ultra: 60,
  max: 70,
};

/** 档位值归一化：去空白 + 转小写。比较与查表前必须先过这里。 */
export function normalizeReasoningLevel(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 归一化后的档位强度秩，供按模型钳制时比较强弱。未知值是 `Infinity`，
 * 因此永远排在已知档位之后、又不会与已知档位混淆。
 */
export function reasoningIntensityOf(value: string): number {
  return REASONING_LEVEL_INTENSITY[normalizeReasoningLevel(value)] ?? Number.POSITIVE_INFINITY;
}

/** 是否是「关闭思考」档位（含各家别名）。 */
export function isOffReasoningLevel(value: string): boolean {
  return OFF_REASONING_LEVELS.has(normalizeReasoningLevel(value));
}

/**
 * 按强度升序排列档位。不去重（去重由 `optionSpecs` schema 负责），
 * 未知值保持原有相对次序排到末尾。`Array.prototype.sort` 在 V8 上稳定，
 * 同秩档位的相对次序可预期。
 */
export function sortReasoningLevelsByIntensity<T extends string>(
  values: readonly T[],
): T[] {
  return [...values].sort(
    (left, right) =>
      (REASONING_LEVEL_INTENSITY[normalizeReasoningLevel(left)] ?? Number.POSITIVE_INFINITY) -
      (REASONING_LEVEL_INTENSITY[normalizeReasoningLevel(right)] ?? Number.POSITIVE_INFINITY),
  );
}

/**
 * Qoder `reasoning_effort` 的合法值域。
 *
 * 取值依据（2026-10-12 实测两处，均为上游原文，非推断）：
 *   1. 网关层（Rust 反序列化器，api3.qoder.sh）：
 *      `reasoning_effort: unknown variant X, expected one of
 *       none, minimal, low, medium, high, xhigh, ultra, max`
 *   2. 下游模型供应商层（更窄，不含 `ultra`）：
 *      - Qwen： `'reasoning_effort' must be one of: 'none','minimal','low','medium','high','xhigh','max'`
 *      - 自研/聚合：`Invalid value: 'ultra'. Supported values are: 'none','minimal','low','medium','high','xhigh','max'`
 *
 * 因此本类型取两层交集里**真正会到达模型**的那一层：`ultra` 虽在网关枚举里合法，
 * 但下游供应商一律拒绝，且**没有任何一个模型的 thinking_config 宣告过它**，故不发。
 * `none` 虽是合法值，但发过去等于让上游走默认思考，语义上等同于不选档位，
 * 与官方 CLI 的行为一致——关闭族一律返回 undefined（不发该字段）。
 */
export type QoderReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const QODER_REASONING_EFFORT_VALUES: ReadonlySet<string> = new Set<QoderReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * 输入档位 → Qoder 合法 `reasoning_effort` 的**白名单**。
 * 表外的值（含关闭族与任何未知值）一律不发该字段：非法值会让 Qoder 直接 400
 * 拒绝整个请求，而"不发"只是退回上游默认思考，代价低得多。
 */
const QODER_REASONING_EFFORT_BY_LEVEL: Readonly<Record<string, QoderReasoningEffort>> = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  // `high` 是上游真实存在的档位，**不抬成 xhigh**（详见下方注释）。
  high: "high",
  // 开关式旧值：语义等价于 high，翻译成合法档位而不是原样发出。
  on: "high",
  enable: "high",
  enabled: "high",
  true: "high",
  xhigh: "xhigh",
  "extra-high": "xhigh",
  extra_high: "xhigh",
  max: "max",
  // `ultra` 只在网关层合法、下游供应商一律拒绝，且无任何模型宣告该档位；
  // 语义最接近的合法档位是 `max`（上游枚举里 ultra 正好排在 max 前面一档）。
  ultra: "max",
};

/**
 * 把选中的档位夹进**该模型自己宣告的** efforts 值域。
 *
 * 为什么需要这一步（2026-10-12 实测）：上游的合法值域是**逐模型**的，不是全局的。
 * 实抓 `api3.qoder.sh/algo/api/v2/model/list`：
 *   Qwen 系 `qmodel_38max`/`qfmodel` = {xhigh, low, medium}   —— 没有 `high`
 *   GLM/Kimi/DeepSeek 系            = {high, low, max}（或 {high, max}）—— 没有 `xhigh`
 *   自研聚合 `ultimate`/`Sonus`/`Cantus` = {xhigh, high, low, max, medium} —— 两者都有
 * 且至少 GLM 一路会**真的按目录值域拒绝**：`gmodel`（目录 high/low/max）收到
 * `xhigh` 时返回 400 code 1210「该模型始终思考，不支持关闭思考；请使用 low、high 或 max。」
 *
 * 夹取规则：降到不高于所选强度的**最强**受支持档位（宁弱勿强，绝不偷偷升级用户的选择）；
 * 若所选强度低于该模型的全部档位，则取该模型最弱的一档（总比不发字段让上游默认成 max 弱）。
 *
 * @param effort 已通过各家白名单的档位值
 * @param supportedEfforts 该模型自己宣告的档位集合；空/缺省表示不钳制
 * @param allowedValues 网关全局合法值域；只有落在其中的上游档位才可作为钳制目标
 */
export function clampToModelEfforts<T extends string>(
  effort: T,
  supportedEfforts: readonly string[] | undefined,
  allowedValues: ReadonlySet<string>,
): T {
  if (!supportedEfforts || supportedEfforts.length === 0) return effort;
  const supported = supportedEfforts
    .map(normalizeReasoningLevel)
    .filter((value): value is T => allowedValues.has(value));
  if (supported.length === 0) return effort;
  if (supported.includes(effort)) return effort;

  const target = reasoningIntensityOf(effort);
  let best: T | undefined;
  for (const candidate of supported) {
    const rank = reasoningIntensityOf(candidate);
    if (rank <= target && (best === undefined || rank > reasoningIntensityOf(best))) {
      best = candidate;
    }
  }
  if (best) return best;
  // 所选强度低于该模型的全部档位：取最弱的一档，而不是不发字段。
  return supported.reduce((weakest, candidate) =>
    reasoningIntensityOf(candidate) < reasoningIntensityOf(weakest) ? candidate : weakest,
  );
}

/**
 * 把模型选项层写进 `body.reasoning_effort` 的档位值翻译成 Qoder 合法值；
 * 返回 `undefined` 表示该字段不应出现在请求里（上游按自身默认）。
 *
 * 白名单而非黑名单透传：上游目录里的档位名（`efforts` 的键）不受我们控制，
 * 原样透传等于把上游的一个陌生键直接送进 Qoder 的枚举校验。
 *
 * `supportedEfforts` 是**该模型**的 `thinking_config.enabled.efforts` 键集合。
 * 传入后会再夹一次到模型自己的值域——全局白名单过了不代表该模型认，
 * 真实 400 见 `clampToModelEfforts` 的注释。
 *
 * 关于历史上的 `high → xhigh`：**不要恢复**，那是过期遗留。
 * fork 当年按 CN 抓包把值域记成 low/medium/xhigh —— 实测这只对 Qwen 系成立，
 * 因为 `qmodel_38max`/`qfmodel` 的目录里确实只有 `xhigh` 没有 `high`。
 * 但把它当全局值域就错了：GLM/Kimi/DeepSeek 系的目录里只有 `high` 没有 `xhigh`，
 * 而 `ultimate`/`Sonus`/`Cantus` 两个档位并存，各自的下拉里都是独立的可选项。
 * 在并存的两个档位之间强行映射，等于把「极高」的语义强加给用户选的「高」；
 * 在只有 `high` 的模型上又会把 `xhigh` 发出去，正好撞上 GLM 的 400 code 1210。
 */
export function mapReasoningEffortForQoder(
  value: unknown,
  supportedEfforts?: readonly string[],
): QoderReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const mapped = QODER_REASONING_EFFORT_BY_LEVEL[normalizeReasoningLevel(value)];
  if (!mapped) return undefined;
  return clampToModelEfforts(mapped, supportedEfforts, QODER_REASONING_EFFORT_VALUES);
}

// ---------------------------------------------------------------------------
// XCode fork：OpenCode Zen 的档位映射
// ---------------------------------------------------------------------------

/**
 * OpenCode Zen 网关 `reasoning_effort` 的合法值域。
 *
 * 取值依据（2026-10-12 实测 `opencode.ai/zen/v1/chat/completions`，非推断）：
 *   1. 网关路由层：非法值原样回传下游错误原文，例如 big-pickle
 *      （后端是 sglang）报 `literal['none','minimal','low','medium','high','xhigh','max']`，
 *      `reasoning.effort` 同值域，报 `invalid reasoning effort: 'ultra'`。
 *   2. 逐模型并不一致：space-bunny-free 收到 `none` 直接 400
 *      （`[invalid_request_error] invalid request`），而 big-pickle 收 `none` 正常 200。
 *      因此 `none` **不进入**本白名单——关闭思考一律靠「不发该字段」表达。
 *
 * `ultra` 被两个后端同时拒绝（big-pickle literal 校验失败、space-bunny-free 400），
 * 与 Qoder 下游供应商的结论一致，故同样不发。
 */
export type OpenCodeReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const OPENCODE_REASONING_EFFORT_VALUES: ReadonlySet<string> = new Set<OpenCodeReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * 输入档位 → OpenCode Zen 合法 `reasoning_effort` 的**白名单**。
 * 与 Qoder 表同构：关闭族与任何未知值一律不发该字段（`undefined`）。
 */
const OPENCODE_REASONING_EFFORT_BY_LEVEL: Readonly<Record<string, OpenCodeReasoningEffort>> = {
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  // 开关式旧值：语义等于 high，翻译成合法档位而不是原样发出
  // （原样发 `on` 会被两个后端同时 400，2026-10-12 实测）。
  on: "high",
  enable: "high",
  enabled: "high",
  true: "high",
  xhigh: "xhigh",
  "extra-high": "xhigh",
  extra_high: "xhigh",
  max: "max",
  // `ultra` 与 Qoder 同处理：语义最接近的合法档位是 `max`，且绝不原样透传。
  ultra: "max",
};

/**
 * 把模型选项层写进请求体的档位值翻译成 OpenCode Zen 合法值；
 * 返回 `undefined` 表示该字段不应出现在请求里（上游按自身默认）。
 *
 * `supportedEfforts` 是**该模型**在 models.dev 目录里宣告的 effort 值集合
 * （`reasoning_options[].type === "effort"` 的 `values`）。传入后会再夹一次到
 * 模型自己的值域——实测 space-bunny-free（目录 low/medium/high/xhigh/max）
 * 收到目录外的 `none` 会直接 400，big-pickle（目录空）却接受 none，
 * 说明值域确实是逐模型的，按目录钳制才不会靠运气。
 */
export function mapReasoningEffortForOpenCode(
  value: unknown,
  supportedEfforts?: readonly string[],
): OpenCodeReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const mapped = OPENCODE_REASONING_EFFORT_BY_LEVEL[normalizeReasoningLevel(value)];
  if (!mapped) return undefined;
  return clampToModelEfforts(mapped, supportedEfforts, OPENCODE_REASONING_EFFORT_VALUES);
}