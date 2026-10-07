import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { XCodeImportSessionsResult, XCodeImportableSessionCandidate } from "@zcode/shared";
import { logger } from "@/logger.js";
import { useXCodeTaskService } from "@/hooks/useXCodeTaskService.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { invalidateTaskQueryCacheByScopes } from "@/store/taskQueryCacheStore.js";
import type {
  ClaudeMigrationRange,
  ClaudeMigrationWorkspaceFilterMode,
  ClaudeSessionMigrationSupportState,
} from "@/hooks/useClaudeSessionMigration.js";

const DEFAULT_LIMIT = 100;
const MAX_SCAN_LIMIT = 500;
export const UNLIMITED_XCODE_SCAN_LIMIT_INPUT = "unlimited";
const STORAGE_KEY = "zcode-migration:session-import";

const RANGE_TO_DURATION_MS: Record<Exclude<ClaudeMigrationRange, "all">, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

/** 与 host 侧 backgroundJobRegistry JobSnapshot 对齐的本地视图（仅取 UI 需要的字段）。 */
export interface ZcodeImportJobSnapshot {
  running: boolean;
  startedAt: number;
  finishStatus?: "success" | "error";
  progress?: number;
  total?: number;
  result?: XCodeImportSessionsResult;
  error?: string;
}

interface PersistedState {
  workspaceFilterMode: ClaudeMigrationWorkspaceFilterMode;
  range: ClaudeMigrationRange;
  limitInput: string;
  candidates: XCodeImportableSessionCandidate[];
  selectedSessionIds: string[];
  lastImportResult: XCodeImportSessionsResult | null;
}

function loadPersistedState(): PersistedState | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(state.candidates)) return null;
    return state;
  } catch {
    return null;
  }
}

function persistState(state: PersistedState): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储失败（隐私模式等）不阻断功能，仅失去跨页恢复。
  }
}

function resolveModifiedSince(range: ClaudeMigrationRange): number | undefined {
  if (range === "all") return undefined;
  return Date.now() - RANGE_TO_DURATION_MS[range];
}

function resolveScanLimit(limitInput: string): number | undefined {
  if (limitInput === UNLIMITED_XCODE_SCAN_LIMIT_INPUT) return undefined;
  const parsed = Number.parseInt(limitInput.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_SCAN_LIMIT);
}

// Host dist 类型仍按旧 IXCodeTaskService 导出；新增的 ZCode 选择性导入方法用局部断言补齐。
type ZCodeImportCapableTaskService = ReturnType<typeof useXCodeTaskService> & {
  scanImportableZCodeSessions(params: {
    workspacePath?: string;
    modifiedSince?: number;
    limit?: number;
  }): Promise<XCodeImportableSessionCandidate[]>;
  importZCodeSessions(params: { sessionIds: string[] }): Promise<{ started: boolean }>;
  getZcodeImportStatus(): Promise<ZcodeImportJobSnapshot | null>;
};

function normalizeWorkspaceFilterMode(
  mode: ClaudeMigrationWorkspaceFilterMode,
  workspacePath: string | null,
): ClaudeMigrationWorkspaceFilterMode {
  if (mode === "current" && !workspacePath) return "all";
  return mode;
}

