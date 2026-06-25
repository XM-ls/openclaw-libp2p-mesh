# Local Labels Instance Peer Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store local peer labels as a private derived `localLabels` snapshot inside discovered `instance-peer.json` records while keeping `peer-labels.json` authoritative and non-broadcast.

**Architecture:** `PeerLabelStore` remains the only writer of true local labels. `InstancePeerStore` gains snapshot fields and sync methods, `InstanceRouter` refreshes snapshots on startup and announce handling, CLI save paths refresh snapshots after label edits, and agent tools/prompts expose the two attribute sources separately.

**Tech Stack:** TypeScript, Node.js built-in test runner, OpenClaw plugin SDK, JSON file stores under `~/.openclaw/libp2p` or `OPENCLAW_STATE_DIR/libp2p`.

---

## File Structure

- Modify `src/types.ts`: add `InstancePeerRecord.localLabels`, extend `InstancePeerStore`, and widen router/store dependency types to the new sync methods.
- Modify `src/instance-peer-store.ts`: normalize `LocalPeerLabelAttribute`, preserve snapshots during announce upsert, and implement batch/single snapshot sync.
- Modify `src/instance-router.ts`: refresh local labels on startup, attach local label snapshots after receiving announce, and prefer record snapshots for local attribute matching with `peerLabelStore` fallback.
- Modify `src/profile-cli.ts`: add an `afterLabelsSave` hook and call it after `peer-labels.json` writes.
- Modify `src/plugin.ts`: pass the label-save hook to CLI registration and call router/store sync from gateway lifecycle.
- Modify `src/agent-tools.ts`: make `p2p_list_instances` use `record.localLabels` first, then `peerLabelStore` fallback.
- Modify `src/prompt-config.ts`: clarify that `localLabels` in `instance-peer.json` are private snapshots, not public attributes.
- Modify `test/instance-peer-store.test.ts`: cover snapshot normalization, preservation, batch sync, and no phantom instance creation.
- Modify `test/instance-router.test.ts`: cover startup sync, announce sync, and local-scope matching from snapshots.
- Modify `test/profile-cli.test.ts`: cover labels command hook behavior.
- Modify `test/agent-tools.test.ts`: cover snapshot-first `localLabels` output and dynamic fallback.
- Modify `test/prompt-config.test.ts`: cover new prompt wording.

---

### Task 1: Add `localLabels` Snapshot Support to `InstancePeerStore`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/instance-peer-store.ts`
- Test: `test/instance-peer-store.test.ts`

- [ ] **Step 1: Write failing tests for store behavior**

Append these imports and tests to `test/instance-peer-store.test.ts`.

```ts
import { readFile, writeFile } from "node:fs/promises";
import type { LocalPeerLabelAttribute } from "../src/types.js";
```

```ts
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

test("load normalizes localLabels and drops invalid entries", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "instance-peer.json");
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
```

- [ ] **Step 2: Run failing store tests**

Run:

```bash
npm test -- test/instance-peer-store.test.ts
```

Expected: FAIL because `InstancePeerRecord.localLabels`, `syncLocalLabels`, and `updateLocalLabels` do not exist.

- [ ] **Step 3: Extend types**

In `src/types.ts`, update `InstancePeerRecord` and `InstancePeerStore`.

```ts
export interface InstancePeerRecord {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  multiaddrs: string[];
  pubkey?: string;
  userPublicAttributes?: UserPublicAttribute[];
  localLabels?: LocalPeerLabelAttribute[];
  lastSeenAt: number;
  lastAnnouncedAt: number;
  source: "announce";
}
```

```ts
export interface InstancePeerStore {
  load(): Promise<InstancePeerTable>;
  list(): Promise<InstancePeerRecord[]>;
  resolve(instanceId: string): Promise<InstancePeerRecord | undefined>;
  syncLocalLabels(labelsByInstance: Record<string, LocalPeerLabelAttribute[]>): Promise<InstancePeerTable>;
  updateLocalLabels(instanceId: string, labels: LocalPeerLabelAttribute[]): Promise<InstancePeerRecord | undefined>;
  upsertFromAnnounce(payload: InstanceAnnouncePayload): Promise<{
    record: InstancePeerRecord;
    changed: boolean;
    peerIdSharedBy: string[];
  }>;
}
```

