import test from "node:test";
import assert from "node:assert/strict";

import {
  createOpenClawUserMdAttributeExtractor,
  extractCompletionText,
  extractLatestAssistantText,
  parseUserMdAttributeResponse,
  USER_MD_ATTRIBUTE_EXTRACTION_PROMPT,
} from "../src/user-md-openclaw-extractor.js";

function makeApi(result: unknown) {
  const calls: Array<{ name: string; params: unknown }> = [];
  const api = {
    logger: {
      warn() {},
    },
    runtime: {
      llm: {
        async complete(params: unknown) {
          calls.push({ name: "complete", params });
          if (result instanceof Error) {
            throw result;
          }
          return result;
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

test("extractCompletionText reads text from common completion result shapes", () => {
  assert.equal(extractCompletionText("plain"), "plain");
  assert.equal(extractCompletionText({ content: [{ type: "text", text: "content" }] }), "content");
  assert.equal(extractCompletionText({ outputText: "output" }), "output");
  assert.equal(
    extractCompletionText({ choices: [{ message: { content: "choice" } }] }),
    "choice",
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

test("createOpenClawUserMdAttributeExtractor runs llm completion and parses JSON", async () => {
  const { api, calls } = makeApi({
    content: "[{\"kind\":\"tag\",\"value\":\"P2P\",\"label\":\"P2P\",\"source\":\"USER.md\"}]",
  });
  const extractor = createOpenClawUserMdAttributeExtractor(api, { timeoutMs: 1234 });

  assert.deepEqual(await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }), [
    { kind: "tag", value: "P2P", label: "P2P", source: "USER.md" },
  ]);

  const completeCall = calls.find((call) => call.name === "complete");
  assert.ok(completeCall);
  assert.match(JSON.stringify(completeCall.params), /libp2p-mesh\.user-md-attributes/);
  assert.match(JSON.stringify(completeCall.params), /Notes: P2P/);
  assert.match(JSON.stringify(completeCall.params), /只输出 JSON 数组/);
  assert.match(JSON.stringify(completeCall.params), /USER.md/);
  assert.match(JSON.stringify(completeCall.params), /1234/);
  assert.match(USER_MD_ATTRIBUTE_EXTRACTION_PROMPT, /不要提取“刚认识”/);
  assert.equal(JSON.stringify(completeCall.params).includes("sessionKey"), false);
});

test("createOpenClawUserMdAttributeExtractor returns empty tags for invalid completion output", async () => {
  const { api } = makeApi({ content: "not json" });
  const extractor = createOpenClawUserMdAttributeExtractor(api);

  assert.deepEqual(await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }), []);
});

test("createOpenClawUserMdAttributeExtractor reports unavailable when llm runtime is missing", async () => {
  const extractor = createOpenClawUserMdAttributeExtractor({ runtime: {}, logger: {} } as never);

  assert.deepEqual(
    await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }),
    { unavailable: true, reason: "OpenClaw runtime llm.complete is unavailable" },
  );
});

test("createOpenClawUserMdAttributeExtractor reports unavailable when llm completion fails", async () => {
  const { api } = makeApi(new Error("model unavailable"));
  const extractor = createOpenClawUserMdAttributeExtractor(api);

  assert.deepEqual(
    await extractor.extract({ markdown: "Notes: P2P", sourcePath: "/tmp/USER.md" }),
    { unavailable: true, reason: "model unavailable" },
  );
});
