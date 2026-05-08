import type { MeshConfig } from "./types.js";

export function resolveDiscoveryConfig(config?: MeshConfig): {
  enabled: boolean;
  mechanism: "mdns" | "bootstrap" | "dht";
  bootstrapList: string[];
} {
  return {
    enabled: true,
    mechanism: config?.discovery ?? "mdns",
    bootstrapList: config?.bootstrapList ?? [],
  };
}
