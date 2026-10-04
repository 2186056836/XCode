// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListXCodeSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunXCodeProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  XCodeApp,
  XCodeAppOptions,
  XCodeModelOption,
} from "./app/types.js";
export * from "./auth-login.js";
export {
  inspectXCodeCustomCommand,
  listXCodeCustomCommands,
  loadXCodeCustomCommand,
} from "./custom-commands.js";
export type {
  InspectXCodeCustomCommandOptions,
  ListXCodeCustomCommandsOptions,
  XCodeCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addXCodePluginMarketplace,
  getXCodePluginsOverview,
  installXCodeMarketplacePlugin,
  listXCodePlugins,
  removeXCodePluginMarketplace,
  resolveXCodePlugins,
  setXCodePluginEnabled,
  uninstallXCodeMarketplacePlugin,
  updateXCodeMarketplacePlugin,
  updateXCodePluginMarketplace,
  validateXCodePluginPath,
} from "./plugins.js";
export type {
  AddXCodeMarketplaceOptions,
  InstallXCodeMarketplacePluginOptions,
  ListXCodePluginsOptions,
  RemoveXCodeMarketplaceOptions,
  ResolveXCodePluginsOptions,
  SetXCodePluginEnabledOptions,
  SetXCodePluginEnabledResult,
  UninstallXCodeMarketplacePluginOptions,
  UpdateXCodeMarketplaceOptions,
  UpdateXCodeMarketplacePluginOptions,
  ValidateXCodePluginPathOptions,
  XCodeAvailablePluginData,
  XCodeInstalledPluginData,
  XCodeMarketplaceSummaryData,
  XCodeMarketplaceUpdateData,
  XCodePluginInstallData,
  XCodePluginUpdateData,
  XCodePluginsOverviewData,
} from "./plugins.js";
export { runXCodeProtocolAgent } from "./zcode-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./zcode-protocol/session-mapper.js";
export { prepareXCodeTelemetryEnv, shutdownXCodeTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listXCodeSessions, resolveLatestSession } from "./sessions.js";
export { inspectXCodeSkill, listXCodeSkills } from "./skills.js";
export type {
  InspectXCodeSkillOptions,
  ListXCodeSkillsOptions,
  XCodeSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedXCodeSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
