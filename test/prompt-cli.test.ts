import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  LIBP2P_MESH_AGENT_PROMPT,
  installAgentPromptBlock,
  resolveAgentsMdPath,
} from "../src/prompt-config.js";
import { registerLibp2pMeshPromptCli } from "../src/prompt-cli.js";
import { registerLibp2pMeshCli } from "../src/profile-cli.js";

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

function makeApi(root: FakeCommand) {
  const registrations: Array<{ opts?: unknown }> = [];
  const api = {
    id: "libp2p-mesh",
    name: "libp2p-mesh",
    source: "test",
    registrationMode: "full",
    config: {},
    pluginConfig: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    runtime: {
      config: {
        current: () => ({}),
        mutateConfigFile: async () => ({ result: undefined, nextConfig: {} }),
      },
    },
    registerCli(
      registrar: (ctx: { program: FakeCommand; config: unknown; parentPath: string[]; logger: unknown }) => void,
      opts?: unknown,
    ) {
      registrations.push({ opts });
      registrar({ program: root, config: {}, parentPath: [], logger: this.logger });
    },
    registerService() {},
    registerChannel() {},
    registerTool() {},
    registerHook() {},
  };
  return { api: api as never, registrations };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-prompt-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolveAgentsMdPath uses OpenClaw workspace AGENTS.md by default", () => {
  assert.match(resolveAgentsMdPath(), /\.openclaw[/\\]workspace[/\\]AGENTS\.md$/);
});

test("installAgentPromptBlock appends managed prompt without replacing user content", () => {
  const original = "# Existing instructions\n\nKeep this line.\n";
  const next = installAgentPromptBlock(original);

  assert.match(next, /# Existing instructions/);
  assert.match(next, /Keep this line\./);
  assert.match(next, /<!-- libp2p-mesh:prompt:start -->/);
  assert.match(next, /# P2P 中继助手规则/);
  assert.match(next, /selector="group=实验室"/);
  assert.match(next, /<!-- libp2p-mesh:prompt:end -->/);
});

test("installAgentPromptBlock replaces only existing managed prompt block", () => {
  const original = [
    "# Existing instructions",
    "",
    "<!-- libp2p-mesh:prompt:start -->",
    "old prompt",
    "<!-- libp2p-mesh:prompt:end -->",
    "",
    "Keep this line.",
  ].join("\n");
  const next = installAgentPromptBlock(original);

  assert.match(next, /# Existing instructions/);
  assert.match(next, /Keep this line\./);
  assert.doesNotMatch(next, /old prompt/);
  assert.match(next, /selector="#P2P"/);
});

test("prompt install command writes AGENTS.md managed block", async () => {
  await withTempDir(async (dir) => {
    const root = makeCommand("openclaw");
    const printed: string[] = [];
    const agentsPath = path.join(dir, "workspace", "AGENTS.md");
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await writeFile(agentsPath, "# Custom\n", "utf8");
    const { api } = makeApi(root);

    registerLibp2pMeshPromptCli(api, {
      agentsPath,
      createPrompter: () => ({
        async confirm() {
          return true;
        },
        async select() {
          return "";
        },
        async input() {
          return "";
        },
        print(message) {
          printed.push(message);
        },
      }),
    });

    const install = root.children
      .find((child) => child.name === "libp2p-mesh")
      ?.children.find((child) => child.name === "prompt")
      ?.children.find((child) => child.name === "install");
    assert.ok(install?.actionHandler);
    await install.actionHandler();

    const content = await readFile(agentsPath, "utf8");
    assert.match(content, /# Custom/);
    assert.match(content, new RegExp(LIBP2P_MESH_AGENT_PROMPT.split("\n")[0] ?? ""));
    assert.match(printed.join("\n"), /Done/);
  });
});

test("registerLibp2pMeshCli includes prompt install command", () => {
  const root = makeCommand("openclaw");
  const { api } = makeApi(root);

  registerLibp2pMeshCli(api, {
    setup: {
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
      createWriter: () => ({ async write() {} }),
    },
    profile: {
      createPrompter: () => ({
        async confirm() {
          return false;
        },
        async select() {
          return "preview-finish";
        },
        async input() {
          return "";
        },
        print() {},
      }),
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
      createPrompter: () => ({
        async confirm() {
          return false;
        },
        async select() {
          return "summary";
        },
        async input() {
          return "";
        },
        print() {},
      }),
    },
  });

  const prompt = root.children
    .find((child) => child.name === "libp2p-mesh")
    ?.children.find((child) => child.name === "prompt");
  assert.ok(prompt);
  assert.ok(prompt.children.find((child) => child.name === "install"));
});
