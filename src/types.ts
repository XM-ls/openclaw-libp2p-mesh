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

export type P2PMessageType =
  | "direct"
  | "broadcast"
  | "agent-sync"
  | "instance-announce"
  | "user-message"
  | "delivery-ack";

export interface P2PMessage {
  id: string;
  type: P2PMessageType;
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

export interface InstanceAnnouncePayload {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  multiaddrs: string[];
  pubkey?: string;
  userPublicAttributes?: UserPublicAttribute[];
  announcedAt: number;
}

export interface UserMessagePayload {
  messageId: string;
  fromInstanceId: string;
  toInstanceId: string;
  text: string;
  metadata: {
    allowAgentAutoReply: boolean;
    replyToInstanceId: string;
    replyTool: "p2p_send_instance_message";
  };
}

export interface InboundTargetConfig {
  id?: string;
  channel: string;
  target: string;
}

export interface DeliveryTargetResult {
  id?: string;
  channel: string;
  target: string;
  ok: boolean;
  error?: string;
}

export interface DeliveryAckPayload {
  ackFor: string;
  ok: boolean;
  inboundChannel?: string;
  inboundTarget?: string;
  results?: DeliveryTargetResult[];
  deliveredAt: number;
  error?: string;
}

export type UserPublicAttribute =
  | {
      kind: "tag";
      value: string;
      label: string;
      source: "USER.md";
    }
  | {
      kind: "structured";
      key: "group" | "project" | "role" | "skill" | "custom" | string;
      value: string;
      label: string;
      source: "profile";
    };

export type UserMdAttributeSource = {
  loadTags(): Promise<UserPublicAttribute[]>;
  refreshTags?(): Promise<UserPublicAttribute[]>;
};

export type LocalPeerLabel = {
  key: string;
  value: string;
};

export type LocalPeerLabelAttribute = {
  kind: "structured";
  key: string;
  value: string;
  label: string;
  source: "local";
};

export type PeerLabelsFile = {
  version: 1;
  updatedAt: number;
  peers: Record<string, { labels: LocalPeerLabel[] }>;
};

export type PeerLabelStore = {
  load(): Promise<PeerLabelsFile>;
  save(file: PeerLabelsFile): Promise<PeerLabelsFile>;
  listRawLabels(instanceId: string): Promise<LocalPeerLabel[]>;
  listLabels(instanceId: string): Promise<LocalPeerLabelAttribute[]>;
  replaceLabels(instanceId: string, labels: LocalPeerLabel[]): Promise<PeerLabelsFile>;
};

export type UserAttributeMatch =
  | { kind: "tag"; value: string }
  | { kind: "structured"; key: string; value: string };

export type UserAttributeMatchScope = "public" | "local" | "all";

export type UserAttributeMatchSource = "public" | "local" | "all";

export type UserAttributeMessageOptions = {
  dryRun?: boolean;
  scope?: UserAttributeMatchScope;
};

export interface InstancePeerRecord {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  multiaddrs: string[];
  pubkey?: string;
  userPublicAttributes?: UserPublicAttribute[];
  lastSeenAt: number;
  lastAnnouncedAt: number;
  source: "announce";
}

export interface InstancePeerTable {
  version: 1;
  updatedAt: number;
  instances: Record<string, InstancePeerRecord>;
}

export interface InstancePeerStore {
  load(): Promise<InstancePeerTable>;
  list(): Promise<InstancePeerRecord[]>;
  resolve(instanceId: string): Promise<InstancePeerRecord | undefined>;
  upsertFromAnnounce(payload: InstanceAnnouncePayload): Promise<{
    record: InstancePeerRecord;
    changed: boolean;
    peerIdSharedBy: string[];
  }>;
}

export type UserAttributeMessageTarget = {
  instanceId: string;
  instanceName?: string;
  peerId: string;
  matchedAttribute: UserPublicAttribute | LocalPeerLabelAttribute;
  matchSource: UserAttributeMatchSource;
};

export type UserAttributeMessageDeliveryResult = UserAttributeMessageTarget & {
  sent: boolean;
  delivered: boolean;
  error?: string;
};

export type UserAttributeMessageResult = {
  scope: UserAttributeMatchScope;
  matched: number;
  sent: number;
  delivered: number;
  failed: number;
  targets?: UserAttributeMessageTarget[];
  results?: UserAttributeMessageDeliveryResult[];
  error?: string;
};

export interface InboundDeliveryRequest {
  channel: string;
  target: string;
  text: string;
  metadata: {
    fromInstanceId: string;
    fromPeerId: string;
    p2pMessageId: string;
    allowAgentAutoReply: boolean;
    replyToInstanceId: string;
    replyTool: "p2p_send_instance_message";
  };
}

export interface InboundDeliveryResult {
  ok: boolean;
  channel: string;
  target: string;
  error?: string;
}

export interface InboundDeliveryAdapter {
  deliver(request: InboundDeliveryRequest): Promise<InboundDeliveryResult>;
}

export type InstanceRouterOptions = {
  mesh: MeshNetwork;
  store: InstancePeerStore;
  delivery: InboundDeliveryAdapter;
  config?: MeshConfig;
  logger?: {
    info?: (message: string) => void;
    debug?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
  userAttributeSource?: UserMdAttributeSource;
  userProfileStore?: {
    listAttributes(): Promise<UserPublicAttribute[]>;
  };
  peerLabelStore?: {
    listLabels(instanceId: string): Promise<LocalPeerLabelAttribute[]>;
  };
};

export interface InstanceRouter {
  attachHandlers(): void;
  announceToConnectedPeers(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  handleMessage(msg: P2PMessage): Promise<void>;
  announceToPeer(peerId: string): Promise<void>;
  listInstances(): Promise<InstancePeerRecord[]>;
  resolveInstance(instanceId: string): Promise<InstancePeerRecord | undefined>;
  sendInstanceMessage(instanceId: string, message: string): Promise<{
    sent: boolean;
    delivered: boolean;
    toInstanceId: string;
    toPeerId: string;
    ackMessageId?: string;
    inboundChannel?: string;
    inboundTarget?: string;
    deliveryResults?: DeliveryTargetResult[];
    error?: string;
  }>;
  sendUserAttributeMessage(
    match: UserAttributeMatch,
    message: string,
    options?: UserAttributeMessageOptions,
  ): Promise<UserAttributeMessageResult>;
}

export interface MeshConfig {
  listenAddrs?: string[];
  discovery?: "mdns" | "bootstrap" | "dht";
  bootstrapList?: string[];
  meshTopic?: string;
  announceLogDetail?: AnnounceLogDetail;
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
   * Deprecated pre-2026.6 config keys kept so existing OpenClaw configs keep
   * validating after upgrade. Relay selection is now configured with
   * `relayList`; inbound display uses `inboundChannel`/`inboundTarget`.
   */
  relayChannel?: string;
  relayAccountId?: string;
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
  inboundChannel?: string;
  inboundTarget?: string;
  inboundTargets?: InboundTargetConfig[];
  deliveryAckTimeoutMs?: number;
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
  sendStructuredMessage(
    peerId: string,
    message: Omit<P2PMessage, "from" | "timestamp" | "instanceId" | "pubkey" | "signature"> & { timestamp?: number },
  ): Promise<void>;
  onMessage(handler: (msg: P2PMessage) => void): () => void;
  onPeerConnect(handler: (peerId: string) => void): () => void;
  onPeerDisconnect(handler: (peerId: string) => void): () => void;
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

export type AnnounceLogDetail = "off" | "summary" | "payload";

export type MeshAccount = {
  accountId: string;
  configured: boolean;
  enabled: boolean;
};
