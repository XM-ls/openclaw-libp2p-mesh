# libp2p-mesh

P2P mesh network plugin for OpenClaw. Enables direct peer-to-peer communication between OpenClaw instances using libp2p — no central server required.

## Features

- **LAN Discovery** — Auto-discovers peers on the same local network via mDNS (Bonjour/Avahi)
- **Direct Messaging** — Send messages directly to another peer by its Peer ID
- **Broadcast** — Publish messages to a shared topic, flood-fill forwarded across the mesh
- **Bootstrap Mode** — Optional static bootstrap peer list for non-LAN scenarios
- **WebSocket Transport** — Optional WebSocket support for NAT/firewall-friendly connections
- **NAT Traversal** — Built-in AutoNAT + UPnP + Circuit Relay v2 + DCUtR for peers behind home routers / firewalls

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

Then add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "mdns"
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

## Configuration

Add a `libp2p-mesh` block to your `openclaw.json` under `plugins`:

### Minimal LAN Setup (Default)

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "mdns"
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

This is sufficient for two computers on the same WiFi to discover each other.

### With Static Port (Optional)

By default, the node picks a random TCP port. To use a fixed port:

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "mdns",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"]
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

### With Bootstrap Nodes (Cross-Network)

If peers are on different networks, use a bootstrap node:

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "bootstrapList": [
          "/ip4/203.0.113.10/tcp/4001/p2p/12D3KooW..."
        ]
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
| `inboundChannel` | `string` | `undefined` | OpenClaw channel used to display inbound P2P user messages, for example `"feishu"` |
| `inboundTarget` | `string` | `undefined` | OpenClaw channel target for inbound P2P messages, for example `user:ou_xxx` or `chat:oc_xxx` |
| `inboundTargets` | `array` | `undefined` | Optional list of receiver-owned channel targets for inbound P2P user messages. When present, it overrides `inboundChannel`/`inboundTarget`; an empty array disables inbound delivery. |
| `deliveryAckTimeoutMs` | `number` | `15000` | Timeout for waiting on remote channel delivery ACKs |

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
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "bootstrapList": [
          "/ip4/<RELAY-IP>/tcp/4001/p2p/<RELAY-PEER-ID>"
        ],
        "relayList": [
          "/ip4/<RELAY-IP>/tcp/4001/p2p/<RELAY-PEER-ID>"
        ]
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
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
        "announceAddrs": ["/ip4/<PUBLIC-IP>/tcp/4001"],
        "enableCircuitRelayServer": true
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

For Feishu inbound display, configure the receiving instance:

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
    "libp2p-mesh": { "enabled": true }
  }
}
```

### Multi-channel inbound delivery

The sender still calls `p2p_send_instance_message({ "instanceId": "...", "message": "..." })`.
The receiver chooses where inbound P2P messages appear:

```json
{
  "plugins": {
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
```

If `inboundTargets` is present, it is used instead of `inboundChannel`/`inboundTarget`.
The sender receives per-target delivery status in the tool result.

The OpenClaw agent should prefer:

```text
p2p_send_instance_message({ "instanceId": "<target-instance-id>", "message": "今晚出来吃饭" })
```

The sender reports success only after the remote OpenClaw instance forwards the message to its configured inbound channel and returns a delivery ACK.

Tools are not configured in `openclaw.json`; they are registered automatically by the plugin through `api.registerTool()`.

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
