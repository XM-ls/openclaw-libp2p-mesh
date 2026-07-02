import assert from "node:assert/strict";
import test from "node:test";
import { planPeerDiscovery } from "../src/mesh.js";

test("planPeerDiscovery enables mDNS and DHT by default without bootstrap entries", () => {
  assert.deepEqual(planPeerDiscovery({}), {
    useMDNS: true,
    bootstrapList: [],
    enableDHT: true,
  });
});

test("planPeerDiscovery keeps mDNS enabled when bootstrap entries are configured", () => {
  const bootstrapList = ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"];

  assert.deepEqual(planPeerDiscovery({ bootstrapList }), {
    useMDNS: true,
    bootstrapList,
    enableDHT: true,
  });
});

test("planPeerDiscovery honors explicit discovery opt-outs", () => {
  assert.deepEqual(planPeerDiscovery({ enableMDNS: false, enableDHT: false }), {
    useMDNS: false,
    bootstrapList: [],
    enableDHT: false,
  });
});
