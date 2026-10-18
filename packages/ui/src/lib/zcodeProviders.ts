import {
  XCODE_AGENT_PROVIDER,
  XCODE_AGENT_PROVIDER_LABEL,
  type XCodeProvider,
} from "@zcode/shared";

export const ZCODE_AGENT_PROVIDERS: XCodeProvider[] = [XCODE_AGENT_PROVIDER];

export const ZCODE_AGENT_PROVIDER_LABELS: Record<XCodeProvider, string> = {
  glm: XCODE_AGENT_PROVIDER_LABEL,
};

export function supportsXCodeSessionFork(provider: XCodeProvider): boolean {
  void provider;
  // 功能开关：fork 入口恢复对所有 XCode provider 开放；实际可操作性仍由 task 状态、
  // assistant 目标和运行中保护 guard 控制，避免把 active/failed 分支暴露为可 fork。
  return true;
}

export function shouldHideXCodeSessionForkAction(provider: XCodeProvider): boolean {
  return !supportsXCodeSessionFork(provider);
}
