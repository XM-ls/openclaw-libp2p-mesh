# Multi Inbound Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a receiving OpenClaw instance deliver one incoming P2P user message to multiple locally configured inbound channel targets, while preserving the existing single-target config.

**Architecture:** Keep `p2p_send_instance_message` as `instanceId + message`; the sender never chooses a receiver channel. Add `inboundTargets` to config, normalize it inside `InstanceRouter`, deliver one `user-message` to multiple receiver-side channel targets, and return a single ACK with per-target results. Existing `inboundChannel/inboundTarget` remains the fallback when `inboundTargets` is absent.

**Tech Stack:** TypeScript ESM, Node built-in `node:test`, OpenClaw channel outbound adapters, existing `MeshNetwork` and `InstanceRouter` abstractions.

---

## File Structure

- Modify `package.json`: add a `test` script using `node --test` with `tsx`, so unit tests can run without adding a new test framework.
- Create `test/instance-router.test.ts`: focused tests for inbound target normalization, fan-out, ACK aggregation, legacy compatibility, dedupe, and duplicate message cache.
- Create `test/agent-tools.test.ts`: focused tests for sender-side `p2p_send_instance_message` display and `isError` behavior.
- Modify `src/types.ts`: add `InboundTargetConfig`, `DeliveryTargetResult`, extend `DeliveryAckPayload`, `MeshConfig`, and `InstanceRouter.sendInstanceMessage()` result.
- Modify `openclaw.plugin.json`: add `inboundTargets` schema under `channelConfigs.libp2p-mesh.schema.properties`.
- Modify `src/instance-router.ts`: compute effective inbound targets, deliver to each target, aggregate ACK results, preserve legacy fields.
- Modify `src/agent-tools.ts`: format per-target delivery results when available.
- Modify `README.md`: document the new multi-target configuration and sender-side status output.

## Task 1: Add Unit Test Harness

**Files:**
- Modify: `package.json`
- Create: `test/instance-router.test.ts`
- Create: `test/agent-tools.test.ts`

- [ ] **Step 1: Add the test script**

Edit `package.json` scripts to include `test`:

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "test": "node --import tsx --test test/*.test.ts",
  "prepack": "npm run build"
}
```

- [ ] **Step 2: Create a smoke test for the router test file**

Create `test/instance-router.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

