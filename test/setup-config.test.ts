import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDefaultMeshConfig,
  buildNetworkEntryConfig,
  buildNetworkConfig,
  buildPublicRelayNodeConfig,
  DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  planInboundTargetSync,
} from "../src/setup-config.js";

test("applyDefaultMeshConfig returns automatic network defaults for missing config", () => {
  assert.deepEqual(applyDefaultMeshConfig(undefined), {
    discovery: "mdns",
    enableNATTraversal: true,
    enableDHT: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});

test("applyDefaultMeshConfig preserves explicit user network fields", () => {
  assert.deepEqual(
    applyDefaultMeshConfig({
      discovery: "bootstrap",
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
      enableDHT: false,
      enableNATTraversal: false,
      deliveryAckTimeoutMs: 30000,
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
      announceAddrs: ["/ip4/9.9.9.9/tcp/4001"],
    }),
    {
      discovery: "bootstrap",
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
      enableDHT: false,
      enableNATTraversal: false,
      deliveryAckTimeoutMs: 30000,
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
      announceAddrs: ["/ip4/9.9.9.9/tcp/4001"],
    },
  );
});

test("applyDefaultMeshConfig preserves inbound delivery configuration", () => {
  assert.deepEqual(
    applyDefaultMeshConfig({
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
      inboundChannel: "telegram",
      inboundTarget: "chat:123",
    }),
    {
      discovery: "mdns",
      enableNATTraversal: true,
      enableDHT: true,
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
      inboundChannel: "telegram",
      inboundTarget: "chat:123",
    },
  );
});

test("applyDefaultMeshConfig treats non-object config as missing config", () => {
  assert.deepEqual(applyDefaultMeshConfig("bad" as never), {
    discovery: "mdns",
    enableNATTraversal: true,
    enableDHT: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});

test("buildNetworkConfig returns LAN discovery config", () => {
  assert.deepEqual(buildNetworkConfig("lan"), {
    discovery: "mdns",
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});

test("buildNetworkEntryConfig omits empty bootstrap and relay lists", () => {
  assert.deepEqual(buildNetworkEntryConfig({ bootstrapList: [], relayList: [] }), {
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});

test("buildNetworkEntryConfig writes provided entry address lists without discovery mode", () => {
  assert.deepEqual(
    buildNetworkEntryConfig({
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
    }),
    {
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    },
  );
});

test("buildPublicRelayNodeConfig enables relay server with optional announce address", () => {
  assert.deepEqual(
    buildPublicRelayNodeConfig({
      enabled: true,
      listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
      announceAddrs: [],
    }),
    {
      listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
      enableCircuitRelayServer: true,
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    },
  );
});

test("buildPublicRelayNodeConfig disables relay server without touching entry addresses", () => {
  assert.deepEqual(buildPublicRelayNodeConfig({ enabled: false }), {
    enableCircuitRelayServer: false,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});

test("planInboundTargetSync preserves existing targets and reports missing channels", () => {
  const result = planInboundTargetSync(
    [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    ["feishu", "telegram", "qqbot"],
  );

  assert.deepEqual(result.targets, [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
  ]);
  assert.deepEqual(result.missingChannels, ["telegram", "qqbot"]);
});

test("planInboundTargetSync preserves multiple same-channel targets and ignores exact duplicates", () => {
  const result = planInboundTargetSync(
    [
      { id: "feishu-main", channel: " feishu ", target: " user:ou_xxx " },
      { id: "feishu-duplicate", channel: "feishu", target: "user:ou_xxx" },
      { id: "feishu-backup", channel: "feishu", target: "user:ou_backup" },
      { id: "telegram-main", channel: "telegram", target: "chat:123456" },
    ],
    ["libp2p-mesh", "feishu", "telegram"],
  );

  assert.deepEqual(result.targets, [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
    { id: "feishu-backup", channel: "feishu", target: "user:ou_backup" },
    { id: "telegram-main", channel: "telegram", target: "chat:123456" },
  ]);
  assert.deepEqual(result.missingChannels, []);
});

test("planInboundTargetSync reports channels with only invalid existing targets as missing", () => {
  const result = planInboundTargetSync(
    [
      { id: "feishu-blank-target", channel: "feishu", target: " " },
      { id: "blank-channel", channel: " ", target: "user:ou_xxx" },
    ],
    ["feishu"],
  );

  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.missingChannels, ["feishu"]);
});
