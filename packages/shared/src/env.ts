import type { XCodeRuntimeEnv } from "./runtimeEnv.js";

export type XCodeEnv = "test" | "production";
/** 安装包身份：决定应用名、app id、Electron 数据目录与更新策略；与后端环境 `XCodeEnv` 是两个轴。 */
export type XCodeProductFlavor = "production" | "preview";
export type ArmsRumEnv = "local" | "prod";

// 非构建环境（如 e2e 测试的 mocha）下 define 不存在，用 typeof 检查 + fallback 避免 ReferenceError
declare const __XCODE_ENV__: string;
declare const __XCODE_PRODUCT_FLAVOR__: string;
declare const __XCODE_ARMS_RUM_ENDPOINT__: string;
declare const __XCODE_TELEMETRY_REPORT_ENDPOINT__: string;
declare const __XCODE_AUTO_UPDATE_ENABLED__: boolean;

export function normalizeXCodeEnv(value: string | undefined): XCodeEnv {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

export const XCODE_ENV = normalizeXCodeEnv(
  typeof __XCODE_ENV__ !== "undefined" ? __XCODE_ENV__ : undefined,
);

/**
 * 身份缺省跟随后端环境（test → preview，production → production）。
 * 桌面构建通过 `XCODE_PREVIEW_IDENTITY=1` 显式注入 preview，得到连接生产后端的 Preview 包；
 * 未注入 define 的 bundle（web、CLI、测试）沿用旧的单轴语义。
 */
export function normalizeXCodeProductFlavor(
  value: string | undefined,
  zcodeEnv: XCodeEnv,
): XCodeProductFlavor {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production" || normalized === "preview") {
    return normalized;
  }
  return zcodeEnv === "production" ? "production" : "preview";
}

export const XCODE_PRODUCT_FLAVOR = normalizeXCodeProductFlavor(
  typeof __XCODE_PRODUCT_FLAVOR__ !== "undefined" ? __XCODE_PRODUCT_FLAVOR__ : undefined,
  XCODE_ENV,
);
export const XCODE_APP_VERSION_ENV = "XCODE_APP_VERSION" as const;
export const XCODE_BUILD_COMMIT_ID_ENV = "XCODE_BUILD_COMMIT_ID" as const;

// ── 运行时环境变量（不经过编译打包，启动时从 process.env 读取） ──
// 启用调试模式，值为 inspect-brk 的端口号，如 XCODE_DEBUG=9230
export const RUNTIME_XCODE_DEBUG =
  typeof process !== "undefined" ? process.env.XCODE_DEBUG : undefined;

// fork 保留：上游 1010 已用构建期能力开关取代该硬编码常量，但 fork 的 index.ts 仍 re-export 它，
// 删除会导致 packages/shared 编译失败（TS2305）。保留 fork 语义，实际出网由下方端点是否为空决定。
export const XCODE_TELEMETRY_ENABLED: boolean = true;

// ── 构建期可选能力（见 docs/desktop/build-time-optional-capabilities.md），未注入时一律关闭 ──
/** ARMS RUM 上报地址；为空时 SDK 以 enable=false 初始化，不产生上报。 */
export const XCODE_ARMS_RUM_ENDPOINT: string =
  typeof __XCODE_ARMS_RUM_ENDPOINT__ !== "undefined" ? __XCODE_ARMS_RUM_ENDPOINT__ : "";
/** 事件上报（数仓）地址；为空时不上报。 */
export const XCODE_TELEMETRY_REPORT_ENDPOINT: string =
  typeof __XCODE_TELEMETRY_REPORT_ENDPOINT__ !== "undefined"
    ? __XCODE_TELEMETRY_REPORT_ENDPOINT__
    : "";
/** 桌面自动更新是否启用。 */
export const XCODE_AUTO_UPDATE_ENABLED: boolean =
  typeof __XCODE_AUTO_UPDATE_ENABLED__ !== "undefined" ? __XCODE_AUTO_UPDATE_ENABLED__ : false;

/** 将本地运行态与编译期 XCODE_ENV 映射为 ARMS 控制台识别的上报环境标签 */
export function mapXCodeEnvToArmsRumEnv(runtimeEnv: XCodeRuntimeEnv): ArmsRumEnv {
  return runtimeEnv !== "development" && XCODE_ENV === "production" ? "prod" : "local";
}
