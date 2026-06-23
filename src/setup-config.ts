import type { MeshConfig } from "./types.js";

export const LIBP2P_MESH_PLUGIN_ID = "libp2p-mesh";
export const DEFAULT_DELIVERY_ACK_TIMEOUT_MS = 15000;

export type SetupMode = "lan" | "cross-network" | "relay-node" | "tools-only";

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

export function getLibp2pMeshConfig(config: OpenClawConfigLike): MeshConfig | undefined {
  return config.plugins?.entries?.[LIBP2P_MESH_PLUGIN_ID]?.config as MeshConfig | undefined;
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

    case "tools-only":
      return {
        discovery: "mdns",
        inboundTargets: [],
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
