const ZCODE_PROCESS_PREFIX = "zcode";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinXCodeProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [ZCODE_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatXCodeMainProcessName(): string {
  return joinXCodeProcessName("main");
}

export function formatXCodeGpuProcessName(): string {
  return joinXCodeProcessName("gpu");
}

export function formatXCodeHostProcessName(label?: string): string {
  return joinXCodeProcessName("host", label);
}

export function formatXCodeRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "XCode") {
    return joinXCodeProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinXCodeProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "XCode - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinXCodeProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinXCodeProcessName("renderer", normalizedTitle);
}

export function formatXCodeAgentProcessName(provider: string, workspacePath?: string): string {
  return joinXCodeProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatXCodeUtilityProcessName(name?: string, type = "utility"): string {
  return joinXCodeProcessName(type, name);
}
