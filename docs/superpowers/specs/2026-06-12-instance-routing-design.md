# libp2p-mesh Instance Routing Design

Date: 2026-06-12

## Purpose

Extend the existing `libp2p-mesh` OpenClaw plugin so OpenClaw instances can address each other by `instanceId`, not by raw libp2p `peerId`.

The first target flow is Feishu:

1. User A tells botA in Feishu to send a message to a target `instanceId`.
2. botA's OpenClaw agent calls a plugin tool.
3. The plugin resolves `instanceId -> peerId` from its local instance peer table.
4. The message is sent over libp2p to botB's OpenClaw instance.
5. botB forwards the inbound P2P message to its configured Feishu target.
6. botB returns an ACK only after the Feishu channel forwarding succeeds.
7. botA reports the delivery result to user A.

One OpenClaw instance represents one user. The plugin does not resolve human names such as "user B"; users or agents address remote instances by explicit `instanceId`.

## Existing Project Context

The current plugin already has:

- libp2p lifecycle management in `src/mesh.ts`.
- Peer discovery through mDNS, bootstrap, DHT, NAT traversal, and relay support.
- Persistent local `InstanceIdentity` in `~/.openclaw/libp2p/instance-id.json`.
- Signed P2P messages with `instanceId`, `pubkey`, and `signature`.
- DHT pubkey registration and lookup in `src/dht-registry.ts`.
- OpenClaw plugin registration in `index.ts` and `src/plugin.ts`.
- Agent tool registration through `api.registerTool()` in `src/plugin.ts`.
- Current tools in `src/agent-tools.ts`, including `p2p_send_message(peerId, message)`.
- A `libp2p-mesh` channel surface in `src/channel.ts`.

The missing layer is an instance routing layer that exchanges and persists `instanceId <-> peerId` mappings, then exposes first-class tools for agent use.

## Configuration

Users do not configure tools individually in `openclaw.json`. Tools are registered automatically when the plugin is enabled.

First-version user config:

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "mdns",
        "inboundChannel": "feishu",
        "inboundTarget": "user:ou_xxx",
        "deliveryAckTimeoutMs": 15000
      }
    }
  },
  "channels": {
    "libp2p-mesh": {
      "enabled": true
    }
  }
}
```

New config keys:

- `inboundChannel`: channel used to display inbound P2P user messages, for example `"feishu"`.
- `inboundTarget`: channel target used for the local user's inbound display, for example `user:ou_xxx`, `chat:oc_xxx`, `open_id:ou_xxx`, bare `ou_xxx` or `oc_xxx`, and existing `feishu:` / `lark:` provider-prefixed target formats.
- `deliveryAckTimeoutMs`: how long `p2p_send_instance_message` waits for a remote `delivery-ack`. Default: `15000`.

Internal state path:

- Prefer `$OPENCLAW_STATE_DIR/libp2p/instance-peer.json`.
- Otherwise use `~/.openclaw/libp2p/instance-peer.json`.

This path is not a user-facing config option. Tests may override it through an internal constructor option or test environment setup.

## Architecture

Add an `InstanceRouter` layer between `MeshNetwork` and agent tools.

Responsibilities:

- Send this instance's route announcement to connected peers.
- Receive remote route announcements and update the instance peer table.
- Resolve `instanceId -> peerId`.
- Send user messages by `instanceId`.
- Track pending ACKs for outbound user messages.
- Forward inbound user messages to the configured OpenClaw channel target.
- Return delivery ACKs to the sender after channel forwarding succeeds or fails.

Suggested modules:

- `src/instance-peer-store.ts`: persistent `instance-peer.json` read/write logic.
- `src/instance-router.ts`: announce, resolve, ACK tracking, inbound user-message handling.
- `src/inbound-delivery.ts`: adapter that invokes the existing OpenClaw message-send capability.
- `src/agent-tools.ts`: add instance-level tools while keeping existing peer-level tools.

The inbound delivery adapter should hide the first-version delivery mechanism. Today it is equivalent to:

```bash
openclaw message send \
  --channel feishu \
  --target user:ou_xxx \
  --message "<text>"
