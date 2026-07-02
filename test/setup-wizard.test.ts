import assert from "node:assert/strict";
import test from "node:test";
import { runSetupWizard } from "../src/setup-wizard.js";

test("runSetupWizard first-run inbound setup uses receive-message wording", async () => {
  const selections = ["lan", "skip-inbound"];
  let sawInboundSetupPrompt = false;

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
        const value = selections.shift();
        assert.ok(value);

        if (message === "Configure where received P2P messages should appear?") {
          sawInboundSetupPrompt = true;
          assert.deepEqual(
            choices.map((choice) => choice.label),
            [
              "Sync from existing channels",
              "Add a target manually",
              "Do not receive P2P messages in local channels",
              "Leave unchanged for now",
            ],
          );
          assert.deepEqual(
            choices.map((choice) => choice.value),
            ["sync-from-channels", "add-targets", "disable-inbound", "skip-inbound"],
          );
        }

        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input() {
        assert.fail("LAN setup and skipped inbound setup should not prompt for input");
      },
      print() {},
    },
    writer: {
      async write() {},
    },
  });

  assert.equal(result.status, "applied");
  assert.equal(sawInboundSetupPrompt, true);
});

test("runSetupWizard existing config edit menu uses setup and received-message wording", async () => {
  let sawEditMenu = false;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
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
        assert.equal(message, "What do you want to edit?");
        sawEditMenu = true;
        assert.deepEqual(
          choices.map((choice) => choice.label),
          [
            "Sync inbound targets from channels",
            "Network setup",
            "Where received P2P messages appear",
            "Preview and apply",
            "Cancel",
          ],
        );
        assert.deepEqual(
          choices.map((choice) => choice.value),
          ["sync-from-channels", "network-mode", "inbound-targets", "preview-apply", "cancel"],
        );
        return "preview-apply";
      },
      async input() {
        assert.fail("Previewing existing config should not prompt for input");
      },
      print() {},
    },
    writer: {
      async write() {},
    },
  });

  assert.equal(result.status, "applied");
  assert.equal(sawEditMenu, true);
});

test("runSetupWizard manual inbound target prompt includes selected channel name", async () => {
  const selections = ["lan", "add-targets", "feishu", "finish-targets"];
  let sawTargetPrompt = false;

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
        assert.equal(message, "Target for feishu");
        assert.equal(options?.required, true);
        sawTargetPrompt = true;
        return "user:ou_xxx";
      },
      print() {},
    },
    writer: {
      async write() {},
    },
  });

  assert.equal(result.status, "applied");
  assert.equal(sawTargetPrompt, true);
});

test("runSetupWizard syncs missing inbound targets from configured channels without overwriting existing ones", async () => {
  const prints: string[] = [];
  const inputs = ["chat:123456"];
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
        assert.equal(message, "Target for telegram (leave empty to skip)");
        assert.equal(options?.required, false);
        const value = inputs.shift();
        assert.ok(value);
        return value;
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
  assert.match(prints.join("\n"), /Current libp2p-mesh config:/);
});

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

test("runSetupWizard existing config network setup choices exclude tools-only", async () => {
  const selections = ["network-mode", "lan", "preview-apply"];
  let sawNetworkSetupPrompt = false;

  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
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
        const value = selections.shift();
        assert.ok(value);

        if (message === "Choose network setup:") {
          sawNetworkSetupPrompt = true;
          assert.deepEqual(
            choices.map((choice) => choice.value),
            ["lan", "cross-network", "relay-node"],
          );
          assert.equal(choices.some((choice) => choice.value === "tools-only"), false);
        }

        assert.ok(choices.some((choice) => choice.value === value));
        return value;
      },
      async input() {
        assert.fail("LAN network setup should not prompt for input");
      },
      print() {},
    },
    writer: {
      async write() {},
    },
  });

  assert.equal(result.status, "applied");
  assert.equal(sawNetworkSetupPrompt, true);
});
