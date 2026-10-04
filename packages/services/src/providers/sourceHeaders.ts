import { readFileSync } from "node:fs";
import { version as readOsVersion } from "node:os";
import { join } from "node:path";
import {
  buildXCodeSourceHeadersFromContext,
  normalizeXCodeSourceHeaderValue,
  ZCODE_ENV,
  ZCODE_SOURCE_HEADERS,
  ZCODE_VERSION,
} from "@zcode/shared";
import { getAppConfigDir } from "../paths.js";

export { ZCODE_SOURCE_HEADERS };

interface XCodeSourceHeaderOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  osVersion?: string;
  platform?: NodeJS.Platform;
  releaseChannel?: string;
  /** 当前激活账号引用（provider:identity）；设置时读取该账号的独立 X-Device-Mid。 */
  accountRef?: string;
}

let cachedDeviceMid: { stateFile: string; accountRef?: string; value: string } | null = null;

function normalizePrintableHeaderValue(value: string | undefined): string | undefined {
  return normalizeXCodeSourceHeaderValue(value);
}

function resolveClientLanguage(): string {
  return normalizePrintableHeaderValue(Intl.DateTimeFormat().resolvedOptions().locale) ?? "unknown";
}

function resolveClientTimezone(): string {
  return (
    normalizePrintableHeaderValue(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "unknown"
  );
}

function readExistingDeviceMid(accountRef?: string): string | undefined {
  const stateFile = join(getAppConfigDir(), "telemetry-state.json");
  if (
    cachedDeviceMid?.stateFile === stateFile &&
    cachedDeviceMid.accountRef === accountRef
  ) {
    return cachedDeviceMid.value;
  }

  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as {
      deviceMid?: unknown;
      accounts?: Record<string, { deviceMid?: unknown }>;
    };
    let deviceMid: string | undefined;
    if (accountRef && typeof parsed.accounts?.[accountRef]?.deviceMid === "string") {
      deviceMid = parsed.accounts[accountRef].deviceMid as string;
    } else if (typeof parsed.deviceMid === "string") {
      deviceMid = parsed.deviceMid;
    }
    const normalized = normalizePrintableHeaderValue(deviceMid);
    if (!normalized) {
      return undefined;
    }

    cachedDeviceMid = { stateFile, accountRef, value: normalized };
    return normalized;
  } catch {
    // deviceMid 的生命周期由 desktop/telemetry 负责；这里仅复用已存在值，不生成新身份。
    return undefined;
  }
}

export function buildXCodeSourceHeaders(
  options: XCodeSourceHeaderOptions = {},
): Record<string, string> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const appVersion = normalizePrintableHeaderValue(options.appVersion ?? ZCODE_VERSION);
  const releaseChannel = normalizePrintableHeaderValue(options.releaseChannel ?? ZCODE_ENV);
  const clientLanguage =
    normalizePrintableHeaderValue(options.clientLanguage) ?? resolveClientLanguage();
  const clientTimezone =
    normalizePrintableHeaderValue(options.clientTimezone) ?? resolveClientTimezone();
  const osVersion = normalizePrintableHeaderValue(options.osVersion ?? readOsVersion());
  const deviceMid = readExistingDeviceMid(options.accountRef);

  return buildXCodeSourceHeadersFromContext({
    appVersion,
    arch,
    clientLanguage,
    clientTimezone,
    deviceMid,
    osVersion,
    platform,
    releaseChannel,
    sourceTitle: "electron",
  });
}
