import test from "node:test";
import assert from "node:assert/strict";
import pluginEntry from "../index.js";
import { createInstanceRouter } from "../src/instance-router.js";
import type {
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InstancePeerRecord,
  InstancePeerStore,
  MeshConfig,
  MeshNetwork,
  P2PMessage,
} from "../src/types.js";
import type {
  DeliveryAckPayload as ApiDeliveryAckPayload,
  DeliveryTargetResult as ApiDeliveryTargetResult,
  InboundTargetConfig as ApiInboundTargetConfig,
  MeshConfig as ApiMeshConfig,
} from "../api.js";

type SentMessage = {
  peerId: string;
  message: Omit<P2PMessage, "from" | "timestamp" | "instanceId" | "pubkey" | "signature"> & {
    timestamp?: number;
  };
};

function makeRecord(instanceId: string, peerId: string): InstancePeerRecord {
  return {
    instanceId,
    peerId,
    multiaddrs: [],
    lastSeenAt: Date.now(),
    lastAnnouncedAt: Date.now(),
    source: "announce",
  };
}

function makeStore(records: InstancePeerRecord[]): InstancePeerStore {
  return {
    async load() {
      return {
        version: 1,
        updatedAt: Date.now(),
        instances: Object.fromEntries(records.map((record) => [record.instanceId, record])),
      };
    },
    async list() {
      return records;
    },
    async resolve(instanceId: string) {
      return records.find((record) => record.instanceId === instanceId);
    },
    async upsertFromAnnounce(payload) {
      const record = makeRecord(payload.instanceId, payload.peerId);
      records.push(record);
      return { record, changed: true, peerIdSharedBy: [] };
    },
  };
}

function makeMesh(sent: SentMessage[] = []): MeshNetwork {
  return {
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage(peerId, message) {
      sent.push({ peerId, message });
    },
    onMessage() {
      return () => {};
    },
    onPeerConnect() {
      return () => {};
    },
    onPeerDisconnect() {
      return () => {};
    },
    async publishToTopic() {},
    async subscribeToTopic() {},
    getLocalPeerId() {
      return "peer-local";
    },
    getConnectedPeers() {
      return [];
    },
    getMultiaddrs() {
      return [];
    },
    async dial() {},
    getInstanceIdentity() {
      return {
        id: "receiver@abc.123",
        name: "receiver",
        pubkey: "pubkey",
        binding: "binding",
        bindingComponents: {
          username: "receiver",
          hostname: "host",
          platform: "linux",
        },
        createdAt: 1710000000000,
      };
    },
    getNATStatus() {
      return {
        enabled: {
          identify: false,
          autoNAT: false,
          upnp: false,
          circuitRelay: false,
          circuitRelayServer: false,
          dcutr: false,
        },
        reservedRelays: [],
        hasRelayedListenAddr: false,
      };
    },
  };
}

function makeUserMessage(messageId = "message-1"): P2PMessage {
  return {
    id: messageId,
    type: "user-message",
    from: "peer-sender",
    payload: JSON.stringify({
      messageId,
      fromInstanceId: "sender@def.456",
      toInstanceId: "receiver@abc.123",
      text: "今晚来吃饭",
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: "sender@def.456",
        replyTool: "p2p_send_instance_message",
      },
    }),
    timestamp: Date.now(),
    instanceId: "sender@def.456",
  };
}

function makeUserMessageFrom(
  messageId: string,
  fromInstanceId: string,
  fromPeerId: string,
): P2PMessage {
  const message = makeUserMessage(messageId);
  return {
    ...message,
    from: fromPeerId,
    instanceId: fromInstanceId,
    payload: JSON.stringify({
      ...JSON.parse(message.payload),
      fromInstanceId,
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: fromInstanceId,
        replyTool: "p2p_send_instance_message",
      },
    }),
  };
}

