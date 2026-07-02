# libp2p-mesh 自动网络入口配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `openclaw libp2p-mesh setup` 从“选择网络模式”改成“默认自动发现 + 可选入口地址配置”，并在配置动作结束后自动 preview/apply。

**Architecture:** 保持现有 `setup-config.ts` 纯配置 helper 与 `setup-wizard.ts` 交互流程分层。运行时 `mesh.ts` 改为组合式 discovery：默认 mDNS + DHT，`bootstrapList` 非空时额外启用 bootstrap；setup 只写用户提供的入口地址，不写互斥 `discovery` 模式。

**Tech Stack:** TypeScript, Node.js `node:test`, OpenClaw plugin CLI runtime, libp2p discovery/bootstrap/mdns/kad-dht services.

---

## File Structure

- Modify `src/setup-config.ts`: replace mode-oriented network builders with entry-address and relay-node config helpers; preserve existing merge behavior for unrelated fields.
- Modify `src/setup-wizard.ts`: remove network mode selection and `Preview and apply` menu item; add first-run and existing-config flows for network entry addresses, public relay-node settings, automatic preview, and `Finish editing`.
- Modify `src/mesh.ts`: enable mDNS by default independently of `discovery`, keep DHT default enabled, and add bootstrap discovery whenever `bootstrapList` is non-empty.
- Modify `src/types.ts`: update stale `enableDHT` comment so it matches default behavior.
- Modify `test/setup-config.test.ts`: cover new pure helper behavior and removal of `discovery: "bootstrap"` from generated network entry config.
- Modify `test/setup-wizard.test.ts`: cover first-run no network-mode prompt, optional bootstrap/relay inputs, automatic preview, existing-config single-action menu, and `Finish editing`.
- Add `test/mesh-discovery-config.test.ts`: unit-test the new exported `planPeerDiscovery()` helper from `mesh.ts`.
- Modify `README.md` and `docs/安装指南-zh.md`: document automatic discovery and optional network entry addresses.
- Run `npm run build` and commit generated `dist/src/setup-config.*`, `dist/src/setup-wizard.*`, `dist/src/mesh.*`, and `dist/src/types.*` changes when applicable.

---

### Task 1: Pure Network Config Helpers

**Files:**
- Modify: `src/setup-config.ts`
- Modify: `test/setup-config.test.ts`

- [ ] **Step 1: Write failing tests for network entry config**

In `test/setup-config.test.ts`, replace the `buildNetworkConfig("cross-network"...` tests with tests for a new helper:

```ts
import {
  applyDefaultMeshConfig,
  buildNetworkEntryConfig,
  buildPublicRelayNodeConfig,
  DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  planInboundTargetSync,
} from "../src/setup-config.js";

test("buildNetworkEntryConfig omits empty bootstrap and relay lists", () => {
  assert.deepEqual(buildNetworkEntryConfig({ bootstrapList: [], relayList: [] }), {
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});

test("buildNetworkEntryConfig writes provided entry address lists without discovery mode", () => {
  assert.deepEqual(
    buildNetworkEntryConfig({
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
    }),
    {
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    },
  );
});
```

- [ ] **Step 2: Write failing tests for public relay-node config**

Add:

```ts
test("buildPublicRelayNodeConfig enables relay server with optional announce address", () => {
  assert.deepEqual(
    buildPublicRelayNodeConfig({
      enabled: true,
      listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
      announceAddrs: [],
    }),
    {
      listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
      enableCircuitRelayServer: true,
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    },
  );
});

test("buildPublicRelayNodeConfig disables relay server without touching entry addresses", () => {
  assert.deepEqual(buildPublicRelayNodeConfig({ enabled: false }), {
    enableCircuitRelayServer: false,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- test/setup-config.test.ts
```

Expected: FAIL because `buildNetworkEntryConfig` and `buildPublicRelayNodeConfig` are not exported yet.

- [ ] **Step 4: Implement pure helpers**

In `src/setup-config.ts`, add:

