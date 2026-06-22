import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { registerLibp2pMesh } from "./src/plugin.js";
import { registerLibp2pMeshCli } from "./src/cli.js";

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
        enableNATTraversal: {
          type: "boolean",
          default: true,
          description: "Master switch for the NAT traversal stack (identify + AutoNAT + UPnP + Circuit Relay v2 + DCUtR). Set to false to restore pre-NAT behaviour.",
        },
        enableIdentify: {
          type: "boolean",
          default: true,
          description: "Run the libp2p identify protocol; required by AutoNAT and DCUtR.",
        },
        enableAutoNAT: {
          type: "boolean",
          default: true,
          description: "Use AutoNAT to learn whether this node is publicly reachable.",
        },
        enableUPnP: {
          type: "boolean",
          default: true,
          description: "Attempt UPnP/PMP port mapping against the local gateway so other peers can dial us directly when behind a home router.",
        },
        enableCircuitRelay: {
          type: "boolean",
          default: true,
          description: "Allow this node to dial peers via /p2p-circuit relay addresses and to reserve a slot on the relays in relayList.",
        },
        enableCircuitRelayServer: {
          type: "boolean",
          default: false,
          description: "Act as a Circuit Relay v2 SERVER for other peers. Only enable on a publicly reachable node (e.g. a cloud VM).",
        },
        enableDCUtR: {
          type: "boolean",
          default: true,
          description: "Direct Connection Upgrade through Relay (hole punching). Upgrades a relayed connection to a direct one when possible.",
        },
        relayList: {
          type: "array",
          items: { type: "string" },
          description: "Multiaddrs of relay nodes to reserve a slot on (each entry must end in /p2p/<peer-id>).",
        },
        relayChannel: {
          type: "string",
          deprecated: true,
          description: "Deprecated compatibility field from older libp2p-mesh versions. Use relayList for relay nodes.",
        },
        relayAccountId: {
          type: "string",
          deprecated: true,
          description: "Deprecated compatibility field from older libp2p-mesh versions. This value is ignored.",
        },
        discoverRelays: {
          type: "number",
          default: 0,
          description: "How many relays to auto-discover via content routing. Requires DHT. 0 disables discovery.",
        },
        announceAddrs: {
          type: "array",
          items: { type: "string" },
          description: "Extra multiaddrs to announce to the network (useful when running behind a known port forward where AutoNAT cannot probe).",
        },
        inboundChannel: {
          type: "string",
          description: "OpenClaw channel used to display inbound P2P user messages, for example \"feishu\".",
        },
        inboundTarget: {
          type: "string",
          description: "OpenClaw channel target for inbound P2P user messages, for example user:ou_xxx or chat:oc_xxx.",
        },
        inboundTargets: {
          type: "array",
          description: "OpenClaw channel targets used to display inbound P2P user messages. When present, this overrides inboundChannel/inboundTarget. An empty array disables inbound delivery.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: {
                type: "string",
                description: "Optional local display name used in logs and delivery ACK output.",
              },
              channel: {
                type: "string",
                description: "OpenClaw channel used to display this inbound P2P user message, for example \"feishu\".",
              },
              target: {
                type: "string",
                description: "OpenClaw channel target for this inbound P2P user message, for example user:ou_xxx or chat:oc_xxx.",
              },
            },
            required: ["channel", "target"],
          },
        },
        deliveryAckTimeoutMs: {
          type: "number",
          default: 15000,
          description: "How long p2p_send_instance_message waits for a remote delivery ACK.",
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
  register: (api) => {
    registerLibp2pMesh(api);
    // 5. Register CLI commands (setup wizard + config management)
    api.registerCli(registerLibp2pMeshCli, {
      commands: ["libp2p-mesh"],
    });
  },
});
