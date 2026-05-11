// Polyfill for Node.js < 22 (libp2p dependencies use Promise.withResolvers)
if (!Promise.withResolvers) {
  Promise.withResolvers = function <T>() {
    let resolve: (value?: T | PromiseLike<T> | undefined) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res as typeof resolve;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { mdns } from "@libp2p/mdns";
import { mplex } from "@libp2p/mplex";
import { noise } from "@libp2p/noise";
import {
  createEd25519PeerId,
  createFromProtobuf,
  exportToProtobuf,
} from "@libp2p/peer-id-factory";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { bootstrap } from "@libp2p/bootstrap";
import { encode, decode } from "it-length-prefixed";
import { pipe } from "it-pipe";
import { createLibp2p } from "libp2p";
import { Uint8ArrayList } from "uint8arraylist";
import type { Libp2p } from "libp2p";
import type { MeshConfig, MeshNetwork, P2PMessage } from "./types.js";

const PROTOCOL = "/openclaw-msg/1.0.0";
const MAX_SEEN_MESSAGES = 1000;

function resolvePeerIdPath(customPath?: string): string {
  if (customPath) return customPath;
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "libp2p", "peer-id.json");
  }
  return path.join(homedir(), ".openclaw", "libp2p", "peer-id.json");
}

async function loadOrCreatePeerId(customPath?: string): Promise<ReturnType<typeof createEd25519PeerId> extends Promise<infer T> ? T : never> {
  const peerIdPath = resolvePeerIdPath(customPath);
  try {
    const saved = JSON.parse(await readFile(peerIdPath, "utf8")) as { protobuf: string };
    const peerId = await createFromProtobuf(Buffer.from(saved.protobuf, "base64"));
    return peerId as ReturnType<typeof createEd25519PeerId> extends Promise<infer T> ? T : never;
  } catch {
    const peerId = await createEd25519PeerId();
    const protobuf = Buffer.from(exportToProtobuf(peerId)).toString("base64");
    await mkdir(path.dirname(peerIdPath), { recursive: true });
    await writeFile(peerIdPath, JSON.stringify({ protobuf }, null, 2));
    return peerId;
  }
}

