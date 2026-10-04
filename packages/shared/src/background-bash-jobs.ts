import {
  collectVisibleXCodeBackgroundTaskControlItems,
  getXCodeBackgroundTaskControlItemElapsedMs,
  isActiveXCodeBackgroundTaskControlItem,
  parseXCodeBackgroundTaskControlItems,
  type XCodeBackgroundTaskControlItem,
  type XCodeBackgroundTaskControlStatus,
} from "./background-task-controls.js";

export type XCodeBackgroundBashJobStatus = XCodeBackgroundTaskControlStatus;
export type XCodeBackgroundBashJob = XCodeBackgroundTaskControlItem & {
  taskKind: "bash";
};

export function parseXCodeBackgroundBashJobs(value: unknown): XCodeBackgroundBashJob[] {
  return parseXCodeBackgroundTaskControlItems(value).filter(isBackgroundBashJob);
}

export function isActiveXCodeBackgroundBashJob(job: XCodeBackgroundBashJob): boolean {
  return isActiveXCodeBackgroundTaskControlItem(job);
}

export function getXCodeBackgroundBashJobElapsedMs(
  job: XCodeBackgroundBashJob,
  now = Date.now(),
): number {
  return getXCodeBackgroundTaskControlItemElapsedMs(job, now);
}

export function collectVisibleXCodeBackgroundBashJobs(
  jobs: readonly XCodeBackgroundBashJob[],
  now = Date.now(),
  thresholdMs = 30_000,
): Array<XCodeBackgroundBashJob & { elapsedMs: number }> {
  return collectVisibleXCodeBackgroundTaskControlItems(jobs, now, thresholdMs) as Array<
    XCodeBackgroundBashJob & { elapsedMs: number }
  >;
}

function isBackgroundBashJob(job: XCodeBackgroundTaskControlItem): job is XCodeBackgroundBashJob {
  return job.taskKind === "bash";
}
