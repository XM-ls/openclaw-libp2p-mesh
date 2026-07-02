import assert from "node:assert/strict";
import test from "node:test";
import { runSetupWizard } from "../src/setup-wizard.js";

test("runSetupWizard first-run inbound setup uses receive-message wording", async () => {
  const inputs = ["", ""];
  const selections = ["skip-inbound"];
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
        assert.notEqual(message, "Choose network setup:");
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
      async input(message, options) {
        assert.match(message, /^(Bootstrap|Relay) multiaddr/);
        assert.equal(options?.required, false);
        return inputs.shift() ?? "";
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

test("runSetupWizard first-run skips optional network entry addresses and does not write empty lists", async () => {
  const inputs = ["", ""];
  const selections = ["skip-inbound"];
  let writtenConfig: any;
  const prints: string[] = [];

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
            "Network entry addresses",
            "Public relay-node settings",
            "Where received P2P messages appear",
            "Cancel",
          ],
        );
        assert.deepEqual(
          choices.map((choice) => choice.value),
          ["sync-from-channels", "network-entry-addresses", "public-relay-node", "inbound-targets", "cancel"],
        );
        return "cancel";
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

  assert.equal(result.status, "cancelled");
  assert.equal(sawEditMenu, true);
});

test("runSetupWizard manual inbound target prompt includes selected channel name", async () => {
  const inputs = ["", "", "user:ou_xxx"];
  const selections = ["add-targets", "feishu", "finish-targets"];
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
        if (value === "finish-targets") {
          assert.equal(choices.find((choice) => choice.value === "finish-targets")?.label, "Finish editing");
        }
        return value;
      },
      async input(message, options) {
        if (/^(Bootstrap|Relay) multiaddr/.test(message)) {
          assert.equal(options?.required, false);
          return inputs.shift() ?? "";
        }
        assert.equal(message, "Target for feishu");
        assert.equal(options?.required, true);
        sawTargetPrompt = true;
        return inputs.shift() ?? "";
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
  const selections = ["sync-from-channels"];
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
  const selections = ["sync-from-channels"];
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
  const selections = ["sync-from-channels"];
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
      async select(message, choices) {
        const value = selections.shift();
        assert.ok(value);
        assert.notEqual(message, "Choose network setup:");
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
  assert.deepEqual(writtenConfig.plugins.entries["libp2p-mesh"].config.bootstrapList, [
    "/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap",
  ]);
  assert.deepEqual(writtenConfig.plugins.entries["libp2p-mesh"].config.relayList, [
    "/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay",
  ]);
});

test("runSetupWizard replaces network entry addresses when new values are entered", async () => {
  const selections = ["network-entry-addresses"];
  const inputs = [
    "/ip4/9.9.9.9/tcp/4001/p2p/12D3NewBootstrap",
    "/ip4/8.8.8.8/tcp/4001/p2p/12D3NewRelay",
  ];
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
          return false;
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

test("runSetupWizard can disable public relay-node settings", async () => {
  const selections = ["public-relay-node"];
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
              enableCircuitRelayServer: true,
            },
          },
        },
      },
    },
    prompter: {
      async confirm(message) {
        if (message === "Enable this machine as a public relay node?") {
          return false;
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
  const pluginConfig = writtenConfig.plugins.entries["libp2p-mesh"].config;
  assert.deepEqual(pluginConfig.bootstrapList, ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"]);
  assert.deepEqual(pluginConfig.relayList, ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"]);
  assert.equal(pluginConfig.enableCircuitRelayServer, false);
});

test("runSetupWizard enables public relay node with default listen address and optional announce", async () => {
  const selections = ["public-relay-node"];
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
        if (message === "Enable this machine as a public relay node?") {
          return true;
        }
        if (message === "Add another public announce address?") {
          return false;
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
        if (message === "Listen address") {
          assert.equal(options?.defaultValue, "/ip4/0.0.0.0/tcp/4001");
          assert.equal(options?.required, true);
          return options.defaultValue;
        }

        assert.equal(message, "Public announce address (optional, leave empty to skip)");
        assert.equal(options?.required, false);
        return "";
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
  assert.deepEqual(pluginConfig.bootstrapList, ["/ip4/1.2.3.4/tcp/4001/p2p/12D3Bootstrap"]);
  assert.deepEqual(pluginConfig.relayList, ["/ip4/5.6.7.8/tcp/4001/p2p/12D3Relay"]);
  assert.deepEqual(pluginConfig.listenAddrs, ["/ip4/0.0.0.0/tcp/4001"]);
  assert.equal(pluginConfig.enableCircuitRelayServer, true);
  assert.equal(pluginConfig.announceAddrs, undefined);
});
