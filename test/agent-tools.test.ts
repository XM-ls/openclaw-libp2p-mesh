import test from "node:test";
import assert from "node:assert/strict";

import { buildP2PTools } from "../src/agent-tools.js";
import type {
  InstancePeerRecord,
  InstanceRouter,
  LocalPeerLabelAttribute,
  MeshNetwork,
  UserPublicAttribute,
} from "../src/types.js";

function makeMesh(connectedPeers: string[] = []): MeshNetwork {
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
      return connectedPeers;
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
  listInstances?: InstancePeerRecord[];
  sendInstanceMessage?: Awaited<ReturnType<InstanceRouter["sendInstanceMessage"]>>;
  sendUserAttributeMessage?: Awaited<ReturnType<InstanceRouter["sendUserAttributeMessage"]>>;
};

function makeRouter(results: Awaited<ReturnType<InstanceRouter["sendInstanceMessage"]>> | RouterResults): InstanceRouter {
  const sendInstanceMessage =
    "listInstances" in results || "sendInstanceMessage" in results || "sendUserAttributeMessage" in results
      ? results.sendInstanceMessage
      : results;
  const sendUserAttributeMessage =
    "listInstances" in results || "sendInstanceMessage" in results || "sendUserAttributeMessage" in results
      ? results.sendUserAttributeMessage
      : undefined;
  const listInstances =
    "listInstances" in results || "sendInstanceMessage" in results || "sendUserAttributeMessage" in results
      ? results.listInstances
      : undefined;

  return {
    async start() {},
    async stop() {},
    async handleMessage() {},
    async announceToPeer() {},
    async listInstances() {
      return listInstances ?? [];
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

function listInstancesTool(options: {
  router: InstanceRouter;
  connectedPeers?: string[];
  localLabels?: Record<string, LocalPeerLabelAttribute[]>;
}) {
  const tool = buildP2PTools(makeMesh(options.connectedPeers), options.router, {
    peerLabelStore: {
      async listLabels(instanceId: string) {
        return options.localLabels?.[instanceId] ?? [];
      },
    },
  }).find((candidate) => candidate.name === "p2p_list_instances");
  assert.ok(tool);
  return tool;
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

function makeUserAttributeRouter(
  handler: InstanceRouter["sendUserAttributeMessage"],
): InstanceRouter {
  return {
    ...makeRouter({
      sendUserAttributeMessage: {
        matched: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
      },
    }),
    sendUserAttributeMessage: handler,
  };
}

const researchLoopTag: UserPublicAttribute = {
  kind: "tag",
  value: "ResearchLoop",
  label: "ResearchLoop",
  source: "USER.md",
};

test("list instances tool shows complete public attributes and local labels", async () => {
  const publicTag: UserPublicAttribute = {
    kind: "tag",
    value: "P2P",
    label: "P2P",
    source: "USER.md",
  };
  const publicProject: UserPublicAttribute = {
    kind: "structured",
    key: "project",
    value: "libp2p-mesh",
    label: "project: libp2p-mesh",
    source: "profile",
  };
  const localGroup: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "实验室",
    label: "group: 实验室",
    source: "local",
  };
  const longInstanceId = "fhl-enine@MCowBQYDK2Vw.d073ce70";
  const longPeerId = "12D3KooWLvw2N15n5dNWVAAARjpLif3w18JfwTr36k7rNJFW5AQA";
  const router = makeRouter({
    listInstances: [
      {
        instanceId: longInstanceId,
        peerId: longPeerId,
        instanceName: "fhl-enine",
        multiaddrs: [],
        pubkey: "MCowBQYDK2VwAyEAJGsrOQM6Ej08rAe2l8WlgwYp6tan5mAtvl4dVWyDASw",
        userPublicAttributes: [publicTag, publicProject],
        lastSeenAt: 1782287927147,
        lastAnnouncedAt: 1782287927066,
        source: "announce",
      },
      {
        instanceId: "XXMM-XM@MCowBQYDK2Vw.5e20fcfa",
        peerId: "12D3KooWLKhCXuddyxMYXiweBBL2vvXkj6aFsmrrMv3Fkq8bbpai",
        instanceName: "XXMM-XM",
        multiaddrs: [],
        userPublicAttributes: [],
        lastSeenAt: 1782287927382,
        lastAnnouncedAt: 1782287927315,
        source: "announce",
      },
    ],
  });

  const response = await listInstancesTool({
    router,
    connectedPeers: [longPeerId],
    localLabels: {
      [longInstanceId]: [localGroup],
    },
  }).execute("call-1", {});
  const text = response.content.map((item) => item.text).join("\n");

  assert.match(text, /Discovered OpenClaw instances: 2/);
  assert.match(text, new RegExp(longInstanceId));
  assert.match(text, new RegExp(longPeerId));
  assert.doesNotMatch(text, /12D3Koo\.\.\./);
  assert.match(text, /connected: true/);
  assert.match(text, /userPublicAttributes:/);
  assert.match(text, /kind: tag/);
  assert.match(text, /value: P2P/);
  assert.match(text, /source: USER\.md/);
  assert.match(text, /kind: structured/);
  assert.match(text, /key: project/);
  assert.match(text, /value: libp2p-mesh/);
  assert.match(text, /localLabels \(local private labels; not broadcast\):/);
  assert.match(text, /key: group/);
  assert.match(text, /value: 实验室/);
  assert.match(text, /source: local/);
  assert.match(text, /userPublicAttributes: none/);
  assert.match(text, /localLabels: none \(local private labels; not broadcast\)/);
  assert.deepEqual(response.details.instances[0].userPublicAttributes, [publicTag, publicProject]);
  assert.deepEqual(response.details.instances[0].localLabels, [localGroup]);
});

test("list instances tool prefers record local label snapshots over store labels", async () => {
  const recordLabel: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "record",
    label: "group: record",
    source: "record",
  };
  const storeLabel: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "store",
    label: "group: store",
    source: "store",
  };
  const instanceId = "alpha@MCowBQYDK2Vw.11111111";
  const router = makeRouter({
    listInstances: [
      {
        instanceId,
        peerId: "peer-alpha",
        instanceName: "alpha",
        multiaddrs: [],
        userPublicAttributes: [],
        localLabels: [recordLabel],
        lastSeenAt: 1782287927147,
        lastAnnouncedAt: 1782287927066,
        source: "announce",
      },
    ],
  });

  const response = await listInstancesTool({
    router,
    localLabels: {
      [instanceId]: [storeLabel],
    },
  }).execute("call-1", {});
  const text = response.content.map((item) => item.text).join("\n");

  assert.match(text, /localLabels \(local private labels; not broadcast\):/);
  assert.match(text, /value: record/);
  assert.doesNotMatch(text, /value: store/);
  assert.deepEqual(response.details.instances[0].localLabels, [recordLabel]);
});

test("list instances tool falls back to store labels when record has no local labels", async () => {
  const storeLabel: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "store",
    label: "group: store",
    source: "store",
  };
  const instanceId = "beta@MCowBQYDK2Vw.22222222";
  const router = makeRouter({
    listInstances: [
      {
        instanceId,
        peerId: "peer-beta",
        instanceName: "beta",
        multiaddrs: [],
        userPublicAttributes: [],
        localLabels: [],
        lastSeenAt: 1782287927147,
        lastAnnouncedAt: 1782287927066,
        source: "announce",
      },
    ],
  });

  const response = await listInstancesTool({
    router,
    localLabels: {
      [instanceId]: [storeLabel],
    },
  }).execute("call-1", {});
  const text = response.content.map((item) => item.text).join("\n");

  assert.match(text, /localLabels \(local private labels; not broadcast\):/);
  assert.match(text, /value: store/);
  assert.deepEqual(response.details.instances[0].localLabels, [storeLabel]);
});

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