```ts
export type NetworkEntryOptions = {
  bootstrapList: string[];
  relayList: string[];
};

export type PublicRelayNodeOptions =
  | { enabled: false }
  | { enabled: true; listenAddrs: string[]; announceAddrs: string[] };

export function buildNetworkEntryConfig(options: NetworkEntryOptions): MeshConfig {
  return {
    ...(options.bootstrapList.length > 0 ? { bootstrapList: [...options.bootstrapList] } : {}),
    ...(options.relayList.length > 0 ? { relayList: [...options.relayList] } : {}),
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  };
}

export function buildPublicRelayNodeConfig(options: PublicRelayNodeOptions): MeshConfig {
  if (!options.enabled) {
    return {
      enableCircuitRelayServer: false,
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    };
  }

  return {
    listenAddrs: [...options.listenAddrs],
    ...(options.announceAddrs.length > 0 ? { announceAddrs: [...options.announceAddrs] } : {}),
    enableCircuitRelayServer: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  };
}
```

- [ ] **Step 5: Remove obsolete mode-builder assertions**

Remove tests asserting `buildNetworkConfig("cross-network")` writes `discovery: "bootstrap"`. After this task, `test/setup-config.test.ts` should only test the new `buildNetworkEntryConfig()` and `buildPublicRelayNodeConfig()` helpers for network setup generation. Source cleanup for `buildNetworkConfig()` and `SetupMode` happens in Task 2 after the wizard no longer imports them.

- [ ] **Step 6: Run config tests**

Run:

```bash
npm test -- test/setup-config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/setup-config.ts test/setup-config.test.ts
git commit -m "feat: add automatic network entry config helpers"
```

---

### Task 2: Setup Wizard Flow

**Files:**
- Modify: `src/setup-wizard.ts`
- Modify: `test/setup-wizard.test.ts`

- [ ] **Step 1: Update imports and tests for first-run flow**

In `test/setup-wizard.test.ts`, update first-run tests so selections no longer start with `"lan"`. Add a test:

```ts
test("runSetupWizard first-run skips optional network entry addresses and does not write empty lists", async () => {
  const inputs = ["", ""];
  const selections = ["skip-inbound"];
  let writtenConfig: any;
  const prints: string[] = [];

  const result = await runSetupWizard({
    currentConfig: {},
    prompter: {
      async confirm(message) {
        if (message === "Continue?") return true;
        assert.equal(message, "Apply this config?");
        return true;
      },
      async select(message, choices) {
        assert.notEqual(message, "Choose network setup:");
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input(message, options) {
        assert.match(message, /^(Bootstrap|Relay) multiaddr/);
        assert.equal(options?.required, false);
        return inputs.shift() ?? "";
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
  const pluginConfig = writtenConfig.plugins.entries["libp2p-mesh"].config;
  assert.equal(pluginConfig.bootstrapList, undefined);
  assert.equal(pluginConfig.relayList, undefined);
  assert.match(prints.join("\n"), /Network discovery is enabled automatically/);
});
```

- [ ] **Step 2: Add existing-config menu test without preview option**

Replace the existing edit-menu test expected labels/values with:

```ts
[
  "Sync inbound targets from channels",
  "Network entry addresses",
  "Public relay-node settings",
  "Where received P2P messages appear",
  "Cancel",
]
```

and values:

```ts
["sync-from-channels", "network-entry-addresses", "public-relay-node", "inbound-targets", "cancel"]
```

There should be no `preview-apply` value.

- [ ] **Step 3: Add existing network entry address tests**

Add tests:

```ts
test("runSetupWizard keeps existing network entry addresses when inputs are empty", async () => {
  const selections = ["network-entry-addresses"];
  const inputs = ["", ""];
  let writtenConfig: any;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
              relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
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
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input(message, options) {
        assert.match(message, /leave empty to keep unchanged/);
        assert.equal(options?.required, false);
        return inputs.shift() ?? "";
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
  assert.deepEqual(writtenConfig.plugins.entries["libp2p-mesh"].config.bootstrapList, ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"]);
  assert.deepEqual(writtenConfig.plugins.entries["libp2p-mesh"].config.relayList, ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"]);
});
```

Add this replacement variant:

