import { getPluginUiSessionActions } from "./pluginUiSessionActions.js";
import { logger } from "@/logger.js";
import { createPluginUiMessagePortTransport } from "@/plugin-ui/adapters/messagePortTransport.js";
import { createPluginUiDownloadInteraction } from "@/plugin-ui/adapters/pluginUiDownloads.js";
import { readPluginUiStyleVariables } from "@/plugin-ui/adapters/readPluginUiStyleVariables.js";
import {
  createPluginUiHostController,
  type PluginUiHostController,
  type PluginUiHostPhase,
} from "@/plugin-ui/app/pluginUiHostController.js";
import { createPluginUiResourceNotificationRegistrar } from "@/plugin-ui/app/pluginUiResourceNotificationBus.js";
import {
  clearPluginUiWidgetState,
  getPluginUiWidgetState,
  setPluginUiWidgetState,
} from "@/plugin-ui/app/pluginUiWidgetStateStore.js";
import type {
  McpUiAppCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { PluginSandboxHandle } from "@zcode/shared/mcp-apps";
import { buildPluginSandboxScopeId } from "@zcode/shared/mcp-apps";
import { clearPluginUiSurfaceFeed } from "../app/pluginUiSurfaceFeedStore.js";
import {
  PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX,
  PLUGIN_UI_CARD_MAX_HEIGHT_PX,
  PLUGIN_UI_CARD_MIN_HEIGHT_PX,
} from "../contract.js";
import { buildPluginUiHostCapabilities } from "../domain/buildPluginUiHostCapabilities.js";
import { buildPluginUiHostContext } from "../domain/buildPluginUiHostContext.js";

import { acquireWorkspaceConnection } from "@/v4/workspaceConnectionRegistry.js";
import type { IServiceAccessor } from "@zcode/services";
import type { IPlatformService } from "@zcode/shared";
import { buildPluginUiSessionKey } from "../contract.js";
import type { Page, UsePluginUiHostInput, UsePluginUiHostResult } from "./pluginUiHostTypes.js";
import { createPluginUiPagePlane } from "./pluginUiPagePlane.js";
import { pluginUiPages } from "./pluginUiPageRegistry.js";
import { attachPluginUiResourceDeltaFeed } from "./pluginUiResourceDeltaFeed.js";
type Platform = IPlatformService;
type Services = IServiceAccessor;
export function createPage(
  key: string,
  input: UsePluginUiHostInput,
  platform: Platform,
  services: Services,
): Page {
  const bridge = services.pluginUiBridgeService!;
  const sandboxPlatform = platform.pluginSandbox!;
  const surfaceKey = key;
  const latest = { current: input };
  const listeners = new Set<() => void>();
  let controller: PluginUiHostController | null = null;
  let releaseFeed: (() => void) | undefined;
  let releaseLease: (() => void) | undefined;
  let disposed = false;
  let starting = false;
  let incarnation = 0;
  let releasing: Promise<unknown> = Promise.resolve();
  let contextInputs = "";
  let lastFeed = "";
  let lastContext = "";
  let appIdentity: string | undefined;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let snapshot: UsePluginUiHostResult = {
    pageKey: key,
    supported: true,
    phase: "idle",
    handle: null,
    height: PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX,
    error: null,
    appCapabilities: undefined,
    reload: () => {
      clearPluginUiWidgetState(key);
      void page.suspend(true).then(ensure);
    },
  };
  const patch = (value: Partial<UsePluginUiHostResult>) => {
    snapshot = { ...snapshot, ...value };
    notify();
  };
  const setPhase = (phase: PluginUiHostPhase) => patch({ phase });
  const setHandle = (handle: PluginSandboxHandle) => {
    if (appIdentity && appIdentity !== handle.instance.appIdentity) clearPluginUiWidgetState(key);
    appIdentity = handle.instance.appIdentity;
    patch({ handle });
    plane.mount(handle);
  };
  const setHeight = (height: number) => patch({ height });
  const setError = (error: string) => patch({ error });
  const setAppCapabilities = (appCapabilities: McpUiAppCapabilities | undefined) =>
    patch({ appCapabilities });
  const plane = createPluginUiPagePlane({
    onVisibility(visible) {
      if (page.visible !== visible) pluginUiPages.visibility(page, visible);
      if (visible) ensure();
    },
    onCrash() {
      void page.suspend(true);
      patch({ phase: "error", error: "MCP App page stopped" });
    },
  });
  async function ensure() {
    if (disposed || controller || starting || snapshot.phase === "error") return;
    starting = true;
    const epoch = ++incarnation;
    try {
      await releasing;
      if (disposed || epoch !== incarnation) return;
      await pluginUiPages.reserve(page);
    } catch (error) {
      starting = false;
      patch({ phase: "error", error: String(error) });
      return;
    }
    if (disposed || epoch !== incarnation) {
      pluginUiPages.released(page);
      return;
    }
    starting = false;
    try {
      // é¡µé¢ç¬ç«ææå·²æ workspace è¿æ¥ç§çº¦ï¼å¡çæ pane éåºä¸ä¼è®©åå°é¡µé¢å¤±èã
      const connection = acquireWorkspaceConnection(
        latest.current.scope,
        services.zcodeAgentService,
        platform.createLocalMediaPreviewUrl,
      );
      releaseLease = () => connection.release();
      const lease = connection.layer.acquire(latest.current.scope.sessionId);
      const runtimeStopped = () => {
        void page.suspend(true);
        patch({ phase: "error", error: "MCP App runtime is no longer available" });
      };
      const offRestart = connection.transport.onRuntimeRestart(runtimeStopped);
      const offLifecycle = connection.transport.onRuntimeLifecycle?.((state) => {
        if (state === "unavailable") runtimeStopped();
      });
      releaseLease = () => {
        offRestart();
        offLifecycle?.();
        lease.release();
        connection.release();
      };
      releaseFeed = attachPluginUiResourceDeltaFeed(lease.store, latest.current.scope);
      patch({ phase: "preparing", error: null, handle: null });
      createController();
    } catch (error) {
      void page.suspend(true);
      patch({ phase: "error", error: String(error) });
    }
  }
  function createController() {
    const initialHostContext: McpUiHostContext = buildPluginUiHostContext({
      theme: latest.current.theme,
      locale: latest.current.locale,
      displayMode: latest.current.displayMode,
      width: latest.current.width,
      ...(latest.current.titleBar ? { titleBar: latest.current.titleBar } : {}),
      ...(latest.current.availableDisplayModes
        ? { availableDisplayModes: latest.current.availableDisplayModes }
        : {}),
      // ä¸»é¢ token éåå§ hostContext ä¸åï¼ä¸»é¢åæ¢æ¶ç» updateHostContext æ´æ°ã
      styleVariables: readPluginUiStyleVariables(),
    });
    const scope = latest.current.scope;
    const presentation = latest.current.presentation;
    // å¹³å°äº¤äºï¼downloadFileï¼ä¸è°ç¨æ¹æ³¨å¥çä¼è¯äº¤äºåæä¸ä»½ï¼è½åå£°ææåæåçåè°æ¯å¦å­å¨ã
    const platformInteractions = createPluginUiDownloadInteraction({
      platform,
      bridge,
      scope,
      presentation,
      getInstance: () => {
        if (!snapshot.handle) throw new Error("MCP App is not prepared");
        return snapshot.handle.instance;
      },
    });
    const nextController = createPluginUiHostController({
      bridge,
      sampling: services?.pluginUiSamplingService,
      ...(services?.pluginUiAppToolsService ? { appTools: services.pluginUiAppToolsService } : {}),
      createTransport: createPluginUiMessagePortTransport,
      platform: sandboxPlatform,
      scope,
      presentation,
      // æä»£éç»è®°å°è·¯ç±è¡¨ï¼è¯¥ä¼è¯çæå½± store æ¶å° pluginUi.* å¢éåæ (scopeId, generation) æéã
      resourceNotifications: createPluginUiResourceNotificationRegistrar(
        scope,
        presentation.serverName,
      ),
      initialHostContext,
      hostVersion: latest.current.hostVersion,
      getToolFeed: () => ({
        ...(latest.current.toolInput ? { toolInput: { arguments: latest.current.toolInput } } : {}),
        ...(latest.current.toolResult ? { toolResult: latest.current.toolResult } : {}),
        ...(latest.current.toolCancelled ? { toolCancelled: true } : {}),
      }),
      // widgetState åå¼ç´æ¥è¯»å®¿ä¸»åå­ storeï¼å¯ä¸ ownerï¼ï¼ä¸ç» props åç¼å­ä¸ä»½ï¼
      // ç«¯å£æéæ¶æè¯»ï¼ç¦»å±åæ¶åéå»ºä¹æ¿å°é¡µé¢æè¿ä¸æ¬¡ä¸»å¨ä¿å­çå¼ã
      getWidgetState: () => getPluginUiWidgetState(surfaceKey),
      getHostCapabilities: () =>
        buildPluginUiHostCapabilities({
          canSendFollowUpMessage: Boolean(latest.current.interactions?.onSendFollowUpMessage),
          canUpdateModelContext: Boolean(latest.current.interactions?.onUpdateModelContext),
          canSetWidgetState: true,
          canSample: Boolean(services?.pluginUiSamplingService && getPluginUiSessionActions(scope)),
          canSubscribeResources: true,
          canDownloadFile: Boolean(platformInteractions?.onDownloadFile),
          ...(scope.scope.kind === "surface" ? { surfaceId: scope.scope.surfaceId } : {}),
        }),
      ...platformInteractions,
      // ç» latest ref è½¬è°ï¼åè° identity ååä¸è§¦å controller éå»ºï¼ç¼ºçå -32601ï¼ç«¯å£å±ç¿»è¯æ ProtocolErrorï¼ã
      onSendFollowUpMessage: (payload, context) =>
        latest.current.interactions?.onSendFollowUpMessage
          ? latest.current.interactions.onSendFollowUpMessage(payload, context)
          : Promise.reject(Object.assign(new Error("Not supported"), { code: -32601 })),
      onUpdateModelContext: (payload) =>
        latest.current.interactions?.onUpdateModelContext
          ? latest.current.interactions.onUpdateModelContext(payload)
          : Promise.reject(Object.assign(new Error("Not supported"), { code: -32601 })),
      onUpdateWidgetState: async (widgetState) => {
        setPluginUiWidgetState(surfaceKey, widgetState);
      },
      onPhase: (next, detail) => {
        if (controller !== nextController) return;
        // çå½å¨æäºä»¶æ¯ä¸ªæ²ç®±åªæå æ¡ï¼èµ° lifecycle æè½è¿ä¸»æ¥å¿ï¼ææ¥ç¨æ·ç°åºç¨ï¼ã
        logger.lifecycle.info("[plugin-ui] lifecycle", {
          phase: next,
          sessionId: latest.current.scope.sessionId,
          pluginId: latest.current.presentation.pluginId,
          scopeId: buildPluginSandboxScopeId(latest.current.scope.scope),
          ...(detail?.error ? { error: detail.error } : {}),
        });
        if (next === "error") {
          void page.suspend(true);
          patch({ phase: "error", error: detail?.error ?? "MCP App failed" });
          return;
        }
        setPhase(next);
        if (detail?.handle) {
          setHandle(detail.handle);
          // èµæºå£°æçåå§é«åº¦æ¿ä»£åºå® 240ï¼ä»å min / max clampã
          const hint = detail.handle.resourceMeta?.heightHint;
          if (hint !== undefined) setHeight(clampCardHeight(hint, detail.handle));
          // èµæºå£°æçæµè§å¨æééå¥æå°è¾¾ï¼æ©äºç«¯å£ï¼ï¼è¿ hostContext è®©é¡µé¢ feature detectï¼è§èèæ¡ `permissions`ï¼ã
          const permissions = detail.handle.resourceMeta?.permissions;
          if (permissions?.length) {
            nextController.updateHostContext({
              permissions: Object.fromEntries(permissions.map((item) => [item, {}])),
            });
          }
        }
        if (detail?.error) setError(detail.error);
      },
      onInstanceClosed: () => {
        void page.suspend(true);
        clearPluginUiWidgetState(key);
        patch({ phase: "error", error: "MCP App connection is no longer available" });
      },
      onBusyChange: () => {
        if (controller === nextController) pluginUiPages.settled(page);
      },
      onAppCapabilities: setAppCapabilities,
      onHeight: (next) => setHeight(clampCardHeight(next, snapshot.handle)),
      onDisplayModeRequest: (mode) => latest.current.onDisplayModeRequest?.(mode) ?? mode,
      onOpenExternal: (url) => latest.current.onOpenExternal?.(url),
      log: (message, detail) => logger.warn(message, detail),
    });

    controller = nextController;
    controller.start();
  }
  const task = buildPluginUiSessionKey(input.scope);
  const workspaceEvents = services.zcodeTaskService.onDynamicWorkspaceEvent({
    workspacePath: input.scope.workspacePath,
    workspaceIdentity: input.scope.workspaceIdentity,
  })((event) => {
    if (
      event.type === "workspace_task_list_changed" &&
      event.reason === "task_deleted" &&
      event.taskId === input.scope.sessionId
    )
      pluginUiPages.removeTask(task);
  });
  const page: Page = {
    kind: "mcp",
    key,
    task,
    visible: false,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    busy: () => controller?.isBusy() ?? false,
    running: () => controller !== null || starting,
    bind(node, sidebar) {
      const off = plane.bind({
        node,
        kind: sidebar ? "sidebar" : "inline",
        container: node.closest<HTMLElement>("[data-sandbox-page-container]") ?? undefined,
      });
      ensure();
      return off;
    },
    update(next) {
      // èæ¯åèéç¹ä¸è½è¦çä¾§æ å½åçäº¤äºä¸ä¸æã
      if (next.enabled === false) return;
      latest.current = next;
      const nextContextInputs = JSON.stringify([
        next.theme,
        next.locale,
        next.displayMode,
        next.width,
        next.titleBar,
        next.availableDisplayModes,
      ]);
      if (nextContextInputs !== contextInputs) {
        contextInputs = nextContextInputs;
        const context = buildPluginUiHostContext({
          theme: next.theme,
          locale: next.locale,
          displayMode: next.displayMode,
          width: next.width,
          titleBar: next.titleBar,
          availableDisplayModes: next.availableDisplayModes,
          styleVariables: readPluginUiStyleVariables(),
        });
        const contextKey = JSON.stringify(context);
        if (contextKey !== lastContext) {
          lastContext = contextKey;
          controller?.updateHostContext(context);
        }
      }
      const feed = JSON.stringify([
        next.toolCallId,
        next.toolInput,
        next.toolResult,
        next.toolCancelled,
      ]);
      if (feed !== lastFeed) {
        lastFeed = feed;
        if (next.toolInput) controller?.notifyToolInput({ arguments: next.toolInput });
        if (next.toolResult) controller?.notifyToolResult(next.toolResult);
        if (next.toolCancelled) controller?.notifyToolCancelled();
      }
    },
    async suspend(force = false) {
      const candidate = controller;
      if (!force && (starting || (candidate && !(await candidate.tryRecycle().catch(() => false)))))
        return false;
      // å®¡æ¹æ¥çº³ä¸åå°åæ¶å¨ Agent åå­è£å³ï¼ç­å¾æé´æ¿æ¢ç controller ä¸åæ§ç»æå½±åã
      if (!force && candidate !== controller) return false;
      incarnation++;
      starting = false;
      const previous = controller;
      controller = null;
      const previousHandle = snapshot.handle;
      const offFeed = releaseFeed,
        offLease = releaseLease;
      releaseFeed = undefined;
      releaseLease = undefined;
      patch({ phase: "idle", handle: null, appCapabilities: undefined });
      // ååéæ¾æªå®ææ¶ä¸è½éæ°é¢å¤ï¼åå¤éè¯ä¹åªç­å¾åä¸ä¸ªéæ¾é¾ã
      // Main ä¸»å¨å¯¼èªå° about:blank ä¼è§¦å navigationï¼åè§£é¤æ§ä»£éè§å¯ï¼é¿ååæ¶è¢«è¯¯æ¥ä¸ºå´©æºã
      if (previousHandle) plane.prepareUnmount(previousHandle.sandboxId);
      const closing = previous?.dispose();
      releasing = Promise.all([releasing, closing]).then(() => {
        if (previousHandle) plane.unmount(previousHandle.sandboxId);
        offFeed?.();
        offLease?.();
        pluginUiPages.released(page);
      });
      await releasing;
      // ç­å¾ Agent åæ¶ç­å¤æ¶éç¹å¯è½éæ°å¯è§ï¼éæ¾å®æåç±åä¸ owner æ¢å¤ï¼é¿ååå¨ç©ºé¡µé¢ã
      if (!force && page.visible && !disposed) void ensure();
      return true;
    },
    destroy() {
      workspaceEvents.dispose();
      clearPluginUiSurfaceFeed(key);
      disposed = true;
      void page.suspend(true).finally(() => plane.dispose());
      clearPluginUiWidgetState(key);
      listeners.clear();
    },
  };
  return page;
}

/** å¡çé«åº¦ clampï¼ä¸éåèµæº `minFrameHeight` ä¸å®¿ä¸»æå°å¼çè¾å¤§èï¼ä¸éåºå®ã */
function clampCardHeight(next: number, handle: PluginSandboxHandle | null): number {
  const min = Math.max(PLUGIN_UI_CARD_MIN_HEIGHT_PX, handle?.resourceMeta?.minFrameHeight ?? 0);
  return Math.min(PLUGIN_UI_CARD_MAX_HEIGHT_PX, Math.max(min, next));
}
