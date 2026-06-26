# libp2p-mesh Automatic Prompt and Network Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `libp2p-mesh` automatically install/update its AGENTS.md prompt block and use safe network defaults without requiring first-time `prompt install` or `setup`.

**Architecture:** Add one pure default-config helper in `src/setup-config.ts`, one non-throwing automatic prompt installer in `src/prompt-config.ts`, and wire both into `registerLibp2pMeshWithDeps()` before mesh/router construction. Keep existing CLI commands as manual repair/advanced paths and update README to describe automatic setup.

**Tech Stack:** TypeScript ESM, Node built-in `node:test`, `tsx`, OpenClaw Plugin API, existing plugin lifecycle and prompt/config helpers.

---

## Scope Notes

This plan implements `docs/superpowers/specs/2026-06-25-libp2p-mesh-auto-prompt-network-config-design.md`.

The current working path `/home/ypp/libp2p-mesh` may not be a normal tracked checkout. Commit steps are included for execution in a real git checkout of `https://github.com/XM-ls/openclaw-libp2p-mesh.git`; when executing directly in `/home/ypp/libp2p-mesh`, skip only the `git commit` command and still run all tests/build checks.

This plan does not implement channel allowlists, target auto-discovery, or targetless delivery.

## File Structure

- Modify `src/setup-config.ts`: add runtime default merge helper and export it.
- Modify `src/prompt-config.ts`: add non-throwing automatic prompt install wrapper with injectable installer for tests.
- Modify `src/plugin.ts`: apply default config before constructing mesh/router and start automatic prompt installation during registration.
- Create `test/setup-config.test.ts`: focused tests for `applyDefaultMeshConfig`.
- Create `test/prompt-config.test.ts`: focused tests for managed AGENTS.md install/update and non-throwing auto install.
- Create `test/plugin-lifecycle.test.ts`: lifecycle wiring tests for default config and auto prompt installer invocation.
- Modify `README.md`: remove first-time requirement for `setup`/`prompt install`, add automatic setup section, keep commands as advanced/repair tools.
- Generated `dist/**`: do not edit by hand. `npm run build` updates it if this project expects built artifacts committed.

### Task 1: Default Mesh Config Helper

**Files:**
- Modify: `src/setup-config.ts`
- Create: `test/setup-config.test.ts`

- [ ] **Step 1: Write failing tests for runtime defaults**

Create `test/setup-config.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDefaultMeshConfig,
  DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
} from "../src/setup-config.js";

test("applyDefaultMeshConfig returns automatic network defaults for missing config", () => {
  assert.deepEqual(applyDefaultMeshConfig(undefined), {
    discovery: "mdns",
    enableNATTraversal: true,
    enableDHT: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});

test("applyDefaultMeshConfig preserves explicit user network fields", () => {
  assert.deepEqual(
    applyDefaultMeshConfig({
      discovery: "bootstrap",
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
      enableDHT: false,
      enableNATTraversal: false,
      deliveryAckTimeoutMs: 30000,
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
      announceAddrs: ["/ip4/9.9.9.9/tcp/4001"],
    }),
    {
      discovery: "bootstrap",
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
      enableDHT: false,
      enableNATTraversal: false,
      deliveryAckTimeoutMs: 30000,
      relayList: ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"],
      announceAddrs: ["/ip4/9.9.9.9/tcp/4001"],
    },
  );
});

test("applyDefaultMeshConfig preserves inbound delivery configuration", () => {
  assert.deepEqual(
    applyDefaultMeshConfig({
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
      inboundChannel: "telegram",
      inboundTarget: "chat:123",
    }),
    {
      discovery: "mdns",
      enableNATTraversal: true,
      enableDHT: true,
      deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
      inboundChannel: "telegram",
      inboundTarget: "chat:123",
    },
  );
});

test("applyDefaultMeshConfig treats non-object config as missing config", () => {
  assert.deepEqual(applyDefaultMeshConfig("bad" as never), {
    discovery: "mdns",
    enableNATTraversal: true,
    enableDHT: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/setup-config.test.ts
```