```ts
test("runSetupWizard replaces network entry addresses when new values are entered", async () => {
  const selections = ["network-entry-addresses"];
  const inputs = [
    "/ip4/9.9.9.9/tcp/4001/p2p/12D3NewBootstrap",
    "/ip4/8.8.8.8/tcp/4001/p2p/12D3NewRelay",
  ];
  const confirms: boolean[] = [false, false, true];
  let writtenConfig: any;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3OldBootstrap"],
              relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3OldRelay"],
            },
          },
        },
      },
    },
    prompter: {
      async confirm(message) {
        if (message === "Add another bootstrap?" || message === "Add another relay?") {
          return confirms.shift() ?? false;
        }
        assert.equal(message, "Apply this config?");
        return confirms.shift() ?? true;
      },
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input(message, options) {
        assert.match(message, /leave empty to keep unchanged/);
        assert.equal(options?.required, false);
        return inputs.shift() ?? "";
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
  const pluginConfig = writtenConfig.plugins.entries["libp2p-mesh"].config;
  assert.deepEqual(pluginConfig.bootstrapList, ["/ip4/9.9.9.9/tcp/4001/p2p/12D3NewBootstrap"]);
  assert.deepEqual(pluginConfig.relayList, ["/ip4/8.8.8.8/tcp/4001/p2p/12D3NewRelay"]);
  assert.equal(pluginConfig.discovery, undefined);
});
```

- [ ] **Step 4: Add public relay-node tests**

Add:

```ts
test("runSetupWizard can disable public relay-node settings", async () => {
  const selections = ["public-relay-node"];
  const confirms = [false, true];
  let writtenConfig: any;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: { enableCircuitRelayServer: true },
          },
        },
      },
    },
    prompter: {
      async confirm(message) {
        if (message === "Enable this machine as a public relay node?") {
          return confirms.shift() ?? false;
        }
        assert.equal(message, "Apply this config?");
        return confirms.shift() ?? true;
      },
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input() {
        assert.fail("Disabling public relay node should not prompt for addresses");
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
  assert.equal(writtenConfig.plugins.entries["libp2p-mesh"].config.enableCircuitRelayServer, false);
});

test("runSetupWizard enables public relay node with default listen address and optional announce", async () => {
  const selections = ["public-relay-node"];
  const confirms = [true, true];
  const inputs = ["", ""];
  let writtenConfig: any;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {},
          },
        },
      },
    },
    prompter: {
      async confirm(message) {
        if (message === "Enable this machine as a public relay node?") {
          return confirms.shift() ?? true;
        }
        if (message === "Add another public announce address?") {
          return false;
        }
        assert.equal(message, "Apply this config?");
        return confirms.shift() ?? true;
      },
      async select(_message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input(message, options) {
        if (message === "Listen address") {
          assert.equal(options?.defaultValue, "/ip4/0.0.0.0/tcp/4001");
          assert.equal(options?.required, true);
          return options.defaultValue;
        } else {
          assert.equal(message, "Public announce address (optional, leave empty to skip)");
          assert.equal(options?.required, undefined);
          return inputs.shift() ?? "";
        }
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
  const pluginConfig = writtenConfig.plugins.entries["libp2p-mesh"].config;
  assert.deepEqual(pluginConfig.listenAddrs, ["/ip4/0.0.0.0/tcp/4001"]);
  assert.equal(pluginConfig.enableCircuitRelayServer, true);
  assert.equal(pluginConfig.announceAddrs, undefined);
});
```

- [ ] **Step 5: Add `Finish editing` test**

Update inbound edit-menu test expectations so value `finish-targets` has label `Finish editing`. Ensure no test expects `Back`.

- [ ] **Step 6: Run wizard tests and verify failure**

Run:

```bash
npm test -- test/setup-wizard.test.ts
```

Expected: FAIL because current wizard still selects network mode and still has `preview-apply`.

- [ ] **Step 7: Implement first-run network entry flow**

In `src/setup-wizard.ts`:

- Replace imports of `buildNetworkConfig` and `SetupMode` with `buildNetworkEntryConfig` and `buildPublicRelayNodeConfig`.
- Remove `selectSetupMode()` and `buildNetworkConfigFromPrompts()`.
- In `runFirstConfigFlow()`, call a new helper before inbound setup:

```ts
options.prompter.print(
  "Network discovery is enabled automatically.\nmDNS, DHT, NAT traversal, relay transport, and hole punching are enabled by default.",
);
let pluginConfig = await promptForNetworkEntryConfig({}, options.prompter, { keepExistingOnEmpty: false });
```

- [ ] **Step 8: Implement existing-config single-action flow**

