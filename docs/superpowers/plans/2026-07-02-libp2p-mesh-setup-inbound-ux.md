# libp2p-mesh Setup Inbound UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `openclaw libp2p-mesh setup` so configured-channel sync is skippable, network setup no longer disables inbound delivery, and CLI wording explains where received P2P messages appear.

**Architecture:** Keep the existing setup wizard structure in `src/setup-wizard.ts`. Add small formatting helpers for sync summaries and target prompts, keep pure config helpers in `src/setup-config.ts`, and cover behavior through `node:test` tests before implementation.

**Tech Stack:** TypeScript, Node.js `node:test`, OpenClaw plugin CLI runtime, existing `SetupPrompter` abstraction.

---

## File Structure

- Modify `src/setup-wizard.ts`: CLI flow labels, sync prompt behavior, sync summary printing, target prompt labels, removal of `tools-only` from displayed network choices.
- Modify `src/setup-config.ts`: remove `tools-only` from `SetupMode` and `buildNetworkConfig()`.
- Modify `test/setup-wizard.test.ts`: add wizard-level regression tests for skippable sync, menu choices, and manual target required behavior.
- Modify `test/setup-config.test.ts`: add pure helper regression coverage for supported network setup modes.
- Modify `README.md`: update setup flow text and examples to describe network setup and inbound delivery separately.
- Modify `docs/安装指南-zh.md`: mirror user-facing Chinese setup wording if this guide contains the old flow.

---

### Task 1: Add Failing Tests for Skippable Sync

**Files:**
- Modify: `test/setup-wizard.test.ts`
- Later modify: `src/setup-wizard.ts`

- [ ] **Step 1: Append a failing test for mixed sync input**

Add this test to `test/setup-wizard.test.ts` after the existing test:

```ts
test("runSetupWizard skips configured channels when sync target input is empty", async () => {
  const prints: string[] = [];
  const inputs = ["chat:123456", ""];
  const selections = ["sync-from-channels", "preview-apply"];
  let writtenConfig: unknown;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
              inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
            },
          },
        },
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
        qqbot: { enabled: true },
      },
    },
    prompter: {
      async confirm(message) {
        assert.equal(message, "Apply this config?");
        return true;
      },
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input(message, options) {
        assert.match(message, /^Target for (telegram|qqbot) \(leave empty to skip\)$/);
        assert.equal(options?.required, false);
        const value = inputs.shift();
        assert.notEqual(value, undefined);
        return value ?? "";
      },
      print(message) {
        prints.push(message);
      },
    },
    writer: {
      async write(nextConfig) {
        writtenConfig = nextConfig;
      },
    },
  });

  assert.equal(result.status, "applied");
  assert.ok(writtenConfig);

  const nextConfig = writtenConfig as {
    plugins?: {
      entries?: {
        "libp2p-mesh"?: {
          config?: {
            inboundTargets?: Array<{ id?: string; channel: string; target: string }>;
          };
        };
      };
    };
  };

  assert.deepEqual(nextConfig.plugins?.entries?.["libp2p-mesh"]?.config?.inboundTargets, [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
    { id: "telegram-main", channel: "telegram", target: "chat:123456" },
  ]);

  const output = prints.join("\n");
  assert.match(output, /Already configured:/);
  assert.match(output, /Channels without inbound targets:/);
  assert.match(output, /Leave a target empty to skip that channel\./);
  assert.match(output, /Added:/);
  assert.match(output, /telegram-main     telegram \/ chat:123456/);
  assert.match(output, /Skipped:/);
  assert.match(output, /qqbot/);
});
```

- [ ] **Step 2: Append a failing test for skipping all missing channels**

Add this test to `test/setup-wizard.test.ts`:

