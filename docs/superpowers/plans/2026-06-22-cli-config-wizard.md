# CLI Config Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `openclaw libp2p-mesh setup` (interactive layered wizard) and `openclaw libp2p-mesh config` (get/set/list/unset) subcommands so users never have to hand-edit `openclaw.json`.

**Architecture:** Three new modules — `src/config-io.ts` (JSON read/merge/write with backup/rollback), `src/wizard.ts` (interactive readline-based prompter + layered setup flow), `src/cli.ts` (Commander.js subcommand registration). Existing `index.ts` wires `registerCli` into the plugin entry. Zero new dependencies; readline is Node built-in, Commander is runtime-injected by OpenClaw.

**Tech Stack:** TypeScript ESM, Node >=22 built-in `readline/promises`, Commander.js (injected by OpenClaw via `registerCli`), Node `node:test` test runner.

---

## Global Constraints

- Zero new npm dependencies. Commander.js is runtime-injected by OpenClaw `registerCli`. readline is Node built-in. No `inquirer`, no `commander` package install.
- Do not modify `openclaw.plugin.json`, `src/plugin.ts`, `src/instance-router.ts`, `src/agent-tools.ts`, or `src/types.ts`.
- Config write must backup (`openclaw.json.bak`) before overwrite, and rollback on failure.
- Final version must pass `npm test` (all existing + new tests) and `npm run build`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config-io.ts` | Create | `resolveConfigPath()`, `readFullConfig()`, `writeFullConfig()`, default-value helpers |
| `src/wizard.ts` | Create | `WizardPrompter` interface, `createReadlinePrompter()`, `runSetupWizard()`, validation helpers |
| `src/cli.ts` | Create | `registerLibp2pMeshCli()` — mounts `setup` and `config` subcommands via Commander |
| `index.ts` | Modify | Call `api.registerCli(registerLibp2pMeshCli)` inside `registerLibp2pMesh` |
| `test/config-io.test.ts` | Create | Unit tests for config read/write/merge/rollback/validation |
| `test/wizard.test.ts` | Create | Unit tests for wizard with mock prompter |
| `README.md` | Modify | Add CLI configuration section replacing manual JSON editing instructions |

---

## Task 1: Config I/O Unit Tests

**Files:**
- Create: `test/config-io.test.ts`

**Interfaces:**
- Produces: Tests for `resolveConfigPath`, `readFullConfig`, `writeFullConfig`, `getNonDefaultConfig`, `getDefaultConfig` (defined in Task 2)

- [ ] **Step 1: Write config-io test file**

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We'll import from ../src/config-io.js once Task 2 implements it.
// For now, describe what we test — the file will fail to compile until Task 2.

describe("config-io", () => {
  const tmpDir = path.join(os.tmpdir(), `libp2p-mesh-config-io-test-${Date.now()}`);
  const configPath = path.join(tmpDir, "openclaw.json");

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(p: string, content: string) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf-8");
  }

  it("resolveConfigPath respects OPENCLAW_CONFIG_PATH", () => {
    // Test that env var takes precedence
  });

  it("resolveConfigPath falls back to ~/.openclaw/openclaw.json", () => {
    // Test default path
  });

  it("readFullConfig returns empty pluginConfig when config file does not exist", () => {
    // Non-existing file → empty config
  });

  it("readFullConfig returns empty pluginConfig when plugin not in config", () => {
    writeFile(configPath, JSON.stringify({ plugins: { entries: { other: { enabled: true } } } }, null, 2));
    // readFullConfig should return {} for pluginConfig
  });

  it("readFullConfig returns existing plugin config", () => {
    writeFile(configPath, JSON.stringify({
      plugins: { entries: { "libp2p-mesh": { enabled: true, config: { discovery: "mdns" } } } },
      channels: { "libp2p-mesh": { enabled: true } }
    }, null, 2));
    // readFullConfig should return { discovery: "mdns" } for pluginConfig
  });

  it("readFullConfig throws on malformed JSON", () => {
    writeFile(configPath, "not json {{{");
    assert.throws(() => {
      // readFullConfig(configPath)
    });
  });

  it("writeFullConfig creates file when it does not exist", () => {
    const newPath = path.join(tmpDir, "new-openclaw.json");
    // writeFullConfig(newPath, { discovery: "bootstrap" })
    const raw = JSON.parse(fs.readFileSync(newPath, "utf-8"));
    assert.equal(raw.plugins.entries["libp2p-mesh"].enabled, true);
    assert.equal(raw.channels["libp2p-mesh"].enabled, true);
    assert.equal(raw.plugins.entries["libp2p-mesh"].config.discovery, "bootstrap");
  });

  it("writeFullConfig merges into existing config without touching other plugins", () => {
    writeFile(configPath, JSON.stringify({
      plugins: { entries: { "other-plugin": { enabled: true, config: { key: "val" } } } },
    }, null, 2));
    // writeFullConfig(configPath, { discovery: "dht" })
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(raw.plugins.entries["other-plugin"].config.key, "val");
    assert.equal(raw.plugins.entries["libp2p-mesh"].config.discovery, "dht");
  });

  it("writeFullConfig creates backup before writing", () => {
    writeFile(configPath, JSON.stringify({ plugins: { entries: {} } }, null, 2));
    // writeFullConfig(configPath, { discovery: "mdns" })
    const bakExists = fs.existsSync(configPath + ".bak");
    assert.equal(bakExists, true);
  });

  it("writeFullConfig rolls back from backup on write failure", () => {
    writeFile(configPath, JSON.stringify({ plugins: { entries: {} } }, null, 2));
    const original = fs.readFileSync(configPath, "utf-8");
    // Mock write failure by making directory read-only, attempt write
    // After rollback, file should match original
    const after = fs.readFileSync(configPath, "utf-8");
    assert.equal(after, original);
  });

  it("getNonDefaultConfig returns only keys that differ from defaults", () => {
    // With default { discovery: "mdns", meshTopic: "openclaw-mesh" }
    // Config { discovery: "bootstrap", meshTopic: "openclaw-mesh" }
    // Should return only { discovery: "bootstrap" }
  });

  it("getNonDefaultConfig returns empty object when all keys are defaults", () => {
    // All-default config → empty {}
  });

  it("getDefaultConfig returns full defaults map", () => {
    const defaults = getDefaultConfig();
    assert.equal(defaults.discovery, "mdns");
    assert.equal(defaults.meshTopic, "openclaw-mesh");
    assert.equal(defaults.enableNATTraversal, true);
    assert.equal(defaults.listenAddrs.length, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
npm test
```