test("send user attribute tool exposes selector schema and allows sending immediately after dry run", () => {
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
  assert.doesNotMatch(tool.description, /confirm/i);
  assert.equal(tool.parameters.type, "object");
  assert.deepEqual(tool.parameters.required, ["message"]);
  assert.deepEqual(tool.parameters.anyOf, [{ required: ["selector"] }, { required: ["match"] }]);
  assert.ok(tool.parameters.properties.selector);
  assert.ok(tool.parameters.properties.match);
  assert.ok(tool.parameters.properties.message);
  assert.ok(tool.parameters.properties.dryRun);
  assert.match(tool.description, /scope/i);
  assert.match(tool.description, /default(?:s)? to public/i);
  assert.deepEqual(tool.parameters.properties.scope, {
    type: "string",
    enum: ["public", "local", "all"],
    description:
      "Attribute source to match: public announced attributes, local peer labels, or both. Defaults to public.",
  });
});

test("send user attribute tool parses structured selector", async () => {
  const calls: Parameters<InstanceRouter["sendUserAttributeMessage"]>[] = [];
  const response = await userAttributeTool(
    makeUserAttributeRouter(async (...args) => {
      calls.push(args);
      return {
        scope: "local",
        matched: 1,
        sent: 0,
        delivered: 0,
        failed: 0,
        targets: [],
      };
    }),
  ).execute("call-1", {
    selector: "group=实验室",
    message: "今晚 8 点同步一下进展",
    dryRun: true,
  });

  assert.equal(response.isError, undefined);
  assert.equal(response.details.scope, "local");
  assert.deepEqual(calls[0], [
    { kind: "structured", key: "group", value: "实验室" },
    "今晚 8 点同步一下进展",
    { dryRun: true },
  ]);
});

