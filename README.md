# libp2p-mesh

P2P mesh network plugin for OpenClaw. Enables direct peer-to-peer communication between OpenClaw instances using libp2p — no central server required.

## Features

- **LAN Discovery** — Auto-discovers peers on the same local network via mDNS (Bonjour/Avahi)
- **Direct Messaging** — Send messages directly to another peer by its Peer ID
- **Broadcast** — Publish messages to a shared topic, flood-fill forwarded across the mesh
- **Bootstrap Mode** — Optional static bootstrap peer list for non-LAN scenarios
- **WebSocket Transport** — Optional WebSocket support for NAT/firewall-friendly connections
- **NAT Traversal** — Built-in AutoNAT + UPnP + Circuit Relay v2 + DCUtR for peers behind home routers / firewalls
- **User Public Attributes** — Announce public tags and structured profile attributes so agents can dry-run and send to locally discovered instances by attribute

## Requirements

- OpenClaw >= 2026.3.24
- Node.js >= 22
- For LAN discovery: both peers must be on the same local network (same WiFi / Ethernet segment)

## Installation

### Method 1: Via OpenClaw CLI (Recommended)

```bash
openclaw install libp2p-mesh
```

### Method 2: Manual (npm)

如果无法通过 OpenClaw CLI 安装，可以手动安装到 managed npm root：

```bash
cd ~/.openclaw/npm
npm install libp2p-mesh
```

然后刷新插件注册表：

```bash
openclaw plugins registry --refresh
```

The published npm package includes compiled JavaScript under `dist/`, so OpenClaw and acpx can load it directly.

Then run the setup wizard:

```bash
openclaw libp2p-mesh setup
```

The wizard creates or edits `plugins.entries["libp2p-mesh"].config` in your OpenClaw config file. You do not need to manually edit `openclaw.json`.

After the wizard writes changes, restart the gateway:

```bash
openclaw gateway restart
```

The generated config shape is:

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "mdns",
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

## Configuration

Use the interactive setup command for first-time configuration and later edits:

```bash
openclaw libp2p-mesh setup
```

On first run, the wizard enables the plugin and writes `plugins.entries["libp2p-mesh"].config`. On later runs, it edits the existing `libp2p-mesh` entry instead of replacing it blindly. It can update the network mode, add or remove inbound delivery targets, preview the final JSON, and only writes after you confirm.

The wizard uses OpenClaw's config writer, so the actual file is your normal OpenClaw config path, usually `~/.openclaw/openclaw.json`. You do not need to manually edit `openclaw.json`, and the wizard does not create `channels["libp2p-mesh"]`.

Restart the gateway after applying changes:

```bash
openclaw gateway restart
```

### Minimal LAN Setup (Default)

Run:

```bash
openclaw libp2p-mesh setup
```

Choose LAN mode for two computers on the same WiFi or Ethernet segment. The wizard writes:

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "mdns",
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

This is sufficient for two computers on the same WiFi to discover each other.

### With Static Port (Optional)

By default, the node picks a random TCP port. To use a fixed port:

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "mdns",
          "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

### With Bootstrap Nodes (Cross-Network)

If peers are on different networks, run the setup wizard and choose cross-network mode. It prompts for bootstrap and optional relay multiaddrs, then writes:

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "bootstrap",
          "bootstrapList": [
            "/ip4/203.0.113.10/tcp/4001/p2p/12D3KooW..."
          ],
          "relayList": [
            "/ip4/203.0.113.10/tcp/4001/p2p/12D3KooW..."
          ],
          "enableNATTraversal": true,
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

### Multiple Inbound Targets

Inbound delivery is owned by the receiving OpenClaw instance. In the setup wizard, choose to add one or more inbound delivery targets. The sender still sends to the receiver's peer ID or instance ID; the receiver decides which local channels display the incoming message.

Example wizard output with two targets:

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

If `inboundTargets` is an empty array, inbound delivery is disabled. If `inboundTargets` is omitted, the plugin keeps any existing inbound behavior unchanged. When `inboundTargets` is present, it overrides legacy `inboundChannel`/`inboundTarget`.

