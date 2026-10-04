import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { XCodeStdioTapDevState } from "@zcode/shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface XCodeStdioTapStateFile {
  enabled?: boolean;
}

function isXCodeStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

function getXCodeStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getXCodeStdioTapDevLogDir(): string {
  return join(getXCodeStdioTapDevDir(), "stdio-traffic");
}

function getXCodeStdioTapDevStatePath(): string {
  return join(getXCodeStdioTapDevDir(), "zcode-stdio-tap.json");
}

function readStateFile(path: string): XCodeStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as XCodeStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readXCodeStdioTapDevState(): XCodeStdioTapDevState {
  const visible = isXCodeStdioTapDevVisible();
  const statePath = getXCodeStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getXCodeStdioTapDevLogDir(),
    statePath,
  };
}

export function setXCodeStdioTapDevEnabled(enabled: boolean): XCodeStdioTapDevState {
  const visible = isXCodeStdioTapDevVisible();
  const statePath = getXCodeStdioTapDevStatePath();
  mkdirSync(getXCodeStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        // 开发态 stdio 抓包是高频原始协议帧，只能通过显式开关写旁路文件，避免误进生产日志。
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readXCodeStdioTapDevState();
}
