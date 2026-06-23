# libp2p-mesh 配置向导设计

## 目标

为 `libp2p-mesh` 插件增加一个插件自有交互式配置命令，让用户不需要手动打开 `openclaw.json`，就可以完成插件启用、网络模式选择和多入站目标配置。

目标命令：

```bash
openclaw libp2p-mesh configure
```

配置向导最终只写入：

```text
plugins.entries["libp2p-mesh"]
```

不写入：

```text
channels["libp2p-mesh"]
```

## 非目标

- 不接入核心 `openclaw onboard` 主流程作为第一版目标。
- 不实现独立的 `npx libp2p-mesh configure` 配置器。
- 不要求用户手动编辑 `openclaw.json`。
- 不让发送方选择接收方的 channel 或 target。
- 不默认让用户理解底层 libp2p/NAT 参数；向导按场景生成配置。

## 总体方案

插件通过 OpenClaw Plugin API 注册自有 CLI 命令：

```ts
api.registerCli(...)
```

命令运行时读取当前 OpenClaw 配置，构造新的：

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {}
      }
    }
  }
}
```

向导所有输入先保存在内存中。只有用户在 preview 阶段确认：

```text
Apply this config? yes
```

之后才持久化配置。

写入优先使用 OpenClaw runtime config mutation：

```ts
api.runtime.config.mutateConfigFile(...)
```

这样可以复用 OpenClaw 的配置路径、校验、原子写入和写入后行为。若 CLI 注册环境无法使用 runtime mutation，应退回 OpenClaw 官方 config patch 能力，而不是手写配置文件路径。

## 首次配置流程

如果当前配置中不存在：

```text
plugins.entries["libp2p-mesh"]
```

向导显示：

```text
libp2p-mesh is not configured yet.

This wizard will create:
plugins.entries["libp2p-mesh"]

? Continue? yes
```

随后选择使用场景：

```text
? Choose setup mode:
  1. LAN: same WiFi / local network
  2. Cross-network: use bootstrap/relay
  3. Relay node: this machine has a public address
  4. Tools only: no inbound delivery
```

再进入入站投递配置：

```text
? Configure inbound delivery targets?
  1. Add one or more targets
  2. Disable inbound delivery for now
  3. Skip for now
```

语义：

- `Add one or more targets`：生成非空 `inboundTargets`。
- `Disable inbound delivery for now`：写入 `inboundTargets: []`。
- `Skip for now`：不写 `inboundTargets`。

默认生成配置包含：

```json
"deliveryAckTimeoutMs": 15000
```

该字段不在普通向导流程里询问用户。

## 已有配置编辑流程

如果已经存在 `libp2p-mesh` 插件配置，向导进入编辑模式：

```text
Current libp2p-mesh config:
- discovery: mdns
- inbound targets:
  1. feishu-main     feishu / user:ou_xxx
  2. telegram-main   telegram / chat:123456

? What do you want to edit?
  1. Network mode
  2. Inbound delivery targets
  3. Preview and apply
  4. Cancel
```

默认行为是编辑现有配置，而不是直接覆盖。用户可以分别修改网络模式和入站目标，最后统一 preview 并确认写入。

## 网络模式

### LAN：同局域网

适合同一 WiFi / LAN 内的 OpenClaw 网关自动发现。

写入：

```json
{
  "discovery": "mdns",
  "deliveryAckTimeoutMs": 15000
}
```

向导文案：

```text
Selected LAN mode.
This uses mDNS discovery and works when both gateways are on the same local network.
```

### Cross-network：已有 bootstrap/relay

适合不同网络，通过已有 bootstrap 或 relay 节点连接。

问题：

```text
? Bootstrap multiaddr: /ip4/1.2.3.4/tcp/4001/p2p/12D3...
? Add another bootstrap? no

? Relay multiaddr: /ip4/1.2.3.4/tcp/4001/p2p/12D3...
? Add another relay? no
```

写入示例：

```json
{
  "discovery": "bootstrap",
  "bootstrapList": [
    "/ip4/1.2.3.4/tcp/4001/p2p/12D3..."
  ],
  "relayList": [
    "/ip4/1.2.3.4/tcp/4001/p2p/12D3..."
  ],
  "enableNATTraversal": true,
  "deliveryAckTimeoutMs": 15000
}
```

如果用户只填写 bootstrap，不填写 relay，也允许：

```json
{
  "discovery": "bootstrap",
  "bootstrapList": [
    "/ip4/1.2.3.4/tcp/4001/p2p/12D3..."
  ],
  "enableNATTraversal": true,
  "deliveryAckTimeoutMs": 15000
}
```

### Relay node：当前机器作为中继

适合有公网 IP 的云主机或公网机器作为 circuit relay 节点。

问题：

```text
? Listen address: /ip4/0.0.0.0/tcp/4001
? Public announce address: /ip4/<PUBLIC-IP>/tcp/4001
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

