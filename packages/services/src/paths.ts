/* path 规则集中维护：旧 task 快照与 provider 配置路径仍在这里收口。 */
import { lstatSync, readFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, win32 } from "node:path";
import { homedir } from "node:os";
import {
  DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
  XCODE_AGENT_RUNTIME,
} from "@zcode/shared";

let _dataBaseDir: string | null = null;
export const XCODE_WINDOWS_APP_INSTALL_DIR_ENV = "XCODE_WINDOWS_APP_INSTALL_DIR";
const envDataBaseDir = process.env.XCODE_DATA_BASE_DIR?.trim() || null;
// 与 settingService 的 resolveUserHomeDir() 同一解析链（含 XCODE_DESKTOP_HOME_DIR）：
// 独立 dev/e2e 实例设了自己的 home，这里若只认 HOME 会指向真实家目录，
// 与 setting.json 的位置（resolveUserHomeDir 侧）不一致。
const defaultDataBaseDir =
  process.env.XCODE_DESKTOP_HOME_DIR?.trim() || process.env.HOME?.trim() || homedir();

// 命名约定（fork）：环境变量前缀保持 XCODE_（沿用官方，避免破坏脚本/CI）；
// 应用数据目录固定用 .xcode（fork 品牌）。XCODE_DATA_BASE_DIR 只是「父级基目录」，
// 真正的数据根目录见 getXCodeDataRootDir() = {base}/.xcode。

export interface DataBaseDirTargetValidationOptions {
  platform?: NodeJS.Platform | string;
  env?: Record<string, string | undefined>;
  appInstallDir?: string | null;
}

export type DataBaseDirTargetValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE;
      forbiddenDir: string;
    };

/** Set the base directory for app data (replaces homedir() prefix). */
export function setDataBaseDir(dir: string | null): void {
  _dataBaseDir = dir?.trim() || null;
}

/** Get the current base directory. Priority: setDataBaseDir() > env XCODE_DATA_BASE_DIR > homedir(). */
export function getDataBaseDir(): string {
  if (_dataBaseDir) return _dataBaseDir;
  if (envDataBaseDir) return envDataBaseDir;
  // 服务实例会启动后台刷新任务；若每次调用都动态读取 HOME，
  // 测试或宿主切换环境变量后，旧实例可能把数据写到新实例目录。
  return defaultDataBaseDir;
}

/** {dataBaseDir}/.xcode */
export function getXCodeDataRootDir(): string {
  return join(getDataBaseDir(), ".xcode");
}

/**
 * XCode（旧产品）数据目录的候选根，按优先级去重。
 *
 * 旧 XCode 与本产品是同一套自举设计：setting.json 固定在
 * `{真实家目录}/.zcode/v2/setting.json`，其中的 `dataBaseDir` 字段决定真正的
 * 数据根（`{dataBaseDir}/.zcode`）。因此旧数据可能出现在两处：
 *   - 旧 XCode 声明过自定义目录 → `{声明的基目录}/.zcode`（活动数据在这）；
 *   - 未声明 → `{真实家目录}/.zcode`。
 * 声明目录排在前：它存在时就是旧 XCode 的活动数据根；真实家目录的 .zcode
 * 此时只剩 setting.json（自举文件），不能当数据源。
 */
export function getZcodeHomeRoots(): string[] {
  const homes = new Set<string>();
  // 1) 旧 XCode setting.json 里声明的自定义基目录（其活动数据根，最高优先）
  const declared = readLegacyZcodeDeclaredDataBaseDir();
  if (declared) {
    homes.add(declared);
  }
  // 2) 真实家目录（旧 XCode 的默认位置；setting.json 本体也在这里）
  homes.add(
    process.env.XCODE_DESKTOP_HOME_DIR?.trim() ||
      process.env.HOME?.trim() ||
      process.env.USERPROFILE?.trim() ||
      homedir(),
  );
  // 3) HOME / USERPROFILE 显式覆盖（可能 ≠ homedir）
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  if (envHome) {
    homes.add(envHome);
  }
  // 4) 旧版环境变量（旧 XCode 在 setting.json 未声明时使用）
  const legacyEnv = process.env.XCODE_DATA_BASE_DIR?.trim();
  if (legacyEnv) {
    homes.add(legacyEnv);
  }
  // 5) 当前数据基目录兜底
  const dataBaseDir = getDataBaseDir();
  if (dataBaseDir) {
    homes.add(dataBaseDir);
  }
  return [...homes];
}

