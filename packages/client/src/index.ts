export { RemoteServiceAccess } from "./remoteServiceAccess.js";
export { connectViaProtocol, connectViaWebSocket } from "./websocket.js";
export type { WebSocketConnectionCloseEvent } from "./websocket.js";
export { connectViaMessagePort, createMessagePortServiceConnection } from "./messageport.js";
export type { MessagePortServiceConnection } from "./messageport.js";

// ── 1010 新增 barrel 导出 ──
export {
  ACKNOWLEDGED_WEB_REMOTE_CONTROL_RELAY_LIMITS,
  createAcknowledgedWebRemoteControlRelayProtocol,
  createWebRemoteControlRelayProtocol,
} from "./webRemoteControlRelayProtocol.js";
export * from "./webRemoteControlRelayPayloadSerializer.js";
