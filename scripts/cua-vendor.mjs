#!/usr/bin/env node
/**
 * Computer Use 产物装配：把仓库内 vendor/cua/<platform> 的官方闭源编译产物安装到
 * 各构建输出目录。
 *
 * 背景：开源树里 `@zcode/zcode-cua` 是占位包（zcodeCuaPlaceholder），所有 CUA 入口
 * fail-closed。真实能力来自官方 ZCode 的闭源编译产物，分三块：
 *
 *   - producer：glm/packages/node-repl-host/dist/mcp/server.js
 *     （esbuild 把真实 `@zcode/zcode-cua/dist/*.js` 整包内联，4.7MB，自包含，
 *     只有 sharp 走 createRequire 外部化，运行时从 CUA plugin 的 node_modules 解析）
 *   - Helper runtime：resources/tools/cua-helper/
 *     （dist/windows-helper.js + build/Release/ax_native.node + express/sharp 闭包）
 *   - plugin 运行时依赖：sharp + @img/colour + @img/sharp-<platform> + detect-libc + semver
 *     （typescript / @types 是官方 plugin 的 devDependency，运行时只 import node:*，不带）
 *
 * 这些产物体量约 49MB 且无法从开源代码重建，因此**跟踪在 git 里的 vendor/cua/**
 * （而不是依赖某台开发机装了官方 ZCode）。官方安装只在两种情况下需要：
 *   1. vendor/cua/<platform> 尚不存在——一次性灌种子；
 *   2. 官方发布新版本 Helper/producer 后要更新 vendor——删除对应 vendor 子目录重跑即可。
 *
 * 注意：node-repl-host 的 build.mjs 会用占位包重新生成 server.js，所以本脚本必须在
 * 那之后执行（已接入 prepare-agent-node-bundle）。
 *
 * 用法：
 *   node scripts/cua-vendor.mjs            # 安装到构建输出（vendor 缺失时尝试灌种子）
 *   node scripts/cua-vendor.mjs --seed     # 强制从官方安装重新灌种子（更新 vendor）
 */
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const officialRoot =
  process.env.XCODE_CUA_OFFICIAL_ROOT?.trim() ||
  "C:/Users/Administrator/AppData/Local/Programs/ZCode/resources";
const log = (...args) => console.log("[cua-vendor]", ...args);

// fork staging（sharp-package-assets.mjs: resolveSharpRuntimePackageNames）对 win32 的期望集合。
const SHARP_RUNTIME_PACKAGES = ["sharp", "detect-libc", "semver", "@img/colour", "@img/sharp-win32-x64"];

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function copyTree(from, to, label) {
  if (!existsSync(from)) throw new Error(`${label} 源不存在: ${from}`);
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, force: true });
  log(`${label}: ${from} → ${to}`);
}

// ─── 一次性灌种子：官方安装 → vendor/cua/<platform> ───

