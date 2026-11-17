import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// 随 CLI 内置的技能包（apps/zcode-cli/packages/bundled-skills）。它不是官方插件：不进市场目录、
// 没有版本身份，运行时按内容 hash 解压到 `<cli storage>/bundled-skills/<hash>/`
// （bootstrap/src/app/bundled-skills.ts）。这里的 manifest 形状与那边的读取逐字对应。
export const seaBundledSkillAssetPrefix = "zcode-bundled-skills/";
export const seaBundledSkillManifestAssetKey = `${seaBundledSkillAssetPrefix}manifest.json`;
export const bundledSkillPackRootPath = join("packages", "bundled-skills");
export const bundledSkillPackSkillsDirectory = "skills";
// 与 bootstrap 的 BUNDLED_SKILL_PACK_REQUIRED_PATHS 对齐：缺任一项即中止 SEA 构建，
// 不把一个引用文件残缺的技能包发进正式二进制。
export const bundledSkillPackRequiredPaths = [
  "skills/dynamic-workflows/SKILL.md",
  "skills/dynamic-workflows/patterns.md",
  "skills/dynamic-workflows/examples.md",
  "skills/xcode-proxy-pool/SKILL.md",
  "skills/xcode-godmode/SKILL.md",
  "skills/xcode-godmode/scripts/parseltongue.py",
  "skills/xcode-godmode/scripts/godmode_probe.py",
  "skills/xcode-godmode/scripts/godmode_race.py",
  "skills/xcode-godmode/scripts/load_godmode.py",
  "skills/xcode-godmode/scripts/matrix_report.py",
  "skills/xcode-godmode/scripts/run_fork_tests.py",
  "skills/xcode-godmode/references/jailbreak-templates.md",
  "skills/xcode-godmode/references/refusal-detection.md",
  "skills/xcode-godmode/references/combination-attacks.md",
  "skills/xcode-godmode/references/running-a-measurement.md",
  "skills/xcode-godmode/references/measured-results.md",
  "skills/xcode-godmode/templates/prefill.json",
  "skills/xcode-godmode/templates/prefill-subtle.json",
  // 测量面：语料、打分器、运行器。SKILL.md 的 Paths 段逐个点了名，
  // 少一个就是文档指着不存在的脚本；这些文件不带密钥，纯粹是拒绝判定的基准。
  "skills/xcode-godmode/scripts/safety_scoring.py",
  "skills/xcode-godmode/scripts/csam_eval.py",
  "skills/xcode-godmode/scripts/safety_suite.py",
  "skills/xcode-godmode/scripts/safety_suite_runner.py",
  "skills/xcode-godmode/scripts/unlock_matrix.py",
  "skills/xcode-godmode/scripts/priming_eval.py",
  "skills/xcode-godmode/scripts/safety_samples.py",
  "skills/xcode-godmode/scripts/seed_library.py",
  "skills/xcode-godmode/scripts/seed_library_b.py",
  "skills/xcode-godmode/scripts/seed_library_c.py",
  "skills/xcode-godmode/scripts/seed_library_cli.py",
  "skills/xcode-godmode/scripts/seed_template.py",
  "skills/xcode-godmode/scripts/auto_jailbreak.py",
  // 一次性运行器：各跑一种测量，import 时无副作用，缺了只是少一种跑法。
  "skills/xcode-godmode/scripts/csam_focus_run.py",
  "skills/xcode-godmode/scripts/csam_combo_run.py",
  "skills/xcode-godmode/scripts/csam_continuation_run.py",
  "skills/xcode-godmode/scripts/csam_quick_check.py",
  "skills/xcode-godmode/scripts/csam_break_verify.py",
  // 离线回归：不需要 API key，改完打分器必须先跑这两个再花调用钱。
  "skills/xcode-godmode/scripts/test_csam_eval.py",
  "skills/xcode-godmode/scripts/test_safety_scoring.py",
  // 测量文档：打分器规则、样本与种子的纯文本版，报告里引 id 时由它们兜底。
  "skills/xcode-godmode/references/safety-scorer-rules.md",
  "skills/xcode-godmode/references/jailbreak-samples.md",
  "skills/xcode-godmode/references/context-attack-seeds.md",
  // fork 自带的 manifest：XCode 不读它，随包只为和 fork 逐文件对齐。
  "skills/xcode-godmode/skill.yaml",
];

export const collectSeaBundledSkillAssets = async ({ root, stagingDirectory }) => {
  const packRoot = resolve(root, bundledSkillPackRootPath);
  assertBundledSkillPack(packRoot);

  await rm(stagingDirectory, { force: true, recursive: true });

  const files = [];
  const assets = {};
  for await (const sourcePath of walkFiles(join(packRoot, bundledSkillPackSkillsDirectory))) {
    const relativePath = relative(packRoot, sourcePath);
    if (!shouldIncludeFile(relativePath)) continue;
    const bytes = await readFile(sourcePath);
    const sourceStats = await stat(sourcePath);
    const posixPath = toPosixPath(relativePath);
    assets[`${seaBundledSkillAssetPrefix}${posixPath}`] = sourcePath;
    files.push({
      mode: modeForFile(sourceStats.mode),
      path: posixPath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));

  const manifest = {
    hash: createHash("sha256")
      .update(JSON.stringify(files.map(({ path, sha256, mode }) => [path, sha256, mode])))
      .digest("hex"),
    files,
    version: 1,
  };
  const manifestPath = resolve(stagingDirectory, "bundled-skills-manifest.json");
  await mkdir(stagingDirectory, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  assets[seaBundledSkillManifestAssetKey] = manifestPath;

  return { assets, manifest };
};

function assertBundledSkillPack(packRoot) {
  if (!existsSync(join(packRoot, bundledSkillPackSkillsDirectory))) {
    throw new Error(`Missing bundled skill pack at ${packRoot}`);
  }
  for (const relativePath of bundledSkillPackRequiredPaths) {
    const assetPath = join(packRoot, ...relativePath.split("/"));
    if (!existsSync(assetPath)) {
      throw new Error(`Missing bundled skill pack required asset at ${assetPath}`);
    }
  }
}

async function* walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".turbo") continue;
    // Python 技能脚本会在本地 import 时生成 __pycache__：字节码随包会让内容 hash 抖动，
    // 而且对运行没有任何用处。
    if (entry.name === "__pycache__") continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
      continue;
    }
    if (entry.isFile()) yield fullPath;
  }
}

const shouldIncludeFile = (relativePath) =>
  !relativePath.split(sep).includes(".DS_Store") &&
  !relativePath.split(sep).includes("__pycache__") &&
  !relativePath.endsWith(".pyc");

const toPosixPath = (value) => value.split(sep).join("/");

const modeForFile = (sourceMode) => ((sourceMode & 0o111) !== 0 ? 0o755 : 0o644);