```ts
test("runSetupWizard preserves existing inbound targets when all sync inputs are skipped", async () => {
  const prints: string[] = [];
  const inputs = ["", ""];
  const selections = ["sync-from-channels", "preview-apply"];
  let writtenConfig: unknown;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
              inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
            },
          },
        },
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
        qqbot: { enabled: true },
      },
    },
    prompter: {
      async confirm(message) {
        assert.equal(message, "Apply this config?");
        return true;
      },
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input(message, options) {
        assert.match(message, /^Target for (telegram|qqbot) \(leave empty to skip\)$/);
        assert.equal(options?.required, false);
        const value = inputs.shift();
        assert.notEqual(value, undefined);
        return value ?? "";
      },
      print(message) {
        prints.push(message);
      },
    },
    writer: {
      async write(nextConfig) {
        writtenConfig = nextConfig;
      },
    },
  });

  assert.equal(result.status, "applied");
  assert.ok(writtenConfig);

  const nextConfig = writtenConfig as {
    plugins?: {
      entries?: {
        "libp2p-mesh"?: {
          config?: {
            inboundTargets?: Array<{ id?: string; channel: string; target: string }>;
          };
        };
      };
    };
  };

  assert.deepEqual(nextConfig.plugins?.entries?.["libp2p-mesh"]?.config?.inboundTargets, [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
  ]);

  const output = prints.join("\n");
  assert.match(output, /No inbound targets were added\./);
  assert.match(output, /Skipped:/);
  assert.match(output, /telegram/);
  assert.match(output, /qqbot/);
});
```

- [ ] **Step 3: Update the existing sync test expectation so it describes the new optional prompt**

In the first test in `test/setup-wizard.test.ts`, replace the `input()` assertions with:

```ts
      async input(message, options) {
        assert.equal(message, "Target for telegram (leave empty to skip)");
        assert.equal(options?.required, false);
        const value = inputs.shift();
        assert.ok(value);
        return value;
      },
```

- [ ] **Step 4: Run the wizard test and verify it fails**

Run:

```bash
npm test -- test/setup-wizard.test.ts
```

Expected: FAIL. The failure should mention either the old message `Target for telegram` or `options.required` still being `true`.

- [ ] **Step 5: Implement skippable sync and result summaries**

In `src/setup-wizard.ts`, replace `syncInboundTargetsFromConfiguredChannels()` with:

```ts
async function syncInboundTargetsFromConfiguredChannels(
  pluginConfig: MeshConfig,
  options: RunSetupWizardOptions,
): Promise<MeshConfig> {
  const configuredChannels = listConfiguredChannels(options.currentConfig);
  const plan = planInboundTargetSync(pluginConfig.inboundTargets ?? [], configuredChannels);
  if (plan.missingChannels.length === 0) {
    options.prompter.print("All configured channels already have inbound targets.");
    return setInboundTargets(pluginConfig, plan.targets);
  }

  options.prompter.print(formatInboundSyncPlan(plan.targets, plan.missingChannels));

  let targets = plan.targets.map((target) => ({ ...target }));
  const addedTargets: InboundTargetConfig[] = [];
  const skippedChannels: string[] = [];

  for (const channel of plan.missingChannels) {
    const target = await options.prompter.input(`Target for ${channel} (leave empty to skip)`, {
      required: false,
    });
    const normalizedTarget = target.trim();
    if (!normalizedTarget) {
      skippedChannels.push(channel);
      continue;
    }

    const addResult = addInboundTarget(targets, { channel, target: normalizedTarget });
    if (!addResult.ok) {
      options.prompter.print(addResult.error);
      continue;
    }
    targets = addResult.targets;
    addedTargets.push(addResult.added);
  }

  options.prompter.print(formatInboundSyncResult(addedTargets, skippedChannels));
  return setInboundTargets(pluginConfig, targets);
}
```

Add these helper functions below `syncInboundTargetsFromConfiguredChannels()`:

```ts
function formatInboundSyncPlan(
  existingTargets: InboundTargetConfig[],
  missingChannels: string[],
): string {
  const lines: string[] = [];

  if (existingTargets.length > 0) {
    lines.push("Already configured:");
    for (const target of existingTargets) {
      lines.push(`  - ${formatInboundTargetLine(target)}`);
    }
  } else {
    lines.push("Already configured:");
    lines.push("  none");
  }

  lines.push("");
  lines.push("Channels without inbound targets:");
  for (const channel of missingChannels) {
    lines.push(`  - ${channel}`);
  }
  lines.push("");
  lines.push("Leave a target empty to skip that channel.");

  return lines.join("\n");
}

function formatInboundSyncResult(
  addedTargets: InboundTargetConfig[],
  skippedChannels: string[],
): string {
  const lines: string[] = [];

  if (addedTargets.length > 0) {
    lines.push("Added:");
    for (const target of addedTargets) {
      lines.push(`  - ${formatInboundTargetLine(target)}`);
    }
  } else {
    lines.push("No inbound targets were added.");
  }

  if (skippedChannels.length > 0) {
    lines.push("");
    lines.push("Skipped:");
    for (const channel of skippedChannels) {
      lines.push(`  - ${channel}`);
    }
  }

  return lines.join("\n");
}

function formatInboundTargetLine(target: InboundTargetConfig): string {
  return `${target.id ?? "(unnamed)"}     ${target.channel} / ${target.target}`;
}
```

