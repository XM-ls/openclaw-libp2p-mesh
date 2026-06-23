import test from "node:test";
import assert from "node:assert/strict";

import { createInstanceRouter } from "../src/instance-router.js";
import type {
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InstancePeerRecord,
  InstancePeerStore,
  MeshNetwork,
  P2PMessage,
} from "../src/types.js";

type SentMessage = {
  peerId: string;
  message: Parameters<MeshNetwork["sendStructuredMessage"]>[1];
};

function makeRecord(instanceId: string, peerId: string): InstancePeerRecord {
  return {
    instanceId,
    peerId,
    multiaddrs: [],
    lastSeenAt: 1,
    lastAnnouncedAt: 1,
    source: "announce",
  };
}

function makeStore(records: InstancePeerRecord[]): InstancePeerStore {
  const byInstance = new Map(records.map((record) => [record.instanceId, record]));

  return {
    async load() {
      return {
        version: 1,
        updatedAt: 1,
        instances: Object.fromEntries(byInstance),
      };
    },
    async list() {
      return [...byInstance.values()];
    },
    async resolve(instanceId: string) {
      return byInstance.get(instanceId);
    },
    async upsertFromAnnounce(payload) {
      const previous = byInstance.get(payload.instanceId);
      const record = makeRecord(payload.instanceId, payload.peerId);
      record.instanceName = payload.instanceName;
      record.multiaddrs = payload.multiaddrs;
      record.pubkey = payload.pubkey;
      record.lastAnnouncedAt = payload.announcedAt;
      byInstance.set(payload.instanceId, record);

      return {
        record,
        changed: !previous || previous.peerId !== payload.peerId,
        peerIdSharedBy: [],
      };
    },
  };
}

function makeMesh(sent: SentMessage[]): MeshNetwork {
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
      return "local-peer";
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
        id: "local-instance",
        name: "local",
        pubkey: "local-pubkey",
        binding: "local-binding",
        bindingComponents: {
          username: "user",
          hostname: "host",
          platform: "test",
        },
        createdAt: 1,
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
    from: "remote-peer",
    to: "local-peer",
    timestamp: 1,
    instanceId: "remote-instance",
    payload: JSON.stringify({
      messageId,
      fromInstanceId: "remote-instance",
      toInstanceId: "local-instance",
      text: "hello",
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: "remote-instance",
        replyTool: "p2p_send_instance_message",
      },
    }),
  };
}

function parseAck(sent: SentMessage[]) {
  const ack = sent.find((item) => item.message.type === "delivery-ack");
  assert.ok(ack, "expected delivery ACK");
  return JSON.parse(ack.message.payload);
}

function parseAcks(sent: SentMessage[]) {
  return sent
    .filter((item) => item.message.type === "delivery-ack")
    .map((item) => JSON.parse(item.message.payload));
}

test("sendInstanceMessage returns ACK target results to tool layer", async () => {
  const sent: SentMessage[] = [];
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("receiver@abc.123", "peer-receiver")]),
    config: {
      deliveryAckTimeoutMs: 1000,
    },
  });

  const pending = router.sendInstanceMessage("receiver@abc.123", "今晚来吃饭");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const userMessage = sent.find((item) => item.message.type === "user-message");
  assert.ok(userMessage, "expected user message to be sent");
  const deliveryResults = [
    {
      id: "feishu-primary",
      channel: "feishu",
      target: "user:ou_xxx",
      ok: true,
    },
    {
      id: "telegram-alerts",
      channel: "telegram",
      target: "chat:123",
      ok: false,
      error: "telegram failed",
    },
  ];

  await router.handleMessage({
    id: "ack-1",
    type: "delivery-ack",
    from: "peer-receiver",
    to: "local-peer",
    timestamp: 1,
    instanceId: "receiver@abc.123",
    payload: JSON.stringify({
      ackFor: userMessage.message.id,
      ok: true,
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      deliveredAt: 1,
      results: deliveryResults,
    }),
  });

  const result = await pending;

  assert.equal(result.delivered, true);
  assert.equal(result.inboundChannel, "feishu");
  assert.equal(result.inboundTarget, "user:ou_xxx");
  assert.deepEqual(result.deliveryResults, deliveryResults);
});

