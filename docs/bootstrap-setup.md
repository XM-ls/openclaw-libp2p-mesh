# 跨网络 Bootstrap 配置指南

> 本指南说明如何配置 libp2p-mesh 插件，使位于不同网络（不同 WiFi、不同运营商 NAT、不同城市）的 OpenClaw 实例之间能够互相发现和通信。

---

## 1. 为什么需要 Bootstrap

默认的 `discovery: "mdns"` 依赖 mDNS/Bonjour 广播，仅在同一局域网（同一 WiFi / 同一子网）内有效。当两台计算机位于不同网络时，mDNS 报文无法穿透路由器/NAT，节点之间无法自动发现对方。

Bootstrap 模式通过**静态预配置的节点地址列表**解决此问题：每个节点启动后主动连接列表中的已知节点，从而跨越网络边界建立 P2P 连接。

```
网络 A（如家庭 WiFi）                网络 B（如公司网络）              VPS / 公网节点
┌──────────────┐                    ┌──────────────┐               ┌──────────────┐
│  Computer A  │ ←── 公网 / NAT ──→ │  Computer B  │ ←─── 公网 ──→ │  Bootstrap   │
│  Peer: A     │                    │  Peer: B     │               │  Peer: S     │
└──────────────┘                    └──────────────┘               └──────────────┘
     A 先连 S ──→ 通过 S 发现 B  ←── B 先连 S
     或 A 直接连 B（端口映射后）
```

### 三种跨网络方案对比

| 方案 | 需要的资源 | 延迟 | 说明 |
|------|-----------|------|------|
| **端口映射直连** | 在路由器上配置端口转发 | 最低 | A 和 B 直接通信，需要其中一方（或双方）有公网 IP 并开放端口 |
| **VPS 中转（Bootstrap 节点）** | 一台有公网 IP 的 VPS | 中 | VPS 作为 bootstrap 节点，所有客户端先连 VPS，再通过 VPS 互相发现 |
| **VPS 中转 + 中继** | 同上 | 较高 | VPS 作为 relay 节点，在双方无法直连时通过 VPS 转发流量 |

---

## 2. 获取每台电脑的公网可达地址

### 2.1 确认公网 IP

在每台需要参与跨网络通信的计算机上执行：

```bash
# Linux / macOS
curl -s ifconfig.me
# 或
curl -s ip.sb

# Windows (PowerShell)
(Invoke-WebRequest -Uri "https://ifconfig.me").Content
```

记录每台机器的公网 IP（如 `203.0.113.10`）。

> **注意：** 如果使用家庭宽带且运营商分配的是 NAT 内网 IP（如 `100.x.x.x`、`10.x.x.x`、`172.16-31.x.x`），则无法直接做端口映射。此时需要：
> 1. 联系运营商申请公网 IP（通常免费）
> 2. 或者使用 VPS 中转方案

### 2.2 路由器端口映射（Port Forwarding）

如果某台机器有公网 IP，在路由器管理界面将外部端口映射到该机器的内网 IP 和端口。

**示例：** 路由器 WAN 端口 `4001` → 内网 `192.168.1.42:4001`

| 路由器品牌 | 配置路径参考 |
|-----------|-------------|
| TP-Link | 转发规则 → 虚拟服务器 |
| 小米/红米 | 高级设置 → 端口转发 |
| 华硕 | NAT 设置 → 端口转发 |
| OpenWrt | 网络 → 防火墙 → 端口转发 |

**推荐固定端口：** 在 `config.json` 中将 `listenAddrs` 设为固定端口，避免端口变化导致映射失效：

```json
{
  "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"]
}
```

### 2.3 VPS 中转方案

如果没有公网 IP，使用一台有公网 IP 的 VPS 作为 bootstrap 节点。

**VPS 上部署步骤：**

