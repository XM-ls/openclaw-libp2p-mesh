# libp2p-mesh 自动网络发现与入口地址配置设计

## 背景

当前 `openclaw libp2p-mesh setup` 仍然把网络配置表达成“选择网络模式”：

```text
Choose network setup:
  1. Use default LAN discovery
  2. Add bootstrap / relay addresses for cross-network use
  3. Configure this machine as a public relay node
```

当用户选择 cross-network 后，向导会强制要求填写 `Bootstrap multiaddr`。如果用户只是想查看或尝试配置，但暂时没有 bootstrap 地址，就会被卡在必填输入里。

这个体验和插件的真实目标不一致。用户安装插件后，应该默认就启用可用的发现与连接能力；setup 不应该让用户选择互斥的“网络模式”，而应该只让用户补充外部网络需要的入口地址或公网 relay 节点参数。

## 目标

- 安装插件后默认启用可用网络发现与连接能力，不要求用户选择默认模式。
- 将 setup 中的“网络模式选择”改成“网络入口地址配置”。
- `Bootstrap multiaddr` 和 `Relay multiaddr` 都允许空输入跳过。
- 已有配置再次运行 setup 时，完成一个配置动作后自动展示 preview 并询问是否应用，不再要求用户手动选择 `Preview and apply`。
- 入站 target 编辑子菜单用 `Finish editing` 表达“结束编辑并进入 preview”。
- 保持配置文件简洁：不写空数组，不写无意义的默认字段。

## 非目标

- 不实现没有任何 bootstrap/relay/DHT 入口时的公网凭空发现。跨公网仍然需要至少一个可达入口。
- 不自动生成公共 bootstrap 节点。
- 不改变 P2P 消息协议、ACK 语义或 agent tools。
- 不改造其他 channel 插件。
- 不要求用户手动选择默认 LAN / DHT / NAT 模式。

## 默认网络语义

插件运行时默认进入自动网络发现状态。概念上等价于：

```json
{
  "enableMDNS": true,
  "enableDHT": true,
  "enableNATTraversal": true,
  "enableCircuitRelay": true,
  "enableDCUtR": true,
  "deliveryAckTimeoutMs": 15000
}
```

配置文件不需要显式写出这些默认值。缺省配置仍然应保持简洁，例如只写：

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "inboundTargets": [
            {
              "id": "feishu-main",
              "channel": "feishu",
              "target": "user:ou_xxx"
            }
          ]
        }
      }
    }
  }
}
```

运行时会自动补齐网络默认能力。

## 运行时发现行为

`discovery` 不应再作为 setup 主交互里的互斥模式。运行时应按能力组合处理：

- 默认启用 mDNS，用于局域网发现。
- 默认启用 DHT 服务，用于 DHT 能力和 pubkey registry。
- 如果 `bootstrapList` 非空，额外启用 bootstrap discovery。
- 如果 `relayList` 非空，额外尝试 relay reservation。
- NAT traversal、Circuit Relay transport、DCUtR 按现有默认继续启用。

旧字段 `discovery` 继续兼容读取：

- `discovery: "mdns"` 不关闭 DHT/NAT 默认能力。
- `discovery: "bootstrap"` 不再要求 `bootstrapList` 必填；没有 bootstrap 地址时只是不启用 bootstrap discovery。
- `discovery: "dht"` 继续允许用户表达 DHT 发现意图，但不应关闭 mDNS。

文档和新向导不再鼓励用户手写或选择 `discovery`。

## 首次配置流程

首次运行：

```text
$ openclaw libp2p-mesh setup

libp2p-mesh is not configured yet.

This wizard will create:
plugins.entries["libp2p-mesh"]

Continue? (Y/n)
```

确认后直接进入网络入口地址配置，不再选择网络模式：

```text
Network discovery is enabled automatically.
mDNS, DHT, NAT traversal, relay transport, and hole punching are enabled by default.

Bootstrap multiaddr (optional, leave empty to skip):
Relay multiaddr (optional, leave empty to skip):
```

如果两个输入都留空，不写入 `bootstrapList` 或 `relayList`。

随后进入入站投递配置：

```text
Configure where received P2P messages should appear?
  1. Sync from existing channels
  2. Add a target manually
  3. Do not receive P2P messages in local channels
  4. Leave unchanged for now
```

完成后自动展示 preview：

```text
Preview: plugins.entries["libp2p-mesh"]

{
  "enabled": true,
  "config": {
    "inboundTargets": [
      {
        "id": "feishu-main",
        "channel": "feishu",
        "target": "user:ou_xxx"
      }
    ]
  }
}

Apply this config? (Y/n)
```

## 已有配置流程

已有配置时，先展示当前摘要：

```text
Current libp2p-mesh config:
- network discovery: automatic
- bootstrap peers: none
- relay peers: none
- public relay node: disabled
- inbound targets:
  1. feishu-main     feishu / user:ou_xxx
