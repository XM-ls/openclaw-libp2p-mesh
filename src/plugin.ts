import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createLibp2pMeshChannel } from "./channel.js";
import { handleP2PInbound, type InboundHandlerDeps } from "./inbound.js";
import { createMeshNetwork } from "./mesh.js";
import { buildP2PTools } from "./agent-tools.js";
import { sendViaMesh } from "./send.js";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";

export function registerLibp2pMesh(api: OpenClawPluginApi) {
  const mesh = createMeshNetwork({
    config: api.pluginConfig as { listenAddrs?: string[]; discovery?: "mdns" | "bootstrap" | "dht"; bootstrapList?: string[]; meshTopic?: string; enableAgentSync?: boolean; enableWebSocket?: boolean } | undefined,
    logger: api.logger,
  });

  const channel = createLibp2pMeshChannel(mesh);

  // 1. Register Service (manages libp2p node lifecycle)
  api.registerService({
    id: "libp2p-mesh",
    start: async () => {
      await mesh.start();
      mesh.onMessage((msg) => {
        const sendToChannel: InboundHandlerDeps["sendToChannel"] = async (_channelId, target, text) => {
          try {
            await sendViaMesh(mesh, target, text);
          } catch (err) {
            api.logger.error?.(`[libp2p-mesh] sendToChannel error: ${err}`);
          }
        };
        handleP2PInbound(msg, { logger: api.logger, sendToChannel });
      });
      api.logger.info?.(`[libp2p-mesh] Service started. Peer ID: ${mesh.getLocalPeerId()}`);
    },
    stop: async () => {
      await mesh.stop();
      api.logger.info?.("[libp2p-mesh] Service stopped.");
    },
  });

  // 2. Register Channel (lightweight debugging surface)
  api.registerChannel({
    plugin: channel as ChannelPlugin,
  });

  // 3. Register Agent Tools
  const tools = buildP2PTools(mesh);
  for (const tool of tools) {
    api.registerTool(tool as never);
  }

  // 4. Register Hook (log received messages for observability)
  api.registerHook("message:received", async (event) => {
    const ctx = event.context as { channelId?: string } | undefined;
    api.logger.debug?.(`[libp2p-mesh] message received on channel ${ctx?.channelId ?? "unknown"}`);
  }, { name: "libp2p-mesh-message-received" });
}
