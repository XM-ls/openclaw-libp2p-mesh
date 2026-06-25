import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createInstancePeerStore } from "../src/instance-peer-store.js";
import type {
  InstanceAnnouncePayload,
  LocalPeerLabelAttribute,
  UserPublicAttribute,
} from "../src/types.js";

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

function localLabel(fields: Partial<LocalPeerLabelAttribute> = {}): LocalPeerLabelAttribute {
  return {
    kind: "structured",
    key: "group",
    value: "实验室",
    label: "实验室",
    source: "local",
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

test("load normalizes localLabels and drops invalid entries", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "instance-peer.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        updatedAt: 1,
        instances: {
          "remote-instance": {
            ...announce({ announcedAt: 10 }),
            lastSeenAt: 10,
            lastAnnouncedAt: 10,
            source: "announce",
            localLabels: [
              { kind: "structured", key: "group", value: " 实验室 ", label: "实验室", source: "local" },
              { kind: "tag", value: "bad", label: "bad", source: "local" },
              { kind: "structured", key: "", value: "bad", label: "bad", source: "local" }
            ],
          },
        },
      }),
      "utf8",
    );
    const store = createInstancePeerStore({ path: filePath });

    const record = await store.resolve("remote-instance");

    assert.deepEqual(record?.localLabels, [localLabel()]);
  });
});

test("upsertFromAnnounce preserves existing localLabels snapshot", async () => {
  await withTempDir(async (dir) => {
    const store = createInstancePeerStore({
      path: path.join(dir, "libp2p", "instance-peer.json"),
    });

    await store.upsertFromAnnounce(announce({ announcedAt: 10 }));
    await store.updateLocalLabels("remote-instance", [localLabel()]);
    await store.upsertFromAnnounce(announce({ announcedAt: 11, multiaddrs: ["/ip4/127.0.0.1/tcp/1"] }));

    assert.deepEqual((await store.resolve("remote-instance"))?.localLabels, [localLabel()]);
  });
});

test("syncLocalLabels refreshes existing records and does not create unknown records", async () => {
  await withTempDir(async (dir) => {
    const store = createInstancePeerStore({
      path: path.join(dir, "libp2p", "instance-peer.json"),
    });

    await store.upsertFromAnnounce(announce({ announcedAt: 10 }));
    await store.syncLocalLabels({
      "remote-instance": [localLabel()],
      "unknown-instance": [localLabel({ value: "ignored", label: "ignored" })],
    });

    const table = await store.load();
    assert.deepEqual(table.instances["remote-instance"]?.localLabels, [localLabel()]);
    assert.equal(table.instances["unknown-instance"], undefined);
  });
});

test("updateLocalLabels removes snapshot when labels are empty", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "instance-peer.json");
    const store = createInstancePeerStore({ path: filePath });

    await store.upsertFromAnnounce(announce({ announcedAt: 10 }));
    await store.updateLocalLabels("remote-instance", [localLabel()]);
    await store.updateLocalLabels("remote-instance", []);

    const raw = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal("localLabels" in raw.instances["remote-instance"], false);
  });
});
