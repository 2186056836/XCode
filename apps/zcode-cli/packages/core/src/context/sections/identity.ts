// ============================================================
// Identity Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import type { OutputStylePromptConfig } from "../types.js";
import { estimateTokens } from "../utils.js";

/**
 * `# Harness` 块：稳定运行时约束，不属于 output style 可替换的 coding instructions，
 * 也是工作流子代理身份（sections/workflow-actor.ts）逐字复用的那一段。
 */
export function buildHarnessBlock(): string {
  return [
    "# Harness",
    "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
    "- Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
    "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
    "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
    "- Reference code as `file_path:line_number` \u2014 it's clickable.",
  ].join("\n");
}

function buildIdentityPrompt(outputStyle?: OutputStylePromptConfig): string {
  const intro = outputStyle
    ? "You respond to the user according to the active Output Style below while using XCode's tools and instructions."
    : "You are an interactive XCode agent that helps users with software engineering tasks.";

  const identityLines = ["", intro].join("\n");

  return [identityLines, "", buildHarnessBlock()].join("\n");
}

export function buildIdentitySection(outputStyle?: OutputStylePromptConfig): ContextSection {
  const content = buildIdentityPrompt(outputStyle);

  return {
    name: "Agent Identity",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
