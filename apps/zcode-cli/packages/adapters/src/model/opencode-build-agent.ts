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
 * 【system prompt 校验（2026-11-20 晚复测，最终结论）】
 *   只要求 system 里存在 `<env>...</env>` 且块内 `Working directory:` 后有非空值；
 *   官方 build prompt **不参与校验**。复测：只拼 env 连续 3 轮 200；把官方 build
 *   prompt 换成 XCode 自己的 system、或截断/改写 prompt 都仍 200。之前测到的
 *   429 来自旧 TLS 指纹与高频探测，不是 prompt 缺失（旧 helper 的 512B padded
 *   指纹在 Bun 1.4.4 上线后失效）。
 *   TLS 客户端指纹是硬门禁（Node/Electron/Go 默认 TLS → 429，复刻 Bun 1.4.4
 *   的 ClientHello → 200），桌面端通过 opencode-tls helper 解决，helper 不可用时
 *   回退普通 fetch（免费档可能 429，真实 key 不受影响）。
 *   免费档只接受 `stream: true`；非流式请求一律 429。
 *
 * 【tools 门禁（2026-11-20 晚实测）】
 *   - `tools` 必须包含**小写** `read`（空 schema 占位即可）；缺它一律 429。
 *   - 工具名大小写不敏感地等于 `read` 时，schema 不能出现 `file_path`；
 *     等于 `edit` 时不能出现 `old_string` / `new_string`——命中即 429。
 *     这两条会把 XCode 的 `Read` / `Edit` 误伤，所以发请求前把它们改名为
 *     `ReadFile` / `EditFile`（模型回显的名字由 registry 别名映射回原工具）。
 *   - `LocalToolSearch` + `DeferredToolCall` 同时出现会 429，单独出现正常；
 *     发请求前改名为 `SearchTools` / `Defer`，同样靠 registry 别名回映射。
 *   - 其余 XCode 工具名（PascalCase）与额外工具不触发门禁。
 *   其余参数（reasoning_effort、max_tokens 等）不参与门禁。
 *
 * 【与产品自身能力的关系】
 *   - system prompt：XCode 语义完整保留，只在前面拼最小 env 签名段。
 *   - tools：把 11 个官方名**补进** XCode 的工具数组（并集），不覆盖产品工具；
 *     命中门禁的工具名在出站请求里换成别名，入站由 ToolRegistry.aliases 解析。
 *
 * 缺 TLS 指纹或签名时上游返回 429（旧版本是 403 FreeTierError）。
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

/** 闸门要求出现的官方工具名（原 opencode-signature/tools.json）。 */
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
 * 排除：jev-1.13-free 已从目录下架（filter 里的排除正则保留作防御）。
 * 区域受限但保留（换 IP 即可用）：beam-free → 403 RegionError（随出口 IP 漂移）。
 * 模型限时轮换：以动态目录为准（`/inference/v1/models` + upstreamModelIdFilter），
 * 本快照仅记录最近一次实测（2026-11-18），已下架历史模型不再列出
 * （space-bunny-free / longcat-2.5-preview-free / jev-1.13-free / cat-jam-free 等）。
 */
export const OPENCODE_FREE_MODELS: readonly string[] = [
  "big-pickle",
  "beam-free",
  "deepseek-v4.1-flash-free",
  "flint-40b-free",
  "glm-5.3-flash-free",
  "hy4-flash-free",
  "iceman-free",
  "inkling-2-small-free",
  "longcat-2.5-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
];

/**
 * 官方 CLI 1.19.4 抓包实测的完整 UA（端点迁移到 /inference/openai/v1 的同一次抓包）。
 * mitm 实测：AI SDK 会往 init.headers 注入产品 UA（XCode/<版本>
 * ai-sdk/provider-utils/... runtime/node.js/...），不以 opencode/ 开头必 403；
 * builtin api.headers 的 UA 现在能到达请求层（overlay 逐键合并修复后），
 * wrapper 仍按前缀兜底，防止用户层覆盖丢掉指纹。
 */
export const OPENCODE_FREE_USER_AGENT =
  "opencode/1.19.4 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.4";

/** 闸门②：counter 合法上界（含）。实测 1..63 放行、64 起拒绝。 */
export const OPENCODE_SESSION_COUNTER_MAX = 63;

const CHARS62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// ── session ID 构造（移植自 packages/schema/src/identifier.ts，与 asar 逐字一致）──
function timeSegment(timestamp: number, counter: number): string {
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter);
  const value = ~current;
  let hex = "";
  for (let i = 0; i < 6; i++) {
    hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, "0");
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
  const name =
    (fn && typeof fn.name === "string" && fn.name) ||
    (typeof record.name === "string" && record.name);
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
const GATE_TOOL_PLACEHOLDER_DESCRIPTION =
  "This tool is currently unavailable and must not be used.";

