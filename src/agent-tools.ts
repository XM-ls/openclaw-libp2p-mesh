import type {
  DeliveryTargetResult,
  InstancePeerRecord,
  InstanceRouter,
  LocalPeerLabelAttribute,
  MeshNetwork,
  PeerLabelStore,
  UserAttributeMatch,
  UserAttributeMatchScope,
  UserAttributeMessageDeliveryResult,
  UserAttributeMessageTarget,
  UserPublicAttribute,
} from "./types.js";

function targetLabel(result: DeliveryTargetResult) {
  const name = result.id ?? `${result.channel}:${result.target}`;
  return `${name} (${result.channel} / ${result.target})`;
}

function formatDeliveryResults(
  instanceId: string,
  delivered: boolean,
  results: DeliveryTargetResult[],
) {
  const heading = delivered
    ? `发往 ${instanceId} 的消息投递结果`
    : `发往 ${instanceId} 的消息投递失败`;
  const lines = results.map((result) => {
    const status = result.ok ? "已送达" : `失败：${result.error ?? "unknown error"}`;
    return `${targetLabel(result)}：${status}`;
  });
  return [heading, ...lines].join("\n");
}

function attributeLabel(attribute: UserPublicAttribute | LocalPeerLabelAttribute): string {
  if (attribute.kind === "tag") {
    return `tag:${attribute.value}`;
  }

  return `${attribute.key}:${attribute.value}`;
}

function instanceTargetLabel(target: Pick<UserAttributeMessageTarget, "instanceId" | "instanceName" | "peerId">) {
  const name = target.instanceName ? ` (${target.instanceName})` : "";
  return `${target.instanceId}${name} -> ${target.peerId}`;
}

function formatUserAttributeTargets(targets: UserAttributeMessageTarget[]) {
  return targets.map((target) => `${instanceTargetLabel(target)} [${target.matchSource}:${attributeLabel(target.matchedAttribute)}]`);
}

function formatUserAttributeResults(results: UserAttributeMessageDeliveryResult[]) {
  return results.map((result) => {
    let status = "已送达";
    if (!result.sent) {
      status = `发送失败：${result.error ?? "unknown error"}`;
    } else if (!result.delivered) {
      status = `投递失败：${result.error ?? "unknown error"}`;
    }

    return `${instanceTargetLabel(result)}：${status}`;
  });
}

type ListInstanceRow = InstancePeerRecord & {
  connected: boolean;
  localLabels: LocalPeerLabelAttribute[];
};

type BuildP2PToolsOptions = {
  peerLabelStore?: Pick<PeerLabelStore, "listLabels">;
};

function formatPublicAttribute(attribute: UserPublicAttribute): string[] {
  if (attribute.kind === "tag") {
    return [
      "     - kind: tag",
      `       value: ${attribute.value}`,
      `       label: ${attribute.label}`,
      `       source: ${attribute.source}`,
    ];
  }

  return [
    "     - kind: structured",
    `       key: ${attribute.key}`,
    `       value: ${attribute.value}`,
    `       label: ${attribute.label}`,
    `       source: ${attribute.source}`,
  ];
}

function formatLocalLabel(label: LocalPeerLabelAttribute): string[] {
  return [
    "     - kind: structured",
    `       key: ${label.key}`,
    `       value: ${label.value}`,
    `       label: ${label.label}`,
    `       source: ${label.source}`,
  ];
}

