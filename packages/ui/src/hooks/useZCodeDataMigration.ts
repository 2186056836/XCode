import { useEffect, useRef, useState } from "react";
import { useOnboardingRecordService } from "./useOnboardingRecordService.js";

/**
 * 迁移任务状态（与 host 侧 backgroundJobRegistry 的 JobSnapshot 对齐）。
 * UI dist 类型是旧的，本地重声明保持解耦。
 */
export interface ZcodeMigrationSnapshot {
  name: string;
  running: boolean;
  startedAt: number;
  finishedAt?: number;
  progress?: number;
  total?: number;
  result?: unknown;
  error?: string;
}

// Host dist 类型仍按旧 IOnboardingRecordService 导出；新方法用局部断言补齐。
// 注意：ProxyChannel 远程方法运行时一律返回 Promise，必须 await（同步签名声明会把
// Promise 对象当快照用，导致 running/progress 永远 undefined）。
type ZcodeMigrationCapableRecord = {
  startMigrateZCodeData: () => Promise<{ jobId: string }>;
  getMigrationStatus: () => Promise<ZcodeMigrationSnapshot | null>;
};

const POLL_INTERVAL_MS = 1000;

/**
 * ZCode 数据迁移（文件复制）的任务视图 hook。
 *
 * 状态权威在 host 侧：切页面/关设置层不会中断迁移，重进本页从
 * getMigrationStatus() 恢复进度与结果（最后完成结果还持久化到 v2，host 重启也可见）。
 */
export function useZCodeDataMigration(params: { isDesktop?: boolean } = {}) {
  const raw = useOnboardingRecordService() as ZcodeMigrationCapableRecord | null;
  const [snapshot, setSnapshot] = useState<ZcodeMigrationSnapshot | null>(null);
  const timerRef = useRef<number | null>(null);

  const poll = async () => {
    if (!raw) {
      return;
    }
    try {
      const snap = await raw.getMigrationStatus();
      setSnapshot(snap);
    } catch {
      // 旧 host 未注册新方法时静默降级（等同不支持）。
    }
  };

  // 挂载即恢复状态；running 时保持轮询，完成/失败自动停表。
  useEffect(() => {
    if (!raw) {
      return;
    }
    void poll();
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  useEffect(() => {
    if (snapshot?.running && timerRef.current === null && raw) {
      timerRef.current = window.setInterval(poll, POLL_INTERVAL_MS);
    }
    if (!snapshot?.running && timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.running, raw]);

  const start = async () => {
    if (!raw) {
      return;
    }
    try {
      await raw.startMigrateZCodeData();
      void poll();
    } catch {
      // 启动失败保持原状态；UI 轮询会继续反映 host 侧快照。
    }
  };

  const result =
    (snapshot?.result as { copiedFiles?: number; skipped?: string[] } | undefined) ?? null;

  return {
    supported: Boolean(params.isDesktop !== false && raw),
    isRunning: snapshot?.running === true,
    progress: snapshot?.progress ?? 0,
    finishedAt: snapshot?.finishedAt,
    result,
    error: snapshot?.error ?? null,
    start,
  };
}
