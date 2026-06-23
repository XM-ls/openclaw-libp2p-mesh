import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  applyPluginConfig,
  buildNetworkConfig,
  getLibp2pMeshConfig,
  mergeNetworkConfig,
  type OpenClawConfigLike,
} from "../src/setup-config.js";

test("applyPluginConfig creates plugins entry without writing channels entry", () => {
  const config: OpenClawConfigLike = {
    channels: {
      feishu: { enabled: true },
    },
  };

  const next = applyPluginConfig(config, buildNetworkConfig("lan"));

  assert.equal(next.plugins?.entries?.["libp2p-mesh"]?.enabled, true);
  assert.deepEqual(next.plugins?.entries?.["libp2p-mesh"]?.config, {
    discovery: "mdns",
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
  assert.equal(next.channels?.["libp2p-mesh"], undefined);
  assert.deepEqual(next.channels?.feishu, { enabled: true });
});

test("buildNetworkConfig supports lan tools-only cross-network and relay-node modes", () => {
  assert.deepEqual(buildNetworkConfig("lan"), {
    discovery: "mdns",
    deliveryAckTimeoutMs: 15000,
  });

  assert.deepEqual(buildNetworkConfig("tools-only"), {
    discovery: "mdns",
    inboundTargets: [],
    deliveryAckTimeoutMs: 15000,
  });

  assert.deepEqual(
    buildNetworkConfig("cross-network", {
      crossNetwork: {
        bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3bootstrap"],
        relayList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3relay"],
      },
    }),
    {
      discovery: "bootstrap",
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3bootstrap"],
      relayList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3relay"],
      enableNATTraversal: true,
      deliveryAckTimeoutMs: 15000,
    },
  );

  assert.deepEqual(
    buildNetworkConfig("relay-node", {
      relayNode: {
        listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
        announceAddrs: ["/ip4/203.0.113.10/tcp/4001"],
      },
    }),
    {
      discovery: "bootstrap",
      listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
      announceAddrs: ["/ip4/203.0.113.10/tcp/4001"],
      enableNATTraversal: true,
      enableCircuitRelayServer: true,
      deliveryAckTimeoutMs: 15000,
    },
  );
});

test("mergeNetworkConfig replaces network fields while preserving inbound targets", () => {
  const existing = {
    discovery: "bootstrap" as const,
    bootstrapList: ["/ip4/old/tcp/4001/p2p/old"],
    relayList: ["/ip4/relay/tcp/4001/p2p/relay"],
    listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
    announceAddrs: ["/ip4/203.0.113.10/tcp/4001"],
    enableNATTraversal: true,
    enableCircuitRelayServer: true,
    inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    deliveryAckTimeoutMs: 9000,
  };

  assert.deepEqual(mergeNetworkConfig(existing, buildNetworkConfig("lan")), {
    discovery: "mdns",
    inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    deliveryAckTimeoutMs: 15000,
  });
});

test("getLibp2pMeshConfig reads plugin entry config", () => {
  const config: OpenClawConfigLike = {
    plugins: {
      entries: {
        "libp2p-mesh": {
          enabled: true,
          config: {
            discovery: "mdns",
            deliveryAckTimeoutMs: 15000,
          },
        },
      },
    },
  };

  assert.deepEqual(getLibp2pMeshConfig(config), {
    discovery: "mdns",
    deliveryAckTimeoutMs: 15000,
  });
});
