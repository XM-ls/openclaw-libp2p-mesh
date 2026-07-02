# libp2p-mesh setup 入站配置体验优化设计

## 背景

`openclaw libp2p-mesh setup` 当前已经支持从 `openclaw.json` 的既有 `channels` 同步入站目标。同步逻辑会保留已有 `inboundTargets`，并为缺失 channel 逐个询问 target。

当前问题是：同步流程把每个缺失 channel 的 target 作为必填项。用户如果不想把某个 channel 作为 P2P 入站显示目标，只能取消整个向导或填写无意义值。这使“一键配置”变成强制补全，而不是舒适的增量配置。

同时，网络模式菜单里的 `Tools only: no inbound delivery` 混合了两个职责：网络配置和入站投递配置。安装插件后已经具备所有网络能力，setup 只是写入特定拓扑需要的参数；禁用入站投递应归入入站配置阶段，而不是网络模式。

## 目标

- 让 `Sync from configured channels` 支持跳过某个缺失 channel。
- 保持 setup 流程简洁，不引入复杂多选 UI。
- 明确网络配置和入站投递配置的职责边界。
- 改进入站配置文案，让用户理解“收到 P2P 消息后显示在哪里”。
- 保留现有手工添加、编辑、删除入站目标能力。

## 非目标

- 不实现持续后台同步 `channels` 和 `inboundTargets`。
- 不自动猜测 Feishu、Telegram、QQ 等 channel 的 target。
- 不删除已经配置但当前不在 `config.channels` 里的旧目标。
- 不实现批量勾选 channel 的高级选择器。
- 不改变 P2P 协议层、ACK 语义或发送方工具调用方式。

## 设计概览

本次优化保持 setup 向导的整体结构，只调整两个区域：

1. 入站目标同步：对缺失 channel 询问 target 时允许空输入。空输入表示跳过该 channel，不写入配置，也不取消整个向导。
2. 网络模式选择：移除 `Tools only: no inbound delivery`。网络模式只负责发现、bootstrap、relay、announce 地址等网络参数。禁用入站投递保留在入站配置菜单中。

## 网络配置流程

网络配置菜单应表达为网络 setup，而不是插件能力开关。插件安装后已经支持所有网络能力，用户只是在选择要写入哪些环境相关参数。

建议菜单：

```text
Choose network setup:
  1. Use default LAN discovery
  2. Add bootstrap / relay addresses for cross-network use
  3. Configure this machine as a public relay node
```

### Use default LAN discovery

写入：

```json
{
  "discovery": "mdns",
  "deliveryAckTimeoutMs": 15000
}
```

### Add bootstrap / relay addresses for cross-network use

Bootstrap 地址仍然必填，relay 地址可选。可选 relay 的提示应明确可跳过：

```text
Bootstrap multiaddr: /ip4/203.0.113.10/tcp/4001/p2p/12D3...
Add another bootstrap? (y/N)

Relay multiaddr (optional, leave empty to skip):
```

有 relay 时写入：

```json
{
  "discovery": "bootstrap",
  "bootstrapList": [
    "/ip4/203.0.113.10/tcp/4001/p2p/12D3..."
  ],
  "relayList": [
    "/ip4/203.0.113.10/tcp/4001/p2p/12D3..."
  ],
  "enableNATTraversal": true,
  "deliveryAckTimeoutMs": 15000
}
```

无 relay 时省略 `relayList`。

### Configure this machine as a public relay node

保留两个必填地址。`Listen address` 可以提供默认值 `/ip4/0.0.0.0/tcp/4001`，降低输入成本：

```text
Listen address (/ip4/0.0.0.0/tcp/4001): 
Public announce address: /ip4/<PUBLIC-IP>/tcp/4001
```

写入：

```json
{
  "discovery": "bootstrap",
  "listenAddrs": [
    "/ip4/0.0.0.0/tcp/4001"
  ],
  "announceAddrs": [
    "/ip4/<PUBLIC-IP>/tcp/4001"
  ],
  "enableNATTraversal": true,
  "enableCircuitRelayServer": true,
  "deliveryAckTimeoutMs": 15000
}
```

## 入站配置流程