```

然后选择一个配置动作：

```text
What do you want to configure?
  1. Sync inbound targets from channels
  2. Network entry addresses
  3. Public relay-node settings
  4. Where received P2P messages appear
  5. Cancel
```

不再提供 `Preview and apply` 菜单项。用户完成所选动作后，向导自动展示 preview 并询问是否应用。

## 网络入口地址配置

选择 `Network entry addresses` 后：

```text
Bootstrap multiaddr (optional, leave empty to keep unchanged):
Relay multiaddr (optional, leave empty to keep unchanged):
```

语义：

- 首次配置时，空输入表示跳过，不写入字段。
- 已有配置时，空输入表示保持现有字段不变。
- 如果用户输入新地址，则替换对应列表。
- 如果用户需要清空已有地址，应提供明确选项，例如：

```text
Clear existing bootstrap peers? (y/N)
Clear existing relay peers? (y/N)
```

这避免空输入同时承担“保持不变”和“清空”的双重含义。

写入示例：

```json
{
  "bootstrapList": [
    "/ip4/203.0.113.10/tcp/4001/p2p/12D3..."
  ],
  "relayList": [
    "/ip4/203.0.113.10/tcp/4001/p2p/12D3..."
  ]
}
```

不再需要写：

```json
{
  "discovery": "bootstrap"
}
```

## 公网 relay 节点配置

公网 relay 节点是单独的高级配置动作：

```text
Enable this machine as a public relay node? (y/N)
```

如果选择 `n`，写入或保留：

```json
{
  "enableCircuitRelayServer": false
}
```

如果选择 `y`：

```text
Listen address (/ip4/0.0.0.0/tcp/4001):
Public announce address (optional, leave empty to skip):
```

写入：

```json
{
  "listenAddrs": ["/ip4/0.0.0.0/tcp/4001"],
  "enableCircuitRelayServer": true
}
```

如果填写 public announce address，则额外写入：

```json
{
  "announceAddrs": ["/ip4/203.0.113.10/tcp/4001"]
}
```

## 入站 target 编辑

入站 target 编辑子菜单不再使用 `Back`：

```text
What do you want to do?
  1. Add target
  2. Edit target
  3. Remove target
  4. Disable inbound delivery
  5. Finish editing
```

`Finish editing` 的语义是结束当前入站编辑动作，然后进入自动 preview。

如果用户没有做任何修改就选择 `Finish editing`，preview 展示当前配置不变，用户可以选择不应用。

## Preview 与写入规则

所有配置动作完成后都自动执行：

```text
Preview: plugins.entries["libp2p-mesh"]
...
Apply this config? (Y/n)
```

如果用户选择 `n`：

- 不写入任何配置。
- 退出向导。

如果用户选择 `y`：

- 只写入 `plugins.entries["libp2p-mesh"].config`。
- 不写入 `channels["libp2p-mesh"]`。
- 不写入空 `bootstrapList`、空 `relayList`、空 `announceAddrs`。
- 保留未被当前动作修改的配置字段。

## 当前类似问题检查

当前 setup 中类似“必填导致卡住”的输入包括：

- cross-network 的 `Bootstrap multiaddr`：应改为可选入口地址。
- relay node 的 `Public announce address`：应改为可选。
- relay node 的 `Listen address`：可以保留必填，但必须有默认值 `/ip4/0.0.0.0/tcp/4001`，直接回车即可使用默认值。
- 手动添加或编辑入站 target：仍然必填，因为用户已经明确选择添加或编辑 target。
- sync inbound targets：已经支持空输入跳过，应保留。

## 测试策略

新增或更新测试覆盖：

- 首次配置不再调用网络模式选择。
- 首次配置允许 bootstrap 和 relay 都空输入，并且不写入空数组。
- 已有配置的主菜单不再包含 `Preview and apply`。
- 已有配置选择 `Network entry addresses` 后，空输入保持现有地址不变。
- 输入 bootstrap / relay 地址后写入对应列表，但不写 `discovery: "bootstrap"`。
- 公网 relay 节点配置允许 public announce address 留空。
- 入站 target 编辑菜单显示 `Finish editing`。
- 任意动作完成后自动 preview，并通过 `Apply this config?` 控制是否写入。
- 运行时在默认配置下同时启用 mDNS、DHT、NAT traversal 和 relay transport。
- `bootstrapList` 非空时额外启用 bootstrap discovery。

## 文档更新

README 和中文安装指南需要同步：

- 不再说用户选择网络模式。
- 改成“默认自动网络发现，setup 只补充网络入口地址”。
- 明确 bootstrap/relay 地址是可选项。
- 明确没有 bootstrap/relay 入口时，公网发现不能凭空发生。
- 移除 `Preview and apply` 菜单项示例。