- [ ] **Step 4: Implement normalization and sync methods**

In `src/instance-peer-store.ts`, import `LocalPeerLabelAttribute` and `normalizeAttributeKey`.

```ts
import type {
  InstanceAnnouncePayload,
  InstancePeerRecord,
  InstancePeerStore,
  InstancePeerTable,
  LocalPeerLabelAttribute,
  UserPublicAttribute,
} from "./types.js";
import { normalizeUserPublicAttribute } from "./user-attributes.js";
import { normalizeAttributeKey, normalizeAttributeValue } from "./user-attributes.js";
```

Add helpers near the existing attribute helpers.

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeLocalLabel(value: unknown): LocalPeerLabelAttribute | undefined {
  if (!isRecord(value) || value.kind !== "structured" || value.source !== "local") {
    return undefined;
  }
  const key = trimmedString(value.key);
  const labelValue = trimmedString(value.value);
  if (!key || !labelValue) {
    return undefined;
  }
  return {
    kind: "structured",
    key: normalizeAttributeKey(key),
    value: normalizeAttributeValue(labelValue),
    label: trimmedString(value.label) ?? labelValue,
    source: "local",
  };
}

function normalizeLocalLabels(value: unknown): LocalPeerLabelAttribute[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: LocalPeerLabelAttribute[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const label = normalizeLocalLabel(item);
    if (!label) continue;
    const id = `${label.key}:${label.value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(label);
  }
  return normalized;
}

function withLocalLabels(
  record: InstancePeerRecord,
  labels: LocalPeerLabelAttribute[],
): InstancePeerRecord {
  const normalized = normalizeLocalLabels(labels);
  if (normalized.length === 0) {
    const { localLabels: _localLabels, ...withoutLocalLabels } = record;
    return withoutLocalLabels;
  }
  return { ...record, localLabels: normalized };
}
```

Update `normalizeRecord`.

```ts
function normalizeRecord(value: InstancePeerRecord): InstancePeerRecord {
  return withLocalLabels(
    {
      ...value,
      userPublicAttributes: normalizeUserPublicAttributes(value.userPublicAttributes),
    },
    normalizeLocalLabels(value.localLabels),
  );
}
```

Inside `upsertFromAnnounce`, preserve labels.

```ts
const record: InstancePeerRecord = withLocalLabels(
  {
    instanceId: payload.instanceId,
    peerId: payload.peerId,
    instanceName: payload.instanceName,
    pubkey: payload.pubkey,
    multiaddrs: payload.multiaddrs,
    userPublicAttributes,
    lastAnnouncedAt: payload.announcedAt,
    lastSeenAt: Date.now(),
    source: "announce",
  },
  existing?.localLabels ?? [],
);
```

Add methods to the returned store object before `upsertFromAnnounce`.

```ts
async syncLocalLabels(labelsByInstance: Record<string, LocalPeerLabelAttribute[]>): Promise<InstancePeerTable> {
  return runMutation(async () => {
    const table = await load();
    const instances: Record<string, InstancePeerRecord> = {};

    for (const [instanceId, record] of Object.entries(table.instances)) {
      instances[instanceId] = withLocalLabels(record, labelsByInstance[instanceId] ?? []);
    }

    return save({ ...table, instances });
  });
},
async updateLocalLabels(instanceId: string, labels: LocalPeerLabelAttribute[]): Promise<InstancePeerRecord | undefined> {
  return runMutation(async () => {
    const table = await load();
    const existing = table.instances[instanceId];
    if (!existing) {
      return undefined;
    }
    const record = withLocalLabels(existing, labels);
    await save({
      ...table,
      instances: {
        ...table.instances,
        [instanceId]: record,
      },
    });
    return record;
  });
},
```

- [ ] **Step 5: Run store tests**

Run:

```bash
npm test -- test/instance-peer-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit store task**

```bash
git add src/types.ts src/instance-peer-store.ts test/instance-peer-store.test.ts
git commit -m "feat: snapshot local labels in instance peer store"
```

---

### Task 2: Sync Local Label Snapshots from `InstanceRouter`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/instance-router.ts`
- Test: `test/instance-router.test.ts`

- [ ] **Step 1: Write failing router tests**

In `test/instance-router.test.ts`, extend `makeStore` with the new store methods.

```ts
    async syncLocalLabels(labelsByInstance) {
      for (const [instanceId, record] of byInstance) {
        const labels = labelsByInstance[instanceId] ?? [];
        if (labels.length === 0) {
          const { localLabels: _localLabels, ...withoutLocalLabels } = record;
          byInstance.set(instanceId, withoutLocalLabels);
        } else {
          byInstance.set(instanceId, { ...record, localLabels: labels });
        }
      }
      return {
        version: 1,
        updatedAt: 1,
        instances: Object.fromEntries(byInstance),
      };
    },
    async updateLocalLabels(instanceId, labels) {
      const record = byInstance.get(instanceId);
      if (!record) return undefined;
      const next = labels.length === 0 ? { ...record, localLabels: undefined } : { ...record, localLabels: labels };
      byInstance.set(instanceId, next);
      return next;
    },
```

Add tests.

```ts
test("start syncs local label snapshots for existing records", async () => {
  const sent: SentMessage[] = [];
  const localGroup: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "实验室",
    label: "实验室",
    source: "local",
  };
  const store = makeStore([makeRecord("remote-a", "peer-a")]);
  const labels = makePeerLabelStore({ "remote-a": [localGroup] });
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store,
    delivery: makeDelivery(),
    peerLabelStore: labels.store,
  });

  await router.start();

  assert.deepEqual((await store.resolve("remote-a"))?.localLabels, [localGroup]);
});

test("handle announce refreshes local label snapshot for announced record", async () => {
  const sent: SentMessage[] = [];
  const localProject: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "project",
    value: "小龙虾",
    label: "小龙虾",
    source: "local",
  };
  const store = makeStore([]);
  const labels = makePeerLabelStore({ "remote-a": [localProject] });
  const mesh = makeMesh(sent);
  const router = createInstanceRouter({
    mesh,
    store,
    delivery: makeDelivery(),
    peerLabelStore: labels.store,
  });
  router.attachHandlers();

  mesh.emitMessage({
    id: "announce-1",
    type: "instance-announce",
    from: "peer-a",
    instanceId: "remote-a",
    payload: JSON.stringify({
      instanceId: "remote-a",
      peerId: "peer-a",
      instanceName: "Remote A",
      multiaddrs: [],
      announcedAt: 123,
    }),
    timestamp: 123,
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual((await store.resolve("remote-a"))?.localLabels, [localProject]);
});

test("local-scope user attribute matching uses record localLabels before peer label fallback", async () => {
  const sent: SentMessage[] = [];
  const localGroup: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "实验室",
    label: "实验室",
    source: "local",
  };
  const store = makeStore([{ ...makeRecord("remote-a", "peer-a"), localLabels: [localGroup] }]);
  const labels = makePeerLabelStore({});
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store,
    delivery: makeDelivery(),
    peerLabelStore: labels.store,
  });

  const result = await router.sendUserAttributeMessage(
    { kind: "structured", key: "group", value: "实验室" },
    "我这边准备好了",
    { dryRun: true, scope: "local" },
  );

  assert.equal(result.matched, 1);
  assert.equal(result.targets?.[0]?.matchSource, "local");
  assert.deepEqual(labels.calls, []);
});
```

- [ ] **Step 2: Run failing router tests**

Run:

```bash
npm test -- test/instance-router.test.ts
```

Expected: FAIL because router does not call store sync methods and local matching always asks `peerLabelStore`.

- [ ] **Step 3: Extend router dependency type**

In `src/types.ts`, change `InstanceRouterOptions.peerLabelStore`.

```ts
  peerLabelStore?: {
    load?(): Promise<PeerLabelsFile>;
    listLabels(instanceId: string): Promise<LocalPeerLabelAttribute[]>;
  };
```

- [ ] **Step 4: Implement router sync helpers**

In `src/instance-router.ts`, add helper functions near other internal helpers.

```ts
async function buildLocalLabelsByInstance(): Promise<Record<string, LocalPeerLabelAttribute[]>> {
  const table = await store.load();
  const result: Record<string, LocalPeerLabelAttribute[]> = {};

  for (const instanceId of Object.keys(table.instances)) {
    result[instanceId] = (await options.peerLabelStore?.listLabels(instanceId)) ?? [];
  }

  return result;
}

async function syncAllLocalLabelSnapshots(): Promise<void> {
  if (!options.peerLabelStore) return;
  await store.syncLocalLabels(await buildLocalLabelsByInstance());
}

async function syncLocalLabelSnapshot(instanceId: string): Promise<void> {
  if (!options.peerLabelStore) return;
  await store.updateLocalLabels(instanceId, await options.peerLabelStore.listLabels(instanceId));
}
```

Update `handleAnnounce` immediately after `store.upsertFromAnnounce(payload)`.

```ts
    const result = await store.upsertFromAnnounce(payload);
    await syncLocalLabelSnapshot(payload.instanceId).catch((error) => {
      logger?.warn?.(
        `[libp2p-mesh] Failed to sync local labels for ${payload.instanceId}: ${summarizeError(error)}`,
      );
    });
```

Update `start`.

```ts
  async function start(): Promise<void> {
    attachHandlers();
    await syncAllLocalLabelSnapshots().catch((error) => {
      logger?.warn?.(`[libp2p-mesh] Failed to sync local labels on startup: ${summarizeError(error)}`);
    });
    await announceToConnectedPeers();
  }
```

Update `resolveUserAttributeTargets` local attribute lookup.

```ts
      const recordLocalLabels = record.localLabels ?? [];
      const fallbackLocalLabels =
        recordLocalLabels.length > 0
          ? recordLocalLabels
          : (await options.peerLabelStore?.listLabels(record.instanceId)) ?? [];
      const localAttribute =
        scope === "public"
          ? undefined
          : fallbackLocalLabels.find((attribute) =>
              matchesLocalPeerLabel(attribute, match),
            );
```

- [ ] **Step 5: Run router tests**

Run:

```bash
npm test -- test/instance-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit router task**

```bash
git add src/types.ts src/instance-router.ts test/instance-router.test.ts
git commit -m "feat: sync local label snapshots from router"
```

---

### Task 3: Refresh Snapshots After `labels` CLI Saves

**Files:**
- Modify: `src/profile-cli.ts`
- Modify: `src/plugin.ts`
- Test: `test/profile-cli.test.ts`
- Test: `test/plugin-lifecycle.test.ts`

- [ ] **Step 1: Write failing CLI hook test**

In `test/profile-cli.test.ts`, add a labels command test using the existing CLI command harness in that file. The essential assertion is:

```ts
test("labels command calls afterLabelsSave after replacing labels", async () => {
  const saved: Array<{ instanceId: string; labels: unknown[] }> = [];
  const afterLabelsSaveCalls: string[] = [];

  await runRegisteredLibp2pMeshCommand("labels", {
    labels: {
      createPrompter: () => scriptedPrompter([
        "remote-instance",
        "group",
        "实验室",
        "",
      ]),
      createPeerStore: () => ({
        async list() {
          return [{
            instanceId: "remote-instance",
            peerId: "remote-peer",
            instanceName: "remote",
            multiaddrs: [],
            lastSeenAt: 1,
            lastAnnouncedAt: 1,
            source: "announce" as const,
          }];
        },
      }),
      createPeerLabelStore: () => ({
        async listRawLabels() {
          return [];
        },
        async replaceLabels(instanceId, labels) {
          saved.push({ instanceId, labels });
        },
      }),
      async afterLabelsSave(instanceId) {
        afterLabelsSaveCalls.push(instanceId);
      },
    },
  });

  assert.equal(saved[0]?.instanceId, "remote-instance");
  assert.deepEqual(afterLabelsSaveCalls, ["remote-instance"]);
});
```

Use the existing helper names from `test/profile-cli.test.ts`; if the file uses different names, adapt only the helper call shape while preserving this assertion.

- [ ] **Step 2: Run failing CLI test**

Run:

```bash
npm test -- test/profile-cli.test.ts
```

Expected: FAIL because `LabelsCliDeps.afterLabelsSave` does not exist.

- [ ] **Step 3: Add labels save hook**

In `src/profile-cli.ts`, update `LabelsCliDeps`.

```ts
export type LabelsCliDeps = {
  createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
  createPeerStore?: (api: OpenClawPluginApi) => Pick<InstancePeerStore, "list">;
  createPeerLabelStore?: (api: OpenClawPluginApi) => Pick<PeerLabelStore, "listRawLabels" | "replaceLabels" | "listLabels">;
  afterLabelsSave?: (instanceId: string) => Promise<void>;
};
```

Call the hook after `replaceLabels`.

```ts
            async replaceLabels(instanceId, labels) {
              await peerLabelStore.replaceLabels(instanceId, labels);
              await deps.afterLabelsSave?.(instanceId);
            },
```

- [ ] **Step 4: Wire the hook in plugin registration**

In `src/plugin.ts`, extend the existing `registerLibp2pMeshCli` call.

```ts
  registerLibp2pMeshCli(api, {
    profile: {
      async afterProfileSave() {
        await router.refreshPublicAttributes();
      },
    },
    labels: {
      async afterLabelsSave(instanceId) {
        await store.updateLocalLabels(instanceId, await peerLabelStore.listLabels(instanceId));
      },
    },
  });
```

- [ ] **Step 5: Add plugin lifecycle assertion if dependency harness supports CLI deps**

If `test/plugin-lifecycle.test.ts` already captures `registerLibp2pMeshCli` dependencies, assert that `labels.afterLabelsSave` exists and refreshes the store:

```ts
assert.equal(typeof cliDeps.labels?.afterLabelsSave, "function");
await cliDeps.labels.afterLabelsSave("remote-instance");
assert.deepEqual(await store.resolve("remote-instance"), expectedRecordWithLocalLabels);
```

If the lifecycle test does not expose CLI deps, keep this behavior covered by the CLI test and by the store/router tests.

- [ ] **Step 6: Run CLI and lifecycle tests**

Run:

```bash
npm test -- test/profile-cli.test.ts test/plugin-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit CLI/plugin task**

```bash
git add src/profile-cli.ts src/plugin.ts test/profile-cli.test.ts test/plugin-lifecycle.test.ts
git commit -m "feat: refresh local label snapshots after label edits"
```

---

### Task 4: Make `p2p_list_instances` Prefer Snapshot `localLabels`

**Files:**
- Modify: `src/agent-tools.ts`
- Test: `test/agent-tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

In `test/agent-tools.test.ts`, add two assertions around the existing `p2p_list_instances` helper.

```ts
test("list instances uses record localLabels before peer label store fallback", async () => {
  const recordLocal: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "实验室",
    label: "实验室",
    source: "local",
  };
  const fallbackLocal: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "备用",
    label: "备用",
    source: "local",
  };
  const response = await listInstancesTool({
    router: makeRouter({
      instances: [{
        instanceId: "remote-instance",
        peerId: "remote-peer",
        instanceName: "remote",
        multiaddrs: [],
        userPublicAttributes: [],
        localLabels: [recordLocal],
        lastSeenAt: 1,
        lastAnnouncedAt: 1,
        source: "announce",
      }],
    }),
    localLabels: {
      "remote-instance": [fallbackLocal],
    },
  }).execute("call-1", {});

  assert.deepEqual(response.details.instances[0].localLabels, [recordLocal]);
});

