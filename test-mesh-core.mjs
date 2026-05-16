/**
 * Standalone mesh core test — no OpenClaw required.
 * Spins up two mesh nodes on the loopback interface via bootstrap discovery
 * and verifies direct messaging, broadcast, and peer listing.
 */
import { createMeshNetwork } from "./src/mesh.js";

const LOG = process.env.VERBOSE === "1";

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

  // ---------- Setup: create node A with fixed port ----------
  console.log("\n[Setup] Starting node A on 127.0.0.1:15001...");

  const nodeA = createMeshNetwork({
    config: {
      listenAddrs: ["/ip4/127.0.0.1/tcp/15001"],
      discovery: "mdns",
      meshTopic: "test-topic",
      peerIdPath: "/tmp/openclaw-mesh-test-peer-a.json",
    },
    logger: {
      info: LOG ? (m) => console.log(`[A] ${m}`) : () => {},
      debug: LOG ? (m) => console.log(`[A] ${m}`) : () => {},
      error: (m) => console.error(`[A] ${m}`),
    },
  });

  await nodeA.start();
  const peerIdA = nodeA.getLocalPeerId();
  const addrsA = nodeA.getMultiaddrs();
  // libp2p's getMultiaddrs() already includes /p2p/<peerId> when peerId is known
  const bootstrapAddrA = addrsA[0];

  console.log(`  Node A Peer ID: ${peerIdA}`);
  console.log(`  Node A bootstrap address: ${bootstrapAddrA}`);

  // ---------- Setup: create node B with bootstrap to A ----------
  console.log("\n[Setup] Starting node B, bootstrapping to node A...");

  const nodeB = createMeshNetwork({
    config: {
      listenAddrs: ["/ip4/127.0.0.1/tcp/0"],
      discovery: "mdns",
      meshTopic: "test-topic",
      peerIdPath: "/tmp/openclaw-mesh-test-peer-b.json",
    },
    logger: {
      info: LOG ? (m) => console.log(`[B] ${m}`) : () => {},
      debug: LOG ? (m) => console.log(`[B] ${m}`) : () => {},
      error: (m) => console.error(`[B] ${m}`),
    },
  });

  await nodeB.start();

  // Manually dial A from B (mDNS doesn't work on loopback)
  console.log("  B dialing A...");
  await nodeB.dial(bootstrapAddrA);
  const peerIdB = nodeB.getLocalPeerId();

  console.log(`  Node B Peer ID: ${peerIdB}`);

  assert(peerIdA.length > 0, "Node A has a Peer ID");
  assert(peerIdB.length > 0, "Node B has a Peer ID");
  assert(peerIdA !== peerIdB, "Two nodes have different Peer IDs");

  // Wait for dial to establish connection
  console.log("\n[Setup] Waiting for connection to establish...");
  await delay(1000);

  const peersA = nodeA.getConnectedPeers();
  const peersB = nodeB.getConnectedPeers();
  console.log(`  A connected peers: ${peersA.join(", ") || "(none)"}`);
  console.log(`  B connected peers: ${peersB.join(", ") || "(none)"}`);

  assert(peersA.includes(peerIdB), "A is connected to B");
  assert(peersB.includes(peerIdA), "B is connected to A");

  // ---------- Test 1: Direct message A -> B ----------
  console.log("\n[Test 1] Direct message from A to B...");

  const receivedByB = [];
  nodeB.onMessage((msg) => {
    receivedByB.push(msg);
  });

  await nodeA.sendToPeer(peerIdB, "Hello from A!");
  await delay(500);

  assert(receivedByB.length >= 1, "B received at least 1 message");
  assert(receivedByB[0].type === "direct", "Message type is 'direct'");
  assert(receivedByB[0].from === peerIdA, "Message sender is A's Peer ID");
  assert(receivedByB[0].to === peerIdB, "Message recipient is B's Peer ID");
  assert(receivedByB[0].payload === "Hello from A!", "Message payload is correct");
  assert(typeof receivedByB[0].id === "string" && receivedByB[0].id.length > 0, "Message has a valid ID");
  assert(typeof receivedByB[0].timestamp === "number", "Message has a timestamp");

  // ---------- Test 2: Direct message B -> A ----------
  console.log("\n[Test 2] Direct message from B to A...");

  const receivedByA = [];
  nodeA.onMessage((msg) => {
    receivedByA.push(msg);
  });

  await nodeB.sendToPeer(peerIdA, "Hello from B!");
  await delay(500);

  assert(receivedByA.length >= 1, "A received at least 1 message");
  const msgFromB = receivedByA.find((m) => m.payload === "Hello from B!");
  assert(msgFromB !== undefined, "A received the message from B");
  assert(msgFromB.from === peerIdB, "Message sender is B's Peer ID");

  // ---------- Test 3: Broadcast ----------
  console.log("\n[Test 3] Broadcast from A to topic 'test-topic'...");

  const broadcastReceivedByB = [];
  await nodeB.subscribeToTopic("test-topic", (payload) => {
    broadcastReceivedByB.push(payload);
  });

  const broadcastReceivedByA = [];
  await nodeA.subscribeToTopic("test-topic", (payload) => {
    broadcastReceivedByA.push(payload);
  });

  await delay(200);

  await nodeA.publishToTopic("test-topic", "Broadcast test");
  await delay(800);

  assert(broadcastReceivedByB.length >= 1, "B received the broadcast");
  assert(broadcastReceivedByB[0] === "Broadcast test", "Broadcast payload is correct");

  // ---------- Test 4: Handler unsubscribe ----------
  console.log("\n[Test 4] Handler unsubscribe...");

  const unsubReceived = [];
  const unsub = nodeB.onMessage((msg) => {
    unsubReceived.push(msg);
  });

  unsub(); // unsubscribe

  await nodeA.sendToPeer(peerIdB, "After unsubscribe");
  await delay(500);

  assert(!unsubReceived.some((m) => m.payload === "After unsubscribe"), "Unsubscribed handler does not receive messages");

  // ---------- Test 5: Multiaddrs ----------
  console.log("\n[Test 5] Multiaddrs...");

  assert(nodeA.getMultiaddrs().length > 0, "Node A has listening addresses");
  assert(nodeB.getMultiaddrs().length > 0, "Node B has listening addresses");
  assert(
    nodeA.getMultiaddrs().some((a) => a.includes("15001")),
    "Node A listens on the configured port"
  );

  // ---------- Cleanup ----------
  console.log("\n[Cleanup] Stopping nodes...");
  await nodeB.stop();
  await nodeA.stop();

  // ---------- Summary ----------
  console.log("\n" + "=".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("All tests passed!");
    process.exit(0);
  } else {
    console.error("Some tests failed.");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
