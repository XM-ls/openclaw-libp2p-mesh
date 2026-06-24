import test from "node:test";
import assert from "node:assert/strict";

import { LIBP2P_MESH_AGENT_PROMPT } from "../src/prompt-config.js";

test("agent prompt documents local peer labels command and scope rules", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /openclaw libp2p-mesh labels/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /local labels for remote instances/i);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /peer-labels\.json/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="public"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="local"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="all"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /default is scope="public"/i);
});

test("agent prompt maps user wording to scope choices", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /我归类/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /我标记/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /labels/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="local"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /public/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /自己公开/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="public"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /both/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /two sources/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="all"/);
});

test("agent prompt requires dry run and send to keep selector scope and message identical", () => {
  assert.match(
    LIBP2P_MESH_AGENT_PROMPT,
    /dry run[\s\S]*actual send[\s\S]*same selector\/scope\/message/i,
  );
});