export function createMeshNetwork(options: {
  config?: MeshConfig;
  logger?: { info?: (msg: string) => void; debug?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
}): MeshNetwork {
  const config = options.config ?? {};
  const logger = options.logger;

  // Use an object property instead of a bare `let` so all closures share
  // the same mutable reference even if the bundler rewrites scopes.
  const state = {
    node: null as Libp2p | null,
  };

  const seenMessages = new Set<string>();
  const messageHandlers = new Set<(msg: P2PMessage) => void>();
  const topicHandlers = new Map<string, Set<(msg: string) => void>>();

  async function start(): Promise<void> {
    const peerId = await loadOrCreatePeerId(config.peerIdPath);

    // Build transports dynamically
    const transports: any[] = [tcp()];
    if (config.enableWebSocket) {
      transports.push(webSockets());
    }

    // Build peer discovery dynamically
    const peerDiscovery: any[] = [];
    const discoveryMechanism = config.discovery ?? "mdns";
    if (discoveryMechanism === "mdns") {
      peerDiscovery.push(mdns({ interval: 1000 }));
      logger?.info?.("[libp2p-mesh] Using mDNS discovery (LAN)");
    } else if (discoveryMechanism === "bootstrap") {
      const bootstrapList = config.bootstrapList ?? [];
      if (bootstrapList.length > 0) {
        peerDiscovery.push(bootstrap({ list: bootstrapList }));
        logger?.info?.(`[libp2p-mesh] Using bootstrap discovery (${bootstrapList.length} node(s))`);
      } else {
        logger?.warn?.("[libp2p-mesh] discovery=bootstrap but bootstrapList is empty; falling back to mDNS");
        peerDiscovery.push(mdns({ interval: 1000 }));
      }
    } else if (discoveryMechanism === "dht") {
      logger?.warn?.("[libp2p-mesh] DHT discovery is not yet implemented; falling back to mDNS");
      peerDiscovery.push(mdns({ interval: 1000 }));
    }

    state.node = await createLibp2p({
      peerId,
      start: false,
      transports,
      connectionEncryption: [noise()],
      streamMuxers: [mplex()],
      addresses: {
        listen: config.listenAddrs ?? ["/ip4/0.0.0.0/tcp/0"],
      },
      peerDiscovery,
    });

    state.node.addEventListener("peer:connect", (evt) => {
      const peerIdStr = evt.detail.toString();
      logger?.debug?.(`[libp2p-mesh] Peer connected: ${peerIdStr}`);
    });

    state.node.addEventListener("peer:disconnect", (evt) => {
      const peerIdStr = evt.detail.toString();
      logger?.debug?.(`[libp2p-mesh] Peer disconnected: ${peerIdStr}`);
    });

    await state.node.handle(PROTOCOL, async ({ stream, connection }) => {
      try {
        await pipe(
          stream.source,
          decode,
          async (source) => {
            for await (const msg of source) {
              const data = new TextDecoder().decode(msg.subarray());
              let parsed: P2PMessage;
              try {
                parsed = JSON.parse(data) as P2PMessage;
              } catch {
                logger?.warn?.(`[libp2p-mesh] Failed to parse message from ${connection.remotePeer.toString()}`);
                continue;
              }

              if (seenMessages.has(parsed.id)) {
                continue;
              }
              if (seenMessages.size >= MAX_SEEN_MESSAGES) {
                seenMessages.clear();
              }
              seenMessages.add(parsed.id);

              // Enrich with local timestamp if missing
              if (!parsed.timestamp) {
                parsed.timestamp = Date.now();
              }

              logger?.debug?.(`[libp2p-mesh] Received ${parsed.type} from ${parsed.from}`);

              // Notify direct message handlers
              for (const handler of messageHandlers) {
                try {
                  handler(parsed);
                } catch (err) {
                  logger?.error?.(`[libp2p-mesh] Message handler error: ${String(err)}`);
                }
              }

              // Handle broadcast / topic subscription
              if (parsed.type === "broadcast" && parsed.topic) {
                const handlers = topicHandlers.get(parsed.topic);
                if (handlers) {
                  for (const h of handlers) {
                    try {
                      h(parsed.payload);
                    } catch (err) {
                      logger?.error?.(`[libp2p-mesh] Topic handler error: ${String(err)}`);
                    }
                  }
                }
                // Flood-fill forward to other connected peers (with TTL guard)
                await forwardBroadcast(parsed, connection.remotePeer.toString());
              }
            }
          },
        );
      } catch (err) {
        logger?.error?.(`[libp2p-mesh] Protocol handler error: ${String(err)}`);
      }
    });

    await state.node.start();

    logger?.info?.(`[libp2p-mesh] Node started. Peer ID: ${state.node.peerId.toString()}`);
    logger?.info?.(`[libp2p-mesh] Listening on: ${state.node.getMultiaddrs().map((ma) => ma.toString()).join(", ")}`);
  }

  async function stop(): Promise<void> {
    if (state.node) {
      await state.node.stop();
      state.node = null;
      logger?.info?.("[libp2p-mesh] Node stopped.");
    }
  }

  async function sendToPeer(peerId: string, message: string): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }

    const msg: P2PMessage = {
      id: crypto.randomUUID(),
      type: "direct",
      from: state.node.peerId.toString(),
      to: peerId,
      payload: message,
      timestamp: Date.now(),
    };

    const data = new TextEncoder().encode(JSON.stringify(msg));

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 8000);

    try {
      const { peerIdFromString } = await import("@libp2p/peer-id");
      logger?.debug?.(`[libp2p-mesh] dialProtocol to ${peerId}`);
      const stream = await state.node.dialProtocol(peerIdFromString(peerId) as any, PROTOCOL, {
        signal: abortController.signal,
      });
      if (!stream) {
        throw new Error(`Failed to establish stream to ${peerId}; peer may be unreachable`);
      }
      logger?.debug?.(`[libp2p-mesh] stream opened to ${peerId}`);
      await pipe([new Uint8ArrayList(data)], encode, stream.sink);
      logger?.debug?.(`[libp2p-mesh] message sent to ${peerId}`);
    } catch (err) {
      logger?.error?.(`[libp2p-mesh] sendToPeer error: ${String(err)}`);
      if (abortController.signal.aborted) {
        throw new Error(`Send to ${peerId} timed out after 8s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function publishToTopic(topic: string, message: string): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }

    const msg: P2PMessage = {
      id: crypto.randomUUID(),
      type: "broadcast",
      from: state.node.peerId.toString(),
      topic,
      payload: message,
      timestamp: Date.now(),
    };

    const data = new TextEncoder().encode(JSON.stringify(msg));
    const connections = state.node.getConnections();
    let sent = 0;

    for (const conn of connections) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 5000);
      try {
        const stream = await conn.newStream(PROTOCOL, { signal: abortController.signal });
        await pipe([new Uint8ArrayList(data)], encode, stream.sink);
        sent++;
      } catch {
        // Ignore individual forwarding errors
      } finally {
        clearTimeout(timeout);
      }
    }

    logger?.debug?.(`[libp2p-mesh] Broadcast sent to ${sent} peer(s) on topic ${topic}`);
  }

  async function forwardBroadcast(msg: P2PMessage, fromPeerId: string): Promise<void> {
    if (!state.node) return;
    // Simple flood-fill: forward to all connected peers except the sender
    const data = new TextEncoder().encode(JSON.stringify(msg));
    for (const conn of state.node.getConnections()) {
      const remotePeerId = conn.remotePeer.toString();
      if (remotePeerId === fromPeerId) continue;
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 5000);
      try {
        const stream = await conn.newStream(PROTOCOL, { signal: abortController.signal });
        await pipe([new Uint8ArrayList(data)], encode, stream.sink);
      } catch {
        // Ignore forwarding errors
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  function onMessage(handler: (msg: P2PMessage) => void): () => void {
    messageHandlers.add(handler);
    return () => {
      messageHandlers.delete(handler);
    };
  }

  async function subscribeToTopic(topic: string, handler: (msg: string) => void): Promise<void> {
    if (!topicHandlers.has(topic)) {
      topicHandlers.set(topic, new Set());
    }
    topicHandlers.get(topic)!.add(handler);
  }

  function getLocalPeerId(): string {
    return state.node?.peerId.toString() ?? "";
  }

  function getConnectedPeers(): string[] {
    if (!state.node) return [];
    const peers = state.node.getConnections().map((c) => c.remotePeer.toString());
    return [...new Set(peers)];
  }

  return {
    start,
    stop,
    sendToPeer,
    onMessage,
    publishToTopic,
    subscribeToTopic,
    getLocalPeerId,
    getConnectedPeers,
  };
}
