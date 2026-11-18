import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { isRealComputerUseProducerInstalled } from "../packages/desktop/scripts/computer-use-producer.mjs";
import { stageSharpIntoBundledAgents } from "../packages/desktop/scripts/sharp-package-assets.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

/**
 * workspace 里是否装得到 sharp。fork 没有任何 package.json 声明 sharp——CUA 的 sharp
 * 闭包由 scripts/cua-vendor.mjs 从 vendor/cua/<platform>/plugin-runtime 提供。
 * stageSharpIntoBundledAgents 找不到 sharp 会直接 throw（"CI fails loudly"），
 * 那是为「声明了依赖却没装」设计的；对「依赖改由 vendor 供给」必须放行，否则 dev 链必炸。
 */
function isSharpResolvableFromWorkspace(desktopPackageRoot) {
  try {
    const require = createRequire(resolve(desktopPackageRoot, "package.json"));
    require.resolve("sharp/package");
    return true;
  } catch {
    return false;
  }
}

export function stageDevCuaPluginRuntime({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  desktopPackageRoot = resolve(repositoryRoot, "packages", "desktop"),
  pluginRoot = resolve(repositoryRoot, "apps", "zcode-cli", "packages", "zcode-cua-plugin"),
} = {}) {
  // fork 品牌化后统一注入 XCODE_CUA_DEV_MODE（build-desktop-agent-cli 的
  // cuaPluginRuntimeStagingEnv 写的就是这个键）；上游的 ZCODE_ 名字保留兜底，
  // 否则这段 dev staging 会因为键名不符永远命中 return，Sharp 一直不进 plugin。
  const devModeRequested =
    env.XCODE_CUA_DEV_MODE === "1" || env.ZCODE_CUA_DEV_MODE === "1";
  if (!devModeRequested) return [];
  // 开源占位包不提供 Computer Use 原生能力，也不随附 Sharp：没有真实 producer 时不暂存。
  if (!isRealComputerUseProducerInstalled({ desktopPackageRoot })) return [];

  const manifestPath = resolve(pluginRoot, ".zcode-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[stage-dev-cua-plugin-runtime] CUA plugin manifest is missing: ${manifestPath}`,
    );
  }

  // 修复原因：sync:cache 过去只把 Sharp 写入最终缓存，桌面重启时 bootstrap
  // 会用源码 plugin 原子替换该缓存并删除 Sharp。先补全 CUA filesystem seed source，
  // 才能让每次重建都得到可独立加载原生依赖的 CUA plugin；Browser Use 只提供
  // shared node_repl host，不再作为 CUA native 依赖的解析根目录。
  // fork 里 sharp 由 vendor/cua 供给（见 isSharpResolvableFromWorkspace），cua-vendor.mjs
  // 已把同一份闭包装进 plugin 的 node_modules，这里不必也不能再从 workspace 取。
  if (!isSharpResolvableFromWorkspace(desktopPackageRoot)) {
    console.log(
      "[stage-dev-cua-plugin-runtime] workspace 无 sharp，改用 cua-vendor 供给的插件运行时依赖",
    );
    return [];
  }
  return stageSharpIntoBundledAgents({
    desktopPackageRoot,
    glmDir: pluginRoot,
    targetPlatform: {
      os: platform,
      arch,
      key: `${platform}-${arch}`,
    },
  });
}