/**
 * 闸门工具注入：**并集**补齐官方工具名。
 *
 * XCode 自己的工具定义保留（名字、description、schema 都不动），只把缺失的官方名
 * 用最小形状补在后面。`read` 是硬性要求；其余名字按官方清单补齐，避免上游把
 * 「没有 build agent 工具集」判成非官方客户端。
 *
 * 补进来的占位工具没有可用 schema，模型一般不会优先调用；与 XCode 工具同名的
 * 场景由出站别名（ReadFile / EditFile / SearchTools / Defer）避开，见
 * OPENCODE_TOOL_RENAMES 与 ToolRegistry.aliases。
 */
/**
 * 官方 CLI 每轮追加的 env 段（唯一的 system 签名）。
 *
 * 2026-11-20 晚复测：只要求 `<env>...</env>` 且块内 `Working directory:` 后
 * 有非空值；cwd 用中性的 "/"，不把用户真实工作目录发给上游。Platform / 日期
 * 不参与校验，但按官方形状补全。
 */
const ENV_SIGNATURE_PATTERN = /<env>[\s\S]*?Working directory:[^\n]*\S/;

function buildEnvSignature(): string {
  return `Here is some useful information about the environment you are running in:\n<env>\n  Working directory: /\n  Platform: ${process.platform}\n  Today's date: ${new Date().toDateString()}\n</env>\nSkills provide specialized instructions and workflows for specific tasks.\nUse the skill tool to load a skill when a task matches its description.\n`;
}

/** 读取 system content（string 或 text part 数组）的纯文本。 */
function systemTextOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .join("\n");
}

/**
 * 保证 system 里带 env 签名段。
 *
 * - 已有 `<env>...</env>` 且块内 `Working directory:` 有非空值 → 不重复；
 * - 有 system 消息 → 把签名段拼到第一条 system 正文前面；
 * - 没有 system → 在最前面插一条。
 *
 * 2026-11-20 晚复测：官方 build prompt 不是门禁（只拼 env 连续 3 轮 200；
 * 之前测出的 429 来自旧 TLS 指纹与高频探测），所以这里只保留 env。
 */
function ensureBuildSignaturePrompt(body: Record<string, unknown>): void {
  const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : null;
  if (!messages) return;
  const hasSignature = messages.some((message) => {
    if (!message || typeof message !== "object") return false;
    const record = message as Record<string, unknown>;
    return record.role === "system" && ENV_SIGNATURE_PATTERN.test(systemTextOf(record.content));
  });
  if (hasSignature) return;
  const signature = buildEnvSignature();
  const firstSystemIndex = messages.findIndex((message) => {
    if (!message || typeof message !== "object") return false;
    return (message as Record<string, unknown>).role === "system";
  });
  if (firstSystemIndex < 0) {
    messages.unshift({ role: "system", content: signature });
    return;
  }
  const firstSystem = messages[firstSystemIndex] as Record<string, unknown>;
  if (typeof firstSystem.content === "string") {
    firstSystem.content = `${signature}\n\n${firstSystem.content}`;
  } else if (Array.isArray(firstSystem.content)) {
    firstSystem.content = [{ type: "text", text: signature }, ...firstSystem.content];
  }
}

/**
 * 出站工具名替换：门禁按小写工具名 + 特定参数名识别「非 OpenCode 客户端」，
 * 命中就返回 429。这里把会被误伤的工具换成中性别名；模型回显的别名由
 * ToolRegistry.aliases（core/src/tool/registry.ts）解析回原工具。
 *
 * 键是小写名：`appendChatFingerprintTools` 会先把 XCode 的 `Read`/`Edit` 就地
 * 小写成 `read`/`edit`（见 model-execution.ts 的 canonicalizeFingerprintTools），
 * 所以这里按小写匹配大小写变体。
 */
const OPENCODE_TOOL_RENAMES: Readonly<Record<string, string>> = {
  read: "ReadFile",
  edit: "EditFile",
  localtoolsearch: "SearchTools",
  deferredtoolcall: "Defer",
};

function renameGatedTools(tools: unknown[]): unknown[] {
  const names = new Set(tools.map(toolNameOf).filter((name): name is string => !!name));
  return tools.map((tool) => {
    const name = toolNameOf(tool);
    const renamed = name ? OPENCODE_TOOL_RENAMES[name.toLowerCase()] : undefined;
    // 目标名已被占用时保留原名，避免制造重名工具。
    if (!name || !renamed || names.has(renamed)) return tool;
    const record = tool as Record<string, unknown>;
    const fn = record.function as Record<string, unknown> | undefined;
    if (fn && typeof fn.name === "string") {
      return { ...record, function: { ...fn, name: renamed } };
    }
    if (typeof record.name === "string") {
      return { ...record, name: renamed };
    }
    return tool;
  });
}

export function applyBuildAgentSignature(body: Record<string, unknown>): void {
  ensureBuildSignaturePrompt(body);
  const existing = Array.isArray(body.tools) ? renameGatedTools(body.tools as unknown[]) : [];
  body.tools = existing;
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
