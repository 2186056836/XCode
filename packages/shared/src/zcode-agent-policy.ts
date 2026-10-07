import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { XCodeProvider } from "./zcode-task-types-core.js";

export const XCODE_AGENT_PROVIDER = "glm" satisfies XCodeProvider;
export const XCODE_AGENT_PROVIDER_LABEL = "XCode Agent";
export const XCODE_COMMAND_AGENT_SOURCE = "zcodeAgent" satisfies CommandAgentSource;

export const zcodeAgentProviderSchema = z.literal(XCODE_AGENT_PROVIDER);

export const XCODE_COMMAND_AGENT_SOURCES = [
  XCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToXCodeAgent(
  _provider?: XCodeProvider | null,
): XCodeProvider {
  return XCODE_AGENT_PROVIDER;
}

export function isXCodeAgentProvider(
  provider: XCodeProvider | null | undefined,
): provider is typeof XCODE_AGENT_PROVIDER {
  return provider === XCODE_AGENT_PROVIDER;
}
