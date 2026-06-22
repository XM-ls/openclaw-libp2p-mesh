import test from "node:test";
import assert from "node:assert/strict";
import pluginEntry from "../index.js";
import { createInstanceRouter } from "../src/instance-router.js";
import type {
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InstancePeerRecord,
  InstancePeerStore,
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

function parseAck(sent: SentMessage[]): ApiDeliveryAckPayload {
  const ackMessage = sent.find((entry) => entry.message.type === "delivery-ack");
  assert.ok(ackMessage, "expected delivery-ack to be sent");
  return JSON.parse(ackMessage.message.payload) as ApiDeliveryAckPayload;
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
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      if (request.channel === "telegram") {
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

  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
  assert.deepEqual(
    ack.results?.map((result: { id?: string; ok: boolean; error?: string }) => ({
      id: result.id,
      ok: result.ok,
      error: result.error,
    })),
    [
      { id: "feishu-main", ok: true, error: undefined },
      { id: "telegram-main", ok: false, error: "机器人对该用户没有可用权限" },
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