function formatInstanceList(rows: ListInstanceRow[]): string {
  if (rows.length === 0) {
    return "No OpenClaw instances discovered yet.";
  }

  const lines = [`Discovered OpenClaw instances: ${rows.length}`];

  rows.forEach((entry, index) => {
    lines.push(
      "",
      `${index + 1}. ${entry.instanceId}`,
      `   peerId: ${entry.peerId}`,
      `   instanceName: ${entry.instanceName ?? "(none)"}`,
      `   connected: ${entry.connected}`,
    );

    if ((entry.userPublicAttributes ?? []).length === 0) {
      lines.push("   userPublicAttributes: none");
    } else {
      lines.push("   userPublicAttributes:");
      for (const attribute of entry.userPublicAttributes ?? []) {
        lines.push(...formatPublicAttribute(attribute));
      }
    }

    if (entry.localLabels.length === 0) {
      lines.push("   localLabels: none (local private labels; not broadcast)");
    } else {
      lines.push("   localLabels (local private labels; not broadcast):");
      for (const label of entry.localLabels) {
        lines.push(...formatLocalLabel(label));
      }
    }
  });

  return lines.join("\n");
}

type SendUserAttributeToolParams = {
  selector?: unknown;
  match?: {
    kind?: unknown;
    key?: unknown;
    value?: unknown;
  };
  message?: unknown;
  dryRun?: unknown;
  scope?: unknown;
};

function normalizeUserAttributeScope(scope: unknown): UserAttributeMatchScope | undefined {
  if (scope === undefined) {
    return undefined;
  }

  if (scope === "public" || scope === "local" || scope === "all") {
    return scope;
  }

  return undefined;
}

function validateUserAttributeScope(scope: unknown): string | undefined {
  if (
    scope === undefined ||
    scope === "public" ||
    scope === "local" ||
    scope === "all"
  ) {
    return undefined;
  }

  return 'scope must be "public", "local", or "all".';
}

function normalizeUserAttributeSelector(selector: unknown): UserAttributeMatch | string {
  const value = typeof selector === "string" ? selector.trim() : "";
  if (!value) {
    return "selector is required.";
  }

  if (value.startsWith("#")) {
    const tagValue = value.slice(1).trim();
    return tagValue ? { kind: "tag", value: tagValue } : "selector tag value is required.";
  }

  const tagMatch = /^tag\s*:\s*(.+)$/i.exec(value);
  if (tagMatch) {
    const tagValue = tagMatch[1].trim();
    return tagValue ? { kind: "tag", value: tagValue } : "selector tag value is required.";
  }

  const structuredMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/.exec(value);
  if (structuredMatch) {
    const key = structuredMatch[1].trim();
    const attributeValue = structuredMatch[2].trim();
    return key && attributeValue
      ? { kind: "structured", key, value: attributeValue }
      : "selector key and value are required.";
  }

  return `selector "${value}" is ambiguous. Use "group=${value}" for structured group matching or "tag:${value}" for USER.md tags.`;
}

function normalizeUserAttributeMatch(params: SendUserAttributeToolParams): UserAttributeMatch | string {
  if (params.selector !== undefined) {
    return normalizeUserAttributeSelector(params.selector);
  }

  const match = params.match;
  if (!match || typeof match !== "object") {
    return "selector is required.";
  }

  if (match.kind === "tag") {
    const value = typeof match.value === "string" ? match.value.trim() : "";
    return value ? { kind: "tag", value } : "match.value is required for tag matches.";
  }

  if (match.kind === "structured") {
    const key = typeof match.key === "string" ? match.key.trim() : "";
    const value = typeof match.value === "string" ? match.value.trim() : "";
    return key && value
      ? { kind: "structured", key, value }
      : "match.key and match.value are required for structured matches.";
  }

  return 'match.kind must be "tag" or "structured".';
}

