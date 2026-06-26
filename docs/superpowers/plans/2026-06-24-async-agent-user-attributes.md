# Async Agent USER.md Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make libp2p-mesh send a fast base announce first, then asynchronously extract USER.md public tags through the OpenClaw-configured agent/model path and rebroadcast a full public-attribute announce.

**Architecture:** Add a focused USER.md agent attribute source that owns file hashing, cache IO, strict model-output validation, and an injectable extractor interface. Update `instance-router` to separate base announce payloads from attribute announce payloads, queue asynchronous refreshes after base announces, and expose a public refresh method for profile updates. Wire plugin/profile CLI/prompt docs to the new behavior without adding direct provider API calls or a new protocol message.

**Tech Stack:** TypeScript, Node.js `fs/promises` and `crypto`, existing OpenClaw plugin SDK types, Node test runner via `node --import tsx --test`.

---

## File Structure

- Create `src/user-md-agent-attributes.ts`
  - Owns `resolveUserMdAttributeCachePath`, strict USER.md tag validation, hash-based cache, and `createUserMdAgentAttributeSource`.
  - Exposes an injectable `UserMdAttributeExtractor` interface. The default production extractor returns unavailable unless an OpenClaw runtime capability is present.
- Modify `src/types.ts`
  - Extend router/user attribute source contracts with optional `refreshTags()`.
  - Add `refreshPublicAttributes(): Promise<void>` to `InstanceRouter`.
- Modify `src/instance-router.ts`
  - Split announce payload creation into base and attribute payload builders.
  - Send base announces without `userPublicAttributes`.
  - Queue one asynchronous attribute refresh at a time and rebroadcast full snapshots to connected/announced peers.
- Modify `src/plugin.ts`
  - Create the new USER.md agent attribute source.
  - Register CLI after router construction or pass a refresh callback safely so profile saves can trigger public-attribute refresh when possible.
- Modify `src/profile-cli.ts`
  - Add an optional `afterProfileSave` hook that runs after `user-profile.json` is saved.
- Modify `src/prompt-config.ts`
  - Explain async USER.md extraction, omitted initial `userPublicAttributes`, and source/scope rules.
- Test files:
  - Create `test/user-md-agent-attributes.test.ts`.
  - Modify `test/instance-router.test.ts`.
  - Modify `test/profile-cli.test.ts`.
  - Modify `test/prompt-config.test.ts`.

---

### Task 1: USER.md Agent Attribute Source and Cache

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `2718ced feat: add agent user md attribute source`, `4e9a142 fix: avoid user md cache temp collisions`

**Files:**
- Create: `src/user-md-agent-attributes.ts`
- Test: `test/user-md-agent-attributes.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing tests for cache, validation, and unavailable extraction**

Create `test/user-md-agent-attributes.test.ts` with these tests:

```ts
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

