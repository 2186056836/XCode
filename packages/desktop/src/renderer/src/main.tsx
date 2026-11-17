/* eslint-disable max-lines -- Desktop renderer bridge 聚合平台、远端 attachment 与启动编排契约。 */
import type { XCodeAgentGenerateWorkspaceTextParams } from "@zcode/services";
import { DatabaseStartupAdmission } from "./databaseStartupAdmission.js";
import { initializeDesktopLocalTtft } from "./local-ttft/contract.js";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import {
  AppErrorBoundary,
  Root,
  GlobalDatabaseStartupLoading,
  UpdateStatusWindowRoot,
  XCodeIntlProvider,
  getRemoteWorkspaceSession,
  registerBaseWorkspaceServices,
  registerRemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
  createRemoteWorkspaceDisconnectedError,
  playTaskNotificationSound,
  setStreamClientId,
  setReactErrorArmsReporter,
} from "@zcode/ui";
import "@zcode/ui/styles.css";
import { connectViaMessagePort, createMessagePortServiceConnection } from "@zcode/client";
import {
  InternalChannels,
  databaseStartupStateSchema,
  type DatabaseStartupControl,
  parseLaunchMarks,
  LAUNCH_MARKS_QUERY_KEY,
  type LaunchMarks,
  DEFAULT_LOCALE,
  isLocale,
} from "@zcode/shared";
import type { Locale } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import { createDesktopPlatform } from "./desktopPlatform.js";
import { startPerformanceTimelineCleanup } from "./performanceTimelineCleanup.js";
import { initializeDesktopUserActionTrace } from "./userActionTraceBootstrap.js";
import { buildRemoteWorkspaceSessionServicesForRegistration } from "./remoteWorkspaceSessionServices.js";
import { handleSourceSettingsServicePortMessage } from "./sourceSettingsServicePortBridge.js";
import {
  notifyRemoteWorkspaceServicePortReady,
  parseRemoteWorkspaceServicePortMessage,
  parseRemoteWorkspaceServicePortReleasedMessage,
  type RemoteWorkspaceServicePortRegistration,
} from "./remoteWorkspaceServicePortBridge.js";

type DesktopRendererImportMetaEnv = {
  VITE_XCODE_E2E_STORE_BRIDGE?: string;
};

startPerformanceTimelineCleanup();

// T4:renderer bundle 开始执行。同时从 loadURL query 解析 main 注入的 T0-T3。
const rendererStartedAt = Date.now();
const launchMarks: LaunchMarks | null = parseLaunchMarks(
  new URLSearchParams(window.location.search).get(LAUNCH_MARKS_QUERY_KEY),
);
(
  window as Window & {
    __XCODE_RENDERER_START__?: number;
    __XCODE_LAUNCH_MARKS__?: LaunchMarks | null;
  }
).__XCODE_RENDERER_START__ = rendererStartedAt;
(window as Window & { __XCODE_LAUNCH_MARKS__?: LaunchMarks | null }).__XCODE_LAUNCH_MARKS__ =
  launchMarks;
registerE2EStoreBridgesIfEnabled();

function registerE2EStoreBridgesIfEnabled() {
  const env = ((import.meta as ImportMeta & { env?: DesktopRendererImportMetaEnv }).env ??
    {}) as DesktopRendererImportMetaEnv;
  if (env.VITE_XCODE_E2E_STORE_BRIDGE !== "1") {
    return;
  }

  void import("@zcode/ui/e2e-store-bridge").then(({ registerE2EStoreBridges }) => {
    registerE2EStoreBridges();
  });
}

// 初始化主题：默认 Zai dark，后续由 useTheme hook 接管
{
  const saved = localStorage.getItem("zcode-theme") || "zai-dark";
  const resolved =
    saved === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : saved === "dark" || saved === "zai-dark"
        ? "dark"
        : "light";
  const appliedTheme =
    saved === "system"
      ? resolved === "dark"
        ? "zai-dark"
        : "zai-light"
      : saved === "dark"
        ? "zai-dark"
        : saved === "light"
          ? "zai-light"
          : saved;
  if (resolved === "dark") document.documentElement.classList.add("dark");
  document.documentElement.classList.toggle("theme-zai-light", appliedTheme === "zai-light");
  document.documentElement.classList.toggle("theme-zai-dark", appliedTheme === "zai-dark");
}

