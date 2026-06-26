# libp2p-mesh 入站目标同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `openclaw libp2p-mesh setup` incrementally sync inbound delivery targets from the currently configured OpenClaw channels without overwriting existing `inboundTargets`.

**Architecture:** Keep the synchronization logic inside `setup-config.ts` as small pure helpers that compute missing channel targets and merge them into an existing inbound target list. Extend `setup-wizard.ts` to expose a new sync action that reuses existing targets, prompts only for missing `target` values, and writes the merged result once at the end. Preserve the current manual add/edit/remove flow for advanced edits and keep all non-inbound plugin config untouched.

**Tech Stack:** TypeScript, `node:test`, `tsx`, OpenClaw plugin CLI/runtime APIs already used by the repo.

---

### Task 1: Add pure inbound-target sync helpers and unit coverage

**Files:**
- Modify: `src/setup-config.ts`
- Modify: `test/setup-config.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests that describe the sync behavior directly in `test/setup-config.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  planInboundTargetSync,
  type InboundTargetConfig,
} from "../src/setup-config.js";

test("planInboundTargetSync preserves existing targets and reports only missing channels", () => {
  const existingTargets: InboundTargetConfig[] = [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
  ];

  const result = planInboundTargetSync(existingTargets, ["feishu", "telegram", "qqbot"]);

  assert.deepEqual(result.targets, [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
  ]);
  assert.deepEqual(result.missingChannels, ["telegram", "qqbot"]);
});

test("planInboundTargetSync does not duplicate existing channel-target pairs", () => {
  const existingTargets: InboundTargetConfig[] = [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
    { id: "telegram-main", channel: "telegram", target: "chat:123456" },
  ];

  const result = planInboundTargetSync(existingTargets, ["feishu", "telegram"]);

  assert.deepEqual(result.targets, existingTargets);
  assert.deepEqual(result.missingChannels, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- test/setup-config.test.ts
```

Expected: TypeScript/test failures because `planInboundTargetSync` does not exist yet.

- [ ] **Step 3: Implement the minimal helper**

Add a pure helper in `src/setup-config.ts` that:

- accepts `existingTargets` and a list of configured channel names
- strips `libp2p-mesh`
- keeps the first existing target for each channel
- returns the unchanged targets plus a list of missing channels
- does not invent placeholder `target` values
- keeps the helper deterministic and side-effect free

Keep the helper small and local to `setup-config.ts` so the wizard can reuse it without duplicating merge logic.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- test/setup-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/setup-config.ts test/setup-config.test.ts
git commit -m "feat: add inbound target sync helpers"
```

### Task 2: Add setup wizard sync flow and interactive tests

**Files:**
- Modify: `src/setup-wizard.ts`
- Create: `test/setup-wizard.test.ts`

- [ ] **Step 1: Write the failing test**

Create a focused wizard test file that exercises the new sync action with a fake prompter:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { runSetupWizard } from "../src/setup-wizard.js";

test("runSetupWizard syncs missing inbound targets from configured channels without overwriting existing ones", async () => {
  const prints: string[] = [];
  const inputs = ["chat:123456"];
  const selections = [
    "inbound-targets",
    "sync-from-channels",
    "preview-apply",
  ];

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
            },
          },
        },
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    },
    prompter: {
      async confirm(message) {
        if (message === "Apply this config?") return true;
        return true;
      },
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input() {
        const value = inputs.shift();
        assert.ok(value);
        return value;
      },
      print(message) {
        prints.push(message);
      },
    },
    writer: {
      async write() {},
    },
  });

  assert.equal(result.status, "applied");
  assert.match(prints.join("\n"), /telegram/);
  assert.match(prints.join("\n"), /feishu/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- test/setup-wizard.test.ts
```

Expected: FAIL because the wizard does not yet offer a `sync-from-channels` path and the helper is not wired in.

- [ ] **Step 3: Extend the wizard with a sync action**

Update `src/setup-wizard.ts` so the inbound-target menu offers a new `sync-from-channels` choice. The new path should:

- read `listConfiguredChannels(options.currentConfig)`
- call the helper from `setup-config.ts` to detect missing channels
- prompt only for the missing channel targets
- merge the newly prompted entries with the existing `inboundTargets`
- preserve the existing manual add/edit/remove/disable actions

Keep the behavior one-way:

- no deletion during sync
- no overwrite of existing per-channel targets
- no change to network settings

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm test -- test/setup-config.test.ts test/setup-wizard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/setup-wizard.ts test/setup-wizard.test.ts
git commit -m "feat: sync inbound targets from channels"
```

### Task 3: Update README and config guidance

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the doc update**

Update the setup section and inbound-target documentation to explain:

- setup now supports syncing inbound targets from current channels
- the sync action preserves existing `inboundTargets`
- new channels are only added when the user runs sync again
- this does not imply automatic background synchronization

Use the new behavior wording consistently so README does not still read as “one target at a time only”.

- [ ] **Step 2: Verify the docs references**

Run:

```bash
rg -n "inboundTargets|setup|sync from configured channels|automatic background synchronization" README.md
```

Expected: the updated sections mention the sync flow and clearly distinguish it from full manual editing.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe inbound target sync flow"
```

### Task 4: Run full validation and fix any regressions

**Files:**
- Modify: as needed based on validation

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- test/setup-config.test.ts test/setup-wizard.test.ts test/prompt-config.test.ts test/plugin-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Build the package**

Run:

```bash
npm run build
```

Expected: PASS with generated `dist/**` output updated by TypeScript.

- [ ] **Step 4: Fix any final mismatches**

If validation surfaces type or behavior regressions, fix them in the smallest file that owns the behavior:

- helper logic stays in `src/setup-config.ts`
- wizard flow stays in `src/setup-wizard.ts`
- user-facing guidance stays in `README.md`

Then rerun the same validation commands until they pass.

### Task 5: Final sanity check before handoff

**Files:**
- No code changes unless validation found one

- [ ] **Step 1: Re-read the spec and plan together**

Confirm the implementation still satisfies:

- no overwrite of existing `inboundTargets`
- incremental sync only
- no automatic deletion of missing channels
- no SDK changes for channel default target discovery

- [ ] **Step 2: Capture the final state**

Record the exact validation commands that passed:

```bash
npm test -- test/setup-config.test.ts test/setup-wizard.test.ts test/prompt-config.test.ts test/plugin-lifecycle.test.ts
npm test
npm run build
```