async function seedFromOfficialInstall(platformKey) {
  const officialProducer = join(officialRoot, "glm/packages/node-repl-host/dist/mcp/server.js");
  const officialHelper = join(officialRoot, "tools/cua-helper");
  if (!existsSync(officialProducer) || !existsSync(officialHelper)) {
    log(`未检测到官方 ZCode 安装（${officialRoot}），且 vendor/cua/${platformKey} 不存在，跳过装配`);
    return false;
  }

  const text = await readFile(officialProducer, "utf8");
  if (text.includes("Computer Use is not available in this build")) {
    throw new Error("官方 server.js 也是占位实现，拒绝灌种子");
  }
  if (!text.includes("createComputerUseRuntime") || !text.includes("ax_native")) {
    throw new Error("官方 server.js 缺少真实 CUA 特征，拒绝灌种子");
  }

  const vendorRoot = join(repoRoot, "vendor/cua", platformKey);
  await mkdir(vendorRoot, { recursive: true });

  const producerTarget = join(vendorRoot, "producer", "server.js");
  await mkdir(dirname(producerTarget), { recursive: true });
  await copyFile(officialProducer, producerTarget);
  log(`seed producer → ${producerTarget} (${(await stat(producerTarget)).size} bytes)`);

  const helperTarget = join(vendorRoot, "helper");
  const manifest = JSON.parse(await readFile(join(officialHelper, "runtime-manifest.json"), "utf8"));
  for (const [key, rel] of [["entry", manifest.entry], ["addon", manifest.addon]]) {
    const actual = await sha256(join(officialHelper, rel));
    if (actual !== manifest.sha256[key]) {
      throw new Error(`官方 Helper ${key} sha256 不匹配（manifest 可能已过期）`);
    }
  }
  await rm(helperTarget, { recursive: true, force: true });
  await copyTree(officialHelper, helperTarget, "seed helper runtime");
  await writeDevRuntimeContract(helperTarget, manifest);

  const officialPlugin = join(officialRoot, "glm/packages/zcode-cua-plugin");
  const pluginTarget = join(vendorRoot, "plugin-runtime");
  await rm(pluginTarget, { recursive: true, force: true });
  await mkdir(pluginTarget, { recursive: true });
  for (const packageName of SHARP_RUNTIME_PACKAGES) {
    await copyTree(join(officialPlugin, "node_modules", packageName), join(pluginTarget, packageName), `seed plugin/${packageName}`);
  }
  log(`seed 完成：vendor/cua/${platformKey}（Helper manifest ${manifest.packageVersion} ${manifest.arch} sha256 校验通过）`);
  return true;
}

/**
 * dev 侧 `resolveWindowsCuaRuntime` 走 XCODE_CUA_DEV_ROOT 契约：根目录 package.json 必须
 * 声明 `@zcode/zcode-cua` 且带 `zcodeCuaRuntime.{schema,windows.{entry,nativeAddon}}`。
 * 官方产物里只有 runtime-manifest.json（产品链用），没有这份 dev 契约，所以按 manifest 合成，
 * 让 helper 目录本身就是一个可用的 dev root。
 */
async function writeDevRuntimeContract(root, manifest) {
  const contract = {
    name: "@zcode/zcode-cua",
    version: manifest.packageVersion,
    private: true,
    type: "module",
    zcodeCuaRuntime: {
      schema: 1,
      windows: {
        entry: manifest.entry,
        nativeAddon: manifest.addon,
      },
    },
  };
  const target = join(root, "package.json");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  log(`dev runtime 契约 → ${target}`);
}

// ─── 安装：vendor/cua/<platform> → 构建输出 ───

async function installProducer(vendorRoot, platformKey) {
  const src = join(vendorRoot, "producer", "server.js");
  if (!existsSync(src)) throw new Error(`vendor producer 不存在: ${src}`);
  const text = await readFile(src, "utf8");
  if (text.includes("Computer Use is not available in this build")) {
    throw new Error("vendor producer 是占位实现，拒绝安装");
  }
  if (!text.includes("createComputerUseRuntime")) {
    throw new Error("vendor producer 缺少真实 CUA 特征，拒绝安装");
  }
  const targets = [
    join(repoRoot, "apps/zcode-cli/packages/node-repl-host/dist/mcp/server.js"),
    join(repoRoot, `packages/desktop/bundled-agents/${platformKey}/glm/packages/node-repl-host/dist/mcp/server.js`),
  ];
  for (const dst of targets) {
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    log(`producer → ${dst} (${(await stat(dst)).size} bytes)`);
  }
}

async function installHelper(vendorRoot, platformKey) {
  const src = join(vendorRoot, "helper");
  const manifestPath = join(src, "runtime-manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`vendor helper 不存在: ${manifestPath}`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const [key, rel] of [["entry", manifest.entry], ["addon", manifest.addon]]) {
    const actual = await sha256(join(src, rel));
    if (actual !== manifest.sha256[key]) {
      throw new Error(`vendor Helper ${key} sha256 不匹配（vendor 产物可能被改坏）`);
    }
  }
  const dst = join(repoRoot, `packages/desktop/bundled-tools/${platformKey}/cua-helper`);
  await rm(dst, { recursive: true, force: true });
  await copyTree(src, dst, "Helper runtime");
  log(`Helper manifest sha256 校验通过: ${manifest.packageVersion} ${manifest.arch}`);
}