export function useZCodeSessionMigration(params: {
  workspacePath: string | null;
  workspaceIdentity?: string;
  isDesktop?: boolean;
}) {
  const rawTaskService = useXCodeTaskService(
    params.workspacePath ?? undefined,
    undefined,
    params.workspaceIdentity,
  );
  const zcodeTaskService = rawTaskService as ZCodeImportCapableTaskService;
  const tabStoreApi = useTabStoreApi();

  // 挂载先恢复持久化状态；无则用默认值（首次进入）。
  const initial = useMemo(loadPersistedState, []);
  const [workspaceFilterModeState, setWorkspaceFilterModeState] =
    useState<ClaudeMigrationWorkspaceFilterMode>(
      initial?.workspaceFilterMode ?? "all",
    );
  const [range, setRange] = useState<ClaudeMigrationRange>(initial?.range ?? "30d");
  const [limitInput, setLimitInput] = useState(initial?.limitInput ?? String(DEFAULT_LIMIT));
  const [candidates, setCandidates] = useState<XCodeImportableSessionCandidate[]>(
    initial?.candidates ?? [],
  );
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>(
    initial?.selectedSessionIds ?? [],
  );
  const [lastImportResult, setLastImportResult] = useState<XCodeImportSessionsResult | null>(
    initial?.lastImportResult ?? null,
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ processed: number; total: number } | null>(
    null,
  );

  // 轮询 job 用；组件卸载时清。
  const pollTimerRef = useRef<number | null>(null);

  // 状态变更写回 sessionStorage，保证切页面回来不丢、无需重扫。
  useEffect(() => {
    persistState({
      workspaceFilterMode: workspaceFilterModeState,
      range,
      limitInput,
      candidates,
      selectedSessionIds,
      lastImportResult,
    });
  }, [workspaceFilterModeState, range, limitInput, candidates, selectedSessionIds, lastImportResult]);

  const workspaceFilterMode = useMemo(
    () => normalizeWorkspaceFilterMode(workspaceFilterModeState, params.workspacePath),
    [workspaceFilterModeState, params.workspacePath],
  );

  const effectiveWorkspacePath = useMemo(
    () => (workspaceFilterMode === "current" ? (params.workspacePath ?? undefined) : undefined),
    [workspaceFilterMode, params.workspacePath],
  );

  const supportState = useMemo<ClaudeSessionMigrationSupportState>(() => {
    if (!params.isDesktop) return { supported: false, reason: "desktopOnly" };
    return { supported: true };
  }, [params.isDesktop]);

  const scanLimit = useMemo(() => resolveScanLimit(limitInput), [limitInput]);

  const setWorkspaceFilterMode = useCallback(
    (mode: ClaudeMigrationWorkspaceFilterMode) => {
      setWorkspaceFilterModeState(normalizeWorkspaceFilterMode(mode, params.workspacePath));
    },
    [params.workspacePath],
  );

  // 处理导入结果（轮询到 finished 时调用）：失效缓存、让新会话进侧栏、清已处理勾选。
  const applyImportResult = useCallback(
    (result: XCodeImportSessionsResult) => {
      setLastImportResult(result);
      const handledSessionIds = new Set([
        ...result.imported.map((item) => item.sessionId),
        ...result.skipped.map((item) => item.sessionId),
        ...result.failed.map((item) => item.sessionId),
      ]);
      setSelectedSessionIds((previous) =>
        previous.filter((sessionId) => !handledSessionIds.has(sessionId)),
      );
      if (result.imported.length > 0) {
        const importedWorkspacePaths = new Set(result.imported.map((item) => item.workspacePath));
        const importedWorkspaceScopes = result.imported.map((item) => ({
          workspacePath: item.workspacePath,
        }));
        for (const workspacePath of importedWorkspacePaths) {
          tabStoreApi.getState().ensureWorkspaceTab(workspacePath);
        }
        invalidateTaskQueryCacheByScopes(importedWorkspaceScopes);
      }
      logger.info(
        `[Migration] ZCode 会话导入完成 imported=${result.imported.length} skipped=${result.skipped.length} failed=${result.failed.length}`,
      );
    },
    [tabStoreApi],
  );

  // 启动对会话导入 job 的轮询；running 时每 ~1s 刷新进度，结束后收尾。切页面再回来会重新轮询。
  const startPolling = useCallback(() => {
    if (pollTimerRef.current !== null) return;
    const poll = async () => {
      if (!zcodeTaskService) return;
      try {
        const snap = await zcodeTaskService.getZcodeImportStatus();
        if (!snap) {
          setIsImporting(false);
          setImportProgress(null);
          if (pollTimerRef.current !== null) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          return;
        }
        if (snap.running) {
          setIsImporting(true);
          setImportProgress(
            snap.progress !== undefined && snap.total
              ? { processed: snap.progress, total: snap.total }
              : null,
          );
          setImportError(null);
          return;
        }
        // 任务结束
        setIsImporting(false);
        setImportProgress(null);
        if (pollTimerRef.current !== null) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        if (snap.result) {
          applyImportResult(snap.result as XCodeImportSessionsResult);
        } else if (snap.error) {
          setImportError(snap.error);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[Migration] 轮询 ZCode 会话导入状态失败", error);
        setImportError(message);
        setIsImporting(false);
        if (pollTimerRef.current !== null) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    };
    pollTimerRef.current = window.setInterval(() => void poll(), 1000);
    void poll();
  }, [zcodeTaskService, applyImportResult]);

  // 挂载时若 host 侧仍有 running job（例如切页回来），恢复轮询展示进度。
  useEffect(() => {
    if (!zcodeTaskService) return;
    void zcodeTaskService.getZcodeImportStatus().then((snap) => {
      if (snap?.running) startPolling();
    });
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zcodeTaskService]);

  const toggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds((previous) => {
      if (previous.includes(sessionId)) return previous.filter((current) => current !== sessionId);
      return [...previous, sessionId];
    });
  }, []);

  const selectAllSessions = useCallback(() => {
    setSelectedSessionIds(candidates.map((candidate) => candidate.sessionId));
  }, [candidates]);

  const clearSelectedSessions = useCallback(() => {
    setSelectedSessionIds([]);
  }, []);

  const scan = useCallback(async () => {
    if (!supportState.supported) return;
    setIsScanning(true);
    setScanError(null);
    try {
      logger.info(
        `[Migration] 开始扫描 ZCode 会话 workspaceFilter=${effectiveWorkspacePath ?? "all"} range=${range} limit=${scanLimit ?? "unlimited"}`,
      );
      const nextCandidates = await zcodeTaskService.scanImportableZCodeSessions({
        workspacePath: effectiveWorkspacePath,
        modifiedSince: resolveModifiedSince(range),
        ...(scanLimit === undefined ? {} : { limit: scanLimit }),
      });
      setCandidates(nextCandidates);
      setSelectedSessionIds((previous) =>
        previous.filter((sessionId) =>
          nextCandidates.some((candidate) => candidate.sessionId === sessionId),
        ),
      );
      logger.info(`[Migration] ZCode 会话扫描完成 count=${nextCandidates.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[Migration] 扫描 ZCode 会话失败", error);
      setScanError(message);
    } finally {
      setIsScanning(false);
    }
  }, [
    zcodeTaskService,
    effectiveWorkspacePath,
    range,
    scanLimit,
    supportState.supported,
  ]);

  const importSessions = useCallback(
    async (sessionIds: string[]) => {
      if (!supportState.supported || sessionIds.length === 0) return;
      // 启动后台任务即返回；进度/结果由 startPolling 轮询。
      try {
        logger.info(`[Migration] 启动 ZCode 会话导入 selected=${sessionIds.length}`);
        await zcodeTaskService.importZCodeSessions({ sessionIds });
        startPolling();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[Migration] 启动 ZCode 会话导入失败", error);
        setImportError(message);
      }
    },
    [zcodeTaskService, supportState.supported, startPolling],
  );

  const importSelectedSessions = useCallback(async () => {
    await importSessions(selectedSessionIds);
  }, [importSessions, selectedSessionIds]);

  return {
    supportState,
    workspaceFilterMode,
    setWorkspaceFilterMode,
    hasCurrentWorkspaceFilter: params.workspacePath !== null,
    range,
    setRange,
    limitInput,
    setLimitInput,
    scanLimit,
    candidates,
    selectedSessionIds,
    selectedCount: selectedSessionIds.length,
    scanError,
    importError,
    lastImportResult,
    isScanning,
    isImporting,
    importProgress,
    scan,
    importSessions,
    importSelectedSessions,
    toggleSessionSelection,
    selectAllSessions,
    clearSelectedSessions,
  };
}