test("resolveUserMdAttributeCachePath uses OPENCLAW_STATE_DIR or default state path", async () => {
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

test("refreshTags skips USER.md tags when extractor is unavailable", async () => {
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
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npm test -- test/user-md-agent-attributes.test.ts`

Expected: FAIL with module-not-found for `src/user-md-agent-attributes.ts`.

- [ ] **Step 3: Add types for refresh-capable USER.md sources**

Modify `src/types.ts`:

```ts
export type UserMdAttributeSource = {
  loadTags(): Promise<UserPublicAttribute[]>;
  refreshTags?(): Promise<UserPublicAttribute[]>;
};
```

Then update `InstanceRouterOptions.userAttributeSource` to:

```ts
  userAttributeSource?: UserMdAttributeSource;
```

- [ ] **Step 4: Implement the source module**

Create `src/user-md-agent-attributes.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { UserMdAttributeSource, UserPublicAttribute } from "./types.js";
import {
  normalizeAttributeValue,
  normalizeUserPublicAttribute,
} from "./user-attributes.js";
import { resolveUserMdPath } from "./user-md-attributes.js";

const CACHE_VERSION = 1;
const MAX_AGENT_TAGS = 10;
const MAX_AGENT_TAG_LENGTH = 40;

type Logger = {
  debug?: (message: string) => void;
  warn?: (message: string) => void;
};

type UserMdAttributeCacheFile = {
  version: 1;
  updatedAt: number;
  userMdHash: string;
  attributes: UserPublicAttribute[];
};

export type UserMdAttributeExtractionUnavailable = {
  unavailable: true;
  reason: string;
};

export type UserMdAttributeExtractor = {
  extract(request: {
    markdown: string;
    sourcePath: string;
  }): Promise<UserPublicAttribute[] | UserMdAttributeExtractionUnavailable>;
};

export function resolveUserMdAttributeCachePath(customPath?: string): string {
  if (customPath) return customPath;

  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "libp2p", "user-md-attributes-cache.json");
  }

  return path.join(homedir(), ".openclaw", "libp2p", "user-md-attributes-cache.json");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isUnavailable(value: unknown): value is UserMdAttributeExtractionUnavailable {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { unavailable?: unknown }).unavailable === true &&
    typeof (value as { reason?: unknown }).reason === "string"
  );
}

function looksLikeSentence(value: string): boolean {
  return /[。.!?]/.test(value) || value.split(/\s+/).filter(Boolean).length > 4;
}

export function validateExtractedUserMdTags(value: unknown): UserPublicAttribute[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags: UserPublicAttribute[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const attribute = normalizeUserPublicAttribute(item);
    if (!attribute || attribute.kind !== "tag") {
      continue;
    }

    const tagValue = attribute.value.trim();
    const label = attribute.label.trim();
    if (!tagValue || !label || tagValue.length > MAX_AGENT_TAG_LENGTH || looksLikeSentence(tagValue)) {
      continue;
    }

    const key = normalizeAttributeValue(tagValue);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push({
      kind: "tag",
      value: tagValue,
      label,
      source: "USER.md",
    });

    if (tags.length >= MAX_AGENT_TAGS) {
      break;
    }
  }

  return tags;
}

function normalizeCache(value: unknown): UserMdAttributeCacheFile | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Partial<UserMdAttributeCacheFile>;
  if (
    candidate.version !== CACHE_VERSION ||
    typeof candidate.updatedAt !== "number" ||
    typeof candidate.userMdHash !== "string"
  ) {
    return undefined;
  }

  return {
    version: CACHE_VERSION,
    updatedAt: candidate.updatedAt,
    userMdHash: candidate.userMdHash,
    attributes: validateExtractedUserMdTags(candidate.attributes),
  };
}

async function readCache(cachePath: string): Promise<UserMdAttributeCacheFile | undefined> {
  try {
    return normalizeCache(JSON.parse(await readFile(cachePath, "utf8")));
  } catch {
    return undefined;
  }
}

async function writeCache(cachePath: string, file: UserMdAttributeCacheFile): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tmpPath, cachePath);
}

const unavailableExtractor: UserMdAttributeExtractor = {
  async extract() {
    return { unavailable: true, reason: "OpenClaw runtime USER.md extraction is unavailable" };
  },
};

