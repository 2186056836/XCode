import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@zcode/tui";
import type { UiLocale } from "@zcode/i18n";
import type { Logger } from "@zcode/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@zcode/adapters/browser";
import type {
  createModelAdapter,
  createXCodeApp,
  CreateModelAdapterOptions,
  configureCodingPlanApiKey,
  ConfigureCodingPlanApiKeyOptions,
  inspectXCodeSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectXCodeCustomCommand,
  InspectXCodeCustomCommandOptions,
  InspectXCodeSkillOptions,
  loginXCodeCli,
  loginBigmodelCodingPlan,
  LoginBigmodelCodingPlanOptions,
  LoginXCodeCliOptions,
  listXCodeCustomCommands,
  ListXCodeCustomCommandsOptions,
  loadXCodeCustomCommand,
  listXCodeSessions,
  listXCodeSkills,
  ListXCodeSessionsOptions,
  ListXCodeSkillsOptions,
  logoutXCodeCli,
  LogoutXCodeCliOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunXCodeProtocolAgentOptions,
  prepareXCodeTelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownXCodeTelemetry,
  XCodeAppOptions,
} from "@zcode/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@zcode/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  protocolLifecycle?: RunXCodeProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createXCodeApp?: (
    options?: XCodeAppOptions,
  ) => Awaited<ReturnType<typeof createXCodeApp>> | ReturnType<typeof createXCodeApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createXCodeApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectXCodeSkillOptions) => ReturnType<typeof inspectXCodeSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectXCodeCustomCommandOptions,
  ) => ReturnType<typeof inspectXCodeCustomCommand>;
  loginXCodeCli?: (options?: LoginXCodeCliOptions) => ReturnType<typeof loginXCodeCli>;
  loginBigmodelCodingPlan?: (
    options?: LoginBigmodelCodingPlanOptions,
  ) => ReturnType<typeof loginBigmodelCodingPlan>;
  configureCodingPlanApiKey?: (
    options: ConfigureCodingPlanApiKeyOptions,
  ) => ReturnType<typeof configureCodingPlanApiKey>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareXCodeTelemetryEnv?: typeof prepareXCodeTelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListXCodeSessionsOptions) => ReturnType<typeof listXCodeSessions>;
  listCustomCommands?: (
    options: ListXCodeCustomCommandsOptions,
  ) => ReturnType<typeof listXCodeCustomCommands>;
  loadCustomCommand?: (
    options: InspectXCodeCustomCommandOptions,
  ) => ReturnType<typeof loadXCodeCustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedXCodeSlashCommandName"];
  listSkills?: (options: ListXCodeSkillsOptions) => ReturnType<typeof listXCodeSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  logoutXCodeCli?: (options?: LogoutXCodeCliOptions) => ReturnType<typeof logoutXCodeCli>;
  runXCodeProtocolAgent?: (options?: RunXCodeProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@zcode/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownXCodeTelemetry?: typeof shutdownXCodeTelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createXCodeApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
