import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { XCodeProvider } from "./zcode-task-types-core.js";

export const XCODE_AGENT_PROVIDER = "glm" satisfies XCodeProvider;
export const XCODE_AGENT_PROVIDER_LABEL = "XCode Agent";
export const XCODE_COMMAND_AGENT_SOURCE = "zcodeAgent" satisfies CommandAgentSource;

/**
 * 解析持久化/relay 数据时的 provider 归一 schema：
 * 已移除的第三方 provider 历史值仅作为归一化输入保留，统一收敛为 glm；
 * 其它非法值保持拒绝，与收窄前的校验边界一致。
 */
export const legacyZCodeProviderSchema = z
  .enum(["claude", "opencode", "gemini", "codex", "glm"])
  .transform((): typeof XCODE_AGENT_PROVIDER => XCODE_AGENT_PROVIDER);

// fork 兼容：单值字面量 schema（1010 版改名/移除，此处保留导出）
export const zcodeAgentProviderSchema = z.literal(XCODE_AGENT_PROVIDER);

/**
 * 上一轮合并漏做了本文件这两处导出的 Z→X 词表改名（仍是 ZCODE_ 前缀），而 W 类
 * 合并进来的 task-realtime-core / validation / validationAppSettings 已按词表引用
 * XCode 侧名字。此处补上规范名，并把旧名保留为别名，避免依赖两套命名的调用方断裂。
 */
export const legacyXCodeProviderSchema = legacyZCodeProviderSchema;

export const ZCODE_ENABLED_AGENT_PROVIDERS = [
  XCODE_AGENT_PROVIDER,
] as const satisfies readonly XCodeProvider[];

export const XCODE_ENABLED_AGENT_PROVIDERS = ZCODE_ENABLED_AGENT_PROVIDERS;

export const XCODE_COMMAND_AGENT_SOURCES = [
  XCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToXCodeAgent(
  _provider?: XCodeProvider | null,
): XCodeProvider {
  return XCODE_AGENT_PROVIDER;
}

export function normalizeAgentProvidersToXCodeAgent(
  _providers?: ReadonlyArray<XCodeProvider> | null,
): XCodeProvider[] {
  return [...ZCODE_ENABLED_AGENT_PROVIDERS];
}

export function normalizeCommandAgentSourceToZCodeAgent(
  _agentSource?: CommandAgentSource | null,
): CommandAgentSource {
  return XCODE_COMMAND_AGENT_SOURCE;
}

export function isXCodeAgentProvider(
  provider: XCodeProvider | null | undefined,
): provider is typeof XCODE_AGENT_PROVIDER {
  return provider === XCODE_AGENT_PROVIDER;
}
