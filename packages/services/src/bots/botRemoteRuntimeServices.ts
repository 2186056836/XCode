import {
  ChannelClient,
  MessagePortProtocol,
  ProxyChannel,
  type MessagePortLike,
  type MessagePortPayload,
} from "@zcode/rpc";
import {
  IXCodeTaskService,
  type IXCodeTaskService as IXCodeTaskServiceShape,
} from "#src/session/zcodeTaskService.js";
import {
  IXCodeAgentService,
  type IXCodeAgentService as IXCodeAgentServiceShape,
} from "#src/zcode-agent/zcodeAgent.js";
import {
  IXCodeSessionService,
  type IXCodeSessionService as IXCodeSessionServiceShape,
} from "#src/zcode-session/zcodeSession.js";
import {
  IModelSelectionService,
  type IModelSelectionService as IModelSelectionServiceShape,
} from "#src/model-provider/providerFacadeServices.js";

interface PortLike {
  on?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  off?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  addEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  removeEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  postMessage(message: MessagePortPayload): void;
  start?(): void;
  close?(): void;
}

function toMessagePortLike(port: PortLike): MessagePortLike {
  return {
    addEventListener(type, listener) {
      if (port.addEventListener) {
        port.addEventListener(type, listener);
        return;
      }
      port.on?.(type, listener);
    },
    removeEventListener(type, listener) {
      if (port.removeEventListener) {
        port.removeEventListener(type, listener);
        return;
      }
      port.off?.(type, listener);
    },
    postMessage(data) {
      port.postMessage(data);
    },
    start() {
      port.start?.();
    },
    close() {
      port.close?.();
    },
  };
}

export interface RemoteBotWorkspaceRuntimeServices {
  zcodeAgentService: IXCodeAgentServiceShape;
  zcodeTaskService: IXCodeTaskServiceShape;
  zcodeSessionService: IXCodeSessionServiceShape;
  modelSelectionService: IModelSelectionServiceShape;
}

export function createRemoteRuntimeServicesFromPort(
  port: unknown,
): RemoteBotWorkspaceRuntimeServices {
  const protocol = new MessagePortProtocol(toMessagePortLike(port as PortLike));
  const client = new ChannelClient(protocol);
  return {
    zcodeAgentService: ProxyChannel.toService<IXCodeAgentServiceShape>(
      client.getChannel(IXCodeAgentService.channelName),
    ),
    zcodeTaskService: ProxyChannel.toService<IXCodeTaskServiceShape>(
      client.getChannel(IXCodeTaskService.channelName),
    ),
    zcodeSessionService: ProxyChannel.toService<IXCodeSessionServiceShape>(
      client.getChannel(IXCodeSessionService.channelName),
    ),
    modelSelectionService: ProxyChannel.toService<IModelSelectionServiceShape>(
      client.getChannel(IModelSelectionService.channelName),
    ),
  };
}
