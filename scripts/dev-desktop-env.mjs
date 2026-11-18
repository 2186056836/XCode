import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import { withPinnedNodePath } from "./mise-toolchain-env.mjs";
import { quoteArgsForWindowsShell } from "./spawn-command.mjs";

const requestedEnv = process.argv[2]?.trim().toLowerCase();
const agentBytecode = process.argv.slice(3).includes("--agent-bytecode");
if (requestedEnv !== "test" && requestedEnv !== "production") {
  console.error("Usage: node scripts/dev-desktop-env.mjs <test|production> [--agent-bytecode]");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 规则：桌面开发必须使用独立数据根，绝不与安装包（正式版）共用 `~/.xcode`。
 *
 * 数据根解析顺序：
 *   1. 显式环境变量 ZCODE_DATA_BASE_DIR / ZCODE_DESKTOP_HOME_DIR（开发者临时覆盖）；
 *   2. 仓库根目录的 `.dev-data-root` 文件（本机 dev 数据根，不入库；当前 D:\xcode-deva）；
 *   3. 兜底：开发版自己的数据目录（与 Electron userData 同名）：
 *      Windows: %APPDATA%/XCode Dev；macOS: ~/Library/Application Support/XCode Dev；
 *      Linux: $XDG_CONFIG_HOME/XCode Dev 或 ~/.config/XCode Dev。
 * 数据根 = `<base>/.xcode`，账号凭据由 link-dev-credentials.mjs 从正式版链接/复制进来。
 */
function devDataBaseDirOverrideFile() {
  const file = join(repoRoot, ".dev-data-root");
  if (!existsSync(file)) return null;
  const value = readFileSync(file, "utf8").trim();
  return value || null;
}

function defaultDevDataBaseDir() {
  const appData =
    process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(appData, "XCode Dev");
}

const configuredDataBaseDir =
  process.env.ZCODE_DATA_BASE_DIR?.trim() ||
  process.env.ZCODE_DESKTOP_HOME_DIR?.trim() ||
  devDataBaseDirOverrideFile();
if (configuredDataBaseDir) {
  // 关键：解析结果必须写回进程环境，子进程（Electron / link-dev-credentials）才能继承。
  process.env.ZCODE_DATA_BASE_DIR = configuredDataBaseDir;
  console.log(`[dev] isolated data root (configured): ${configuredDataBaseDir}`);
} else {
  process.env.ZCODE_DATA_BASE_DIR = defaultDevDataBaseDir();
  console.log(`[dev] isolated data root (auto): ${process.env.ZCODE_DATA_BASE_DIR}`);
}
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    // Windows 下 shell:true 只按空格拼接参数；仓库路径含空格（如 E:\Z Code\...）时
    // node <script> 的脚本路径会被 cmd 截断成 E:\Z 并报 Cannot find module，因此先补引号。
    const spawnArgs = process.platform === "win32" ? quoteArgsForWindowsShell(args) : args;
    const child = spawn(command, spawnArgs, {
      cwd: repoRoot,
      env: withPinnedNodePath(
        {
          ...process.env,
          ZCODE_ENV: requestedEnv,
          ZCODE_DESKTOP_AGENT_BYTECODE: agentBytecode ? "1" : "0",
        },
        process.execPath,
      ),
      stdio: "inherit",
      // Windows .cmd/.bat executables (pnpm.cmd, npm.cmd, etc.) require shell: true
      shell: process.platform === "win32",
    });

    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          signal
            ? `${command} exited with signal ${signal}`
            : `${command} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

try {
  // The public dev scripts delegate here instead of invoking the package's
  // `dev` lifecycle directly, so pnpm will not run `pre-dev` automatically.
  // Preserve its runtime-asset preparation and stale `out` cleanup explicitly
  // before rebuilding bundles or starting Electron.
  await run(pnpmCommand, ["--filter", "@zcode/desktop", "pre-dev"]);
  // dev 用隔离数据根时，账号凭据也必须指向正式版：否则「部分提供商没有账号」，
  // 而复制一份会在正式版刷新 token 后留下过期副本。脚本内部按数据根判断是否需要处理，
  // 未配置隔离根时是 no-op。
  await run(process.platform === "win32" ? "node" : process.execPath, [
    resolve(repoRoot, "scripts/link-dev-credentials.mjs"),
  ]);
  // On Windows, use "node" (resolved via PATHEXT) to avoid "C:\Program Files\..." space issues
  await run(process.platform === "win32" ? "node" : process.execPath, [
    resolve(repoRoot, "scripts/build-desktop-agent-cli.mjs"),
  ]);
  if (agentBytecode) {
    await run(process.platform === "win32" ? "node" : process.execPath, [
      resolve(repoRoot, "scripts/build-desktop-agent-bytecode.mjs"),
    ]);
  }
  await run(pnpmCommand, ["--filter", "@zcode/desktop", "dev:runtime"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