```bash
# 1. 在 VPS 上安装 OpenClaw（与客户端相同版本）
openclaw install openclaw-libp2p-mesh

# 2. 配置 VPS 使用固定端口和 bootstrap 模式
# 见第 5 节配置示例

# 3. 确保 VPS 防火墙放行端口
sudo ufw allow 4001/tcp

# 4. 启动 VPS 上的 OpenClaw gateway
openclaw gateway run
```

VPS 启动后，从日志中获取其 Peer ID，然后分发给所有客户端。

---

## 3. 获取 libp2p Peer ID

Peer ID 是节点的唯一标识符，格式类似 `12D3KooWRYyHaWzL8n7i5Z8zZ8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8`（以 `12D3KooW` 开头的 Base36 编码字符串）。

### 3.1 从 Gateway 日志中获取

启动 OpenClaw gateway 后，在日志中搜索：

```
[libp2p-mesh] Node started. Peer ID: 12D3KooWRYyHaWzL8n7i5Z8zZ8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8
[libp2p-mesh] Listening on: /ip4/192.168.1.42/tcp/4001/p2p/12D3KooW...
```

日志中会同时打印 **Peer ID** 和 **监听多地址**（multiaddr），两者都包含 Peer ID。

### 3.2 通过 CLI 获取

```bash
openclaw channels status --probe
```

查找 `libp2p-mesh` 频道部分，其中会显示 Peer ID。

### 3.3 通过 API 获取（程序化）

```typescript
const mesh = createMeshNetwork({ config, logger });
await mesh.start();
const peerId = mesh.getLocalPeerId();
console.log("My Peer ID:", peerId);
```

### 3.4 Peer ID 持久化

Peer ID 默认持久化到本地磁盘：

```
~/.openclaw/libp2p/peer-id.json          # 默认路径
# 或
$OPENCLAW_STATE_DIR/libp2p/peer-id.json  # 如果设置了 OPENCLAW_STATE_DIR 环境变量
```

可以通过 `peerIdPath` 配置项自定义路径。只要此文件存在，每次启动都会复用同一个 Peer ID，不会重新生成。

---

## 4. 构造 Bootstrap 多地址格式

### 4.1 多地址（Multiaddr）格式

libp2p 使用多地址格式标识节点地址，bootstrap 节点地址的完整格式为：

```
/ip4/<公网IP>/tcp/<端口>/p2p/<PeerID>
```

**示例：**

```
/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRYyHaWzL8n7i5Z8zZ8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8
```

### 4.2 各字段说明

| 字段 | 说明 | 示例值 |
|------|------|--------|
| `/ip4/` | IPv4 地址协议 | `/ip4/203.0.113.10` |
| `/tcp/` | TCP 传输协议 | `/tcp/4001` |
| `/p2p/` | libp2p Peer ID | `/p2p/12D3KooW...` |

> **提示：** 可以直接复制 gateway 日志中打印的完整多地址（包含 Peer ID），无需手动拼接。

### 4.3 完整地址示例

**场景 A：A 电脑有公网 IP，B 电脑通过 A 连接**

```
# A 的地址（203.0.113.10 为 A 的公网 IP，4001 为 A 的监听端口）
/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWA...
```

**场景 B：使用 VPS 作为 bootstrap 节点**

```
# VPS 的地址
/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWS...
```

**场景 C：多个 bootstrap 节点**

```
/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWA...
/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWS...
```

---

## 5. 在 OpenClaw 中配置 Bootstrap

### 5.1 配置文件位置

OpenClaw 的全局配置文件通常位于：

- **Linux/macOS:** `~/.openclaw/openclaw.json`
- **Windows:** `%APPDATA%\openclaw\openclaw.json`