- [ ] **Step 6: Run the wizard tests and verify they pass**

Run:

```bash
npm test -- test/setup-wizard.test.ts
```

Expected: PASS for all tests in `test/setup-wizard.test.ts`.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/setup-wizard.ts test/setup-wizard.test.ts
git commit -m "feat: allow skipping inbound sync targets"
```

Expected: a commit containing only setup wizard sync behavior and tests.

---

### Task 2: Split Network Setup From Inbound Delivery

**Files:**
- Modify: `src/setup-config.ts`
- Modify: `src/setup-wizard.ts`
- Modify: `test/setup-wizard.test.ts`
- Modify: `test/setup-config.test.ts`

- [ ] **Step 1: Add a failing test that network setup choices no longer include tools-only**

Add this test to `test/setup-wizard.test.ts`:

```ts
test("runSetupWizard network mode choices do not include tools-only", async () => {
  const networkChoiceSets: string[][] = [];
  const selections = ["network-mode", "lan", "preview-apply"];
  let writtenConfig: unknown;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
              inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
            },
          },
        },
      },
    },
    prompter: {
      async confirm(message) {
        assert.equal(message, "Apply this config?");
        return true;
      },
      async select(message, choices) {
        if (message === "Choose network setup:") {
          networkChoiceSets.push(choices.map((choice) => choice.value));
        }
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input() {
        assert.fail("LAN network setup should not prompt for input");
      },
      print() {},
    },
    writer: {
      async write(nextConfig) {
        writtenConfig = nextConfig;
      },
    },
  });

  assert.equal(result.status, "applied");
  assert.ok(writtenConfig);
  assert.deepEqual(networkChoiceSets, [["lan", "cross-network", "relay-node"]]);
});
```

- [ ] **Step 2: Add a failing pure config test that `buildNetworkConfig()` no longer accepts tools-only**

At the top of `test/setup-config.test.ts`, update the import to include `buildNetworkConfig`:

```ts
import {
  applyDefaultMeshConfig,
  buildNetworkConfig,
  DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  planInboundTargetSync,
} from "../src/setup-config.js";
```

Append this test:

```ts
test("buildNetworkConfig supports only network setup modes", () => {
  assert.deepEqual(buildNetworkConfig("lan"), {
    discovery: "mdns",
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });

  assert.deepEqual(
    buildNetworkConfig("cross-network", {
      crossNetwork: {
        bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
        relayList: [],
      },
    }),
    {
      discovery: "bootstrap",
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
      enableNATTraversal: true,
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    },
  );
});
```

- [ ] **Step 3: Run the targeted tests and verify failure**

Run:

```bash
npm test -- test/setup-wizard.test.ts test/setup-config.test.ts
```

Expected: FAIL because `selectSetupMode()` still says `Choose setup mode:` and still includes `tools-only`.

- [ ] **Step 4: Remove `tools-only` from the setup mode type and network config builder**

In `src/setup-config.ts`, replace:

```ts
export type SetupMode = "lan" | "cross-network" | "relay-node" | "tools-only";
```

with:

```ts
export type SetupMode = "lan" | "cross-network" | "relay-node";
```

Remove this `case` from `buildNetworkConfig()`:

```ts
    case "tools-only":
      return {
        discovery: "mdns",
        inboundTargets: [],
        deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
      };
```

- [ ] **Step 5: Remove tools-only from the prompt choice union**

In `src/setup-wizard.ts`, remove this union member from `SetupPromptChoice`:

```ts
  | "tools-only"