### Full Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `discovery` | `string` | `"mdns"` | Discovery mechanism: `"mdns"` (LAN), `"bootstrap"` (static list), `"dht"` (Kademlia peer discovery and pubkey registry) |
| `listenAddrs` | `string[]` | `["/ip4/0.0.0.0/tcp/0"]` | libp2p listen multiaddrs |
| `bootstrapList` | `string[]` | `[]` | Static bootstrap peer multiaddrs (when `discovery=bootstrap`) |
| `enableWebSocket` | `boolean` | `false` | Enable WebSocket transport for browser/NAT compatibility |
| `meshTopic` | `string` | `"openclaw-mesh"` | Default broadcast topic |
| `enableAgentSync` | `boolean` | `true` | Enable agent state synchronization over the mesh |
| `enableNATTraversal` | `boolean` | `true` | Master switch for identify + AutoNAT + UPnP + Circuit Relay v2 + DCUtR |
| `enableIdentify` | `boolean` | `true` | libp2p identify protocol (required by AutoNAT and DCUtR) |
| `enableAutoNAT` | `boolean` | `true` | AutoNAT — detect whether this node is publicly reachable |
| `enableUPnP` | `boolean` | `true` | Attempt UPnP/PMP port mapping on the local gateway |
| `enableCircuitRelay` | `boolean` | `true` | Dial peers via /p2p-circuit relay addresses |
| `enableCircuitRelayServer` | `boolean` | `false` | Act as a Circuit Relay v2 server (only enable on a public node) |
| `enableDCUtR` | `boolean` | `true` | Hole-punching: upgrade a relayed connection to a direct one |
| `relayList` | `string[]` | `[]` | Multiaddrs of relays to reserve a slot on |
| `discoverRelays` | `number` | `0` | Auto-discover this many relays via content routing |
| `announceAddrs` | `string[]` | `[]` | Extra multiaddrs to announce on top of auto-detected ones |
| `announceLogDetail` | `"off" \| "summary" \| "payload"` | `"summary"` | Controls instance announce logging. `summary` logs peer, instance, address count, and attribute count; `payload` also logs the full announce JSON; `off` disables only the new announce summary/payload logs and keeps legacy/basic info logs. |
| `inboundChannel` | `string` | `undefined` | OpenClaw channel used to display inbound P2P user messages, for example `"feishu"` |
| `inboundTarget` | `string` | `undefined` | OpenClaw channel target for inbound P2P messages, for example `user:ou_xxx` or `chat:oc_xxx` |
| `inboundTargets` | `array` | `undefined` | Optional list of receiver-owned channel targets for inbound P2P user messages. When present, it overrides `inboundChannel`/`inboundTarget`; an empty array disables inbound delivery. |
| `deliveryAckTimeoutMs` | `number` | `15000` | Timeout for waiting on remote channel delivery ACKs |

### Announce Startup and Logging

During gateway startup, `libp2p-mesh` registers the instance router handlers and direct/broadcast inbound handlers before starting the mesh node. This makes early `instance-announce` messages observable as soon as peers connect, instead of waiting until after mesh startup has already completed.

Instance announce logs are controlled by `plugins.entries["libp2p-mesh"].config.announceLogDetail`:

- `summary` is the default. It logs send/receive direction, peer ID, instance ID, multiaddr count, and public attribute count. It does not print the full announce JSON.
- `off` disables the new announce summary and payload logs. It still keeps legacy/basic info logs such as sent announce lines and instance mapping updates, along with warnings and errors.
- `payload` logs the same summary plus the full announce JSON at debug level.

Use the debug command to inspect or change this value:

```bash
openclaw libp2p-mesh debug
```

Full payload logging is intended for short-lived troubleshooting only. Announce payloads can include `userPublicAttributes`, peer multiaddrs, the instance pubkey, and instance identity fields. After changing the setting, restart the gateway for the new logging level to take effect:

```bash
openclaw gateway restart
```

## NAT Traversal

When both peers have a routable address (same LAN, public IPs, or working port-forwarding) no extra setup is needed. The defaults above kick in automatically:

- **UPnP** asks your home router to open a port for libp2p TCP.
- **AutoNAT** asks peers to verify whether you're reachable from the outside.
- If you're not directly reachable, **Circuit Relay v2** lets another peer (the "relay") forward traffic on your behalf. The relay only sees encrypted bytes — Noise still terminates end-to-end at the original peers.
- Once a relayed connection is established, **DCUtR** tries to upgrade it to a direct connection via simultaneous TCP open (hole punching). This works for most home NATs (full-cone, restricted-cone, port-restricted) but not symmetric NATs (CGNAT, some carrier networks).