function parseAck(sent: SentMessage[]): ApiDeliveryAckPayload {
  const ackMessage = sent.find((entry) => entry.message.type === "delivery-ack");
  assert.ok(ackMessage, "expected delivery-ack to be sent");
  return JSON.parse(ackMessage.message.payload) as ApiDeliveryAckPayload;
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(message);
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

test("legacy single-target config still delivers once", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.channel, "feishu");
  assert.equal(deliveries[0]?.target, "user:ou_xxx");
  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
});

test("non-empty inboundTargets overrides legacy fields and deduplicates identical targets", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundChannel: "legacy",
      inboundTarget: "legacy-target",
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "feishu-duplicate", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.deepEqual(
    deliveries.map((request) => `${request.channel}/${request.target}`),
    ["feishu/user:ou_xxx", "telegram/chat:123456"],
  );
  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
  assert.deepEqual(
    ack.results.map((result: { id?: string; channel: string; target: string; ok: boolean }) => ({
      id: result.id,
      channel: result.channel,
      target: result.target,
      ok: result.ok,
    })),
    [
      { id: "feishu-main", channel: "feishu", target: "user:ou_xxx", ok: true },
      { id: "telegram-main", channel: "telegram", target: "chat:123456", ok: true },
    ],
  );
});

test("empty inboundTargets disables fallback and returns unconfigured failure", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      inboundTargets: [],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 0);
  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.error, "inbound delivery is not configured");
  assert.deepEqual(ack.results, []);
  assert.equal(ack.inboundChannel, undefined);
  assert.equal(ack.inboundTarget, undefined);
});

test("malformed inbound target records failure and continues to later targets", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const config = {
    inboundTargets: [
      null,
      { id: "telegram-main", channel: " telegram ", target: " chat:123456 " },
    ],
  } as unknown as MeshConfig;
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config,
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.channel, "telegram");
  assert.equal(deliveries[0]?.target, "chat:123456");

  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.error, undefined);
  assert.deepEqual(
    ack.results?.map(
      (result: { id?: string; channel: string; target: string; ok: boolean; error?: string }) => ({
        id: result.id,
        channel: result.channel,
        target: result.target,
        ok: result.ok,
        error: result.error,
      }),
    ),
    [
      {
        id: undefined,
        channel: "",
        target: "",
        ok: false,
        error: "inbound target channel and target are required",
      },
      {
        id: "telegram-main",
        channel: "telegram",
        target: "chat:123456",
        ok: true,
        error: undefined,
      },
    ],
  );
});

test("multi-target config types compile", () => {
  const target: ApiInboundTargetConfig = {
    id: "feishu-main",
    channel: "feishu",
    target: "user:ou_xxx",
  };
  const result: ApiDeliveryTargetResult = {
    id: target.id,
    channel: target.channel,
    target: target.target,
    ok: true,
  };
  const config: ApiMeshConfig = {
    inboundTargets: [target],
  };
  const ack: ApiDeliveryAckPayload = {
    ackFor: "message-1",
    ok: true,
    deliveredAt: 1710000000000,
    results: [result],
  };

  assert.equal(config.inboundTargets?.[0]?.channel, "feishu");
  assert.equal(ack.results?.[0]?.ok, true);
});

test("plugin entry schema exposes inboundTargets runtime config", () => {
  const inboundTargetsSchema = pluginEntry.configSchema.jsonSchema.properties.inboundTargets;

  assert.equal(inboundTargetsSchema.type, "array");
  assert.deepEqual(inboundTargetsSchema.items.required, ["channel", "target"]);
  assert.equal(inboundTargetsSchema.items.additionalProperties, false);
});