入站配置菜单应围绕用户结果表达：收到 P2P 消息后显示到哪里。

建议首次配置菜单：

```text
Configure where received P2P messages should appear?
  1. Sync from existing channels
  2. Add a target manually
  3. Do not receive P2P messages in local channels
  4. Leave unchanged for now
```

语义：

- `Sync from existing channels`：从当前 `config.channels` 增量补齐缺失 target。
- `Add a target manually`：手动选择或输入 channel，再输入 target。
- `Do not receive P2P messages in local channels`：写入 `inboundTargets: []`，明确禁用入站投递。
- `Leave unchanged for now`：不写入 `inboundTargets`，保留既有行为。

已有配置编辑菜单中的 `Inbound delivery targets` 可以改为：

```text
Where received P2P messages appear
```

## Sync 交互

选择 sync 后，向导先展示摘要，再询问缺失 target：

```text
Already configured:
  - feishu-main     feishu / user:ou_xxx

Channels without inbound targets:
  - telegram
  - qqbot

Leave a target empty to skip that channel.

Target for telegram (leave empty to skip): chat:123456
Target for qqbot (leave empty to skip):
```

完成后展示本次 sync 结果：

```text
Added:
  - telegram-main     telegram / chat:123456

Skipped:
  - qqbot
```

如果所有缺失 channel 都被跳过：

```text
No inbound targets were added.

Skipped:
  - telegram
  - qqbot
```

然后继续回到已有的 preview/apply 流程。

## 数据规则

- 已有 `inboundTargets` 原样保留。
- 输入非空 target 的 channel 追加到 `inboundTargets`。
- 空输入的 channel 不生成配置项。
- 不写入空字符串 target。
- 不删除旧目标。
- 同一个 `channel + target` 组合不重复写入。
- 如果所有缺失 channel 都跳过，`inboundTargets` 保持当前值。
- `Ctrl+C` 或向导取消仍然取消整个配置流程，不写入部分结果。

## 手工添加和编辑

手工添加、编辑 target 仍然要求 target 非空。这里用户已经明确选择要编辑某个目标，空 target 更可能是错误输入，而不是跳过意图。

提示文案建议与 sync 保持一致：

```text
Channel:
  1. feishu
  2. telegram
  3. Manually enter channel name

Target for feishu: user:ou_xxx
```

手动输入 channel 时：

```text
Channel name: qqbot
Target for qqbot: user:<senderId>
```

## 配置写入

向导仍然只写：

```text
plugins.entries["libp2p-mesh"].config
```

不创建或修改：

```text
channels["libp2p-mesh"]
```

网络模式切换只替换网络相关字段，并保留入站配置，除非用户进入入站配置菜单修改它。

入站配置操作只修改 `inboundTargets` 相关字段，并保留网络字段。

## 错误处理

- 没有可同步 channel：提示没有可配置的 channel，不写入新目标。
- channel 名称为空或异常：跳过该 channel。
- sync target 为空：视为用户跳过该 channel。
- 手工添加或编辑 target 为空：继续提示必填。
- 写入失败：报告失败，不假装配置成功。

## 测试策略

更新或新增测试覆盖：

- sync 时空输入会跳过对应 channel。
- sync 空输入不会生成 `{ channel, target: "" }`。
- sync 混合输入时只追加有 target 的 channel。
- sync 跳过全部缺失 channel 时保留已有 `inboundTargets`。
- sync 仍保留已有目标，不覆盖、不删除。
- 手工添加 target 仍然 required。
- 网络模式菜单不再包含 `tools-only`。
- 网络模式切换不再通过 `tools-only` 修改 `inboundTargets`。
- cross-network relay 提示允许空输入跳过。

## 兼容性

已有配置继续有效，包括旧的 `inboundChannel` / `inboundTarget` 迁移逻辑。`inboundTargets: []` 仍然表示明确禁用入站投递，只是用户现在通过入站配置菜单选择该行为，而不是通过网络模式选择。

`SetupMode` 类型如果移除 `tools-only`，相关测试和文档需要同步更新。若为了兼容内部调用暂时保留 `tools-only`，CLI 不应再展示该选项，后续可单独清理类型。
