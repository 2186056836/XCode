// 把 prompts/*.md 编译成 src/godmode-templates/<id>.generated.ts。
//
// 提示词是长文，放在 .ts 模板字符串里既难编辑（反引号/`${}` 都要转义），
// 也让单个源文件必然超过 max-lines。这里以 md 为唯一源：
//   prompts/<id>.md            → 系统提示词（frontmatter: id/name/family/strategy）
//   prompts/<id>.prefill.md    → 配套 PreFill（frontmatter: id/name；正文用 `## role` 分轮）
//   prompts/default-prefill.md → 默认 PreFill（无 frontmatter）
//
// 生成物入库，构建与运行时不解析 md（浏览器侧也 import 生成的模块）。
// 改提示词后执行：pnpm --filter @zcode/shared generate:prompts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptsDir = join(packageRoot, "prompts");
const outDir = join(packageRoot, "src", "godmode-templates");

/** 顺序即 UI 下拉顺序，必须显式声明：readdir 的字典序会把 Hermes 排到最前。 */
const TEMPLATE_ORDER = ["xiaomei-ctf", "xiaoyu-security", "xiaohong-creation", "meimei"];

function parseFrontmatter(source, file) {
  if (!source.startsWith("---\n")) {
    throw new Error(`${file}: 缺少 frontmatter`);
  }
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${file}: frontmatter 未闭合`);
  const header = source.slice(4, end);
  const body = source.slice(end + 5).replace(/^\n+/, "").replace(/\s+$/, "");
  const fields = {};
  for (const line of header.split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    if (at < 0) throw new Error(`${file}: frontmatter 行格式错误: ${line}`);
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { fields, body };
}

/** PreFill 正文按 `## user` / `## assistant` 切轮，空轮丢弃。 */
function parsePrefillTurns(body, file) {
  const turns = [];
  let role = null;
  let buffer = [];
  const flush = () => {
    const content = buffer.join("\n").trim();
    if (role && content) turns.push({ role, content });
    buffer = [];
  };
  for (const line of body.split("\n")) {
    const heading = /^##\s+(user|assistant)\s*$/i.exec(line.trim());
    if (heading) {
      flush();
      role = heading[1].toLowerCase();
      continue;
    }
    if (role) buffer.push(line);
  }
  flush();
  if (turns.length === 0) throw new Error(`${file}: 没有解析到任何一轮`);
  return turns;
}

const escapeTemplateLiteral = (value) =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const renderTurns = (turns, indent) =>
  turns
    .map(
      (turn) =>
        `${indent}{\n${indent}  role: "${turn.role}",\n${indent}  content:\n${indent}    \`${escapeTemplateLiteral(turn.content)}\`,\n${indent}},`,
    )
    .join("\n");

const files = readdirSync(promptsDir).filter((name) => name.endsWith(".md"));
mkdirSync(outDir, { recursive: true });

const constantName = (id) => id.replace(/-/g, "_").toUpperCase();

const summary = [];

for (const id of TEMPLATE_ORDER) {
  const promptFile = `${id}.md`;
  const prefillFile = `${id}.prefill.md`;
  if (!files.includes(promptFile)) throw new Error(`prompts/${promptFile} 不存在`);
  if (!files.includes(prefillFile)) throw new Error(`prompts/${prefillFile} 不存在`);

  const prompt = parseFrontmatter(readFileSync(join(promptsDir, promptFile), "utf8"), promptFile);
  if (prompt.fields.id !== id) throw new Error(`${promptFile}: frontmatter id 必须是 ${id}`);
  for (const key of ["name", "family", "strategy"]) {
    if (!prompt.fields[key]) throw new Error(`${promptFile}: frontmatter 缺少 ${key}`);
  }
  const prefill = parseFrontmatter(
    readFileSync(join(promptsDir, prefillFile), "utf8"),
    prefillFile,
  );
  const turns = parsePrefillTurns(prefill.body, prefillFile);

  const name = constantName(id);
  const output = `// 由 scripts/generate-godmode-templates.mjs 从 prompts/${promptFile} 生成，请勿手改。
import type { GodmodeTemplate, PrefillTemplate } from "../godmode-templates.js";

export const ${name}_TEMPLATE: GodmodeTemplate = {
  id: "${id}",
  name: ${JSON.stringify(prompt.fields.name)},
  family: ${JSON.stringify(prompt.fields.family)},
  strategy: ${JSON.stringify(prompt.fields.strategy)},
  prompt: \`${escapeTemplateLiteral(prompt.body)}\`,
};

export const ${name}_PREFILL: PrefillTemplate = {
  id: "${id}",
  name: ${JSON.stringify(prefill.fields.name ?? prompt.fields.name)},
  messages: [
${renderTurns(turns, "    ")}
  ],
};
`;
  writeFileSync(join(outDir, `${id}.generated.ts`), output, "utf8");
  summary.push(`${id} (${turns.length} prefill turns)`);
}

const defaultTurns = parsePrefillTurns(
  readFileSync(join(promptsDir, "default-prefill.md"), "utf8"),
  "default-prefill.md",
);
writeFileSync(
  join(outDir, "default-prefill.generated.ts"),
  `// 由 scripts/generate-godmode-templates.mjs 从 prompts/default-prefill.md 生成，请勿手改。
import type { PrefillTemplateMessage } from "../godmode-templates.js";

export const GODMODE_DEFAULT_PREFILL: PrefillTemplateMessage[] = [
${renderTurns(defaultTurns, "  ")}
];
`,
  "utf8",
);

console.log(`[godmode] ${summary.join(", ")} + ${defaultTurns.length} default turns -> ${outDir}`);
