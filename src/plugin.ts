import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createLibp2pMeshChannel } from "./channel.js";
import { handleP2PInbound } from "./inbound.js";
import { createOpenClawRuntimeInboundDelivery } from "./inbound-delivery.js";
import { createInstancePeerStore } from "./instance-peer-store.js";
import { createInstanceRouter } from "./instance-router.js";
import { createMeshNetwork } from "./mesh.js";
import { buildP2PTools } from "./agent-tools.js";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { MeshConfig } from "./types.js";

export function registerLibp2pMesh(api: OpenClawPluginApi) {
  const config = api.pluginConfig as MeshConfig | undefined;
  let unsubscribeInbound: (() => void) | undefined;
  let serviceStarted = false;
  const mesh = createMeshNetwork({
    config,
    logger: api.logger,
  });
  const store = createInstancePeerStore({ logger: api.logger });
  const delivery = createOpenClawRuntimeInboundDelivery({
    config: api.config,
    loadAdapter: api.runtime.channel.outbound.loadAdapter,
    logger: api.logger,
  });
  const router = createInstanceRouter({
    mesh,
    store,
    delivery,
    config,
    logger: api.logger,
  });

  // 1. Register Service (manages libp2p node lifecycle)
  api.registerService({
    id: "libp2p-mesh",
    start: async () => {
      if (serviceStarted) {
        api.logger.debug?.("[libp2p-mesh] Service already started; ignoring duplicate start.");
        return;
      }
      await mesh.start();
      await router.start();
      unsubscribeInbound = mesh.onMessage((msg) => {
        if (msg.type === "direct" || msg.type === "broadcast" || msg.type === "agent-sync") {
          handleP2PInbound(msg, { logger: api.logger });
        }
      });
      const identity = mesh.getInstanceIdentity();
      api.logger.info?.(`[libp2p-mesh] Service started. Peer ID: ${mesh.getLocalPeerId()}`);
      if (identity) {
        api.logger.info?.(`[libp2p-mesh] Instance Identity: ${identity.id}`);
      }
      const nat = mesh.getNATStatus();
      const enabledNames = Object.entries(nat.enabled)
        .filter(([, on]) => on)
        .map(([k]) => k);
      if (enabledNames.length > 0) {
        api.logger.info?.(
          `[libp2p-mesh] NAT traversal services: ${enabledNames.join(", ")}`,
        );
      }
      if (nat.reservedRelays.length > 0) {
        api.logger.info?.(
          `[libp2p-mesh] Active relay reservations: ${nat.reservedRelays.join(", ")}`,
        );
      }
      serviceStarted = true;
    },
    stop: async () => {
      unsubscribeInbound?.();
      unsubscribeInbound = undefined;
      await router.stop();
      await mesh.stop();
      serviceStarted = false;
      api.logger.info?.("[libp2p-mesh] Service stopped.");
    },
  });

  // 2. Register Channel (lightweight debugging surface)
  api.registerChannel({
    plugin: createLibp2pMeshChannel(mesh) as ChannelPlugin,
  });

  // 3. Register Agent Tools
  const tools = buildP2PTools(mesh, router);
  for (const tool of tools) {
    api.registerTool(tool as never);
  }

  // 4. Register Hook (log received messages for observability)
  api.registerHook("message:received", async (event) => {
    const ctx = event.context as { channelId?: string } | undefined;
    api.logger.debug?.(`[libp2p-mesh] message received on channel ${ctx?.channelId ?? "unknown"}`);
  }, { name: "libp2p-mesh-message-received" });
}
