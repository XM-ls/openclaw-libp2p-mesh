import type { MeshConfig } from "./types.js";
export declare function resolveDiscoveryConfig(config?: MeshConfig): {
    enabled: boolean;
    mechanism: "mdns" | "bootstrap" | "dht";
    bootstrapList: string[];
};
