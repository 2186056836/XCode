import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { XCodeProvider } from "./zcode-task-types-core.js";

export const ZCODE_AGENT_PROVIDER = "glm" satisfies XCodeProvider;
export const ZCODE_AGENT_PROVIDER_LABEL = "XCode Agent";
export const ZCODE_COMMAND_AGENT_SOURCE = "zcodeAgent" satisfies CommandAgentSource;

export const zcodeAgentProviderSchema = z.literal(ZCODE_AGENT_PROVIDER);

export const ZCODE_COMMAND_AGENT_SOURCES = [
  ZCODE_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToXCodeAgent(
  _provider?: XCodeProvider | null,
): XCodeProvider {
  return ZCODE_AGENT_PROVIDER;
}

export function isXCodeAgentProvider(
  provider: XCodeProvider | null | undefined,
): provider is typeof ZCODE_AGENT_PROVIDER {
  return provider === ZCODE_AGENT_PROVIDER;
}
