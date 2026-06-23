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
  UserPublicAttribute,
} from "../src/types.js";

type SentMessage = {
  peerId: string;
  message: Parameters<MeshNetwork["sendStructuredMessage"]>[1];
};

function makeRecord(
  instanceId: string,
  peerId: string,
  fields: Partial<Pick<InstancePeerRecord, "instanceName" | "userPublicAttributes">> = {},
): InstancePeerRecord {
  return {
    instanceId,
    peerId,
    instanceName: fields.instanceName,
    multiaddrs: [],
    userPublicAttributes: fields.userPublicAttributes,
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

test("announceToPeer sends merged USER.md and profile user public attributes", async () => {
  const sent: SentMessage[] = [];
  const userMdTag: UserPublicAttribute = {
    kind: "tag",
    value: "ResearchLoop",
    label: "ResearchLoop",
    source: "USER.md",
  };
  const profileAttribute: UserPublicAttribute = {
    kind: "structured",
    key: "project",
    value: "libp2p-mesh",
    label: "libp2p-mesh",
    source: "profile",
  };
  const duplicateProfileAttribute: UserPublicAttribute = {
    kind: "structured",
    key: "project",
    value: " libp2p-mesh ",
    label: "duplicate",
    source: "profile",
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([]),
    delivery: {
      async deliver() {
        throw new Error("not used");
      },
    },
    userAttributeSource: {
      async loadTags() {
        return [userMdTag];
      },
    },
    userProfileStore: {
      async listAttributes() {
        return [profileAttribute, duplicateProfileAttribute];
      },
    },
  });

  await router.announceToPeer("remote-peer");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].peerId, "remote-peer");
  assert.equal(sent[0].message.type, "instance-announce");
  const payload = JSON.parse(sent[0].message.payload);
  assert.deepEqual(payload.userPublicAttributes, [userMdTag, profileAttribute]);
});

test("sendUserAttributeMessage dry run returns tag-matched targets without sending", async () => {
  const sent: SentMessage[] = [];
  const researchLoopTag: UserPublicAttribute = {
    kind: "tag",
    value: "ResearchLoop",
    label: "ResearchLoop",
    source: "USER.md",
  };
  const otherTag: UserPublicAttribute = {
    kind: "tag",
    value: "Other",
    label: "Other",
    source: "USER.md",
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([
      makeRecord("alpha@abc.111", "peer-alpha", {
        instanceName: "alpha",
        userPublicAttributes: [researchLoopTag],
      }),
      makeRecord("beta@abc.222", "peer-beta", {
        instanceName: "beta",
        userPublicAttributes: [otherTag, researchLoopTag],
      }),
      makeRecord("gamma@abc.333", "peer-gamma", {
        instanceName: "gamma",
        userPublicAttributes: [otherTag],
      }),
    ]),
    delivery: {
      async deliver() {
        throw new Error("not used");
      },
    },
  });

  const result = await router.sendUserAttributeMessage(
    { kind: "tag", value: " researchloop " },
    "hello team",
    { dryRun: true },
  );

  assert.equal(result.matched, 2);
  assert.equal(result.sent, 0);
  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.targets, [
    {
      instanceId: "alpha@abc.111",
      instanceName: "alpha",
      peerId: "peer-alpha",
      matchedAttribute: researchLoopTag,
    },
    {
      instanceId: "beta@abc.222",
      instanceName: "beta",
      peerId: "peer-beta",
      matchedAttribute: researchLoopTag,
    },
  ]);
  assert.equal(result.results, undefined);
  assert.equal(sent.length, 0);
});

