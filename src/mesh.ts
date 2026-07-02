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
import { identifyService } from "libp2p/identify";
import { autoNATService } from "libp2p/autonat";
import { circuitRelayServer, circuitRelayTransport } from "libp2p/circuit-relay";
import { dcutrService } from "libp2p/dcutr";
import { uPnPNATService } from "libp2p/upnp-nat";
import { encode, decode } from "it-length-prefixed";
import { pipe } from "it-pipe";
import { createLibp2p } from "libp2p";
import { Uint8ArrayList } from "uint8arraylist";
import type { Libp2p } from "libp2p";
import type { MeshConfig, MeshNetwork, NATTraversalStatus, P2PMessage, InstanceIdentity } from "./types.js";
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

export function planPeerDiscovery(config: MeshConfig): {
  useMDNS: boolean;
  bootstrapList: string[];
  enableDHT: boolean;
} {
  return {
    useMDNS: config.enableMDNS !== false,
    bootstrapList: config.bootstrapList ?? [],
    enableDHT: config.enableDHT !== false,
  };
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
    natFlags: {
      identify: false,
      autoNAT: false,
      upnp: false,
      circuitRelay: false,
      circuitRelayServer: false,
      dcutr: false,
    },
  };

  const seenMessages = new Set<string>();
  const messageHandlers = new Set<(msg: P2PMessage) => void>();
  const peerConnectHandlers = new Set<(peerId: string) => void>();
  const peerDisconnectHandlers = new Set<(peerId: string) => void>();
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
    const discoveryPlan = planPeerDiscovery(config);
    const peerDiscovery: any[] = [];

    if (discoveryPlan.useMDNS) {
      peerDiscovery.push(mdns({ interval: 1000 }));
      logger?.info?.("[libp2p-mesh] Using mDNS discovery (LAN)");
    }

    if (discoveryPlan.bootstrapList.length > 0) {
      peerDiscovery.push(bootstrap({ list: discoveryPlan.bootstrapList }));
      logger?.info?.(`[libp2p-mesh] Using bootstrap discovery (${discoveryPlan.bootstrapList.length} node(s))`);
    }

    // Configure DHT for both WAN peer discovery and pubkey registry
    const enableDHT = discoveryPlan.enableDHT;
    const services: Record<string, any> = {};
    if (enableDHT) {
      services.dht = kadDHT({
        protocolPrefix: "/openclaw",
        clientMode: false,
      } as any);
      logger?.info?.("[libp2p-mesh] DHT enabled (protocol: /openclaw/kad/1.0.0)");
    }

    // -------------------------------------------------------------------
    // NAT traversal stack (identify + autonat + upnp + circuit-relay + dcutr)
    // -------------------------------------------------------------------
    const natOn = config.enableNATTraversal !== false;
    const useIdentify = natOn && config.enableIdentify !== false;
    const useAutoNAT = natOn && config.enableAutoNAT !== false;
    const useUPnP = natOn && config.enableUPnP !== false;
    const useRelay = natOn && config.enableCircuitRelay !== false;
    const useRelayServer = natOn && config.enableCircuitRelayServer === true;
    const useDCUtR = natOn && config.enableDCUtR !== false;
    const relayList = config.relayList ?? [];
    const discoverRelays = Math.max(0, config.discoverRelays ?? 0);

    if (useIdentify) {
      services.identify = identifyService();
      state.natFlags.identify = true;
      logger?.info?.("[libp2p-mesh] identify service enabled");
    } else if (useAutoNAT || useDCUtR) {
      logger?.warn?.(
        "[libp2p-mesh] enableIdentify=false but AutoNAT/DCUtR rely on identify; they may not function correctly",
      );
    }

    if (useAutoNAT) {
      services.autoNAT = autoNATService();
      state.natFlags.autoNAT = true;
      logger?.info?.("[libp2p-mesh] AutoNAT enabled (will probe reachability)");
    }

    if (useUPnP) {
      services.upnp = uPnPNATService({
        description: `openclaw-libp2p-mesh/${state.instanceIdentity?.bindingComponents?.hostname ?? "node"}`,
        keepAlive: true,
      });
      state.natFlags.upnp = true;
      logger?.info?.("[libp2p-mesh] UPnP NAT port-mapping enabled");
    }

    if (useRelay) {
      transports.push(
        circuitRelayTransport({
          discoverRelays,
        }),
      );
      state.natFlags.circuitRelay = true;
      logger?.info?.(
        `[libp2p-mesh] Circuit Relay v2 transport enabled (discoverRelays=${discoverRelays})`,
      );
    }

    if (useRelayServer) {
      services.circuitRelay = circuitRelayServer({
        // Advertise via content-routing only if DHT is up — otherwise the
        // service still runs but won't auto-publish itself.
        advertise: enableDHT,
      });
      state.natFlags.circuitRelayServer = true;
      logger?.info?.(
        `[libp2p-mesh] Circuit Relay v2 SERVER enabled (advertise=${enableDHT}) — this node will relay traffic for other peers`,
      );
    }

    if (useDCUtR) {
      services.dcutr = dcutrService();
      state.natFlags.dcutr = true;
      logger?.info?.("[libp2p-mesh] DCUtR (hole-punching) enabled");
    }

    // Build the addresses block. listen always honours user config. The
    // circuit-relay transport reserves a slot on each relay we listen on
    // via /p2p-circuit — auto-derive those entries from relayList when the
    // user hasn't already specified them.
    const listenAddrs = [...(config.listenAddrs ?? ["/ip4/0.0.0.0/tcp/0"])];
    if (useRelay) {
      for (const relay of relayList) {
        const circuitListen = relay.endsWith("/p2p-circuit") ? relay : `${relay}/p2p-circuit`;
        if (!listenAddrs.includes(circuitListen)) {
          listenAddrs.push(circuitListen);
        }
      }
    }
    const announce = config.announceAddrs ?? [];

    state.node = await createLibp2p({
      peerId,
      start: false,
      transports,
      connectionEncryption: [noise()],
      streamMuxers: [mplex()],
      addresses: {
        listen: listenAddrs,
        announce,
      },
      peerDiscovery,
      services,
      // Circuit-relay-v2 transport can't bind to a listen address until a
      // relay reservation is established, so allow per-transport listen
      // failures when it's enabled rather than crashing the whole node.
      transportManager: useRelay
        ? { faultTolerance: 1 /* FaultTolerance.NO_FATAL */ }
        : undefined,
    });

    state.node.addEventListener("peer:connect", (evt) => {
      const peerIdStr = evt.detail.toString();
      logger?.info?.(`[libp2p-mesh] Peer connected: ${peerIdStr}`);
      for (const handler of peerConnectHandlers) {
        try {
          handler(peerIdStr);
        } catch (err) {
          logger?.error?.(`[libp2p-mesh] Peer connect handler error: ${String(err)}`);
        }
      }
    });

    state.node.addEventListener("peer:disconnect", (evt) => {
      const peerIdStr = evt.detail.toString();
      logger?.info?.(`[libp2p-mesh] Peer disconnected: ${peerIdStr}`);
      for (const handler of peerDisconnectHandlers) {
        try {
          handler(peerIdStr);
        } catch (err) {
          logger?.error?.(`[libp2p-mesh] Peer disconnect handler error: ${String(err)}`);
        }
      }
    });

    await state.node.handle(
      PROTOCOL,
      async ({ stream, connection }) => {
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

              const remotePeerId = connection.remotePeer.toString();
              if (parsed.type !== "broadcast" && parsed.from !== remotePeerId) {
                logger?.warn?.(
                  `[libp2p-mesh] Rejecting message with mismatched peer envelope: from=${parsed.from}, remote=${remotePeerId}`,
                );
                continue;
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
                      continue;
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
    },
      {
        // Allow the openclaw protocol to be served over relayed (transient)
        // connections; without this, peers behind NAT can't deliver messages.
        runOnTransientConnection: true,
      },
    );

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

    // Reserve a slot on each configured relay so other peers can dial us
    // through them via /p2p-circuit. Fire-and-forget; failures are logged.
    if (useRelay && relayList.length > 0) {
      const { multiaddr } = await import("@multiformats/multiaddr");
      for (const addr of relayList) {
        const node = state.node!;
        (async () => {
          try {
            await node.dial(multiaddr(addr));
            logger?.info?.(`[libp2p-mesh] Connected to relay ${addr} — reservation in progress`);
          } catch (err) {
            logger?.warn?.(`[libp2p-mesh] Failed to connect to relay ${addr}: ${String(err)}`);
          }
        })();
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

  async function writeMessageToPeer(peerId: string, msg: P2PMessage): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }

    const data = new TextEncoder().encode(JSON.stringify(msg));

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 8000);

    try {
      const { peerIdFromString } = await import("@libp2p/peer-id");
      const targetPid = peerIdFromString(peerId);

      // If we have no open connection to the target and no peer-store
      // address (typical when both ends are NAT-isolated and only share a
      // configured relay), proactively dial via each /p2p-circuit path we
      // know — this is what makes the relay configuration actually deliver
      // messages when peer discovery hasn't propagated yet.
      const alreadyConnected = state.node
        .getConnections()
        .some((c) => c.remotePeer.equals(targetPid));
      if (!alreadyConnected) {
        const relayAddrs = config.relayList ?? [];
        for (const relayAddr of relayAddrs) {
          try {
            const circuit = relayAddr.endsWith("/p2p-circuit")
              ? `${relayAddr}/p2p/${peerId}`
              : `${relayAddr}/p2p-circuit/p2p/${peerId}`;
            const { multiaddr } = await import("@multiformats/multiaddr");
            logger?.debug?.(
              `[libp2p-mesh] sendToPeer: pre-dialling ${peerId} via relay path ${circuit}`,
            );
            await state.node.dial(multiaddr(circuit), {
              signal: abortController.signal,
            });
            logger?.debug?.(
              `[libp2p-mesh] sendToPeer: established relayed connection to ${peerId}`,
            );
            break;
          } catch (relayErr) {
            logger?.debug?.(
              `[libp2p-mesh] sendToPeer: relay pre-dial via ${relayAddr} failed: ${String(relayErr)}`,
            );
          }
        }
      }

      logger?.debug?.(`[libp2p-mesh] dialProtocol to ${peerId}`);
      const stream = await state.node.dialProtocol(targetPid, PROTOCOL, {
        signal: abortController.signal,
        runOnTransientConnection: true,
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

    await writeMessageToPeer(peerId, msg);
  }

  async function sendStructuredMessage(
    peerId: string,
    message: Omit<P2PMessage, "from" | "timestamp" | "instanceId" | "pubkey" | "signature"> & { timestamp?: number },
  ): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }

    const msg = buildSignedMessage({
      ...message,
      from: state.node.peerId.toString(),
      timestamp: message.timestamp ?? Date.now(),
    });

    await writeMessageToPeer(peerId, msg);
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
        const stream = await conn.newStream(PROTOCOL, {
          signal: abortController.signal,
          runOnTransientConnection: true,
        });
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
        const stream = await conn.newStream(PROTOCOL, {
          signal: abortController.signal,
          runOnTransientConnection: true,
        });
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

  function onPeerConnect(handler: (peerId: string) => void): () => void {
    peerConnectHandlers.add(handler);
    return () => {
      peerConnectHandlers.delete(handler);
    };
  }

  function onPeerDisconnect(handler: (peerId: string) => void): () => void {
    peerDisconnectHandlers.add(handler);
    return () => {
      peerDisconnectHandlers.delete(handler);
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

  function getNATStatus(): NATTraversalStatus {
    const enabled = { ...state.natFlags };
    const reservedRelays: string[] = [];
    let hasRelayedListenAddr = false;
    if (state.node) {
      // Listen multiaddrs that include /p2p-circuit are reservations the
      // circuit-relay transport managed to acquire from a relay server.
      for (const ma of state.node.getMultiaddrs()) {
        const s = ma.toString();
        if (s.includes("/p2p-circuit")) {
          hasRelayedListenAddr = true;
          reservedRelays.push(s);
        }
      }
    }
    return { enabled, reservedRelays, hasRelayedListenAddr };
  }

  return {
    start,
    stop,
    sendToPeer,
    sendStructuredMessage,
    onMessage,
    onPeerConnect,
    onPeerDisconnect,
    publishToTopic,
    subscribeToTopic,
    getLocalPeerId,
    getConnectedPeers,
    getMultiaddrs,
    dial,
    getInstanceIdentity,
    getNATStatus,
  };
}
