export interface InstanceIdentity {
  /** Full InstanceID string, e.g. "alice-mac@AQIDBAUGBweI.7a3f9e2b" */
  id: string;
  /** Human-readable instance name */
  name: string;
  /** Base64url-encoded Ed25519 public key */
  pubkey: string;
  /** Hex SHA-256 binding hash of environment dimensions */
  binding: string;
  /** Components that contributed to the binding hash */
  bindingComponents: {
    username: string;
    hostname: string;
    platform: string;
  };
  /** Timestamp when the identity was created */
  createdAt: number;
}

export interface P2PMessage {
  id: string;
  type: "direct" | "broadcast" | "agent-sync";
  from: string;
  to?: string;
  topic?: string;
  payload: string;
  timestamp: number;
  /** Instance identity of the sender (for cross-instance authentication) */
  instanceId?: string;
  /** Base64url-encoded Ed25519 public key of the sender (allows direct verification without DHT lookup) */
  pubkey?: string;
  /** Ed25519 signature of the message payload, verifiable with instance pubkey */
  signature?: string;
}

export interface MeshConfig {
  listenAddrs?: string[];
  discovery?: "mdns" | "bootstrap" | "dht";
  bootstrapList?: string[];
  meshTopic?: string;
  enableAgentSync?: boolean;
  enableWebSocket?: boolean;
  peerIdPath?: string;
  instanceName?: string;
  /** Enable DHT for WAN peer discovery and pubkey registry (default: true when discovery=dht, false otherwise) */
  enableDHT?: boolean;

  // ---------------------------------------------------------------------
  // NAT traversal (all opt-in, on by default; safe to leave at defaults
  // when both peers already have a routable address)
  // ---------------------------------------------------------------------

  /**
   * Master switch for the NAT traversal stack. When `false` none of the
   * NAT-related services are wired in, restoring the pre-2026.5.16
   * behaviour. Default `true`.
   */
  enableNATTraversal?: boolean;
  /** Run the libp2p identify protocol (required by AutoNAT/DCUtR). Default `true` when NAT traversal is on. */
  enableIdentify?: boolean;
  /** AutoNAT detects whether we are reachable from the public internet. Default `true` when NAT traversal is on. */
  enableAutoNAT?: boolean;
  /** Attempt UPnP/PMP port mapping on the local gateway. Default `true` when NAT traversal is on. */
  enableUPnP?: boolean;
  /** Circuit Relay v2 transport — required to dial peers via a relay. Default `true` when NAT traversal is on. */
  enableCircuitRelay?: boolean;
  /**
   * Act as a Circuit Relay v2 server for other peers. Default `false` —
   * only enable on a node with a public, routable address (e.g. a cloud VM)
   * because relayed traffic is forwarded through this process.
   */
  enableCircuitRelayServer?: boolean;
  /** Direct Connection Upgrade through Relay (hole punching). Default `true` when NAT traversal is on. */
  enableDCUtR?: boolean;
  /**
   * Explicit relay multiaddrs to reserve a slot on. Each entry should be a
   * full multiaddr ending in `/p2p/<peer-id>`. The node will keep a
   * reservation open with each one so other peers can dial us through them.
   */
  relayList?: string[];
  /**
   * Number of relays to auto-discover via content routing. Requires DHT.
   * Default `0` (disabled). Set to e.g. `2` to look up public relays.
   */
  discoverRelays?: number;
  /**
   * Multiaddrs to announce to the network on top of the auto-detected
   * listen/observed addresses. Useful when running behind a known port
   * forward where AutoNAT cannot probe (e.g. behind a cloud LB).
   */
  announceAddrs?: string[];
}

export interface NATTraversalStatus {
  /** Which NAT-traversal services were wired in at start() */
  enabled: {
    identify: boolean;
    autoNAT: boolean;
    upnp: boolean;
    circuitRelay: boolean;
    circuitRelayServer: boolean;
    dcutr: boolean;
  };
  /** Relay multiaddrs we have an active reservation on */
  reservedRelays: string[];
  /** Whether at least one circuit-relay address has been advertised as a listen address */
  hasRelayedListenAddr: boolean;
}

export interface MeshNetwork {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendToPeer(peerId: string, message: string): Promise<void>;
  onMessage(handler: (msg: P2PMessage) => void): () => void;
  publishToTopic(topic: string, message: string): Promise<void>;
  subscribeToTopic(topic: string, handler: (msg: string) => void): Promise<void>;
  getLocalPeerId(): string;
  getConnectedPeers(): string[];
  getMultiaddrs(): string[];
  dial(multiaddr: string): Promise<void>;
  /** Get the OpenClaw instance identity (lightweight BAID-inspired ID) */
  getInstanceIdentity(): InstanceIdentity | undefined;
  /** Inspect which NAT-traversal services are running and whether any relay reservations are active */
  getNATStatus(): NATTraversalStatus;
}

export type MeshAccount = {
  accountId: string;
  configured: boolean;
  enabled: boolean;
};
