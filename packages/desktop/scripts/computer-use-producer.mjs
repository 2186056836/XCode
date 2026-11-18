import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * 判定当前安装的 `@zcode/zcode-cua` 是闭源真实 producer 还是开源占位包。
 *
 * 闭源构建使用 workspace 内 `packages/zcode-cua` 的真实 producer；开源导出把该目录整体换成占位包，
 * 占位包在 package.json 声明 `zcodeCuaPlaceholder: true`，所有能力 fail-closed。
 * 开发、构建与打包里只服务于真实 Computer Use 的步骤（构建 Helper、暂存插件原生依赖、
 * Windows Helper 资源、打包后的 Helper 校验）都以本判定为门，检测不到真实 producer 时跳过，
 * 不能因为缺少私有产物让开源树的入口失败。规范见 docs/desktop/computer-use-producer-detection.md。
 *
 * 构建配置（electron-builder、tsup）同步求值，这里只做一次小文件同步读取。
 *
 * 【XCode fork 移植】Computer Use 真实实现（producer + Windows Helper + 插件原生依赖）
 * 由 scripts/port-official-cua.mjs 从已安装官方 ZCode 包移植为编译产物，不落在
 * workspace 的 @zcode/zcode-cua 包里。因此除包清单判定外还要识别已移植的 Helper
 * runtime 产物：存在即视为「真实 producer 在场」，让打包链照常暂存/校验 Helper，
 * 否则编译产物虽在磁盘却不会被打进安装包。
 *
 * 锚点选 bundled-tools/<platform>/cua-helper/runtime-manifest.json：它既是 electron-builder
 * extraResources 的打包源（→ resources/tools/cua-helper），又是 dev 模式 ZCODE_CUA_DEV_ROOT
 * 的可用根（port 脚本会一并写入 zcodeCuaRuntime 契约）。该目录被 .gitignore 忽略，
 * 纯克隆上没有此文件，判定自然回到占位包的 fail-closed 语义。
 */
function hasPortedWindowsCuaHelper(desktopPackageRoot) {
  const root = resolve(desktopPackageRoot);
  return [
    resolve(root, "bundled-tools", "win32-x64", "cua-helper/runtime-manifest.json"),
    resolve(root, "bundled-tools", "win32-arm64", "cua-helper/runtime-manifest.json"),
  ].some((file) => existsSync(file));
}

export function readComputerUseProducer({ desktopPackageRoot }) {
  // 从桌面包向上查找最近的安装：闭源 hoisted 布局在仓库根，开源占位包链接在桌面包下。
  for (let dir = resolve(desktopPackageRoot); ; dir = dirname(dir)) {
    const manifestPath = resolve(dir, "node_modules", "@zcode", "zcode-cua", "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const placeholder =
        manifest.zcodeCuaPlaceholder === true && !hasPortedWindowsCuaHelper(desktopPackageRoot);
      return {
        installed: true,
        placeholder,
        manifest,
        packageRoot: dirname(manifestPath),
      };
    }
    if (dirname(dir) === dir) return { installed: false, placeholder: false };
  }
}

export function isRealComputerUseProducerInstalled({ desktopPackageRoot }) {
  const producer = readComputerUseProducer({ desktopPackageRoot });
  return producer.installed && !producer.placeholder;
}
