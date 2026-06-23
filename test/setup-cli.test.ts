import test from "node:test";
import assert from "node:assert/strict";

import { registerLibp2pMesh } from "../src/plugin.js";
import { registerLibp2pMeshSetupCli } from "../src/setup-cli.js";

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
  const mutations: unknown[] = [];
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
      channel: {
        outbound: {
          loadAdapter() {},
        },
      },
      config: {
        current: () => config,
        mutateConfigFile: async (params: {
          afterWrite?: unknown;
          mutate: (draft: Record<string, unknown>) => void;
        }) => {
          mutations.push(params);
          const draft = structuredClone(config);
          params.mutate(draft);
          mutatedDrafts.push(draft);
          return { result: undefined, nextConfig: draft };
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
  return { api: api as never, registrations, mutations, mutatedDrafts };
}

test("registerLibp2pMeshSetupCli registers libp2p-mesh setup command with lazy descriptor", async () => {
  const root = makeCommand("openclaw");
  const { api, registrations } = makeApi(root);

  registerLibp2pMeshSetupCli(api, {
    createPrompter: () => ({
      async confirm() {
        return false;
      },
      async select() {
        return "cancel";
      },
      async input() {
        return "";
      },
      print() {},
    }),
    createWriter: () => ({
      async write() {},
    }),
  });

  const libp2p = root.children.find((child) => child.name === "libp2p-mesh");
  assert.ok(libp2p);
  const setup = libp2p.children.find((child) => child.name === "setup");
  assert.ok(setup);
  assert.equal(typeof setup.actionHandler, "function");
  assert.deepEqual(registrations[0]?.opts, {
    commands: ["libp2p-mesh"],
    descriptors: [
      { name: "libp2p-mesh", description: "Configure libp2p-mesh plugin.", hasSubcommands: true },
    ],
  });
});

test("setup command action writes full next config through OpenClaw config mutation", async () => {
  const root = makeCommand("openclaw");
  const initialConfig = {
    channels: {
      feishu: { enabled: true },
    },
  };
  const { api, mutations, mutatedDrafts } = makeApi(root, initialConfig);

  registerLibp2pMeshSetupCli(api, {
    createPrompter: () => {
      const answers: Array<string | boolean> = [true, "lan", "disable-inbound", true];
      return {
        async confirm() {
          return answers.shift() as boolean;
        },
        async select() {
          return answers.shift() as string;
        },
        async input() {
          return answers.shift() as string;
        },
        print() {},
      };
    },
  });

  const setup = root.children.find((child) => child.name === "libp2p-mesh")?.children.find((child) => child.name === "setup");
  assert.ok(setup?.actionHandler);
  await setup.actionHandler();

  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0], {
    afterWrite: { mode: "none", reason: "libp2p-mesh setup completed; restart manually to apply gateway changes." },
    mutate: (mutations[0] as { mutate: unknown }).mutate,
  });
  assert.deepEqual(mutatedDrafts[0], {
    channels: {
      feishu: { enabled: true },
    },
    plugins: {
      entries: {
        "libp2p-mesh": {
          enabled: true,
          config: {
            discovery: "mdns",
            inboundTargets: [],
            deliveryAckTimeoutMs: 15000,
          },
        },
      },
    },
  });
});

test("registerLibp2pMesh registers setup cli without changing existing registration surfaces", () => {
  const root = makeCommand("openclaw");
  const { api, registrations } = makeApi(root);
  const calls: string[] = [];
  const observedApi = {
    ...(api as object),
    registerService() {
      calls.push("service");
    },
    registerChannel() {
      calls.push("channel");
    },
    registerTool() {
      calls.push("tool");
    },
    registerHook() {
      calls.push("hook");
    },
  } as never;

  registerLibp2pMesh(observedApi);

  assert.equal(registrations.length, 1);
  assert.deepEqual(calls, [
    "service",
    "channel",
    "tool",
    "tool",
    "tool",
    "tool",
    "tool",
    "tool",
    "tool",
    "tool",
    "hook",
  ]);
});
