// Polyfill for Node.js < 22 (libp2p dependencies use Promise.withResolvers)
if (!Promise.withResolvers) {
  Promise.withResolvers = function <T>() {
    let resolve: (value?: T | PromiseLike<T> | undefined) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res as typeof resolve;
      reject = rej as typeof reject;
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
import { kadDHT } from "@libp2p/kad-dht";
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
import type { MeshConfig, MeshNetwork, P2PMessage, InstanceIdentity } from "./types.js";
import {
  loadOrCreateInstanceIdentity,
  verifyInstanceSignature,
} from "./instance-id.js";
import { registerPubkey, lookupPubkey } from "./dht-registry.js";

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

  const state = {
    node: null as Libp2p | null,
    instanceIdentity: null as InstanceIdentity | null,
    signMessage: null as ((message: string) => string) | null,
  };

  const seenMessages = new Set<string>();
  const messageHandlers = new Set<(msg: P2PMessage) => void>();
  const topicHandlers = new Map<string, Set<(msg: string) => void>>();

  function getDHTService(): ReturnType<typeof kadDHT> extends (components: infer C) => infer R ? R : never | undefined {
    return (state.node as any)?.services?.dht;
  }

  async function start(): Promise<void> {
    // Load or create lightweight BAID-inspired instance identity
    const instanceResult = await loadOrCreateInstanceIdentity({
      name: config.instanceName,
    });
    state.instanceIdentity = instanceResult.identity;
    state.signMessage = instanceResult.signMessage;

    logger?.info?.(`[libp2p-mesh] Instance Identity: ${instanceResult.identity.id}`);
    logger?.info?.(
      `[libp2p-mesh] Bound to: ${instanceResult.identity.bindingComponents.username}@${instanceResult.identity.bindingComponents.hostname} (${instanceResult.identity.bindingComponents.platform})`,
    );

    const peerId = await loadOrCreatePeerId(config.peerIdPath);

    const transports: any[] = [tcp()];
    if (config.enableWebSocket) {
      transports.push(webSockets());
    }

    // Peer discovery: mDNS for LAN, bootstrap for WAN entry points
    const peerDiscovery: any[] = [];
    const discoveryMechanism = config.discovery ?? "mdns";

    if (discoveryMechanism === "mdns") {
      peerDiscovery.push(mdns({ interval: 1000 }));
      logger?.info?.("[libp2p-mesh] Using mDNS discovery (LAN)");
    }

    if (discoveryMechanism === "bootstrap" || discoveryMechanism === "dht") {
      const bootstrapList = config.bootstrapList ?? [];
      if (bootstrapList.length > 0) {
        peerDiscovery.push(bootstrap({ list: bootstrapList }));
        logger?.info?.(`[libp2p-mesh] Using bootstrap discovery (${bootstrapList.length} node(s))`);
      } else if (discoveryMechanism === "bootstrap") {
        logger?.warn?.("[libp2p-mesh] discovery=bootstrap but bootstrapList is empty; falling back to mDNS");
        peerDiscovery.push(mdns({ interval: 1000 }));
      } else {
        logger?.warn?.("[libp2p-mesh] discovery=dht but bootstrapList is empty; DHT may not find peers");
      }
    }

    // Configure DHT for both WAN peer discovery and pubkey registry
    const enableDHT = discoveryMechanism === "dht" || config.enableDHT !== false;
    const services: Record<string, any> = {};
    if (enableDHT) {
      services.dht = kadDHT({
        protocolPrefix: "/openclaw",
        clientMode: false,
        lan: false,
      });
      logger?.info?.("[libp2p-mesh] DHT enabled (protocol: /openclaw/kad/1.0.0)");
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
      services,
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

              if (!parsed.timestamp) {
                parsed.timestamp = Date.now();
              }

              // Verify instance identity signature if present
              if (parsed.instanceId && parsed.signature) {
                const dht = getDHTService();
                if (dht) {
                  // Reconstruct the signed payload
                  const signedPayload = JSON.stringify({
                    id: parsed.id,
                    type: parsed.type,
                    from: parsed.from,
                    to: parsed.to,
                    topic: parsed.topic,
                    payload: parsed.payload,
                    timestamp: parsed.timestamp,
                    instanceId: parsed.instanceId,
                  });

                  // Look up sender's pubkey from DHT
                  const senderPubkey = await lookupPubkey(dht, parsed.instanceId, logger);

                  if (senderPubkey) {
                    const valid = verifyInstanceSignature(
                      {
                        id: parsed.instanceId,
                        name: "",
                        pubkey: senderPubkey,
                        binding: "",
                        bindingComponents: { username: "", hostname: "", platform: "" },
                        createdAt: 0,
                      },
                      signedPayload,
                      parsed.signature,
                    );

                    if (valid) {
                      logger?.info?.(`[libp2p-mesh] Verified signature from instance ${parsed.instanceId}`);
                    } else {
                      logger?.warn?.(`[libp2p-mesh] Invalid signature from instance ${parsed.instanceId}`);
                    }
                  } else {
                    logger?.warn?.(`[libp2p-mesh] No pubkey in DHT for instance ${parsed.instanceId}; skipping verification`);
                  }
                } else {
                  logger?.debug?.(`[libp2p-mesh] DHT disabled; cannot verify signature from ${parsed.instanceId}`);
                }
              }

              logger?.debug?.(`[libp2p-mesh] Received ${parsed.type} from ${parsed.from}${parsed.instanceId ? ` (instance: ${parsed.instanceId})` : ""}`);

              for (const handler of messageHandlers) {
                try {
                  handler(parsed);
                } catch (err) {
                  logger?.error?.(`[libp2p-mesh] Message handler error: ${String(err)}`);
                }
              }

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

    // Wait for DHT routing table to populate before registering pubkey
    if (enableDHT) {
      const dht = getDHTService();
      if (dht) {
        let attempts = 0;
        const maxAttempts = 30;
        while (attempts < maxAttempts) {
          const rtSize = (dht as any).routingTable?.size ?? 0;
          const peerCount = state.node.getPeers().length;
          if (rtSize > 0 || peerCount > 0) {
            logger?.info?.(`[libp2p-mesh] DHT routing table ready (peers: ${peerCount}, rt: ${rtSize})`);
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
          attempts++;
        }
        if (attempts >= maxAttempts) {
          logger?.warn?.(`[libp2p-mesh] DHT routing table still empty after ${maxAttempts}s; continuing anyway`);
        }

        if (state.instanceIdentity) {
          await registerPubkey(dht, state.instanceIdentity.id, state.instanceIdentity.pubkey, logger).catch(() => {
            // Already logged inside registerPubkey
          });
        }
      }
    }

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

  function buildSignedMessage(
    base: Omit<P2PMessage, "instanceId" | "signature">,
  ): P2PMessage {
    const instanceId = state.instanceIdentity?.id;
    const sign = state.signMessage;

    const msg: P2PMessage = { ...base };

    if (instanceId && sign) {
      msg.instanceId = instanceId;
      msg.pubkey = state.instanceIdentity?.pubkey;
      const signedPayload = JSON.stringify({
        id: msg.id,
        type: msg.type,
        from: msg.from,
        to: msg.to,
        topic: msg.topic,
        payload: msg.payload,
        timestamp: msg.timestamp,
        instanceId: msg.instanceId,
      });
      msg.signature = sign(signedPayload);
    }

    return msg;
  }

  async function sendToPeer(peerId: string, message: string): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }

    const msg = buildSignedMessage({
      id: crypto.randomUUID(),
      type: "direct",
      from: state.node.peerId.toString(),
      to: peerId,
      payload: message,
      timestamp: Date.now(),
    });

    const data = new TextEncoder().encode(JSON.stringify(msg));

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 8000);

    try {
      const { peerIdFromString } = await import("@libp2p/peer-id");
      logger?.debug?.(`[libp2p-mesh] dialProtocol to ${peerId}`);
      const stream = await state.node.dialProtocol(peerIdFromString(peerId), PROTOCOL, {
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

    const msg = buildSignedMessage({
      id: crypto.randomUUID(),
      type: "broadcast",
      from: state.node.peerId.toString(),
      topic,
      payload: message,
      timestamp: Date.now(),
    });

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

  function getMultiaddrs(): string[] {
    if (!state.node) return [];
    return state.node.getMultiaddrs().map((ma) => ma.toString());
  }

  function getInstanceIdentity(): InstanceIdentity | undefined {
    return state.instanceIdentity ?? undefined;
  }

  async function dial(multiaddr: string): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }
    const { multiaddr: ma } = await import("@multiformats/multiaddr");
    await state.node.dial(ma(multiaddr));
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
    getMultiaddrs,
    dial,
    getInstanceIdentity,
  };
}
