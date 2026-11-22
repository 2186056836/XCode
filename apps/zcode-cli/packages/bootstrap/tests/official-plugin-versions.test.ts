import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.js";

/**
 * 官方插件缓存目录是 `<plugin>/<definition.version>`，同版本不会被重建。
 * 版本号分叉时（definition 旧、package/manifest 新）会一直命中旧缓存，
 * 线上表现为 skill / .mcp.json / dist 停在旧内容（2026-11-22 的 browser-use、
 * image-search、zcode-site 都是这一条）。
 *
 * 这里只做仓库内的一致性校验：definition、package.json、.zcode-plugin/plugin.json
 * 三处版本必须相同；plugin 升内容时三处一起升。
 */

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface LocalPluginVersions {
  packageVersion?: string;
  manifestVersion?: string;
}

function readLocalPlugins(): Map<string, LocalPluginVersions> {
  const plugins = new Map<string, LocalPluginVersions>();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(packagesDir, entry.name);
    const manifestPath = join(root, ".zcode-plugin", "plugin.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    if (typeof manifest.name !== "string" || manifest.name.length === 0) continue;
    const packagePath = join(root, "package.json");
    const packageVersion = existsSync(packagePath)
      ? (JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown }).version
      : undefined;
    plugins.set(manifest.name, {
      ...(typeof packageVersion === "string" ? { packageVersion } : {}),
      ...(typeof manifest.version === "string" ? { manifestVersion: manifest.version } : {}),
    });
  }
  return plugins;
}

describe("official plugin versions", () => {
  it("keeps definition, package.json and plugin.json versions aligned", () => {
    const local = readLocalPlugins();
    const problems: string[] = [];
    for (const definition of OFFICIAL_PLUGIN_DEFINITIONS) {
      const versions = local.get(definition.name);
      if (!versions) {
        problems.push(`${definition.name}: no local plugin package found`);
        continue;
      }
      if (versions.packageVersion !== definition.version) {
        problems.push(
          `${definition.name}: definition=${definition.version} package.json=${versions.packageVersion ?? "missing"}`,
        );
      }
      if (versions.manifestVersion !== definition.version) {
        problems.push(
          `${definition.name}: definition=${definition.version} plugin.json=${versions.manifestVersion ?? "missing"}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
