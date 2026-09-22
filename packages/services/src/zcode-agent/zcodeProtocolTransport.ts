import type { Event, IDisposable } from "@zcode/rpc";
import type { XCodeProtocolMessage } from "@zcode/shared";

export type XCodeProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface XCodeProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface XCodeProtocolTransport extends IDisposable {
  readonly kind: XCodeProtocolTransportKind;
  readonly onMessage: Event<XCodeProtocolMessage>;
  readonly onClose: Event<XCodeProtocolTransportClosedEvent>;
  send(message: XCodeProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
