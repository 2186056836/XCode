// 上游 1019 把 tasksDatabase/startup.ts 拆到 project-storage/startup.ts，
// 本入口改为转发新路径，保持 `@zcode/services/storage-startup` 的对外契约不变。
export {
  prepareTasksIndexStorage,
  createSettingService,
} from "#src/project-storage/startup-entry.js";
export { markTasksStoragePrepared } from "#src/session/tasksDatabase/prepared.js";
export { getTasksIndexDatabasePath } from "#src/paths.js";
export { resolveDefaultXCodeAgentCommand } from "#src/zcode-agent/zcodeAgentProcessManager.js";
export { resolveXCodeAgentSpawnCwd } from "#src/zcode-agent/zcodeAgentSpawnCwd.js";
