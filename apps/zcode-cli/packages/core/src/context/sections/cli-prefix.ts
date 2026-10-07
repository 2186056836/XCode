// ============================================================
// CLI Prefix Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

const CLI_PREFIX_PROMPT = "You are XCode, an interactive coding agent";
const OFFICIAL_CLI_PREFIX_PROMPT = "You are ZCode, an interactive coding agent";

export function buildCliPrefixSection(): ContextSection {
  const content = CLI_PREFIX_PROMPT;

  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}

/** 官方 ZCode 身份行：zai 的 start-plan 端点对 system 逐字校验，必须用官方文案。 */
export function buildOfficialCliPrefixSection(): ContextSection {
  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: OFFICIAL_CLI_PREFIX_PROMPT.length,
    tokens: estimateTokens(OFFICIAL_CLI_PREFIX_PROMPT),
    content: OFFICIAL_CLI_PREFIX_PROMPT,
    preview: OFFICIAL_CLI_PREFIX_PROMPT.slice(0, 100),
  };
}
