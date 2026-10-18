/*
 * XCode fork：CodeBuddy 设备风控 Token（X-Device-Token）提供器。
 *
 * 上游对「敏感请求」（签到、对话）会做客户端真实性风控：官方桌面端每个后端请求都带
 * `X-Device-Token`，该头由客户端内置的腾讯 T-Sec TuringShield 原生模块
 * （turing-sdk，N-API 桥）生成。缺失它，上游会把请求判定为「非真实客户端」。
 * 参考实现 workbuddy2api 为此专门写了 turing_helper.js —— 起一个 Node 子进程
 * require 本机桌面端自带的 SDK 取 token，这里把同一套做法搬到 XCode。
 *
 * 为什么是「子进程」而不是在本进程里 require：
 *   - SDK 是原生模块（turing_sdk.node + TuringShieldSDK.dll），ABI/平台不支持时
 *     require 会直接抛错甚至崩进程；放在子进程里失败就只是子进程退出。
 *   - token 带进程内缓存（成功 10 分钟 / 失败 5 分钟），不阻塞主流程。
 *
 * 失败一律优雅降级：返回 null，调用方不注入该头（与参考实现一致）。取不到 token
 * 不是错误 —— 机器上没装 WorkBuddy 桌面端就是取不到，签到仍应照常工作。
 *
 * 安装目录发现（不写死）：XCODE_TURING_SDK_DIR 环境变量 > LOCALAPPDATA/Programs 下的
 * WorkBuddy / WorkBuddyAI > 其余常见安装根（APPDATA / Program Files / 用户目录 / 盘根）。
 * 区域的偏好不同：CN 走 WorkBuddy（channelId 109144），Intl 走 WorkBuddyAI
 * （channelId 400111，产品名 workbuddy-ai）—— 与官方两个发行版各自的 SDK 对应；
 * 只有一个装得上时退化为用它，两个都没有则没有 token。
 *
 * 版本号/渠道号不写死：读安装包 `<base>/resources/app.asar.unpacked/cli/product.json`
 * 的 `config.turingSdk.channelId` / `genieVersion` / `applicationName`，官方发版后自动跟上。
 *
 * 本模块只在 host（Node 侧）使用，由 node.ts 注入给 codebuddyCheckin ——
 * 不得被 UI 引入（用了 node:child_process / node:fs）。
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createServiceLogger } from "../logger/serviceLogger.js";

function logger() {
  return createServiceLogger("codebuddy-device-token");
}

/** 成功结果缓存时长（与参考实现一致）。 */
const TOKEN_TTL_MS = 600_000;
/** 失败负缓存：没有它，每个请求都会 fork 一个必然失败的子进程。 */
const FAILURE_TTL_MS = 300_000;
/** 子进程硬超时：SDK 可用时是毫秒级返回，8s 足够捞出异常。 */
const RUN_TIMEOUT_MS = 8_000;

/** 显式指定 SDK / 安装目录（排障逃生门，与参考实现的 WORKBUDDY_TURING_SDK_DIR 同义）。 */
const ENV_SDK_DIR = "XCODE_TURING_SDK_DIR";

/** 兜底值：只在安装包里读不到时使用。 */
const FALLBACK_CHANNEL_ID = 109144;
const FALLBACK_PRODUCT_NAME = "WorkBuddy";
const FALLBACK_VERSION = "5.5.4";

/** SDK 相对安装根的位置。 */
const SDK_RELATIVE_PATHS = [
  join("resources", "app.asar.unpacked", "native", "turing-sdk"),
  join("resources", "native", "turing-sdk"),
];

/** 子进程桥脚本（写成真实文件后 exec，不用 node -e 内联）。 */
const HELPER_FILENAME = "xcode-turing-device-token-v1.cjs";

const HELPER_SOURCE = `"use strict";
// 每次运行独立校验 SDK，失败只让本进程退出（调用方按「无 token」优雅降级）。
const path = require("node:path");
const sdkDir = process.env.XCODE_TURING_SDK_DIR;
const channelId = Number(process.env.XCODE_TURING_CHANNEL_ID || 0);
const productName = process.env.XCODE_TURING_PRODUCT_NAME || "WorkBuddy";
const productVersion = process.env.XCODE_TURING_VERSION || "5.5.4";
(async () => {
  if (!sdkDir) throw new Error("missing XCODE_TURING_SDK_DIR");
  process.env.PATH = [sdkDir, path.join(sdkDir, "build", "Release"), process.env.PATH || ""].join(path.delimiter);
  const turing = require(sdkDir);
  if (typeof turing.getLoadError === "function") {
    const loadError = turing.getLoadError();
    if (loadError) throw new Error(String(loadError));
  }
  if (typeof turing.isSupported === "function" && !turing.isSupported()) {
    throw new Error("turing sdk unsupported on this platform");
  }
  turing.configure(channelId, productName, productVersion);
  const token = await turing.fetchDeviceToken({
    usingCachedMessage: true,
    includesOutdatedMessage: true,
    includesDeviceInfo: true,
    timeoutMs: 15000,
  });
  const text = token == null ? "" : String(token).trim();
  if (!text) throw new Error("turing sdk returned empty token");
  process.stdout.write(JSON.stringify({ token: text }));
})().catch((error) => {
  process.stderr.write(String((error && error.message) || error));
  process.exit(1);
});
`;