test("mixed target results return ok true with every target result", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      if (request.channel === "feishu") {
        return {
          ok: false,
          channel: request.channel,
          target: request.target,
          error: "机器人对该用户没有可用权限",
        };
      }
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.deepEqual(
    deliveries.map((request) => `${request.channel}/${request.target}`),
    ["feishu/user:ou_xxx", "telegram/chat:123456"],
  );

  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "telegram");
  assert.equal(ack.inboundTarget, "chat:123456");
  assert.deepEqual(
    ack.results?.map((result: { id?: string; ok: boolean; error?: string }) => ({
      id: result.id,
      ok: result.ok,
      error: result.error,
    })),
    [
      { id: "feishu-main", ok: false, error: "机器人对该用户没有可用权限" },
      { id: "telegram-main", ok: true, error: undefined },
    ],
  );
});

test("all target failures return ok false with all errors", async () => {
  const sent: SentMessage[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      return {
        ok: false,
        channel: request.channel,
        target: request.target,
        error: `${request.channel} unavailable`,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
  assert.equal(ack.error, "feishu unavailable; telegram unavailable");
  assert.deepEqual(
    ack.results?.map((result: { id?: string; ok: boolean; error?: string }) => ({
      id: result.id,
      ok: result.ok,
      error: result.error,
    })),
    [
      { id: "feishu-main", ok: false, error: "feishu unavailable" },
      { id: "telegram-main", ok: false, error: "telegram unavailable" },
    ],
  );
});

test("thrown target delivery error is reported while later targets still deliver", async () => {
  const sent: SentMessage[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      if (request.channel === "feishu") {
        throw new Error("feishu exploded");
      }
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.error, undefined);
  assert.equal(ack.inboundChannel, "telegram");
  assert.equal(ack.inboundTarget, "chat:123456");
  assert.deepEqual(
    ack.results?.map((result: { id?: string; ok: boolean; error?: string }) => ({
      id: result.id,
      ok: result.ok,
      error: result.error,
    })),
    [
      { id: "feishu-main", ok: false, error: "feishu exploded" },
      { id: "telegram-main", ok: true, error: undefined },
    ],
  );
});

test("duplicate messageId reuses cached ACK without repeat delivery", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  const message = makeUserMessage("duplicate-message");
  await router.handleMessage(message);
  await router.handleMessage(message);

  assert.equal(deliveries.length, 1);
  const acks = sent.filter((entry) => entry.message.type === "delivery-ack");
  assert.equal(acks.length, 2);
  assert.deepEqual(JSON.parse(acks[0]!.message.payload), JSON.parse(acks[1]!.message.payload));
});

test("concurrent duplicate messageId waits for in-flight ACK without repeat delivery", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  let releaseDelivery!: () => void;
  const deliveryBlocked = new Promise<void>((resolve) => {
    releaseDelivery = resolve;
  });
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      await deliveryBlocked;
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  const message = makeUserMessage("concurrent-duplicate-message");
  const first = router.handleMessage(message);
  const second = router.handleMessage(message);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  assert.equal(deliveries.length, 1);
  releaseDelivery();
  await Promise.all([first, second]);

  assert.equal(deliveries.length, 1);
  const acks = sent.filter((entry) => entry.message.type === "delivery-ack");
  assert.equal(acks.length, 2);
  assert.deepEqual(JSON.parse(acks[0]!.message.payload), JSON.parse(acks[1]!.message.payload));
});

test("stalled inbound delivery resolves with timeout ACK and caches result", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return new Promise(() => {});
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      deliveryAckTimeoutMs: 20,
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  const message = makeUserMessage("stalled-inbound-delivery");
  await router.handleMessage(message);

  assert.equal(deliveries.length, 1);
  let acks = sent.filter((entry) => entry.message.type === "delivery-ack");
  assert.equal(acks.length, 1);
  const timeoutAck = JSON.parse(acks[0]!.message.payload) as ApiDeliveryAckPayload;
  assert.equal(timeoutAck.ok, false);
  assert.equal(timeoutAck.inboundChannel, "feishu");
  assert.equal(timeoutAck.inboundTarget, "user:ou_xxx");
  assert.equal(timeoutAck.error, "inbound delivery timeout after 20ms");
  assert.deepEqual(timeoutAck.results, [
    {
      id: "feishu-main",
      channel: "feishu",
      target: "user:ou_xxx",
      ok: false,
      error: "inbound delivery timeout after 20ms",
    },
  ]);

  await router.handleMessage(message);

  assert.equal(deliveries.length, 1);
  acks = sent.filter((entry) => entry.message.type === "delivery-ack");
  assert.equal(acks.length, 2);
  assert.deepEqual(JSON.parse(acks[1]!.message.payload), timeoutAck);
});

