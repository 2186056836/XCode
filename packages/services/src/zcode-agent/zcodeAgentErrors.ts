// 原始 -32602 文案来自旧 Agent schema，跨 RPC 后 UI 不能靠易变字符串识别能力缺失。
// ChannelClient 会保留 error.code，因此用稳定 code 驱动设置页停止 status-only 轮询。
export const XCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE =
  "XCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED";

export class XCodeAgentMcpStatusModeUnsupportedError extends Error {
  readonly code = XCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE;

  constructor() {
    super("The connected XCode Agent does not support MCP status-only refresh");
    this.name = "XCodeAgentMcpStatusModeUnsupportedError";
  }
}

export function isXCodeAgentMcpStatusModeUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { code?: unknown }).code === XCODE_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE;
}

export const XCODE_AGENT_MODEL_SELECTION_BASIS_UNSUPPORTED_ERROR_CODE =
  "XCODE_AGENT_MODEL_SELECTION_BASIS_UNSUPPORTED";

/** 旧 CLI 不支持接纳时的选择校验；不能通过剥离依据恢复发送。 */
export class XCodeAgentModelSelectionBasisUnsupportedError extends Error {
  readonly code = XCODE_AGENT_MODEL_SELECTION_BASIS_UNSUPPORTED_ERROR_CODE;

  constructor(cause?: unknown) {
    super("The target CLI cannot safely accept this input. Upgrade the target CLI and retry.", {
      cause,
    });
    this.name = "ModelSelectionBasisUnsupportedError";
  }
}

export function isXCodeAgentModelSelectionBasisUnsupportedError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === XCODE_AGENT_MODEL_SELECTION_BASIS_UNSUPPORTED_ERROR_CODE
  );
}
