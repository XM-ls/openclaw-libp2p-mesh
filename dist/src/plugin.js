import { createLibp2pMeshChannel } from "./channel.js";
import { handleP2PInbound } from "./inbound.js";
import { createOpenClawRuntimeInboundDelivery } from "./inbound-delivery.js";
import { createInstancePeerStore } from "./instance-peer-store.js";
import { createInstanceRouter } from "./instance-router.js";
import { createMeshNetwork } from "./mesh.js";
import { createPeerLabelStore } from "./peer-label-store.js";
import { createUserMdAgentAttributeSource } from "./user-md-agent-attributes.js";
import { createOpenClawUserMdAttributeExtractor } from "./user-md-openclaw-extractor.js";
import { createUserProfileStore } from "./user-profile-store.js";
import { buildP2PTools } from "./agent-tools.js";
import { registerLibp2pMeshCli } from "./profile-cli.js";
import { autoInstallAgentPrompt } from "./prompt-config.js";
import { applyDefaultMeshConfig } from "./setup-config.js";
import { setLibp2pMeshRuntime } from "../runtime-setter-api.js";
const DEFAULT_PUBLIC_ATTRIBUTE_REFRESH_STARTUP_DELAY_MS = 10000;
export function registerLibp2pMesh(api) {
    registerLibp2pMeshWithDeps(api);
}
export function registerLibp2pMeshWithDeps(api, deps = {}) {
    const config = applyDefaultMeshConfig(api.pluginConfig);
    void (deps.autoInstallAgentPrompt ?? autoInstallAgentPrompt)({ logger: api.logger }).catch((error) => {
        try {
            api.logger.warn?.(`[libp2p-mesh] Failed to auto-install agent prompt: ${String(error)}`);
        }
        catch {
            // Ignore logger failures so prompt installation remains fire-and-forget.
        }
    });
    let unsubscribeInbound;
    let serviceStarted = false;
    let startPromise;
    let publicAttributeRefreshTimer;
    const mesh = (deps.createMeshNetwork ?? createMeshNetwork)({
        config,
        logger: api.logger,
    });
    setLibp2pMeshRuntime(mesh);
    const store = createInstancePeerStore({ logger: api.logger });
    const peerLabelStore = createPeerLabelStore({ logger: api.logger });
    const userAttributeSource = createUserMdAgentAttributeSource({
        logger: api.logger,
        extractor: createOpenClawUserMdAttributeExtractor(api),
    });
    const userProfileStore = createUserProfileStore({ logger: api.logger });
    const delivery = createOpenClawRuntimeInboundDelivery({
        config: api.config,
        loadAdapter: async (channelId) => {
            const loadAdapter = api.runtime.channel?.outbound?.loadAdapter;
            if (!loadAdapter) {
                api.logger.warn?.("[libp2p-mesh] Runtime channel outbound adapter is unavailable; inbound delivery is disabled in this context.");
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
        peerLabelStore,
        publicAttributeRefreshInitiallyEnabled: false,
    });
    registerLibp2pMeshCli(api, {
        profile: {
            async afterProfileSave() {
                await router.refreshPublicAttributes();
            },
        },
    });
    const channel = createLibp2pMeshChannel(mesh);
    function attachInboundHandlers() {
        return mesh.onMessage((msg) => {
            if (msg.type === "direct" || msg.type === "broadcast") {
                const sendToChannel = async (_channelId, _target, text) => {
                    if (!config?.inboundChannel || !config?.inboundTarget) {
                        api.logger.warn?.("[libp2p-mesh] inboundChannel/inboundTarget not configured; direct message logged only.");
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
                        api.logger.error?.(`[libp2p-mesh] Failed to forward direct message from ${msg.from}: ${result.error}`);
                    }
                };
                handleP2PInbound(msg, { logger: api.logger, sendToChannel });
            }
            else if (msg.type === "agent-sync") {
                handleP2PInbound(msg, { logger: api.logger });
            }
        });
    }
    function publicAttributeRefreshStartupDelayMs() {
        const configured = config?.publicAttributeRefreshStartupDelayMs;
        if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
            return configured;
        }
        return DEFAULT_PUBLIC_ATTRIBUTE_REFRESH_STARTUP_DELAY_MS;
    }
    function clearPublicAttributeRefreshTimer() {
        if (publicAttributeRefreshTimer) {
            clearTimeout(publicAttributeRefreshTimer);
            publicAttributeRefreshTimer = undefined;
        }
    }
    function schedulePublicAttributeRefreshEnable() {
        clearPublicAttributeRefreshTimer();
        publicAttributeRefreshTimer = setTimeout(() => {
            publicAttributeRefreshTimer = undefined;
            router.enablePublicAttributeRefresh();
        }, publicAttributeRefreshStartupDelayMs());
    }
    async function cleanupStartupFailure() {
        clearPublicAttributeRefreshTimer();
        setLibp2pMeshRuntime(undefined);
        try {
            unsubscribeInbound?.();
        }
        catch (error) {
            api.logger.warn?.(`[libp2p-mesh] Failed to clean inbound handler after startup failure: ${String(error)}`);
        }
        finally {
            unsubscribeInbound = undefined;
        }
        try {
            await router.stop();
        }
        catch (error) {
            api.logger.warn?.(`[libp2p-mesh] Failed to stop router after startup failure: ${String(error)}`);
        }
        try {
            await mesh.stop();
        }
        catch (error) {
            api.logger.warn?.(`[libp2p-mesh] Failed to stop mesh after startup failure: ${String(error)}`);
        }
        serviceStarted = false;
    }
    // 1. Register Service (manages libp2p node lifecycle)
    api.registerService({
        id: "libp2p-mesh",
        start: async () => {
            if (serviceStarted) {
                api.logger.debug?.("[libp2p-mesh] Service already started; ignoring duplicate start.");
                return;
            }
            if (startPromise) {
                api.logger.debug?.("[libp2p-mesh] Service start already in progress; waiting for it.");
                return startPromise;
            }
            startPromise = (async () => {
                try {
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
                        api.logger.info?.(`[libp2p-mesh] NAT traversal services: ${enabledNames.join(", ")}`);
                    }
                    if (nat.reservedRelays.length > 0) {
                        api.logger.info?.(`[libp2p-mesh] Active relay reservations: ${nat.reservedRelays.join(", ")}`);
                    }
                    serviceStarted = true;
                    schedulePublicAttributeRefreshEnable();
                }
                catch (error) {
                    await cleanupStartupFailure();
                    throw error;
                }
                finally {
                    startPromise = undefined;
                }
            })();
            return startPromise;
        },
        stop: async () => {
            await startPromise?.catch(() => undefined);
            clearPublicAttributeRefreshTimer();
            setLibp2pMeshRuntime(undefined);
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
        plugin: channel,
    });
    // 3. Register Agent Tools
    const tools = buildP2PTools(mesh, router, { peerLabelStore });
    for (const tool of tools) {
        api.registerTool(tool);
    }
    // 4. Register Hook (log received messages for observability)
    api.registerHook("message:received", async (event) => {
        const ctx = event.context;
        api.logger.debug?.(`[libp2p-mesh] message received on channel ${ctx?.channelId ?? "unknown"}`);
    }, { name: "libp2p-mesh-message-received" });
}
//# sourceMappingURL=plugin.js.map