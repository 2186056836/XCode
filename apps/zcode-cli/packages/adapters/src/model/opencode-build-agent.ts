/**
 * OpenCode zen 免费档的闸门适配。
 *
 * 端点（2026-10-18 起）：`POST https://opencode.ai/inference/openai/v1/chat/completions`。
 * 旧 `/zen/v1` 已迁到独立额度桶，稳定返回 `429 FreeUsageLimitError`——不要再使用。
 * 模型目录仍走 `https://opencode.ai/inference/v1/models`：`{baseUrl}/models` 现在是
 * 404，host 侧 upstreamModelFetcher 对这个 profile 单独拼目录路径。
 *
 * 上游门禁（2026-10-18 在**新端点**重新消融，线上原文）：
 *
 *   ① User-Agent 以 `opencode/` 开头即可。
 *   ② `x-opencode-session` / `x-opencode-session-id` 必须是 identifier.ts 的
 *      descending ID，且 counter ≤ 63（1..63 放行，64+ 拒）。
 *   ③ `tools` 必须**包含**那 11 个官方工具名（可多带任意额外工具）。
 *   ④ `Authorization: Bearer public`（匿名）或真实 `oc_sk_...` key。
 *
 * 【system prompt 不校验——同日真机矩阵】
 *   新端点上 build-only / XCode 自有 system / [build, xcode] / [xcode, build] 四种
 *   组合全部 200。参考实现「必须精确匹配 build prompt」的结论在端点迁移后不成立，
 *   不要为它引入 8.7KB 静态 prompt（浪费 token 且改变产品语义）。
 *
 * 【与产品自身能力的关系】
 *   - system prompt：不注入、不改写，XCode 语义完整保留。
 *   - tools：把 11 个官方名**补进** XCode 的工具数组（并集），不覆盖产品工具。
 *
 * 三层缺一即 `403 FreeTierError`（"can only be used from within OpenCode"）。
 *
 * 【为什么工具名/模型清单内联在源码里，不读外部 JSON】
 *   本模块会被 esbuild 打成 CJS bundle（desktop 的 bundled-agents/zcode.cjs）。
 *   CJS 输出里 `import.meta.url` 不存在，`fileURLToPath(import.meta.url)` 会抛
 *   `The "path" argument must be of type string or an instance of URL. Received undefined`；
 *   而且即使路径能算出来，esbuild 也不会把 .json/.txt 复制到 dist，顶层 readFileSync
 *   会在模块加载期直接 ENOENT。两者都是「bundle 一加载就崩」，不是运行到才崩。
 *   数据量很小且变化频率低，内联是最省事的打包安全做法。
 */
import { randomBytes } from "node:crypto";

/** 闸门③要求出现的那 11 个官方工具名（原 opencode-signature/tools.json）。 */
const GATE_TOOL_NAMES: readonly string[] = [
  "bash",
  "edit",
  "glob",
  "grep",
  "read",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "write",
];

/**
 * 上游 opencode 免费模型清单快照（2026-10-18 新目录实测，仅作记录）。
 *
 * 【非功能清单】导入链路的权威来源是**动态目录**：
 * `https://opencode.ai/inference/v1/models`（匿名 200，当前 85 个，其中免费系
 * 9 个 + big-pickle），再由 zcode-builtin.json 的 upstreamModelIdFilter 过滤。
 * 本常量无代码引用，保留仅为记录当次实测可用集与排除理由（正则里写不了注释）。
 *
 * 排除：jev-1.13-free → 400 ModelProtocolUnsupported（systemone 端点族）。
 * 区域受限但保留（换 IP 即可用）：beam-free → 403 RegionError（随出口 IP 漂移）。
 * 已从线上目录下架的历史模型（cat-jam-free / ll-alpha-free / muse-spark-*）不再列出。
 */
export const OPENCODE_FREE_MODELS: readonly string[] = [
  "big-pickle",
  "beam-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
  "space-bunny-free",
];

/**
 * 官方 CLI 1.19.0 抓包实测的完整 UA（端点迁移到 /inference/openai/v1 的同一次抓包）。
 * mitm 实测：AI SDK 会往 init.headers 注入产品 UA（XCode/<版本>
 * ai-sdk/provider-utils/... runtime/node.js/...），不以 opencode/ 开头必 403；
 * builtin api.headers 的 UA 现在能到达请求层（overlay 逐键合并修复后），
 * wrapper 仍按前缀兜底，防止用户层覆盖丢掉指纹。
 */
