import test from "node:test";
import assert from "node:assert/strict";

import type {
  DeliveryAckPayload,
  DeliveryTargetResult,
  InboundTargetConfig,
  MeshConfig,
} from "../src/types.js";

test("multi-target delivery types compile", () => {
  const target: InboundTargetConfig = {
    id: "primary",
    channel: "feishu",
    target: "user:ou_xxx",
  };

  const result: DeliveryTargetResult = {
    id: target.id,
    channel: target.channel,
    target: target.target,
    ok: true,
  };

  const config: MeshConfig & { inboundTargets: [InboundTargetConfig] } = {
    inboundTargets: [target],
  };

  const ack: DeliveryAckPayload & { results: [DeliveryTargetResult] } = {
    ackFor: "message-1",
    ok: true,
    inboundChannel: result.channel,
    inboundTarget: result.target,
    deliveredAt: Date.now(),
    results: [result],
  };

  assert.equal(config.inboundTargets[0].channel, "feishu");
  assert.equal(ack.results[0].ok, true);
});
