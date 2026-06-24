import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createUserMdAgentAttributeSource,
  resolveUserMdAttributeCachePath,
  validateExtractedUserMdTags,
} from "../src/user-md-agent-attributes.js";
import type { UserPublicAttribute } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-user-md-agent-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolveUserMdAttributeCachePath uses OPENCLAW_STATE_DIR", async () => {
  const previous = process.env.OPENCLAW_STATE_DIR;
  try {
    await withTempDir(async (dir) => {
      process.env.OPENCLAW_STATE_DIR = dir;
      assert.equal(
        resolveUserMdAttributeCachePath(),
        path.join(dir, "libp2p", "user-md-attributes-cache.json"),
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

test("validateExtractedUserMdTags accepts only bounded USER.md tag attributes", () => {
  const valid: UserPublicAttribute = {
    kind: "tag",
    value: " P2P ",
    label: " P2P ",
    source: "USER.md",
  };

  assert.deepEqual(
    validateExtractedUserMdTags([
      valid,
      { kind: "tag", value: "P2P", label: "duplicate", source: "USER.md" },
      { kind: "tag", value: "随时告诉我。这个是句子", label: "bad", source: "USER.md" },
      { kind: "structured", key: "group", value: "实验室", label: "bad", source: "profile" },
      { kind: "tag", value: "profile", label: "bad", source: "profile" },
      { kind: "tag", value: "", label: "bad", source: "USER.md" },
    ]),
    [{ kind: "tag", value: "P2P", label: "P2P", source: "USER.md" }],
  );
});

test("refreshTags calls extractor once per USER.md hash and reuses cache", async () => {
  await withTempDir(async (dir) => {
    const userMdPath = path.join(dir, "workspace", "USER.md");
    const cachePath = path.join(dir, "libp2p", "user-md-attributes-cache.json");
    await mkdir(path.dirname(userMdPath), { recursive: true });
    await writeFile(userMdPath, "Name: ypp\nNotes: 正在做 P2P 项目\n", "utf8");
    let calls = 0;

    const source = createUserMdAgentAttributeSource({
      path: userMdPath,
      cachePath,
      extractor: {
        async extract() {
          calls += 1;
          return [{ kind: "tag", value: "P2P", label: "P2P", source: "USER.md" }];
        },
      },
    });

    assert.deepEqual(await source.loadTags(), []);
    assert.deepEqual(await source.refreshTags(), [
      { kind: "tag", value: "P2P", label: "P2P", source: "USER.md" },
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(await source.refreshTags(), [
      { kind: "tag", value: "P2P", label: "P2P", source: "USER.md" },
    ]);
    assert.equal(calls, 1);

    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    assert.equal(cache.version, 1);
    assert.equal(cache.attributes[0].value, "P2P");
  });
});

test("refreshTags skips USER.md tags and warns when extractor is unavailable", async () => {
  await withTempDir(async (dir) => {
    const userMdPath = path.join(dir, "workspace", "USER.md");
    await mkdir(path.dirname(userMdPath), { recursive: true });
    await writeFile(userMdPath, "Name: fhl\nContext\n刚认识，还在了解中。\n", "utf8");

    const warnings: string[] = [];
    const source = createUserMdAgentAttributeSource({
      path: userMdPath,
      cachePath: path.join(dir, "libp2p", "user-md-attributes-cache.json"),
      logger: { warn: (message) => warnings.push(message) },
      extractor: {
        async extract() {
          return { unavailable: true, reason: "runtime extraction unavailable" };
        },
      },
    });

    assert.deepEqual(await source.refreshTags(), []);
    assert.equal(warnings.some((message) => message.includes("runtime extraction unavailable")), true);
  });
});

test("concurrent refreshTags writes use collision-resistant cache temp paths", async () => {
  const originalNow = Date.now;
  Date.now = () => 1234567890;
  try {
    await withTempDir(async (dir) => {
      const userMdPath = path.join(dir, "workspace", "USER.md");
      const cachePath = path.join(dir, "libp2p", "user-md-attributes-cache.json");
      await mkdir(path.dirname(userMdPath), { recursive: true });
      await writeFile(userMdPath, "Name: ypp\nNotes: P2P\n", "utf8");

      let waiting = 0;
      let releaseExtractors: () => void = () => {};
      const bothExtractorsStarted = new Promise<void>((resolve) => {
        releaseExtractors = resolve;
      });
      const source = createUserMdAgentAttributeSource({
        path: userMdPath,
        cachePath,
        extractor: {
          async extract() {
            waiting += 1;
            if (waiting === 2) {
              releaseExtractors();
            }
            await bothExtractorsStarted;
            return [{ kind: "tag", value: "P2P", label: "P2P", source: "USER.md" }];
          },
        },
      });

      const results = await Promise.allSettled([source.refreshTags(), source.refreshTags()]);

      assert.deepEqual(
        results.map((result) => result.status),
        ["fulfilled", "fulfilled"],
      );
      const cache = JSON.parse(await readFile(cachePath, "utf8"));
      assert.equal(cache.version, 1);
      assert.equal(cache.attributes[0].value, "P2P");
    });
  } finally {
    Date.now = originalNow;
  }
});
