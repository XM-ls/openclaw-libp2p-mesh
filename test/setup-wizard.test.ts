import test from "node:test";
import assert from "node:assert/strict";

import {
  SetupCancelledError,
  formatPluginEntryPreview,
  runSetupWizard,
  type SetupConfigWriter,
  type SetupPrompter,
} from "../src/setup-wizard.js";
import type { OpenClawConfigLike } from "../src/setup-config.js";

function makePrompter(script: Array<string | boolean>): SetupPrompter {
  const values = [...script];
  return {
    async confirm() {
      const value = values.shift();
      assert.equal(typeof value, "boolean");
      return value;
    },
    async select() {
      const value = values.shift();
      assert.equal(typeof value, "string");
      return value;
    },
    async input() {
      const value = values.shift();
      assert.equal(typeof value, "string");
      return value;
    },
    print() {},
  };
}

function makeWriter() {
  const writes: OpenClawConfigLike[] = [];
  const writer: SetupConfigWriter = {
    async write(nextConfig) {
      writes.push(nextConfig);
    },
  };
  return { writer, writes };
}

test("first run applies LAN config with multiple inbound targets after preview confirmation", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    },
    writer,
    prompter: makePrompter([
      true,
      "lan",
      "add-targets",
      "feishu",
      "user:ou_xxx",
      "add-target",
      "telegram",
      "chat:123456",
      "finish-targets",
      true,
    ]),
  });

  assert.equal(result.status, "applied");
  assert.equal(result.message, "Config updated.\n\nRestart the gateway to apply changes:\nopenclaw gateway restart");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.plugins?.entries?.["libp2p-mesh"], {
    enabled: true,
    config: {
      discovery: "mdns",
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
      deliveryAckTimeoutMs: 15000,
    },
  });
  assert.equal(writes[0]?.channels?.["libp2p-mesh"], undefined);
});

test("existing config edit can add target and keep network mode after preview-apply", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
              inboundTargets: [
                { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
              ],
              deliveryAckTimeoutMs: 15000,
            },
          },
        },
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    },
    writer,
    prompter: makePrompter([
      "inbound-targets",
      "add-target",
      "telegram",
      "chat:123456",
      "finish-targets",
      "preview-apply",
      true,
    ]),
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(writes[0]?.plugins?.entries?.["libp2p-mesh"]?.config, {
    discovery: "mdns",
    inboundTargets: [
      { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
      { id: "telegram-main", channel: "telegram", target: "chat:123456" },
    ],
    deliveryAckTimeoutMs: 15000,
  });
});

test("existing config edit loops until preview-apply after changing network mode and inbound targets", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
              inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
              deliveryAckTimeoutMs: 15000,
            },
          },
        },
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    },
    writer,
    prompter: makePrompter([
      "network-mode",
      "cross-network",
      "/ip4/203.0.113.10/tcp/4001/p2p/peer",
      false,
      "",
      "inbound-targets",
      "add-target",
      "telegram",
      "chat:123456",
      "finish-targets",
      "preview-apply",
      true,
    ]),
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(writes[0]?.plugins?.entries?.["libp2p-mesh"]?.config, {
    discovery: "bootstrap",
    bootstrapList: ["/ip4/203.0.113.10/tcp/4001/p2p/peer"],
    enableNATTraversal: true,
    inboundTargets: [
      { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
      { id: "telegram-main", channel: "telegram", target: "chat:123456" },
    ],
    deliveryAckTimeoutMs: 15000,
  });
});

test("preview rejection cancels without writing", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {},
    writer,
    prompter: makePrompter([true, "tools-only", "disable-inbound", false]),
  });

  assert.equal(result.status, "cancelled");
  assert.equal(writes.length, 0);
});

test("Ctrl+C cancellation exits without writing", async () => {
  const { writer, writes } = makeWriter();
  const prompter: SetupPrompter = {
    async confirm() {
      throw new SetupCancelledError();
    },
    async select() {
      throw new SetupCancelledError();
    },
    async input() {
      throw new SetupCancelledError();
    },
    print() {},
  };

  const result = await runSetupWizard({
    currentConfig: {},
    writer,
    prompter,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Configuration cancelled. No changes were written.");
  assert.equal(writes.length, 0);
});

test("Ctrl+C cancellation from select exits without writing", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {},
    writer,
    prompter: {
      async confirm() {
        return true;
      },
      async select() {
        throw new SetupCancelledError();
      },
      async input() {
        throw new Error("input should not be called");
      },
      print() {},
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Configuration cancelled. No changes were written.");
  assert.equal(writes.length, 0);
});

test("Ctrl+C cancellation from input exits without writing", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {},
    writer,
    prompter: {
      async confirm() {
        return false;
      },
      async select() {
        return "relay-node";
      },
      async input() {
        throw new SetupCancelledError();
      },
      print() {},
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Configuration cancelled. No changes were written.");
  assert.equal(writes.length, 0);
});

test("formatPluginEntryPreview prints enabled plugin entry JSON", () => {
  assert.match(
    formatPluginEntryPreview({
      discovery: "mdns",
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
      deliveryAckTimeoutMs: 15000,
    }),
    /"enabled": true/,
  );
});
