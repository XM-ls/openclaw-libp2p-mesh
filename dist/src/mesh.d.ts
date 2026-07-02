import type { MeshConfig, MeshNetwork } from "./types.js";
export declare function planPeerDiscovery(config: MeshConfig): {
    useMDNS: boolean;
    bootstrapList: string[];
    enableDHT: boolean;
};
export declare function createMeshNetwork(options: {
    config?: MeshConfig;
    logger?: {
        info?: (msg: string) => void;
        debug?: (msg: string) => void;
        warn?: (msg: string) => void;
        error?: (msg: string) => void;
    };
}): MeshNetwork;
