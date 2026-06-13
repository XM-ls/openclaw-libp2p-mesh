import assert from "node:assert/strict";
import { createOpenClawRuntimeInboundDelivery } from "./src/inbound-delivery.js";

const request = {
  channel: "feishu",
  target: "user:ou_xxx",
  text: "hello",
  metadata: {
    fromInstanceId: "alice@abc.123",
    fromPeerId: "peer-a",
    p2pMessageId: "msg-1",
    allowAgentAutoReply: true,
    replyToInstanceId: "alice@abc.123",
    replyTool: "p2p_send_instance_message",
  },
};

async function run() {
  const sent = [];
  const delivery = createOpenClawRuntimeInboundDelivery({
    config: {},
    loadAdapter: async (channel) => ({
      deliveryMode: "gateway",
      async sendText(ctx) {
        sent.push({ channel, ctx });
        return { channel, messageId: "remote-1" };
      },
    }),
    logger: { info: () => {}, debug: () => {}, warn: () => {} },
  });

  const ok = await delivery.deliver(request);
  assert.deepEqual(ok, {
    ok: true,
    channel: "feishu",
    target: "user:ou_xxx",
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, "feishu");
  assert.equal(sent[0].ctx.to, "user:ou_xxx");
  assert.equal(sent[0].ctx.text, "hello");

  const missing = createOpenClawRuntimeInboundDelivery({
    config: {},
    loadAdapter: async () => undefined,
  });
  const missingResult = await missing.deliver(request);
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.error, /does not expose runtime text delivery/);

  const failing = createOpenClawRuntimeInboundDelivery({
    config: {},
    loadAdapter: async () => ({
      deliveryMode: "gateway",
      async sendText() {
        throw new Error("send failed");
      },
    }),
  });
  const failingResult = await failing.deliver(request);
  assert.equal(failingResult.ok, false);
  assert.equal(failingResult.error, "send failed");

  console.log("test-inbound-delivery: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