### Behind a NAT — minimal config

You need at least one relay node with a public IP. Set it in `relayList`:

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "bootstrap",
          "bootstrapList": [
            "/ip4/<RELAY-IP>/tcp/4001/p2p/<RELAY-PEER-ID>"
          ],
          "relayList": [
            "/ip4/<RELAY-IP>/tcp/4001/p2p/<RELAY-PEER-ID>"
          ],
          "enableNATTraversal": true,
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

After start-up you should see your node listening on a `/p2p-circuit` address — that's how remote peers will reach you.

### Running your own relay on a public VM

Add `enableCircuitRelayServer: true` to your config and announce the public address so other peers can dial you:

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "bootstrap",
          "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
          "announceAddrs": ["/ip4/<PUBLIC-IP>/tcp/4001"],
          "enableNATTraversal": true,
          "enableCircuitRelayServer": true,
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

> Detailed walkthrough including how to rent a cloud VM is in `../TESTING_NAT.md`.

## Usage: Two Computers on the Same LAN

### Step 1 — Start both gateways

**Computer A** (e.g. your desktop):
```bash
openclaw gateway run
```

**Computer B** (e.g. your laptop or a friend's machine):
```bash
openclaw gateway run
```

Wait ~5–10 seconds for mDNS discovery. You should see in the logs:
```
[libp2p-mesh] Peer connected: 12D3KooW...
```

### Step 2 — Find your Peer ID

On each computer:
```bash
openclaw channels status --probe
```

Look for the `libp2p-mesh` channel section — your Peer ID is displayed there. It looks like:
```
12D3KooWRYyHaWzL8n7i5Z8zZ8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8
```

Alternatively, check the gateway startup log:
```
[libp2p-mesh] Node started. Peer ID: 12D3KooW...
```

### Step 3 — Send a message

**From Computer A to Computer B:**
```bash
openclaw message send libp2p-mesh <COMPUTER-B-PEER-ID> "Hello from A!"
```

**From Computer B to Computer A:**
```bash
openclaw message send libp2p-mesh <COMPUTER-A-PEER-ID> "Hello from B!"
```

### Step 4 — Verify receipt

Check the gateway logs on the receiving machine. You should see:
```
[libp2p-mesh] Direct message from <sender-peer-id>: Hello from A!
```

## Sending by OpenClaw Instance ID

When two gateways connect, `libp2p-mesh` exchanges instance route announcements and automatically writes:

```text
~/.openclaw/libp2p/instance-peer.json
```

When `OPENCLAW_STATE_DIR` is set, the file is written to:

```text
$OPENCLAW_STATE_DIR/libp2p/instance-peer.json
```

Users do not configure this file path. It is plugin-managed state.

For inbound display, run the setup wizard on the receiving instance and add a target:

```bash
openclaw libp2p-mesh setup
```

The wizard edits `plugins.entries["libp2p-mesh"].config` and can add, edit, remove, or disable inbound delivery targets. You do not need to manually edit `openclaw.json`.

Example result for a single Feishu target:

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
            }
          ],
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

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

The OpenClaw agent should prefer:

```text
p2p_send_instance_message({ "instanceId": "<target-instance-id>", "message": "今晚出来吃饭" })
```

The sender reports success only after the remote OpenClaw instance forwards the message to its configured inbound channel and returns a delivery ACK.

Tools are not configured in `openclaw.json`; they are registered automatically by the plugin through `api.registerTool()`.

### User public attributes

`libp2p-mesh` can announce user public attributes with instance route announcements. These attributes help agents find matching OpenClaw instances after those instances have already been discovered through the mesh.

There are two public sources:

- `USER.md` tags are produced asynchronously by the gateway. The gateway uses the OpenClaw-configured agent/API model to extract tags from `USER.md` without editing the file.
- `user-profile.json` stores manually managed structured attributes such as group, project, role, skill, or a custom key.

The initial base `instance-announce` may omit `userPublicAttributes`. After the gateway extracts `USER.md` tags and merges `user-profile.json`, it rebroadcasts a full `instance-announce` snapshot. If extraction is unavailable, `USER.md` tags are skipped; profile attributes still broadcast.

By default, `USER.md` is read from:

```text
~/.openclaw/workspace/USER.md
```

