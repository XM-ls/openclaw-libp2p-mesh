import test from "node:test";
import assert from "node:assert/strict";
import pluginEntry from "../index.js";
import type {
  DeliveryAckPayload,
  DeliveryTargetResult,
  InboundTargetConfig,
  MeshConfig,
} from "../api.js";

test("multi-target config types compile", () => {
  const target: InboundTargetConfig = {
    id: "feishu-main",
    channel: "feishu",
    target: "user:ou_xxx",
  };
  const result: DeliveryTargetResult = {
    id: target.id,
    channel: target.channel,
    target: target.target,
    ok: true,
  };
  const config: MeshConfig = {
    inboundTargets: [target],
  };
  const ack: DeliveryAckPayload = {
    ackFor: "message-1",
    ok: true,
    deliveredAt: 1710000000000,
    results: [result],
  };

  assert.equal(config.inboundTargets?.[0]?.channel, "feishu");
  assert.equal(ack.results?.[0]?.ok, true);
});

test("plugin entry schema exposes inboundTargets runtime config", () => {
  const inboundTargetsSchema = pluginEntry.configSchema.jsonSchema.properties.inboundTargets;

  assert.equal(inboundTargetsSchema.type, "array");
  assert.deepEqual(inboundTargetsSchema.items.required, ["channel", "target"]);
  assert.equal(inboundTargetsSchema.items.additionalProperties, false);
});