test("instance-router test harness runs", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Create a smoke test for the agent tools test file**

Create `test/agent-tools.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

test("agent-tools test harness runs", () => {
  assert.equal("p2p".toUpperCase(), "P2P");
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: both smoke tests pass.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 6: Commit**

```bash
git add package.json test/instance-router.test.ts test/agent-tools.test.ts
git commit -m "test: add node test harness"
```

## Task 2: Add Multi-Target Types and Schema

**Files:**
- Modify: `src/types.ts`
- Modify: `openclaw.plugin.json`
- Test: `npm run build`

- [ ] **Step 1: Write a compile-facing type test by importing new types**

Replace `test/instance-router.test.ts` with this minimal compile test plus the existing smoke assertion:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type {
  DeliveryAckPayload,
  DeliveryTargetResult,
  InboundTargetConfig,
  MeshConfig,
} from "../src/types.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test
```

Expected: TypeScript fails because `InboundTargetConfig` and `DeliveryTargetResult` are not exported and `MeshConfig.inboundTargets` / `DeliveryAckPayload.results` do not exist.

- [ ] **Step 3: Add types to `src/types.ts`**

In `src/types.ts`, after `DeliveryAckPayload` or before it, add:

```ts
export interface InboundTargetConfig {
  id?: string;
  channel: string;
  target: string;
}

export interface DeliveryTargetResult {
  id?: string;
  channel: string;
  target: string;
  ok: boolean;
  error?: string;
}
```

Update `DeliveryAckPayload`:

```ts
export interface DeliveryAckPayload {
  ackFor: string;
  ok: boolean;
  inboundChannel?: string;
  inboundTarget?: string;
  deliveredAt: number;
  error?: string;
  results?: DeliveryTargetResult[];
}
```

Update `InstanceRouter.sendInstanceMessage()` return type:

```ts
  sendInstanceMessage(instanceId: string, message: string): Promise<{
    sent: boolean;
    delivered: boolean;
    toInstanceId: string;
    toPeerId: string;
    ackMessageId?: string;
    inboundChannel?: string;
    inboundTarget?: string;
    deliveryResults?: DeliveryTargetResult[];
    error?: string;
  }>;
```

Update `MeshConfig`:

```ts
  inboundChannel?: string;
  inboundTarget?: string;
  inboundTargets?: InboundTargetConfig[];
  deliveryAckTimeoutMs?: number;
```

- [ ] **Step 4: Add schema to `openclaw.plugin.json`**

Under `channelConfigs.libp2p-mesh.schema.properties`, add this property after `inboundTarget`:

```json
"inboundTargets": {
  "type": "array",
  "description": "OpenClaw channel targets used to display inbound P2P user messages. When present, this overrides inboundChannel/inboundTarget. An empty array disables inbound delivery.",
  "items": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "id": {
        "type": "string",
        "description": "Optional local display name used in logs and delivery ACK output."
      },
      "channel": {
        "type": "string",
        "description": "OpenClaw channel used to display this inbound P2P user message, for example \"feishu\"."
      },
      "target": {
        "type": "string",
        "description": "OpenClaw channel target for this inbound P2P user message, for example user:ou_xxx or chat:oc_xxx."
      }
    },
    "required": ["channel", "target"]
  }
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts openclaw.plugin.json test/instance-router.test.ts
git commit -m "feat: add inbound target types and schema"
```

## Task 3: Implement Effective Inbound Target Selection

**Files:**
- Modify: `src/instance-router.ts`
- Modify: `test/instance-router.test.ts`

- [ ] **Step 1: Replace `test/instance-router.test.ts` with router fixtures and target-selection tests**

Use this file content:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createInstanceRouter } from "../src/instance-router.js";
import type {
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InstancePeerRecord,
  InstancePeerStore,
  MeshNetwork,
  P2PMessage,
} from "../src/types.js";

type SentMessage = {
  peerId: string;
  message: Omit<P2PMessage, "from" | "timestamp" | "instanceId" | "pubkey" | "signature"> & {
    timestamp?: number;
  };
};

function makeRecord(instanceId: string, peerId: string): InstancePeerRecord {
  return {
    instanceId,
    peerId,
    multiaddrs: [],
    lastSeenAt: Date.now(),
    lastAnnouncedAt: Date.now(),
    source: "announce",
  };
}

function makeStore(records: InstancePeerRecord[]): InstancePeerStore {
  return {
    async load() {
      return {
        version: 1,
        updatedAt: Date.now(),
        instances: Object.fromEntries(records.map((record) => [record.instanceId, record])),
      };
    },
    async list() {
      return records;
    },
    async resolve(instanceId: string) {
      return records.find((record) => record.instanceId === instanceId);
    },
    async upsertFromAnnounce(payload) {
      const record = makeRecord(payload.instanceId, payload.peerId);
      records.push(record);
      return { record, changed: true, peerIdSharedBy: [] };
    },
  };
}

function makeMesh(sent: SentMessage[] = []): MeshNetwork {
  return {
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage(peerId, message) {
      sent.push({ peerId, message });
    },
    onMessage() {
      return () => {};
    },
    onPeerConnect() {
      return () => {};
    },
    onPeerDisconnect() {
      return () => {};
    },
    async publishToTopic() {},
    async subscribeToTopic() {},
    getLocalPeerId() {
      return "peer-local";
    },
    getConnectedPeers() {
      return [];
    },
    getMultiaddrs() {
      return [];
    },
    async dial() {},
    getInstanceIdentity() {
      return {
        id: "receiver@abc.123",
        name: "receiver",
        pubkey: "pubkey",
        binding: "binding",
        bindingComponents: {
          username: "receiver",
          hostname: "host",
          platform: "linux",
        },
        createdAt: 1710000000000,
      };
    },
    getNATStatus() {
      return {
        enabled: {
          identify: false,
          autoNAT: false,
          upnp: false,
          circuitRelay: false,
          circuitRelayServer: false,
          dcutr: false,
        },
        reservedRelays: [],
        hasRelayedListenAddr: false,
      };
    },
  };
}

