import type { AnnounceLogDetail, InboundTargetConfig, MeshConfig } from "./types.js";
export declare const LIBP2P_MESH_PLUGIN_ID = "libp2p-mesh";
export declare const DEFAULT_DELIVERY_ACK_TIMEOUT_MS = 15000;
export type SetupMode = "lan" | "cross-network" | "relay-node" | "tools-only";
export type OpenClawConfigLike = {
    plugins?: {
        entries?: Record<string, {
            enabled?: boolean;
            config?: Record<string, unknown>;
        }>;
    };
    channels?: Record<string, {
        enabled?: boolean;
    } | Record<string, unknown>>;
};
export type CrossNetworkOptions = {
    bootstrapList: string[];
    relayList?: string[];
};
export type RelayNodeOptions = {
    listenAddrs: string[];
    announceAddrs: string[];
};
export type AddInboundTargetResult = {
    ok: true;
    targets: InboundTargetConfig[];
    added: InboundTargetConfig;
} | {
    ok: false;
    targets: InboundTargetConfig[];
    error: string;
};
export type LegacyInboundMigrationMode = "convert" | "keep" | "replace";
export type InboundTargetSyncPlan = {
    targets: InboundTargetConfig[];
    missingChannels: string[];
};
export declare function getLibp2pMeshConfig(config: OpenClawConfigLike): MeshConfig | undefined;
export declare function getAnnounceLogDetail(config: OpenClawConfigLike): AnnounceLogDetail;
export declare function normalizeAnnounceLogDetail(value: unknown): AnnounceLogDetail;
export declare function buildNetworkConfig(mode: SetupMode, options?: {
    crossNetwork?: CrossNetworkOptions;
    relayNode?: RelayNodeOptions;
}): MeshConfig;
export declare function applyDefaultMeshConfig(config: MeshConfig | undefined): MeshConfig;
export declare function applyPluginConfig(config: OpenClawConfigLike, pluginConfig: MeshConfig): OpenClawConfigLike;
export declare function applyAnnounceLogDetail(config: OpenClawConfigLike, announceLogDetail: AnnounceLogDetail): OpenClawConfigLike;
export declare function mergeNetworkConfig(existing: MeshConfig | undefined, networkConfig: MeshConfig): MeshConfig;
export declare function listConfiguredChannels(config: OpenClawConfigLike): string[];
export declare function planInboundTargetSync(existingTargets: InboundTargetConfig[], configuredChannels: string[]): InboundTargetSyncPlan;
export declare function generateInboundTargetId(channel: string, existingTargets: InboundTargetConfig[]): string;
export declare function addInboundTarget(existingTargets: InboundTargetConfig[], target: {
    channel: string;
    target: string;
}): AddInboundTargetResult;
export declare function removeInboundTarget(existingTargets: InboundTargetConfig[], id: string): InboundTargetConfig[];
export declare function setInboundTargets(existing: MeshConfig | undefined, targets: InboundTargetConfig[] | undefined): MeshConfig;
export declare function disableInboundDelivery(existing: MeshConfig | undefined): MeshConfig;
export declare function migrateLegacyInboundConfig(existing: MeshConfig, mode: LegacyInboundMigrationMode, replacementTargets?: InboundTargetConfig[]): MeshConfig;
