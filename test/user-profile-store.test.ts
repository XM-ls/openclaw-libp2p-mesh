import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createUserProfileStore,
  getUserProfileAttributeId,
  resolveUserProfilePath,
} from "../src/user-profile-store.js";
import type { UserPublicAttribute } from "../src/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-profile-store-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function structured(
  key: string,
  value: string,
  label = value,
): UserPublicAttribute {
  return {
    kind: "structured",
    key,
    value,
    label,
    source: "profile",
  };
}

test("resolves default and OPENCLAW_STATE_DIR profile paths", async () => {
  const previous = process.env.OPENCLAW_STATE_DIR;
  try {
    delete process.env.OPENCLAW_STATE_DIR;
    assert.match(resolveUserProfilePath(), /\.openclaw[/\\]libp2p[/\\]user-profile\.json$/);

    await withTempDir(async (stateDir) => {
      process.env.OPENCLAW_STATE_DIR = stateDir;
      assert.equal(
        resolveUserProfilePath(),
        path.join(stateDir, "libp2p", "user-profile.json"),
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

test("load returns an empty profile when the file does not exist", async () => {
  await withTempDir(async (dir) => {
    const store = createUserProfileStore({
      path: path.join(dir, "libp2p", "user-profile.json"),
    });

    const profile = await store.load();

    assert.equal(profile.version, 1);
    assert.equal(profile.attributes.length, 0);
    assert.equal(typeof profile.updatedAt, "number");
  });
});

test("load backs up corrupt JSON and returns an empty profile", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "user-profile.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not json", "utf8");

    const warnings: string[] = [];
    const store = createUserProfileStore({
      path: filePath,
      logger: { warn: (message) => warnings.push(message) },
    });

    const profile = await store.load();
    const files = await readdir(path.dirname(filePath));

    assert.deepEqual(profile.attributes, []);
    assert.equal(files.includes("user-profile.json"), false);
    assert.equal(files.some((name) => /^user-profile\.json\.corrupt-\d+$/.test(name)), true);
    assert.equal(warnings.length, 1);
  });
});

test("save writes only normalized structured attributes and deduplicates duplicates", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "user-profile.json");
    const store = createUserProfileStore({ path: filePath });

    const saved = await store.save({
      version: 1,
      updatedAt: 1,
      attributes: [
        structured(" Group ", " 实验室 ", " 实验室成员 "),
        structured("group", "实验室", "duplicate"),
        structured("skill", " TypeScript ", " TypeScript "),
        { kind: "tag", value: "ResearchLoop", label: "ResearchLoop", source: "USER.md" },
      ],
    });
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    assert.deepEqual(saved.attributes, [
      structured("group", "实验室", "实验室成员"),
      structured("skill", "TypeScript", "TypeScript"),
    ]);
    assert.deepEqual(parsed.attributes, saved.attributes);
    assert.equal(raw.endsWith("\n"), true);
    assert.equal((await readdir(path.dirname(filePath))).some((name) => name.includes(".tmp-")), false);
  });
});

test("replaceAttributes and listAttributes persist structured attributes", async () => {
  await withTempDir(async (dir) => {
    const store = createUserProfileStore({
      path: path.join(dir, "libp2p", "user-profile.json"),
    });

    await store.replaceAttributes([
      structured("project", "Mesh", "Mesh"),
      { kind: "tag", value: "ignored", label: "ignored", source: "USER.md" },
    ]);

    assert.deepEqual(await store.listAttributes(), [structured("project", "Mesh", "Mesh")]);
  });
});

test("updates and removes structured attributes by stable id or index", async () => {
  await withTempDir(async (dir) => {
    const store = createUserProfileStore({
      path: path.join(dir, "libp2p", "user-profile.json"),
    });
    await store.replaceAttributes([
      structured("group", "lab", "Lab"),
      structured("skill", "typescript", "TypeScript"),
    ]);

    const skillId = getUserProfileAttributeId(structured("Skill", " TypeScript ", "ignored"));
    await store.updateAttribute(skillId, structured("skill", "rust", "Rust"));
    await store.removeAttribute(0);

    assert.deepEqual(await store.listAttributes(), [structured("skill", "rust", "Rust")]);
  });
});
