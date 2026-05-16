import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { registerLibp2pMesh } from "./src/plugin.js";

function createLibp2pMeshConfigSchema(): OpenClawPluginConfigSchema {
  return {
    safeParse(value: unknown) {
      if (value === undefined) {
        return { success: true, data: undefined };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {
          success: false,
          error: { issues: [{ path: [], message: "expected config object" }] },
        };
      }
      return { success: true, data: value };
    },
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        listenAddrs: {
          type: "array",
          items: { type: "string" },
          default: ["/ip4/0.0.0.0/tcp/0"],
        },
        enableWebSocket: {
          type: "boolean",
          default: false,
          description: "Enable WebSocket transport (useful for browser compatibility)",
        },
        discovery: {
          type: "string",
          enum: ["mdns", "bootstrap", "dht"],
          default: "mdns",
        },
        bootstrapList: {
          type: "array",
          items: { type: "string" },
          description: "List of bootstrap multiaddrs for WAN discovery (required when discovery=dht or bootstrap)",
        },
        meshTopic: {
          type: "string",
          default: "openclaw-mesh",
        },
        enablePubsub: {
          type: "boolean",
          default: true,
        },
        enableAgentSync: {
          type: "boolean",
          default: true,
        },
        enableDHT: {
          type: "boolean",
          default: true,
          description: "Enable DHT for WAN peer discovery and pubkey registry. Default true when discovery=dht, can be explicitly disabled.",
        },
        instanceName: {
          type: "string",
          description: "Custom name for this OpenClaw instance (used in InstanceID). Defaults to \"<username>-<hostname>\".",
        },
      },
    },
  };
}

export default definePluginEntry({
  id: "libp2p-mesh",
  name: "libp2p Mesh Network",
  description: "P2P network for cross-instance agent communication via libp2p.",
  configSchema: createLibp2pMeshConfigSchema(),
  register: registerLibp2pMesh,
});
