#!/usr/bin/env node
/**
 * 把正式版账号凭据链接进 dev 隔离数据目录。
 *
 * 背景：dev 用 `XCODE_DATA_BASE_DIR` 指向独立数据根时，`.xcode/v2/credentials.json`
 * 与 `.xcode/v2/account-rotation.json` 也从零开始，于是「部分提供商没有账号」。
 * 复制一份能临时解决，但正式版刷新 token 后 dev 会拿着过期凭据。
 *
 * 这里优先建符号链接（写入直接落到正式文件，两边始终同源）；建不了链接时
 * （Windows 未开开发者模式且非管理员）回退为复制，并在输出里说明。
 *
 * 用法：
 *   node scripts/link-dev-credentials.mjs            # 跟随当前环境变量
 *   node scripts/link-dev-credentials.mjs --dry-run  # 只打印计划
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CREDENTIAL_FILES = ["credentials.json", "account-rotation.json"];

/**
 * 真实家目录：`os.homedir()` 在 Windows 读 USERPROFILE、POSIX 读 $HOME。
 * 不能用 `process.env.XCODE_DESKTOP_HOME_DIR`——那正是 dev 自己的隔离根。
 */
const realHome = homedir();

function resolveDevBaseDir() {
  return (
    process.env.XCODE_DATA_BASE_DIR?.trim() ||
    process.env.XCODE_DESKTOP_HOME_DIR?.trim() ||
    null
  );
}

function samePath(a, b) {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function isSymlinkTo(path, target) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    return samePath(resolve(dirname(path), readlinkSync(path)), target);
  } catch {
    return false;
  }
}

function linkOrCopy(source, target, dryRun) {
  const state = existsSync(target)
    ? lstatSync(target).isSymbolicLink()
      ? "symlink"
      : "file"
    : "missing";

  if (state === "symlink" && isSymlinkTo(target, source)) {
    return { action: "already-linked", ok: true };
  }

  if (dryRun) {
    return { action: state === "missing" ? "link" : `replace-${state}`, ok: true, dryRun: true };
  }

  mkdirSync(dirname(target), { recursive: true });
  if (state !== "missing") rmSync(target, { force: true });

  try {
    symlinkSync(source, target, "file");
    return { action: state === "missing" ? "linked" : `relinked-from-${state}`, ok: true };
  } catch (error) {
    // Windows 未开开发者模式时 symlink 需要管理员；这里退回复制，行为仍可用。
    try {
      copyFileSync(source, target);
      return {
        action: state === "missing" ? "copied" : `copied-over-${state}`,
        ok: true,
        warning: `symlink failed (${error.code ?? error.message}), fell back to copy`,
      };
    } catch (copyError) {
      return { action: "failed", ok: false, error: copyError.message };
    }
  }
}

const devBaseDir = resolveDevBaseDir();
const sourceDir = join(realHome, ".xcode", "v2");
const dryRun = process.argv.includes("--dry-run");

// 没配隔离根 = dev 与正式版共用同一目录，无需链接。
if (!devBaseDir) {
  console.log("[dev-credentials] no isolated data dir configured, skipped.");
  process.exit(0);
}

const targetDir = join(devBaseDir, ".xcode", "v2");
if (samePath(sourceDir, targetDir)) {
  console.log("[dev-credentials] dev data dir equals production, skipped.");
  process.exit(0);
}

if (!existsSync(sourceDir)) {
  console.log(`[dev-credentials] production credential dir missing, skipped: ${sourceDir}`);
  process.exit(0);
}

let failed = 0;
for (const name of CREDENTIAL_FILES) {
  const source = join(sourceDir, name);
  const target = join(targetDir, name);
  if (!existsSync(source)) {
    console.log(`[dev-credentials] ${name}: source missing, skipped.`);
    continue;
  }
  const result = linkOrCopy(source, target, dryRun);
  if (!result.ok) {
    failed += 1;
    console.error(`[dev-credentials] ${name} failed: ${result.error}`);
    continue;
  }
  const suffix = result.warning ? `（${result.warning}）` : "";
  console.log(`[dev-credentials] ${name}: ${result.action}${suffix}`);
}

if (failed > 0) process.exit(1);
