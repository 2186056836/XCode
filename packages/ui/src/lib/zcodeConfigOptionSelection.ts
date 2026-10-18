import type { XCodeConfigOption } from "@zcode/shared";

function readCurrentSelectValue(
  options: readonly XCodeConfigOption[],
  category: "model" | "thought_level",
): string | null {
  const option = options.find(
    (candidate) => candidate.category === category && candidate.type === "select",
  );
  const value = typeof option?.currentValue === "string" ? option.currentValue.trim() : "";
  return value || null;
}

export function readCurrentAgentModel(options: readonly XCodeConfigOption[]): string | null {
  return readCurrentSelectValue(options, "model");
}

export function readCurrentAgentThoughtLevel(options: readonly XCodeConfigOption[]): string | null {
  return readCurrentSelectValue(options, "thought_level");
}

export function isAgentThoughtLevelAvailable(
  options: readonly XCodeConfigOption[],
  thoughtLevel: string | null | undefined,
): boolean {
  const normalized = thoughtLevel?.trim();
  if (!normalized) return false;
  const option = options.find(
    (candidate) => candidate.category === "thought_level" && candidate.type === "select",
  );
  return Boolean(option?.options?.some((candidate) => candidate.value === normalized));
}
