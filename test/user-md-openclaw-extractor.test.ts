import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenClawUserMdAttributeExtractor,
  extractLatestAssistantText,
  parseUserMdAttributeResponse,
  USER_MD_ATTRIBUTE_EXTRACTION_PROMPT,
} from "../src/user-md-openclaw-extractor.js";

function makeApi(messages: unknown[], waitStatus: "ok" | "error" | "timeout" = "ok") {
  const calls: Array<{ name: string; params: unknown }> = [];
  const api = {
    logger: {
      warn() {},
    },
    runtime: {
      subagent: {
        async run(params: unknown) {
          calls.push({ name: "run", params });
          return { runId: "run-1" };
        },
        async waitForRun(params: unknown) {
          calls.push({ name: "waitForRun", params });
          return waitStatus === "ok"
            ? { status: "ok" as const }
            : { status: waitStatus, error: "model unavailable" };
        },
        async getSessionMessages(params: unknown) {
          calls.push({ name: "getSessionMessages", params });
          return { messages };
        },
        async deleteSession(params: unknown) {
          calls.push({ name: "deleteSession", params });
        },
      },
    },
  };

  return { api: api as never, calls };
}

test("parseUserMdAttributeResponse accepts strict USER.md tag JSON and filters invalid values", () => {
  assert.deepEqual(
    parseUserMdAttributeResponse(`[
      {"kind":"tag","value":"P2P","label":"P2P","source":"USER.md"},
      {"kind":"tag","value":"刚认识，还在了解中。","label":"bad","source":"USER.md"},
      {"kind":"structured","key":"group","value":"实验室","label":"group: 实验室","source":"profile"}
    ]`),
    [{ kind: "tag", value: "P2P", label: "P2P", source: "USER.md" }],
  );
});

test("parseUserMdAttributeResponse accepts fenced JSON arrays", () => {
  assert.deepEqual(
    parseUserMdAttributeResponse("```json\n[{\"kind\":\"tag\",\"value\":\"P2P\",\"label\":\"P2P\",\"source\":\"USER.md\"}]\n```"),
    [{ kind: "tag", value: "P2P", label: "P2P", source: "USER.md" }],
  );
});

test("extractLatestAssistantText reads the latest assistant text from common message shapes", () => {
  assert.equal(
    extractLatestAssistantText([
      { role: "assistant", content: "old" },
      { role: "user", content: "ignored" },
      { role: "assistant", content: [{ type: "text", text: "new" }] },
    ]),
    "new",
  );
});

test("createOpenClawUserMdAttributeExtractor runs subagent and parses assistant JSON", async () => {
  const { api, calls } = makeApi([
    {
      role: "assistant",
      content: "[{\"kind\":\"tag\",\"value\":\"P2P\",\"label\":\"P2P\",\"source\":\"USER.md\"}]",
    },
  ]);
  const extractor = createOpenClawUserMdAttributeExtractor(api, { timeoutMs: 1234 });

  assert.deepEqual(await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }), [
    { kind: "tag", value: "P2P", label: "P2P", source: "USER.md" },
  ]);

  const runCall = calls.find((call) => call.name === "run");
  assert.ok(runCall);
  assert.match(JSON.stringify(runCall.params), /libp2p-mesh-user-md-attributes/);
  assert.match(JSON.stringify(runCall.params), /Notes: P2P/);
  assert.match(JSON.stringify(runCall.params), /只输出 JSON 数组/);
  assert.match(JSON.stringify(runCall.params), /USER.md/);
  assert.match(USER_MD_ATTRIBUTE_EXTRACTION_PROMPT, /不要提取“刚认识”/);

  const waitCall = calls.find((call) => call.name === "waitForRun");
  assert.ok(waitCall);
  assert.match(JSON.stringify(waitCall.params), /1234/);
  assert.equal(calls.filter((call) => call.name === "deleteSession").length, 2);
});

test("createOpenClawUserMdAttributeExtractor returns empty tags for invalid assistant output", async () => {
  const { api } = makeApi([{ role: "assistant", content: "not json" }]);
  const extractor = createOpenClawUserMdAttributeExtractor(api);

  assert.deepEqual(await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }), []);
});

test("createOpenClawUserMdAttributeExtractor reports unavailable when subagent runtime is missing", async () => {
  const extractor = createOpenClawUserMdAttributeExtractor({ runtime: {}, logger: {} } as never);

  assert.deepEqual(
    await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }),
    { unavailable: true, reason: "OpenClaw subagent runtime is unavailable" },
  );
});

test("createOpenClawUserMdAttributeExtractor reports unavailable when subagent wait fails", async () => {
  const { api } = makeApi([], "timeout");
  const extractor = createOpenClawUserMdAttributeExtractor(api);

  assert.deepEqual(
    await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }),
    { unavailable: true, reason: "model unavailable" },
  );
});
