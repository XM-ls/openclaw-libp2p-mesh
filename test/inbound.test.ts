import { test } from "node:test";
import assert from "node:assert/strict";
import { handleP2PInbound } from "../src/inbound.js";
import type { P2PMessage } from "../src/types.js";

test("direct inbound messages show instanceId instead of peerId when available", async () => {
  const sent: Array<{ channelId: string; target: string; text: string }> = [];
  const message: P2PMessage = {
    id: "message-1",
    type: "direct",
    from: "remote-peer",
    to: "local-peer",
    payload: "hello",
    timestamp: 1,
    instanceId: "remote-instance",
  };

  handleP2PInbound(message, {
    sendToChannel: async (channelId, target, text) => {
      sent.push({ channelId, target, text });
    },
  });

  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "[来自 remote-instance]\nhello");
});
