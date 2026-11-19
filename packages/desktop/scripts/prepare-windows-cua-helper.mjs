#!/usr/bin/env node

import process from "node:process";
import { existsSync } from "node:fs";
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
// XCode fork：官方 CUA Helper 由 port-official-cua 移植到 `vendor/cua/<os>-<arch>/helper`，
// port 脚本会一并写入 zcodeCuaRuntime 契约；单克隆上的 `packages/zcode-cua` 是
// fail-closed 占位包。producer 检测器已经把这个移植目录视为「真实 producer 在场」，
// 这里同样默认用它——否则普通打包要么读到占位包直接报错，要么必须手工设置
// ZCODE_CUA_DEV_ROOT 才能出包。
// 注意不能拿 `bundled-tools/.../cua-helper` 当来源：那是本步骤的输出（暂存后会改写
// package.json 名字），再读回来会触发 package name 校验失败。
const portedHelperRoot = resolve(
  desktopPackageRoot,
  "..",
  "..",
  "vendor",
  "cua",
  `${targetPlatform.os}-${targetPlatform.arch}`,
  "helper",
);
const portedHelperRootUsable = existsSync(resolve(portedHelperRoot, "package.json"));
const sourceRoot = await resolveWindowsCuaHelperSourceRoot({
  // 环境变量统一 ZCODE_ 前缀（与上游同名）。品牌化时期这里曾写成
  // `XCODE_X ?? ZCODE_X` 的兜底对，前缀回退后两侧同键，收敛成单次读取。
  runtimePackageDir: process.env.ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR,
  devRoot:
    process.env.ZCODE_CUA_DEV_ROOT ?? (portedHelperRootUsable ? portedHelperRoot : undefined),
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