test("sendUserAttributeMessage distinguishes tag and structured matches", async () => {
  const sent: SentMessage[] = [];
  const tag: UserPublicAttribute = {
    kind: "tag",
    value: "ResearchLoop",
    label: "ResearchLoop",
    source: "USER.md",
  };
  const structured: UserPublicAttribute = {
    kind: "structured",
    key: "project",
    value: "ResearchLoop",
    label: "ResearchLoop project",
    source: "profile",
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([
      makeRecord("tagged@abc.111", "peer-tagged", { userPublicAttributes: [tag] }),
      makeRecord("structured@abc.222", "peer-structured", {
        userPublicAttributes: [structured],
      }),
    ]),
    delivery: {
      async deliver() {
        throw new Error("not used");
      },
    },
  });

  const tagResult = await router.sendUserAttributeMessage(
    { kind: "tag", value: "researchloop" },
    "hello tags",
    { dryRun: true },
  );
  const structuredResult = await router.sendUserAttributeMessage(
    { kind: "structured", key: "PROJECT", value: " researchloop " },
    "hello project",
    { dryRun: true },
  );

  assert.deepEqual(
    tagResult.targets?.map((target) => target.instanceId),
    ["tagged@abc.111"],
  );
  assert.deepEqual(
    structuredResult.targets?.map((target) => target.instanceId),
    ["structured@abc.222"],
  );
});

test("sendUserAttributeMessage sends user messages to every match and continues after failures", async () => {
  const sent: SentMessage[] = [];
  const researchLoopTag: UserPublicAttribute = {
    kind: "tag",
    value: "ResearchLoop",
    label: "ResearchLoop",
    source: "USER.md",
  };
  const ackByPeer = new Map([
    ["peer-alpha", { ok: true }],
    ["peer-gamma", { ok: false, error: "remote delivery failed" }],
  ]);
  let router: ReturnType<typeof createInstanceRouter>;
  const mesh = makeMesh(sent);
  mesh.sendStructuredMessage = async (peerId, message) => {
    if (peerId === "peer-beta") {
      throw new Error("dial failed");
    }
    sent.push({ peerId, message });
    if (message.type !== "user-message") {
      return;
    }
    const ack = ackByPeer.get(peerId) ?? { ok: false, error: "unexpected peer" };
    queueMicrotask(() => {
      router
        .handleMessage({
          id: `ack-${message.id}`,
          type: "delivery-ack",
          from: peerId,
          to: "local-peer",
          timestamp: 1,
          payload: JSON.stringify({
            ackFor: message.id,
            ok: ack.ok,
            inboundChannel: ack.ok ? "feishu" : undefined,
            inboundTarget: ack.ok ? "user:ou_xxx" : undefined,
            deliveredAt: 1,
            error: ack.error,
          }),
        })
        .catch((error) => {
          throw error;
        });
    });
  };
  router = createInstanceRouter({
    mesh,
    store: makeStore([
      makeRecord("alpha@abc.111", "peer-alpha", {
        instanceName: "alpha",
        userPublicAttributes: [researchLoopTag],
      }),
      makeRecord("beta@abc.222", "peer-beta", {
        instanceName: "beta",
        userPublicAttributes: [researchLoopTag],
      }),
      makeRecord("gamma@abc.333", "peer-gamma", {
        instanceName: "gamma",
        userPublicAttributes: [researchLoopTag],
      }),
    ]),
    config: {
      deliveryAckTimeoutMs: 1000,
    },
  });

  const result = await router.sendUserAttributeMessage(
    { kind: "tag", value: "ResearchLoop" },
    "hello team",
  );

  assert.equal(result.matched, 3);
  assert.equal(result.sent, 2);
  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 2);
  assert.deepEqual(
    sent.map((item) => [item.peerId, item.message.type]),
    [
      ["peer-alpha", "user-message"],
      ["peer-gamma", "user-message"],
    ],
  );
  assert.deepEqual(
    sent.map((item) => JSON.parse(item.message.payload).toInstanceId),
    ["alpha@abc.111", "gamma@abc.333"],
  );
  assert.deepEqual(result.results, [
    {
      instanceId: "alpha@abc.111",
      instanceName: "alpha",
      peerId: "peer-alpha",
      matchedAttribute: researchLoopTag,
      sent: true,
      delivered: true,
    },
    {
      instanceId: "beta@abc.222",
      instanceName: "beta",
      peerId: "peer-beta",
      matchedAttribute: researchLoopTag,
      sent: false,
      delivered: false,
      error: "dial failed",
    },
    {
      instanceId: "gamma@abc.333",
      instanceName: "gamma",
      peerId: "peer-gamma",
      matchedAttribute: researchLoopTag,
      sent: true,
      delivered: false,
      error: "remote delivery failed",
    },
  ]);
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
