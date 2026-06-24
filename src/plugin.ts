import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createLibp2pMeshChannel } from "./channel.js";
import { handleP2PInbound, type InboundHandlerDeps } from "./inbound.js";
import { createOpenClawRuntimeInboundDelivery } from "./inbound-delivery.js";
import { createInstancePeerStore } from "./instance-peer-store.js";
import { createInstanceRouter } from "./instance-router.js";
import { createMeshNetwork } from "./mesh.js";
import { createUserMdAttributeSource } from "./user-md-attributes.js";
import { createUserProfileStore } from "./user-profile-store.js";
import { buildP2PTools } from "./agent-tools.js";
import { registerLibp2pMeshCli } from "./profile-cli.js";
import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { MeshConfig } from "./types.js";

export type Libp2pMeshPluginDeps = {
  createMeshNetwork?: typeof createMeshNetwork;
  createInstanceRouter?: typeof createInstanceRouter;
};

export function registerLibp2pMesh(api: OpenClawPluginApi) {
  registerLibp2pMeshWithDeps(api);
}

export function registerLibp2pMeshWithDeps(
  api: OpenClawPluginApi,
  deps: Libp2pMeshPluginDeps = {},
) {
  registerLibp2pMeshCli(api);

  const config = api.pluginConfig as MeshConfig | undefined;
  let unsubscribeInbound: (() => void) | undefined;
  let serviceStarted = false;
  const mesh = (deps.createMeshNetwork ?? createMeshNetwork)({
    config,
    logger: api.logger,
  });
  const store = createInstancePeerStore({ logger: api.logger });
  const userAttributeSource = createUserMdAttributeSource({ logger: api.logger });
  const userProfileStore = createUserProfileStore({ logger: api.logger });
  const delivery = createOpenClawRuntimeInboundDelivery({
    config: api.config,
    loadAdapter: async (channelId) => {
      const loadAdapter = api.runtime.channel?.outbound?.loadAdapter;
      if (!loadAdapter) {
        api.logger.warn?.(
          "[libp2p-mesh] Runtime channel outbound adapter is unavailable; inbound delivery is disabled in this context.",
        );
        return undefined;
      }
      return loadAdapter(channelId);
    },
    logger: api.logger,
  });
  const router = (deps.createInstanceRouter ?? createInstanceRouter)({
    mesh,
    store,
    delivery,
    config,
    logger: api.logger,
    userAttributeSource,
    userProfileStore,
  });

  const channel = createLibp2pMeshChannel(mesh);

  function attachInboundHandlers(): () => void {
    return mesh.onMessage((msg) => {
      if (msg.type === "direct" || msg.type === "broadcast") {
        const sendToChannel: InboundHandlerDeps["sendToChannel"] = async (_channelId, _target, text) => {
          if (!config?.inboundChannel || !config?.inboundTarget) {
            api.logger.warn?.(
              "[libp2p-mesh] inboundChannel/inboundTarget not configured; direct message logged only.",
            );
            return;
          }

          const result = await delivery.deliver({
            channel: config.inboundChannel,
            target: config.inboundTarget,
            text,
            metadata: {
              fromInstanceId: msg.instanceId ?? msg.from,
              fromPeerId: msg.from,
              p2pMessageId: msg.id,
              allowAgentAutoReply: false,
              replyToInstanceId: msg.instanceId ?? msg.from,
              replyTool: "p2p_send_instance_message",
            },
          });
          if (!result.ok) {
            api.logger.error?.(
              `[libp2p-mesh] Failed to forward direct message from ${msg.from}: ${result.error}`,
            );
          }
        };
        handleP2PInbound(msg, { logger: api.logger, sendToChannel });
      } else if (msg.type === "agent-sync") {
        handleP2PInbound(msg, { logger: api.logger });
      }
    });
  }

  // 1. Register Service (manages libp2p node lifecycle)
  api.registerService({
    id: "libp2p-mesh",
    start: async () => {
      if (serviceStarted) {
        api.logger.debug?.("[libp2p-mesh] Service already started; ignoring duplicate start.");
        return;
      }
      router.attachHandlers();
      unsubscribeInbound = attachInboundHandlers();
      await mesh.start();
      await router.announceToConnectedPeers();
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
    plugin: channel as ChannelPlugin,
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
