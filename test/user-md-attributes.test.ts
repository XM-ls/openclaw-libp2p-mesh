import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createUserMdAttributeSource,
  extractUserMdTags,
} from "../src/user-md-attributes.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-user-md-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadTags returns no tags when USER.md does not exist", async () => {
  await withTempDir(async (dir) => {
    const warnings: string[] = [];
    const source = createUserMdAttributeSource({
      path: path.join(dir, "USER.md"),
      logger: { warn: (message) => warnings.push(message) },
    });

    assert.deepEqual(await source.loadTags(), []);
    assert.deepEqual(await readdir(dir), []);
    assert.deepEqual(warnings, []);
  });
});

test("loadTags returns no tags and warns when USER.md cannot be read", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "USER.md");
    await mkdir(filePath);
    const warnings: string[] = [];
    const source = createUserMdAttributeSource({
      path: filePath,
      logger: { warn: (message) => warnings.push(message) },
    });

    assert.deepEqual(await source.loadTags(), []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /USER\.md/i);
  });
});

test("loadTags reads USER.md without modifying it or writing profile data", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "USER.md");
    const markdown = [
      "# USER",
      "",
      "Name: Yao",
      "Notes: 我在实验室做项目。",
      "Skills: ResearchLoop, TypeScript",
    ].join("\n");
    await writeFile(filePath, markdown, "utf8");
    const before = await stat(filePath);

    const source = createUserMdAttributeSource({ path: filePath });
    const tags = await source.loadTags();
    const after = await stat(filePath);

    assert.ok(tags.some((tag) => tag.value === "实验室"));
    assert.ok(tags.some((tag) => tag.value === "ResearchLoop"));
    assert.ok(tags.some((tag) => tag.value === "TypeScript"));
    assert.equal(await readFile(filePath, "utf8"), markdown);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.deepEqual((await readdir(dir)).sort(), ["USER.md"]);
  });
});

test("extractUserMdTags filters template placeholders and empty profile text", () => {
  const markdown = [
    "# USER",
    "",
    "Name: [Your name]",
    "What to call them: TODO",
    "Notes: Add notes here. This is a template placeholder.",
    "Context: N/A",
  ].join("\n");

  assert.deepEqual(extractUserMdTags(markdown), []);
});

test("extractUserMdTags does not treat ordinary Chinese notes as public tags", () => {
  assert.deepEqual(extractUserMdTags("Notes: 今天晚上八点同步一下进展"), []);
});

test("extractUserMdTags does not expose capitalized words from ordinary English notes", () => {
  const tags = extractUserMdTags(
    "Notes: Meeting with Bob about Salary Review and SecretProject tonight.",
  );
  const values = tags.map((tag) => tag.value);

  assert.equal(values.includes("Meeting"), false);
  assert.equal(values.includes("Bob"), false);
  assert.equal(values.includes("Salary"), false);
  assert.equal(values.includes("Review"), false);
  assert.equal(values.includes("SecretProject"), false);
});

test("extractUserMdTags extracts conservative short tags from natural language", () => {
  const tags = extractUserMdTags([
    "# USER",
    "",
    "Name: Yao",
    "What to call them: Yao",
    "Notes: 我在实验室做项目。",
    "Projects: ResearchLoop, TypeScript, OpenClaw",
  ].join("\n"));

  assert.ok(tags.some((tag) => tag.value === "实验室"));
  assert.ok(tags.some((tag) => tag.value === "ResearchLoop"));
  assert.ok(tags.some((tag) => tag.value === "TypeScript"));
  assert.ok(tags.some((tag) => tag.value === "OpenClaw"));
  for (const tag of tags) {
    assert.equal(tag.kind, "tag");
    assert.equal(tag.source, "USER.md");
    assert.equal("key" in tag, false);
    assert.equal(tag.label, tag.value);
    assert.ok(tag.value.length <= 40);
    assert.equal(/[。.!?]\s*$/.test(tag.value), false);
  }
});

test("extractUserMdTags limits output to 10 unique tags of at most 40 characters", () => {
  const tags = extractUserMdTags([
    "Notes: Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda",
    "Project: This is a very long sentence that should not be emitted as a USER.md tag because it is not short",
    "Skills: TypeScript, Rust, Go, Python, React, Node.js, PostgreSQL, Docker, Kubernetes, libp2p, OpenClaw, ResearchLoop",
  ].join("\n"));

  assert.equal(tags.length, 10);
  assert.equal(new Set(tags.map((tag) => tag.value.toLowerCase())).size, tags.length);
  assert.equal(tags.every((tag) => tag.value.length <= 40), true);
  assert.equal(tags.some((tag) => tag.value.startsWith("This is a very long sentence")), false);
});
