import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createInstancePeerStore,
  resolveInstancePeerPath,
} from "./src/instance-peer-store.js";

async function runTests() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-instance-store-"));
  const filePath = path.join(dir, "libp2p", "instance-peer.json");
  const warnings = [];
  const store = createInstancePeerStore({
    path: filePath,
    logger: {
      info: () => {},
      debug: () => {},
      warn: (message) => warnings.push(message),
    },
  });

  const empty = await store.load();
  assert.equal(empty.version, 1);
  assert.deepEqual(empty.instances, {});

  const alice = {
    instanceId: "alice@abc.123",
    instanceName: "alice",
    peerId: "peer-a",
    pubkey: "pub-a",
    multiaddrs: ["/ip4/127.0.0.1/tcp/10000/p2p/peer-a"],
    announcedAt: 100,
  };

  const first = await store.upsertFromAnnounce(alice);
  assert.equal(first.changed, true);
  assert.equal(first.record.peerId, "peer-a");

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].instanceId, "alice@abc.123");

  const resolved = await store.resolve("alice@abc.123");
  assert.equal(resolved?.peerId, "peer-a");

  const identical = await store.upsertFromAnnounce(alice);
  assert.equal(identical.changed, false);

  const moved = await store.upsertFromAnnounce({
    ...alice,
    peerId: "peer-a2",
    multiaddrs: ["/ip4/127.0.0.1/tcp/10001/p2p/peer-a2"],
  });
  assert.equal(moved.changed, true);
  assert.equal(moved.record.peerId, "peer-a2");

  const copy = await store.upsertFromAnnounce({
    ...alice,
    instanceId: "alice-copy@abc.123",
    peerId: "peer-a2",
    pubkey: "pub-copy",
    multiaddrs: [],
  });
  assert.equal(copy.changed, true);
  assert.deepEqual(copy.peerIdSharedBy.sort(), [
    "alice-copy@abc.123",
    "alice@abc.123",
  ].sort());
  assert.ok(warnings.some((message) => message.includes("peer-a2")));

  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(saved.version, 1);
  assert.equal(saved.instances["alice@abc.123"].peerId, "peer-a2");

  await writeFile(filePath, "{ corrupt json", "utf8");
  warnings.length = 0;
  const recovered = await store.load();
  assert.equal(recovered.version, 1);
  assert.deepEqual(recovered.instances, {});
  assert.ok(warnings.some((message) => message.includes(".corrupt-")));

  assert.ok(
    resolveInstancePeerPath().endsWith(
      path.join(".openclaw", "libp2p", "instance-peer.json"),
    ),
  );

  console.log("test-instance-peer-store: all assertions passed");
}

await runTests();
