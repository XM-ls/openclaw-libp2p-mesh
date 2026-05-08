export interface P2PMessage {
  id: string;
  type: "direct" | "broadcast" | "agent-sync";
  from: string;
  to?: string;
  topic?: string;
  payload: string;
  timestamp: number;
}

export interface MeshConfig {
  listenAddrs?: string[];
  discovery?: "mdns" | "bootstrap" | "dht";
  bootstrapList?: string[];
  meshTopic?: string;
  enableAgentSync?: boolean;
  enableWebSocket?: boolean;
  peerIdPath?: string;
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
}

export type MeshAccount = {
  accountId: string;
  configured: boolean;
  enabled: boolean;
};
