import test from "node:test";
import assert from "node:assert/strict";

import { buildP2PTools } from "../src/agent-tools.js";
import type { InstanceRouter, MeshNetwork } from "../src/types.js";

function makeMesh(): MeshNetwork {
  return {
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage() {},
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
      return undefined;
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

function makeRouter(
  result: Awaited<ReturnType<InstanceRouter["sendInstanceMessage"]>>,
): InstanceRouter {
  return {
    async start() {},
    async stop() {},
    async handleMessage() {},
    async announceToPeer() {},
    async listInstances() {
      return [];
    },
    async resolveInstance() {
      return undefined;
    },
    async sendInstanceMessage() {
      return result;
    },
  };
}

function sendInstanceTool(router: InstanceRouter) {
  const tool = buildP2PTools(makeMesh(), router).find(
    (candidate) => candidate.name === "p2p_send_instance_message",
  );
  assert.ok(tool);
  return tool;
}

test("send instance tool shows every target result when at least one target succeeds", async () => {
  const router = makeRouter({
    sent: true,
    delivered: true,
    toInstanceId: "receiver@abc.123",
    toPeerId: "peer-receiver",
    deliveryResults: [
      {
        id: "feishu-main",
        channel: "feishu",
        target: "user:ou_xxx",
        ok: true,
      },
      {
        id: "telegram-main",
        channel: "telegram",
        target: "chat:123456",
        ok: false,
        error: "机器人对该用户没有可用权限",
      },
    ],
  });

  const response = await sendInstanceTool(router).execute("call-1", {
    instanceId: "receiver@abc.123",
    message: "今晚来吃饭",
  });
  const text = response.content.map((item) => item.text).join("\n");

  assert.equal(response.isError, undefined);
  assert.match(text, /发往 receiver@abc\.123 的消息投递结果/);
  assert.match(text, /feishu-main \(feishu \/ user:ou_xxx\)：已送达/);
  assert.match(text, /telegram-main \(telegram \/ chat:123456\)：失败：机器人对该用户没有可用权限/);
});

test("send instance tool marks all-target failure as isError and shows details", async () => {
  const router = makeRouter({
    sent: true,
    delivered: false,
    toInstanceId: "receiver@abc.123",
    toPeerId: "peer-receiver",
    deliveryResults: [
      {
        id: "feishu-main",
        channel: "feishu",
        target: "user:ou_xxx",
        ok: false,
        error: "用户未授权",
      },
      {
        id: "telegram-main",
        channel: "telegram",
        target: "chat:123456",
        ok: false,
        error: "机器人对该用户没有可用权限",
      },
    ],
  });

  const response = await sendInstanceTool(router).execute("call-1", {
    instanceId: "receiver@abc.123",
    message: "今晚来吃饭",
  });
  const text = response.content.map((item) => item.text).join("\n");

  assert.equal(response.isError, true);
  assert.match(text, /发往 receiver@abc\.123 的消息投递失败/);
  assert.match(text, /feishu-main \(feishu \/ user:ou_xxx\)：失败：用户未授权/);
  assert.match(text, /telegram-main \(telegram \/ chat:123456\)：失败：机器人对该用户没有可用权限/);
});