export interface CodeBuddyDeviceTokenProvider {
  /**
   * 取设备风控 token；取不到返回 null（调用方不注入 X-Device-Token 头）。
   * 实现内部带缓存，可以按请求调用。
   */
  get(region: "cn" | "intl"): Promise<string | null>;
}

interface TuringInstall {
  baseDir: string;
  sdkDir: string;
  channelId: number;
  productName: string;
  version: string;
  /** 是否为 AI 发行版（Intl 走的那个）。 */
  isAiBuild: boolean;
}

/** 环境变量是否存在（不落盘、不打印值）。 */
function envPath(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function looksLikeSdkDir(dir: string): boolean {
  try {
    const entries = readdirSync(dir);
    return entries.some(
      (name) =>
        /^index\.(cjs|js)$/i.test(name) ||
        name.toLowerCase() === "package.json" ||
        /\.node$/i.test(name) ||
        name.toLowerCase() === "turingshieldsdk.dll",
    );
  } catch {
    return false;
  }
}

function readInstallMeta(baseDir: string): {
  channelId: number;
  productName: string;
  version: string;
  isAiBuild: boolean;
} {
  const productJson = join(baseDir, "resources", "app.asar.unpacked", "cli", "product.json");
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(readFileSync(productJson, "utf-8")) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const config = (parsed?.config ?? null) as { turingSdk?: { channelId?: unknown } } | null;
  const rawChannel = config?.turingSdk?.channelId;
  const channelId =
    typeof rawChannel === "number" && Number.isInteger(rawChannel) && rawChannel > 0
      ? rawChannel
      : FALLBACK_CHANNEL_ID;
  const applicationName =
    typeof parsed?.applicationName === "string" && parsed.applicationName.trim()
      ? parsed.applicationName.trim()
      : FALLBACK_PRODUCT_NAME;
  const version =
    typeof parsed?.genieVersion === "string" && parsed.genieVersion.trim()
      ? parsed.genieVersion.trim()
      : FALLBACK_VERSION;
  return {
    channelId,
    productName: applicationName,
    version,
    isAiBuild: /ai/i.test(applicationName),
  };
}

/** 候选安装根目录（去重，保持优先级）。 */
function candidateBaseDirs(): string[] {
  const out: string[] = [];
  const add = (dir: string | null) => {
    if (!dir) return;
    const normalized = resolve(dir);
    if (!out.includes(normalized)) out.push(normalized);
  };

  const roots = [
    envPath("LOCALAPPDATA"),
    envPath("APPDATA"),
    envPath("ProgramFiles"),
    envPath("ProgramFiles(x86)"),
    envPath("ProgramW6432"),
    envPath("USERPROFILE"),
    envPath("HOME"),
  ].filter((value): value is string => value !== null);
  for (const root of roots) {
    add(join(root, "Programs", "WorkBuddy"));
    add(join(root, "Programs", "WorkBuddyAI"));
    add(join(root, "WorkBuddy"));
    add(join(root, "WorkBuddyAI"));
  }
  for (const drive of ["C", "D", "E", "F"]) {
    add(join(`${drive}:\\`, "WorkBuddy"));
    add(join(`${drive}:\\`, "WorkBuddyAI"));
  }
  return out;
}

/**
 * 全部可用安装（含显式环境变量指定的那一个，优先级最高）。
 *
 * 环境变量既可能直接指向 turing-sdk 目录，也可能指向安装根目录，两种都接受。
 */
function discoverTuringInstalls(): TuringInstall[] {
  const installs: TuringInstall[] = [];
  const seen = new Set<string>();
  const push = (baseDir: string, sdkDir: string) => {
    if (seen.has(sdkDir) || !looksLikeSdkDir(sdkDir)) return;
    seen.add(sdkDir);
    installs.push({ baseDir, sdkDir, ...readInstallMeta(baseDir) });
  };

  const explicit = envPath(ENV_SDK_DIR);
  if (explicit) {
    const resolved = resolve(explicit);
    if (looksLikeSdkDir(resolved)) {
      // 直接指向 SDK 目录：安装根往上找不到 product.json 就用兜底元数据。
      push(dirname(dirname(dirname(dirname(resolved)))), resolved);
    } else {
      for (const rel of SDK_RELATIVE_PATHS) push(resolved, join(resolved, rel));
    }
  }

  for (const baseDir of candidateBaseDirs()) {
    for (const rel of SDK_RELATIVE_PATHS) push(baseDir, join(baseDir, rel));
  }
  return installs;
}

/** 区域偏好：CN 用 WorkBuddy（非 AI 版），Intl 用 WorkBuddyAI（AI 版）。 */
function pickInstall(installs: TuringInstall[], region: "cn" | "intl"): TuringInstall | null {
  const preferAi = region === "intl";
  const ranked = [...installs].sort((a, b) => {
    const aScore = a.isAiBuild === preferAi ? 0 : 1;
    const bScore = b.isAiBuild === preferAi ? 0 : 1;
    return aScore - bScore;
  });
  return ranked[0] ?? null;
}

/** 把桥脚本写到临时目录（内容相同不重写）。返回脚本路径。 */
let helperPathCache: string | null = null;
function ensureHelperScript(): string {
  if (helperPathCache) return helperPathCache;
  const target = join(tmpdir(), HELPER_FILENAME);
  try {
    const existing = existsSync(target) ? readFileSync(target, "utf-8") : null;
    if (existing !== HELPER_SOURCE) writeFileSync(target, HELPER_SOURCE, "utf-8");
  } catch (error) {
    logger().warn(undefined, "CodeBuddy 设备 token 桥脚本写入失败", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  helperPathCache = target;
  return target;
}

/** 跑一次子进程桥，成功返回 token，失败返回 null。 */
function runHelper(install: TuringInstall): Promise<string | null> {
  const helper = ensureHelperScript();
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [helper],
      {
        timeout: RUN_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          // 宿主是 Electron 时把自身当 Node 用（纯 Node 下该变量无副作用）。
          ELECTRON_RUN_AS_NODE: "1",
          XCODE_TURING_SDK_DIR: install.sdkDir,
          XCODE_TURING_CHANNEL_ID: String(install.channelId),
          XCODE_TURING_PRODUCT_NAME: install.productName,
          XCODE_TURING_VERSION: install.version,
          PATH: [install.sdkDir, join(install.sdkDir, "build", "Release"), process.env.PATH ?? ""].join(
            delimiter,
          ),
        },
      },
      (error, stdout) => {
        if (error) {
          resolvePromise(null);
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout)) as { token?: unknown };
          const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
          resolvePromise(token || null);
        } catch {
          resolvePromise(null);
        }
      },
    );
  });
}

