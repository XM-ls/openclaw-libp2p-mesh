# openclaw-libp2p-mesh 测试指南

本文档描述了如何测试 openclaw-libp2p-mesh 插件的各项功能，从独立单元测试到端到端集成测试。

---

## 目录

- [测试 1: 独立单元测试（无需 OpenClaw）](#测试-1-独立单元测试无需-openclaw)
- [测试 2: 构建验证](#测试-2-构建验证)
- [测试 3: OpenClaw 集成测试](#测试-3-openclaw-集成测试)
- [测试 4: 端到端测试](#测试-4-端到端测试)
- [测试 5: Agent Tools 功能测试](#测试-5-agent-tools-功能测试)
- [故障排查](#故障排查)

---

## 测试 1: 独立单元测试（无需 OpenClaw）

直接验证 mesh 核心功能：Peer ID 生成、节点连接、点对点消息、广播、消息处理器订阅/取消。

```bash
cd openclaw-libp2p-mesh
node --import tsx test-mesh-core.mjs
```

查看调试日志：

```bash
VERBOSE=1 node --import tsx test-mesh-core.mjs
```

**预期输出：**

```
[Setup] Starting node A on 127.0.0.1:15001...
  Node A Peer ID: 12D3KooW...
  Node A bootstrap address: /ip4/127.0.0.1/tcp/15001/p2p/12D3KooW...

[Setup] Starting node B, bootstrapping to node A...
  B dialing A...
  Node B Peer ID: 12D3KooW...
  ...

==================================================
Results: 21 passed, 0 failed
All tests passed!
```

**覆盖的测试项：**

| 测试项 | 说明 |
|--------|------|
| Peer ID 生成 | 每个节点生成唯一的 Ed25519 Peer ID |
| Peer ID 持久化 | 密钥对保存到临时文件，重启后复用 |
| 节点间连接 | 通过 `dial()` 在 loopback 上建立 libp2p 连接 |
| 点对点消息 A->B | 发送方、接收方、消息类型、payload、ID、timestamp 均正确 |
| 点对点消息 B->A | 双向通信正常 |
| Topic 广播 | A 广播到 topic，B 的订阅处理器正确接收 |
| 消息处理器订阅/取消 | `onMessage` 返回的取消函数可正确移除处理器 |
| Multiaddrs 获取 | `getMultiaddrs()` 返回监听地址列表 |

---

## 测试 2: 构建验证

验证 TypeScript 能否成功编译：

```bash
cd openclaw-libp2p-mesh
pnpm build
```

**预期输出：**无错误，生成 `dist/` 目录。

```bash
ls dist/
# index.js  index.d.ts  api.js  api.d.ts  src/...
```

---

## 测试 3: OpenClaw 集成测试

### Step 1 — 配置插件

编辑 `~/.openclaw/openclaw.json`：

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

### Step 2 — 启动 gateway

```bash
openclaw gateway run
```

**预期日志：**

```
[libp2p-mesh] Node started. Peer ID: 12D3KooW...
[libp2p-mesh] Listening on: /ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...
```

### Step 3 — 验证 Agent Tools 注册

```bash
openclaw tools list | grep p2p
```

**预期输出：**

```
p2p_send_message    — Send a direct message to another agent via the P2P mesh network
p2p_broadcast       — Broadcast a message to all peers on a topic via the P2P mesh network
p2p_list_peers      — List currently connected peers in the P2P mesh network
```

### Step 4 — 验证 Channel 注册

```bash
openclaw channels status --probe
```

**预期看到 `libp2p-mesh` channel：**

```
libp2p-mesh (P2P Mesh)
  Peer ID: 12D3KooW...
  Connected peers: 0
```

---

## 测试 4: 端到端测试

### 场景 A: 同一局域网两台机器

**机器 A（桌面）：**

```bash
openclaw gateway run
# 记录日志中的 Peer ID，例如：
# [libp2p-mesh] Node started. Peer ID: 12D3KooWAbC...
```

**机器 B（笔记本）：**

```bash
openclaw gateway run
# 等待 mDNS 发现，约 5-10 秒后应看到：
# [libp2p-mesh] Peer connected: 12D3KooWAbC...
```

**从机器 A 向机器 B 发送消息：**

```bash
openclaw message send libp2p-mesh 12D3KooWXYZ... "Hello from A!"
```

**在机器 B 的 gateway 日志中验证：**

```
[libp2p-mesh] Direct message from 12D3KooWAbC...: Hello from A!
```

### 场景 B: 单机器两个 OpenClaw 实例

使用不同的状态目录和配置文件，避免冲突：

**实例 A：**

```bash
export OPENCLAW_STATE_DIR=/tmp/openclaw-a
mkdir -p $OPENCLAW_STATE_DIR

# 创建配置文件
cat > $OPENCLAW_STATE_DIR/openclaw.json <<'EOF'
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "mdns",
        "listenAddrs": ["/ip4/127.0.0.1/tcp/4001"]
      }
    }
  },
  "channels": {
    "libp2p-mesh": { "enabled": true }
  }
}
EOF

openclaw gateway run --config $OPENCLAW_STATE_DIR/openclaw.json
```

**实例 B（另一个终端）：**

```bash
export OPENCLAW_STATE_DIR=/tmp/openclaw-b
mkdir -p $OPENCLAW_STATE_DIR

cat > $OPENCLAW_STATE_DIR/openclaw.json <<'EOF'
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "bootstrapList": [],
        "listenAddrs": ["/ip4/127.0.0.1/tcp/4002"]
      }
    }
  },
  "channels": {
    "libp2p-mesh": { "enabled": true }
  }
}
EOF

openclaw gateway run --config $OPENCLAW_STATE_DIR/openclaw.json
```

> **注意：** 单机器上 mDNS 在 loopback 上不可靠，建议使用 bootstrap 模式并手动填入实例 A 的地址（从 A 的日志中获取 `/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...` 填入 B 的 `bootstrapList`）。

### 场景 C: Bootstrap 跨网络（两台不在同一局域网的机器）

在一台有公网 IP 的机器上作为 bootstrap 节点：

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
        "bootstrapList": []
      }
    }
  }
}
```

其他机器配置：

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "bootstrapList": [
          "/ip4/<BOOTSTRAP-IP>/tcp/4001/p2p/<BOOTSTRAP-PEER-ID>"
        ]
      }
    }
  }
}
```

---

## 测试 5: Agent Tools 功能测试

在 OpenClaw 交互模式（`openclaw` 或 VS Code 中的 Claude Code）下，让 AI agent 调用工具：

### 测试 `p2p_list_peers`

```
请帮我查看当前连接的 P2P 节点
```

**预期行为：** Agent 调用 `p2p_list_peers`，返回已连接节点列表或 "No peers currently connected."。

### 测试 `p2p_send_message`

```
请向 Peer ID 12D3KooW... 发送消息 "你好，这是测试消息"
```

**预期行为：** Agent 调用 `p2p_send_message`，参数为 `{ peerId: "12D3KooW...", message: "你好，这是测试消息" }`，返回 `Message sent to 12D3KooW...`。

### 测试 `p2p_broadcast`

```
请向所有 P2P 节点广播 "hello mesh network"
```

**预期行为：** Agent 调用 `p2p_broadcast`，参数为 `{ topic: "openclaw-mesh", message: "hello mesh network" }`，返回 `Broadcast sent to topic openclaw-mesh`。

---

## 故障排查

### "The dial request has no valid addresses"

**原因：** 目标节点的地址不在 libp2p 的地址簿中。

**解决：**
- 确保两台机器在同一网络（mDNS 模式）
- 检查 bootstrap 列表中的地址格式是否正确（必须包含 `/p2p/<peer-id>`）
- 确认目标 gateway 正在运行

### 节点无法发现彼此（mDNS 模式）

1. **确认同一子网**

   ```bash
   ip addr  # 或 ifconfig
   ```

   两台机器应在同一网段（如 `192.168.1.x`）。

2. **检查防火墙**

   ```bash
   # Linux (ufw)
   sudo ufw disable

   # Linux (firewalld)
   sudo systemctl stop firewalld

   # macOS
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off
   ```

3. **检查 mDNS 服务**

   ```bash
   # Linux
   sudo systemctl status avahi-daemon
   ```

### "Mesh network is not started"

**原因：** 在 gateway 未运行时调用了消息发送。

**解决：** 先启动 gateway：

```bash
openclaw gateway run
```

### 消息发送超时（8 秒）

**原因：** 目标节点不可达。

**检查清单：**
- [ ] 目标 gateway 是否仍在运行？
- [ ] 两台机器是否在同一网络？
- [ ] 是否有防火墙阻断 TCP 连接？
- [ ] Peer ID 是否正确？

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/mesh.ts` | Mesh 网络核心实现 |
| `src/channel.ts` | OpenClaw Channel 集成 |
| `src/agent-tools.ts` | Agent Tools 定义 |
| `src/plugin.ts` | 插件注册入口 |
| `test-mesh-core.mjs` | 独立单元测试脚本 |
| `index.ts` | 插件主入口 |
| `api.ts` | 公开 API 导出 |
