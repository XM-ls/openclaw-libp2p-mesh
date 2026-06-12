import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInstancePeerStore } from "./src/instance-peer-store.js";
import { createInstanceRouter } from "./src/instance-router.js";

function createFakeMesh(identity, peerId) {
  const messages = [];
  const messageHandlers = new Set();
  const connectHandlers = new Set();
  return {
    messages,
    emitConnect(id) {
      for (const handler of connectHandlers) handler(id);
    },
    emitMessage(msg) {
      for (const handler of messageHandlers) handler(msg);
    },
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage(targetPeerId, message) {
      messages.push({ targetPeerId, message });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onPeerConnect(handler) {
      connectHandlers.add(handler);
      return () => connectHandlers.delete(handler);
    },
    onPeerDisconnect() {
      return () => {};
    },
    async publishToTopic() {},
    async subscribeToTopic() {},
    getLocalPeerId() {
      return peerId;
    },
    getConnectedPeers() {
      return ["peer-b"];
    },
    getMultiaddrs() {
      return [`/ip4/127.0.0.1/tcp/1/p2p/${peerId}`];
    },
    async dial() {},
    getInstanceIdentity() {
      return identity;
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

async function run() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-instance-router-"));
  const store = createInstancePeerStore({
    path: path.join(dir, "libp2p", "instance-peer.json"),
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  });

  const logs = [];
  const mesh = createFakeMesh(
    {
      id: "alice@abc.123",
      name: "alice",
      pubkey: "pub-a",
      binding: "binding",
      bindingComponents: { username: "alice", hostname: "host", platform: "linux" },
      createdAt: 1,
    },
    "peer-a",
  );

  const deliveries = [];
  const delivery = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };

  const router = createInstanceRouter({
    mesh,
    store,
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      deliveryAckTimeoutMs: 50,
    },
    logger: {
      info: (m) => logs.push(`info:${m}`),
      warn: (m) => logs.push(`warn:${m}`),
      debug: () => {},
      error: (m) => logs.push(`error:${m}`),
    },
  });

  await router.start();
  assert.equal(mesh.messages.length, 1);
  assert.equal(mesh.messages[0].message.type, "instance-announce");

  mesh.emitConnect("peer-b");
  assert.equal(mesh.messages.filter((m) => m.message.type === "instance-announce").length, 2);

  await router.handleMessage({
    id: "announce-b",
    type: "instance-announce",
    from: "peer-b",
    payload: JSON.stringify({
      instanceId: "bob@def.456",
      peerId: "peer-b",
      instanceName: "bob",
      multiaddrs: ["/ip4/127.0.0.1/tcp/2/p2p/peer-b"],
      pubkey: "pub-b",
      announcedAt: 100,
    }),
    timestamp: Date.now(),
  });

  const resolved = await router.resolveInstance("bob@def.456");
  assert.equal(resolved?.peerId, "peer-b");
  assert.equal(logs.some((m) => m.includes("Instance mapping updated")), true);

  const sendPromise = router.sendInstanceMessage("bob@def.456", "今晚出来吃饭");
  const outbound = mesh.messages.find((m) => m.message.type === "user-message");
  assert.equal(outbound.targetPeerId, "peer-b");
  const outboundPayload = JSON.parse(outbound.message.payload);
  assert.equal(outboundPayload.toInstanceId, "bob@def.456");
  assert.equal(outboundPayload.text, "今晚出来吃饭");

  await router.handleMessage({
    id: "ack-b",
    type: "delivery-ack",
    from: "peer-b",
    payload: JSON.stringify({
      ackFor: outboundPayload.messageId,
      ok: true,
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      deliveredAt: Date.now(),
    }),
    timestamp: Date.now(),
  });

  const result = await sendPromise;
  assert.equal(result.sent, true);
  assert.equal(result.delivered, true);
  assert.equal(result.toPeerId, "peer-b");

  await router.handleMessage({
    id: "user-message-b",
    type: "user-message",
    from: "peer-b",
    payload: JSON.stringify({
      messageId: "remote-message-1",
      fromInstanceId: "bob@def.456",
      toInstanceId: "alice@abc.123",
      text: "收到",
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: "bob@def.456",
        replyTool: "p2p_send_instance_message",
      },
    }),
    timestamp: Date.now(),
  });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].text, "收到");
  assert.equal(mesh.messages.some((m) => m.message.type === "delivery-ack"), true);

  const timeoutResult = await router.sendInstanceMessage("bob@def.456", "timeout");
  assert.equal(timeoutResult.sent, true);
  assert.equal(timeoutResult.delivered, false);
  assert.equal(timeoutResult.error.includes("ACK timeout after 50ms"), true);

  await router.stop();
  console.log("test-instance-router: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
