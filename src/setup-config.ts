import type { AnnounceLogDetail, InboundTargetConfig, MeshConfig } from "./types.js";

export const LIBP2P_MESH_PLUGIN_ID = "libp2p-mesh";
export const DEFAULT_DELIVERY_ACK_TIMEOUT_MS = 15000;

export type SetupMode = "lan" | "cross-network" | "relay-node";

export type OpenClawConfigLike = {
  plugins?: {
    entries?: Record<
      string,
      {
        enabled?: boolean;
        config?: Record<string, unknown>;
      }
    >;
  };
  channels?: Record<string, { enabled?: boolean } | Record<string, unknown>>;
};

export type CrossNetworkOptions = {
  bootstrapList: string[];
  relayList?: string[];
};

export type RelayNodeOptions = {
  listenAddrs: string[];
  announceAddrs: string[];
};

export type AddInboundTargetResult =
  | { ok: true; targets: InboundTargetConfig[]; added: InboundTargetConfig }
  | { ok: false; targets: InboundTargetConfig[]; error: string };

export type LegacyInboundMigrationMode = "convert" | "keep" | "replace";

export type InboundTargetSyncPlan = {
  targets: InboundTargetConfig[];
  missingChannels: string[];
};

export function getLibp2pMeshConfig(config: OpenClawConfigLike): MeshConfig | undefined {
  return config.plugins?.entries?.[LIBP2P_MESH_PLUGIN_ID]?.config as MeshConfig | undefined;
}

export function getAnnounceLogDetail(config: OpenClawConfigLike): AnnounceLogDetail {
  return normalizeAnnounceLogDetail(getLibp2pMeshConfig(config)?.announceLogDetail);
}

export function normalizeAnnounceLogDetail(value: unknown): AnnounceLogDetail {
  return value === "off" || value === "payload" || value === "summary" ? value : "summary";
}

export function buildNetworkConfig(
  mode: SetupMode,
  options?: {
    crossNetwork?: CrossNetworkOptions;
    relayNode?: RelayNodeOptions;
  },
): MeshConfig {
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

export function applyDefaultMeshConfig(config: MeshConfig | undefined): MeshConfig {
  const base =
    config && typeof config === "object" && !Array.isArray(config)
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

export function applyPluginConfig(config: OpenClawConfigLike, pluginConfig: MeshConfig): OpenClawConfigLike {
  return {
    ...config,
    plugins: {
      ...config.plugins,
      entries: {
        ...config.plugins?.entries,
        [LIBP2P_MESH_PLUGIN_ID]: {
          ...config.plugins?.entries?.[LIBP2P_MESH_PLUGIN_ID],
          enabled: true,
          config: pluginConfig as Record<string, unknown>,
        },
      },
    },
  };
}

export function applyAnnounceLogDetail(
  config: OpenClawConfigLike,
  announceLogDetail: AnnounceLogDetail,
): OpenClawConfigLike {
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

export function mergeNetworkConfig(existing: MeshConfig | undefined, networkConfig: MeshConfig): MeshConfig {
  if (!existing) {
    return { ...networkConfig };
  }

  const {
    discovery: _discovery,
    bootstrapList: _bootstrapList,
    relayList: _relayList,
    listenAddrs: _listenAddrs,
    announceAddrs: _announceAddrs,
    enableNATTraversal: _enableNATTraversal,
    enableCircuitRelayServer: _enableCircuitRelayServer,
    ...preserved
  } = existing;

  return {
    ...preserved,
    ...networkConfig,
  };
}

export function listConfiguredChannels(config: OpenClawConfigLike): string[] {
  return Object.keys(config.channels ?? {}).filter((channel) => channel !== LIBP2P_MESH_PLUGIN_ID);
}

export function planInboundTargetSync(
  existingTargets: InboundTargetConfig[],
  configuredChannels: string[],
): InboundTargetSyncPlan {
  const targets: InboundTargetConfig[] = [];
  const missingChannels: string[] = [];
  const seenTargetKeys = new Set<string>();
  const coveredChannels = new Set<string>();

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

export function generateInboundTargetId(channel: string, existingTargets: InboundTargetConfig[]): string {
  const channelTargets = existingTargets.filter((target) => target.channel === channel);
  if (channelTargets.length === 0) {
    return `${channel}-main`;
  }

  const usedIds = new Set(channelTargets.map((target) => target.id).filter((id): id is string => Boolean(id)));
  let index = channelTargets.length + 1;
  let candidate = `${channel}-${index}`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `${channel}-${index}`;
  }
  return candidate;
}

export function addInboundTarget(
  existingTargets: InboundTargetConfig[],
  target: { channel: string; target: string },
): AddInboundTargetResult {
  const targets = existingTargets.map((existingTarget) => ({ ...existingTarget }));
  const duplicate = targets.some(
    (existingTarget) => existingTarget.channel === target.channel && existingTarget.target === target.target,
  );

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

export function removeInboundTarget(existingTargets: InboundTargetConfig[], id: string): InboundTargetConfig[] {
  return existingTargets.filter((target) => target.id !== id).map((target) => ({ ...target }));
}

export function setInboundTargets(
  existing: MeshConfig | undefined,
  targets: InboundTargetConfig[] | undefined,
): MeshConfig {
  const { inboundTargets: _inboundTargets, ...withoutInboundTargets } = existing ?? {};
  if (targets === undefined) {
    return withoutInboundTargets;
  }

  const { inboundChannel: _inboundChannel, inboundTarget: _inboundTarget, ...withoutLegacyFields } =
    withoutInboundTargets;

  return {
    ...withoutLegacyFields,
    inboundTargets: targets.map((target) => ({ ...target })),
  };
}

export function disableInboundDelivery(existing: MeshConfig | undefined): MeshConfig {
  return setInboundTargets(existing, []);
}

export function migrateLegacyInboundConfig(
  existing: MeshConfig,
  mode: LegacyInboundMigrationMode,
  replacementTargets?: InboundTargetConfig[],
): MeshConfig {
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