### 5.2 基础 Bootstrap 配置

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
        "bootstrapList": [
          "/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWRYyHaWzL8n7i5Z8zZ8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8"
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

### 5.3 使用 VPS 中转（推荐生产环境）

**VPS 节点配置：**（VPS 上也安装并配置 libp2p-mesh）

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
  },
  "channels": {
    "libp2p-mesh": {
      "enabled": true
    }
  }
}
```

> VPS 节点的 `bootstrapList` 留空即可——它自己就是其他节点要连接的 bootstrap 节点。

**客户端 A 配置：**

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/0"],
        "bootstrapList": [
          "/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWSERVER..."
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

**客户端 B 配置：**（与 A 相同，bootstrapList 指向同一 VPS）

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/0"],
        "bootstrapList": [
          "/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWSERVER..."
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

### 5.4 多节点 Mesh（>2 个节点）

当有 3 个或更多节点时，建议每个客户端配置所有已知节点的地址，提高连通性：

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
        "bootstrapList": [
          "/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWSERVER...",
          "/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWCOMPUTER-A..."
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

### 5.5 配置项速查

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `discovery` | `string` | `"mdns"` | 设为 `"bootstrap"` 启用跨网络模式 |
| `listenAddrs` | `string[]` | `["/ip4/0.0.0.0/tcp/0"]` | 监听地址；跨网络建议用固定端口如 `tcp/4001` |
| `bootstrapList` | `string[]` | `[]` | 已知节点的多地址列表 |
| `enableWebSocket` | `boolean` | `false` | 在极端 NAT 环境下可开启 WebSocket 辅助 |
| `peerIdPath` | `string` | 自动 | Peer ID 文件持久化路径 |

---

## 6. 防火墙和端口映射注意事项

### 6.1 需要开放的端口

- **libp2p TCP 端口**：`listenAddrs` 中配置的端口（如 `4001`）
- **如果开启了 WebSocket**：还需开放 WebSocket 端口

### 6.2 各平台防火墙配置

**Linux (ufw):**

```bash
# 开放 4001 端口
sudo ufw allow 4001/tcp

# 验证
sudo ufw status
```

**Linux (firewalld):**

```bash
sudo firewall-cmd --add-port=4001/tcp --permanent
sudo firewall-cmd --reload
```

**macOS:**

```bash
# 查看防火墙状态
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# 临时关闭防火墙测试
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off

# 如需允许特定程序，通过系统偏好设置 → 安全性与隐私 → 防火墙 → 防火墙选项
```

**Windows:**

```
控制面板 → Windows Defender 防火墙 → 高级设置 → 入站规则 → 新建规则
  → 端口 → TCP → 特定本地端口: 4001 → 允许连接