```

- [ ] **Step 6: Replace the network setup selector**

In `src/setup-wizard.ts`, replace `selectSetupMode()` with:

```ts
async function selectSetupMode(prompter: SetupPrompter): Promise<SetupMode> {
  return prompter.select("Choose network setup:", [
    { label: "Use default LAN discovery", value: "lan" },
    { label: "Add bootstrap / relay addresses for cross-network use", value: "cross-network" },
    { label: "Configure this machine as a public relay node", value: "relay-node" },
  ]);
}
```

- [ ] **Step 7: Improve cross-network relay prompt and relay-node listen default**

In `src/setup-wizard.ts`, replace `buildNetworkConfigFromPrompts()` with:

```ts
async function buildNetworkConfigFromPrompts(mode: SetupMode, prompter: SetupPrompter): Promise<MeshConfig> {
  switch (mode) {
    case "cross-network":
      return buildNetworkConfig("cross-network", {
        crossNetwork: {
          bootstrapList: await promptForAddressList(prompter, "Bootstrap multiaddr", "Add another bootstrap?"),
          relayList: await promptForOptionalAddressList(
            prompter,
            "Relay multiaddr (optional, leave empty to skip)",
            "Add another relay?",
          ),
        },
      });
    case "relay-node":
      return buildNetworkConfig("relay-node", {
        relayNode: {
          listenAddrs: [
            await prompter.input("Listen address", {
              defaultValue: "/ip4/0.0.0.0/tcp/4001",
              required: true,
            }),
          ],
          announceAddrs: [await prompter.input("Public announce address", { required: true })],
        },
      });
    default:
      return buildNetworkConfig(mode);
  }
}
```

- [ ] **Step 8: Run the targeted tests**

Run:

```bash
npm test -- test/setup-wizard.test.ts test/setup-config.test.ts
```

Expected: PASS for setup wizard and setup config tests.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/setup-config.ts src/setup-wizard.ts test/setup-wizard.test.ts test/setup-config.test.ts
git commit -m "refactor: separate network setup from inbound delivery"
```

Expected: a commit with network mode and tests only. If Task 1 changes are uncommitted, commit Task 1 first.

---

### Task 3: Improve Inbound Setup Labels and Manual Target Prompts

**Files:**
- Modify: `src/setup-wizard.ts`
- Modify: `test/setup-wizard.test.ts`

- [ ] **Step 1: Add a failing test for first-run inbound menu labels**

Append this test to `test/setup-wizard.test.ts`:

```ts
test("runSetupWizard first-run inbound setup uses user-facing receive wording", async () => {
  const selectMessages: string[] = [];
  const inboundLabels: string[] = [];
  const selections = ["lan", "skip-inbound"];
  let writtenConfig: unknown;

  const result = await runSetupWizard({
    currentConfig: {},
    prompter: {
      async confirm(message) {
        if (message === "Continue?") {
          return true;
        }
        assert.equal(message, "Apply this config?");
        return true;
      },
      async select(message, choices) {
        selectMessages.push(message);
        if (message === "Configure where received P2P messages should appear?") {
          inboundLabels.push(...choices.map((choice) => choice.label));
        }
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input() {
        assert.fail("LAN setup with leave unchanged should not prompt for input");
      },
      print() {},
    },
    writer: {
      async write(nextConfig) {
        writtenConfig = nextConfig;
      },
    },
  });

  assert.equal(result.status, "applied");
  assert.ok(writtenConfig);
  assert.ok(selectMessages.includes("Configure where received P2P messages should appear?"));
  assert.deepEqual(inboundLabels, [
    "Sync from existing channels",
    "Add a target manually",
    "Do not receive P2P messages in local channels",
    "Leave unchanged for now",
  ]);
});
```

- [ ] **Step 2: Add a failing test for existing-config edit menu wording**

Append this test to `test/setup-wizard.test.ts`:

```ts
test("runSetupWizard existing-config edit menu uses receive-location wording", async () => {
  const editLabels: string[] = [];
  const selections = ["preview-apply"];
  let writtenConfig: unknown;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
              inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
            },
          },
        },
      },
    },
    prompter: {
      async confirm(message) {
        assert.equal(message, "Apply this config?");
        return true;
      },
      async select(message, choices) {
        if (message === "What do you want to edit?") {
          editLabels.push(...choices.map((choice) => choice.label));
        }
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input() {
        assert.fail("preview-only flow should not prompt for input");
      },
      print() {},
    },
    writer: {
      async write(nextConfig) {
        writtenConfig = nextConfig;
      },
    },
  });

  assert.equal(result.status, "applied");
  assert.ok(writtenConfig);
  assert.deepEqual(editLabels, [
    "Sync inbound targets from channels",
    "Network setup",
    "Where received P2P messages appear",
    "Preview and apply",
    "Cancel",
  ]);
});
```

