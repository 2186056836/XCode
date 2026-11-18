#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareWindowsCuaHelperAssets,
  resolveWindowsCuaHelperSourceRoot,
} from "./windows-cua-helper-assets.mjs";
import { getTargetPlatform } from "./target-platform.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(scriptDir, "..");
const servicesPackageRoot = resolve(desktopPackageRoot, "..", "services");
const targetPlatform = getTargetPlatform();

if (targetPlatform.os !== "win32") {
  console.log("[prepare-windows-cua-helper] skip unsupported platform");
  process.exit(0);
}

const desktopPackage = JSON.parse(
  await readFile(resolve(desktopPackageRoot, "package.json"), "utf8"),
);
const sourceRoot = await resolveWindowsCuaHelperSourceRoot({
  // 环境变量统一 ZCODE_ 前缀（与上游同名）。品牌化时期这里曾写成
  // `XCODE_X ?? ZCODE_X` 的兜底对，前缀回退后两侧同键，收敛成单次读取。
  runtimePackageDir: process.env.ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR,
  devRoot: process.env.ZCODE_CUA_DEV_ROOT,
  servicesPackageRoot,
});
const result = await prepareWindowsCuaHelperAssets({
  sourceRoot,
  outputRoot: resolve(desktopPackageRoot, "bundled-tools"),
  targetPlatform,
  electronVersion: desktopPackage.devDependencies.electron,
});

console.log(
  `[prepare-windows-cua-helper] staged ${result.manifest.packageVersion} ${result.manifest.platform}/${result.manifest.arch} PE=0x${result.peMachine.toString(16)} -> ${result.outputDir}`,
);
