import type { P2PMessage } from "./types.js";

export type InboundHandlerDeps = {
  logger?: {
    info?: (msg: string) => void;
    debug?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
};

export function handleP2PInbound(msg: P2PMessage, deps: InboundHandlerDeps): void {
  const { logger } = deps;
  if (msg.type === "broadcast") {
    logger?.info?.(`[libp2p-mesh] Broadcast from ${msg.from} on topic ${msg.topic ?? "(none)"}: ${msg.payload}`);
  } else {
    logger?.info?.(`[libp2p-mesh] Direct message from ${msg.from}: ${msg.payload}`);
  }
}