Expected: FAIL with an import/export error for `applyDefaultMeshConfig`.

- [ ] **Step 3: Implement the helper**

In `src/setup-config.ts`, add this function after `buildNetworkConfig()`:

```ts
export function applyDefaultMeshConfig(config: MeshConfig | undefined): MeshConfig {
  const base =
    config && typeof config === "object" && !Array.isArray(config)
      ? config
      : undefined;

  return {
    discovery: "mdns",
    enableNATTraversal: true,
    enableDHT: true,
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
    ...(base ?? {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- test/setup-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Only run this in a git checkout:

```bash
git add src/setup-config.ts test/setup-config.test.ts
git commit -m "feat: add mesh runtime default config"
```

In `/home/ypp/libp2p-mesh`, skip this commit step because the directory is not a git repository.

### Task 2: Automatic AGENTS.md Prompt Installer

**Files:**
- Modify: `src/prompt-config.ts`
- Create: `test/prompt-config.test.ts`

- [ ] **Step 1: Write failing prompt config tests**

Create `test/prompt-config.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LIBP2P_MESH_PROMPT_END,
  LIBP2P_MESH_PROMPT_START,
  autoInstallAgentPrompt,
  installAgentPromptFile,
} from "../src/prompt-config.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-mesh-prompt-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("installAgentPromptFile creates AGENTS.md with managed block", async () => {
  await withTempDir(async (dir) => {
    const agentsPath = path.join(dir, "workspace", "AGENTS.md");
    const result = await installAgentPromptFile(agentsPath);
    const content = await readFile(agentsPath, "utf8");

    assert.equal(result.existed, false);
    assert.equal(result.path, agentsPath);
    assert.match(content, new RegExp(LIBP2P_MESH_PROMPT_START));
    assert.match(content, new RegExp(LIBP2P_MESH_PROMPT_END));
    assert.match(content, /p2p_send_instance_message/);
  });
});

test("installAgentPromptFile replaces only the managed block", async () => {
  await withTempDir(async (dir) => {
    const agentsPath = path.join(dir, "AGENTS.md");
    await writeFile(
      agentsPath,
      [
        "# User rules",
        "",
        "keep this line",
        LIBP2P_MESH_PROMPT_START,
        "old prompt",
        LIBP2P_MESH_PROMPT_END,
        "",
        "keep this tail",
      ].join("\n"),
      "utf8",
    );

    const result = await installAgentPromptFile(agentsPath);
    const content = await readFile(agentsPath, "utf8");

    assert.equal(result.existed, true);
    assert.match(content, /keep this line/);
    assert.match(content, /keep this tail/);
    assert.doesNotMatch(content, /old prompt/);
    assert.match(content, /p2p_send_instance_message/);
  });
});

test("autoInstallAgentPrompt logs install and update results", async () => {
  const infos: string[] = [];
  await autoInstallAgentPrompt({
    install: async () => ({ existed: false, path: "/tmp/AGENTS.md" }),
    logger: { info: (message) => infos.push(message) },
  });
  await autoInstallAgentPrompt({
    install: async () => ({ existed: true, path: "/tmp/AGENTS.md" }),
    logger: { info: (message) => infos.push(message) },
  });

  assert.deepEqual(infos, [
    "[libp2p-mesh] Installed AGENTS.md prompt block automatically.",
    "[libp2p-mesh] Updated AGENTS.md prompt block automatically.",
  ]);
});