const isMacDesktop = navigator.userAgent.includes("Mac");
const isWindowsDesktop = navigator.userAgent.includes("Windows");
const isLinuxDesktop = !isMacDesktop && !isWindowsDesktop;
// macOS hidden 原生标题栏仍参与鼠标拖拽命中，深层浮层需要平台标记避开其高度。
document.documentElement.classList.toggle("platform-mac-desktop", isMacDesktop);
// Windows 的原生 titleBarOverlay 与 renderer 共用右上角，深层浮层拿不到
// Root 的 isWindowsDesktop prop 时会把关闭按钮放进原生窗控命中区。根节点平台标记只描述
// Desktop chrome，不会让普通 Windows Web 误用标题栏安全区。
document.documentElement.classList.toggle("platform-windows-desktop", isWindowsDesktop);
// Linux 的窗口标题栏由 renderer 自绘，应用内 Dialog overlay 如果覆盖整个 webContents，
// 会把标题栏点击区一起拦截。给桌面 Linux 根节点打平台标记，让 UI overlay 能只在 Linux 避开标题栏。
document.documentElement.classList.toggle("platform-linux-desktop", isLinuxDesktop);
const isLocalDevelopmentRuntime =
  (
    globalThis as typeof globalThis & {
      __XCODE_LOCAL_DEVELOPMENT_RUNTIME__?: boolean;
    }
  ).__XCODE_LOCAL_DEVELOPMENT_RUNTIME__ === true;

function readBooleanFlag(name: string, defaultValue: boolean): boolean {
  const value = new URLSearchParams(window.location.search).get(name);
  if (value == null) return defaultValue;
  return value !== "false" && value !== "0";
}

function readStringFlag(name: string): string | undefined {
  const value = new URLSearchParams(window.location.search).get(name);
  return value == null || value.trim() === "" ? undefined : value;
}

const restoreSession = readBooleanFlag("restoreSession", true);
const supportsSettings = readBooleanFlag("supportsSettings", true);
const initialWorkspaceAbsPath = readStringFlag("initialWorkspacePath");
const initialWorkspacePurpose = readStringFlag("initialWorkspacePurpose");
const unavailableWorkspacePath = readStringFlag("unavailableWorkspacePath");
const windowKind = readStringFlag("windowKind");
const initialLocaleFlag = readStringFlag("locale");
const initialLocale: Locale = isLocale(initialLocaleFlag) ? initialLocaleFlag : DEFAULT_LOCALE;
let baseServicesForRemoteSessions: IServiceAccessor | null = null;
const pendingRemoteWorkspaceServicePorts: RemoteWorkspaceServicePortRegistration[] = [];
// 登记对象 → attachment：释放通知只作用于当时那次登记；用 WeakMap 随 session 注销自动回收。
const remoteSessionAttachmentIds = new WeakMap<object, string>();

const desktopPlatform = createDesktopPlatform({ isLocalDevelopmentRuntime });
initializeDesktopLocalTtft(desktopPlatform);
initializeDesktopUserActionTrace({
  platform: desktopPlatform,
  isLocalDevelopmentRuntime,
});

/**
 * 等待 preload 通过 window.postMessage 转发 MessagePort。
 *
 * MessagePort 不能经过 contextBridge（会丢失原生方法），
 * 所以 preload 用 window.postMessage + transfer 把 port 原样传递到 renderer。
 * 本地窗口的 port 来自 utilityProcess，远程窗口也一样，renderer 无需区分。
 */
// 之前用匿名函数注册 addEventListener("message")，reload/HMR 时会重复注册，
// 导致多次 createRoot 在同一 DOM 节点上挂载。用 flag 防止重复初始化。
let appInitialized = false;
const databaseStartupAdmission = new DatabaseStartupAdmission();
const appRoot =
  windowKind === "update-status" ? null : createRoot(document.getElementById("root")!);
const sendStartupControl = (control: DatabaseStartupControl) =>
  window.postMessage({ type: InternalChannels.DatabaseStartupControl, control }, "*");