async function installPluginRuntime(vendorRoot, platformKey) {
  const src = join(vendorRoot, "plugin-runtime");
  if (!existsSync(src)) throw new Error(`vendor plugin-runtime 不存在: ${src}`);
  const targets = [
    join(repoRoot, "apps/zcode-cli/packages/zcode-cua-plugin/node_modules"),
    join(repoRoot, `packages/desktop/bundled-agents/${platformKey}/glm/packages/zcode-cua-plugin/node_modules`),
  ];
  for (const dst of targets) {
    if (!existsSync(dirname(dst))) continue;
    for (const packageName of SHARP_RUNTIME_PACKAGES) {
      await copyTree(join(src, packageName), join(dst, packageName), `plugin/${packageName}`);
    }
    log(`plugin 运行时依赖 → ${dst}`);
  }
}

/**
 * 清掉插件缓存里陈旧的 producer。
 *
 * plugin host 加载 node_repl 的路径是
 * `<数据根>/cli/plugins/cache/zcode-plugins-official/node-repl-host/<version>/dist/mcp/server.js`，
 * **不是**仓库里的 dist。缓存按 `<name>/<version>` 做键：版本号不变时启动 seed 认为
 * 已就绪、不会重新拷贝，于是占位包一旦进去就永久躺着。实测 dev 数据根与安装包数据根
 * 都中招——仓库里装着 4.88MB 真 producer，而 agent 实际跑的是 2.03MB 占位版，
 * 表现为 agent.computerUse.* 报「Computer Use is not available in this build」。
 *
 * 只在缓存内容与 vendor 不一致时清理：清掉后由启动 seed 从仓库重新灌（版本键不变，
 * 但目录缺失即视为未安装），这条路径已实测可自愈。
 */
async function invalidateStaleProducerCaches(vendorRoot) {
  const vendoredProducer = join(vendorRoot, "producer", "server.js");
  if (!existsSync(vendoredProducer)) return;
  const expectedHash = await sha256(vendoredProducer);

  const dataRoots = [
    process.env.XCODE_DATA_BASE_DIR?.trim() ? join(process.env.XCODE_DATA_BASE_DIR.trim(), ".xcode") : undefined,
    join(homedir(), ".xcode"),
  ].filter((root) => typeof root === "string" && root.length > 0);

  for (const dataRoot of dataRoots) {
    const cacheRoot = join(dataRoot, "cli", "plugins", "cache", "zcode-plugins-official", "node-repl-host");
    if (!existsSync(cacheRoot)) continue;
    let stale = false;
    for (const versionDir of safeReaddir(cacheRoot)) {
      const cached = join(cacheRoot, versionDir, "dist", "mcp", "server.js");
      if (!existsSync(cached)) continue;
      if ((await sha256(cached)) !== expectedHash) stale = true;
    }
    if (!stale) continue;
    await rm(cacheRoot, { recursive: true, force: true });
    log(`清除陈旧 producer 缓存: ${cacheRoot}`);
  }
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function main() {
  const forceSeed = process.argv.includes("--seed");
  const platformKey = `${process.platform}-${process.arch}`;
  const vendorRoot = join(repoRoot, "vendor/cua", platformKey);

  if (forceSeed || !existsSync(join(vendorRoot, "producer", "server.js"))) {
    await seedFromOfficialInstall(platformKey);
  }
  if (!existsSync(join(vendorRoot, "producer", "server.js"))) {
    // 没有 vendor 也没有官方安装：保持占位包的 fail-closed 语义，不让构建入口失败。
    log(`vendor/cua/${platformKey} 不可用，跳过装配（Computer Use 保持不可用）`);
    return;
  }

  log("vendor 来源:", vendorRoot, "目标平台:", platformKey);
  await invalidateStaleProducerCaches(vendorRoot);
  await installProducer(vendorRoot, platformKey);
  await installHelper(vendorRoot, platformKey);
  await installPluginRuntime(vendorRoot, platformKey);
  log("完成：Computer Use producer / Helper / 插件运行时依赖已装配");
}

main().catch((error) => {
  console.error("[cua-vendor] 失败:", error.message);
  process.exitCode = 1;
});
