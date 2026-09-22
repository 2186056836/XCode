import { materializeXCodeBuiltinProviderConfig } from "@zcode/services/node";

declare const __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

interface MaterializeBundledXCodeBuiltinProviderConfigOptions {
  readonly environmentConfigRoot: string;
  readonly content: string;
}

/** 返回构建时嵌入远端 Server 的 XCode Built-in Provider Config。 */
export function readBundledXCodeBuiltinProviderConfig(): string {
  if (typeof __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__ !== "string") {
    throw new Error("当前构建未嵌入 XCode Built-in Provider Config");
  }
  return __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__;
}

/**
 * 将 XCode Built-in Config 原子物化到所属环境的固定资源副本。
 * 升级前退出旧进程；不保留按内容 hash 增长的历史文件。
 */
export async function materializeBundledXCodeBuiltinProviderConfig(
  options: MaterializeBundledXCodeBuiltinProviderConfigOptions,
): Promise<string> {
  return materializeXCodeBuiltinProviderConfig(options);
}
