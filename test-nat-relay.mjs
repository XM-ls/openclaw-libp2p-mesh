/**
 * Circuit Relay 协议链路 smoke test for openclaw-libp2p-mesh.
 *
 * This script does NOT verify real NAT traversal — there is no NAT on the
 * loopback interface. What it verifies is that the Circuit Relay v2
 * protocol path is correctly wired in the plugin:
 *
 *   - relay (R): runs Circuit Relay v2 SERVER + DCUtR.
 *   - client A and B: register R via `relayList` and obtain a
 *     `/p2p-circuit` reservation from R.
 *
 * After reservations are established, A dials B through R using a
 * `/p2p-circuit` address; messages are sent both ways and a topic
 * broadcast is exercised, all over the transient connection that the
 * relay path produces.
 *
 * Whether this protocol path actually defeats a real-world NAT must be
 * verified separately:
 *
 *   - Full end-to-end test with openclaw + plugin + simulated NAT (no cloud
 *     server required): see `test/nat-docker/` and `TESTING_NAT.md` test E.
 *   - Real cross-NAT real-machine deployment: see `TESTING_NAT.md` test C
 *     and `../../openclaw_add/openclaw-nat-3node-guide.md`.
 *
 * Run with:
 *   node --import tsx test-nat-relay.mjs
 *
 * Verbose mode:
 *   VERBOSE=1 node --import tsx test-nat-relay.mjs
 */

import { createMeshNetwork } from "./src/mesh.js";

const LOG = process.env.VERBOSE === "1";