function renderDatabaseStartup(): void {
  appRoot?.render(
    <AppErrorBoundary isDesktop isMacDesktop={isMacDesktop} isWindowsDesktop={isWindowsDesktop}>
      <XCodeIntlProvider
        initialLocale={initialLocaleFlag ? initialLocale : undefined}
        resolveSystemLocale={desktopPlatform.getSystemLocale}
      >
        <StartupReadyNotifier />
        <GlobalDatabaseStartupLoading
          state={databaseStartupAdmission.state}
          onRetry={() => {
            if (databaseStartupAdmission.state)
              sendStartupControl({
                action: "retry",
                attemptId: databaseStartupAdmission.state.attemptId,
              });
          }}
          onCopy={(details) => navigator.clipboard.writeText(details)}
          onExportLogs={() => desktopPlatform.exportLogs()}
          onExit={() => sendStartupControl({ action: "exit" })}
        />
      </XCodeIntlProvider>
    </AppErrorBoundary>,
  );
}
function enterAppIfPrepared(): void {
  if (appInitialized) return;
  const port = databaseStartupAdmission.takeReadyPort();
  if (port) initializeBusinessRoot(port);
}
const firstStartupStateTimer =
  windowKind === "update-status"
    ? undefined
    : setTimeout(() => {
        if (databaseStartupAdmission.state) return;
        const now = Date.now();
        databaseStartupAdmission.state = {
          schemaVersion: 1,
          startupId: "unavailable",
          attemptId: "startup-channel-unavailable",
          sequence: 0,
          startedAt: rendererStartedAt,
          updatedAt: now,
          phase: "failed",
          errorCode: "startup_status_timeout",
          disk: [],
        };
        renderDatabaseStartup();
      }, 30_000);

function registerRemoteWorkspaceServicePort(params: RemoteWorkspaceServicePortRegistration) {
  if (!baseServicesForRemoteSessions) {
    return;
  }

  const remoteConnection = createMessagePortServiceConnection(params.port);
  const remoteServices = remoteConnection.services;
  const services = buildRemoteWorkspaceSessionServicesForRegistration({
    baseServices: baseServicesForRemoteSessions,
    remoteServices,
    targetKind: params.target.kind,
    sourceServerId: params.sourceServerId,
  });
  const session = {
    sessionId: params.sessionId,
    ...(params.sourceServerId ? { sourceServerId: params.sourceServerId } : {}),
    ...(params.workspacePath ? { workspacePath: params.workspacePath } : {}),
    ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
    ...(params.workspacePurpose ? { workspacePurpose: params.workspacePurpose } : {}),
    target: params.target,
    services,
    dispose: (reason?: Error) =>
      remoteConnection.dispose(reason ?? createRemoteWorkspaceDisconnectedError()),
  };
  remoteSessionAttachmentIds.set(session, params.attachmentId);
  registerRemoteWorkspaceSession(session);
  // canonical workspace bind 会换代 remote-scoped port。
  // 只有 store 已注册新 services 后才能确认 ready，bind IPC 返回后的调用方才可重新读取并使用新代 services。
  notifyRemoteWorkspaceServicePortReady(params);
}

function releaseRemoteWorkspaceServicePort(params: { attachmentId: string; sessionId: string }) {
  const session = getRemoteWorkspaceSession(params.sessionId);
  // 只释放通知所指的那次登记；同一 session 已被后续 attachment 覆盖时不受影响。
  if (session && remoteSessionAttachmentIds.get(session) === params.attachmentId) {
    unregisterRemoteWorkspaceSession(params.sessionId);
  }
}

function flushPendingRemoteWorkspaceServicePorts(): void {
  if (!baseServicesForRemoteSessions || pendingRemoteWorkspaceServicePorts.length === 0) {
    return;
  }

  const pending = pendingRemoteWorkspaceServicePorts.splice(0);
  for (const entry of pending) {
    registerRemoteWorkspaceServicePort(entry);
  }
}

function StartupReadyNotifier() {
  useEffect(() => {
    // T5:React 首次 commit。供启动分阶段耗时计算 react_commit 段。
    (window as Window & { __XCODE_REACT_COMMIT_AT__?: number }).__XCODE_REACT_COMMIT_AT__ =
      Date.now();
    // HTML 启动壳的弹出动画结束时，React 首屏可能还没 commit，直接移除壳会露出空白。
    // 这里在 React commit 后通知 index.html，再由启动壳统一判断动画和 React ready 两个条件后退场。
    window.dispatchEvent(new Event("zcode-react-startup-ready"));
  }, []);

  return null;
}