In `runExistingConfigFlow()`, remove the `while (true)` loop and `preview-apply` case. Use a single `select` with values:

```ts
| "sync-from-channels"
| "network-entry-addresses"
| "public-relay-node"
| "inbound-targets"
| "cancel"
```

Each non-cancel action returns the modified `pluginConfig`; `runSetupWizard()` already prints preview and asks `Apply this config?`.

- [ ] **Step 9: Implement network entry helper**

Add:

```ts
async function promptForNetworkEntryConfig(
  existing: MeshConfig,
  prompter: SetupPrompter,
  options: { keepExistingOnEmpty: boolean },
): Promise<MeshConfig> {
  const bootstrapList = await promptForOptionalAddressList(
    prompter,
    options.keepExistingOnEmpty
      ? "Bootstrap multiaddr (optional, leave empty to keep unchanged)"
      : "Bootstrap multiaddr (optional, leave empty to skip)",
    "Add another bootstrap?",
  );
  const relayList = await promptForOptionalAddressList(
    prompter,
    options.keepExistingOnEmpty
      ? "Relay multiaddr (optional, leave empty to keep unchanged)"
      : "Relay multiaddr (optional, leave empty to skip)",
    "Add another relay?",
  );

  if (options.keepExistingOnEmpty) {
    return {
      ...existing,
      ...(bootstrapList.length > 0 ? { bootstrapList } : {}),
      ...(relayList.length > 0 ? { relayList } : {}),
    };
  }

  return {
    ...existing,
    ...buildNetworkEntryConfig({ bootstrapList, relayList }),
  };
}
```

Ensure this does not write empty arrays.

- [ ] **Step 10: Implement public relay-node helper**

Add:

```ts
async function promptForPublicRelayNodeConfig(
  existing: MeshConfig,
  prompter: SetupPrompter,
): Promise<MeshConfig> {
  const enabled = await prompter.confirm("Enable this machine as a public relay node?", false);
  const relayConfig = enabled
    ? buildPublicRelayNodeConfig({
        enabled: true,
        listenAddrs: [
          await prompter.input("Listen address", {
            defaultValue: "/ip4/0.0.0.0/tcp/4001",
            required: true,
          }),
        ],
        announceAddrs: await promptForOptionalAddressList(
          prompter,
          "Public announce address (optional, leave empty to skip)",
          "Add another public announce address?",
        ),
      })
    : buildPublicRelayNodeConfig({ enabled: false });

  return mergeNetworkConfig(existing, relayConfig);
}
```

- [ ] **Step 11: Update inbound finish label**

In `promptForInboundTargets()` and `promptForInboundTargetEdits()`, change labels `Back` and `Finish target setup` to `Finish editing` where the value remains `finish-targets`.

- [ ] **Step 12: Run wizard tests**

Run:

```bash
npm test -- test/setup-wizard.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit**

Run:

```bash
git add src/setup-wizard.ts test/setup-wizard.test.ts
git commit -m "feat: streamline setup wizard network entries"
```

---

### Task 3: Runtime Discovery Composition

**Files:**
- Modify: `src/mesh.ts`
- Modify: `src/types.ts`
- Create or modify tests: `test/mesh-discovery-config.test.ts`

- [ ] **Step 1: Write failing tests for discovery planning**

Create `test/mesh-discovery-config.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { planPeerDiscovery } from "../src/mesh.js";

test("planPeerDiscovery enables mDNS and DHT by default", () => {
  assert.deepEqual(planPeerDiscovery(undefined), {
    useMDNS: true,
    bootstrapList: [],
    enableDHT: true,
  });
});

