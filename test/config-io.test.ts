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