test("timeout ACK stops later target delivery after stalled target eventually resolves", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      if (request.channel === "feishu") {
        await firstBlocked;
      }
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      deliveryAckTimeoutMs: 20,
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  const handler = router.handleMessage(makeUserMessage("timeout-stops-later-target"));
  await handler;

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.channel, "feishu");
  const timeoutAck = parseAck(sent);
  assert.equal(timeoutAck.ok, false);
  assert.equal(timeoutAck.error, "inbound delivery timeout after 20ms");
  assert.deepEqual(
    timeoutAck.results?.map((result) => ({
      id: result.id,
      channel: result.channel,
      target: result.target,
      ok: result.ok,
      error: result.error,
    })),
    [
      {
        id: "feishu-main",
        channel: "feishu",
        target: "user:ou_xxx",
        ok: false,
        error: "inbound delivery timeout after 20ms",
      },
    ],
  );

  releaseFirst();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  assert.equal(deliveries.length, 1);
  assert.equal(
    sent.filter((entry) => entry.message.type === "delivery-ack").length,
    1,
  );
});

test("delivery cache isolates same messageId from different valid senders", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([
      makeRecord("sender-a@def.456", "peer-sender-a"),
      makeRecord("sender-b@ghi.789", "peer-sender-b"),
    ]),
    delivery,
    config: {
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  await router.handleMessage(
    makeUserMessageFrom("shared-message-id", "sender-a@def.456", "peer-sender-a"),
  );
  await router.handleMessage(
    makeUserMessageFrom("shared-message-id", "sender-b@ghi.789", "peer-sender-b"),
  );

  assert.equal(deliveries.length, 2);
  assert.deepEqual(
    deliveries.map((request) => request.metadata.fromInstanceId),
    ["sender-a@def.456", "sender-b@ghi.789"],
  );
  const acks = sent.filter((entry) => entry.message.type === "delivery-ack");
  assert.equal(acks.length, 2);
  assert.deepEqual(
    acks.map((entry) => entry.peerId),
    ["peer-sender-a", "peer-sender-b"],
  );
});

test("stop prevents pending inbound handler from sending ACK after delivery resolves", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  let releaseDelivery!: () => void;
  const deliveryBlocked = new Promise<void>((resolve) => {
    releaseDelivery = resolve;
  });
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      await deliveryBlocked;
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      deliveryAckTimeoutMs: 5000,
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  const handler = router.handleMessage(makeUserMessage("stop-pending-inbound"));
  await waitFor(() => deliveries.length === 1, "expected delivery to start");

  await router.stop();
  releaseDelivery();
  await handler;

  assert.equal(sent.filter((entry) => entry.message.type === "delivery-ack").length, 0);
});

