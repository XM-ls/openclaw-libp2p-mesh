import test from "node:test";
import assert from "node:assert/strict";

import { registerLibp2pMesh } from "../src/plugin.js";
import { registerLibp2pMeshCli } from "../src/profile-cli.js";
import type { SetupPrompter } from "../src/setup-wizard.js";
import type { InstancePeerRecord, LocalPeerLabel, UserPublicAttribute } from "../src/types.js";

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

test("registerLibp2pMeshCli registers setup profile labels and debug under one libp2p-mesh root command", () => {
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
    labels: {
      createPrompter: () => makePrompter(["instance-index-0", "save-finish"]),
      createPeerStore: () => ({
        async list() {
          return [];
        },
      }),
      createPeerLabelStore: () => ({
        async listRawLabels() {
          return [];
        },
        async replaceLabels() {},
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
  assert.ok(libp2pRoots[0]?.children.find((child) => child.name === "labels"));
  assert.ok(libp2pRoots[0]?.children.find((child) => child.name === "debug"));
  assert.deepEqual(registrations[0]?.opts, {
    commands: ["libp2p-mesh"],
    descriptors: [
      { name: "libp2p-mesh", description: "Configure libp2p-mesh plugin.", hasSubcommands: true },
    ],
  });
});

test("labels command action loads discovered instances and replaces local labels for the selected instance", async () => {
  const root = makeCommand("openclaw");
  const printed: string[] = [];
  const writes: Array<{ instanceId: string; labels: LocalPeerLabel[] }> = [];
  const { api } = makeApi(root);
  const instances: InstancePeerRecord[] = [
    {
      instanceId: "alice@abc.111",
      peerId: "peer-alice",
      instanceName: "Alice laptop",
      multiaddrs: [],
      userPublicAttributes: [],
      lastSeenAt: 2,
      lastAnnouncedAt: 1,
      source: "announce",
    },
  ];
  let closeCount = 0;

  registerLibp2pMeshCli(api, {
    labels: {
      createPrompter: () => ({
        ...makePrompter(["instance-index-0", "add-label", "group", "实验室", "save-finish"], printed),
        close() {
          closeCount += 1;
        },
      }),
      createPeerStore: () => ({
        async list() {
          return instances;
        },
      }),
      createPeerLabelStore: () => ({
        async listRawLabels(instanceId) {
          assert.equal(instanceId, "alice@abc.111");
          return [];
        },
        async replaceLabels(instanceId, labels) {
          writes.push({ instanceId, labels });
        },
      }),
    },
  });

  const labels = root.children.find((child) => child.name === "libp2p-mesh")?.children.find((child) => child.name === "labels");
  assert.ok(labels?.actionHandler);
  await labels.actionHandler();

  assert.deepEqual(writes, [{ instanceId: "alice@abc.111", labels: [{ key: "group", value: "实验室" }] }]);
  assert.match(printed.join("\n"), /Local labels saved/);
  assert.equal(closeCount, 1);
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

test("profile command calls afterProfileSave after writing profile attributes", async () => {
  const root = makeCommand("openclaw");
  const writes: UserPublicAttribute[][] = [];
  const events: string[] = [];
  const { api } = makeApi(root);

  registerLibp2pMeshCli(api, {
    profile: {
      createPrompter: () => makePrompter(["add-attribute", "group", "实验室", "preview-finish", true]),
      createProfileStore: () => ({
        async listAttributes() {
          return [];
        },
        async replaceAttributes(attributes) {
          writes.push(attributes);
          events.push("replaceAttributes");
        },
      }),
      createUserMdAttributeSource: () => ({
        async loadTags() {
          return [];
        },
      }),
      async afterProfileSave() {
        events.push("afterProfileSave");
      },
    },
  });

  const profile = root.children.find((child) => child.name === "libp2p-mesh")?.children.find((child) => child.name === "profile");
  assert.ok(profile?.actionHandler);
  await profile.actionHandler();

  assert.deepEqual(writes[0], [
    {
      kind: "structured",
      key: "group",
      value: "实验室",
      label: "group: 实验室",
      source: "profile",
    },
  ]);
  assert.deepEqual(events, ["replaceAttributes", "afterProfileSave"]);
});

test("registerLibp2pMesh exposes setup profile labels and debug CLI commands in one registration", () => {
  const root = makeCommand("openclaw");
  const { api, registrations } = makeApi(root);

  registerLibp2pMesh(api);

  assert.equal(registrations.length, 1);
  const libp2p = root.children.find((child) => child.name === "libp2p-mesh");
  assert.ok(libp2p);
  assert.ok(libp2p.children.find((child) => child.name === "setup"));
  assert.ok(libp2p.children.find((child) => child.name === "profile"));
  assert.ok(libp2p.children.find((child) => child.name === "labels"));
  assert.ok(libp2p.children.find((child) => child.name === "debug"));
});