test("autoInstallAgentPrompt logs warning and does not throw on install failure", async () => {
  const warnings: string[] = [];
  await autoInstallAgentPrompt({
    install: async () => {
      throw new Error("disk full");
    },
    logger: { warn: (message) => warnings.push(message) },
  });

  assert.deepEqual(warnings, [
    "[libp2p-mesh] Failed to install AGENTS.md prompt automatically: disk full",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/prompt-config.test.ts
```

Expected: FAIL with an import/export error for `autoInstallAgentPrompt`.

- [ ] **Step 3: Implement automatic installer wrapper**

In `src/prompt-config.ts`, add these types and function after `installAgentPromptFile()`:

```ts
export type PromptInstallLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type AutoInstallAgentPromptOptions = {
  agentsPath?: string;
  logger?: PromptInstallLogger;
  install?: (agentsPath?: string) => Promise<PromptInstallResult>;
};

function summarizePromptInstallError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function autoInstallAgentPrompt(
  options: AutoInstallAgentPromptOptions = {},
): Promise<void> {
  const install = options.install ?? installAgentPromptFile;

  try {
    const result = await install(options.agentsPath);
    options.logger?.info?.(
      result.existed
        ? "[libp2p-mesh] Updated AGENTS.md prompt block automatically."
        : "[libp2p-mesh] Installed AGENTS.md prompt block automatically.",
    );
  } catch (error) {
    options.logger?.warn?.(
      `[libp2p-mesh] Failed to install AGENTS.md prompt automatically: ${summarizePromptInstallError(error)}`,
    );
  }
}
```

- [ ] **Step 4: Run prompt tests**

Run:

```bash
npm test -- test/prompt-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Only run this in a git checkout:

```bash
git add src/prompt-config.ts test/prompt-config.test.ts
git commit -m "feat: add automatic agent prompt installer"
```

In `/home/ypp/libp2p-mesh`, skip this commit step because the directory is not a git repository.

### Task 3: Plugin Lifecycle Wiring

**Files:**
- Modify: `src/plugin.ts`
- Create: `test/plugin-lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create `test/plugin-lifecycle.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { registerLibp2pMeshWithDeps } from "../src/plugin.js";
import type { InstanceRouter, MeshConfig, MeshNetwork } from "../src/types.js";

function makeMesh(): MeshNetwork {
  return {
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage() {},
    onMessage() {
      return () => {};
    },
    onPeerConnect() {
      return () => {};
    },
    onPeerDisconnect() {
      return () => {};
    },
    async publishToTopic() {},
    async subscribeToTopic() {},
    getLocalPeerId() {
      return "peer";
    },
    getConnectedPeers() {
      return [];
    },
    getMultiaddrs() {
      return [];
    },
    async dial() {},
    getInstanceIdentity() {
      return undefined;
    },
    getNATStatus() {
      return {
        enabled: {
          identify: false,
          autoNAT: false,
          upnp: false,
          circuitRelay: false,
          circuitRelayServer: false,
          dcutr: false,
        },
        reservedRelays: [],
        hasRelayedListenAddr: false,
      };
    },
  };
}

function makeRouter(): InstanceRouter {
  return {
    attachHandlers() {},
    async announceToConnectedPeers() {},
    async start() {},
    async stop() {},
    async handleMessage() {},
    async announceToPeer() {},
    enablePublicAttributeRefresh() {},
    async refreshPublicAttributes() {},
    async listInstances() {
      return [];
    },
    async resolveInstance() {
      return undefined;
    },
    async sendInstanceMessage(instanceId: string) {
      return {
        sent: false,
        delivered: false,
        toInstanceId: instanceId,
        toPeerId: "",
        error: "not implemented in test",
      };
    },
    async sendUserAttributeMessage() {
      return {
        scope: "public",
        matched: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
      };
    },
  };
}

function makeApi(pluginConfig?: unknown) {
  const registered = {
    services: [] as unknown[],
    channels: [] as unknown[],
    tools: [] as unknown[],
    hooks: [] as unknown[],
    clis: [] as unknown[],
  };

  const api = {
    pluginConfig,
    config: {},
    logger: {
      info() {},
      debug() {},
      warn() {},
      error() {},
    },
    runtime: {
      channel: {
        outbound: {
          async loadAdapter() {
            return undefined;
          },
        },
      },
      config: {
        async mutateConfigFile() {},
      },
    },
    registerService(service: unknown) {
      registered.services.push(service);
    },
    registerChannel(channel: unknown) {
      registered.channels.push(channel);
    },
    registerTool(tool: unknown) {
      registered.tools.push(tool);
    },
    registerHook(name: string, handler: unknown, options: unknown) {
      registered.hooks.push({ name, handler, options });
    },
    registerCli(registrar: unknown, options: unknown) {
      registered.clis.push({ registrar, options });
    },
  };

  return { api, registered };
}

test("registerLibp2pMeshWithDeps passes defaulted config to mesh and router", () => {
  const seen: { mesh?: MeshConfig; router?: MeshConfig } = {};
  const { api } = makeApi(undefined);

  registerLibp2pMeshWithDeps(api as never, {
    createMeshNetwork: ({ config }) => {
      seen.mesh = config;
      return makeMesh();
    },
    createInstanceRouter: ({ config }) => {
      seen.router = config;
      return makeRouter();
    },
    autoInstallAgentPrompt: async () => {},
  });

  assert.deepEqual(seen.mesh, {
    discovery: "mdns",
    enableNATTraversal: true,
    enableDHT: true,
    deliveryAckTimeoutMs: 15000,
  });
  assert.deepEqual(seen.router, seen.mesh);
});

test("registerLibp2pMeshWithDeps preserves explicit config while filling missing defaults", () => {
  const seen: { mesh?: MeshConfig } = {};
  const { api } = makeApi({
    discovery: "bootstrap",
    bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
    enableDHT: false,
  });

  registerLibp2pMeshWithDeps(api as never, {
    createMeshNetwork: ({ config }) => {
      seen.mesh = config;
      return makeMesh();
    },
    createInstanceRouter: () => makeRouter(),
    autoInstallAgentPrompt: async () => {},
  });

  assert.deepEqual(seen.mesh, {
    discovery: "bootstrap",
    bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Example"],
    enableDHT: false,
    enableNATTraversal: true,
    deliveryAckTimeoutMs: 15000,
  });
});

test("registerLibp2pMeshWithDeps starts automatic prompt installation without awaiting it", async () => {
  let called = false;
  const { api } = makeApi(undefined);

  registerLibp2pMeshWithDeps(api as never, {
    createMeshNetwork: () => makeMesh(),
    createInstanceRouter: () => makeRouter(),
    autoInstallAgentPrompt: async ({ logger }) => {
      called = true;
      assert.equal(logger, api.logger);
    },
  });

  await Promise.resolve();
  assert.equal(called, true);
});
```

- [ ] **Step 2: Run lifecycle test to verify it fails**

Run:

```bash
npm test -- test/plugin-lifecycle.test.ts
```

Expected: FAIL because `Libp2pMeshPluginDeps` has no `autoInstallAgentPrompt` dependency and plugin config is not defaulted yet.

- [ ] **Step 3: Wire config defaults and prompt auto-install**

In `src/plugin.ts`, add imports:

```ts
import { autoInstallAgentPrompt, type AutoInstallAgentPromptOptions } from "./prompt-config.js";
import { applyDefaultMeshConfig } from "./setup-config.js";
```

Update `Libp2pMeshPluginDeps`:

```ts
export type Libp2pMeshPluginDeps = {
  createMeshNetwork?: typeof createMeshNetwork;
  createInstanceRouter?: typeof createInstanceRouter;
  autoInstallAgentPrompt?: (options?: AutoInstallAgentPromptOptions) => Promise<void>;
};
```

Replace the existing config line:

```ts
const config = api.pluginConfig as MeshConfig | undefined;
```

with:

```ts
const config = applyDefaultMeshConfig(api.pluginConfig as MeshConfig | undefined);
void (deps.autoInstallAgentPrompt ?? autoInstallAgentPrompt)({ logger: api.logger });
```

Keep the rest of `registerLibp2pMeshWithDeps()` unchanged, so the defaulted `config` flows into `createMeshNetwork`, `createInstanceRouter`, and existing inbound handling.

- [ ] **Step 4: Run focused lifecycle and config tests**

Run:

```bash
npm test -- test/setup-config.test.ts test/prompt-config.test.ts test/plugin-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Only run this in a git checkout:

```bash
git add src/plugin.ts test/plugin-lifecycle.test.ts
git commit -m "feat: auto-install prompt and default mesh config"
```

In `/home/ypp/libp2p-mesh`, skip this commit step because the directory is not a git repository.

### Task 4: README and Full Verification

**Files:**
- Modify: `README.md`
- Build output: `dist/**` may change after `npm run build`

- [ ] **Step 1: Update README installation and configuration guidance**

Edit `README.md` so the first-time path says:

````md
## Automatic setup

After installation, `libp2p-mesh` automatically:

- installs or updates its managed prompt block in `~/.openclaw/workspace/AGENTS.md`;
- uses default network settings for mDNS discovery, NAT traversal, DHT, and delivery ACK timeout when those fields are not explicitly configured.

You no longer need to run `openclaw libp2p-mesh prompt install` or `openclaw libp2p-mesh setup` for the default setup path.
Restart the gateway after installing or updating the plugin:

```bash
openclaw gateway restart
```

Use `openclaw libp2p-mesh setup` only when you need advanced network settings such as bootstrap nodes, relay nodes, or public announce addresses.
Use `openclaw libp2p-mesh prompt install` only as a manual repair command if the managed AGENTS.md block was removed.
````

Remove or rewrite existing wording that says users must run:

```bash
openclaw libp2p-mesh setup
openclaw libp2p-mesh prompt install
```

Keep examples for `setup` under advanced networking sections.

- [ ] **Step 2: Check docs no longer present manual setup as required**

Run:

```bash
rg -n "Then run the setup wizard|prompt install|完成 `setup` 或 `prompt install`|run `openclaw libp2p-mesh setup`" README.md
```

Expected: any matches describe advanced/manual repair usage, not required first-time setup.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS. If `dist/**` changes and the package currently tracks built output, include those changes in the final diff.

- [ ] **Step 5: Inspect final diff**

In a git checkout, run:

```bash
git status --short
git diff -- src/setup-config.ts src/prompt-config.ts src/plugin.ts README.md test/setup-config.test.ts test/prompt-config.test.ts test/plugin-lifecycle.test.ts
```

Expected:

- `src/setup-config.ts` only adds `applyDefaultMeshConfig`.
- `src/prompt-config.ts` only adds the automatic installer wrapper and error summarizer.
- `src/plugin.ts` applies default config and invokes automatic prompt install.
- README describes automatic setup and keeps CLI commands as advanced/repair tools.
- Tests cover default merge, prompt install/update/failure, and plugin lifecycle wiring.

- [ ] **Step 6: Commit**

Only run this in a git checkout:

```bash
git add README.md dist test src
git commit -m "docs: document automatic libp2p mesh setup"
```

In `/home/ypp/libp2p-mesh`, skip this commit step because the directory is not a git repository.

## Self-Review

- Spec coverage: Task 1 covers network defaults and preserve-user-config semantics; Task 2 covers AGENTS.md automatic install/update and failure logging; Task 3 covers plugin lifecycle integration; Task 4 covers README changes and full verification.
- Scope check: channel allowlist, target auto-sync, and targetless delivery are explicitly excluded.
- Placeholder scan: this plan contains no TODO/TBD placeholders and every code-changing step includes concrete code or exact text.
- Type consistency: `applyDefaultMeshConfig`, `autoInstallAgentPrompt`, and `AutoInstallAgentPromptOptions` are defined before use in plugin wiring tests.
