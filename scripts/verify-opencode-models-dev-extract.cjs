// 用真实抓取的 models.dev api.json 验证「目录 → 档位」的提取逻辑。
// 逻辑本身从 upstreamModelListFetcher.ts 复刻（该文件是 TS 模块、依赖 @zcode/shared 别名，
// 纯 node 无法直接 require），排序/归一化调用的是真实编译产物。
// 用法: node scripts/verify-opencode-models-dev-extract.cjs "<probe-models-dev-api.json>"
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  sortReasoningLevelsByIntensity,
  isOffReasoningLevel,
} = require(path.join(__dirname, "..", "packages", "shared", "dist", "reasoning-levels.js"));

const source = process.argv[2] || "D:/我的项目/ZCode Fork/probe-models-dev-api.json";
if (!fs.existsSync(source)) {
  console.error(`找不到抓取文件: ${source}`);
  process.exit(2);
}

// —— 与 upstreamModelListFetcher.ts 中 extractModelsDevReasoningEfforts 同构 ——
function extractReasoningEfforts(model) {
  if (!model) return undefined;
  if (model.reasoning !== true) return undefined;
  const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : [];
  for (const option of options) {
    if (!option || option.type !== "effort" || !Array.isArray(option.values)) continue;
    const levels = option.values
      .filter((v) => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && !isOffReasoningLevel(v));
    if (levels.length > 0) return sortReasoningLevelsByIntensity(levels);
  }
  return ["enabled"];
}

const db = JSON.parse(fs.readFileSync(source, "utf8"));
const models = db.opencode?.models ?? {};
const ids = Object.keys(models);

// OpenCode Free provider 的上游过滤正则（config/provider/zcode-builtin.json）
const FILTER = /^(?!.*muse-spark).*free/i;
const freeIds = ids.filter((id) => FILTER.test(id));

console.log(`models.dev opencode 目录: ${ids.length} 个模型`);
console.log(`命中 free:opencode 的 upstreamModelIdFilter: ${freeIds.length} 个\n`);

const buckets = new Map();
for (const id of freeIds) {
  const efforts = extractReasoningEfforts(models[id]);
  const key = JSON.stringify(efforts ?? null);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(id);
}

console.log("=".repeat(78));
console.log("提取结果分组（这就是导入后各模型思考强度下拉的取值）");
console.log("=".repeat(78));
for (const [key, list] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${list.length} 个模型 :: ${key}`);
  console.log(`  ${list.join(", ")}`);
}

console.log("");
console.log("=".repeat(78));
console.log("不变量检查");
console.log("=".repeat(78));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

check("不支持思考的模型不出档位（UI 不出现思考强度选择器）", () => {
  const noReasoning = freeIds.filter((id) => models[id].reasoning !== true);
  assert.ok(noReasoning.length > 0, "样本里应至少有一个 reasoning!=true 的模型");
  for (const id of noReasoning) {
    assert.strictEqual(extractReasoningEfforts(models[id]), undefined, `${id} 应为 undefined`);
  }
  console.log(`        reasoning!=true 的: ${noReasoning.join(", ")}`);
});

check("所有产出的档位序列强度非递减", () => {
  for (const id of freeIds) {
    const efforts = extractReasoningEfforts(models[id]);
    if (!efforts) continue;
    for (let i = 1; i < efforts.length; i += 1) {
      const prev = efforts[i - 1];
      const cur = efforts[i];
      const rank = (v) =>
        ({ minimal: 10, low: 20, medium: 30, high: 40, enabled: 40, xhigh: 50, max: 70 })[v] ?? Infinity;
      assert.ok(rank(cur) >= rank(prev), `${id}: ${prev} -> ${cur} 强度回落`);
    }
  }
});

check("产出的档位不含关闭族（关闭由 UI 的 disabled 档承担）", () => {
  for (const id of freeIds) {
    const efforts = extractReasoningEfforts(models[id]);
    if (!efforts) continue;
    for (const value of efforts) {
      assert.ok(!isOffReasoningLevel(value), `${id} 产出关闭族档位 ${value}`);
    }
  }
});

check("至少有一个模型拿到多于「关闭/启用」的离散档位（证明是动态而非静态）", () => {
  const rich = freeIds.filter((id) => (extractReasoningEfforts(models[id]) ?? []).length > 2);
  assert.ok(rich.length > 0, "所有模型都只有 ≤2 档，说明没真正动态化");
  console.log(`        离散档位模型: ${rich.join(", ")}`);
});

check("不同模型的档位集合确实不同（不是共用一份静态表）", () => {
  const distinct = new Set(freeIds.map((id) => JSON.stringify(extractReasoningEfforts(models[id]) ?? null)));
  assert.ok(distinct.size >= 4, `只区分出 ${distinct.size} 种档位配置`);
  console.log(`        共 ${distinct.size} 种不同档位配置`);
});

console.log("");
console.log("=".repeat(78));
console.log("逐模型明细（导入后 UI 思考强度下拉的取值 = disabled + 下列档位）");
console.log("=".repeat(78));
for (const id of freeIds) {
  const efforts = extractReasoningEfforts(models[id]);
  const shown = efforts ? ["disabled", ...efforts].join(" / ") : "(无思考强度选择器)";
  console.log(`  ${id.padEnd(32)} ${shown}`);
}
console.log("");
console.log(failures === 0 ? "全部通过" : `${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);