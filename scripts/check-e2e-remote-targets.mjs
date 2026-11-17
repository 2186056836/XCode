import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractRemoteTargetSpecs } from "../packages/desktop/scripts/r3-remote-spec-inventory.mjs";

export async function checkRemoteTargetSpecs(root = process.cwd()) {
  const queuePath = resolve(root, "harness/remote/run-all-remote.sh");
  try {
    // 开源树不含私有队列；队列脚本缺失即跳过。fork 的 harness/remote 只保留了
    // Docker 构建三件套，官方的 run-all-remote.sh 不入库，按目录存在与否判断会误伤。
    await access(queuePath);
  } catch (error) {
    if (error.code === "ENOENT") return "skipped: private queue absent";
    throw error;
  }
  const queue = await readFile(queuePath, "utf8");
  const actual = JSON.parse(
    await readFile(resolve(root, "packages/desktop/scripts/e2e-remote-target-specs.json"), "utf8"),
  );
  // readFile 和带 query 的 raw import 都可能被 affected 漏选，因此独立接入推送门禁。
  if (JSON.stringify(actual) !== JSON.stringify(extractRemoteTargetSpecs(queue)))
    throw new Error(
      "远程目标清单已漂移，请运行 node harness/remote/sync-target-specs.mjs 并提交结果",
    );
  return "remote target inventory matches queue";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(`[e2e-remote-targets] ${await checkRemoteTargetSpecs()}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
