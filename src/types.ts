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
}

export type MeshAccount = {
  accountId: string;
  configured: boolean;
  enabled: boolean;
};
