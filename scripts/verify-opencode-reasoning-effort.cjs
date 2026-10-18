// 验证脚本：证明「某个档位输入 → 最终发出的 reasoning_effort」永不越界。
//
// 直接加载编译产物 packages/shared/dist/reasoning-levels.js，
// 跑的是**真实实现**而不是复刻逻辑，所以断言失效就等于实现失效。
//
// 运行：node scripts/verify-opencode-reasoning-effort.cjs
// 不发任何网络请求，不涉及凭据。

const assert = require("node:assert");
const path = require("node:path");

const {
  mapReasoningEffortForOpenCode,
  mapReasoningEffortForQoder,
  sortReasoningLevelsByIntensity,
  reasoningIntensityOf,
  isOffReasoningLevel,
} = require(path.join(__dirname, "..", "packages", "shared", "dist", "reasoning-levels.js"));

/**
 * 2026-10-12 实测 opencode.ai/zen/v1/chat/completions 得到的网关合法值域。
 * 依据是上游 400 错误原文，不是推断：
 *   big-pickle（后端 sglang）回传 pydantic literal_error：
 *     literal['none','minimal','low','medium','high','xhigh','max']
 *   space-bunny-free 对 none/ultra/disabled/on 一律 400。
 * 因此 none 不在可发集合内（关闭思考一律靠「不发该字段」表达）。
 */
const GATEWAY_ALLOWED = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);

/** 逐值探测中真正被上游接受过的输入（即 UI 下拉里可能出现的全部取值形态）。 */
const ALL_INPUTS = [
  // 关闭族
  "disabled", "none", "off", "no", "false", "nothink", "no-think", "no_think",
  // 离散档位
  "minimal", "low", "medium", "high", "xhigh", "extra-high", "extra_high", "max", "ultra",
  // 开关式旧值（历史配置里真实存在）
  "on", "enable", "enabled", "true", "TRUE", "High", "  high  ",
  // 边界/异常
  "gigantic", "", "   ", "low,high", "0", "1", "-1",
];

/**
 * 真实模型的 models.dev reasoning_options 值集合（2026-10-12 抓 api.json 的 opencode 目录）。
 * key = 模型 ID，value = 该模型自己宣告的档位。
 */
const MODEL_EFFORTS = {
  // 声明了完整五档
  "space-bunny-free": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5-5": ["low", "medium", "high", "xhigh", "max"],
  // 有 none 的（gpt 系）——none 不进可发集合
  "gpt-5.4": ["none", "low", "medium", "high", "xhigh"],
  "gpt-6-sol": ["none", "low", "medium", "high", "xhigh", "max"],
  // 只有三档，且不含 high/xhigh 之一
  "fledge-alpha-free": ["low", "high", "max"],
  "glm-5.3-flash": ["low", "high", "max"],
  "ling-3.0-flash-free": ["low", "medium", "high"],
  // 单档模型
  "kimi-k3": ["max"],
  "exo-free": ["high"],
  // 目录为空（models.dev 声明 reasoning 但无可调项 → 回落 enabled）
  "big-pickle": undefined,
};

