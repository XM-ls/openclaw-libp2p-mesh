# openclaw-libp2p-mesh

P2P mesh network plugin for OpenClaw. Enables direct peer-to-peer communication between OpenClaw instances using libp2p — no central server required.

## Features

- **LAN Discovery** — Auto-discovers peers on the same local network via mDNS (Bonjour/Avahi)
- **Direct Messaging** — Send messages directly to another peer by its Peer ID
- **Broadcast** — Publish messages to a shared topic, flood-fill forwarded across the mesh
- **Bootstrap Mode** — Optional static bootstrap peer list for non-LAN scenarios
- **WebSocket Transport** — Optional WebSocket support for NAT/firewall-friendly connections

## Requirements

- OpenClaw >= 2026.3.24
- Node.js >= 22
- For LAN discovery: both peers must be on the same local network (same WiFi / Ethernet segment)

## Installation

### Method 1: Via OpenClaw CLI (Recommended)

```bash
openclaw install openclaw-libp2p-mesh
```

### Method 2: Manual

```bash
cd ~/.openclaw/extensions
npm install openclaw-libp2p-mesh
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
  }
}
```

### Full Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `discovery` | `string` | `"mdns"` | Discovery mechanism: `"mdns"` (LAN), `"bootstrap"` (static list), `"dht"` (not yet implemented) |
| `listenAddrs` | `string[]` | `["/ip4/0.0.0.0/tcp/0"]` | libp2p listen multiaddrs |
| `bootstrapList` | `string[]` | `[]` | Static bootstrap peer multiaddrs (when `discovery=bootstrap`) |
| `enableWebSocket` | `boolean` | `false` | Enable WebSocket transport for browser/NAT compatibility |
| `meshTopic` | `string` | `"openclaw-mesh"` | Default broadcast topic |
| `enableAgentSync` | `boolean` | `true` | Enable agent state synchronization over the mesh |

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