export const OPENCODE_FREE_USER_AGENT =
  "opencode/1.19.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14";

/** 闸门②：counter 合法上界（含）。实测 1..63 放行、64 起拒绝。 */
export const OPENCODE_SESSION_COUNTER_MAX = 63;

const CHARS62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// ── session ID 构造（移植自 packages/schema/src/identifier.ts，与 asar 逐字一致）──
function timeSegment(timestamp: number, counter: number): string {
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter);
  const value = ~current;
  let hex = "";
  for (let i = 0; i < 6; i++) {
    hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 生成一个合规的 session ID。
 *
 * counter 默认 1：真实 CLI 每进程首个 session 恒为 1（95 个真实 session 全是 1），
 * 合规区间 1..63。固定 1 比随机更贴近官方形态；需要覆盖时传参即可。
 */
export function mintSessionId(counter?: number): string {
  const c = counter ?? 1;
  const bytes = randomBytes(14);
  let tail = "";
  for (const b of bytes) tail += CHARS62[b % 62];
  return "ses_" + timeSegment(Date.now(), c) + tail;
}

/** 从 OpenAI 形状的 tool 对象里取名字（兼容 `function.name` 与裸 `name`）。 */
function toolNameOf(tool: unknown): string | undefined {
  if (!tool || typeof tool !== "object") return undefined;
  const record = tool as Record<string, unknown>;
  const fn = record.function as Record<string, unknown> | undefined;
  const name = (fn && typeof fn.name === "string" && fn.name) || (typeof record.name === "string" && record.name);
  return name || undefined;
}

/**
 * 追加的官方占位工具的 description。
 *
 * 不能用空串：GLM-5.3-flash-free 实测 400
 * `[missing_required_parameter] tools[N]: function.description is required`——
 * 上游按模型校验 description 必须非空（deepseek/space-bunny 等不校验，纯协议
 * 参考实现的空串碰巧只在部分模型上成立）。文案沿用指纹占位的同款禁用语义，
 * 引导模型优先用产品自己的同名工具，降低误调概率。
 */
const GATE_TOOL_PLACEHOLDER_DESCRIPTION = "This tool is currently unavailable and must not be used.";

/**
 * 闸门③适配：**并集**注入那 11 个官方工具名。
 *
 * XCode 自己的工具定义原样保留（名字、description、schema 都不动），只把缺失的
 * 官方名用最小形状补在后面。模型侧看到的是「XCode 全量工具 + 11 个官方占位」，
 * 不会因为工具集被替换而丢失产品能力。
 *
 * 注意：补进来的占位工具没有可用 schema，模型一般不会优先调用；若它确实调了，
 * 执行侧会按 XCode 自己的工具名解析（大部分名字本就重叠：bash/edit/read/...）。
 */
export function applyBuildAgentSignature(body: Record<string, unknown>): void {
  const existing = Array.isArray(body.tools) ? (body.tools as unknown[]) : [];
  const present = new Set(existing.map(toolNameOf).filter((n): n is string => !!n));
  const missing = GATE_TOOL_NAMES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    body.tools = [
      ...existing,
      ...missing.map((name) => ({
        type: "function",
        function: {
          name,
          description: GATE_TOOL_PLACEHOLDER_DESCRIPTION,
          parameters: { type: "object", properties: {} },
        },
      })),
    ];
  }
  // 上游对该档位要求 tool_choice 为 auto；XCode 侧若已显式指定（如具体工具名）则不动。
  if (body.tool_choice === undefined) body.tool_choice = "auto";
  // token 限制只能留一个：AI SDK 会给请求注入 max_completion_tokens，而官方 CLI
  // 只发 max_tokens；两者并存时 GLM 系直接 400
  // `[conflicting_token_limits] Use max_tokens or max_completion_tokens, not both`
  // （deepseek 等宽容模型不校验，别拿部分模型 200 当两者并存合法的证据）。
  // 统一删 completion 形态、保留与官方及全部实测放行形态一致的 max_tokens。
  delete body.max_completion_tokens;
  if (typeof body.max_tokens !== "number" || body.max_tokens <= 0) {
    body.max_tokens = 32000;
  }
}