test("legacy single-target config still delivers once", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_1",
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].channel, "feishu");
  assert.equal(deliveries[0].target, "user:ou_1");
  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_1");
});

test("non-empty inboundTargets overrides legacy fields and deduplicates identical targets", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundChannel: "legacy",
      inboundTarget: "legacy-target",
      inboundTargets: [
        { id: "first-feishu", channel: " feishu ", target: " user:ou_1 " },
        { id: "duplicate-feishu", channel: "feishu", target: "user:ou_1" },
        { id: "telegram-target", channel: "telegram", target: "chat:123" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.deepEqual(
    deliveries.map((request) => [request.channel, request.target]),
    [
      ["feishu", "user:ou_1"],
      ["telegram", "chat:123"],
    ],
  );
  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.results, [
    {
      id: "first-feishu",
      channel: "feishu",
      target: "user:ou_1",
      ok: true,
    },
    {
      id: "telegram-target",
      channel: "telegram",
      target: "chat:123",
      ok: true,
    },
  ]);
});

test("empty inboundTargets disables fallback and returns unconfigured failure", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundChannel: "legacy",
      inboundTarget: "legacy-target",
      inboundTargets: [],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 0);
  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.inboundChannel, undefined);
  assert.equal(ack.inboundTarget, undefined);
  assert.equal(ack.error, "inbound delivery is not configured");
  assert.deepEqual(ack.results, []);
});

test("invalid-only inboundTargets omit ack target fields", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundTargets: [{ id: "bad", channel: "", target: "" }],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 0);
  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.inboundChannel, undefined);
  assert.equal(ack.inboundTarget, undefined);
  assert.deepEqual(ack.results, [
    {
      id: "bad",
      channel: "",
      target: "",
      ok: false,
      error: "inbound target channel and target are required",
    },
  ]);
});

test("malformed inboundTargets return target failures instead of throwing", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundTargets: [
        {
          id: "bad-runtime-config",
          channel: 123,
          target: null,
        },
      ],
    } as never,
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 0);
  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.inboundChannel, undefined);
  assert.equal(ack.inboundTarget, undefined);
  assert.deepEqual(ack.results, [
    {
      id: "bad-runtime-config",
      channel: "",
      target: "",
      ok: false,
      error: "inbound target channel and target are required",
    },
  ]);
});

test("mixed target results return ok true with every target result", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      if (request.channel === "telegram") {
        return {
          ok: false,
          channel: request.channel,
          target: request.target,
          error: "telegram rejected message",
        };
      }

      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundTargets: [
        { id: "feishu-primary", channel: "feishu", target: "user:ou_1" },
        { id: "telegram-alerts", channel: "telegram", target: "chat:123" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 2);
  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_1");
  assert.equal(ack.error, undefined);
  assert.deepEqual(ack.results, [
    {
      id: "feishu-primary",
      channel: "feishu",
      target: "user:ou_1",
      ok: true,
    },
    {
      id: "telegram-alerts",
      channel: "telegram",
      target: "chat:123",
      ok: false,
      error: "telegram rejected message",
    },
  ]);
});

test("all target failures return ok false with all errors", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return {
        ok: false,
        channel: request.channel,
        target: request.target,
        error: `${request.channel} failed`,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundTargets: [
        { id: "feishu-primary", channel: "feishu", target: "user:ou_1" },
        { id: "telegram-alerts", channel: "telegram", target: "chat:123" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 2);
  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_1");
  assert.equal(ack.error, "feishu failed; telegram failed");
  assert.deepEqual(ack.results, [
    {
      id: "feishu-primary",
      channel: "feishu",
      target: "user:ou_1",
      ok: false,
      error: "feishu failed",
    },
    {
      id: "telegram-alerts",
      channel: "telegram",
      target: "chat:123",
      ok: false,
      error: "telegram failed",
    },
  ]);
});

test("duplicate messageId reuses cached ACK without repeat delivery", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return {
        ok: true,
        channel: request.channel,
        target: request.target,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("remote-instance", "remote-peer")]),
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_1",
    },
  });
  const message = makeUserMessage("same-message");

  await router.handleMessage(message);
  await router.handleMessage(message);

  assert.equal(deliveries.length, 1);
  const acks = parseAcks(sent);
  assert.equal(acks.length, 2);
  assert.deepEqual(acks[0], acks[1]);
});