- [ ] **Step 3: Add a failing test for manual target prompt wording**

Append this test to `test/setup-wizard.test.ts`:

```ts
test("runSetupWizard manual target setup prompts target with selected channel name", async () => {
  const inputMessages: string[] = [];
  const selections = ["lan", "add-targets", "feishu", "finish-targets"];
  const inputs = ["user:ou_xxx"];
  let writtenConfig: unknown;

  const result = await runSetupWizard({
    currentConfig: {
      channels: {
        feishu: { enabled: true },
      },
    },
    prompter: {
      async confirm(message) {
        if (message === "Continue?") {
          return true;
        }
        assert.equal(message, "Apply this config?");
        return true;
      },
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input(message, options) {
        inputMessages.push(message);
        assert.equal(options?.required, true);
        const value = inputs.shift();
        assert.ok(value);
        return value;
      },
      print() {},
    },
    writer: {
      async write(nextConfig) {
        writtenConfig = nextConfig;
      },
    },
  });

  assert.equal(result.status, "applied");
  assert.ok(writtenConfig);
  assert.deepEqual(inputMessages, ["Target for feishu"]);
});
```

- [ ] **Step 4: Run the wizard tests and verify failure**

Run:

```bash
npm test -- test/setup-wizard.test.ts
```

Expected: FAIL because current labels still use the old inbound wording and manual prompts still say `Target`.

- [ ] **Step 5: Update first-run inbound menu labels**

In `src/setup-wizard.ts`, replace:

```ts
  const inboundChoice = await options.prompter.select("Configure inbound delivery targets?", [
    { label: "Sync from configured channels", value: "sync-from-channels" },
    { label: "Add one or more targets", value: "add-targets" },
    { label: "Disable inbound delivery for now", value: "disable-inbound" },
    { label: "Skip for now", value: "skip-inbound" },
  ]);
```

with:

```ts
  const inboundChoice = await options.prompter.select("Configure where received P2P messages should appear?", [
    { label: "Sync from existing channels", value: "sync-from-channels" },
    { label: "Add a target manually", value: "add-targets" },
    { label: "Do not receive P2P messages in local channels", value: "disable-inbound" },
    { label: "Leave unchanged for now", value: "skip-inbound" },
  ]);
```

- [ ] **Step 6: Update existing-config edit menu labels**

In `src/setup-wizard.ts`, replace this choice list inside `runExistingConfigFlow()`:

```ts
    const editChoice = await options.prompter.select("What do you want to edit?", [
      { label: "Sync inbound targets from channels", value: "sync-from-channels" },
      { label: "Network mode", value: "network-mode" },
      { label: "Inbound delivery targets", value: "inbound-targets" },
      { label: "Preview and apply", value: "preview-apply" },
      { label: "Cancel", value: "cancel" },
    ]);
```

with:

```ts
    const editChoice = await options.prompter.select("What do you want to edit?", [
      { label: "Sync inbound targets from channels", value: "sync-from-channels" },
      { label: "Network setup", value: "network-mode" },
      { label: "Where received P2P messages appear", value: "inbound-targets" },
      { label: "Preview and apply", value: "preview-apply" },
      { label: "Cancel", value: "cancel" },
    ]);
```

- [ ] **Step 7: Add and use a target prompt helper**

Add this helper near `promptForChannel()` in `src/setup-wizard.ts`:

```ts
function targetPromptForChannel(channel: string): string {
  return `Target for ${channel}`;
}
```

Replace this line in `promptForInboundTargets()`:

```ts
    const target = await options.prompter.input("Target", { required: true });
```

with:

```ts
    const target = await options.prompter.input(targetPromptForChannel(channel), { required: true });
```

Replace this line in `promptForOneInboundTarget()`:

```ts
  const target = await options.prompter.input("Target", { required: true });
```

with:

```ts
  const target = await options.prompter.input(targetPromptForChannel(channel), { required: true });
```