When `OPENCLAW_STATE_DIR` is set, the plugin reads:

```text
$OPENCLAW_STATE_DIR/workspace/USER.md
```

Run the profile wizard to manage structured attributes:

```bash
openclaw libp2p-mesh profile
```

The wizard previews read-only `USER.md` tags and lets you add, edit, or remove only structured profile attributes. Tags extracted from `USER.md` are not written to `user-profile.json`; they are merged in memory with profile attributes and broadcast only in full instance announce snapshots after asynchronous extraction completes.

The default profile path is:

```text
~/.openclaw/libp2p/user-profile.json
```

When `OPENCLAW_STATE_DIR` is set:

```text
$OPENCLAW_STATE_DIR/libp2p/user-profile.json
```

Example `user-profile.json`:

```json
{
  "version": 1,
  "updatedAt": 1782180000000,
  "attributes": [
    {
      "kind": "structured",
      "key": "project",
      "value": "openclaw",
      "label": "project: openclaw",
      "source": "profile"
    },
    {
      "kind": "structured",
      "key": "role",
      "value": "maintainer",
      "label": "role: maintainer",
      "source": "profile"
    }
  ]
}
```

Remote attributes are cached in plugin-managed instance state under `instance-peer.json.userPublicAttributes`:

```json
{
  "version": 1,
  "updatedAt": 1782180000000,
  "instances": {
    "alice-mac@AQIDBAUGBweI.7a3f9e2b": {
      "instanceId": "alice-mac@AQIDBAUGBweI.7a3f9e2b",
      "peerId": "12D3KooW...",
      "instanceName": "alice-mac",
      "multiaddrs": ["/ip4/192.168.1.23/tcp/4001"],
      "userPublicAttributes": [
        {
          "kind": "tag",
          "value": "libp2p",
          "label": "libp2p",
          "source": "USER.md"
        },
        {
          "kind": "structured",
          "key": "project",
          "value": "openclaw",
          "label": "project: openclaw",
          "source": "profile"
        }
      ],
      "lastSeenAt": 1782180000000,
      "lastAnnouncedAt": 1782180000000,
      "source": "announce"
    }
  }
}
```

### Local peer labels

Use local peer labels when you want to classify remote instances privately on this machine:

```bash
openclaw libp2p-mesh labels
```

The default labels path is:

```text
~/.openclaw/libp2p/peer-labels.json
```

When `OPENCLAW_STATE_DIR` is set:

```text
$OPENCLAW_STATE_DIR/libp2p/peer-labels.json
```

Example `peer-labels.json`:

```json
{
  "version": 1,
  "updatedAt": 1782180000000,
  "peers": {
    "alice-mac@AQIDBAUGBweI.7a3f9e2b": {
      "labels": [
        { "key": "group", "value": "实验室" },
        { "key": "project", "value": "openclaw" }
      ]
    }
  }
}
```

Privacy boundary: `peer-labels.json` is local state for your gateway. It is not announced to peers, not written into remote `instance-peer.json.userPublicAttributes`, and not visible to the remote user through the mesh protocol. Public attributes in `USER.md` and `user-profile.json` are still broadcast with instance announce messages.

Use `p2p_send_user_attribute_message` for attribute-based group messages. It defaults to public attributes only, equivalent to `scope="public"`. Always dry-run first. If the dry run matches targets, call the same tool again immediately with the same selector, scope, message, and `dryRun: false`.

Public scope matches attributes that remote instances announced from their own `USER.md` or `user-profile.json`:

```text
p2p_send_user_attribute_message({
  "selector": "project=openclaw",
  "message": "今晚同步一下进展",
  "scope": "public",
  "dryRun": true
})
```

After a matching dry run:

```text
p2p_send_user_attribute_message({
  "selector": "project=openclaw",
  "message": "今晚同步一下进展",
  "scope": "public",
  "dryRun": false
})
```

Local scope, written as `scope="local"` in prompt instructions or `"scope": "local"` in tool JSON, matches only labels from your `peer-labels.json`:

```text
p2p_send_user_attribute_message({
  "selector": "group=实验室",
  "message": "我按本地归类发一个提醒",
  "scope": "local",
  "dryRun": true
})
```

All scope matches both sources and deduplicates by instance:

```text
p2p_send_user_attribute_message({
  "selector": "project=openclaw",
  "message": "公开属性和本地标签都算",
  "scope": "all",
  "dryRun": true
})
```

