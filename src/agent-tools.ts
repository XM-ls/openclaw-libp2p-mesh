import type { MeshNetwork } from "./types.js";

export function buildP2PTools(mesh: MeshNetwork) {
  return [
    {
      name: "p2p_send_message",
      label: "P2P Send Message",
      description: "Send a direct message to another agent via the P2P mesh network.",
      parameters: {
        type: "object" as const,
        properties: {
          peerId: {
            type: "string" as const,
            description: "Target peer ID (libp2p Peer ID string)",
          },
          message: {
            type: "string" as const,
            description: "Message content to send",
          },
        },
        required: ["peerId", "message"],
      },
      async execute(_toolCallId: string, params: { peerId: string; message: string }) {
        try {
          await mesh.sendToPeer(params.peerId, params.message);
          return {
            content: [{ type: "text" as const, text: `Message sent to ${params.peerId}` }],
            details: { sent: true, peerId: params.peerId },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to send message to ${params.peerId}: ${String(err)}`,
              },
            ],
            details: { sent: false, peerId: params.peerId, error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_broadcast",
      label: "P2P Broadcast",
      description: "Broadcast a message to all peers on a topic via the P2P mesh network.",
      parameters: {
        type: "object" as const,
        properties: {
          topic: {
            type: "string" as const,
            description: "Topic name to broadcast on",
          },
          message: {
            type: "string" as const,
            description: "Message content to broadcast",
          },
        },
        required: ["topic", "message"],
      },
      async execute(_toolCallId: string, params: { topic: string; message: string }) {
        try {
          await mesh.publishToTopic(params.topic, params.message);
          return {
            content: [{ type: "text" as const, text: `Broadcast sent to topic ${params.topic}` }],
            details: { broadcast: true, topic: params.topic },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to broadcast to topic ${params.topic}: ${String(err)}`,
              },
            ],
            details: { broadcast: false, topic: params.topic, error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_list_peers",
      label: "P2P List Peers",
      description: "List currently connected peers in the P2P mesh network.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(_toolCallId: string) {
        try {
          const peers = mesh.getConnectedPeers();
          const text =
            peers.length === 0
              ? "No peers currently connected."
              : `Connected peers (${peers.length}): ${peers.join(", ")}`;
          return {
            content: [{ type: "text" as const, text }],
            details: {
              localPeerId: mesh.getLocalPeerId(),
              connectedPeers: peers,
              count: peers.length,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Failed to list peers: ${String(err)}` }],
            details: { error: String(err) },
            isError: true,
          };
        }
      },
    },
  ];
}
