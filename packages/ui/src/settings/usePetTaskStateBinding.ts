/**
 * 全局会话状态 → 桌宠绑定（复刻 Codex 官方「聚合全部会话」语义）。
 *
 * 官方的宠物反映**所有会话**的 attention，不随当前打开的窗格变化：
 * 切到别的会话时，后台仍在跑的任务继续驱动宠物跑步；完成的轮次进入通知托盘。
 *
 * XCode 里唯一不依赖「哪个 SessionPane 正被挂载」的全量实时源是 sessions-index：
 * CLI 把每个会话的 phase / pendingInteraction 推给 renderer，侧栏任务列表消费的
 * 也是它。这里直接订阅 sessions-index 注册表（workspace 维度共享 store），
 * 每条会话单独上报一个 source（`task:<sessionId>`），由主进程按官方优先级聚合。
 *
 * 只上报这一层还不够：官方通知有「已读/过期」语义，否则所有历史会话的
 * completedSuccess 会让宠物永久停在 Ready。这里补齐：
 *   - 挂载时把已存在的历史轮次全部当作已读（只对之后的新活动出通知）；
 *   - 会话处于打开状态（active task）→ 该轮 review/failed 通知已读；
 *   - 过期：failed 1h / waiting 24h / review 7d（取自 lastActivityAt）。
 *
 * waiting 的审批动作（options）仍由 SessionPane 的 pane:<sessionId> 上报，
 * 主进程聚合时优先级更高的一方可带动作；本模块不重复实现 resolveInteraction。
 */
import { useEffect, useRef } from "react";
import { useXCodeSessionStore } from "@/store/zcodeSessionStore.js";
import {
  readSessionsIndexRegistry,
  subscribeSessionsIndexRegistry,
} from "@/v4/sessionsIndexRegistry.js";
import { openPetNotificationTarget } from "@/lib/petNotificationNavigation.js";
import type { SessionSummary } from "@zcode/shared/zcode-protocol-v4";