```

### 6.3 路由器 / NAT 注意事项

| 问题 | 解决方案 |
|------|---------|
| 没有公网 IP | 使用 VPS 中转方案 |
| 运营商 NAT（CGNAT） | 联系运营商申请公网 IP，或使用 VPS 中转 |
| 路由器没有端口映射界面 | 使用 DMZ 功能将整台机器暴露，或换用 UPnP 支持的路由器 |
| 多层 NAT（光猫 + 路由器） | 需在光猫和路由器上都做端口映射 |
| 动态公网 IP | 使用 DDNS 服务（如 No-IP、DynDNS），定期更新 bootstrap 地址 |

### 6.4 云服务器安全组

如果使用云服务器（AWS、GCP、阿里云等），还需在云平台控制台的**安全组 / 防火墙规则**中放行端口：

```
入站规则: TCP 端口 4001, 来源 0.0.0.0/0（或限定为客户端 IP 段）
```

---

## 7. 验证跨网络连通性

### 7.1 启动并检查日志

在每台机器上启动 gateway：

```bash
openclaw gateway run
```

**预期输出：**

```
[libp2p-mesh] Using bootstrap discovery (1 node(s))
[libp2p-mesh] Node started. Peer ID: 12D3KooWCOMPUTER_A...
[libp2p-mesh] Listening on: /ip4/0.0.0.0/tcp/4001/p2p/12D3KooWCOMPUTER_A...
```

连接成功后会看到：

```
[libp2p-mesh] Peer connected: 12D3KooWCOMPUTER_B...
```

### 7.2 检查连接状态

```bash
openclaw channels status --probe
```

确认 `libp2p-mesh` 频道显示已连接，且能列出远程 Peer ID。

### 7.3 发送测试消息

**从 Computer A 发送到 Computer B：**

```bash
openclaw message send libp2p-mesh <COMPUTER-B-PEER-ID> "Hello across networks!"
```

**预期日志（Computer B 上）：**

```
[libp2p-mesh] Direct message from 12D3KooWCOMPUTER_A: Hello across networks!
```

### 7.4 验证广播

```bash
# 在 Computer A 上广播
openclaw message broadcast libp2p-mesh "Broadcast test"
```

所有已连接的节点都应能收到该广播消息。

### 7.5 排查连通性问题

**检查清单：**

1. **确认 bootstrap 地址格式正确**
   ```
   # 正确格式
   /ip4/203.0.113.10/tcp/4001/p2p/12D3KooW...
   ```

2. **确认端口可达**
   ```bash
   # 从客户端测试到 bootstrap 节点的端口连通性
   nc -zv 203.0.113.10 4001
   # 或
   telnet 203.0.113.10 4001
   ```

3. **确认 Peer ID 匹配**
   - bootstrap 地址中的 Peer ID 必须与 VPS / 目标节点的实际 Peer ID 完全一致
   - 如果 VPS 重新部署，Peer ID 会变化，需要更新 bootstrapList

4. **检查 VPS 上的 libp2p 节点是否在运行**
   ```bash
   # 在 VPS 上
   openclaw channels status --probe
   ```

5. **查看详细日志**
   ```bash
   # 设置 DEBUG 级别日志以查看更多信息
   DEBUG=* openclaw gateway run
   ```

### 7.6 使用 WebSocket 作为备选

在无法开放 TCP 端口的极端环境下，可启用 WebSocket 传输：

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "enableWebSocket": true,
        "listenAddrs": [
          "/ip4/0.0.0.0/tcp/4001",
          "/ip4/0.0.0.0/ws/4002"
        ],
        "bootstrapList": [
          "/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWS..."
        ]
      }
    }
  }
}
```

WebSocket 地址格式：`/ip4/<IP>/ws/<PORT>/p2p/<PEER-ID>`

---

## 8. 完整配置示例

### 场景：家庭电脑 + 笔记本电脑 + VPS 中转

**VPS (198.51.100.5) — 作为 bootstrap 和 relay：**

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
  },
  "channels": {
    "libp2p-mesh": {
      "enabled": true
    }
  }
}
```

**家庭电脑 (有公网 IP 203.0.113.10)：**

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
        "bootstrapList": [
          "/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWVSERVER...",
          "/ip4/203.0.113.10/tcp/4001/p2p/12D3KooWHOME..."
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

**笔记本电脑（在咖啡厅 NAT 内）：**

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "bootstrap",
        "listenAddrs": ["/ip4/0.0.0.0/tcp/0"],
        "bootstrapList": [
          "/ip4/198.51.100.5/tcp/4001/p2p/12D3KooWVSERVER..."
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

---

## 附录：libp2p 多地址速查

| 格式 | 说明 |
|------|------|
| `/ip4/0.0.0.0/tcp/4001` | 监听所有 IPv4 接口的 TCP 4001 端口 |
| `/ip4/192.168.1.42/tcp/4001` | 监听特定内网 IP |
| `/ip4/203.0.113.10/tcp/4001/p2p/12D3KooW...` | 完整的节点标识地址 |
| `/ip4/0.0.0.0/ws/4002` | WebSocket 监听（需要 `enableWebSocket: true`） |
| `/ip6/::/tcp/4001` | IPv6 监听 |
| `/dns/example.com/tcp/4001/p2p/12D3KooW...` | 使用域名（需 DNS 解析到正确 IP） |