test("list instances falls back to peer label store when record has no localLabels", async () => {
  const fallbackLocal: LocalPeerLabelAttribute = {
    kind: "structured",
    key: "group",
    value: "实验室",
    label: "实验室",
    source: "local",
  };
  const response = await listInstancesTool({
    router: makeRouter({
      instances: [{
        instanceId: "remote-instance",
        peerId: "remote-peer",
        instanceName: "remote",
        multiaddrs: [],
        userPublicAttributes: [],
        lastSeenAt: 1,
        lastAnnouncedAt: 1,
        source: "announce",
      }],
    }),
    localLabels: {
      "remote-instance": [fallbackLocal],
    },
  }).execute("call-1", {});

  assert.deepEqual(response.details.instances[0].localLabels, [fallbackLocal]);
});
```

- [ ] **Step 2: Run failing agent tool tests**

Run:

```bash
npm test -- test/agent-tools.test.ts
```

Expected: first new test FAILS because the tool currently always reads `peerLabelStore`.

- [ ] **Step 3: Update `p2p_list_instances` row creation**

In `src/agent-tools.ts`, replace the `localLabels` assignment in `p2p_list_instances`.

```ts
              localLabels:
                entry.localLabels && entry.localLabels.length > 0
                  ? entry.localLabels
                  : options.peerLabelStore
                    ? await options.peerLabelStore.listLabels(entry.instanceId)
                    : [],