```

If OpenClaw later provides a plugin API such as `deliverInboundMessage()`, the adapter can switch to that without changing the router or tool contract.

## Message Types

Extend `P2PMessage.type` with:

- `instance-announce`: route announcement.
- `user-message`: business message sent from one user instance to another.
- `delivery-ack`: delivery result for a previous `user-message`.

`instance-announce` payload fields:

```json
{
  "instanceId": "alice@abc.123",
  "peerId": "12D3KooW...",
  "instanceName": "alice-mac",
  "multiaddrs": ["/ip4/192.168.1.2/tcp/4001/p2p/12D3..."],
  "pubkey": "base64url...",
  "announcedAt": 1781190000000
}
```

`user-message` payload fields:

```json
{
  "messageId": "uuid",
  "fromInstanceId": "alice@abc.123",
  "toInstanceId": "bob@def.456",
  "text": "今晚出来吃饭",
  "metadata": {
    "allowAgentAutoReply": true,
    "replyToInstanceId": "alice@abc.123",
    "replyTool": "p2p_send_instance_message"
  }
}
```

`delivery-ack` payload fields:

```json
{
  "ackFor": "uuid",
  "ok": true,
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveredAt": 1781190000000
}
```

Failure ACKs use `ok: false` and include an error summary:

```json
{
  "ackFor": "uuid",
  "ok": false,
  "error": "inbound delivery is not configured",
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveredAt": 1781190000000
}
```

Messages continue to use the existing signing fields: `instanceId`, `pubkey`, and `signature`.

## Announce Flow

No periodic announce loop in the first version.

Announce behavior:

1. After local mesh startup completes, send this instance's `instance-announce` once.
2. On each `peer:connect`, send this instance's `instance-announce` to that peer once.
3. When receiving a remote `instance-announce`, update the local peer table.
4. If this instance has not announced itself to that peer yet, send one announce in response.
5. Do not resend unchanged announcements on an interval.

This keeps logs readable while still populating the table during startup, reconnects, and first contact.

## Instance Peer Table

`instance-peer.json` structure:

```json
{
  "version": 1,
  "updatedAt": 1781190000000,
  "instances": {
    "alice@abc.123": {
      "instanceId": "alice@abc.123",
      "peerId": "12D3KooW...",
      "instanceName": "alice-mac",
      "multiaddrs": ["/ip4/192.168.1.2/tcp/4001/p2p/12D3..."],
      "pubkey": "base64url...",
      "lastSeenAt": 1781190000000,
      "lastAnnouncedAt": 1781190000000,
      "source": "announce"
    }
  }
}
```

Persistence rules:

- Create the file automatically after the first discovered remote instance.
- Use atomic writes: write a temporary file, then rename it.
- If the same `instanceId` announces a new `peerId`, replace the peer and update timestamps.
- If the same `peerId` appears under multiple `instanceId` values, keep both and log a warning.
- Do not automatically delete old entries in the first version; use `lastSeenAt` to show freshness.
- If the JSON file is corrupt at startup, rename it to `.corrupt-<timestamp>` and create a clean empty table.

## Agent Tools

Keep existing tools:

- `p2p_send_message(peerId, message)`
- `p2p_broadcast(topic, message)`
- `p2p_list_peers()`
- `p2p_get_instance_identity()`
- `p2p_get_network_info()`

Add:

### `p2p_list_instances()`

Lists known instances from `instance-peer.json`.

Returned details include:

- `instanceId`
- `peerId`
- `instanceName`
- `lastSeenAt`
- `connected`

### `p2p_resolve_instance({ instanceId })`

Looks up a single `instanceId`.

If found, returns the current route details. If not found, returns `isError: true` with a message such as:

`Instance <id> has not been discovered. Ask the user to confirm the remote gateway is running and connected to the same P2P network.`

### `p2p_send_instance_message({ instanceId, message })`

Primary tool for agents.

Behavior:

1. Resolve `instanceId` from `instance-peer.json`.
2. Send a signed `user-message` to the resolved `peerId`.
3. Wait for `delivery-ack` up to `deliveryAckTimeoutMs`.
4. Return success only when the remote instance reports successful forwarding to its configured inbound channel.

Success result shape:

```json
{
  "sent": true,
  "delivered": true,
  "toInstanceId": "bob@def.456",
  "toPeerId": "12D3KooW...",
  "ackMessageId": "uuid",
  "inboundChannel": "feishu"
}
```

Failure modes return `isError: true` and include structured details.

## OpenClaw Registration

OpenClaw discovers the plugin through the existing package/plugin metadata:

- `package.json.openclaw.extensions` points to `./dist/index.js`.
- `index.ts` exports the `definePluginEntry()` entry.
- `src/plugin.ts` registers service, channel, tools, and hooks.
- `openclaw.plugin.json` describes plugin metadata and contracts.

Required metadata updates:

- Add new config schema entries:
  - `inboundChannel`
  - `inboundTarget`
  - `deliveryAckTimeoutMs`
- Add new contract tools:
  - `p2p_list_instances`
  - `p2p_resolve_instance`
  - `p2p_send_instance_message`

Users do not add tool lists to `openclaw.json`. Enabling the plugin is enough for `registerLibp2pMesh(api)` to call `api.registerTool()` and expose the tools to OpenClaw/Agent.

## Inbound Delivery and Auto Reply

Inbound P2P `user-message` handling:

1. Verify message format and signature.
2. Confirm the message targets this local `instanceId`.
3. Forward the text to `config.inboundChannel` and `config.inboundTarget`.
4. If forwarding succeeds, send `delivery-ack { ok: true }`.
5. If forwarding fails, send `delivery-ack { ok: false, error }`.

Auto-reply policy:

- The plugin does not decide whether to auto-call an agent to reply.
- The plugin passes metadata such as `allowAgentAutoReply`, `replyToInstanceId`, and `replyTool`.
- OpenClaw or the receiving agent may use that metadata to decide whether to respond.
- The first version must not introduce automatic agent-to-agent reply loops.

## Error Handling

- Unknown `instanceId`: return tool error before sending.
- P2P send failure: return tool error with target `peerId` and error summary.
- ACK timeout: return tool error `ACK timeout after <deliveryAckTimeoutMs>ms`.
- Missing `inboundChannel` or `inboundTarget` on receiver: receiver returns failed ACK.
- Inbound channel forwarding failure: receiver returns failed ACK with channel, target, and error summary.
- Invalid signature or malformed payload: reject the message, do not update state, and log a warning.
- Duplicate `user-message`: do not forward to Feishu twice. If a prior delivery result is known, resend the same ACK.

## Logging

Important runtime status must be visible at `info` level.

Change existing logging expectations:

- `peer:connect` should log at `info`, not `debug`.
- `peer:disconnect` should log at `info`, not `debug`.
- First-time `instance-announce` send should log at `info`.
- First-time remote announce receive and table update should log at `info`.
- Idempotent duplicate announce with no data change should not log at `info`; keep it silent or `debug`.
- Low-level details such as relay pre-dial attempts, DHT internals, and duplicate-message suppression stay at `debug`.

README troubleshooting should state that users should see peer connection and instance mapping logs in normal terminal output.

## Testing

### Unit Tests

`InstancePeerStore`:

- Creates an empty table when no file exists.
- Reads existing table.
- Atomically writes updates.
- Backs up corrupt JSON.
- Replaces `peerId` for the same `instanceId`.
- Warns when one `peerId` maps to multiple `instanceId` values.

`InstanceRouter`:

- Sends announce on startup and peer connect.
- Updates store on remote announce.
- Does not log noisy info output for duplicate unchanged announce.
- Resolves known and unknown instances.
- Tracks ACK pending map success and timeout.
- Deduplicates inbound `user-message`.

Tools:

- `p2p_list_instances` returns known rows.
- `p2p_resolve_instance` succeeds and fails correctly.
- `p2p_send_instance_message` returns delivered success on ACK and error on timeout/failure ACK.

### Local Integration

Run two mesh instances with separate state dirs:

- Verify both create `libp2p/instance-peer.json`.
- Verify both learn each other's `instanceId` and `peerId`.
- Send A -> B by `instanceId`.
- Mock B inbound delivery adapter as successful.
- Verify A receives delivered ACK.

### NAT/Docker Regression

Extend existing `test/nat-docker` configs:

- Add `inboundChannel`, `inboundTarget`, and `deliveryAckTimeoutMs`.
- Verify relay/NAT path supports announce and user-message delivery.

## Documentation Updates

Update README with:

- Installation and `openclaw.json` config showing `inboundChannel`, `inboundTarget`, and `deliveryAckTimeoutMs`.
- Explanation that `instance-peer.json` is generated automatically and is not configured by users.
- Explanation that tools are automatically registered by the plugin; users do not list tools in `openclaw.json`.
- Feishu example:
  - User asks botA to send to an explicit `instanceId`.
  - Agent calls `p2p_send_instance_message`.
  - botB forwards to Feishu target.
  - botA receives ACK after remote channel forwarding succeeds.
- Troubleshooting note that normal logs should show peer connections and instance mapping updates at info level.

## Out of Scope

- Human name or contact alias resolution.
- User-managed contact book.
- Periodic route announcement.
- Automatic deletion of stale instance routes.
- Plugin-owned agent auto-reply decisions.
- Requiring users to configure plugin tools in `openclaw.json`.
- Changing OpenClaw core SDK unless the existing message-send capability is insufficient.
