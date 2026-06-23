import test from "node:test";
import assert from "node:assert/strict";

import { buildP2PTools } from "../src/agent-tools.js";
import type { InstanceRouter, MeshNetwork, UserPublicAttribute } from "../src/types.js";

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

type RouterResults = {
  sendInstanceMessage?: Awaited<ReturnType<InstanceRouter["sendInstanceMessage"]>>;
  sendUserAttributeMessage?: Awaited<ReturnType<InstanceRouter["sendUserAttributeMessage"]>>;
};

function makeRouter(results: Awaited<ReturnType<InstanceRouter["sendInstanceMessage"]>> | RouterResults): InstanceRouter {
  const sendInstanceMessage =
    "sendInstanceMessage" in results || "sendUserAttributeMessage" in results
      ? results.sendInstanceMessage
      : results;
  const sendUserAttributeMessage =
    "sendInstanceMessage" in results || "sendUserAttributeMessage" in results
      ? results.sendUserAttributeMessage
      : undefined;

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
      return (
        sendInstanceMessage ?? {
          sent: false,
          delivered: false,
          toInstanceId: "",
          toPeerId: "",
          error: "not configured",
        }
      );
    },
    async sendUserAttributeMessage() {
      return (
        sendUserAttributeMessage ?? {
          matched: 0,
          sent: 0,
          delivered: 0,
          failed: 0,
          error: "not configured",
        }
      );
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

function userAttributeTool(router?: InstanceRouter) {
  const tool = buildP2PTools(makeMesh(), router).find(
    (candidate) => candidate.name === "p2p_send_user_attribute_message",
  );
  assert.ok(tool);
  return tool;
}

const researchLoopTag: UserPublicAttribute = {
  kind: "tag",
  value: "ResearchLoop",
  label: "ResearchLoop",
  source: "USER.md",
};

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

test("send user attribute tool exposes match schema and asks agents to dry run before group sending", () => {
  const tool = userAttributeTool(
    makeRouter({
      sendUserAttributeMessage: {
        matched: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
      },
    }),
  );

  assert.match(tool.description, /dry run/i);
  assert.equal(tool.parameters.type, "object");
  assert.deepEqual(tool.parameters.required, ["match", "message"]);
  assert.ok(tool.parameters.properties.match);
  assert.ok(tool.parameters.properties.message);
  assert.ok(tool.parameters.properties.dryRun);
});

test("send user attribute tool returns isError when router is unavailable", async () => {
  const response = await userAttributeTool().execute("call-1", {
    match: { kind: "tag", value: "ResearchLoop" },
    message: "hello team",
    dryRun: true,
  });

  assert.equal(response.isError, true);
  assert.match(response.content.map((item) => item.text).join("\n"), /Instance router is not initialized/);
});

test("send user attribute tool returns isError when no discovered instances match", async () => {
  const response = await userAttributeTool(
    makeRouter({
      sendUserAttributeMessage: {
        matched: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
        error: "No discovered instances match tag ResearchLoop.",
      },
    }),
  ).execute("call-1", {
    match: { kind: "tag", value: "ResearchLoop" },
    message: "hello team",
    dryRun: true,
  });

  const text = response.content.map((item) => item.text).join("\n");

  assert.equal(response.isError, true);
  assert.match(text, /No discovered instances match tag ResearchLoop/);
  assert.deepEqual(response.details, {
    matched: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    error: "No discovered instances match tag ResearchLoop.",
  });
});

test("send user attribute tool dry run reports matching targets without sending", async () => {
  const response = await userAttributeTool(
    makeRouter({
      sendUserAttributeMessage: {
        matched: 2,
        sent: 0,
        delivered: 0,
        failed: 0,
        targets: [
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
        ],
      },
    }),
  ).execute("call-1", {
    match: { kind: "tag", value: "ResearchLoop" },
    message: "hello team",
    dryRun: true,
  });

  const text = response.content.map((item) => item.text).join("\n");

  assert.equal(response.isError, undefined);
  assert.match(text, /Dry run matched 2 instance/);
  assert.match(text, /alpha@abc\.111 \(alpha\) -> peer-alpha/);
  assert.match(text, /beta@abc\.222 \(beta\) -> peer-beta/);
});

test("send user attribute tool reports partial failures", async () => {
  const response = await userAttributeTool(
    makeRouter({
      sendUserAttributeMessage: {
        matched: 3,
        sent: 2,
        delivered: 1,
        failed: 2,
        results: [
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
        ],
      },
    }),
  ).execute("call-1", {
    match: { kind: "tag", value: "ResearchLoop" },
    message: "hello team",
  });

  const text = response.content.map((item) => item.text).join("\n");

  assert.equal(response.isError, true);
  assert.match(text, /Matched 3 instance\(s\); sent 2; delivered 1; failed 2/);
  assert.match(text, /alpha@abc\.111 \(alpha\) -> peer-alpha：已送达/);
  assert.match(text, /beta@abc\.222 \(beta\) -> peer-beta：发送失败：dial failed/);
  assert.match(text, /gamma@abc\.333 \(gamma\) -> peer-gamma：投递失败：remote delivery failed/);
});
