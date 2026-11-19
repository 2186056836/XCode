#!/usr/bin/env node
/**
 * 构建 opencode-tls helper（OpenCode 免费档的 TLS 指纹复刻客户端）。
 *
 * 为什么是预编译二进制而不是运行时 npm 依赖：请求必须发出与官方 CLI（Bun）
 * 一致的 ClientHello；Node/OpenSSL 与 Electron 都会落进 429 桶。Go + uTLS
 * 可以逐字节复刻，且可用 CGO_ENABLED=0 交叉编译到桌面支持的平台。
 *
 * 用法:
 *   node scripts/build-opencode-tls-helper.mjs                 # 构建全部目标
 *   node scripts/build-opencode-tls-helper.mjs --target win32-x64
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(desktopRoot, "tools", "opencode-tls");

/** Go 不在 PATH 时，按常见安装位置兜底（Windows/macOS/Linux）。 */
function resolveGoCommand() {
  if (process.env.GO_BINARY) return process.env.GO_BINARY;
  const candidates = [
    process.env.GOROOT
      ? join(process.env.GOROOT, "bin", process.platform === "win32" ? "go.exe" : "go")
      : null,
    "C:\\Program Files\\Go\\bin\\go.exe",
    "/usr/local/go/bin/go",
    "/opt/homebrew/bin/go",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? "go";
}

const goCommand = resolveGoCommand();

/** targetKey → Go 交叉编译参数。与 bundled-tools/<target> 目录名一致。 */
const TARGETS = {
  "win32-x64": { GOOS: "windows", GOARCH: "amd64", binary: "opencode-tls.exe" },
  "win32-arm64": { GOOS: "windows", GOARCH: "arm64", binary: "opencode-tls.exe" },
  "darwin-arm64": { GOOS: "darwin", GOARCH: "arm64", binary: "opencode-tls" },
  "darwin-x64": { GOOS: "darwin", GOARCH: "amd64", binary: "opencode-tls" },
  "linux-x64": { GOOS: "linux", GOARCH: "amd64", binary: "opencode-tls" },
};

function currentTargetKey() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `win32-${arch}`;
  if (process.platform === "darwin") return `darwin-${arch}`;
  return `linux-${arch}`;
}

function parseTargets() {
  if (process.argv.includes("--all")) return Object.keys(TARGETS);
  const requested = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--target" && process.argv[i + 1]) {
      requested.push(process.argv[i + 1]);
      i += 1;
    }
  }
  if (requested.length === 0) {
    const current = currentTargetKey();
    return TARGETS[current] ? [current] : Object.keys(TARGETS);
  }
  for (const target of requested) {
    if (!TARGETS[target]) {
      throw new Error(`未知目标 ${target}；可选：${Object.keys(TARGETS).join(", ")}`);
    }
  }
  return requested;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: sourceDir,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} 退出码 ${result.status}`);
  }
}

const targets = parseTargets();
for (const target of targets) {
  const config = TARGETS[target];
  const outputDir = join(desktopRoot, "bundled-tools", target, "opencode-tls");
  const outputPath = join(outputDir, config.binary);
  await mkdir(outputDir, { recursive: true });
  console.log(`[opencode-tls] 构建 ${target} → ${outputPath}`);
  run(
    goCommand,
    ["build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", "-o", outputPath, "."],
    {
      GOOS: config.GOOS,
      GOARCH: config.GOARCH,
      CGO_ENABLED: "0",
    },
  );
  const info = await stat(outputPath);
  console.log(`[opencode-tls] ${target} 完成（${Math.round(info.size / 1024 / 1024)} MB）`);
}