Relay 节点不强制配置入站投递目标。用户可以选择 tools only，也可以继续配置 `inboundTargets`。

### Tools only：不接收入站投递

适合只想启用插件工具、发现节点或发送消息，不接收转发到本地 channel。

写入：

```json
{
  "discovery": "mdns",
  "inboundTargets": [],
  "deliveryAckTimeoutMs": 15000
}
```

### 网络模式切换

已有配置中修改网络模式时，向导替换网络相关字段，但保留 `inboundTargets`，除非用户进入入站目标菜单修改它们。

网络模式切换会清理这些旧字段，避免残留配置影响新模式：

```text
discovery
bootstrapList
relayList
listenAddrs
announceAddrs
enableNATTraversal
enableCircuitRelayServer
```

## 多入站目标配置

入站配置以 `inboundTargets` 为主，不再引导用户配置旧的 `inboundChannel/inboundTarget`。

添加 target：

```text
Add inbound target #1

? Channel:
  - feishu
  - telegram
  - Manually enter channel name

? Target: user:ou_xxx

Generated display name:
- id: feishu-main

? Add another target?
  1. Add another
  2. Finish target setup
  3. Cancel target setup
```

### Channel 选择

`channel` 候选来源：

- 优先读取当前 OpenClaw 配置中的 `channels`。
- 展示已配置或已启用的 channel，例如 `feishu`、`telegram`。
- 永远保留 `Manually enter channel name`。

选择手动输入时再问：

```text
? Channel name: custom-channel
```

该列表只说明配置中存在这个 channel，不保证该 channel 一定有可用的 outbound 文本投递能力。真实投递结果仍由 runtime adapter 决定，并通过 delivery ACK 的逐目标结果展示。

### ID 自动生成

`id` 是本地显示名，只用于日志和 ACK 展示，不参与真实投递。向导默认不询问用户。

生成规则：

- 每个 channel 第一次出现：`<channel>-main`
- 同一个 channel 后续出现：`<channel>-2`、`<channel>-3`

示例：

```json
[
  {
    "id": "feishu-main",
    "channel": "feishu",
    "target": "user:ou_xxx"
  },
  {
    "id": "telegram-main",
    "channel": "telegram",
    "target": "chat:123456"
  },
  {
    "id": "feishu-2",
    "channel": "feishu",
    "target": "chat:oc_xxx"
  }
]
```

向导在最终预览里展示生成的 `id`。第一版不默认提供编辑 `id` 的问题；后续可增加 “Edit display names”。

### Target 管理菜单

已有配置编辑时，入站目标菜单为：

```text
Inbound targets:
1. feishu-main     feishu / user:ou_xxx
2. telegram-main   telegram / chat:123456

? What do you want to do?
  1. Add target
  2. Edit target
  3. Remove target
  4. Disable inbound delivery
  5. Back
```

删除或编辑后，向导重新预览完整 `inboundTargets`。

如果用户配置重复的 `channel + target`，向导阻止添加：

```text
This target already exists: feishu / user:ou_xxx
Choose a different target.
```

运行时仍会继续按现有规则去重，向导只是提前避免用户产生困惑。

## 旧配置迁移

如果已有旧字段：

```json
{
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx"
}
```

进入入站目标编辑时，向导提示：

```text
Legacy inbound config found:
- feishu / user:ou_xxx

? Convert it to inboundTargets?
  1. Convert
  2. Keep legacy config
  3. Replace with new targets
```

默认推荐：`Convert`。

转换后：

```json
{
  "inboundTargets": [
    {
      "id": "feishu-main",
      "channel": "feishu",
      "target": "user:ou_xxx"
    }
  ]
}
```

为了避免重复投递，转换或替换后删除旧的：

```text
inboundChannel
inboundTarget
```

如果用户选择 `Keep legacy config`，向导不新增 `inboundTargets`，保留旧行为。

## Skip、Finish 和取消

不是每个字段都提供 `skip` 或 `finish`，而是在步骤层级提供。

主菜单：

```text
? What do you want to edit?
  1. Network mode
  2. Inbound delivery targets
  3. Preview and apply
  4. Cancel
```

首次配置入站目标：