Replace this line in `promptForInboundTargetEdit()`:

```ts
  const target = await options.prompter.input("Target", { required: true });
```

with:

```ts
  const target = await options.prompter.input(targetPromptForChannel(channel), { required: true });
```

- [ ] **Step 8: Run the wizard tests**

Run:

```bash
npm test -- test/setup-wizard.test.ts
```

Expected: PASS for all wizard tests.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add src/setup-wizard.ts test/setup-wizard.test.ts
git commit -m "chore: clarify setup wizard inbound wording"
```

Expected: a commit containing prompt wording updates and tests.

---

### Task 4: Update Documentation and Verify Full Build

**Files:**
- Modify: `README.md`
- Modify: `docs/安装指南-zh.md`
- Verify: `package.json`

- [ ] **Step 1: Inspect docs for old setup wording**

Run:

```bash
rg -n "Tools only|Configure inbound delivery targets|Sync from configured channels|Network mode|Disable inbound delivery|Skip for now|Relay multiaddr" README.md docs/安装指南-zh.md
```

Expected: matches in README and possibly Chinese installation guide showing old setup flow wording.

- [ ] **Step 2: Update README setup flow**

In `README.md`, update the setup section so it states:

```md
The setup wizard separates network setup from inbound delivery.

Network setup chooses the parameters for your topology:

- Use default LAN discovery.
- Add bootstrap / relay addresses for cross-network use.
- Configure this machine as a public relay node.

Inbound delivery chooses where received P2P messages should appear:

- Sync from existing channels.
- Add a target manually.
- Do not receive P2P messages in local channels.
- Leave unchanged for now.

When syncing from existing channels, leave a target empty to skip that channel.
```

Keep existing JSON examples for LAN, bootstrap, relay node, and multiple inbound targets. Remove or rewrite any text that says `Tools only` is a network mode.

- [ ] **Step 3: Update Chinese installation guide setup flow**

In `docs/安装指南-zh.md`, update the setup section with this user-facing wording:

```md
配置向导会把网络配置和入站投递分开处理。

网络配置只决定当前节点如何发现或连接其他节点：

- 使用默认局域网发现。
- 添加 bootstrap / relay 地址用于跨网络连接。
- 将当前机器配置为公网 relay 节点。

入站投递配置决定收到 P2P 消息后显示到哪里：

- 从现有 channels 同步。
- 手动添加一个 target。
- 不把 P2P 消息投递到本地 channel。
- 暂时保持不变。

从现有 channels 同步时，某个 channel 的 target 可以直接留空，表示跳过该 channel。
```

Do not overwrite unrelated user edits in this file. If the file already contains user changes, edit only the paragraphs that describe `openclaw libp2p-mesh setup`.

- [ ] **Step 4: Run all tests**

Run:

```bash
npm test
```

Expected: all `node:test` tests pass.

- [ ] **Step 5: Run the TypeScript build**

Run:

```bash
npm run build
```

Expected: TypeScript compilation completes without errors and updates `dist/` if this repository tracks generated output.

- [ ] **Step 6: Inspect git status**

Run:

```bash
git status --short
```

Expected: only files intentionally changed by this implementation are listed. Existing unrelated user edits to `package.json` or `docs/安装指南-zh.md` must not be reverted.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git diff -- README.md docs/安装指南-zh.md dist
git add README.md
git add dist
```

If `docs/安装指南-zh.md` contains only changes from this task, also run:

```bash
git add docs/安装指南-zh.md
```

If `docs/安装指南-zh.md` contains pre-existing unrelated user changes, do not stage the whole file. Split the change or leave the guide unstaged and call this out in the handoff.

Then run:

```bash
git commit -m "docs: update setup wizard configuration flow"
```

Expected: a docs and generated-output commit. If `dist/` is unchanged, `git add dist` is harmless.

---

## Final Verification

- [ ] Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] Run:

```bash
npm run build
```

Expected: TypeScript build passes.

- [ ] Run:

```bash
git log --oneline -5
```

Expected: recent commits include the spec commit plus implementation commits for sync skipping, network/inbound split, wording, and docs.

- [ ] Run:

```bash
git status --short
```

Expected: no unintended source or test changes remain. Any pre-existing user changes should be called out explicitly rather than reverted.