```

If the formatter does not already state privacy, update its local label header text to:

```ts
      lines.push("   localLabels: none (local private labels; not broadcast)");
```

and for non-empty labels:

```ts
      lines.push("   localLabels (local private labels; not broadcast):");
```

- [ ] **Step 4: Run agent tool tests**

Run:

```bash
npm test -- test/agent-tools.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit agent tool task**

```bash
git add src/agent-tools.ts test/agent-tools.test.ts
git commit -m "feat: list local label snapshots in instance tool"
```

---

### Task 5: Sync Prompt Wording and Run Full Verification

**Files:**
- Modify: `src/prompt-config.ts`
- Test: `test/prompt-config.test.ts`

- [ ] **Step 1: Write failing prompt assertions**

In `test/prompt-config.test.ts`, add:

```ts
test("libp2p prompt explains localLabels snapshot privacy", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /instance-peer\.json/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*私有.*快照/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*不会.*instance-announce/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /本地标签.*scope="local"/s);
});
```

- [ ] **Step 2: Run failing prompt test**

Run:

```bash
npm test -- test/prompt-config.test.ts
```

Expected: FAIL until prompt wording is updated.

- [ ] **Step 3: Update `LIBP2P_MESH_AGENT_PROMPT`**

In `src/prompt-config.ts`, replace the current local labels bullet in section two with:

```md
3. 本地标签来源：

   - \`openclaw libp2p-mesh labels\` manages local labels for remote instances.
   - These labels are stored in the local \`peer-labels.json\`; \`instance-peer.json.localLabels\` is only a derived local private snapshot for easier inspection and matching.
   - \`localLabels\` are not remote public attributes, are not produced by the remote user's USER.md/profile, are never included in \`instance-announce\`, and are not sent to or shown to the labeled user.
   - Use local labels only when the send tool uses \`scope="local"\` or \`scope="all"\`.
```

In section three, update the `localLabels` display rule to:

```md
   - \`localLabels\`：本机私有维护的本地标签快照，可能来自 \`instance-peer.json.localLabels\`，真实来源仍是本机 \`peer-labels.json\`。
   不要把 \`localLabels\` 说成远端公开属性，也不要暗示这些标签会广播或通知对方。
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- test/instance-peer-store.test.ts test/instance-router.test.ts test/profile-cli.test.ts test/plugin-lifecycle.test.ts test/agent-tools.test.ts test/prompt-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run build and full test suite**

Run:

```bash
npm run build
npm test
```

Expected: both PASS.

- [ ] **Step 6: Commit prompt and verification task**

```bash
git add src/prompt-config.ts test/prompt-config.test.ts
git commit -m "docs: clarify local label snapshot prompt rules"
```

---

## Final Manual Verification

- [ ] Start two gateways that have discovered each other.
- [ ] On one node, run `openclaw libp2p-mesh labels` and assign `group=实验室` to the remote instance.
- [ ] Restart gateway.
- [ ] Inspect `~/.openclaw/libp2p/instance-peer.json` and verify the remote record contains:

```json
"localLabels": [
  {
    "kind": "structured",
    "key": "group",
    "value": "实验室",
    "label": "实验室",
    "source": "local"
  }
]
```

- [ ] Inspect the other node's `instance-peer.json` and verify it does not contain your local label.
- [ ] In Feishu, say: `给本地标签 group=实验室 的用户发消息：我这边准备好了`
- [ ] Confirm the agent first performs a dry run with `scope="local"` and then sends with the same selector/scope/message.

## Self-Review

- Spec coverage:
  - `instance-peer.json.localLabels` snapshot is implemented by Task 1.
  - Startup and announce sync are implemented by Task 2.
  - `labels` command save sync is implemented by Task 3.
  - `p2p_list_instances` complete separated output is implemented by Task 4.
  - Prompt synchronization is implemented by Task 5.
  - Non-broadcast and no notification behavior is preserved because no task changes `InstanceAnnouncePayload` or announce serialization to include `localLabels`.
- Placeholder scan:
  - The plan contains no unresolved placeholder and no deferred implementation step.
- Type consistency:
  - `localLabels?: LocalPeerLabelAttribute[]`, `syncLocalLabels`, and `updateLocalLabels` are introduced in Task 1 and used with the same names in later tasks.