test("send user attribute tool passes scope to router", async () => {
  const calls: Parameters<InstanceRouter["sendUserAttributeMessage"]>[] = [];
  const response = await userAttributeTool(
    makeUserAttributeRouter(async (...args) => {
      calls.push(args);
      return {
        matched: 1,
        sent: 0,
        delivered: 0,
        failed: 0,
        targets: [],
      };
    }),
  ).execute("call-1", {
    selector: "group=实验室",
    scope: "local",
    message: "今晚 8 点同步一下进展",
    dryRun: true,
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(calls[0], [
    { kind: "structured", key: "group", value: "实验室" },
    "今晚 8 点同步一下进展",
    { dryRun: true, scope: "local" },
  ]);
});

test("send user attribute tool rejects invalid scope without calling router", async () => {
  let called = false;
  const response = await userAttributeTool(
    makeUserAttributeRouter(async () => {
      called = true;
      throw new Error("should not call router");
    }),
  ).execute("call-1", {
    selector: "group=实验室",
    scope: "private",
    message: "今晚 8 点同步一下进展",
    dryRun: true,
  });

  assert.equal(called, false);
  assert.equal(response.isError, true);
  assert.match(response.content.map((item) => item.text).join("\n"), /scope must be "public", "local", or "all"/);
});

test("send user attribute tool parses tag selectors", async () => {
  const calls: Parameters<InstanceRouter["sendUserAttributeMessage"]>[] = [];
  const tool = userAttributeTool(
    makeUserAttributeRouter(async (...args) => {
      calls.push(args);
      return {
        matched: 1,
        sent: 0,
        delivered: 0,
        failed: 0,
        targets: [],
      };
    }),
  );

  await tool.execute("call-1", {
    selector: "#P2P",
    message: "hello team",
    dryRun: true,
  });
  await tool.execute("call-2", {
    selector: "tag:P2P",
    message: "hello team",
    dryRun: true,
  });

  assert.deepEqual(calls.map((call) => call[0]), [
    { kind: "tag", value: "P2P" },
    { kind: "tag", value: "P2P" },
  ]);
});

test("send user attribute tool rejects ambiguous bare selector", async () => {
  const response = await userAttributeTool(
    makeUserAttributeRouter(async () => {
      throw new Error("should not call router");
    }),
  ).execute("call-1", {
    selector: "实验室",
    message: "今晚 8 点同步一下进展",
    dryRun: true,
  });

  const text = response.content.map((item) => item.text).join("\n");

  assert.equal(response.isError, true);
  assert.match(text, /selector "实验室" is ambiguous/);
  assert.match(text, /group=实验室/);
  assert.match(text, /tag:实验室/);
});

test("send user attribute tool keeps legacy match parameter for compatibility", async () => {
  const calls: Parameters<InstanceRouter["sendUserAttributeMessage"]>[] = [];
  await userAttributeTool(
    makeUserAttributeRouter(async (...args) => {
      calls.push(args);
      return {
        matched: 1,
        sent: 0,
        delivered: 0,
        failed: 0,
        targets: [],
      };
    }),
  ).execute("call-1", {
    match: { kind: "structured", key: "group", value: "实验室" },
    message: "今晚 8 点同步一下进展",
    dryRun: true,
  });

  assert.deepEqual(calls[0][0], { kind: "structured", key: "group", value: "实验室" });
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
