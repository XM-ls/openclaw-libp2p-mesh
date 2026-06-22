import type {
  DeliveryAckPayload,
  DeliveryTargetResult,
  InboundDeliveryAdapter,
  InboundTargetConfig,
  InstanceAnnouncePayload,
  InstancePeerStore,
  InstanceRouter,
  MeshConfig,
  MeshNetwork,
  P2PMessage,
  UserMessagePayload,
} from "./types.js";

export type RouterLogger = {
  info?: (message: string) => void;
  debug?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type PendingAck = {
  peerId: string;
  resolve: (payload: DeliveryAckPayload) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DeliveryCacheEntry = {
  peerId: string;
  payload: DeliveryAckPayload;
};

const MAX_DELIVERY_CACHE_ENTRIES = 1000;

function parsePayload<T>(msg: P2PMessage): T | undefined {
  try {
    return JSON.parse(msg.payload) as T;
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type EffectiveInboundTarget = {
  id?: string;
  channel: string;
  target: string;
  valid: boolean;
  error?: string;
};

function displayTargetId(target: { id?: string; channel?: string; target?: string }): string | undefined {
  return target.id?.trim() || undefined;
}

function normalizeConfiguredTarget(target: InboundTargetConfig): EffectiveInboundTarget {
  const channel = typeof target.channel === "string" ? target.channel.trim() : "";
  const destination = typeof target.target === "string" ? target.target.trim() : "";
  const normalized: EffectiveInboundTarget = {
    id: displayTargetId(target),
    channel,
    target: destination,
    valid: Boolean(channel && destination),
  };
  if (!normalized.valid) {
    normalized.error = "inbound target channel and target are required";
  }
  return normalized;
}

function effectiveInboundTargets(config: MeshConfig): EffectiveInboundTarget[] {
  if (Array.isArray(config.inboundTargets)) {
    const seen = new Set<string>();
    const targets: EffectiveInboundTarget[] = [];
    for (const target of config.inboundTargets) {
      const normalized = normalizeConfiguredTarget(target);
      const key = `${normalized.channel}\0${normalized.target}`;
      if (normalized.valid && seen.has(key)) {
        continue;
      }
      if (normalized.valid) {
        seen.add(key);
      }
      targets.push(normalized);
    }
    return targets;
  }

  if (!config.inboundChannel || !config.inboundTarget) {
    return [];
  }
  return [
    {
      channel: config.inboundChannel,
      target: config.inboundTarget,
      valid: true,
    },
  ];
}

function firstAttemptedResult(results: DeliveryTargetResult[]): DeliveryTargetResult | undefined {
  return results.find((result) => result.ok) ?? results[0];
}

export function createInstanceRouter(options: {
  mesh: MeshNetwork;
  store: InstancePeerStore;
  delivery: InboundDeliveryAdapter;
  config?: MeshConfig;
  logger?: RouterLogger;
}): InstanceRouter {
  const { mesh, store, delivery } = options;
  const config = options.config ?? {};
  const logger = options.logger;
  const ackTimeoutMs = config.deliveryAckTimeoutMs ?? 15000;
  const announcedPeers = new Set<string>();
  const pendingAcks = new Map<string, PendingAck>();
  const deliveryCache = new Map<string, DeliveryCacheEntry>();
  const unsubs: Array<() => void> = [];

  function localInstanceId(): string {
    const identity = mesh.getInstanceIdentity();
    if (!identity) {
      throw new Error("Local instance identity is not initialized");
    }
    return identity.id;
  }

  function buildAnnouncePayload(): InstanceAnnouncePayload {
    const identity = mesh.getInstanceIdentity();
    if (!identity) {
      throw new Error("Local instance identity is not initialized");
    }

    return {
      instanceId: identity.id,
      peerId: mesh.getLocalPeerId(),
      instanceName: identity.name,
      multiaddrs: mesh.getMultiaddrs(),
      pubkey: identity.pubkey,
      announcedAt: Date.now(),
    };
  }

  async function announceToPeer(peerId: string): Promise<void> {
    if (!isNonEmptyString(peerId) || peerId === mesh.getLocalPeerId()) {
      return;
    }

    const payload = buildAnnouncePayload();
    await mesh.sendStructuredMessage(peerId, {
      id: crypto.randomUUID(),
      type: "instance-announce",
      to: peerId,
      payload: JSON.stringify(payload),
    });
    announcedPeers.add(peerId);
    logger?.info?.(
      `[libp2p-mesh] Sent instance announce to ${peerId} (${payload.instanceId})`,
    );
  }

  async function announceToConnectedPeers(): Promise<void> {
    for (const peerId of mesh.getConnectedPeers()) {
      await announceToPeer(peerId).catch((error) => {
        logger?.warn?.(
          `[libp2p-mesh] Failed to announce to ${peerId}: ${summarizeError(error)}`,
        );
      });
    }
  }

  async function handleAnnounce(msg: P2PMessage): Promise<void> {
    const payload = parsePayload<InstanceAnnouncePayload>(msg);
    if (
      !payload ||
      !isNonEmptyString(payload.instanceId) ||
      !isNonEmptyString(payload.peerId) ||
      !Array.isArray(payload.multiaddrs) ||
      typeof payload.announcedAt !== "number"
    ) {
      logger?.warn?.(`[libp2p-mesh] Ignoring malformed instance announce from ${msg.from}`);
      return;
    }
    if (msg.instanceId !== payload.instanceId || payload.peerId !== msg.from) {
      logger?.warn?.(
        `[libp2p-mesh] Ignoring instance announce with mismatched envelope from ${msg.from}`,
      );
      return;
    }

    if (payload.instanceId === mesh.getInstanceIdentity()?.id) {
      return;
    }

    const result = await store.upsertFromAnnounce(payload);
    if (result.changed) {
      logger?.info?.(
        `[libp2p-mesh] Instance mapping updated: ${payload.instanceId} -> ${payload.peerId}`,
      );
    } else {
      logger?.debug?.(`[libp2p-mesh] Instance mapping unchanged: ${payload.instanceId}`);
    }

    if (!announcedPeers.has(msg.from)) {
      await announceToPeer(msg.from).catch((error) => {
        logger?.warn?.(
          `[libp2p-mesh] Failed to respond to announce from ${msg.from}: ${summarizeError(error)}`,
        );
      });
    }
  }

  async function sendAck(peerId: string, ack: DeliveryAckPayload): Promise<void> {
    await mesh.sendStructuredMessage(peerId, {
      id: crypto.randomUUID(),
      type: "delivery-ack",
      to: peerId,
      payload: JSON.stringify(ack),
    });
  }

  async function handleUserMessage(msg: P2PMessage): Promise<void> {
    const payload = parsePayload<UserMessagePayload>(msg);
    if (
      !payload ||
      !isNonEmptyString(payload.messageId) ||
      !isNonEmptyString(payload.fromInstanceId) ||
      !isNonEmptyString(payload.toInstanceId) ||
      !isNonEmptyString(payload.text)
    ) {
      logger?.warn?.(`[libp2p-mesh] Ignoring malformed user-message from ${msg.from}`);
      return;
    }
    if (msg.instanceId !== payload.fromInstanceId) {
      logger?.warn?.(
        `[libp2p-mesh] Ignoring user-message with mismatched instance envelope from ${msg.from}`,
      );
      return;
    }
    const senderRoute = await store.resolve(payload.fromInstanceId);
    if (!senderRoute || senderRoute.peerId !== msg.from) {
      logger?.warn?.(
        `[libp2p-mesh] Ignoring user-message from ${msg.from}; instance ${payload.fromInstanceId} is not routed to that peer`,
      );
      return;
    }

    const localId = localInstanceId();
    if (payload.toInstanceId !== localId) {
      logger?.warn?.(
        `[libp2p-mesh] Ignoring user-message for ${payload.toInstanceId}; local instance is ${localId}`,
      );
      return;
    }

    const cached = deliveryCache.get(payload.messageId);
    if (cached) {
      await sendAck(cached.peerId, cached.payload);
      return;
    }

    let ack: DeliveryAckPayload;
    const targets = effectiveInboundTargets(config);
    if (targets.length === 0) {
      ack = {
        ackFor: payload.messageId,
        ok: false,
        inboundChannel: config.inboundChannel,
        inboundTarget: config.inboundTarget,
        deliveredAt: Date.now(),
        error: "inbound delivery is not configured",
        results: [],
      };
    } else {
      const metadata = payload.metadata;
      const results: DeliveryTargetResult[] = [];
      for (const target of targets) {
        if (!target.valid) {
          results.push({
            id: target.id,
            channel: target.channel,
            target: target.target,
            ok: false,
            error: target.error ?? "inbound target channel and target are required",
          });
          continue;
        }

        const result = await delivery.deliver({
          channel: target.channel,
          target: target.target,
          text: payload.text,
          metadata: {
            fromInstanceId: payload.fromInstanceId,
            fromPeerId: msg.from,
            p2pMessageId: payload.messageId,
            allowAgentAutoReply: metadata?.allowAgentAutoReply === true,
            replyToInstanceId: payload.fromInstanceId,
            replyTool: "p2p_send_instance_message",
          },
        });
        results.push({
          id: target.id,
          channel: result.channel,
          target: result.target,
          ok: result.ok,
          error: result.error,
        });
      }

      const selected = firstAttemptedResult(results);
      ack = {
        ackFor: payload.messageId,
        ok: results.some((result) => result.ok),
        inboundChannel: selected?.channel,
        inboundTarget: selected?.target,
        deliveredAt: Date.now(),
        error: results.every((result) => !result.ok)
          ? results.map((result) => result.error).filter(Boolean).join("; ") ||
            "inbound delivery failed"
          : undefined,
        results,
      };
    }

    deliveryCache.set(payload.messageId, { peerId: msg.from, payload: ack });
    trimDeliveryCache();
    await sendAck(msg.from, ack);
  }

  function trimDeliveryCache(): void {
    while (deliveryCache.size > MAX_DELIVERY_CACHE_ENTRIES) {
      const oldestKey = deliveryCache.keys().next().value as string | undefined;
      if (!oldestKey) return;
      deliveryCache.delete(oldestKey);
    }
  }

  function handleAck(msg: P2PMessage): void {
    const payload = parsePayload<DeliveryAckPayload>(msg);
    if (!payload || !isNonEmptyString(payload.ackFor) || typeof payload.ok !== "boolean") {
      logger?.warn?.(`[libp2p-mesh] Ignoring malformed delivery-ack from ${msg.from}`);
      return;
    }

    const pending = pendingAcks.get(payload.ackFor);
    if (!pending) {
      logger?.debug?.(`[libp2p-mesh] Ignoring unmatched delivery ACK for ${payload.ackFor}`);
      return;
    }
    if (pending.peerId !== msg.from) {
      logger?.warn?.(
        `[libp2p-mesh] Ignoring delivery ACK for ${payload.ackFor} from unexpected peer ${msg.from}`,
      );
      return;
    }

    clearTimeout(pending.timer);
    pendingAcks.delete(payload.ackFor);
    pending.resolve(payload);
  }

  async function handleMessage(msg: P2PMessage): Promise<void> {
    if (msg.type === "instance-announce") {
      await handleAnnounce(msg);
      return;
    }

    if (msg.type === "user-message") {
      await handleUserMessage(msg);
      return;
    }

    if (msg.type === "delivery-ack") {
      handleAck(msg);
    }
  }

  async function start(): Promise<void> {
    unsubs.push(
      mesh.onMessage((msg) => {
        handleMessage(msg).catch((error) => {
          logger?.error?.(
            `[libp2p-mesh] Instance router message error: ${summarizeError(error)}`,
          );
        });
      }),
    );
    unsubs.push(
      mesh.onPeerConnect((peerId) => {
        announceToPeer(peerId).catch((error) => {
          logger?.warn?.(
            `[libp2p-mesh] Failed to announce to connected peer ${peerId}: ${summarizeError(error)}`,
          );
        });
      }),
    );

    await announceToConnectedPeers();
  }

  async function stop(): Promise<void> {
    for (const unsub of unsubs.splice(0)) {
      unsub();
    }

    for (const [messageId, pending] of pendingAcks) {
      clearTimeout(pending.timer);
      pending.resolve({
        ackFor: messageId,
        ok: false,
        deliveredAt: Date.now(),
        error: "instance router stopped",
      });
    }
    pendingAcks.clear();
    deliveryCache.clear();
  }

  async function listInstances() {
    return store.list();
  }

  async function resolveInstance(instanceId: string) {
    return store.resolve(instanceId);
  }

  async function sendInstanceMessage(instanceId: string, message: string) {
    const route = await store.resolve(instanceId);
    if (!route) {
      return {
        sent: false,
        delivered: false,
        toInstanceId: instanceId,
        toPeerId: "",
        error: `Instance ${instanceId} has not been discovered. Ask the user to confirm the remote gateway is running and connected to the same P2P network.`,
      };
    }

    const fromInstanceId = localInstanceId();
    const messageId = crypto.randomUUID();
    const payload: UserMessagePayload = {
      messageId,
      fromInstanceId,
      toInstanceId: instanceId,
      text: message,
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: fromInstanceId,
        replyTool: "p2p_send_instance_message",
      },
    };

    const ackPromise = new Promise<DeliveryAckPayload>((resolve) => {
      const timer = setTimeout(() => {
        pendingAcks.delete(messageId);
        resolve({
          ackFor: messageId,
          ok: false,
          deliveredAt: Date.now(),
          error: `ACK timeout after ${ackTimeoutMs}ms`,
        });
      }, ackTimeoutMs);
      pendingAcks.set(messageId, { peerId: route.peerId, resolve, timer });
    });

    try {
      await mesh.sendStructuredMessage(route.peerId, {
        id: messageId,
        type: "user-message",
        to: route.peerId,
        payload: JSON.stringify(payload),
      });
    } catch (error) {
      const pending = pendingAcks.get(messageId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingAcks.delete(messageId);
      }
      return {
        sent: false,
        delivered: false,
        toInstanceId: instanceId,
        toPeerId: route.peerId,
        error: summarizeError(error),
      };
    }

    const ack = await ackPromise;
    return {
      sent: true,
      delivered: ack.ok,
      toInstanceId: instanceId,
      toPeerId: route.peerId,
      ackMessageId: ack.ackFor,
      inboundChannel: ack.inboundChannel,
      error: ack.error,
    };
  }

  return {
    start,
    stop,
    handleMessage,
    announceToPeer,
    listInstances,
    resolveInstance,
    sendInstanceMessage,
  };
}