```text
? Configure inbound delivery targets?
  1. Add one or more targets
  2. Disable inbound delivery for now
  3. Skip for now
```

多 target 循环：

```text
? Add another target?
  1. Add another
  2. Finish target setup
  3. Cancel target setup
```

必填字段不提供 `skip`。如果用户留空：

```text
Target is required. Press Ctrl+C to cancel.
```

任意阶段按 `Ctrl+C`：

```text
Configuration cancelled. No changes were written.
```

在用户确认 apply 前，向导不会写配置文件。

## Preview 和写入结果

写入前展示完整 preview：

```text
Preview: plugins.entries["libp2p-mesh"]

{
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

? Apply this config? yes
```

用户选择 `no`：

```text
Configuration cancelled. No changes were written.
```

写入成功：

```text
Config updated.

Restart the gateway to apply changes:
openclaw gateway restart
```

## 示例输出

首次 LAN 配置，两个入站目标：

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

首次配置但禁用入站投递：

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "discovery": "mdns",
          "inboundTargets": [],
          "deliveryAckTimeoutMs": 15000
        }
      }
    }
  }
}
```

## 模块划分

建议实现拆成以下单元：

### CLI 注册模块

负责调用：

```ts
api.registerCli(...)
```

注册 `openclaw libp2p-mesh configure`。

该模块只负责连接 OpenClaw CLI API 和配置向导控制器，不直接拼配置。

### 向导控制器

负责交互流程：

- 判断首次配置或编辑模式。
- 调用网络模式配置流程。
- 调用入站目标配置流程。
- 展示 preview。
- 在用户确认后调用配置写入接口。
- 处理 `Ctrl+C` 和 cancel。

### 配置构建模块

纯函数模块，输入当前配置和用户选择，输出下一份插件 entry。

职责：

- 创建 `plugins.entries["libp2p-mesh"]`。
- 保证 `enabled: true`。
- 合并或替换网络字段。
- 设置 `deliveryAckTimeoutMs: 15000`。
- 生成、编辑、删除 `inboundTargets`。
- 迁移旧 `inboundChannel/inboundTarget`。

### Channel 候选模块

从当前配置读取 channel 候选：

```text
config.channels
```

输出用于 prompt 的 channel 名称列表，并追加手动输入选项。

### 写入模块

封装配置持久化：

- 优先使用 `api.runtime.config.mutateConfigFile(...)`。
- 保证写入路径是 `plugins.entries["libp2p-mesh"]`。
- 不写 `channels["libp2p-mesh"]`。
- 返回写入结果和用户提示。

## 测试策略

### 配置构建函数

覆盖：

- 首次配置会创建 `plugins.entries["libp2p-mesh"]`。
- 写入 `enabled: true`。
- 不写 `channels["libp2p-mesh"]`。
- LAN / cross-network / relay / tools-only 生成正确字段。
- 网络模式切换会清理旧网络字段。
- 默认写 `deliveryAckTimeoutMs: 15000`。

### 多 target 管理

覆盖：

- 读取已有 `channels` 作为候选。
- 支持手动 channel 兜底。
- `id` 自动生成：`<channel>-main`、`<channel>-2`。
- 阻止重复 `channel + target`。
- disable 写 `inboundTargets: []`。
- skip 不写 `inboundTargets`。

### 旧配置迁移

覆盖：

- `inboundChannel/inboundTarget` 转成一个 `inboundTargets`。
- replace 时删除旧字段。
- keep 时不新增 `inboundTargets`。

### 取消安全

覆盖：

- preview 前 `Ctrl+C` 不写。
- preview 时 cancel 不写。
- apply 后才调用 mutation。

### CLI 入口

覆盖：

- `openclaw libp2p-mesh configure` 注册成功。
- dry-run/preview 流程可测试。
- 写入路径是 `plugins.entries["libp2p-mesh"]`。

## 验收标准

- 用户可以通过 `openclaw libp2p-mesh configure` 完成首次配置。
- 用户可以重复运行该命令编辑现有配置。
- 向导支持一个或多个 `inboundTargets`。
- 向导默认写入 `deliveryAckTimeoutMs: 15000`，但不询问用户。
- 向导只写 `plugins.entries["libp2p-mesh"]`，不写 `channels["libp2p-mesh"]`。
- 向导展示配置 preview，并在用户确认后才写入。
- 任意阶段 `Ctrl+C` 不写配置。
- 已有旧 `inboundChannel/inboundTarget` 可迁移到 `inboundTargets`。
- 测试覆盖配置构建、入站目标管理、旧配置迁移、取消安全和 CLI 注册。
