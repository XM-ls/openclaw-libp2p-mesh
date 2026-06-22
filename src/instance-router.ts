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
  payload?: DeliveryAckPayload;
  promise?: Promise<DeliveryAckPayload>;
};

type InboundDeliveryState = {
  timedOut: boolean;
  currentTarget?: EffectiveInboundTarget;
  results: DeliveryTargetResult[];
};

type InboundTimeoutController = {
  stop: () => void;
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

const INVALID_INBOUND_TARGET_ERROR = "inbound target channel and target are required";

function invalidInboundTarget(): EffectiveInboundTarget {
  return {
    channel: "",
    target: "",
    valid: false,
    error: INVALID_INBOUND_TARGET_ERROR,
  };
}

function displayTargetId(target: { id?: unknown }): string | undefined {
  return typeof target.id === "string" ? target.id.trim() || undefined : undefined;
}

function normalizeConfiguredTarget(target: unknown): EffectiveInboundTarget {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return invalidInboundTarget();
  }

  const configuredTarget = target as Partial<InboundTargetConfig>;
  const channel =
    typeof configuredTarget.channel === "string" ? configuredTarget.channel.trim() : "";
  const destination =
    typeof configuredTarget.target === "string" ? configuredTarget.target.trim() : "";
  const normalized: EffectiveInboundTarget = {
    id: displayTargetId(configuredTarget),
    channel,
    target: destination,
    valid: Boolean(channel && destination),
  };
  if (!normalized.valid) {
    normalized.error = INVALID_INBOUND_TARGET_ERROR;
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
  const inboundTimeoutControllers = new Set<InboundTimeoutController>();
  const unsubs: Array<() => void> = [];
  let stopped = false;

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

  function deliveryCacheKey(payload: UserMessagePayload, msg: P2PMessage): string {
    return [
      payload.fromInstanceId,
      msg.from,
      payload.toInstanceId,
      payload.messageId,
    ].join("\0");
  }

  function buildAckFromDeliveryState(
    messageId: string,
    state: Pick<InboundDeliveryState, "results">,
  ): DeliveryAckPayload {
    const selected = firstAttemptedResult(state.results);
    return {
      ackFor: messageId,
      ok: state.results.some((result) => result.ok),
      inboundChannel: selected?.channel,
      inboundTarget: selected?.target,
      deliveredAt: Date.now(),
      error: state.results.every((result) => !result.ok)
        ? state.results.map((result) => result.error).filter(Boolean).join("; ") ||
          "inbound delivery failed"
        : undefined,
      results: state.results,
    };
  }

  async function deliverAndBuildAck(
    payload: UserMessagePayload,
    msg: P2PMessage,
    state: InboundDeliveryState,
  ): Promise<DeliveryAckPayload> {
    const targets = effectiveInboundTargets(config);
    if (targets.length === 0) {
      return {
        ackFor: payload.messageId,
        ok: false,
        deliveredAt: Date.now(),
        error: "inbound delivery is not configured",
        results: [],
      };
    }

    const metadata = payload.metadata;
    for (const target of targets) {
      if (state.timedOut) {
        break;
      }

      if (!target.valid) {
        state.results.push({
          id: target.id,
          channel: target.channel,
          target: target.target,
          ok: false,
          error: target.error ?? "inbound target channel and target are required",
        });
        continue;
      }

      state.currentTarget = target;
      try {
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
        if (state.timedOut) {
          break;
        }
        state.results.push({
          id: target.id,
          channel: result.channel,
          target: result.target,
          ok: result.ok,
          error: result.error,
        });
      } catch (error) {
        if (state.timedOut) {
          break;
        }
        state.results.push({
          id: target.id,
          channel: target.channel,
          target: target.target,
          ok: false,
          error: summarizeError(error),
        });
      } finally {
        if (state.currentTarget === target) {
          state.currentTarget = undefined;
        }
      }
    }

    return buildAckFromDeliveryState(payload.messageId, state);
  }

  function buildInboundTimeoutAck(
    messageId: string,
    state: InboundDeliveryState,
  ): DeliveryAckPayload {
    const error = `inbound delivery timeout after ${ackTimeoutMs}ms`;
    const results = state.results.slice();
    const currentTarget = state.currentTarget;
    if (currentTarget) {
      results.push({
        id: currentTarget.id,
        channel: currentTarget.channel,
        target: currentTarget.target,
        ok: false,
        error: currentTarget.valid
          ? error
          : currentTarget.error ?? "inbound target channel and target are required",
      });
    }
    const selected = firstAttemptedResult(results);
    return {
      ackFor: messageId,
      ok: false,
      inboundChannel: selected?.channel,
      inboundTarget: selected?.target,
      deliveredAt: Date.now(),
      error,
      results,
    };
  }

  function withInboundDeliveryTimeout(
    promise: Promise<DeliveryAckPayload>,
    messageId: string,
    state: InboundDeliveryState,
  ): Promise<DeliveryAckPayload> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ack: DeliveryAckPayload): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inboundTimeoutControllers.delete(controller);
        resolve(ack);
      };
      const timer = setTimeout(() => {
        state.timedOut = true;
        settle(buildInboundTimeoutAck(messageId, state));
      }, ackTimeoutMs);
      const controller: InboundTimeoutController = {
        stop() {
          state.timedOut = true;
          settle({
            ackFor: messageId,
            ok: false,
            deliveredAt: Date.now(),
            error: "instance router stopped",
            results: state.results,
          });
        },
      };
      inboundTimeoutControllers.add(controller);

      promise
        .then((ack) => {
          settle(ack);
        })
        .catch((error) => {
          settle({
            ackFor: messageId,
            ok: false,
            deliveredAt: Date.now(),
            error: summarizeError(error),
            results: [],
          });
        });
    });
  }

  async function handleUserMessage(msg: P2PMessage): Promise<void> {
    if (stopped) {
      return;
    }
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
    if (stopped) {
      return;
    }
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

    const cacheKey = deliveryCacheKey(payload, msg);
    const cached = deliveryCache.get(cacheKey);
    if (cached) {
      const ack = cached.payload ?? (await cached.promise);
      if (!ack) {
        throw new Error(`delivery cache entry for ${payload.messageId} has no ACK payload`);
      }
      if (stopped) {
        return;
      }
      await sendAck(msg.from, ack);
      return;
    }

    if (pendingDeliveryCount() >= MAX_DELIVERY_CACHE_ENTRIES) {
      const ack: DeliveryAckPayload = {
        ackFor: payload.messageId,
        ok: false,
        deliveredAt: Date.now(),
        error: `too many pending inbound deliveries (${MAX_DELIVERY_CACHE_ENTRIES})`,
        results: [],
      };
      deliveryCache.set(cacheKey, { payload: ack });
      trimDeliveryCache();
      if (stopped) {
        return;
      }
      await sendAck(msg.from, ack);
      return;
    }

    const deliveryState: InboundDeliveryState = {
      timedOut: false,
      results: [],
    };
    const ackPromise = withInboundDeliveryTimeout(
      Promise.resolve().then(() => deliverAndBuildAck(payload, msg, deliveryState)),
      payload.messageId,
      deliveryState,
    );
    deliveryCache.set(cacheKey, { promise: ackPromise });
    trimDeliveryCache();
    const ack = await ackPromise;
    if (stopped) {
      return;
    }
    deliveryCache.set(cacheKey, { payload: ack });
    trimDeliveryCache();
    if (stopped) {
      return;
    }
    await sendAck(msg.from, ack);
  }

  function pendingDeliveryCount(): number {
    let count = 0;
    for (const entry of deliveryCache.values()) {
      if (entry.promise && !entry.payload) count += 1;
    }
    return count;
  }

  function trimDeliveryCache(): void {
    while (deliveryCache.size > MAX_DELIVERY_CACHE_ENTRIES) {
      const settledKeys = Array.from(deliveryCache)
        .filter(([, entry]) => entry.payload)
        .map(([key]) => key);
      if (settledKeys.length <= 1) return;
      deliveryCache.delete(settledKeys[0]!);
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
    stopped = false;
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
    stopped = true;
    for (const unsub of unsubs.splice(0)) {
      unsub();
    }

    for (const controller of Array.from(inboundTimeoutControllers)) {
      controller.stop();
    }
    inboundTimeoutControllers.clear();

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
      inboundTarget: ack.inboundTarget,
      deliveryResults: ack.results,
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
