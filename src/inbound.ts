import type { P2PMessage } from "./types.js";

export type InboundHandlerDeps = {
  logger?: {
    info?: (msg: string) => void;
    debug?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  sendToChannel?: (channelId: string, target: string, text: string) => Promise<void>;
};

export function handleP2PInbound(msg: P2PMessage, deps: InboundHandlerDeps): void {
  const { logger, sendToChannel } = deps;
  if (msg.type === "broadcast") {
    logger?.info?.(`[libp2p-mesh] Broadcast from ${msg.from} on topic ${msg.topic ?? "(none)"}: ${msg.payload}`);
    return;
  }

  // Direct message — log and forward to local channel
  logger?.info?.(`[libp2p-mesh] Direct message from ${msg.from}: ${msg.payload}`);

  if (!sendToChannel || !msg.payload) {
    return;
  }

  const text = `[来自 ${msg.from}]\n${msg.payload}`;
  sendToChannel("libp2p-mesh", msg.from, text).catch((err) => {
    logger?.error?.(`[libp2p-mesh] Failed to forward direct message from ${msg.from}: ${err}`);
  });
}