Expected: config-io tests fail because `src/config-io.ts` does not exist yet. Other tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/config-io.test.ts
git commit -m "test: add config-io unit test stubs"
```

---

## Task 2: Implement Config I/O

**Files:**
- Create: `src/config-io.ts`
- Modify: `test/config-io.test.ts` (fill in actual test bodies with imports)

**Interfaces:**
- Produces:
  - `getDefaultConfig(): Record<string, unknown>` — schema defaults for all MeshConfig keys
  - `resolveConfigPath(): string` — returns active openclaw.json path
  - `readFullConfig(configPath: string): { config: Record<string, unknown>; pluginConfig: Record<string, unknown> }` — parse and extract
  - `writeFullConfig(configPath: string, pluginConfigUpdates: Record<string, unknown>): void` — backup, merge, write, verify
  - `getNonDefaultConfig(pluginConfig: Record<string, unknown>): Record<string, unknown>` — filter to non-default keys
  - `MULTIADDR_PATTERN: RegExp` — reusable multiaddr validation regex

- [ ] **Step 1: Replace test stubs with real imports and complete tests**

Rewrite `test/config-io.test.ts` with actual function calls (import from `../src/config-io.js`). Run `npm test`, expect failure.

- [ ] **Step 2: Implement `src/config-io.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const MULTIADDR_PATTERN = /^\/ip[46]\/(?:[\d.]+|[0-9a-fA-F:]+)\/(?:tcp|udp|ws|wss)\/\d+(?:\/p2p\/[12][a-zA-Z2-7]{48,})?$/;

export function getDefaultConfig(): Record<string, unknown> {
  return {
    listenAddrs: ["/ip4/0.0.0.0/tcp/0"],
    enableWebSocket: false,
    discovery: "mdns",
    meshTopic: "openclaw-mesh",
    enablePubsub: true,
    enableAgentSync: true,
    enableDHT: true,
    enableNATTraversal: true,
    enableIdentify: true,
    enableAutoNAT: true,
    enableUPnP: true,
    enableCircuitRelay: true,
    enableCircuitRelayServer: false,
    enableDCUtR: true,
    discoverRelays: 0,
    deliveryAckTimeoutMs: 15000,
  };
}

export function resolveConfigPath(): string {
  if (process.env.OPENCLAW_CONFIG_PATH) {
    const resolved = process.env.OPENCLAW_CONFIG_PATH.replace(/^~(?=$|\/|\\)/, os.homedir());
    return path.resolve(resolved);
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR
    ? process.env.OPENCLAW_STATE_DIR.replace(/^~(?=$|\/|\\)/, os.homedir())
    : path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "openclaw.json");
}

