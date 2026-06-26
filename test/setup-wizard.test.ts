import assert from "node:assert/strict";
import test from "node:test";
import { runSetupWizard } from "../src/setup-wizard.js";

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
        assert.equal(message, "Target for telegram");
        assert.equal(options?.required, true);
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