type PetBridgeWindow = Window & {
  zcode?: {
    petOverlay?: {
      setState(
        state: string,
        attentionCount?: number,
        source?: string,
        title?: string,
        waitingKind?: string,
      ): void;
      clearState?(source: string): void;
      onOpenSessionRequest?(callback: (payload: { sessionId: string }) => void): () => void;
    };
  };
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 官方过期窗口（use-avatar-overlay-selection: xn/Sn/Cn）。 */
const FAILED_TTL_MS = 1 * HOUR_MS;
const WAITING_TTL_MS = 1 * DAY_MS;
const REVIEW_TTL_MS = 7 * DAY_MS;
/** 过期只看时间差，低频重算即可。 */
const EXPIRY_TICK_MS = 30_000;

const SOURCE_PREFIX = "task:";
/** 上一版单源上报的 key，挂载时清掉避免残留。 */
const LEGACY_SOURCE = "task-runtime";
/**
 * 可以被「已读」静默的状态：完成与失败都是终态，用户看过就该从托盘消失
 * （官方 dismissedNotificationTurnKeys 同样按通知条目 dismiss，不分 kind）。
 * waiting 是仍需要人处理的状态，必须保留。
 */
const DISMISSIBLE_STATES = new Set(["review", "failed"]);
/**
 * 会话处于打开状态（active task）时自动视为已读的终态。官方对焦点会话排除
 * review；failed 按用户裁决同样在打开后消失（否则报错通知会一直挂着）。
 * running 不在此列：它是瞬时态，切走后任务还在跑，通知要回来。
 */
const FOCUS_READ_STATES = new Set(["review", "failed"]);

interface PetSessionReport {
  state: "running" | "waiting" | "failed" | "review";
  attention: number;
  title?: string;
  waitingKind?: string;
}

interface SessionLocation {
  workspacePath: string;
  workspaceIdentity?: string;
}

function buildReport(summary: SessionSummary, nowMs: number): PetSessionReport | null {
  const pending = summary.pendingInteractionSummary;
  const pendingCount = (pending?.permissionCount ?? 0) + (pending?.userInputCount ?? 0);
  const title = summary.title?.trim() || undefined;
  const activityAt = summary.lastActivityAt || 0;
  if (pendingCount > 0) {
    if (nowMs - activityAt > WAITING_TTL_MS) return null;
    return {
      state: "waiting",
      attention: pendingCount,
      ...(title ? { title } : {}),
      waitingKind: (pending?.permissionCount ?? 0) > 0 ? "permission" : "question",
    };
  }
  switch (summary.phase) {
    case "running":
    case "prewarming":
      return { state: "running", attention: 0, ...(title ? { title } : {}) };
    case "error":
      if (nowMs - activityAt > FAILED_TTL_MS) return null;
      return { state: "failed", attention: 1, ...(title ? { title } : {}) };
    case "completedSuccess":
    case "completedInterrupted":
      if (nowMs - activityAt > REVIEW_TTL_MS) return null;
      return { state: "review", attention: 0, ...(title ? { title } : {}) };
    default:
      // draft：尚未产生输入的空会话，官方也不进托盘。
      return null;
  }
}

function dismissalKey(sessionId: string, summary: SessionSummary): string {
  return `${sessionId}:${summary.lastActivityAt ?? 0}`;
}

function activeSessionIds(): Set<string> {
  const ids = new Set<string>();
  const workspaces = useXCodeSessionStore.getState().workspaces ?? {};
  for (const workspace of Object.values(workspaces)) {
    if (workspace?.activeTaskId) ids.add(workspace.activeTaskId);
  }
  return ids;
}

/**
 * 应用级挂载一次。订阅 sessions-index 的全部 workspace store；
 * 任何后台会话变化都会触发重算并逐条上报。
 */
export function usePetTaskStateBinding(): void {
  const lastSentBySourceRef = useRef(new Map<string, string>());
  const dismissedRef = useRef(new Set<string>());
  const seenSessionsRef = useRef(new Set<string>());
  const locationBySessionRef = useRef(new Map<string, SessionLocation>());
  const dismissalBySessionRef = useRef(new Map<string, string>());

  useEffect(() => {
    const bridge = (window as PetBridgeWindow).zcode?.petOverlay;
    // 主窗重载后本模块的来源表是空的；先清空主进程里的存量来源，
    // 否则上一轮运行残留的会话行会一直挂在托盘上。
    bridge?.clearState?.("*");
    bridge?.clearState?.(LEGACY_SOURCE);

    const compute = (): void => {
      const nowMs = Date.now();
      const activeIds = activeSessionIds();
      const registryEntries = readSessionsIndexRegistry();
      const located = registryEntries.flatMap((entry) =>
        entry.sessions.map((summary) => ({
          summary,
          location: {
            workspacePath: entry.workspacePath,
            ...(entry.workspaceIdentity ? { workspaceIdentity: entry.workspaceIdentity } : {}),
          } satisfies SessionLocation,
        })),
      );
      const locationBySession = new Map<string, SessionLocation>();
      const dismissalBySession = new Map<string, string>();
      for (const item of located) {
        locationBySession.set(item.summary.sessionId, item.location);
        dismissalBySession.set(
          item.summary.sessionId,
          dismissalKey(item.summary.sessionId, item.summary),
        );
      }
      locationBySessionRef.current = locationBySession;
      dismissalBySessionRef.current = dismissalBySession;

      // 首次见到的会话把「当前轮次」当作已读：sessions-index 是全量会话列表，
      // 不设基线的话挂载时刻的全部历史 completedSuccess 会一次性塞满托盘；
      // 且 workspace index 是逐个到达的，只按「首个快照」播种会漏掉晚到的会话。
      // 只有首见时已是终态（review/failed）或空态的会话才播种：running/waiting
      // 是活会话，完成时 lastActivityAt 未必变化，播种会把完成通知一起吞掉。
      const currentDismissKeys = new Set<string>();
      for (const item of located) {
        const sessionId = item.summary.sessionId;
        const key = dismissalKey(sessionId, item.summary);
        currentDismissKeys.add(key);
        const report = buildReport(item.summary, nowMs);
        if (!seenSessionsRef.current.has(sessionId)) {
          seenSessionsRef.current.add(sessionId);
          if (!report || report.state === "review" || report.state === "failed") {
            dismissedRef.current.add(key);
          }
        }
        if (report && activeIds.has(sessionId) && FOCUS_READ_STATES.has(report.state)) {
          dismissedRef.current.add(key);
        }
      }
      // 只为仍存在的会话保留 dismiss / 首见记录，避免长期运行后无限增长。
      for (const key of dismissedRef.current) {
        if (!currentDismissKeys.has(key)) dismissedRef.current.delete(key);
      }
      for (const sessionId of seenSessionsRef.current) {
        if (!locationBySession.has(sessionId)) seenSessionsRef.current.delete(sessionId);
      }

      const seenSources = new Set<string>();
      for (const item of located) {
        const report = buildReport(item.summary, nowMs);
        if (!report) continue;
        // 已读/已点击的通知（完成、失败）不再占托盘和角标；waiting 必须留着等人处理。
        if (
          DISMISSIBLE_STATES.has(report.state) &&
          dismissedRef.current.has(dismissalKey(item.summary.sessionId, item.summary))
        ) {
          continue;
        }
        const source = `${SOURCE_PREFIX}${item.summary.sessionId}`;
        seenSources.add(source);
        const signature = [
          report.state,
          report.attention,
          report.title ?? "",
          report.waitingKind ?? "",
        ].join("\u0000");
        if (lastSentBySourceRef.current.get(source) === signature) continue;
        lastSentBySourceRef.current.set(source, signature);
        bridge?.setState(report.state, report.attention, source, report.title, report.waitingKind);
      }

      // Map 迭代器允许在循环内 delete 当前项。
      for (const source of lastSentBySourceRef.current.keys()) {
        if (seenSources.has(source)) continue;
        lastSentBySourceRef.current.delete(source);
        bridge?.clearState?.(source);
      }
    };

    // 点击通知托盘某一行：标记该会话当前轮次已读，并让主窗切过去。
    const unsubscribeOpenSession = bridge?.onOpenSessionRequest?.((payload) => {
      const location = locationBySessionRef.current.get(payload.sessionId);
      const dismissal = dismissalBySessionRef.current.get(payload.sessionId);
      if (dismissal) dismissedRef.current.add(dismissal);
      // 先重算把该行撤掉，再触发跳转：跳转会同步写 store，不能让它的中间态打断这次清理。
      compute();
      if (!location) return;
      openPetNotificationTarget({
        sessionId: payload.sessionId,
        workspacePath: location.workspacePath,
        ...(location.workspaceIdentity ? { workspaceIdentity: location.workspaceIdentity } : {}),
      });
    });

    compute();
    const unsubscribeIndex = subscribeSessionsIndexRegistry(compute);
    const unsubscribeStore = useXCodeSessionStore.subscribe(compute);
    const expiryTimer = setInterval(compute, EXPIRY_TICK_MS);
    return () => {
      unsubscribeIndex();
      unsubscribeStore();
      unsubscribeOpenSession?.();
      clearInterval(expiryTimer);
      for (const source of lastSentBySourceRef.current.keys()) {
        bridge?.clearState?.(source);
      }
      lastSentBySourceRef.current.clear();
    };
  }, []);
}
