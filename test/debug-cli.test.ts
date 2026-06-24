import test from "node:test";
import assert from "node:assert/strict";

import { registerLibp2pMeshDebugCli } from "../src/debug-cli.js";
import { registerLibp2pMeshCli } from "../src/profile-cli.js";
import type { SetupPrompter } from "../src/setup-wizard.js";

type FakeCommand = {
  name: string;
  descriptionText?: string;
  children: FakeCommand[];
  actionHandler?: () => Promise<void> | void;
  command(name: string): FakeCommand;
  description(text: string): FakeCommand;
  action(handler: () => Promise<void> | void): FakeCommand;
};

function makeCommand(name: string): FakeCommand {
  return {
    name,
    children: [],
    command(childName: string) {
      const child = makeCommand(childName);
      this.children.push(child);
      return child;
    },
    description(text: string) {
      this.descriptionText = text;
      return this;
    },
    action(handler: () => Promise<void> | void) {
      this.actionHandler = handler;
      return this;
    },
  };
}

function makeApi(root: FakeCommand, config: Record<string, unknown> = {}) {
  const registrations: Array<{ opts?: unknown }> = [];
  const mutatedDrafts: Array<Record<string, unknown>> = [];
  const api = {
    id: "libp2p-mesh",
    name: "libp2p-mesh",
    source: "test",
    registrationMode: "full",
    config,
    pluginConfig: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    runtime: {
      config: {
        current: () => config,
        mutateConfigFile: async (params: {
          afterWrite?: unknown;
          mutate: (draft: Record<string, unknown>) => void;
        }) => {
          const draft = structuredClone(config);
          params.mutate(draft);
          mutatedDrafts.push(draft);
          return { result: undefined, nextConfig: draft };
        },
      },
      channel: {
        outbound: {
          loadAdapter() {},
        },
      },
    },
    registerCli(
      registrar: (ctx: { program: FakeCommand; config: unknown; parentPath: string[]; logger: unknown }) => void,
      opts?: unknown,
    ) {
      registrations.push({ opts });
      registrar({ program: root, config, parentPath: [], logger: this.logger });
    },
    registerService() {},
    registerChannel() {},
    registerTool() {},
    registerHook() {},
  };
  return { api: api as never, registrations, mutatedDrafts };
}

function makePrompter(script: Array<string | boolean>, printed: string[] = []): SetupPrompter {
  const values = [...script];
  return {
    async confirm() {
      return values.shift() as boolean;
    },
    async select() {
      return values.shift() as string;
    },
    async input() {
      return values.shift() as string;
    },
    print(message) {
      printed.push(message);
    },
  };
}

test("registerLibp2pMeshDebugCli registers libp2p-mesh debug command", () => {
  const root = makeCommand("openclaw");
  const { api, registrations } = makeApi(root);

  registerLibp2pMeshDebugCli(api, {
    createPrompter: () => makePrompter(["summary"]),
  });

  const libp2p = root.children.find((child) => child.name === "libp2p-mesh");
  assert.ok(libp2p);
  assert.ok(libp2p.children.find((child) => child.name === "debug"));
  assert.deepEqual(registrations[0]?.opts, {
    commands: ["libp2p-mesh"],
    descriptors: [
      { name: "libp2p-mesh", description: "Configure libp2p-mesh plugin.", hasSubcommands: true },
    ],
  });
});

test("debug command defaults missing announceLogDetail to summary and writes only plugin config", async () => {
  const root = makeCommand("openclaw");
  const printed: string[] = [];
  const config = {
    channels: {
      feishu: { enabled: true },
    },
  };
  const { api, mutatedDrafts } = makeApi(root, config);

  registerLibp2pMeshDebugCli(api, {
    createPrompter: () => makePrompter(["off"], printed),
  });

  const debug = root.children.find((child) => child.name === "libp2p-mesh")?.children.find((child) => child.name === "debug");
  assert.ok(debug?.actionHandler);
  await debug.actionHandler();

  assert.match(printed.join("\n"), /Current announceLogDetail: summary/);
  assert.match(printed.join("\n"), /Restart the gateway/);
  assert.deepEqual(mutatedDrafts[0], {
    channels: {
      feishu: { enabled: true },
    },
    plugins: {
      entries: {
        "libp2p-mesh": {
          enabled: true,
          config: {
            announceLogDetail: "off",
          },
        },
      },
    },
  });
  assert.equal(mutatedDrafts[0]?.channels?.["libp2p-mesh"], undefined);
});

test("debug command does not mutate config when payload confirmation is rejected", async () => {
  const root = makeCommand("openclaw");
  const config = {
    plugins: {
      entries: {
        "libp2p-mesh": {
          enabled: true,
          config: {
            discovery: "mdns",
            announceLogDetail: "summary",
          },
        },
      },
    },
  };
  const { api, mutatedDrafts } = makeApi(root, config);

  registerLibp2pMeshDebugCli(api, {
    createPrompter: () => makePrompter(["payload", false]),
  });

  const debug = root.children.find((child) => child.name === "libp2p-mesh")?.children.find((child) => child.name === "debug");
  assert.ok(debug?.actionHandler);
  await debug.actionHandler();

  assert.deepEqual(mutatedDrafts, []);
});

test("registerLibp2pMeshCli registers setup profile and debug under one root command", () => {
  const root = makeCommand("openclaw");
  const { api } = makeApi(root);

  registerLibp2pMeshCli(api, {
    setup: {
      createPrompter: () => makePrompter([false]),
      createWriter: () => ({ async write() {} }),
    },
    profile: {
      createPrompter: () => makePrompter(["preview-finish", false]),
      createProfileStore: () => ({
        async listAttributes() {
          return [];
        },
        async replaceAttributes() {},
      }),
      createUserMdAttributeSource: () => ({
        async loadTags() {
          return [];
        },
      }),
    },
    debug: {
      createPrompter: () => makePrompter(["summary"]),
    },
  });

  const libp2pRoots = root.children.filter((child) => child.name === "libp2p-mesh");
  assert.equal(libp2pRoots.length, 1);
  assert.ok(libp2pRoots[0]?.children.find((child) => child.name === "setup"));
  assert.ok(libp2pRoots[0]?.children.find((child) => child.name === "profile"));
  assert.ok(libp2pRoots[0]?.children.find((child) => child.name === "debug"));
});