Selectors use `key=value` for structured profile attributes or local labels. Tag matches use `tag:value` or `#value` for public `USER.md` tags. Bare selectors such as `实验室` are rejected because they are ambiguous; use `group=实验室` for a structured group or `tag:实验室` for a USER.md tag.

```text
p2p_send_user_attribute_message({
  "selector": "#libp2p",
  "message": "libp2p 方向有个问题想确认",
  "dryRun": true
})
```

The first version matches only instances already present in the local `instance-peer.json` discovery cache. It does not search the whole network or ask disconnected peers for more users.

Privacy boundary: public attributes are broadcast with instance announce messages to peers your gateway connects to. Do not put private, sensitive, or access-controlled information in `USER.md` tags or `user-profile.json` structured attributes.

## Troubleshooting

### Peers do not discover each other

1. **Confirm same network** — Both computers must be on the same subnet (e.g. `192.168.1.x`). Check with `ip addr` or `ifconfig`.
2. **Check firewall** — OpenClaw needs inbound TCP access on the port chosen by libp2p (random by default). Temporarily disable the firewall to test:
   - macOS: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off`
   - Linux (ufw): `sudo ufw disable`
   - Linux (firewalld): `sudo systemctl stop firewalld`
3. **Check mDNS** — Ensure mDNS/Bonjour/Avahi is running:
   - macOS: built-in, should work
   - Linux: `sudo systemctl status avahi-daemon`
4. **Use static port + manual IP** — If mDNS still fails, switch to bootstrap mode and use the LAN IP directly:
   ```json
   {
     "discovery": "bootstrap",
     "bootstrapList": [
       "/ip4/192.168.1.42/tcp/4001/p2p/<PEER-ID-OF-OTHER-MACHINE>"
     ]
   }
   ```

### "Mesh network is not started" error

This error only appears if you run `openclaw message send` while the gateway is **not** running. Start the gateway first:
```bash
openclaw gateway run
```

If the gateway is already running, the CLI automatically routes through the gateway (this was fixed in recent versions).

### Message timeout after 8 seconds

The peer may be unreachable. Check:
- Is the target gateway still running?
- Are both machines on the same network?
- Is there a firewall blocking the connection?

### Connected peers are not visible in logs

Peer connection and disconnection are logged at `info` level:

```text
[libp2p-mesh] Peer connected: 12D3KooW...
[libp2p-mesh] Instance mapping updated: bob@def.456 -> 12D3KooW...
```

If these lines are missing, confirm the gateway is running with normal info logs enabled and that both instances are on the same mDNS, bootstrap, or relay network.

### Instance announce routes are missing between two machines

If peers connect but sending by OpenClaw instance ID fails or `instance-peer.json` is not updated, first confirm both gateways were restarted after the latest config change. On startup, the gateway now attaches the instance router plus inbound message handlers before starting the mesh, so early announces should be handled once the peer connection appears.

For a short debug session on both computers:

1. Run `openclaw libp2p-mesh debug`.
2. Set `announceLogDetail` to `payload` and confirm the privacy warning.
3. Restart both gateways with `openclaw gateway restart`.
4. Watch for summary lines and debug lines containing full announce payload JSON.
5. Return to `summary` or `off` with `openclaw libp2p-mesh debug`, then restart again.

Full payload logs may expose `userPublicAttributes`, multiaddrs, pubkey, and instance identity, so avoid sharing these logs outside the debugging context.

## Architecture

```
┌─────────────┐      mDNS LAN        ┌─────────────┐
│  Computer A │  ←────────────────→  │  Computer B │
│  (OpenClaw) │    auto-discovery    │  (OpenClaw) │
│             │  ◄─── libp2p/TCP ──► │             │
│  Peer ID: A │                      │  Peer ID: B │
└─────────────┘                      └─────────────┘
```

- **mDNS** broadcasts service announcements on the LAN
- **libp2p** handles encrypted peer connections and stream multiplexing
- **Noise** encrypts all traffic between peers
- Messages are deduplicated by message ID to prevent loops

## Development

```bash
cd extensions/libp2p-mesh

# Standalone mesh test (no OpenClaw required)
node --import tsx test-p2p-communication.mjs

# Build the plugin
cd ../..
pnpm build
```

## License

MIT
