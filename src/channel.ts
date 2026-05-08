import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { MeshNetwork, MeshAccount } from "./types.js";
import { sendViaMesh } from "./send.js";

export function createLibp2pMeshChannel(mesh: MeshNetwork): ChannelPlugin {
  return createChatChannelPlugin<MeshAccount>({
    base: {
      id: "libp2p-mesh",
      meta: {
        id: "libp2p-mesh",
        label: "P2P Mesh",
        selectionLabel: "P2P Mesh",
        docsPath: "/channels/libp2p-mesh",
        docsLabel: "libp2p-mesh",
        blurb: "libp2p mesh network for cross-instance agent communication.",
        systemImage: "network",
      },
      capabilities: {
        chatTypes: ["direct"],
        media: false,
        blockStreaming: false,
      },
      configSchema: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
      config: {
        listAccountIds: () => ["default"],
        resolveAccount: () => ({
          accountId: "default",
          configured: true,
          enabled: true,
        }),
        isConfigured: () => true,
        isEnabled: () => true,
        describeAccount: () => ({
          accountId: "default",
          name: "default",
          configured: true,
          enabled: true,
          connected: mesh.getConnectedPeers().length > 0,
        }),
      },
      messaging: {
        normalizeTarget: (raw: string) => raw.trim(),
        targetResolver: {
          looksLikeId: () => true,
          hint: "peer-id",
        },
      },
    },
    outbound: {
      deliveryMode: "gateway",
      sendText: async ({ to, text }) => {
        try {
          await sendViaMesh(mesh, to, text);
          return { channel: "libp2p-mesh", messageId: `p2p-${Date.now()}` };
        } catch (err) {
          return { channel: "libp2p-mesh", messageId: `p2p-${Date.now()}`, meta: { error: String(err) } };
        }
      },
    },
  }) as ChannelPlugin;
}
