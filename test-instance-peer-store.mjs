import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    userPublicAttributes: [
      {
        kind: "tag",
        value: "ResearchLoop",
        label: "ResearchLoop",
        source: "USER.md",
      },
      {
        kind: "structured",
        key: "project",
        value: "libp2p-mesh",
        label: "libp2p-mesh",
        source: "profile",
      },
    ],
    announcedAt: 100,
  };

  const first = await store.upsertFromAnnounce(alice);
  assert.equal(first.changed, true);
  assert.equal(first.record.peerId, "peer-a");
  assert.deepEqual(first.record.userPublicAttributes, alice.userPublicAttributes);

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].instanceId, "alice@abc.123");

  const resolved = await store.resolve("alice@abc.123");
  assert.equal(resolved?.peerId, "peer-a");

  const identical = await store.upsertFromAnnounce(alice);
  assert.equal(identical.changed, false);

  const attributesChanged = await store.upsertFromAnnounce({
    ...alice,
    userPublicAttributes: [
      ...alice.userPublicAttributes,
      {
        kind: "structured",
        key: "role",
        value: "maintainer",
        label: "maintainer",
        source: "profile",
      },
    ],
  });
  assert.equal(attributesChanged.changed, true);

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
  assert.deepEqual(saved.instances["alice@abc.123"].userPublicAttributes, alice.userPublicAttributes);

  const legacyDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-instance-store-"));
  const legacyPath = path.join(legacyDir, "libp2p", "instance-peer.json");
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(
    legacyPath,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: 1,
        instances: {
          "legacy@abc.123": {
            instanceId: "legacy@abc.123",
            peerId: "peer-legacy",
            multiaddrs: [],
            lastSeenAt: 1,
            lastAnnouncedAt: 1,
            source: "announce",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const legacyStore = createInstancePeerStore({
    path: legacyPath,
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
  });
  const legacyRecord = await legacyStore.resolve("legacy@abc.123");
  assert.deepEqual(legacyRecord?.userPublicAttributes, []);

  const legacyAnnounce = await store.upsertFromAnnounce({
    instanceId: "legacy-announce@abc.123",
    peerId: "peer-legacy-announce",
    multiaddrs: [],
    announcedAt: 200,
  });
  assert.deepEqual(legacyAnnounce.record.userPublicAttributes, []);

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

  const concurrentDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-instance-store-"));
  const concurrentStore = createInstancePeerStore({
    path: path.join(concurrentDir, "libp2p", "instance-peer.json"),
    logger: { warn: () => {}, info: () => {}, debug: () => {} },
  });
  await Promise.all([
    concurrentStore.upsertFromAnnounce({
      instanceId: "parallel-a@abc.123",
      peerId: "peer-parallel-a",
      instanceName: "parallel-a",
      multiaddrs: [],
      pubkey: "pub-pa",
      announcedAt: 1,
    }),
    concurrentStore.upsertFromAnnounce({
      instanceId: "parallel-b@abc.123",
      peerId: "peer-parallel-b",
      instanceName: "parallel-b",
      multiaddrs: [],
      pubkey: "pub-pb",
      announcedAt: 1,
    }),
  ]);
  const concurrentList = await concurrentStore.list();
  assert.equal(concurrentList.length, 2);

  console.log("test-instance-peer-store: all assertions passed");
}

await runTests();