export function createUserMdAgentAttributeSource(options?: {
  path?: string;
  cachePath?: string;
  extractor?: UserMdAttributeExtractor;
  logger?: Logger;
}): UserMdAttributeSource {
  const userMdPath = resolveUserMdPath(options?.path);
  const cachePath = resolveUserMdAttributeCachePath(options?.cachePath);
  const extractor = options?.extractor ?? unavailableExtractor;
  const logger = options?.logger;

  return {
    async loadTags(): Promise<UserPublicAttribute[]> {
      const markdown = await readFile(userMdPath, "utf8").catch(() => undefined);
      if (markdown === undefined) {
        return [];
      }

      const cache = await readCache(cachePath);
      return cache?.userMdHash === sha256(markdown) ? cache.attributes : [];
    },

    async refreshTags(): Promise<UserPublicAttribute[]> {
      let markdown: string;
      try {
        markdown = await readFile(userMdPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger?.warn?.(`[libp2p-mesh] Failed to read USER.md for agent extraction: ${(error as Error).message}`);
        }
        return [];
      }

      const userMdHash = sha256(markdown);
      const cached = await readCache(cachePath);
      if (cached?.userMdHash === userMdHash) {
        return cached.attributes;
      }

      const extracted = await extractor.extract({ markdown, sourcePath: userMdPath });
      if (isUnavailable(extracted)) {
        logger?.warn?.(`[libp2p-mesh] USER.md agent extraction unavailable: ${extracted.reason}`);
        return [];
      }

      const attributes = validateExtractedUserMdTags(extracted);
      await writeCache(cachePath, {
        version: CACHE_VERSION,
        updatedAt: Date.now(),
        userMdHash,
        attributes,
      });
      logger?.debug?.(`[libp2p-mesh] Refreshed USER.md agent attributes from ${userMdPath}`);
      return attributes;
    },
  };
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- test/user-md-agent-attributes.test.ts test/user-attributes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/types.ts src/user-md-agent-attributes.ts test/user-md-agent-attributes.test.ts
git commit -m "feat: add agent user md attribute source"
```

---

### Task 2: Two-Phase Instance Announce and Refresh API

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `721bf33 feat: announce public attributes asynchronously`, `09377b8 fix: preserve profile attributes on user md refresh failure`, `b4acb8b fix: stabilize async attribute announce refresh`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/instance-router.ts`
- Test: `test/instance-router.test.ts`

- [ ] **Step 1: Write failing router tests for base announce and async attribute refresh**

Add tests to `test/instance-router.test.ts` near the existing announce tests:

```ts
test("announceToPeer sends base announce first without userPublicAttributes then refreshes attributes", async () => {
  const sent: SentMessage[] = [];
  let refreshCalls = 0;
  const userMdTag: UserPublicAttribute = {
    kind: "tag",
    value: "P2P",
    label: "P2P",
    source: "USER.md",
  };
  const profileAttribute: UserPublicAttribute = {
    kind: "structured",
    key: "group",
    value: "实验室",
    label: "group: 实验室",
    source: "profile",
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([]),
    delivery: {
      async deliver() {
        throw new Error("not used");
      },
    },
    userAttributeSource: {
      async loadTags() {
        return [];
      },
      async refreshTags() {
        refreshCalls += 1;
        return [userMdTag];
      },
    },
    userProfileStore: {
      async listAttributes() {
        return [profileAttribute];
      },
    },
  });

  await router.announceToPeer("remote-peer");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(refreshCalls, 1);
  assert.equal(sent.length, 2);
  const basePayload = JSON.parse(sent[0].message.payload);
  const attributePayload = JSON.parse(sent[1].message.payload);
  assert.equal("userPublicAttributes" in basePayload, false);
  assert.deepEqual(attributePayload.userPublicAttributes, [userMdTag, profileAttribute]);
});

test("refreshPublicAttributes rebroadcasts a full attribute announce to connected peers", async () => {
  const sent: SentMessage[] = [];
  const userMdTag: UserPublicAttribute = {
    kind: "tag",
    value: "OpenClaw",
    label: "OpenClaw",
    source: "USER.md",
  };
  const mesh = makeMesh(sent);
  const router = createInstanceRouter({
    mesh: {
      ...mesh,
      getConnectedPeers() {
        return ["peer-a", "peer-b"];
      },
    },
    store: makeStore([]),
    delivery: {
      async deliver() {
        throw new Error("not used");
      },
    },
    userAttributeSource: {
      async loadTags() {
        return [];
      },
      async refreshTags() {
        return [userMdTag];
      },
    },
  });

  await router.refreshPublicAttributes();

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((entry) => entry.peerId), ["peer-a", "peer-b"]);
  for (const entry of sent) {
    const payload = JSON.parse(entry.message.payload);
    assert.deepEqual(payload.userPublicAttributes, [userMdTag]);
    assert.equal(payload.instanceId, "local-instance");
  }
});

test("attribute refresh failure does not reject announceToPeer", async () => {
  const sent: SentMessage[] = [];
  const { logs, logger } = makeLogger();
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([]),
    delivery: {
      async deliver() {
        throw new Error("not used");
      },
    },
    logger,
    userAttributeSource: {
      async loadTags() {
        return [];
      },
      async refreshTags() {
        throw new Error("model failed");
      },
    },
  });

  await router.announceToPeer("remote-peer");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.equal("userPublicAttributes" in JSON.parse(sent[0].message.payload), false);
  assert.equal(logs.warn.some((message) => message.includes("model failed")), true);
});
```

- [ ] **Step 2: Run tests to verify current behavior fails**

Run: `npm test -- test/instance-router.test.ts`

Expected: FAIL because `announceToPeer` currently includes attributes in the first payload and `refreshPublicAttributes` does not exist.

- [ ] **Step 3: Extend `InstanceRouter` type**

Modify `src/types.ts`:

```ts
  refreshPublicAttributes(): Promise<void>;
```

Add it to the `InstanceRouter` interface after `announceToPeer(peerId: string): Promise<void>;`.

- [ ] **Step 4: Refactor announce builders in router**

Modify `src/instance-router.ts` by replacing `loadUserPublicAttributes` and `buildAnnouncePayload` with:

```ts
  async function loadUserPublicAttributes(loadOptions?: { refreshUserMd?: boolean }): Promise<UserPublicAttribute[]> {
    const userMdPromise = loadOptions?.refreshUserMd && options.userAttributeSource?.refreshTags
      ? options.userAttributeSource.refreshTags()
      : options.userAttributeSource?.loadTags() ?? Promise.resolve([]);

    const [userMdTags, profileAttributes] = await Promise.all([
      userMdPromise.catch((error) => {
        logger?.warn?.(
          `[libp2p-mesh] Failed to load USER.md public attributes: ${summarizeError(error)}`,
        );
        return [];
      }),
      options.userProfileStore?.listAttributes().catch((error) => {
        logger?.warn?.(
          `[libp2p-mesh] Failed to load profile public attributes: ${summarizeError(error)}`,
        );
        return [];
      }) ?? Promise.resolve([]),
    ]);

    return mergeUserPublicAttributes(userMdTags, profileAttributes);
  }

  function buildBaseAnnouncePayload(): InstanceAnnouncePayload {
    const identity = mesh.getInstanceIdentity();
    if (!identity) {
      throw new Error("Local instance identity is not initialized");
    }

    return {
      instanceId: identity.id,
      peerId: mesh.getLocalPeerId(),
      instanceName: identity.name,
      multiaddrs: mesh.getMultiaddrs(),
      pubkey: identity.pubkey,
      announcedAt: Date.now(),
    };
  }

  async function buildAttributeAnnouncePayload(): Promise<InstanceAnnouncePayload> {
    return {
      ...buildBaseAnnouncePayload(),
      userPublicAttributes: await loadUserPublicAttributes({ refreshUserMd: true }),
    };
  }
```

- [ ] **Step 5: Add queued refresh and full rebroadcast**

Inside `createInstanceRouter`, add:

```ts
let attributeRefreshPromise: Promise<void> | undefined;

function attributeAnnouncePeers(extraPeerId?: string): string[] {
  const peers = new Set<string>();
  for (const peerId of mesh.getConnectedPeers()) {
    if (isNonEmptyString(peerId) && peerId !== mesh.getLocalPeerId()) {
      peers.add(peerId);
    }
  }
  for (const peerId of announcedPeers) {
    if (isNonEmptyString(peerId) && peerId !== mesh.getLocalPeerId()) {
      peers.add(peerId);
    }
  }
  if (extraPeerId && extraPeerId !== mesh.getLocalPeerId()) {
    peers.add(extraPeerId);
  }
  return [...peers];
}

async function sendAttributeAnnounceToPeers(peers: string[]): Promise<void> {
  if (peers.length === 0) {
    return;
  }

  const payload = await buildAttributeAnnouncePayload();
  for (const peerId of peers) {
    await mesh.sendStructuredMessage(peerId, {
      id: crypto.randomUUID(),
      type: "instance-announce",
      to: peerId,
      payload: JSON.stringify(payload),
    }).catch((error) => {
      logger?.warn?.(
        `[libp2p-mesh] Failed to send attribute announce to ${peerId}: ${summarizeError(error)}`,
      );
    });
    logAnnounce("Sent", peerId, payload);
  }
}

function queueAttributeRefresh(extraPeerId?: string): void {
  const peers = attributeAnnouncePeers(extraPeerId);
  if (peers.length === 0) {
    return;
  }

  if (attributeRefreshPromise) {
    return;
  }

  attributeRefreshPromise = sendAttributeAnnounceToPeers(peers).catch((error) => {
    logger?.warn?.(`[libp2p-mesh] Failed to refresh public attributes: ${summarizeError(error)}`);
  }).finally(() => {
    attributeRefreshPromise = undefined;
  });
}
```

Update `announceToPeer`:

```ts
const payload = buildBaseAnnouncePayload();
await mesh.sendStructuredMessage(peerId, {
  id: crypto.randomUUID(),
  type: "instance-announce",
  to: peerId,
  payload: JSON.stringify(payload),
});
announcedPeers.add(peerId);
logAnnounce("Sent", peerId, payload);
queueAttributeRefresh(peerId);
```

Return `refreshPublicAttributes` from the router:

```ts
async refreshPublicAttributes(): Promise<void> {
  if (attributeRefreshPromise) {
    await attributeRefreshPromise;
    return;
  }

  attributeRefreshPromise = sendAttributeAnnounceToPeers(attributeAnnouncePeers()).finally(() => {
    attributeRefreshPromise = undefined;
  });
  await attributeRefreshPromise;
},
```

- [ ] **Step 6: Update existing announce tests**

Update the existing test named `announceToPeer sends merged USER.md and profile user public attributes` to expect two messages instead of one, or rename it to `announceToPeer sends merged attributes in second announce`.

Use this assertion block:

```ts
await router.announceToPeer("remote-peer");
await new Promise((resolve) => setImmediate(resolve));

assert.equal(sent.length, 2);
assert.equal(sent[0].peerId, "remote-peer");
assert.equal(sent[0].message.type, "instance-announce");
assert.equal("userPublicAttributes" in JSON.parse(sent[0].message.payload), false);
const payload = JSON.parse(sent[1].message.payload);
assert.deepEqual(payload.userPublicAttributes, [userMdTag, profileAttribute]);
```

- [ ] **Step 7: Run focused router tests**

Run: `npm test -- test/instance-router.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/types.ts src/instance-router.ts test/instance-router.test.ts
git commit -m "feat: announce public attributes asynchronously"
```

---

### Task 3: Plugin and Profile CLI Wiring

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `80037ce feat: refresh public attributes after profile save`

**Files:**
- Modify: `src/plugin.ts`
- Modify: `src/profile-cli.ts`
- Test: `test/profile-cli.test.ts`

- [ ] **Step 1: Write failing profile CLI test for refresh hook**

Add this test to `test/profile-cli.test.ts`:

```ts
test("profile command calls afterProfileSave after writing profile attributes", async () => {
  const root = makeCommand("openclaw");
  let refreshed = false;
  const { api } = makeApi(root);

  registerLibp2pMeshCli(api, {
    profile: {
      createPrompter() {
        return makePrompter(["add-attribute", "group", "实验室", "preview-finish", true]);
      },
      createProfileStore() {
        return {
          async listAttributes() {
            return [];
          },
          async replaceAttributes(attributes) {
            assert.deepEqual(attributes, [
              {
                kind: "structured",
                key: "group",
                value: "实验室",
                label: "group: 实验室",
                source: "profile",
              },
            ]);
          },
        };
      },
      createUserMdAttributeSource() {
        return {
          async loadTags() {
            return [];
          },
        };
      },
      async afterProfileSave() {
        refreshed = true;
      },
    },
  });

  const profile = root.children
    .find((child) => child.name === "libp2p-mesh")
    ?.children.find((child) => child.name === "profile");
  assert.ok(profile?.actionHandler);
  await profile.actionHandler();

  assert.equal(refreshed, true);
});
```

- [ ] **Step 2: Run profile CLI test to verify failure**

Run: `npm test -- test/profile-cli.test.ts`

Expected: FAIL because `afterProfileSave` is not defined in `ProfileCliDeps`.

- [ ] **Step 3: Add profile save hook**

Modify `src/profile-cli.ts`:

```ts
export type ProfileCliDeps = {
  createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
  createProfileStore?: (api: OpenClawPluginApi) => Pick<UserProfileStore, "listAttributes" | "replaceAttributes">;
  createUserMdAttributeSource?: (api: OpenClawPluginApi) => { loadTags(): Promise<Awaited<ReturnType<UserProfileStore["listAttributes"]>>> };
  afterProfileSave?: () => Promise<void>;
};
```

Inside the `writer.replaceAttributes` implementation:

```ts
writer: {
  async replaceAttributes(attributes) {
    await profileStore.replaceAttributes(attributes);
    await deps.afterProfileSave?.();
  },
},
```

- [ ] **Step 4: Wire plugin runtime extractor source and profile refresh**

Modify `src/plugin.ts` imports:

```ts
import { createUserMdAgentAttributeSource } from "./user-md-agent-attributes.js";
```

Replace `createUserMdAttributeSource({ logger: api.logger })` with:

```ts
const userAttributeSource = createUserMdAgentAttributeSource({ logger: api.logger });
```

Move `registerLibp2pMeshCli(api);` so it runs after `router` exists, and pass a refresh hook:

```ts
registerLibp2pMeshCli(api, {
  profile: {
    async afterProfileSave() {
      await router.refreshPublicAttributes();
    },
  },
});
```

Keep the CLI registration inside `registerLibp2pMeshWithDeps`. Do not introduce direct provider API calls.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- test/profile-cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/plugin.ts src/profile-cli.ts test/profile-cli.test.ts
git commit -m "feat: refresh public attributes after profile save"
```

---

### Task 4: Prompt Guidance and Agent Tool Documentation

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `5dc95c8 docs: explain async user attribute extraction`
**Notes:** README quick-start wording was also aligned in the working tree because that section already existed as an unrelated unstaged addition.

**Files:**
- Modify: `src/prompt-config.ts`
- Test: `test/prompt-config.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing prompt tests**

Add assertions to `test/prompt-config.test.ts`:

```ts
test("agent prompt documents async USER.md public attributes", () => {
  assert.match(AGENT_PROMPT_BLOCK, /source="USER\.md"/);
  assert.match(AGENT_PROMPT_BLOCK, /异步/);
  assert.match(AGENT_PROMPT_BLOCK, /OpenClaw.*agent\/API 模型/);
  assert.match(AGENT_PROMPT_BLOCK, /省略 `userPublicAttributes`/);
  assert.match(AGENT_PROMPT_BLOCK, /普通对话 agent 不应自己读取 USER\.md/);
});
```

If the prompt constant has a different export name, use the existing test helper that reads the installed prompt text.

- [ ] **Step 2: Run prompt tests to verify failure**

Run: `npm test -- test/prompt-config.test.ts`

Expected: FAIL because the prompt does not yet describe async extraction.

- [ ] **Step 3: Update `src/prompt-config.ts`**

Add this guidance to the managed prompt block near the existing `userPublicAttributes` and scope rules:

```md
公开属性来源：
- `source="USER.md"` 表示 gateway 使用 OpenClaw 已配置的 agent/API 模型，从 USER.md 异步提取并公开广播的 tag。
- `source="profile"` 表示用户通过 `openclaw libp2p-mesh profile` 手动配置的公开结构化属性。
- gateway 的基础 `instance-announce` 可能省略 `userPublicAttributes`；这表示本次 announce 没有携带属性，不一定表示该用户没有公开属性。按公开属性发送前先用 `p2p_list_instances` 查看当前实例记录。
- 普通对话 agent 不应自己读取 USER.md 来决定公开属性。USER.md 属性提取是 gateway 后台职责。
```

Keep the existing local label warnings and scope rules, but ensure they say:

```md
- `scope="public"` 匹配远端公开广播的 `userPublicAttributes`，包括 USER.md 异步提取 tag 和 profile 属性。
- `scope="local"` 只匹配本机通过 `openclaw libp2p-mesh labels` 配置的本地标签。
- `scope="all"` 同时匹配公开属性和本地标签。
```

- [ ] **Step 4: Update README**

In `README.md`, update the user public attributes section with:

```md
USER.md tags are produced asynchronously by the gateway. The initial base
`instance-announce` may omit `userPublicAttributes`; after the gateway extracts
USER.md tags with the OpenClaw-configured agent/API model and merges
`user-profile.json`, it rebroadcasts a full `instance-announce` snapshot.
```

Also document that extraction unavailable means USER.md tags are skipped, while profile attributes still broadcast.

- [ ] **Step 5: Run prompt and docs checks**

Run:

```bash
npm test -- test/prompt-config.test.ts
rg "异步" src/prompt-config.ts docs/superpowers/specs/2026-06-24-async-agent-user-attributes-design.md
rg "OpenClaw.*agent/API" src/prompt-config.ts README.md
```

Expected: PASS and `rg` finds matches.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/prompt-config.ts test/prompt-config.test.ts README.md
git commit -m "docs: explain async user attribute extraction"
```

---

### Task 5: Final Integration Verification

**Files:**
- Modify only if review finds a concrete issue.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS with all tests green.

- [ ] **Step 2: Run TypeScript build**

Run: `npm run build`

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Check protocol constraints with search**

Run:

```bash
rg "userPublicAttributes: await loadUserPublicAttributes|userPublicAttributes: \\[\\]" src/instance-router.ts src/plugin.ts
rg "p2p_send_user_attribute_message|scope=\\\"public\\\"|scope=\\\"local\\\"" src/prompt-config.ts README.md
rg "createUserMdAttributeSource" src/plugin.ts src/profile-cli.ts
```

Expected:
- First command should find no old synchronous base-announce attribute assignment.
- Second command should find prompt/docs scope guidance.
- Third command may still find `createUserMdAttributeSource` only in profile CLI read-only display paths if the old heuristic source remains for profile preview; it must not be used in `src/plugin.ts` for runtime announce attributes.

- [ ] **Step 4: Review dirty worktree before final commit**

Run: `git status --short`

Expected: only files intentionally changed by Tasks 1-4 are staged or committed. Existing unrelated dirty files from before this plan must not be reverted.

- [ ] **Step 5: Commit any final fixups**

If Step 1-4 required small fixes, commit them:

```bash
git add <changed-files>
git commit -m "fix: stabilize async user attribute extraction"
```

If no fixes were needed, do not create an empty commit.
