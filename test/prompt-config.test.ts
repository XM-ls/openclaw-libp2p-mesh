import test from "node:test";
import assert from "node:assert/strict";

import { LIBP2P_MESH_AGENT_PROMPT } from "../src/prompt-config.js";

test("agent prompt documents local peer labels command and scope rules", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /openclaw libp2p-mesh labels/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /local labels for remote instances/i);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /peer-labels\.json/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels/);
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
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /公开和本地都算.*scope="all"/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="all"/);
});

test("libp2p prompt explains localLabels snapshot privacy", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /instance-peer\.json/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*私有.*快照/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*not remote public attributes/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*not produced by remote USER\.md\/profile/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*not be sent to, shown to, or notified to the labeled user/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*不会.*instance-announce/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /本地标签.*scope="local"/s);
});

test("agent prompt separates public attributes from local labels during troubleshooting", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /userPublicAttributes.*远端公开广播的用户属性/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /localLabels.*本机私有本地标签快照/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /不要把 `localLabels` 说成远端公开属性/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /不要把 `userPublicAttributes` 和 `localLabels` 混为一类/s);
});

test("agent prompt documents async USER.md public attributes", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /source="USER\.md"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /异步/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /OpenClaw.*agent\/API 模型/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /省略 `userPublicAttributes`/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /普通对话 agent 不应自己读取 USER\.md/);
});

test("agent prompt requires dry run and send to keep selector scope and message identical", () => {
  assert.match(
    LIBP2P_MESH_AGENT_PROMPT,
    /dry run[\s\S]*actual send[\s\S]*same selector\/scope\/message/i,
  );
});
