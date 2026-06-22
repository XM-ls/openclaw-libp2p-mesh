# Multi Inbound Targets Design

## Goal

Extend `libp2p-mesh` inbound delivery so a receiving OpenClaw instance can deliver one incoming P2P user message to one or more locally configured channel conversations.

The sender continues to address only the receiver's `instanceId`. The sender does not choose the receiver's channel, target, or conversation. The receiving instance owns that routing policy through its local plugin config.

## Current Behavior

Today the plugin supports one inbound display target:

```json
{
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveryAckTimeoutMs": 15000
}
```

When `p2p_send_instance_message` sends a `user-message`, the receiver forwards the text to `inboundChannel/inboundTarget` and returns one `delivery-ack`.

This design keeps that behavior valid for existing users.

## Proposed Configuration

Add an optional `inboundTargets` array:

```json
{
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
  ]
}
```

Fields:

- `id`: optional stable local display name for logs and ACK output. It does not affect delivery.
- `channel`: OpenClaw channel name, for example `feishu`.
- `target`: that channel's receiving conversation, for example `user:ou_xxx` or `chat:123456`.

Runtime target selection:

```text
if inboundTargets is present:
  use inboundTargets
else:
  fall back to inboundChannel + inboundTarget
```

An empty `inboundTargets: []` means no inbound targets are configured. It does not fall back to the legacy single-target fields.

## Compatibility

Existing configs remain valid and keep the same behavior:

```json
{
  "discovery": "mdns",
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveryAckTimeoutMs": 15000
}
```

Users who want multi-channel delivery only add `inboundTargets`. If both legacy fields and `inboundTargets` are present, `inboundTargets` wins to avoid duplicate delivery.

## Message Flow

The sender-side tool contract stays unchanged:

```json
{
  "instanceId": "receiver-instance-id",
  "message": "今晚来吃饭"
}
```

Flow:

```text
sender user
-> sender Agent calls p2p_send_instance_message(instanceId, message)
-> sender sends one P2P user-message
-> receiver InstanceRouter validates the message
-> receiver computes effective inbound targets
-> receiver delivers to each target through OpenClaw runtime channel outbound adapters
-> receiver aggregates per-target results
-> receiver returns one delivery-ack
-> sender tool displays each target's delivery status
```

The P2P protocol still sends one `user-message`. Fan-out happens only inside the receiving OpenClaw instance.

## ACK Shape

Extend `delivery-ack` with per-target results:

```json
{
  "ackFor": "message-id",
  "ok": true,
  "deliveredAt": 1710000000000,
  "results": [
    {
      "id": "feishu-main",
      "channel": "feishu",
      "target": "user:ou_xxx",
      "ok": true
    },
    {
      "id": "telegram-main",
      "channel": "telegram",
      "target": "chat:123456",
      "ok": false,
      "error": "Bot has NO availability to this user."
    }
  ]
}
```

`ok` is `true` when at least one target result has `ok: true`.

The legacy fields remain available for compatibility:

```ts
inboundChannel?: string;
inboundTarget?: string;
```

For multi-target ACKs, those fields may point to the first successful target. If all targets fail, they may point to the first attempted target.

## Sender Display

The sender tool must not collapse multi-target delivery into only success, partial success, or failure. It should show each target result.

At least one target delivered:

```text
Message delivery results for ypp@xxx:
- feishu-main (feishu / user:ou_xxx): delivered
- telegram-main (telegram / chat:123456): failed: Bot has NO availability to this user.
```

All targets failed:

```text
Failed to deliver message to ypp@xxx:
- feishu-main (feishu / user:ou_xxx): failed: Bot has NO availability to this user.
- telegram-main (telegram / chat:123456): failed: channel telegram does not expose runtime text delivery
```

Tool error behavior:

- At least one success: `isError` is not set, but failed target details are shown.
- All failed: `isError: true`.
- ACK timeout: keep the existing timeout failure path.

## Error Handling

Target computation:

- `inboundTargets` missing: use legacy `inboundChannel/inboundTarget`.
- `inboundTargets` empty: return failed ACK with `error: "inbound delivery is not configured"`.
- Legacy fields missing and no `inboundTargets`: return failed ACK with the same error.

Per-target delivery:

- Invalid target item: return a failed result for that item and continue with the rest.
- Channel adapter missing or no `sendText`: return a failed result for that target.
- Channel permission failure, such as Feishu bot availability errors: return a failed result with the adapter error summary.
- Partial failure does not stop later targets from being attempted.

Duplicate handling:

- Deduplicate identical targets by `channel + "\0" + target` before delivery.
- If a duplicate P2P `messageId` arrives, reuse the cached ACK and do not deliver again.

## Data Model

Add types:

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

Extend existing types:

```ts
export interface MeshConfig {
  inboundTargets?: InboundTargetConfig[];
}

export interface DeliveryAckPayload {
  results?: DeliveryTargetResult[];
}
```

The existing `InboundDeliveryAdapter.deliver()` can remain single-target. `InstanceRouter` should call it once per effective target and aggregate the results.

## Testing Strategy

Unit tests should cover:

- Legacy single-target config still delivers once.
- Non-empty `inboundTargets` overrides legacy fields.
- Empty `inboundTargets` returns an unconfigured failure.
- Multiple targets all succeed.
- Mixed success and failure returns `ok: true` plus all result details.
- All targets fail returns `ok: false` and all errors.
- Duplicate channel/target entries are delivered once.
- Duplicate P2P `messageId` returns cached ACK without repeat delivery.
- Sender tool formats per-target results and marks only all-failed delivery as `isError`.

Schema tests should cover:

- `openclaw.plugin.json` accepts `inboundTargets`.
- `id` is optional.
- Each target requires `channel` and `target`.

## Non-Goals

- The sender cannot choose the receiver's channel.
- The sender cannot pass `target` or channel-specific routing hints.
- The plugin does not auto-discover a channel's main conversation.
- The plugin does not fan out to every configured OpenClaw channel unless the receiver explicitly lists those targets in `inboundTargets`.