export function buildP2PTools(
  mesh: MeshNetwork,
  router?: InstanceRouter,
  options: BuildP2PToolsOptions = {},
) {
  return [
    {
      name: "p2p_send_message",
      label: "P2P Send Message",
      description: "Send a direct message to another agent via the P2P mesh network.",
      parameters: {
        type: "object" as const,
        properties: {
          peerId: {
            type: "string" as const,
            description: "Target peer ID (libp2p Peer ID string)",
          },
          message: {
            type: "string" as const,
            description: "Message content to send",
          },
        },
        required: ["peerId", "message"],
      },
      async execute(_toolCallId: string, params: { peerId: string; message: string }) {
        try {
          await mesh.sendToPeer(params.peerId, params.message);
          return {
            content: [{ type: "text" as const, text: `Message sent to ${params.peerId}` }],
            details: { sent: true, peerId: params.peerId },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to send message to ${params.peerId}: ${String(err)}`,
              },
            ],
            details: { sent: false, peerId: params.peerId, error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_broadcast",
      label: "P2P Broadcast",
      description: "Broadcast a message to all peers on a topic via the P2P mesh network.",
      parameters: {
        type: "object" as const,
        properties: {
          topic: {
            type: "string" as const,
            description: "Topic name to broadcast on",
          },
          message: {
            type: "string" as const,
            description: "Message content to broadcast",
          },
        },
        required: ["topic", "message"],
      },
      async execute(_toolCallId: string, params: { topic: string; message: string }) {
        try {
          await mesh.publishToTopic(params.topic, params.message);
          return {
            content: [{ type: "text" as const, text: `Broadcast sent to topic ${params.topic}` }],
            details: { broadcast: true, topic: params.topic },
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to broadcast to topic ${params.topic}: ${String(err)}`,
              },
            ],
            details: { broadcast: false, topic: params.topic, error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_list_peers",
      label: "P2P List Peers",
      description: "List currently connected peers in the P2P mesh network.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(_toolCallId: string) {
        try {
          const peers = mesh.getConnectedPeers();
          const text =
            peers.length === 0
              ? "No peers currently connected."
              : `Connected peers (${peers.length}): ${peers.join(", ")}`;
          return {
            content: [{ type: "text" as const, text }],
            details: {
              localPeerId: mesh.getLocalPeerId(),
              connectedPeers: peers,
              count: peers.length,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Failed to list peers: ${String(err)}` }],
            details: { error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_get_instance_identity",
      label: "P2P Get Instance Identity",
      description: "Get the OpenClaw instance identity (lightweight BAID-inspired ID) of this node.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(_toolCallId: string) {
        try {
          const identity = mesh.getInstanceIdentity();
          if (!identity) {
            return {
              content: [{ type: "text" as const, text: "Instance identity not yet initialized." }],
              details: { initialized: false },
            };
          }
          const lines = [
            `Instance ID: ${identity.id}`,
            `Name:        ${identity.name}`,
            `Pubkey:      ${identity.pubkey.slice(0, 32)}...`,
            `Binding:     ${identity.binding.slice(0, 16)}...`,
            `Bound to:    ${identity.bindingComponents.username}@${identity.bindingComponents.hostname} (${identity.bindingComponents.platform})`,
            `Created:     ${new Date(identity.createdAt).toLocaleString()}`,
          ];
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: { identity },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
            details: { error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_get_network_info",
      label: "P2P Get Network Info",
      description: "Get combined network and identity info: Peer ID, Instance ID, listen addresses, and connected peers.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(_toolCallId: string) {
        try {
          const identity = mesh.getInstanceIdentity();
          const peerId = mesh.getLocalPeerId();
          const addrs = mesh.getMultiaddrs();
          const peers = mesh.getConnectedPeers();

          const lines = [
            `Peer ID:      ${peerId || "(not started)"}`,
            `Instance ID:  ${identity?.id || "(not initialized)"}`,
            `Instance:     ${identity?.bindingComponents.username}@${identity?.bindingComponents.hostname}` || "",
            `Listen Addrs: ${addrs.length > 0 ? addrs.join(", ") : "(none)"}`,
            `Connected:    ${peers.length} peer(s)${peers.length > 0 ? ": " + peers.join(", ") : ""}`,
          ];

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: {
              peerId,
              instanceId: identity?.id,
              listenAddrs: addrs,
              connectedPeers: peers,
            },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
            details: { error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_list_instances",
      label: "P2P List Instances",
      description: "List OpenClaw instances discovered through the P2P mesh instance routing table.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(_toolCallId: string) {
        if (!router) {
          return {
            content: [{ type: "text" as const, text: "Instance router is not initialized." }],
            details: { initialized: false },
            isError: true,
          };
        }
        try {
          const instances = await router.listInstances();
          const connected = new Set(mesh.getConnectedPeers());
          const rows = await Promise.all(
            instances.map(async (entry): Promise<ListInstanceRow> => {
              const localLabels =
                entry.localLabels !== undefined
                  ? entry.localLabels
                  : options.peerLabelStore
                    ? await options.peerLabelStore.listLabels(entry.instanceId)
                    : [];

              return {
                ...entry,
                userPublicAttributes: entry.userPublicAttributes ?? [],
                connected: connected.has(entry.peerId),
                localLabels,
              };
            }),
          );
          const text = formatInstanceList(rows);
          return {
            content: [{ type: "text" as const, text }],
            details: { instances: rows, count: rows.length },
          };
        } catch (err) {
          return {
            content: [
              { type: "text" as const, text: `Failed to list instances: ${String(err)}` },
            ],
            details: { error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_resolve_instance",
      label: "P2P Resolve Instance",
      description: "Resolve an OpenClaw instance ID to the current libp2p Peer ID route.",
      parameters: {
        type: "object" as const,
        properties: {
          instanceId: {
            type: "string" as const,
            description: "Target OpenClaw instance ID",
          },
        },
        required: ["instanceId"],
      },
      async execute(_toolCallId: string, params: { instanceId: string }) {
        if (!router) {
          return {
            content: [{ type: "text" as const, text: "Instance router is not initialized." }],
            details: { initialized: false },
            isError: true,
          };
        }
        const instanceId = params.instanceId?.trim();
        if (!instanceId) {
          return {
            content: [{ type: "text" as const, text: "instanceId is required." }],
            details: { error: "instanceId is required" },
            isError: true,
          };
        }
        const route = await router.resolveInstance(instanceId);
        if (!route) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Instance ${instanceId} has not been discovered. Ask the user to confirm the remote gateway is running and connected to the same P2P network.`,
              },
            ],
            details: { instanceId, found: false },
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `${route.instanceId} -> ${route.peerId}` }],
          details: { found: true, route },
        };
      },
    },
    {
      name: "p2p_send_instance_message",
      label: "P2P Send Instance Message",
      description: "Send a user message to another OpenClaw instance by instance ID and wait for remote channel delivery ACK.",
      parameters: {
        type: "object" as const,
        properties: {
          instanceId: {
            type: "string" as const,
            description: "Target OpenClaw instance ID",
          },
          message: {
            type: "string" as const,
            description: "Message content to send",
          },
        },
        required: ["instanceId", "message"],
      },
      async execute(_toolCallId: string, params: { instanceId: string; message: string }) {
        if (!router) {
          return {
            content: [{ type: "text" as const, text: "Instance router is not initialized." }],
            details: { initialized: false },
            isError: true,
          };
        }
        const instanceId = params.instanceId?.trim();
        const message = params.message?.trim();
        if (!instanceId || !message) {
          return {
            content: [{ type: "text" as const, text: "instanceId and message are required." }],
            details: { error: "instanceId and message are required" },
            isError: true,
          };
        }
        const result = await router.sendInstanceMessage(instanceId, message);
        if (result.deliveryResults && result.deliveryResults.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatDeliveryResults(instanceId, result.delivered, result.deliveryResults),
              },
            ],
            details: result,
            isError: result.delivered ? undefined : true,
          };
        }
        if (!result.delivered) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to deliver message to ${instanceId}: ${result.error ?? "unknown error"}`,
              },
            ],
            details: result,
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Message delivered to ${instanceId} via ${result.inboundChannel ?? "remote inbound channel"}.`,
            },
          ],
          details: result,
        };
      },
    },
    {
      name: "p2p_send_user_attribute_message",
      label: "P2P Send User Attribute Message",
      description:
        'Send a user message to discovered OpenClaw instances matching an attribute selector. scope controls the source: "public" for announced user attributes, "local" for local peer labels, or "all" for both; defaults to public. Use selectors like "group=实验室", "project=小龙虾", "tag:P2P", or "#P2P". First run a dry run with dryRun=true to preview targets; if targets match, call again immediately with dryRun=false and the same selector, scope, and message.',
      parameters: {
        type: "object" as const,
        properties: {
          selector: {
            type: "string" as const,
            description:
              'Public attribute selector. Use "key=value" for structured profile attributes such as "group=实验室" or "project=小龙虾"; use "tag:value" or "#value" for USER.md tags. Bare values are rejected as ambiguous.',
          },
          match: {
            type: "object" as const,
            deprecated: true,
            description:
              'Deprecated compatibility field. Prefer selector. Use { "kind": "tag", "value": "..." } for USER.md tags or { "kind": "structured", "key": "...", "value": "..." } for profile attributes.',
            oneOf: [
              {
                type: "object" as const,
                additionalProperties: false,
                properties: {
                  kind: { const: "tag" as const },
                  value: {
                    type: "string" as const,
                    description: "Tag value to match.",
                  },
                },
                required: ["kind", "value"],
              },
              {
                type: "object" as const,
                additionalProperties: false,
                properties: {
                  kind: { const: "structured" as const },
                  key: {
                    type: "string" as const,
                    description: "Structured attribute key to match.",
                  },
                  value: {
                    type: "string" as const,
                    description: "Structured attribute value to match.",
                  },
                },
                required: ["kind", "key", "value"],
              },
            ],
          },
          message: {
            type: "string" as const,
            description: "Message content to send after a matching dry run.",
          },
          dryRun: {
            type: "boolean" as const,
            description: "Preview matching instances without sending. Run this before group sending.",
          },
          scope: {
            type: "string" as const,
            enum: ["public", "local", "all"],
            description:
              "Attribute source to match: public announced attributes, local peer labels, or both. Defaults to public.",
          },
        },
        required: ["message"],
        anyOf: [{ required: ["selector"] }, { required: ["match"] }],
      },
      async execute(_toolCallId: string, params: SendUserAttributeToolParams) {
        if (!router) {
          return {
            content: [{ type: "text" as const, text: "Instance router is not initialized." }],
            details: { initialized: false },
            isError: true,
          };
        }

        const match = normalizeUserAttributeMatch(params);
        const scopeError = validateUserAttributeScope(params.scope);
        const scope = normalizeUserAttributeScope(params.scope);
        const message = typeof params.message === "string" ? params.message.trim() : "";
        if (typeof match === "string" || scopeError || !message) {
          const error =
            typeof match === "string"
              ? match
              : scopeError
                ? scopeError
                : "message is required.";
          return {
            content: [{ type: "text" as const, text: error }],
            details: { error },
            isError: true,
          };
        }

        const dryRun = params.dryRun === true;
        const options = scope ? { dryRun, scope } : { dryRun };
        const result = await router.sendUserAttributeMessage(match, message, options);
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: result.error }],
            details: result,
            isError: true,
          };
        }

        if (dryRun) {
          const targetLines = formatUserAttributeTargets(result.targets ?? []);
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `Dry run matched ${result.matched} instance(s). No message was sent.`,
                  ...targetLines,
                ].join("\n"),
              },
            ],
            details: result,
          };
        }

        const resultLines = formatUserAttributeResults(result.results ?? []);
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Matched ${result.matched} instance(s); sent ${result.sent}; delivered ${result.delivered}; failed ${result.failed}.`,
                ...resultLines,
              ].join("\n"),
            },
          ],
          details: result,
          isError: result.failed > 0 ? true : undefined,
        };
      },
    },
  ];
}