function makeUserMessage(messageId = "message-1"): P2PMessage {
  return {
    id: messageId,
    type: "user-message",
    from: "peer-sender",
    payload: JSON.stringify({
      messageId,
      fromInstanceId: "sender@def.456",
      toInstanceId: "receiver@abc.123",
      text: "今晚来吃饭",
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: "sender@def.456",
        replyTool: "p2p_send_instance_message",
      },
    }),
    timestamp: Date.now(),
    instanceId: "sender@def.456",
  };
}

function parseAck(sent: SentMessage[]) {
  const ackMessage = sent.find((entry) => entry.message.type === "delivery-ack");
  assert.ok(ackMessage, "expected delivery-ack to be sent");
  return JSON.parse(ackMessage.message.payload);
}

test("legacy single-target config still delivers once", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.channel, "feishu");
  assert.equal(deliveries[0]?.target, "user:ou_xxx");
  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
});

test("non-empty inboundTargets overrides legacy fields and deduplicates identical targets", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundChannel: "legacy",
      inboundTarget: "legacy-target",
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "feishu-duplicate", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.deepEqual(
    deliveries.map((request) => `${request.channel}/${request.target}`),
    ["feishu/user:ou_xxx", "telegram/chat:123456"],
  );
  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
  assert.deepEqual(
    ack.results.map((result: { id?: string; channel: string; target: string; ok: boolean }) => ({
      id: result.id,
      channel: result.channel,
      target: result.target,
      ok: result.ok,
    })),
    [
      { id: "feishu-main", channel: "feishu", target: "user:ou_xxx", ok: true },
      { id: "telegram-main", channel: "telegram", target: "chat:123456", ok: true },
    ],
  );
});

test("empty inboundTargets disables fallback and returns unconfigured failure", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      inboundTargets: [],
    },
  });

  await router.handleMessage(makeUserMessage());

  assert.equal(deliveries.length, 0);
  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.error, "inbound delivery is not configured");
  assert.deepEqual(ack.results, []);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: tests fail because `InstanceRouter` does not support `inboundTargets` or ACK `results` yet.

- [ ] **Step 3: Add target normalization helpers in `src/instance-router.ts`**

Update imports:

```ts
  DeliveryTargetResult,
  InboundTargetConfig,
```

Add helpers above `createInstanceRouter`:

```ts
type EffectiveInboundTarget = {
  id?: string;
  channel: string;
  target: string;
  valid: boolean;
  error?: string;
};

function displayTargetId(target: { id?: string; channel?: string; target?: string }): string | undefined {
  return target.id?.trim() || undefined;
}

function normalizeConfiguredTarget(target: InboundTargetConfig): EffectiveInboundTarget {
  const channel = typeof target.channel === "string" ? target.channel.trim() : "";
  const destination = typeof target.target === "string" ? target.target.trim() : "";
  const normalized: EffectiveInboundTarget = {
    id: displayTargetId(target),
    channel,
    target: destination,
    valid: Boolean(channel && destination),
  };
  if (!normalized.valid) {
    normalized.error = "inbound target channel and target are required";
  }
  return normalized;
}

function effectiveInboundTargets(config: MeshConfig): EffectiveInboundTarget[] {
  if (Array.isArray(config.inboundTargets)) {
    const seen = new Set<string>();
    const targets: EffectiveInboundTarget[] = [];
    for (const target of config.inboundTargets) {
      const normalized = normalizeConfiguredTarget(target);
      const key = `${normalized.channel}\0${normalized.target}`;
      if (normalized.valid && seen.has(key)) {
        continue;
      }
      if (normalized.valid) {
        seen.add(key);
      }
      targets.push(normalized);
    }
    return targets;
  }

  if (!config.inboundChannel || !config.inboundTarget) {
    return [];
  }
  return [
    {
      channel: config.inboundChannel,
      target: config.inboundTarget,
      valid: true,
    },
  ];
}

function firstAttemptedResult(results: DeliveryTargetResult[]): DeliveryTargetResult | undefined {
  return results.find((result) => result.ok) ?? results[0];
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: tests still fail because `handleUserMessage()` has not been updated to call the helpers.

- [ ] **Step 5: Commit helper-only change**

```bash
git add src/instance-router.ts test/instance-router.test.ts
git commit -m "test: cover inbound target selection"
```

## Task 4: Implement Receiver Fan-Out and ACK Aggregation

**Files:**
- Modify: `src/instance-router.ts`
- Modify: `test/instance-router.test.ts`

- [ ] **Step 1: Add mixed-failure and duplicate-message tests**

Append these tests to `test/instance-router.test.ts`:

```ts
test("mixed target results return ok true with every target result", async () => {
  const sent: SentMessage[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      if (request.channel === "telegram") {
        return {
          ok: false,
          channel: request.channel,
          target: request.target,
          error: "机器人对该用户没有可用权限",
        };
      }
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  const ack = parseAck(sent);
  assert.equal(ack.ok, true);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
  assert.deepEqual(
    ack.results.map((result: { id?: string; ok: boolean; error?: string }) => ({
      id: result.id,
      ok: result.ok,
      error: result.error,
    })),
    [
      { id: "feishu-main", ok: true, error: undefined },
      { id: "telegram-main", ok: false, error: "机器人对该用户没有可用权限" },
    ],
  );
});

test("all target failures return ok false with all errors", async () => {
  const sent: SentMessage[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      return {
        ok: false,
        channel: request.channel,
        target: request.target,
        error: `${request.channel} unavailable`,
      };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
    },
  });

  await router.handleMessage(makeUserMessage());

  const ack = parseAck(sent);
  assert.equal(ack.ok, false);
  assert.equal(ack.inboundChannel, "feishu");
  assert.equal(ack.inboundTarget, "user:ou_xxx");
  assert.deepEqual(
    ack.results.map((result: { id?: string; ok: boolean; error?: string }) => ({
      id: result.id,
      ok: result.ok,
      error: result.error,
    })),
    [
      { id: "feishu-main", ok: false, error: "feishu unavailable" },
      { id: "telegram-main", ok: false, error: "telegram unavailable" },
    ],
  );
});

