import {
  XCODE_AGENT_PROVIDER,
  XCODE_COMMAND_AGENT_SOURCES,
  type XCodeProvider,
  type CommandAgentSource,
} from "@zcode/shared";

export const COMMAND_AGENT_SOURCES = [
  ...XCODE_COMMAND_AGENT_SOURCES,
] as const satisfies readonly CommandAgentSource[];

export const COMMAND_AGENT_SOURCE_META: Record<
  CommandAgentSource,
  {
    labelId: string;
    provider: XCodeProvider;
    pathHint: string;
  }
> = {
  zcodeAgent: {
    labelId: "settings.commands.source.zcodeAgent",
    pathHint: "~/.zcode/commands",
    provider: XCODE_AGENT_PROVIDER,
  },
};
