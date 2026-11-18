#!/usr/bin/env node
/**
 * 从已安装的官方 ZCode 桌面包移植 Computer Use 真实实现到 XCode fork。
 *
 * 背景：开源树里 `@zcode/zcode-cua` 是占位包（zcodeCuaPlaceholder），所有 CUA
 * 入口 fail-closed；官方安装包的 Computer Use 由闭源编译产物提供：
 *
 *   - producer：glm/packages/node-repl-host/dist/mcp/server.js
 *     （esbuild 把真实 `@zcode/zcode-cua/dist/*.js` 整包内联，4.8MB，自包含）
 *   - Helper runtime：resources/tools/cua-helper/
 *     （dist/windows-helper.js + build/Release/ax_native.node + express/sharp 闭包）
 *   - 插件原生依赖：glm/packages/zcode-cua-plugin/node_modules/（sharp / @img / koffi）
 *
 * 本脚本把这三份产物拷进 fork 的构建产物目录（不进 git），并校验 Helper
 * runtime-manifest.json 的 sha256。产物目录本来就被 .gitignore 忽略，属于可重建
 * 的分发资产；来源是本机已安装的官方包（可用 XCODE_CUA_OFFICIAL_ROOT 覆盖）。
 *
 * 注意：node-repl-host 的 build.mjs 会用占位包重新生成 server.js，所以本脚本
 * 必须在那之后执行（已接入 prepare-agent-node-bundle / dev agent bundle）。
 */
import { copyFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const officialRoot =
  process.env.XCODE_CUA_OFFICIAL_ROOT?.trim() ||
  "C:/Users/Administrator/AppData/Local/Programs/ZCode/resources";
const log = (...args) => console.log("[port-official-cua]", ...args);

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function copyTree(from, to, label) {
  if (!existsSync(from)) throw new Error(`${label} 源不存在: ${from}`);
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, force: true });
  const size = (await stat(join(to, ".."))).size;
  void size;
  log(`${label}: ${from} → ${to}`);
}

async function portProducer(platformKey) {
  const src = join(officialRoot, "glm/packages/node-repl-host/dist/mcp/server.js");
  if (!existsSync(src)) throw new Error(`官方 producer 不存在: ${src}`);
  const text = await readFile(src, "utf8");
  if (text.includes("Computer Use is not available in this build")) {
    throw new Error("官方 server.js 也是占位实现，无法移植");
  }
  if (!text.includes("createComputerUseRuntime") || !text.includes("ax_native")) {
    throw new Error("官方 server.js 缺少真实 CUA 特征，拒绝移植");
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

async function portHelper(platformKey) {
  const src = join(officialRoot, "tools/cua-helper");
  const dst = join(repoRoot, `packages/desktop/bundled-tools/${platformKey}/cua-helper`);
  const manifest = JSON.parse(await readFile(join(src, "runtime-manifest.json"), "utf8"));
  for (const [key, rel] of [["entry", manifest.entry], ["addon", manifest.addon]]) {
    const actual = await sha256(join(src, rel));
    if (actual !== manifest.sha256[key]) {
      throw new Error(`官方 Helper ${key} sha256 不匹配（manifest 可能已过期）`);
    }
  }
  await copyTree(src, dst, "Helper runtime");
  await writeDevRuntimeContract(dst, manifest);
  log("Helper manifest sha256 校验通过:", manifest.packageVersion, manifest.arch);
}

/**
 * dev 侧 `resolveWindowsCuaRuntime` 走 XCODE_CUA_DEV_ROOT 契约：根目录 package.json 必须
 * 声明 `@zcode/zcode-cua` 且带 `zcodeCuaRuntime.{schema,windows.{entry,nativeAddon}}`。
 * 官方产物里只有 runtime-manifest.json（产品链用），没有这份 dev 契约，所以按 manifest 合成，
 * 让 bundled-tools/<platform>/cua-helper 本身就是一个可用的 dev root。
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

async function portPlugin(platformKey) {
  const src = join(officialRoot, "glm/packages/zcode-cua-plugin");
  const targets = [
    join(repoRoot, "apps/zcode-cli/packages/zcode-cua-plugin"),
    join(repoRoot, `packages/desktop/bundled-agents/${platformKey}/glm/packages/zcode-cua-plugin`),
  ];
  for (const dst of targets) {
    if (!existsSync(dst)) continue;
    // 只补原生依赖（@img/sharp / koffi 这类 fork 构建链不产的二进制）。
    // 不碰 scripts/skills/docs：这些纯文本与 fork 已有版本逐字节等价，唯一差别是品牌词
    // （ZCode/ZCODE_ ↔ XCode/XCODE_），整体拷回会把 fork 的品牌化改回官方写法，
    // 连 ZCODE_CUA_PLUGIN_ROOT 这种功能相关变量名一起回退。
    await copyTree(join(src, "node_modules"), join(dst, "node_modules"), "plugin/node_modules");
    log(`plugin 原生依赖 → ${dst}`);
  }
}

async function main() {
  // 纯开源 CI / 未装官方 ZCode 时不能让构建入口失败：Computer Use 保持占位包
  // 的 fail-closed 语义，只是没有真实能力。
  if (!existsSync(join(officialRoot, "glm/packages/node-repl-host/dist/mcp/server.js"))) {
    log("未检测到官方 ZCode 安装，跳过移植（Computer Use 保持不可用）");
    return;
  }
  const platformKey = `${process.platform}-${process.arch}`;
  log("官方来源:", officialRoot, "目标平台:", platformKey);
  await portProducer(platformKey);
  await portHelper(platformKey);
  await portPlugin(platformKey);
  log("完成：Computer Use 真实 producer / Helper / 插件原生依赖已移植");
}

main().catch((error) => {
  console.error("[port-official-cua] 失败:", error.message);
  process.exitCode = 1;
});
