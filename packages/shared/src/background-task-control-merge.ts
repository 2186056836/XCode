import type { XCodeBackgroundTaskControlItem } from "./background-task-controls.js";

export function mergeXCodeBackgroundTaskControlItems(
  current: readonly XCodeBackgroundTaskControlItem[],
  updates: readonly XCodeBackgroundTaskControlItem[],
): XCodeBackgroundTaskControlItem[] {
  const jobsById = new Map(current.map((job) => [job.jobId, job] as const));
  for (const job of updates) {
    jobsById.set(job.jobId, job);
  }
  return Array.from(jobsById.values());
}
