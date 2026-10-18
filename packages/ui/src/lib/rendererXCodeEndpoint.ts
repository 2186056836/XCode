import {
  buildRuntimeXCodeEndpointUrls,
  XCODE_ENV,
  type RuntimeXCodeEndpointEnv,
} from "@zcode/shared";

interface RendererImportMetaEnv {
  VITE_XCODE_BASE_URL?: string;
  VITE_XCODE_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererXCodeEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeXCodeEndpointEnv {
  return {
    XCODE_ENV,
    // UI 侧的 zcode-plan 占位 provider 以前只看 XCODE_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    XCODE_BASE_URL: env.VITE_XCODE_BASE_URL,
    XCODE_ENDPOINT_ORIGIN: env.VITE_XCODE_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_XCODE_ENDPOINT_URLS = buildRuntimeXCodeEndpointUrls(
  createRendererXCodeEndpointEnv(),
);