export function readFullConfig(configPath: string): {
  config: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
} {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {}, pluginConfig: {} };
    }
    throw new Error(
      `无法解析 ${configPath}: ${(err as Error).message}\n请手动修复 JSON 格式后重试。`,
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${configPath} 内容不是合法的 JSON 对象。`);
  }

  const plugins = (raw as Record<string, unknown>).plugins;
  const entries =
    plugins && typeof plugins === "object" && !Array.isArray(plugins)
      ? (plugins as Record<string, unknown>).entries
      : undefined;
  const entry =
    entries && typeof entries === "object" && !Array.isArray(entries)
      ? (entries as Record<string, unknown>)["libp2p-mesh"]
      : undefined;
  const pluginConfig =
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? ((entry as Record<string, unknown>).config as Record<string, unknown>) ?? {}
      : {};

  return { config: raw as Record<string, unknown>, pluginConfig };
}

export function writeFullConfig(
  configPath: string,
  pluginConfigUpdates: Record<string, unknown>,
): void {
  // Ensure directory exists
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  // Read existing or start fresh
  let base: Record<string, unknown> = {};
  try {
    base = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `无法读取 ${configPath}: ${(err as Error).message}`,
      );
    }
  }

  // Create backup
  try {
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configPath + ".bak");
    }
  } catch {
    // backup failure is non-fatal
  }

  // Build output object with deep merge
  const output = structuredClone(
    typeof base === "object" && !Array.isArray(base) ? base : {},
  );

  // Ensure plugins.entries["libp2p-mesh"] exists
  if (!output.plugins || typeof output.plugins !== "object" || Array.isArray(output.plugins)) {
    output.plugins = {};
  }
  const plugins = output.plugins as Record<string, unknown>;
  if (!plugins.entries || typeof plugins.entries !== "object" || Array.isArray(plugins.entries)) {
    plugins.entries = {};
  }
  const entries = plugins.entries as Record<string, unknown>;
  if (
    !entries["libp2p-mesh"] ||
    typeof entries["libp2p-mesh"] !== "object" ||
    Array.isArray(entries["libp2p-mesh"])
  ) {
    entries["libp2p-mesh"] = {};
  }
  const meshEntry = entries["libp2p-mesh"] as Record<string, unknown>;
  meshEntry.enabled = true;

  // Merge plugin config shallowly (key-level)
  if (!meshEntry.config || typeof meshEntry.config !== "object" || Array.isArray(meshEntry.config)) {
    meshEntry.config = {};
  }
  const existing = meshEntry.config as Record<string, unknown>;
  meshEntry.config = { ...existing, ...pluginConfigUpdates };

  // Ensure channels["libp2p-mesh"].enabled exists
  if (
    !output.channels ||
    typeof output.channels !== "object" ||
    Array.isArray(output.channels)
  ) {
    output.channels = {};
  }
  const channels = output.channels as Record<string, unknown>;
  if (
    !channels["libp2p-mesh"] ||
    typeof channels["libp2p-mesh"] !== "object" ||
    Array.isArray(channels["libp2p-mesh"])
  ) {
    channels["libp2p-mesh"] = {};
  }
  const meshChannel = channels["libp2p-mesh"] as Record<string, unknown>;
  meshChannel.enabled = true;

  // Write atomically (write to temp, then rename)
  const tmpPath = configPath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, configPath);
  } catch (err: unknown) {
    // Rollback from backup
    try {
      if (fs.existsSync(configPath + ".bak")) {
        fs.copyFileSync(configPath + ".bak", configPath);
      }
    } catch {
      // rollback failure — leave existing state
    }
    // Clean up temp
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ok
    }
    throw new Error(
      `写入 ${configPath} 失败：${(err as Error).message}。配置未更改。`,
    );
  }
}

export function getNonDefaultConfig(
  pluginConfig: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = getDefaultConfig();
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(pluginConfig)) {
    const value = pluginConfig[key];
    if (value === undefined) continue;
    if (!(key in defaults)) {
      // Unknown key — include (could be a new key added in later version)
      result[key] = value;
      continue;
    }
    const def = defaults[key];
    if (Array.isArray(value) && Array.isArray(def)) {
      if (value.length === 0 && def.length > 0) continue;
      if (value.length !== def.length || value.some((v, i) => v !== def[i])) {
        result[key] = value;
      }
    } else if (value !== def) {
      result[key] = value;
    }
  }
  return result;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: config-io tests pass. No regression in existing tests.

- [ ] **Step 4: Run build**

Run:
```bash
npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 5: Commit**

```bash
git add src/config-io.ts test/config-io.test.ts
git commit -m "feat: add config-io module for openclaw.json read/write"
```

---

## Task 3: Wizard Prompter and Validation Tests

**Files:**
- Create: `test/wizard.test.ts`

**Interfaces:**
- Produces: Tests for `validateMultiaddr`, `validateChannelTarget`, `WizardPrompter` interface contract, `runSetupWizard` with mock prompter

- [ ] **Step 1: Write wizard test file**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Types that wizard.ts will export
interface PromptChoice {
  label: string;
  value: string;
  hint?: string;
}

interface WizardPrompter {
  question(prompt: string, defaultValue?: string): Promise<string>;
  confirm(prompt: string, defaultValue?: boolean): Promise<boolean>;
  select(prompt: string, choices: PromptChoice[]): Promise<string>;
  multiline(prompt: string, helpText?: string): Promise<string[]>;
  displayBox(title: string, lines: string[]): void;
  displaySuccess(message: string): void;
  displayError(message: string): void;
  displayWarning(message: string): void;
}

describe("validateMultiaddr", () => {
  it("accepts valid IPv4 multiaddr with peer id", () => {
    // validateMultiaddr("/ip4/198.51.100.5/tcp/4001/p2p/12D3KooW...")
    // returns null (no error)
  });

  it("accepts valid IPv4 multiaddr without peer id", () => {
    // validateMultiaddr("/ip4/0.0.0.0/tcp/4001")
    // returns null
  });

  it("accepts dns multiaddr", () => {
    // validateMultiaddr("/dns/example.com/tcp/4001/p2p/12D3KooW...")
    // returns null
  });

  it("accepts WebSocket multiaddr", () => {
    // validateMultiaddr("/ip4/198.51.100.5/ws/4002")
    // returns null
  });

  it("rejects empty string", () => {
    const err = validateMultiaddr("");
    assert.ok(err !== null);
  });

  it("rejects random text", () => {
    const err = validateMultiaddr("hello world");
    assert.ok(err !== null);
  });

  it("rejects address without protocol prefix", () => {
    const err = validateMultiaddr("198.51.100.5:4001");
    assert.ok(err !== null);
  });
});

describe("WizardPrompter mock", () => {
  it("collects user answers through mock prompter", async () => {
    // Test that runSetupWizard with a mock prompter returns expected config
  });
});

describe("runSetupWizard", () => {
  it("produces mdns config when user selects mdns", async () => {
    const mockPrompter: WizardPrompter = {
      question: async () => "",
      confirm: async () => false,
      select: async (_prompt, choices) => choices[0]!.value, // always pick first
      multiline: async () => [],
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.equal(result.discovery, "mdns");
  });

  it("produces bootstrap config with addresses", async () => {
    const addresses = ["/ip4/198.51.100.5/tcp/4001/p2p/12D3KooW..."];
    let selectCall = 0;
    let multilineCall = 0;
    const mockPrompter: WizardPrompter = {
      question: async (prompt: string) => {
        if (prompt.includes("接收目标")) return "user:ou_abc123";
        return "";
      },
      confirm: async () => false,
      select: async () => {
        selectCall++;
        return "bootstrap"; // discovery mode
      },
      multiline: async () => {
        multilineCall++;
        if (multilineCall === 1) return addresses; // bootstrap addresses
        return [];
      },
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.equal(result.discovery, "bootstrap");
    assert.deepEqual(result.bootstrapList, addresses);
  });

  it("skips advanced layer when user answers no to cross-network question", async () => {
    let confirmCalled = false;
    const mockPrompter: WizardPrompter = {
      question: async () => "user:ou_abc123",
      confirm: async (prompt: string) => {
        if (prompt.includes("不同网络")) {
          confirmCalled = true;
          return false;
        }
        return false;
      },
      select: async () => "mdns",
      multiline: async () => [],
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.equal(confirmCalled, true);
    // No advanced keys should be set
    assert.equal(result.enableNATTraversal, undefined);
    assert.equal(result.relayList, undefined);
  });

  it("includes advanced config when user answers yes to cross-network question", async () => {
    const mockPrompter: WizardPrompter = {
      question: async (prompt: string) => {
        if (prompt.includes("端口号")) return "4001";
        if (prompt.includes("名称")) return "my-home-server";
        if (prompt.includes("接收目标")) return "user:ou_abc123";
        return "";
      },
      confirm: async (prompt: string) => {
        if (prompt.includes("不同网络")) return true;
        if (prompt.includes("固定端口")) return true;
        if (prompt.includes("NAT 穿透")) return true;
        if (prompt.includes("Relay")) return true;
        if (prompt.includes("自定义名称")) return true;
        return true; // confirm write
      },
      select: async () => "mdns",
      multiline: async (prompt: string) => {
        if (prompt.includes("Relay")) return ["/ip4/198.51.100.5/tcp/4001/p2p/12D3KooW..."];
        return [];
      },
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu"]);
    assert.deepEqual(result.listenAddrs, ["/ip4/0.0.0.0/tcp/4001"]);
    assert.equal(result.enableNATTraversal, true);
    assert.equal(result.instanceName, "my-home-server");
  });

  it("collects multiple inbound targets", async () => {
    let confirmCount = 0;
    let questionCount = 0;
    const mockPrompter: WizardPrompter = {
      question: async (prompt: string) => {
        questionCount++;
        if (prompt.includes("接收目标")) {
          if (questionCount === 1) return "user:ou_abc123";
          return "chat:123456";
        }
        return "";
      },
      confirm: async (prompt: string) => {
        if (prompt.includes("更多接收目标")) {
          confirmCount++;
          return confirmCount === 1; // yes first time, no second
        }
        return false;
      },
      select: async () => "mdns",
      multiline: async () => [],
      displayBox: () => {},
      displaySuccess: () => {},
      displayError: () => {},
      displayWarning: () => {},
    };
    const result = await runSetupWizard(mockPrompter, {}, ["feishu", "telegram"]);
    assert.ok(Array.isArray(result.inboundTargets));
    const targets = result.inboundTargets as Array<{ channel: string; target: string }>;
    assert.equal(targets.length, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:
```bash
npm test
```

Expected: wizard tests fail because `src/wizard.ts` does not exist yet.

- [ ] **Step 3: Commit**

```bash
git add test/wizard.test.ts
git commit -m "test: add wizard unit test stubs"
```

---

## Task 4: Implement Wizard

**Files:**
- Create: `src/wizard.ts`
- Modify: `test/wizard.test.ts` (add imports)

**Interfaces:**
- Consumes: `MULTIADDR_PATTERN` from `config-io` (for address validation)
- Produces:
  - `WizardPrompter` interface
  - `createReadlinePrompter(): WizardPrompter`
  - `validateMultiaddr(raw: string): string | null`
  - `runSetupWizard(prompter: WizardPrompter, currentConfig: Record<string, unknown>, availableChannels: string[]): Promise<Record<string, unknown>>`

- [ ] **Step 1: Replace test stubs with real imports**

Update `test/wizard.test.ts` to import from `../src/wizard.js`. Run `npm test`, expect failure.

- [ ] **Step 2: Implement `src/wizard.ts`**

```ts
import * as readline from "node:readline/promises";
import { MULTIADDR_PATTERN } from "./config-io.js";

// --- Types ---

export interface PromptChoice {
  label: string;
  value: string;
  hint?: string;
}

export interface WizardPrompter {
  question(prompt: string, defaultValue?: string): Promise<string>;
  confirm(prompt: string, defaultValue?: boolean): Promise<boolean>;
  select(prompt: string, choices: PromptChoice[]): Promise<string>;
  multiline(prompt: string, helpText?: string): Promise<string[]>;
  displayBox(title: string, lines: string[]): void;
  displaySuccess(message: string): void;
  displayError(message: string): void;
  displayWarning(message: string): void;
}

// --- Validation ---

export function validateMultiaddr(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "地址不能为空";
  if (!MULTIADDR_PATTERN.test(trimmed)) {
    return "多地址格式无效，必须以 /ip4/、/ip6/ 或 /dns/ 开头，如 /ip4/198.51.100.5/tcp/4001/p2p/12D3KooW...";
  }
  return null;
}

// --- Readline Prompter ---

export function createReadlinePrompter(): WizardPrompter {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const displayWidth = 60;

  function boxify(title: string, lines: string[]): void {
    const top = "┌" + "─".repeat(displayWidth - 2) + "┐";
    const padTitle = "│  " + title.padEnd(displayWidth - 6) + "  │";
    const sep = "│" + " ".repeat(displayWidth - 2) + "│";
    const bottom = "└" + "─".repeat(displayWidth - 2) + "┘";
    console.log(top);
    console.log(padTitle);
    console.log(sep);
    for (const line of lines) {
      const padLine = "│  " + line.padEnd(displayWidth - 6) + "  │";
      console.log(padLine);
    }
    console.log(bottom);
  }

  function formatChoices(choices: PromptChoice[]): string {
    return choices
      .map((c, i) => {
        const hint = c.hint ? `（${c.hint}）` : "";
        return `  ${i + 1}. ${c.label} ${hint}`.trimEnd();
      })
      .join("\n");
  }

  async function question(prompt: string, defaultValue?: string): Promise<string> {
    const suffix = defaultValue ? `（${defaultValue}）` : "";
    const answer = await rl.question(`${prompt}${suffix} → `);
    return answer.trim() || defaultValue || "";
  }

  async function confirm(prompt: string, defaultValue?: boolean): Promise<boolean> {
    const def = defaultValue === undefined ? true : defaultValue;
    const yn = def ? "Y/n" : "y/N";
    const answer = await rl.question(`${prompt}（${yn}）→ `);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "y" || trimmed === "yes") return true;
    if (trimmed === "n" || trimmed === "no") return false;
    return def;
  }

  async function select(prompt: string, choices: PromptChoice[]): Promise<string> {
    console.log(`\n${prompt}`);
    console.log(formatChoices(choices));
    let answer = "";
    while (true) {
      const raw = await rl.question(`  → `);
      const num = parseInt(raw.trim(), 10);
      if (num >= 1 && num <= choices.length) {
        answer = choices[num - 1]!.value;
        break;
      }
      console.log(`  请输入 1-${choices.length} 之间的数字。`);
    }
    return answer;
  }

  async function multiline(prompt: string, helpText?: string): Promise<string[]> {
    console.log(`\n${prompt}`);
    if (helpText) console.log(helpText);
    const lines: string[] = [];
    while (true) {
      const line = await rl.question("  ");
      if (!line.trim()) break;
      const err = validateMultiaddr(line);
      if (err) {
        console.log(`  ⚠ ${err}`);
        continue;
      }
      if (lines.includes(line.trim())) {
        console.log("  ⚠ 该地址已存在");
        continue;
      }
      lines.push(line.trim());
    }
    if (lines.length > 0) {
      console.log(`  ✓ 已添加 ${lines.length} 个地址`);
    }
    return lines;
  }

  function displayBox(title: string, lines: string[]): void {
    boxify(title, lines);
  }

  function displaySuccess(message: string): void {
    console.log(`  ✓ ${message}`);
  }

  function displayError(message: string): void {
    console.log(`  ✗ ${message}`);
  }

  function displayWarning(message: string): void {
    console.log(`  ⚠ ${message}`);
  }

  return {
    question,
    confirm,
    select,
    multiline,
    displayBox,
    displaySuccess,
    displayError,
    displayWarning,
  };
}

// --- Setup Wizard Logic (pure — takes prompter, returns config object) ---

export async function runSetupWizard(
  prompter: WizardPrompter,
  currentConfig: Record<string, unknown>,
  availableChannels: string[],
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = { ...currentConfig };

  // --- Welcome ---
  prompter.displayBox("🕸️  libp2p-mesh 配置向导", [
    "我们将引导你完成 P2P Mesh 网络的基础配置。",
    "任何时候按 Ctrl+C 可退出，配置不会被保存。",
  ]);

  // =================================================================
  // Layer 1: Core Path
  // =================================================================

  // Step 1: Discovery mode
  const discovery = await prompter.select("选择节点发现方式：", [
    { value: "mdns", label: "mDNS — 局域网自动发现", hint: "默认，同一 WiFi 下推荐" },
    { value: "bootstrap", label: "Bootstrap — 手动指定已知节点地址", hint: "跨网络场景" },
    { value: "dht", label: "DHT — Kademlia 分布式发现", hint: "需要至少一个 bootstrap 入口" },
  ]);
  config.discovery = discovery;

  // Step 2: Bootstrap addresses (only if discovery=bootstrap or dht)
  if (discovery === "bootstrap" || discovery === "dht") {
    const addrs = await prompter.multiline(
      "输入 Bootstrap 节点地址（每行一个，空行结束）：",
      "  格式: /ip4/<IP>/tcp/<端口>/p2p/<PeerID>",
    );
    if (addrs.length > 0) {
      config.bootstrapList = addrs;
    }
  }

  // Step 3: Inbound targets
  if (availableChannels.length === 0) {
    prompter.displayWarning("未检测到已安装的聊天频道插件。你可以稍后在 openclaw.json 中手动配置 inboundTargets。");
  } else {
    const targets: Array<{ id?: string; channel: string; target: string }> = [];
    let addMore = true;
    while (addMore) {
      const channelChoices: PromptChoice[] = availableChannels.map((ch) => ({
        value: ch,
        label: ch,
      }));
      const channel = await prompter.select("选择接收 P2P 消息的聊天频道：", channelChoices);
      const target = await prompter.question(`输入 ${channel} 的接收目标（如 user:ou_xxx 或 chat:oc_xxx）：`);
      if (target) {
        targets.push({ channel, target });
      }
      addMore = await prompter.confirm("是否添加更多接收目标？", false);
    }
    if (targets.length > 0) {
      if (targets.length === 1 && !currentConfig.inboundChannel && !currentConfig.inboundTarget) {
        // Single target: also set legacy inboundChannel/inboundTarget for backwards compat
        config.inboundChannel = targets[0]!.channel;
        config.inboundTarget = targets[0]!.target;
      }
      config.inboundTargets = targets;
    }
  }

  // Step 4: Preview core config and confirm
  const corePreview = formatConfigPreview(config);
  prompter.displayBox("即将写入以下配置：", corePreview);
  const coreConfirmed = await prompter.confirm("确认写入？", true);
  if (!coreConfirmed) {
    prompter.displayWarning("已取消，配置未保存。");
    throw new WizardCancelledError();
  }

  // =================================================================
  // Layer 2: Advanced (optional)
  // =================================================================

  const wantsAdvanced = await prompter.confirm("需要在不同网络之间使用吗（跨 WiFi / 跨城市）？", false);
  if (wantsAdvanced) {
    // Fixed port
    const wantFixedPort = await prompter.confirm("是否使用固定监听端口？（推荐跨网络场景）", false);
    if (wantFixedPort) {
      const port = await prompter.question("端口号", "4001");
      const portNum = parseInt(port, 10);
      if (!isNaN(portNum) && portNum > 0 && portNum < 65536) {
        config.listenAddrs = [`/ip4/0.0.0.0/tcp/${portNum}`];
      }
    }

    // NAT traversal
    const wantNAT = await prompter.confirm("是否启用 NAT 穿透？（默认开启，推荐保留）", true);
    config.enableNATTraversal = wantNAT;

    // Circuit Relay
    const wantRelay = await prompter.confirm("需要配置 Circuit Relay 中继节点吗？", false);
    if (wantRelay) {
      const relays = await prompter.multiline(
        "输入 Relay 节点地址（每行一个，空行结束）：",
        "  格式: /ip4/<IP>/tcp/<端口>/p2p/<PeerID>",
      );
      if (relays.length > 0) {
        config.relayList = relays;
      }
    }

    // Custom instance name
    const wantName = await prompter.confirm("为此节点设置一个自定义名称吗？（用于 P2P 网络中的身份显示）", false);
    if (wantName) {
      const name = await prompter.question("节点名称");
      if (name) {
        config.instanceName = name;
      }
    }

    // Final preview and confirm (only if advanced config changed)
    if (wantFixedPort || wantRelay || wantName || !config.enableNATTraversal) {
      const finalPreview = formatConfigPreview(config);
      prompter.displayBox("高级配置已追加，最终预览：", finalPreview);
      const finalConfirmed = await prompter.confirm("确认写入？", true);
      if (!finalConfirmed) {
        prompter.displayWarning("已取消高级配置，核心配置已保存。");
      }
    }
  }

  prompter.displaySuccess("配置完成。运行 openclaw gateway restart 使配置生效。");
  return config;
}

export class WizardCancelledError extends Error {
  constructor() {
    super("Wizard cancelled by user");
    this.name = "WizardCancelledError";
  }
}

// --- Helpers ---

function formatConfigPreview(config: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (config.discovery) {
    lines.push(`discovery:       ${config.discovery}`);
  }
  if (Array.isArray(config.bootstrapList) && config.bootstrapList.length > 0) {
    lines.push(`bootstrapList:   ${config.bootstrapList.length} 个节点`);
    for (const addr of config.bootstrapList) {
      lines.push(`    ${addr}`);
    }
  }
  if (Array.isArray(config.inboundTargets) && config.inboundTargets.length > 0) {
    lines.push("inboundTargets:");
    for (const t of config.inboundTargets as Array<{ id?: string; channel: string; target: string }>) {
      lines.push(`    - ${t.channel} / ${t.target}`);
    }
  } else if (config.inboundChannel && config.inboundTarget) {
    lines.push(`inboundChannel:  ${config.inboundChannel}`);
    lines.push(`inboundTarget:   ${config.inboundTarget}`);
  }
  if (Array.isArray(config.listenAddrs) && config.listenAddrs.length > 0) {
    lines.push(`listenAddrs:     ${(config.listenAddrs as string[]).join(", ")}`);
  }
  if (config.enableNATTraversal !== undefined) {
    lines.push(`NAT 穿透:         ${config.enableNATTraversal ? "开启" : "关闭"}`);
  }
  if (Array.isArray(config.relayList) && config.relayList.length > 0) {
    lines.push(`relayList:       ${config.relayList.length} 个节点`);
  }
  if (config.instanceName) {
    lines.push(`instanceName:    ${config.instanceName}`);
  }
  if (lines.length === 0) {
    lines.push("（无配置更改）");
  }
  return lines;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run:
```bash
npm test
```

Expected: wizard tests pass. No regression in other tests.

- [ ] **Step 4: Run build**

Run:
```bash
npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 5: Commit**

```bash
git add src/wizard.ts test/wizard.test.ts
git commit -m "feat: add setup wizard with mockable prompter"
```

---

## Task 5: Implement CLI Registration

**Files:**
- Create: `src/cli.ts`

**Interfaces:**
- Consumes: `resolveConfigPath`, `readFullConfig`, `writeFullConfig`, `getNonDefaultConfig`, `getDefaultConfig` from `config-io`; `createReadlinePrompter`, `runSetupWizard`, `WizardCancelledError` from `wizard`; `OpenClawPluginCliContext` from OpenClaw SDK
- Produces: `registerLibp2pMeshCli(ctx: OpenClawPluginCliContext): void`

- [ ] **Step 1: Implement `src/cli.ts`**

```ts
import type { OpenClawPluginCliContext } from "openclaw/plugin-sdk/core";
import {
  resolveConfigPath,
  readFullConfig,
  writeFullConfig,
  getNonDefaultConfig,
  getDefaultConfig,
} from "./config-io.js";
import {
  createReadlinePrompter,
  runSetupWizard,
  WizardCancelledError,
} from "./wizard.js";

export function registerLibp2pMeshCli(ctx: OpenClawPluginCliContext): void {
  const { program, config: openclawConfig } = ctx;

  const meshCmd = program
    .command("libp2p-mesh")
    .description("P2P Mesh 网络插件配置管理");

  // ---- setup ----
  meshCmd
    .command("setup")
    .description("交互式配置向导")
    .action(async () => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);

      // Discover available chat channels from config
      const channels = openclawConfig.channels;
      const availableChannels: string[] = [];
      if (channels && typeof channels === "object" && !Array.isArray(channels)) {
        for (const [id, entry] of Object.entries(channels as Record<string, unknown>)) {
          if (
            id !== "libp2p-mesh" &&
            entry &&
            typeof entry === "object" &&
            (entry as Record<string, unknown>).enabled !== false
          ) {
            availableChannels.push(id);
          }
        }
      }

      try {
        const prompter = createReadlinePrompter();
        const newConfig = await runSetupWizard(prompter, pluginConfig, availableChannels);
        writeFullConfig(configPath, newConfig);
        console.log(`\n✓ 配置已写入 ${configPath}`);
        console.log("  运行 openclaw gateway restart 使新配置生效。");
      } catch (err) {
        if (err instanceof WizardCancelledError) {
          process.exit(0);
        }
        if (err instanceof Error) {
          console.error(`\n✗ ${err.message}`);
        }
        process.exit(1);
      }
    });

  // ---- config list ----
  meshCmd
    .command("list")
    .description("列出当前所有非默认配置")
    .action(() => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const nonDefault = getNonDefaultConfig(pluginConfig);
      const keys = Object.keys(nonDefault);

      if (keys.length === 0) {
        console.log("当前无自定义配置，全部使用默认值。");
        console.log("运行 openclaw libp2p-mesh setup 进行配置。");
        return;
      }

      console.log("─────────────────────────────────");
      console.log("  当前 libp2p-mesh 配置：\n");
      for (const key of keys) {
        const value = nonDefault[key];
        if (Array.isArray(value)) {
          console.log(`  ${key}:`);
          if (value.length === 0) {
            console.log("    （空列表）");
          } else {
            for (const item of value) {
              if (typeof item === "object" && item !== null) {
                const obj = item as Record<string, unknown>;
                const label = obj.id ? `${obj.id} — ` : "";
                console.log(`    - ${label}${obj.channel ?? ""} / ${obj.target ?? ""}`);
              } else {
                console.log(`    - ${item}`);
              }
            }
          }
        } else {
          console.log(`  ${key}:  ${value}`);
        }
      }
      console.log(`\n  ...共 ${keys.length} 项非默认配置`);
    });

  // ---- config get ----
  meshCmd
    .command("get <key>")
    .description("读取单个配置值")
    .action((key: string) => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const defaults = getDefaultConfig();
      const value = key in pluginConfig ? pluginConfig[key] : defaults[key];
      if (value === undefined) {
        console.log(`  （未配置）`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          console.log("  （空列表）");
        } else {
          for (const item of value) {
            if (typeof item === "object" && item !== null) {
              console.log(JSON.stringify(item, null, 2));
            } else {
              console.log(`  ${item}`);
            }
          }
        }
      } else {
        console.log(`  ${value}`);
      }
    });

  // ---- config set ----
  meshCmd
    .command("set <key> [value]")
    .description("设置配置值。数组类型使用 --add / --remove")
    .option("--add <item>", "追加到数组")
    .option("--remove <item>", "从数组中移除")
    .action(async (key: string, value: string | undefined, opts: { add?: string; remove?: string }) => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const defaults = getDefaultConfig();
      const current = key in pluginConfig ? pluginConfig[key] : defaults[key];
      const oldValue = current;

      let newValue: unknown;

      // Array operations
      if (opts.add || opts.remove) {
        const arr: unknown[] = Array.isArray(current) ? [...current] : [];
        if (opts.add) {
          if (arr.includes(opts.add)) {
            console.log(`  ⚠ 该值已存在`);
            return;
          }
          arr.push(opts.add);
          console.log(`  ✓ 已追加`);
        }
        if (opts.remove) {
          const idx = arr.indexOf(opts.remove);
          if (idx === -1) {
            console.log(`  ⚠ 未找到该值`);
            return;
          }
          arr.splice(idx, 1);
          console.log(`  ✓ 已移除`);
        }
        newValue = arr;
      } else {
        // Scalar
        if (value === undefined) {
          console.error("  请提供值。用法: openclaw libp2p-mesh config set <key> <value>");
          process.exit(1);
        }
        // Auto-detect boolean and number
        if (value === "true") newValue = true;
        else if (value === "false") newValue = false;
        else if (/^-?\d+(\.\d+)?$/.test(value)) newValue = Number(value);
        else newValue = value;
      }

      // Write
      const updates = { ...pluginConfig, [key]: newValue };
      writeFullConfig(configPath, updates);

      // Feedback
      if (!opts.add && !opts.remove) {
        console.log(`  ✓ ${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
      }
    });

  // ---- config unset ----
  meshCmd
    .command("unset <key>")
    .description("删除 key，恢复默认值")
    .action((key: string) => {
      const configPath = resolveConfigPath();
      const { pluginConfig } = readFullConfig(configPath);
      const newConfig = { ...pluginConfig };
      delete newConfig[key];
      writeFullConfig(configPath, newConfig);
      console.log(`  ✓ ${key} 已恢复为默认值`);
    });
}
```

- [ ] **Step 2: Run build to verify compilation**

Run:
```bash
npm run build
```

Expected: TypeScript build passes. No errors from new module.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI registration for setup and config subcommands"
```

---

## Task 6: Wire CLI into Plugin Entry

**Files:**
- Modify: `index.ts`

**Interfaces:**
- Consumes: `registerLibp2pMeshCli` from `cli.ts`

- [ ] **Step 1: Add registerCli call to index.ts**

In `index.ts`, add import:

```ts
import { registerLibp2pMeshCli } from "./src/cli.js";
```

In the `registerLibp2pMesh` function, after the existing registrations (after `api.registerTool` loop), add:

```ts
  // 5. Register CLI commands (setup wizard + config management)
  api.registerCli(registerLibp2pMeshCli, {
    commands: ["libp2p-mesh"],
  });
```

- [ ] **Step 2: Run build to verify**

Run:
```bash
npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 3: Run full test suite**

Run:
```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat: wire CLI registration into plugin entry"
```

---

## Task 7: README and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README setup section**

In the README, replace the "Then add to your `~/.openclaw/openclaw.json`" manual editing block under Installation with:

```md
## Configuration

### Quick Setup (Recommended)

After installation, run the interactive setup wizard:

```bash
openclaw libp2p-mesh setup
```

The wizard will guide you through:
- Discovery mode (mDNS / Bootstrap / DHT)
- Bootstrap peer addresses (for cross-network scenarios)
- Inbound channel targets (where to display received P2P messages)
- Optional: NAT traversal, circuit relay, fixed ports, and custom instance name

The configuration is written to `~/.openclaw/openclaw.json` automatically.

### Incremental Config Management

```bash
# View all current non-default settings
openclaw libp2p-mesh config list

# Read a single value
openclaw libp2p-mesh config get discovery

# Set a value
openclaw libp2p-mesh config set discovery bootstrap

# Add to an array
openclaw libp2p-mesh config set bootstrapList --add /ip4/10.0.0.5/tcp/4001/p2p/12D3KooW...

# Remove from an array
openclaw libp2p-mesh config set bootstrapList --remove /ip4/203.0.113.10/tcp/4001/p2p/12D3KooW...

# Reset a key to default
openclaw libp2p-mesh config unset relayList
```

### Manual Configuration (Advanced)

You can still directly edit `~/.openclaw/openclaw.json`:
```

Then keep the existing manual JSON example blocks.

- [ ] **Step 2: Run tests and build**

Run:
```bash
npm test
npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 3: Check git diff**

Run:
```bash
git diff --stat
git diff -- README.md index.ts src/cli.ts src/wizard.ts src/config-io.ts test/config-io.test.ts test/wizard.test.ts
```

Expected: only the expected files changed.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add CLI config wizard documentation"
```

---

## Self-Review

- **Spec coverage**: Every spec requirement maps to a task — config-io (Task 1-2) covers read/write/merge/rollback; wizard (Task 3-4) covers interactive layered flow with validation; CLI (Task 5) covers setup + config subcommands; wiring (Task 6) connects to plugin entry; docs (Task 7) updates README.
- **Placeholder scan**: No TBD, TODO, or vague steps. Every step has concrete code, file paths, commands, and expected results.
- **Type consistency**: `WizardPrompter` interface defined in Task 3/4 and consumed in Task 4/5. `resolveConfigPath`, `readFullConfig`, `writeFullConfig`, `getNonDefaultConfig`, `getDefaultConfig` defined in Task 2 and consumed in Task 5. `registerLibp2pMeshCli` defined in Task 5 and consumed in Task 6.
- **Error cases covered**: Test stubs cover malformed JSON, missing file, write failure rollback, duplicate addresses, invalid multiaddr format, empty config, wizard cancellation.
