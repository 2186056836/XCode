import { DEFAULT_ZCODE_ENDPOINT_ORIGIN } from "./zcodeEndpoint.js";

export const ZCODE_SOURCE_HEADERS = {
  "User-Agent": "XCode/unknown",
  "HTTP-Referer": DEFAULT_ZCODE_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildXCodeSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeXCodeSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildXCodeSourceHeadersFromContext(
  options: BuildXCodeSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeXCodeSourceHeaderValue(options.appVersion);
  const arch = normalizeXCodeSourceHeaderValue(options.arch);
  const clientLanguage = normalizeXCodeSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeXCodeSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeXCodeSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeXCodeSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_ZCODE_ENDPOINT_ORIGIN;
  const osVersion = normalizeXCodeSourceHeaderValue(options.osVersion);
  const platform = normalizeXCodeSourceHeaderValue(options.platform);
  const releaseChannel = normalizeXCodeSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeXCodeSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...ZCODE_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `XCode/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-XCode-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
