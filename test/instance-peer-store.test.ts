import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createInstancePeerStore } from "../src/instance-peer-store.js";
import type { InstanceAnnouncePayload, UserPublicAttribute } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-instance-peer-store-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function announce(
  fields: Partial<InstanceAnnouncePayload> = {},
): InstanceAnnouncePayload {
  return {
    instanceId: "remote-instance",
    peerId: "remote-peer",
    instanceName: "remote",
    multiaddrs: [],
    pubkey: "remote-pubkey",
    announcedAt: 1,
    ...fields,
  };
}

test("upsertFromAnnounce preserves attributes when announce omits userPublicAttributes", async () => {
  await withTempDir(async (dir) => {
    const userMdTag: UserPublicAttribute = {
      kind: "tag",
      value: "ResearchLoop",
      label: "ResearchLoop",
      source: "USER.md",
    };
    const store = createInstancePeerStore({
      path: path.join(dir, "libp2p", "instance-peer.json"),
    });

    await store.upsertFromAnnounce(
      announce({ userPublicAttributes: [userMdTag], announcedAt: 10 }),
    );
    await store.upsertFromAnnounce(announce({ announcedAt: 11 }));

    assert.deepEqual(
      (await store.resolve("remote-instance"))?.userPublicAttributes,
      [userMdTag],
    );
  });
});

test("upsertFromAnnounce replaces attributes when announce includes explicit empty list", async () => {
  await withTempDir(async (dir) => {
    const userMdTag: UserPublicAttribute = {
      kind: "tag",
      value: "ResearchLoop",
      label: "ResearchLoop",
      source: "USER.md",
    };
    const store = createInstancePeerStore({
      path: path.join(dir, "libp2p", "instance-peer.json"),
    });

    await store.upsertFromAnnounce(
      announce({ userPublicAttributes: [userMdTag], announcedAt: 10 }),
    );
    await store.upsertFromAnnounce(
      announce({ userPublicAttributes: [], announcedAt: 11 }),
    );

    assert.deepEqual(
      (await store.resolve("remote-instance"))?.userPublicAttributes,
      [],
    );
  });
});
