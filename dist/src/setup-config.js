export const LIBP2P_MESH_PLUGIN_ID = "libp2p-mesh";
export const DEFAULT_DELIVERY_ACK_TIMEOUT_MS = 15000;
export function getLibp2pMeshConfig(config) {
    return config.plugins?.entries?.[LIBP2P_MESH_PLUGIN_ID]?.config;
}
export function getAnnounceLogDetail(config) {
    return normalizeAnnounceLogDetail(getLibp2pMeshConfig(config)?.announceLogDetail);
}
export function normalizeAnnounceLogDetail(value) {
    return value === "off" || value === "payload" || value === "summary" ? value : "summary";
}
export function buildNetworkConfig(mode, options) {
    switch (mode) {
        case "lan":
            return {
                discovery: "mdns",
                deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
            };
        case "cross-network": {
            const relayList = options?.crossNetwork?.relayList;
            return {
                discovery: "bootstrap",
                bootstrapList: [...(options?.crossNetwork?.bootstrapList ?? [])],
                ...(relayList && relayList.length > 0 ? { relayList: [...relayList] } : {}),
                enableNATTraversal: true,
                deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
            };
        }
        case "relay-node":
            return {
                discovery: "bootstrap",
                listenAddrs: [...(options?.relayNode?.listenAddrs ?? [])],
                announceAddrs: [...(options?.relayNode?.announceAddrs ?? [])],
                enableNATTraversal: true,
                enableCircuitRelayServer: true,
                deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
            };
    }
}
export function applyDefaultMeshConfig(config) {
    const base = config && typeof config === "object" && !Array.isArray(config)
        ? config
        : undefined;
    return {
        discovery: "mdns",
        enableNATTraversal: true,
        enableDHT: true,
        deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
        ...(base ?? {}),
    };
}
export function applyPluginConfig(config, pluginConfig) {
    return {
        ...config,
        plugins: {
            ...config.plugins,
            entries: {
                ...config.plugins?.entries,
                [LIBP2P_MESH_PLUGIN_ID]: {
                    ...config.plugins?.entries?.[LIBP2P_MESH_PLUGIN_ID],
                    enabled: true,
                    config: pluginConfig,
                },
            },
        },
    };
}
export function applyAnnounceLogDetail(config, announceLogDetail) {
    const existingEntry = config.plugins?.entries?.[LIBP2P_MESH_PLUGIN_ID];
    const existingPluginConfig = existingEntry?.config ?? {};
    return {
        ...config,
        plugins: {
            ...config.plugins,
            entries: {
                ...config.plugins?.entries,
                [LIBP2P_MESH_PLUGIN_ID]: {
                    ...existingEntry,
                    enabled: existingEntry?.enabled ?? true,
                    config: {
                        ...existingPluginConfig,
                        announceLogDetail,
                    },
                },
            },
        },
    };
}
export function mergeNetworkConfig(existing, networkConfig) {
    if (!existing) {
        return { ...networkConfig };
    }
    const { discovery: _discovery, bootstrapList: _bootstrapList, relayList: _relayList, listenAddrs: _listenAddrs, announceAddrs: _announceAddrs, enableNATTraversal: _enableNATTraversal, enableCircuitRelayServer: _enableCircuitRelayServer, ...preserved } = existing;
    return {
        ...preserved,
        ...networkConfig,
    };
}
export function listConfiguredChannels(config) {
    return Object.keys(config.channels ?? {}).filter((channel) => channel !== LIBP2P_MESH_PLUGIN_ID);
}
export function planInboundTargetSync(existingTargets, configuredChannels) {
    const targets = [];
    const missingChannels = [];
    const seenTargetKeys = new Set();
    const coveredChannels = new Set();
    for (const target of existingTargets) {
        const channel = typeof target.channel === "string" ? target.channel.trim() : "";
        const inboundTarget = typeof target.target === "string" ? target.target.trim() : "";
        const targetKey = `${channel}\u0000${inboundTarget}`;
        if (!channel || !inboundTarget || seenTargetKeys.has(targetKey)) {
            continue;
        }
        seenTargetKeys.add(targetKey);
        coveredChannels.add(channel);
        targets.push({
            ...target,
            channel,
            target: inboundTarget,
        });
    }
    for (const configuredChannel of configuredChannels) {
        const channel = typeof configuredChannel === "string" ? configuredChannel.trim() : "";
        if (!channel || channel === LIBP2P_MESH_PLUGIN_ID || coveredChannels.has(channel)) {
            continue;
        }
        coveredChannels.add(channel);
        missingChannels.push(channel);
    }
    return { targets, missingChannels };
}
export function generateInboundTargetId(channel, existingTargets) {
    const channelTargets = existingTargets.filter((target) => target.channel === channel);
    if (channelTargets.length === 0) {
        return `${channel}-main`;
    }
    const usedIds = new Set(channelTargets.map((target) => target.id).filter((id) => Boolean(id)));
    let index = channelTargets.length + 1;
    let candidate = `${channel}-${index}`;
    while (usedIds.has(candidate)) {
        index += 1;
        candidate = `${channel}-${index}`;
    }
    return candidate;
}
export function addInboundTarget(existingTargets, target) {
    const targets = existingTargets.map((existingTarget) => ({ ...existingTarget }));
    const duplicate = targets.some((existingTarget) => existingTarget.channel === target.channel && existingTarget.target === target.target);
    if (duplicate) {
        return {
            ok: false,
            targets,
            error: `inbound target already exists: ${target.channel} / ${target.target}`,
        };
    }
    const added = {
        id: generateInboundTargetId(target.channel, targets),
        channel: target.channel,
        target: target.target,
    };
    return {
        ok: true,
        targets: [...targets, added],
        added,
    };
}
export function removeInboundTarget(existingTargets, id) {
    return existingTargets.filter((target) => target.id !== id).map((target) => ({ ...target }));
}
export function setInboundTargets(existing, targets) {
    const { inboundTargets: _inboundTargets, ...withoutInboundTargets } = existing ?? {};
    if (targets === undefined) {
        return withoutInboundTargets;
    }
    const { inboundChannel: _inboundChannel, inboundTarget: _inboundTarget, ...withoutLegacyFields } = withoutInboundTargets;
    return {
        ...withoutLegacyFields,
        inboundTargets: targets.map((target) => ({ ...target })),
    };
}
export function disableInboundDelivery(existing) {
    return setInboundTargets(existing, []);
}
export function migrateLegacyInboundConfig(existing, mode, replacementTargets) {
    if (mode === "keep") {
        return { ...existing };
    }
    const { inboundChannel, inboundTarget, ...withoutLegacyFields } = existing;
    if (mode === "replace") {
        return setInboundTargets(withoutLegacyFields, replacementTargets ?? []);
    }
    if (!inboundChannel || !inboundTarget) {
        return withoutLegacyFields;
    }
    return setInboundTargets(withoutLegacyFields, [
        {
            id: generateInboundTargetId(inboundChannel, []),
            channel: inboundChannel,
            target: inboundTarget,
        },
    ]);
}
//# sourceMappingURL=setup-config.js.map