let checks = 0;
let failures = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${error.message}\n`);
  }
}

console.log("=".repeat(78));
console.log("1) 全域不越界：任何输入 × 任何模型档位集 → 输出必在网关合法值域内");
console.log("=".repeat(78));

for (const [modelId, efforts] of Object.entries(MODEL_EFFORTS)) {
  const declared = efforts ?? ["enabled"];
  const rows = [];
  for (const input of ALL_INPUTS) {
    const out = mapReasoningEffortForOpenCode(input, declared);
    rows.push({ input, out });
  }
  const violating = rows.filter(
    (row) => row.out !== undefined && !GATEWAY_ALLOWED.has(row.out),
  );
  check(`model=${modelId} declared=${JSON.stringify(efforts)}`, () => {
    assert.strictEqual(
      violating.length,
      0,
      `越界输出: ${JSON.stringify(violating)}`,
    );
  });
  console.log(
    `      declared=${(efforts ?? ["enabled"]).join(",").padEnd(34)} -> ` +
      `undefined=${rows.filter((r) => r.out === undefined).length}/${rows.length}`,
  );
}

console.log("");
console.log("=".repeat(78));
console.log("2) 钳制方向：宁弱勿强（唯一例外：所选强度低于该模型全部档位时取其最弱档）");
console.log("=".repeat(78));

// 先把输入翻译成「用户实际想要的强度」，与映射表保持同一套语义。
const EQUIVALENT_INTENSITY_INPUT = {
  on: "high", enable: "high", enabled: "high", true: "high",
  ultra: "max", "extra-high": "xhigh", extra_high: "xhigh",
};

let downgrades = 0;
let weakestFallbacks = 0;

for (const [modelId, efforts] of Object.entries(MODEL_EFFORTS)) {
  if (!efforts) continue;
  for (const input of ALL_INPUTS) {
    if (isOffReasoningLevel(input)) continue;
    const out = mapReasoningEffortForOpenCode(input, efforts);
    if (out === undefined) continue;
    const wantedIntensity = reasoningIntensityOf(EQUIVALENT_INTENSITY_INPUT[input] ?? input);
    const outIntensity = reasoningIntensityOf(out);
    if (outIntensity <= wantedIntensity) {
      downgrades += 1;
      check(`${modelId}: "${input}" -> "${out}" 未被抬升`, () => {
        assert.ok(outIntensity <= wantedIntensity, `被抬升: ${wantedIntensity} -> ${outIntensity}`);
      });
    } else {
      // 唯一允许的例外：所选强度低于该模型的**可发**档位 → 取其最弱一档。
      // 注意「可发」≠ 目录原样：目录里可能含 none（关闭族，强度秩 0），
      // 但 none 永不可发（space-bunny-free 收 none 直接 400），实现会先把它滤掉。
      const minSupported = Math.min(
        ...efforts.filter((value) => GATEWAY_ALLOWED.has(value)).map(reasoningIntensityOf),
      );
      weakestFallbacks += 1;
      check(`${modelId}: "${input}" -> "${out}" 属最弱档兜底`, () => {
        assert.ok(wantedIntensity < minSupported, `不该兜底: 模型最弱可发 ${minSupported} <= 所选 ${wantedIntensity}`);
        assert.strictEqual(outIntensity, minSupported, `兜底应取模型最弱可发档, 实得 ${out}`);
      });
    }
  }
}
console.log(`      降级或原样 ${downgrades} 例；最弱档兜底 ${weakestFallbacks} 例（均在模型无更弱档时发生）`);

console.log("");
console.log("=".repeat(78));
console.log("3) 逐模型映射表（输入 → 最终发出的 reasoning_effort）");
console.log("=".repeat(78));

const DEMO_MODELS = ["space-bunny-free", "big-pickle", "kimi-k3", "exo-free", "glm-5.3-flash"];
const DEMO_INPUTS = ["disabled", "none", "enabled", "on", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "gigantic"];

for (const modelId of DEMO_MODELS) {
  const declared = MODEL_EFFORTS[modelId];
  console.log(`\n  ${modelId}  (models.dev 声明: ${JSON.stringify(declared ?? null)})`);
  console.log(`    ${"输入".padEnd(12)}${"输出(发出的值)".padEnd(22)}说明`);
  for (const input of DEMO_INPUTS) {
    const out = mapReasoningEffortForOpenCode(input, declared ?? ["enabled"]);
    const shown = out === undefined ? "— 不发该字段 —" : out;
    let note = "";
    if (out === undefined) {
      note = isOffReasoningLevel(input) ? "关闭族：不发，上游按默认" : "表外未知值：不发，绝不原样透传";
    } else if (declared && !declared.includes(out) && !["enabled", "on"].includes(input)) {
      note = "已按模型档位集下夹";
    } else if (input === "ultra") {
      note = "ultra 被上游 400 → 抬到最接近的合法档";
    } else if (["on", "enable", "enabled", "true"].includes(input)) {
      note = "开关式旧值 → high";
    }
    console.log(`    ${input.padEnd(12)}${shown.padEnd(22)}${note}`);
  }
}

console.log("");
console.log("=".repeat(78));
console.log("4) 不回归：Qoder 映射在重构后行为不变");
console.log("=".repeat(78));

check("Qoder: 关闭族不发字段", () => {
  for (const level of ["disabled", "none", "off", "no"]) {
    assert.strictEqual(mapReasoningEffortForQoder(level), undefined, `${level} 应为 undefined`);
  }
});
check("Qoder: high 不抬成 xhigh", () => {
  assert.strictEqual(mapReasoningEffortForQoder("high"), "high");
});
check("Qoder: on/enable/enabled/true → high", () => {
  for (const level of ["on", "enable", "enabled", "true"]) {
    assert.strictEqual(mapReasoningEffortForQoder(level), "high");
  }
});
check("Qoder: ultra → max", () => {
  assert.strictEqual(mapReasoningEffortForQoder("ultra"), "max");
});
check("Qoder: GLM 系 {high,low,max} 收到 xhigh → 降到 high", () => {
  // xhigh 强度秩 50；该模型可发档位里 rank<=50 的最强档是 high(40)。
  // max 是 70，强于用户所选，按「宁弱勿强」不能拿去。
  assert.strictEqual(mapReasoningEffortForQoder("xhigh", ["high", "low", "max"]), "high");
});
check("Qoder: Qwen 系 {xhigh,low,medium} 收到 high → 降到 medium", () => {
  assert.strictEqual(mapReasoningEffortForQoder("high", ["xhigh", "low", "medium"]), "medium");
});
check("Qoder: 单档模型 {max} 收到 low → 取其唯一档 max", () => {
  assert.strictEqual(mapReasoningEffortForQoder("low", ["max"]), "max");
});

console.log("");
console.log("=".repeat(78));
console.log("5) 排序单调：任意上游顺序 → 强度非递减");
console.log("=".repeat(78));

check("乱序上游 efforts 排成单调", () => {
  const sorted = sortReasoningLevelsByIntensity(["max", "low", "xhigh", "high", "minimal", "medium"]);
  assert.deepStrictEqual(sorted, ["minimal", "low", "medium", "high", "xhigh", "max"]);
});
check("OpenCode 目录里的 none 被挡在可发档位之外后仍单调", () => {
  const sorted = sortReasoningLevelsByIntensity(["none", "max", "low", "xhigh", "high", "medium"]);
  const intensities = sorted.map(reasoningIntensityOf);
  for (let i = 1; i < intensities.length; i += 1) {
    assert.ok(intensities[i] >= intensities[i - 1], `第 ${i} 项强度回落: ${sorted}`);
  }
});

console.log("");
console.log("=".repeat(78));
console.log(`结果: ${checks - failures}/${checks} 通过，${failures} 失败`);
console.log("=".repeat(78));
process.exit(failures === 0 ? 0 : 1);