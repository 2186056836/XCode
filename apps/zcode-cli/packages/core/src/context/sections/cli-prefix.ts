// ============================================================
// CLI Prefix Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

const CLI_PREFIX_PROMPT = "You are XCode, an interactive agent";
// 官方 ZCode 品牌行：zai 的 start-plan 端点对 system 逐字校验，必须官方文案（1103 官方措辞）。
const OFFICIAL_CLI_PREFIX_PROMPT = "You are ZCode, an interactive agent";

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

/**
 * 该 provider 的请求是否必须用官方 ZCode 提示词。
 *
 * start-plan 端点对 system 逐字校验，fork 的 XCode 品牌文案会被判 405。
 * 主会话与子代理共用这一个判定，避免两处 provider 列表漂移。
 */
export function isOfficialSystemPromptProvider(providerId: string | undefined): boolean {
  return (
    providerId === "account:zai-start-plan" || providerId === "account:bigmodel-start-plan"
  );
}
