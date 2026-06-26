import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LIBP2P_MESH_PROMPT_END,
  LIBP2P_MESH_PROMPT_START,
  autoInstallAgentPrompt,
  installAgentPromptFile,
} from "../src/prompt-config.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-mesh-prompt-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("installAgentPromptFile creates AGENTS.md with managed block", async () => {
  await withTempDir(async (dir) => {
    const agentsPath = path.join(dir, "workspace", "AGENTS.md");
    const result = await installAgentPromptFile(agentsPath);
    const content = await readFile(agentsPath, "utf8");

    assert.equal(result.existed, false);
    assert.equal(result.path, agentsPath);
    assert.match(content, new RegExp(LIBP2P_MESH_PROMPT_START));
    assert.match(content, new RegExp(LIBP2P_MESH_PROMPT_END));
    assert.match(content, /p2p_send_instance_message/);
  });
});

test("installAgentPromptFile replaces only the managed block", async () => {
  await withTempDir(async (dir) => {
    const agentsPath = path.join(dir, "AGENTS.md");
    await writeFile(
      agentsPath,
      [
        "# User rules",
        "",
        "keep this line",
        LIBP2P_MESH_PROMPT_START,
        "old prompt",
        LIBP2P_MESH_PROMPT_END,
        "",
        "keep this tail",
      ].join("\n"),
      "utf8",
    );

    const result = await installAgentPromptFile(agentsPath);
    const content = await readFile(agentsPath, "utf8");

    assert.equal(result.existed, true);
    assert.match(content, /keep this line/);
    assert.match(content, /keep this tail/);
    assert.doesNotMatch(content, /old prompt/);
    assert.match(content, /p2p_send_instance_message/);
  });
});

test("autoInstallAgentPrompt logs install and update results", async () => {
  const infos: string[] = [];
  await autoInstallAgentPrompt({
    install: async () => ({ existed: false, path: "/tmp/AGENTS.md" }),
    logger: { info: (message) => infos.push(message) },
  });
  await autoInstallAgentPrompt({
    install: async () => ({ existed: true, path: "/tmp/AGENTS.md" }),
    logger: { info: (message) => infos.push(message) },
  });

  assert.deepEqual(infos, [
    "[libp2p-mesh] Installed AGENTS.md prompt block automatically.",
    "[libp2p-mesh] Updated AGENTS.md prompt block automatically.",
  ]);
});

test("autoInstallAgentPrompt logs warning and does not throw on install failure", async () => {
  const warnings: string[] = [];
  await autoInstallAgentPrompt({
    install: async () => {
      throw new Error("disk full");
    },
    logger: { warn: (message) => warnings.push(message) },
  });

  assert.deepEqual(warnings, [
    "[libp2p-mesh] Failed to install AGENTS.md prompt automatically: disk full",
  ]);
});

test("autoInstallAgentPrompt ignores throwing info logger after successful install", async () => {
  const warnings: string[] = [];
  await assert.doesNotReject(
    autoInstallAgentPrompt({
      install: async () => ({ existed: false, path: "/tmp/AGENTS.md" }),
      logger: {
        info: () => {
          throw new Error("logger unavailable");
        },
        warn: (message) => warnings.push(message),
      },
    }),
  );

  assert.deepEqual(warnings, []);
});

test("autoInstallAgentPrompt ignores throwing warn logger after install failure", async () => {
  await assert.doesNotReject(
    autoInstallAgentPrompt({
      install: async () => {
        throw new Error("disk full");
      },
      logger: {
        warn: () => {
          throw new Error("logger unavailable");
        },
      },
    }),
  );
});
