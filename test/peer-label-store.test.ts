import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPeerLabelStore, resolvePeerLabelsPath } from "../src/peer-label-store.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-peer-labels-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolves default and OPENCLAW_STATE_DIR peer labels paths", async () => {
  const previous = process.env.OPENCLAW_STATE_DIR;
  try {
    delete process.env.OPENCLAW_STATE_DIR;
    assert.match(resolvePeerLabelsPath(), /\.openclaw[/\\]libp2p[/\\]peer-labels\.json$/);

    await withTempDir(async (stateDir) => {
      process.env.OPENCLAW_STATE_DIR = stateDir;
      assert.equal(
        resolvePeerLabelsPath(),
        path.join(stateDir, "libp2p", "peer-labels.json"),
      );
    });
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previous;
    }
  }
});

test("load returns an empty labels file when missing", async () => {
  await withTempDir(async (dir) => {
    const store = createPeerLabelStore({
      path: path.join(dir, "libp2p", "peer-labels.json"),
    });

    const labels = await store.load();

    assert.equal(labels.version, 1);
    assert.deepEqual(labels.peers, {});
    assert.equal(typeof labels.updatedAt, "number");
  });
});

test("load backs up corrupt JSON and returns empty labels", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "peer-labels.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not json", "utf8");

    const warnings: string[] = [];
    const store = createPeerLabelStore({
      path: filePath,
      logger: { warn: (message) => warnings.push(message) },
    });

    const labels = await store.load();
    const files = await readdir(path.dirname(filePath));

    assert.deepEqual(labels.peers, {});
    assert.equal(files.includes("peer-labels.json"), false);
    assert.equal(files.some((name) => /^peer-labels\.json\.corrupt-\d+$/.test(name)), true);
    assert.equal(warnings.length, 1);
  });
});

test("save normalizes labels deduplicates and removes empty peers", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "peer-labels.json");
    const store = createPeerLabelStore({ path: filePath });

    const saved = await store.save({
      version: 1,
      updatedAt: 1,
      peers: {
        "alice@abc.111": {
          labels: [
            { key: " Group ", value: " 实验室 " },
            { key: "group", value: "实验室" },
            { key: "project", value: " 小龙虾 " },
            { key: "", value: "ignored" },
          ],
        },
        "empty@abc.222": { labels: [] },
      },
    });
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    assert.deepEqual(saved.peers, {
      "alice@abc.111": {
        labels: [
          { key: "group", value: "实验室" },
          { key: "project", value: "小龙虾" },
        ],
      },
    });
    assert.deepEqual(parsed.peers, saved.peers);
    assert.equal(raw.endsWith("\n"), true);
    assert.equal((await readdir(path.dirname(filePath))).some((name) => name.includes(".tmp-")), false);
  });
});

test("listRawLabels returns normalized key value labels for an instance", async () => {
  await withTempDir(async (dir) => {
    const store = createPeerLabelStore({
      path: path.join(dir, "libp2p", "peer-labels.json"),
    });
    await store.save({
      version: 1,
      updatedAt: 1,
      peers: {
        "alice@abc.111": {
          labels: [
            { key: " group ", value: " 实验室 " },
            { key: "skill", value: "TypeScript" },
          ],
        },
      },
    });

    assert.deepEqual(await store.listRawLabels("alice@abc.111"), [
      { key: "group", value: "实验室" },
      { key: "skill", value: "TypeScript" },
    ]);
    assert.deepEqual(await store.listRawLabels("missing@abc.222"), []);
  });
});

test("replaceLabels and listLabels persist local structured attributes", async () => {
  await withTempDir(async (dir) => {
    const store = createPeerLabelStore({
      path: path.join(dir, "libp2p", "peer-labels.json"),
    });

    await store.replaceLabels("alice@abc.111", [
      { key: "group", value: "实验室" },
      { key: "skill", value: "TypeScript" },
    ]);

    assert.deepEqual(await store.listLabels("alice@abc.111"), [
      { kind: "structured", key: "group", value: "实验室", label: "实验室", source: "local" },
      {
        kind: "structured",
        key: "skill",
        value: "TypeScript",
        label: "TypeScript",
        source: "local",
      },
    ]);

    await store.replaceLabels("alice@abc.111", []);
    assert.deepEqual((await store.load()).peers, {});
  });
});