test("sendInstanceMessage returns ACK inbound target and per-target results", async () => {
  const sent: SentMessage[] = [];
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("receiver-remote@abc.123", "peer-remote")]),
    delivery: {
      async deliver(request) {
        return { ok: true, channel: request.channel, target: request.target };
      },
    },
    config: {
      deliveryAckTimeoutMs: 1000,
    },
  });

  const send = router.sendInstanceMessage("receiver-remote@abc.123", "hello");
  await waitFor(
    () => sent.some((entry) => entry.message.type === "user-message"),
    "expected user-message to be sent",
  );
  const userMessage = sent.find((entry) => entry.message.type === "user-message");
  assert.ok(userMessage, "expected user-message");
  await router.handleMessage({
    id: crypto.randomUUID(),
    type: "delivery-ack",
    from: "peer-remote",
    instanceId: "receiver-remote@abc.123",
    timestamp: Date.now(),
    payload: JSON.stringify({
      ackFor: userMessage.message.id,
      ok: true,
      deliveredAt: Date.now(),
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      results: [
        {
          id: "feishu-main",
          channel: "feishu",
          target: "user:ou_xxx",
          ok: true,
        },
      ],
    }),
  });

  const result = await send;

  assert.equal(result.delivered, true);
  assert.equal(result.inboundChannel, "feishu");
  assert.equal(result.inboundTarget, "user:ou_xxx");
  assert.deepEqual(result.deliveryResults, [
    {
      id: "feishu-main",
      channel: "feishu",
      target: "user:ou_xxx",
      ok: true,
    },
  ]);
});

test("pending delivery cache entries are not evicted before in-flight duplicate", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  let releaseDelivery!: () => void;
  const deliveryBlocked = new Promise<void>((resolve) => {
    releaseDelivery = resolve;
  });
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      await deliveryBlocked;
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  // Mirrors the production MAX_DELIVERY_CACHE_ENTRIES cap.
  const maxPending = 1000;
  const messages = Array.from({ length: maxPending }, (_, index) =>
    makeUserMessage(`pending-message-${index}`),
  );
  const handlers = messages.map((message) => router.handleMessage(message));
  await waitFor(
    () => deliveries.length === maxPending,
    "expected all pending deliveries to start",
  );

  const duplicate = router.handleMessage(messages[0]!);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  try {
    assert.equal(deliveries.length, maxPending);

    const oldestAcks = sent
      .filter((entry) => entry.message.type === "delivery-ack")
      .map((entry) => JSON.parse(entry.message.payload) as ApiDeliveryAckPayload)
      .filter((ack) => ack.ackFor === "pending-message-0");
    assert.equal(oldestAcks.length, 0);
  } finally {
    releaseDelivery();
    await Promise.allSettled([...handlers, duplicate]);
  }

  const oldestAcks = sent
    .filter((entry) => entry.message.type === "delivery-ack")
    .map((entry) => JSON.parse(entry.message.payload) as ApiDeliveryAckPayload)
    .filter((ack) => ack.ackFor === "pending-message-0");
  assert.equal(oldestAcks.length, 2);
  assert.deepEqual(oldestAcks[0], oldestAcks[1]);
});

test("pending inbound deliveries are hard-capped before starting new unique deliveries", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  let releaseDelivery!: () => void;
  const deliveryBlocked = new Promise<void>((resolve) => {
    releaseDelivery = resolve;
  });
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      await deliveryBlocked;
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      deliveryAckTimeoutMs: 5000,
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  // Mirrors the production MAX_DELIVERY_CACHE_ENTRIES cap.
  const maxPending = 1000;
  const messages = Array.from({ length: maxPending }, (_, index) =>
    makeUserMessage(`hard-cap-pending-message-${index}`),
  );
  const handlers = messages.map((message) => router.handleMessage(message));
  await waitFor(
    () => deliveries.length === maxPending,
    "expected all pending deliveries to start",
  );

  try {
    await router.handleMessage(makeUserMessage("hard-cap-overflow-message"));

    assert.equal(deliveries.length, maxPending);
    const overflowAck = sent
      .filter((entry) => entry.message.type === "delivery-ack")
      .map((entry) => JSON.parse(entry.message.payload) as ApiDeliveryAckPayload)
      .find((ack) => ack.ackFor === "hard-cap-overflow-message");
    assert.ok(overflowAck, "expected over-cap message to receive an ACK");
    assert.equal(overflowAck.ok, false);
    assert.deepEqual(overflowAck.results, []);
    assert.equal(overflowAck.error, "too many pending inbound deliveries (1000)");
  } finally {
    releaseDelivery();
    await Promise.allSettled(handlers);
  }
});