interface CachedToken {
  token: string | null;
  expiresAt: number;
}

/** 真实实现：带缓存 + 并发合流。 */
export function createCodeBuddyDeviceTokenProvider(): CodeBuddyDeviceTokenProvider {
  const cache = new Map<"cn" | "intl", CachedToken>();
  const inflight = new Map<"cn" | "intl", Promise<string | null>>();

  const fetchToken = async (region: "cn" | "intl"): Promise<string | null> => {
    let installs: TuringInstall[];
    try {
      installs = discoverTuringInstalls();
    } catch {
      installs = [];
    }
    const install = pickInstall(installs, region);
    if (!install) {
      logger().info(undefined, "CodeBuddy 设备 token 不可用（本机未发现 TuringShield SDK）", {
        region,
        candidates: candidateBaseDirs().length,
      });
      cache.set(region, { token: null, expiresAt: Date.now() + FAILURE_TTL_MS });
      return null;
    }
    const token = await runHelper(install);
    cache.set(region, {
      token,
      expiresAt: Date.now() + (token ? TOKEN_TTL_MS : FAILURE_TTL_MS),
    });
    if (!token) {
      logger().warn(undefined, "CodeBuddy 设备 token 获取失败（按无 token 继续）", {
        region,
        sdkDir: install.sdkDir,
      });
    }
    return token;
  };

  return {
    get(region) {
      const hit = cache.get(region);
      if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.token);
      const pending = inflight.get(region);
      if (pending) return pending;
      const operation = fetchToken(region).finally(() => {
        inflight.delete(region);
      });
      inflight.set(region, operation);
      return operation;
    },
  };
}