function handleServicePortMessage(event: MessageEvent): void {
  if (event.source === window && event.data?.type === InternalChannels.DatabaseStartupState) {
    const result = databaseStartupStateSchema.safeParse(event.data.state);
    if (!result.success || appInitialized) return;
    const next = result.data;
    if (!databaseStartupAdmission.acceptState(next)) return;
    if (firstStartupStateTimer) clearTimeout(firstStartupStateTimer);
    renderDatabaseStartup();
    enterAppIfPrepared();
    return;
  }

  if (event.data === InternalChannels.TaskNotificationSound) {
    void playTaskNotificationSound();
    return;
  }

  if (handleSourceSettingsServicePortMessage(event)) return;

  const remoteWorkspacePort = parseRemoteWorkspaceServicePortMessage(event);
  if (remoteWorkspacePort) {
    if (!baseServicesForRemoteSessions) {
      // renderer reload 时 main 可能先补投 remote port，再投本地 ServicePort。
      // 早到的 remote port 不能直接丢弃，否则 SSH host 仍存活但 UI 会进入断连代理。
      pendingRemoteWorkspaceServicePorts.push(remoteWorkspacePort);
      return;
    }

    registerRemoteWorkspaceServicePort(remoteWorkspacePort);
    return;
  }

  const releasedRemoteWorkspacePort = parseRemoteWorkspaceServicePortReleasedMessage(event);
  if (releasedRemoteWorkspacePort) {
    releaseRemoteWorkspaceServicePort(releasedRemoteWorkspacePort);
    return;
  }

  if (
    event.source !== window ||
    event.data?.type !== InternalChannels.ServicePort ||
    appInitialized
  )
    return;
  const port = event.ports[0];
  if (!port) return;
  databaseStartupAdmission.acceptPort({ databaseStartupId: event.data.databaseStartupId }, port);
  enterAppIfPrepared();
}

// DSH 桌宠的模型通道（碎碎念/对话）：主窗渲染层持有 workspace services
// （ServicePort 落地时写入 baseServicesForRemoteSessions）。监听放模块级，
// 生成请求到达时取当时的首选模型（= 跟随当前会话），结果定向回 main。
function replyPetGenerate(payload: { requestId: string; text?: string; error?: string }): void {
  const bridge = (
    window as unknown as {
      zcode?: {
        dshPetGenerateResult?: (p: { requestId: string; text?: string; error?: string }) => void;
      };
    }
  ).zcode;
  bridge?.dshPetGenerateResult?.(payload);
}

window.addEventListener("message", (event) => {
  const data = event.data as { type?: string; payload?: {
    requestId?: string; prompt?: string; workspacePath?: string;
    selection?: { providerId?: string; modelId?: string } | null;
    /** 带图对话：user 消息的完整内容块（text + image）。 */
    messages?: Array<{
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image"; mediaType: string; dataUrl: string }
      >;
    }>;
  } } | null;
  if (!data || data.type !== "dsh-pet-generate-request" || !data.payload) return;
  const services = baseServicesForRemoteSessions;
  const {
    requestId,
    prompt,
    workspacePath,
    selection: requestedSelection,
    messages,
  } = data.payload;
  if (!services || !requestId || !prompt || !workspacePath) {
    if (requestId) replyPetGenerate({ requestId });
    return;
  }
  void (async () => {
    // 面板里指定了 whisperModel/chatModel 就用它；留空 = 跟随当前会话模型（preferredSelection）。
    const view = await services.modelSelectionService.getView();
    const requested = requestedSelection;
    const base =
      requested && requested.providerId && requested.modelId
        ? { providerId: requested.providerId, modelId: requested.modelId }
        : view.preferredSelection;
    let selection = base;
    // 辅助生成的选项必须整组显式给出（Core 的 validateOptions 对 maxOutputTokens
    // 是必填校验）：预算对齐 Core 辅助调用的 5,000 且不超过模型规格上限
    // （auxiliaryModelOptions 同式）；思考档取 disabled（不支持时取最低一档）。
    const petModel = base
      ? view.providers.find((item) => item.providerId === base.providerId)?.models.find(
          (item) => item.modelId === base.modelId,
        )
      : undefined;
    const specs = (
      petModel?.config as
        | {
            optionSpecs?: {
              reasoningLevel?: { values?: string[] };
              maxOutputTokens?: { max?: number };
            };
          }
        | undefined
    )?.optionSpecs;
    const levels = specs?.reasoningLevel?.values ?? [];
    const level =
      levels.length === 0 ? undefined : levels.includes("disabled") ? "disabled" : levels[0];
    const maxOutputTokens = Math.min(5_000, specs?.maxOutputTokens?.max ?? 5_000);
    if (base) {
      // 选择里只带思考档（modelSelection schema 不收 maxOutputTokens，它走
      // generateWorkspaceText 的顶层参数）。
      const candidate =
        level === undefined ? base : { ...base, options: { reasoningLevel: level } };
      const resolved = await services.modelSelectionService.getView({ selection: candidate });
      selection = resolved.effectiveSelection ?? candidate;
      if (resolved.selectionIssue) {
        console.log("[dsh-pet] selection issue:", resolved.selectionIssue);
      }
    }
    console.log("[dsh-pet] generate request", requestId, "selection:", selection ? `${selection.providerId}/${selection.modelId}` : "null");
    if (!selection) {
      replyPetGenerate({ requestId, error: "no-selection" });
      return;
    }
    const result = await services.zcodeAgentService.generateWorkspaceText({
      workspacePath,
      selection,
      prompt,
      // 1112 协议的 user 消息 content 收敛为 string；宠物聊天的分片形态待迁移，先显式断言。
      ...(Array.isArray(messages) && messages.length > 0
        ? { messages: messages as unknown as XCodeAgentGenerateWorkspaceTextParams["messages"] }
        : {}),
      querySource: "dsh-pet",
      // 显式预算（见 petOptions）；requestTimeoutMs 让协议层登记 operationId，
      // Core 才会用调用方的 signal 而不是自己的 60s 硬超时。
      maxOutputTokens,
      requestTimeoutMs: 170_000,
    });
    console.log("[dsh-pet] generate ok", requestId, (result.text || "").slice(0, 40));
    replyPetGenerate({ requestId, text: result.text });
  })().catch((error: unknown) => {
    console.warn("[dsh-pet] generate failed", requestId, error instanceof Error ? error.message : String(error));
    replyPetGenerate({ requestId, error: error instanceof Error ? error.message : String(error) });
  });
});


