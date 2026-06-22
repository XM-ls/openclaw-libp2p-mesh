import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  getDefaultConfig,
  resolveConfigPath,
  readFullConfig,
  writeFullConfig,
  getNonDefaultConfig,
  MULTIADDR_PATTERN,
} from "../src/config-io.js";

describe("config-io", () => {
  const tmpDir = path.join(os.tmpdir(), `libp2p-mesh-config-io-test-${Date.now()}`);
  const configPath = path.join(tmpDir, "openclaw.json");

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try {
      fs.chmodSync(tmpDir, 0o755);
    } catch {
      // ignore
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(p: string, content: string) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf-8");
  }

  it("resolveConfigPath respects OPENCLAW_CONFIG_PATH", () => {
    const saved = process.env.OPENCLAW_CONFIG_PATH;
    try {
      process.env.OPENCLAW_CONFIG_PATH = "/custom/path/config.json";
      const result = resolveConfigPath();
      assert.equal(result, path.resolve("/custom/path/config.json"));
    } finally {
      if (saved === undefined) {
        delete process.env.OPENCLAW_CONFIG_PATH;
      } else {
        process.env.OPENCLAW_CONFIG_PATH = saved;
      }
    }
  });

  it("resolveConfigPath falls back to ~/.openclaw/openclaw.json", () => {
    const savedConfig = process.env.OPENCLAW_CONFIG_PATH;
    const savedState = process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_CONFIG_PATH;
    delete process.env.OPENCLAW_STATE_DIR;
    try {
      const result = resolveConfigPath();
      assert.equal(result, path.join(os.homedir(), ".openclaw", "openclaw.json"));
    } finally {
      if (savedConfig === undefined) {
        delete process.env.OPENCLAW_CONFIG_PATH;
      } else {
        process.env.OPENCLAW_CONFIG_PATH = savedConfig;
      }
      if (savedState === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = savedState;
      }
    }
  });

  it("readFullConfig returns empty pluginConfig when config file does not exist", () => {
    const result = readFullConfig("/tmp/nonexistent-openclaw-config.json");
    assert.deepEqual(result.pluginConfig, {});
    assert.deepEqual(result.config, {});
  });

  it("readFullConfig returns empty pluginConfig when plugin not in config", () => {
    writeFile(configPath, JSON.stringify({ plugins: { entries: { other: { enabled: true } } } }, null, 2));
    const result = readFullConfig(configPath);
    assert.deepEqual(result.pluginConfig, {});
  });

  it("readFullConfig returns existing plugin config", () => {
    writeFile(configPath, JSON.stringify({
      plugins: { entries: { "libp2p-mesh": { enabled: true, config: { discovery: "mdns" } } } },
      channels: { "libp2p-mesh": { enabled: true } },
    }, null, 2));
    const result = readFullConfig(configPath);
    assert.equal(result.pluginConfig.discovery, "mdns");
  });

  it("readFullConfig throws on malformed JSON", () => {
    writeFile(configPath, "not json {{{");
    assert.throws(() => {
      readFullConfig(configPath);
    });
  });

  it("writeFullConfig creates file when it does not exist", () => {
    const newPath = path.join(tmpDir, "new-openclaw.json");
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    writeFullConfig(newPath, { discovery: "bootstrap" });
    const raw = JSON.parse(fs.readFileSync(newPath, "utf-8"));
    assert.equal(raw.plugins.entries["libp2p-mesh"].enabled, true);
    assert.equal(raw.channels["libp2p-mesh"].enabled, true);
    assert.equal(raw.plugins.entries["libp2p-mesh"].config.discovery, "bootstrap");
  });

  it("writeFullConfig merges into existing config without touching other plugins", () => {
    writeFile(configPath, JSON.stringify({
      plugins: { entries: { "other-plugin": { enabled: true, config: { key: "val" } } } },
    }, null, 2));
    writeFullConfig(configPath, { discovery: "dht" });
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    assert.equal(raw.plugins.entries["other-plugin"].config.key, "val");
    assert.equal(raw.plugins.entries["libp2p-mesh"].config.discovery, "dht");
  });

  it("writeFullConfig creates backup before writing", () => {
    writeFile(configPath, JSON.stringify({ plugins: { entries: {} } }, null, 2));
    writeFullConfig(configPath, { discovery: "mdns" });
    const bakExists = fs.existsSync(configPath + ".bak");
    assert.equal(bakExists, true);
  });

  it("writeFullConfig rolls back from backup on write failure", () => {
    writeFile(configPath, JSON.stringify({ plugins: { entries: {} } }, null, 2));
    const original = fs.readFileSync(configPath, "utf-8");

    // Clean up any previous backup
    const bakPath = configPath + ".bak";
    if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);

    // Make the directory read-only to cause write failure
    fs.chmodSync(tmpDir, 0o444);

    try {
      assert.throws(() => {
        writeFullConfig(configPath, { discovery: "mdns" });
      });
    } finally {
      fs.chmodSync(tmpDir, 0o755);
    }

    // After rollback attempt, file should match original
    const after = fs.readFileSync(configPath, "utf-8");
    assert.equal(after, original);
  });

  it("getNonDefaultConfig returns only keys that differ from defaults", () => {
    const result = getNonDefaultConfig({ discovery: "bootstrap", meshTopic: "openclaw-mesh" });
    assert.deepEqual(result, { discovery: "bootstrap" });
  });

  it("getNonDefaultConfig returns empty object when all keys are defaults", () => {
    const result = getNonDefaultConfig({ discovery: "mdns", meshTopic: "openclaw-mesh" });
    assert.deepEqual(result, {});
  });

  it("getDefaultConfig returns full defaults map", () => {
    const defaults = getDefaultConfig();
    assert.equal(defaults.discovery, "mdns");
    assert.equal(defaults.meshTopic, "openclaw-mesh");
    assert.equal(defaults.enableNATTraversal, true);
    assert.equal(Array.isArray(defaults.listenAddrs), true);
    assert.equal((defaults.listenAddrs as string[]).length, 1);
  });
});