test("duplicate messageId reuses cached ACK without repeat delivery", async () => {
  const sent: SentMessage[] = [];
  const deliveries: InboundDeliveryRequest[] = [];
  const delivery: InboundDeliveryAdapter = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };
  const router = createInstanceRouter({
    mesh: makeMesh(sent),
    store: makeStore([makeRecord("sender@def.456", "peer-sender")]),
    delivery,
    config: {
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  });

  const message = makeUserMessage("duplicate-message");
  await router.handleMessage(message);
  await router.handleMessage(message);

  assert.equal(deliveries.length, 1);
  const acks = sent.filter((entry) => entry.message.type === "delivery-ack");
  assert.equal(acks.length, 2);
  assert.deepEqual(JSON.parse(acks[0]!.message.payload), JSON.parse(acks[1]!.message.payload));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: mixed/all-failed tests fail because ACK aggregation is still single-target.

- [ ] **Step 3: Replace the delivery block in `handleUserMessage()`**

In `src/instance-router.ts`, replace the current `let ack` block from `if (!config.inboundChannel || !config.inboundTarget)` through the single `delivery.deliver()` call with:

```ts
    let ack: DeliveryAckPayload;
    const targets = effectiveInboundTargets(config);
    if (targets.length === 0) {
      ack = {
        ackFor: payload.messageId,
        ok: false,
        inboundChannel: config.inboundChannel,
        inboundTarget: config.inboundTarget,
        deliveredAt: Date.now(),
        error: "inbound delivery is not configured",
        results: [],
      };
    } else {
      const metadata = payload.metadata;
      const results: DeliveryTargetResult[] = [];
      for (const target of targets) {
        if (!target.valid) {
          results.push({
            id: target.id,
            channel: target.channel,
            target: target.target,
            ok: false,
            error: target.error ?? "inbound target channel and target are required",
          });
          continue;
        }

        const result = await delivery.deliver({
          channel: target.channel,
          target: target.target,
          text: payload.text,
          metadata: {
            fromInstanceId: payload.fromInstanceId,
            fromPeerId: msg.from,
            p2pMessageId: payload.messageId,
            allowAgentAutoReply: metadata?.allowAgentAutoReply === true,
            replyToInstanceId: payload.fromInstanceId,
            replyTool: "p2p_send_instance_message",
          },
        });
        results.push({
          id: target.id,
          channel: result.channel,
          target: result.target,
          ok: result.ok,
          error: result.error,
        });
      }

      const selected = firstAttemptedResult(results);
      ack = {
        ackFor: payload.messageId,
        ok: results.some((result) => result.ok),
        inboundChannel: selected?.channel,
        inboundTarget: selected?.target,
        deliveredAt: Date.now(),
        error: results.every((result) => !result.ok)
          ? results.map((result) => result.error).filter(Boolean).join("; ") ||
            "inbound delivery failed"
          : undefined,
        results,
      };
    }
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add src/instance-router.ts test/instance-router.test.ts
git commit -m "feat: deliver inbound messages to multiple targets"
```

## Task 5: Preserve ACK Result Details on Sender Return

**Files:**
- Modify: `src/instance-router.ts`
- Modify: `test/instance-router.test.ts`

- [ ] **Step 1: Add sender-side router result test**

Append this test to `test/instance-router.test.ts`:

```ts
test("sendInstanceMessage returns ACK target results to tool layer", async () => {
  const sent: SentMessage[] = [];
  const mesh = makeMesh(sent);
  const router = createInstanceRouter({
    mesh,
    store: makeStore([makeRecord("receiver@abc.123", "peer-receiver")]),
    delivery: {
      async deliver(request) {
        return { ok: true, channel: request.channel, target: request.target };
      },
    },
    config: { deliveryAckTimeoutMs: 1000 },
  });

  const pending = router.sendInstanceMessage("receiver@abc.123", "今晚来吃饭");
  const userMessage = sent.find((entry) => entry.message.type === "user-message");
  assert.ok(userMessage, "expected user-message to be sent");

  await router.handleMessage({
    id: "ack-1",
    type: "delivery-ack",
    from: "peer-receiver",
    to: "peer-local",
    payload: JSON.stringify({
      ackFor: userMessage.message.id,
      ok: true,
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      deliveredAt: Date.now(),
      results: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx", ok: true },
        {
          id: "telegram-main",
          channel: "telegram",
          target: "chat:123456",
          ok: false,
          error: "机器人对该用户没有可用权限",
        },
      ],
    }),
    timestamp: Date.now(),
    instanceId: "receiver@abc.123",
  });

  const result = await pending;
  assert.equal(result.delivered, true);
  assert.equal(result.inboundChannel, "feishu");
  assert.equal(result.inboundTarget, "user:ou_xxx");
  assert.deepEqual(result.deliveryResults, [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx", ok: true },
    {
      id: "telegram-main",
      channel: "telegram",
      target: "chat:123456",
      ok: false,
      error: "机器人对该用户没有可用权限",
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test
```

Expected: test fails because `sendInstanceMessage()` does not return `inboundTarget` or `deliveryResults`.

- [ ] **Step 3: Update `sendInstanceMessage()` return**

In `src/instance-router.ts`, update the final return after `const ack = await ackPromise;`:

```ts
    return {
      sent: true,
      delivered: ack.ok,
      toInstanceId: instanceId,
      toPeerId: route.peerId,
      ackMessageId: ack.ackFor,
      inboundChannel: ack.inboundChannel,
      inboundTarget: ack.inboundTarget,
      deliveryResults: ack.results,
      error: ack.error,
    };
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add src/instance-router.ts test/instance-router.test.ts
git commit -m "feat: return inbound target results to sender"
```

## Task 6: Format Per-Target Sender Tool Output

**Files:**
- Modify: `src/agent-tools.ts`
- Modify: `test/agent-tools.test.ts`

- [ ] **Step 1: Replace `test/agent-tools.test.ts` with sender display tests**

Use this file content:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildP2PTools } from "../src/agent-tools.js";
import type { InstanceRouter, MeshNetwork } from "../src/types.js";

function makeMesh(): MeshNetwork {
  return {
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage() {},
    onMessage() {
      return () => {};
    },
    onPeerConnect() {
      return () => {};
    },
    onPeerDisconnect() {
      return () => {};
    },
    async publishToTopic() {},
    async subscribeToTopic() {},
    getLocalPeerId() {
      return "peer-local";
    },
    getConnectedPeers() {
      return [];
    },
    getMultiaddrs() {
      return [];
    },
    async dial() {},
    getInstanceIdentity() {
      return undefined;
    },
    getNATStatus() {
      return {
        enabled: {
          identify: false,
          autoNAT: false,
          upnp: false,
          circuitRelay: false,
          circuitRelayServer: false,
          dcutr: false,
        },
        reservedRelays: [],
        hasRelayedListenAddr: false,
      };
    },
  };
}

function makeRouter(result: Awaited<ReturnType<InstanceRouter["sendInstanceMessage"]>>): InstanceRouter {
  return {
    async start() {},
    async stop() {},
    async handleMessage() {},
    async announceToPeer() {},
    async listInstances() {
      return [];
    },
    async resolveInstance() {
      return undefined;
    },
    async sendInstanceMessage() {
      return result;
    },
  };
}

function sendInstanceTool(router: InstanceRouter) {
  const tool = buildP2PTools(makeMesh(), router).find(
    (candidate) => candidate.name === "p2p_send_instance_message",
  );
  assert.ok(tool, "expected p2p_send_instance_message tool");
  return tool;
}

test("send instance tool shows every target result when at least one target succeeds", async () => {
  const tool = sendInstanceTool(
    makeRouter({
      sent: true,
      delivered: true,
      toInstanceId: "receiver@abc.123",
      toPeerId: "peer-receiver",
      ackMessageId: "message-1",
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      deliveryResults: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx", ok: true },
        {
          id: "telegram-main",
          channel: "telegram",
          target: "chat:123456",
          ok: false,
          error: "机器人对该用户没有可用权限",
        },
      ],
    }),
  );

  const response = await tool.execute("call-1", {
    instanceId: "receiver@abc.123",
    message: "今晚来吃饭",
  });

  assert.equal(response.isError, undefined);
  assert.match(response.content[0]!.text, /发往 receiver@abc\.123 的消息投递结果/);
  assert.match(response.content[0]!.text, /feishu-main \(feishu \/ user:ou_xxx\)：已送达/);
  assert.match(response.content[0]!.text, /telegram-main \(telegram \/ chat:123456\)：失败：机器人对该用户没有可用权限/);
});

