import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import { sendViaMesh } from "./send.js";
import { getLibp2pMeshRuntime, hasLibp2pMeshRuntime, } from "../runtime-setter-api.js";
function buildChannel(getMesh) {
    return createChatChannelPlugin({
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
                    connected: hasLibp2pMeshRuntime()
                        ? getMesh().getConnectedPeers().length > 0
                        : false,
                }),
            },
            messaging: {
                normalizeTarget: (raw) => raw.trim(),
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
                    await sendViaMesh(getMesh(), to, text);
                    return { channel: "libp2p-mesh", messageId: `p2p-${Date.now()}` };
                }
                catch (err) {
                    return {
                        channel: "libp2p-mesh",
                        messageId: `p2p-${Date.now()}`,
                        meta: { error: String(err) },
                    };
                }
            },
        },
    });
}
// Static channel plugin export for the bundled-channel-entry contract.
// The mesh instance is resolved lazily through runtime-setter-api.ts, which
// plugin.ts populates after starting the mesh service.
export const libp2pMeshPlugin = buildChannel(getLibp2pMeshRuntime);
// Backwards-compatible factory: kept so any caller that still passes the mesh
// instance directly (e.g. the standalone plugin entry) continues to work.
export function createLibp2pMeshChannel(mesh) {
    return buildChannel(() => mesh);
}
//# sourceMappingURL=channel.js.map