function makeLogger(tag) {
  return {
    info: LOG ? (m) => console.log(`[${tag}] ${m}`) : () => {},
    debug: LOG ? (m) => console.log(`[${tag}] ${m}`) : () => {},
    warn: (m) => console.warn(`[${tag}] ${m}`),
    error: (m) => console.error(`[${tag}] ${m}`),
  };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg}`);
    }
  }

  // ------------------------------------------------------------------
  // 1. Start the relay node (acts like the public-IP cloud VM)
  // ------------------------------------------------------------------
  console.log("\n[Setup] Starting relay R on 127.0.0.1:15101...");

  const relay = createMeshNetwork({
    config: {
      listenAddrs: ["/ip4/127.0.0.1/tcp/15101"],
      discovery: "bootstrap",
      bootstrapList: [],
      peerIdPath: "/tmp/openclaw-mesh-nat-relay.json",
      // mDNS would auto-discover other LAN libp2p instances; turn off DHT
      // so we don't depend on any external network.
      enableDHT: false,
      enableUPnP: false,
      enableAutoNAT: false,
      enableCircuitRelay: true,
      enableCircuitRelayServer: true,
      enableDCUtR: true,
    },
    logger: makeLogger("R"),
  });

  await relay.start();
  const relayPeerId = relay.getLocalPeerId();
  const relayAddrs = relay.getMultiaddrs();
  const relayAddr = relayAddrs.find((a) => a.includes("15101")) ?? relayAddrs[0];

  console.log(`  Relay R Peer ID: ${relayPeerId}`);
  console.log(`  Relay R multiaddr: ${relayAddr}`);

  const relayStatus = relay.getNATStatus();
  assert(relayStatus.enabled.circuitRelayServer, "Relay runs circuit-relay v2 SERVER");
  assert(relayStatus.enabled.identify, "Relay runs identify service");
  assert(relayStatus.enabled.dcutr, "Relay runs DCUtR service");

  // ------------------------------------------------------------------
  // 2. Start client A (simulated NATed peer #1)
  // ------------------------------------------------------------------
  console.log("\n[Setup] Starting client A on 127.0.0.1:15102 with R as relay...");

  const clientA = createMeshNetwork({
    config: {
      listenAddrs: ["/ip4/127.0.0.1/tcp/15102"],
      discovery: "bootstrap",
      bootstrapList: [relayAddr],
      peerIdPath: "/tmp/openclaw-mesh-nat-client-a.json",
      enableDHT: false,
      enableUPnP: false,
      enableAutoNAT: true,
      enableCircuitRelay: true,
      enableCircuitRelayServer: false,
      enableDCUtR: true,
      relayList: [relayAddr],
    },
    logger: makeLogger("A"),
  });

  await clientA.start();
  const peerIdA = clientA.getLocalPeerId();
  console.log(`  Client A Peer ID: ${peerIdA}`);

  const statusA = clientA.getNATStatus();
  assert(statusA.enabled.circuitRelay, "Client A loads circuit-relay v2 transport");
  assert(statusA.enabled.dcutr, "Client A loads DCUtR service");
  assert(!statusA.enabled.circuitRelayServer, "Client A is NOT running as relay server");

  // ------------------------------------------------------------------
  // 3. Start client B
  // ------------------------------------------------------------------
  console.log("\n[Setup] Starting client B on 127.0.0.1:15103 with R as relay...");

  const clientB = createMeshNetwork({
    config: {
      listenAddrs: ["/ip4/127.0.0.1/tcp/15103"],
      discovery: "bootstrap",
      bootstrapList: [relayAddr],
      peerIdPath: "/tmp/openclaw-mesh-nat-client-b.json",
      enableDHT: false,
      enableUPnP: false,
      enableAutoNAT: true,
      enableCircuitRelay: true,
      enableCircuitRelayServer: false,
      enableDCUtR: true,
      relayList: [relayAddr],
    },
    logger: makeLogger("B"),
  });

  await clientB.start();
  const peerIdB = clientB.getLocalPeerId();
  console.log(`  Client B Peer ID: ${peerIdB}`);

  // ------------------------------------------------------------------
  // 4. Wait for both clients to acquire a relay reservation on R.
  //    The circuit-relay transport advertises a /p2p-circuit listen
  //    address once a reservation is granted.
  // ------------------------------------------------------------------
  console.log("\n[Setup] Waiting for relay reservations to be established...");
  let reservationDeadline = Date.now() + 10_000;
  while (Date.now() < reservationDeadline) {
    if (
      clientA.getNATStatus().hasRelayedListenAddr &&
      clientB.getNATStatus().hasRelayedListenAddr
    ) {
      break;
    }
    await delay(500);
  }

  const reservedA = clientA.getNATStatus().reservedRelays;
  const reservedB = clientB.getNATStatus().reservedRelays;
  console.log(`  A reserved relays: ${reservedA.join(", ") || "(none)"}`);
  console.log(`  B reserved relays: ${reservedB.join(", ") || "(none)"}`);

  assert(reservedA.length > 0, "Client A has at least one /p2p-circuit listen address");
  assert(reservedB.length > 0, "Client B has at least one /p2p-circuit listen address");

  // ------------------------------------------------------------------
  // 5. Have A dial B through the relay.
  //    Address format: /ip4/<relay-ip>/tcp/<relay-port>/p2p/<relay-id>/p2p-circuit/p2p/<target-id>
  // ------------------------------------------------------------------
  const circuitToB = `${relayAddr}/p2p-circuit/p2p/${peerIdB}`;
  console.log(`\n[Setup] A dialling B via relay: ${circuitToB}`);

  await clientA.dial(circuitToB);
  await delay(1500);

  const aPeers = clientA.getConnectedPeers();
  const bPeers = clientB.getConnectedPeers();
  console.log(`  A connected peers: ${aPeers.join(", ")}`);
  console.log(`  B connected peers: ${bPeers.join(", ")}`);

  assert(aPeers.includes(peerIdB), "A connected to B (via relay)");
  assert(bPeers.includes(peerIdA), "B connected to A (via relay)");

  // ------------------------------------------------------------------
  // 6. Send a message A -> B over the relayed connection
  // ------------------------------------------------------------------
  console.log("\n[Test] Direct message A -> B over relayed connection...");

  const receivedByB = [];
  clientB.onMessage((msg) => receivedByB.push(msg));

  await clientA.sendToPeer(peerIdB, "Hello B, via relay R!");
  await delay(1500);

  const msgAB = receivedByB.find((m) => m.payload === "Hello B, via relay R!");
  assert(msgAB !== undefined, "B received the message from A through the relay");
  if (msgAB) {
    assert(msgAB.type === "direct", "Message type is 'direct'");
    assert(msgAB.from === peerIdA, "Message sender is A");
    assert(msgAB.to === peerIdB, "Message recipient is B");
  }

  // ------------------------------------------------------------------
  // 7. Reverse direction B -> A
  // ------------------------------------------------------------------
  console.log("\n[Test] Direct message B -> A over the same connection...");

  const receivedByA = [];
  clientA.onMessage((msg) => receivedByA.push(msg));

  await clientB.sendToPeer(peerIdA, "Hello A, replying through R");
  await delay(1500);

  const msgBA = receivedByA.find((m) => m.payload === "Hello A, replying through R");
  assert(msgBA !== undefined, "A received the message from B");
  if (msgBA) {
    assert(msgBA.from === peerIdB, "Message sender is B");
  }

  // ------------------------------------------------------------------
  // 8. Topic broadcast over the mesh
  // ------------------------------------------------------------------
  console.log("\n[Test] Broadcast on topic 'nat-test'...");

  const broadcastReceivedByB = [];
  await clientB.subscribeToTopic("nat-test", (p) => broadcastReceivedByB.push(p));
  await delay(200);

  await clientA.publishToTopic("nat-test", "hi everyone behind a NAT");
  await delay(1500);

  assert(
    broadcastReceivedByB.includes("hi everyone behind a NAT"),
    "B received the broadcast on topic 'nat-test'",
  );

  // ------------------------------------------------------------------
  // 9. Cleanup
  // ------------------------------------------------------------------
  console.log("\n[Cleanup] Stopping all nodes...");
  await clientA.stop();
  await clientB.stop();
  await relay.stop();

  // ------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("Circuit Relay 协议链路 smoke test passed.");
    process.exit(0);
  } else {
    console.error("Circuit Relay 协议链路 smoke test failed.");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
