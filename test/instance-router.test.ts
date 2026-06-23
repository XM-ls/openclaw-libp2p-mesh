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
  assert.equal(ack.error, "inbound delivery is not configured");
  assert.deepEqual(ack.results, []);
});