test("planPeerDiscovery adds bootstrap entries without disabling mDNS", () => {
  assert.deepEqual(
    planPeerDiscovery({ bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"] }),
    {
      useMDNS: true,
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"],
      enableDHT: true,
    },
  );
});

test("planPeerDiscovery allows explicit mDNS and DHT disable switches", () => {
  assert.equal(planPeerDiscovery({ enableMDNS: false }).useMDNS, false);
  assert.equal(planPeerDiscovery({ enableDHT: false }).enableDHT, false);
});
```

- [ ] **Step 2: Run discovery tests and verify failure**

Run:

```bash
npm test -- test/mesh-discovery-config.test.ts
```

Expected: FAIL because `planPeerDiscovery` is not exported yet.

- [ ] **Step 3: Extract discovery planning helper**

In `src/mesh.ts`, add exported helper near constants:

```ts
export function planPeerDiscovery(config: MeshConfig | undefined): {
  useMDNS: boolean;
  bootstrapList: string[];
  enableDHT: boolean;
} {
  const bootstrapList = config?.bootstrapList ?? [];
  return {
    useMDNS: config?.enableMDNS !== false,
    bootstrapList,
    enableDHT: config?.enableDHT !== false,
  };
}
```

Add `enableMDNS?: boolean` to `MeshConfig` in `src/types.ts`.

- [ ] **Step 4: Run discovery tests and verify helper passes**

Run:

```bash
npm test -- test/mesh-discovery-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Use helper in `createMeshNetwork.start()`**

Replace discovery mechanism block in `src/mesh.ts` with:

```ts
const discoveryPlan = planPeerDiscovery(config);

if (discoveryPlan.useMDNS) {
  peerDiscovery.push(mdns({ interval: 1000 }));
  logger?.info?.("[libp2p-mesh] Using mDNS discovery (LAN)");
}

if (discoveryPlan.bootstrapList.length > 0) {
  peerDiscovery.push(bootstrap({ list: discoveryPlan.bootstrapList }));
  logger?.info?.(`[libp2p-mesh] Using bootstrap discovery (${discoveryPlan.bootstrapList.length} node(s))`);
}

const enableDHT = discoveryPlan.enableDHT;
```

Remove warnings that say `discovery=bootstrap but bootstrapList is empty` and `discovery=dht but bootstrapList is empty`.

- [ ] **Step 6: Update stale type comment**

In `src/types.ts`, change the `enableDHT` comment to:

```ts
  /** Enable DHT for WAN peer discovery and pubkey registry. Default `true`. */
```

Add:

```ts
  /** Enable mDNS LAN discovery. Default `true`. */
  enableMDNS?: boolean;
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- test/mesh-discovery-config.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/mesh.ts src/types.ts test/mesh-discovery-config.test.ts
git commit -m "feat: enable automatic discovery composition"
```

---

### Task 4: Docs, Dist, and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/安装指南-zh.md`
- Modify: `dist/**` generated files

- [ ] **Step 1: Update README**

Update setup sections to say:

- network discovery is automatic after install;
- setup only adds optional bootstrap/relay entry addresses or public relay-node settings;
- bootstrap/relay inputs can be left empty;
- no bootstrap/relay entry means no public-network discovery from nothing;
- setup auto-previews after an action; no `Preview and apply` menu item.

- [ ] **Step 2: Update Chinese guide carefully**

`docs/安装指南-zh.md` has pre-existing user edits. Before editing, run:

```bash
git diff -- docs/安装指南-zh.md
```

Preserve existing target-discovery guidance. Only update setup flow wording to match this design.

- [ ] **Step 3: Search for old wording**

Run:

```bash
rg -n "Choose network setup|Network mode|Preview and apply|Use default LAN discovery|Add bootstrap / relay addresses|Configure this machine as a public relay node|Bootstrap multiaddr:|A value is required" README.md docs/安装指南-zh.md src test
```

Expected: no stale user-facing setup flow remains, except tests deliberately asserting absence if any.

- [ ] **Step 4: Build and test**

Run:

```bash
npm test
npm run build
```

Expected: tests pass and TypeScript build passes.

- [ ] **Step 5: Stage docs without unrelated user changes**

Run:

```bash
git status --short
git diff -- README.md docs/安装指南-zh.md
```

If `docs/安装指南-zh.md` still contains unrelated user edits, stage only hunks from this task using `git add -p docs/安装指南-zh.md`, or create an index-only blob as done in the previous task. Do not stage `package.json` unless the user explicitly asks.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md dist src test
git commit -m "docs: describe automatic network entry setup"
```

If `docs/安装指南-zh.md` task hunks were staged separately, include them in the same commit.

---

## Final Verification

- [ ] Run:

```bash
npm test
npm run build
git status --short
git log --oneline -10
```

Expected:

- all tests pass;
- build passes;
- remaining dirty files, if any, are only pre-existing user edits such as `package.json` or unrelated `docs/安装指南-zh.md` hunks;
- recent commits include this spec, this plan, and implementation commits.
