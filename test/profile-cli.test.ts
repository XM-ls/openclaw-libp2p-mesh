import test from "node:test";
import assert from "node:assert/strict";

import { registerLibp2pMesh } from "../src/plugin.js";
import { registerLibp2pMeshCli } from "../src/profile-cli.js";
import type { SetupPrompter } from "../src/setup-wizard.js";
import type { UserPublicAttribute } from "../src/types.js";

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
        mutateConfigFile: async () => ({ result: undefined, nextConfig: config }),
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
  return { api: api as never, registrations };
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

test("registerLibp2pMeshCli registers setup profile and debug under one libp2p-mesh root command", () => {
  const root = makeCommand("openclaw");
  const { api, registrations } = makeApi(root);

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
  assert.deepEqual(registrations[0]?.opts, {
    commands: ["libp2p-mesh"],
    descriptors: [
      { name: "libp2p-mesh", description: "Configure libp2p-mesh plugin.", hasSubcommands: true },
    ],
  });
});

test("profile command action loads USER.md tags and profile attrs, then writes only structured attrs", async () => {
  const root = makeCommand("openclaw");
  const printed: string[] = [];
  const writes: UserPublicAttribute[][] = [];
  const { api } = makeApi(root);

  registerLibp2pMeshCli(api, {
    setup: {
      createPrompter: () => makePrompter([false]),
      createWriter: () => ({ async write() {} }),
    },
    profile: {
      createPrompter: () => makePrompter(["preview-finish", true], printed),
      createProfileStore: () => ({
        async listAttributes() {
          return [
            {
              kind: "structured",
              key: "role",
              value: "reviewer",
              label: "role: reviewer",
              source: "profile",
            },
          ];
        },
        async replaceAttributes(attributes) {
          writes.push(attributes);
        },
      }),
      createUserMdAttributeSource: () => ({
        async loadTags() {
          return [
            {
              kind: "tag",
              value: "Rust",
              label: "Rust",
              source: "USER.md",
            },
          ];
        },
      }),
    },
  });

  const profile = root.children.find((child) => child.name === "libp2p-mesh")?.children.find((child) => child.name === "profile");
  assert.ok(profile?.actionHandler);
  await profile.actionHandler();

  assert.deepEqual(writes[0], [
    {
      kind: "structured",
      key: "role",
      value: "reviewer",
      label: "role: reviewer",
      source: "profile",
    },
  ]);
  assert.match(printed.join("\n"), /Rust/);
  assert.match(printed.join("\n"), /Restart the gateway/);
});

test("registerLibp2pMesh exposes setup profile and debug CLI commands in one registration", () => {
  const root = makeCommand("openclaw");
  const { api, registrations } = makeApi(root);

  registerLibp2pMesh(api);

  assert.equal(registrations.length, 1);
  const libp2p = root.children.find((child) => child.name === "libp2p-mesh");
  assert.ok(libp2p);
  assert.ok(libp2p.children.find((child) => child.name === "setup"));
  assert.ok(libp2p.children.find((child) => child.name === "profile"));
  assert.ok(libp2p.children.find((child) => child.name === "debug"));
});