/** 读旧 XCode 的 setting.json（固定在 {真实家目录}/.zcode/v2/），取其 dataBaseDir。 */
function readLegacyZcodeDeclaredDataBaseDir(): string | null {
  const home =
    process.env.XCODE_DESKTOP_HOME_DIR?.trim() ||
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim() ||
    homedir();
  try {
    const raw = readFileSync(join(home, ".zcode", "v2", "setting.json"), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const declared =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).dataBaseDir
        : undefined;
    if (typeof declared === "string" && declared.trim()) {
      return declared.trim();
    }
  } catch {
    // 文件不存在 / 损坏 / 未声明自定义目录——都按"旧 XCode 用默认位置"处理。
  }
  return null;
}

/** 第一个真实存在的 XCode 数据目录；都不存在时返回 null。 */
export function findZcodeDataDir(): string | null {
  for (const root of getZcodeHomeRoots()) {
    const candidate = join(root, ".zcode");
    try {
      if (lstatSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // 该候选根下没有 .zcode，继续下一个。
    }
  }
  return null;
}

/** 非项目对话共享的真实工作目录；默认 ~/.xcode/workspace/default。 */
export function getConversationWorkspaceDir(): string {
  return join(getXCodeDataRootDir(), "workspace", "default");
}

/** {dataBaseDir}/.xcode/v2 */
export function getAppConfigDir(): string {
  return join(getXCodeDataRootDir(), "v2");
}

/**
 * GLM（唯一 agent provider）的配置目录：{dataBaseDir}/.xcode/cli。
 * Bugfix：GLM 配置改为直接读写新版 xcode-cli 的全局配置目录，不做 workspace 隔离，
 * 避免同机不同工作区配置漂移。
 */
export function getProviderWorkspaceConfigDir(): string {
  return XCODE_AGENT_RUNTIME.nativeConfigDir
    ? join(getDataBaseDir(), XCODE_AGENT_RUNTIME.nativeConfigDir)
    : join(getDataBaseDir(), ".xcode", "cli");
}

function readEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const direct = env[key]?.trim();
  if (direct) {
    return direct;
  }

  const lowerKey = key.toLowerCase();
  for (const [candidateKey, value] of Object.entries(env)) {
    if (candidateKey.toLowerCase() !== lowerKey) {
      continue;
    }
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function normalizeWindowsComparablePath(pathValue: string): string | null {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = win32.normalize(trimmed).replace(/[\\/]+$/, "");
  if (!normalized) {
    return null;
  }

  return win32
    .resolve(normalized)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function isWindowsPathEqualOrInside(pathValue: string, rootValue: string): boolean {
  const normalizedPath = normalizeWindowsComparablePath(pathValue);
  const normalizedRoot = normalizeWindowsComparablePath(rootValue);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

function collectWindowsForbiddenAppInstallDirs(
  options: Required<Pick<DataBaseDirTargetValidationOptions, "env">> &
    Pick<DataBaseDirTargetValidationOptions, "appInstallDir">,
): string[] {
  const env = options.env;
  const programFiles = readEnvValue(env, "ProgramFiles");
  const programFilesX86 = readEnvValue(env, "ProgramFiles(x86)");
  const programW6432 = readEnvValue(env, "ProgramW6432");
  const localAppData = readEnvValue(env, "LOCALAPPDATA");
  const candidates = [
    options.appInstallDir,
    readEnvValue(env, XCODE_WINDOWS_APP_INSTALL_DIR_ENV),
    // fork 分离：安装目录随 productName 变为 XCode，数据目录禁止指向其中
    programFiles ? win32.join(programFiles, "XCode") : null,
    programFilesX86 ? win32.join(programFilesX86, "XCode") : null,
    programW6432 ? win32.join(programW6432, "XCode") : null,
    localAppData ? win32.join(localAppData, "Programs", "XCode") : null,
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized =
      typeof candidate === "string" ? normalizeWindowsComparablePath(candidate) : null;
    if (!candidate || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(candidate);
  }

  return result;
}

export function validateDataBaseDirTarget(
  targetBaseDir: string,
  options: DataBaseDirTargetValidationOptions = {},
): DataBaseDirTargetValidationResult {
  if ((options.platform ?? process.platform) !== "win32") {
    return { ok: true };
  }

  for (const forbiddenDir of collectWindowsForbiddenAppInstallDirs({
    env: options.env ?? process.env,
    appInstallDir: options.appInstallDir ?? null,
  })) {
    if (isWindowsPathEqualOrInside(targetBaseDir, forbiddenDir)) {
      return {
        ok: false,
        code: DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
        forbiddenDir,
      };
    }
  }

  return { ok: true };
}

export function getExportLogStageDir(): string {
  return join(getXCodeDataRootDir(), "export-log-stage");
}

export function getExportLogDir(): string {
  return join(getXCodeDataRootDir(), "export-log");
}

export function getFeedbackRootDir(): string {
  return join(getXCodeDataRootDir(), "feedback");
}

export function getFeedbackAttachmentDir(): string {
  return join(getFeedbackRootDir(), "attachments");
}

export function getFeedbackLogArchiveDir(): string {
  return join(getFeedbackRootDir(), "logs");
}

export function getGitCheckpointIndexRootDir(): string {
  return join(getXCodeDataRootDir(), "git-checkpoint-index");
}

/** ~/.xcode/v2/tasks-index.sqlite */
export function getTasksIndexDatabasePath(): string {
  return join(getAppConfigDir(), "tasks-index.sqlite");
}

/** workspace 级身份键：远程优先使用 workspaceIdentity，本地回退 workspacePath。 */
function getWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath;
}

/** 与 XCode session 持久化一致：使用 workspaceKey 的 SHA-256 前 12 位 */
export function getWorkspaceHash(workspacePath: string, workspaceIdentity?: string): string {
  return createHash("sha256")
    .update(getWorkspaceKey(workspacePath, workspaceIdentity))
    .digest("hex")
    .slice(0, 12);
}

/** ~/.xcode/v2/sessions/{workspaceHash} */
function getTaskSessionDir(workspacePath: string, workspaceIdentity?: string): string {
  return join(getAppConfigDir(), "sessions", getWorkspaceHash(workspacePath, workspaceIdentity));
}

/** ~/.xcode/v2/sessions/{workspaceHash}/{taskId}.json */
export function getLegacyTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.json`);
}

/** ~/.xcode/v2/sessions/{workspaceHash}/{taskId}.deleted.json */
export function getLegacyDeletedTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.deleted.json`);
}

/**
 * Copy the .xcode/v2 data directory from one base dir to another.
 * Excludes setting.json and its transient atomic-write siblings — bootstrap
 * state must only live at the default homedir location.
 */
export async function copyDataDirectory(oldBaseDir: string, newBaseDir: string): Promise<void> {
  const oldDir = join(oldBaseDir, ".xcode", "v2");
  const newDir = join(newBaseDir, ".xcode", "v2");
  await cp(oldDir, newDir, {
    recursive: true,
    force: false,
    filter: (source) => {
      const sourceName = basename(source);
      if (sourceName === "setting.json" || sourceName.startsWith("setting.json.")) {
        // setting.json.lock 和 setting.json.*.tmp 由原子写入短暂创建/删除，
        // 复制过程中扫描到已消失的 lock 会触发 ENOENT，并让数据目录迁移失败。
        // 这些文件都属于 bootstrap 写入中间态，不能迁移到新数据根。
        return false;
      }
      // Windows 非提权环境下 fs.cp 无法复制符号链接（EPERM）。
      // 跳过符号链接可避免 Windows 非提权环境下 fs.cp 报 EPERM。
      try {
        if (lstatSync(source).isSymbolicLink()) return false;
      } catch {
        // lstat 失败时放行，让 cp 自行处理
      }
      return true;
    },
  });
}