test("send instance tool marks all-target failure as isError and shows details", async () => {
  const tool = sendInstanceTool(
    makeRouter({
      sent: true,
      delivered: false,
      toInstanceId: "receiver@abc.123",
      toPeerId: "peer-receiver",
      ackMessageId: "message-1",
      deliveryResults: [
        {
          id: "feishu-main",
          channel: "feishu",
          target: "user:ou_xxx",
          ok: false,
          error: "机器人对该用户没有可用权限",
        },
        {
          id: "telegram-main",
          channel: "telegram",
          target: "chat:123456",
          ok: false,
          error: "channel telegram 没有提供 runtime 文本投递能力",
        },
      ],
      error: "机器人对该用户没有可用权限; channel telegram 没有提供 runtime 文本投递能力",
    }),
  );

  const response = await tool.execute("call-1", {
    instanceId: "receiver@abc.123",
    message: "今晚来吃饭",
  });

  assert.equal(response.isError, true);
  assert.match(response.content[0]!.text, /发往 receiver@abc\.123 的消息投递失败/);
  assert.match(response.content[0]!.text, /feishu-main \(feishu \/ user:ou_xxx\)：失败：机器人对该用户没有可用权限/);
  assert.match(response.content[0]!.text, /telegram-main \(telegram \/ chat:123456\)：失败：channel telegram 没有提供 runtime 文本投递能力/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: agent tool tests fail because output is still the old single-line English text.

- [ ] **Step 3: Add formatting helpers to `src/agent-tools.ts`**

Update the import:

```ts
import type { DeliveryTargetResult, InstanceRouter, MeshNetwork } from "./types.js";
```

Add helpers above `buildP2PTools`:

```ts
function targetLabel(result: DeliveryTargetResult): string {
  const id = result.id?.trim();
  const location = `${result.channel} / ${result.target}`;
  return id ? `${id} (${location})` : location;
}

function formatDeliveryResults(instanceId: string, delivered: boolean, results: DeliveryTargetResult[]): string {
  const header = delivered
    ? `发往 ${instanceId} 的消息投递结果：`
    : `发往 ${instanceId} 的消息投递失败：`;
  const lines = results.map((result) => {
    if (result.ok) {
      return `- ${targetLabel(result)}：已送达`;
    }
    return `- ${targetLabel(result)}：失败：${result.error ?? "unknown error"}`;
  });
  return [header, ...lines].join("\n");
}
```

- [ ] **Step 4: Update `p2p_send_instance_message` execute branch**

Inside `src/agent-tools.ts`, after `const result = await router.sendInstanceMessage(instanceId, message);`, add:

```ts
        if (result.deliveryResults && result.deliveryResults.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatDeliveryResults(instanceId, result.delivered, result.deliveryResults),
              },
            ],
            details: result,
            isError: result.delivered ? undefined : true,
          };
        }
```

Keep the existing old fallback branch below it for legacy ACKs without `deliveryResults`.

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent-tools.ts test/agent-tools.test.ts
git commit -m "feat: show per-target delivery status"
```

## Task 7: Update README and Final Verification

**Files:**
- Modify: `README.md`
- Test: `npm test`, `npm run build`

- [ ] **Step 1: Update configuration reference**

In `README.md`, near the existing `inboundChannel`, `inboundTarget`, and `deliveryAckTimeoutMs` configuration table, add a row:

```md
| `inboundTargets` | `array` | `undefined` | Optional list of receiver-owned channel targets for inbound P2P user messages. When present, it overrides `inboundChannel`/`inboundTarget`; an empty array disables inbound delivery. |
```

- [ ] **Step 2: Add a multi-target example**

Near the existing instance-message configuration example, add:

```md
### Multi-channel inbound delivery

The sender still calls `p2p_send_instance_message({ "instanceId": "...", "message": "..." })`.
The receiver chooses where inbound P2P messages appear:

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "mdns",
          "inboundTargets": [
            {
              "id": "feishu-main",
              "channel": "feishu",
              "target": "user:ou_xxx"
            },
            {
              "id": "telegram-main",
              "channel": "telegram",
              "target": "chat:123456"
            }
          ],
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

If `inboundTargets` is present, it is used instead of `inboundChannel`/`inboundTarget`.
The sender receives per-target delivery status in the tool result.
```

- [ ] **Step 3: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: tests and build pass.

- [ ] **Step 4: Check git diff**

Run:

```bash
git diff --stat
git diff -- src/types.ts src/instance-router.ts src/agent-tools.ts openclaw.plugin.json README.md package.json test/instance-router.test.ts test/agent-tools.test.ts
```

Expected: diff only contains multi-inbound-target changes.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document multi inbound targets"
```

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
```

Expected: no uncommitted files from this implementation. If unrelated user files are present, leave them untouched and mention them in the handoff.

## Self-Review

- Spec coverage: The plan covers legacy config compatibility, `inboundTargets`, empty-array behavior, sender not choosing channel, receiver-side fan-out, per-target ACK results, sender display, duplicate target dedupe, duplicate message cache, schema, tests, and README.
- Red-flag scan: No vague “add tests” steps remain; every task includes concrete files, code, commands, and expected results.
- Type consistency: The plan uses `InboundTargetConfig`, `DeliveryTargetResult`, `DeliveryAckPayload.results`, `MeshConfig.inboundTargets`, and `InstanceRouter.sendInstanceMessage().deliveryResults` consistently across tasks.