function initializeBusinessRoot(port: MessagePort): void {
  appInitialized = true;
  const services = connectViaMessagePort(port, {
    sourceServerManagementService: true,
    deviceSyncStateService: true,
    managedWorktreeService: true,
    // 扩展门面只在桌面本机 Host 注册（docs/plugins/extension-host.md）。
    extensionsService: true,
  });
  baseServicesForRemoteSessions = services;
  registerBaseWorkspaceServices(services);
  flushPendingRemoteWorkspaceServicePorts();
  // DSH 桌宠的碎碎念/对话生成：不传 selection = 跟随当前会话模型；结果定向回 main。

  const settingService = supportsSettings ? services.settingService : undefined;

  // 初始化稳定的设备 ID，确保所有 hook 在首次渲染前就使用正确的值
  setStreamClientId(desktopPlatform.getDeviceId());

  // React 错误边界捕获的异常不会冒泡到 window.onerror，RUM Browser SDK 默认收不到。
  // 必须在 createRoot 之前注入 reporter：根级 AppErrorBoundary 的职责正是兜住 Root 自身
  // 渲染崩溃，若依赖 Root 的 effect 注入，则 Root 首帧就崩时上报会丢失。
  setReactErrorArmsReporter(desktopPlatform);

  appRoot?.render(
    <AppErrorBoundary isDesktop isMacDesktop={isMacDesktop} isWindowsDesktop={isWindowsDesktop}>
      <XCodeIntlProvider
        settingService={settingService}
        broadcastService={services.broadcastService}
        resolveSystemLocale={desktopPlatform.getSystemLocale}
      >
        <StartupReadyNotifier />
        <Root
          services={services}
          platform={desktopPlatform}
          isDesktop
          assistantCodeCommentCardsEnabled
          isMacDesktop={isMacDesktop}
          isWindowsDesktop={isWindowsDesktop}
          restoreSession={restoreSession}
          supportsSettings={supportsSettings}
          initialWorkspaceAbsPath={initialWorkspaceAbsPath}
          initialWorkspacePurpose={
            initialWorkspacePurpose === "conversation" ? "conversation" : "project"
          }
          unavailableWorkspacePath={unavailableWorkspacePath}
        />
      </XCodeIntlProvider>
    </AppErrorBoundary>,
  );
}

window.addEventListener("message", handleServicePortMessage);
if (windowKind !== "update-status") {
  renderDatabaseStartup();
  sendStartupControl({ action: "snapshot" });
}

if (windowKind === "update-status") {
  createRoot(document.getElementById("root")!).render(
    <AppErrorBoundary isDesktop isMacDesktop={isMacDesktop} isWindowsDesktop={isWindowsDesktop}>
      <StartupReadyNotifier />
      <UpdateStatusWindowRoot
        platform={desktopPlatform}
        initialLocale={initialLocale}
        onRequestClose={() => window.close()}
      />
    </AppErrorBoundary>,
  );
}
