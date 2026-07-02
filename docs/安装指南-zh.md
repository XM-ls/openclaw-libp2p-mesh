# libp2p-mesh 安装与使用指南

`libp2p-mesh` 是 OpenClaw 的 P2P 组网插件，用来让不同 OpenClaw 实例之间直接通信，不依赖中心服务器。

这份指南面向普通用户，重点说明：

- 怎么安装
- 安装后要不要手动配置
- 怎么让消息投递到本机的多个 channel
- 常见的使用入口和排障方法

---

## 1. 安装前要求

安装前确认以下条件：

- OpenClaw 版本不低于 `2026.3.24`
- Node.js 版本不低于 `22`
- 如果你只打算在同一局域网内使用，两个设备需要在同一个 Wi-Fi 或同一个网段

如果你还打算跨网络连接，后面可以额外配置 bootstrap 或 relay 入口地址。

---

## 2. 安装插件

### 推荐方式：通过 OpenClaw CLI 安装

```bash
openclaw plugins install libp2p-mesh
```

这是最简单的安装方式。安装完成后，OpenClaw 会识别这个插件并在后续启动时加载它。

### 备用方式：手动安装 npm 包

如果 CLI 安装不可用，可以手动安装到 OpenClaw 管理的 npm 目录：

```bash
cd ~/.openclaw/npm
npm install libp2p-mesh
```

然后刷新插件注册表：

```bash
openclaw plugins registry --refresh
```

---

## 3. 安装后展示流程

安装完成后，建议重启 gateway：

```bash
openclaw gateway restart
```

重启后，通常会看到这些变化：

1. gateway 启动日志里出现 `libp2p-mesh` 的启动信息
2. 日志里会显示本机 Peer ID
3. 如果已经成功生成实例身份，会显示 Instance ID
4. 如果 NAT traversal 已启用，会显示 identify / AutoNAT / UPnP / relay / DCUtR 等状态
5. 如果你安装时没有删掉默认提示词区块，`AGENTS.md` 也会自动更新

示例日志大概长这样：

```text
[libp2p-mesh] Service started. Peer ID: 12D3KooW...
[libp2p-mesh] Instance Identity: alice-mac@MCowBQYDK2Vw....
[libp2p-mesh] NAT traversal services: identify, autoNAT, upnp, circuitRelay, dcutr
```

你可以把它理解成：

- `Service started` 表示插件已真正跑起来
- `Peer ID` 是 libp2p 节点身份
- `Instance Identity` 是 OpenClaw 实例身份
- `NAT traversal services` 表示网络能力已启用

安装后插件会自动做两件事：

- 在 `~/.openclaw/workspace/AGENTS.md` 中安装或更新它管理的提示词区块
- 在你没有显式配置网络项时，自动使用默认网络参数

也就是说，大多数情况下，你**不需要**先手工编辑 `openclaw.json`。

---

## 4. 默认可直接使用的行为

如果你只是想在同一局域网内先跑起来，很多情况下安装后就可以直接使用。

默认情况下，插件会自动使用：

- mDNS 局域网发现
- NAT traversal
- DHT
- 默认的 delivery ACK 超时

这意味着：

- 同一局域网内的 OpenClaw 实例可以自动发现彼此
- 默认不用你手动填网络参数

如果你不确定要不要额外配置，可以先装完直接重启 gateway 试用。

---

## 5. 第一次使用时的建议流程

### 场景 A：只在局域网内测试

你只需要：

1. 两台机器都安装 `libp2p-mesh`
2. 两台机器都重启 OpenClaw gateway
3. 等待几秒让它们互相发现

通常不需要额外配置。

### 场景 B：跨网络连接

如果两台机器不在同一个局域网，建议使用 setup 向导补充 bootstrap 或 relay 入口地址。

```bash
openclaw libp2p-mesh setup
```

这个向导适合：

- 跨网络连接
- 固定端口
- relay 节点
- 入站目标配置

---

## 6. 配置网络

如果你需要高级网络配置，运行：

```bash
openclaw libp2p-mesh setup
```

这个向导会写入 `plugins.entries["libp2p-mesh"].config`，不会去写 `channels["libp2p-mesh"]`。

配置向导会把网络配置和入站投递分开处理。

插件安装后默认已经启用 mDNS、DHT、NAT traversal、relay transport 和 hole punching。网络配置不是让你选择某一种网络模式，而是按需补充入口信息：

- 添加 bootstrap / relay 地址用于跨网络连接。
- 将当前机器配置为公网 relay 节点。
- 没有入口地址时保持默认自动发现能力不变。

入站投递配置决定收到 P2P 消息后显示到哪里：

- 从现有 channels 同步。
- 手动添加一个 target。
- 不把 P2P 消息投递到本地 channel。
- 暂时保持不变。

从现有 channels 同步时，某个 channel 的 target 可以直接留空，表示跳过该 channel。

如果你只是普通用户，通常不需要改网络配置；安装后重启 gateway 即可先试用。

---

## 7. 配置入站消息投递

这是 `libp2p-mesh` 最重要的使用场景之一。

接收方实例决定收到的 P2P 消息最终显示到哪里。你可以把消息投递到一个或多个本地 OpenClaw channel target，例如：

- 飞书
- QQ
- Telegram

### 推荐做法

现在的插件默认会把 OpenClaw 已经添加好的 channel 作为可接收消息的入口，你只需要为这些 channel 手动配置对应的 `target`。

现在的 setup 向导支持：

- 从当前已经存在的 `channels` 同步入站目标
- 保留你已经配置好的 `inboundTargets`
- 只让你为新增 channel 补一次 `target`

命令：

```bash
openclaw libp2p-mesh setup
```

如果你后来新增了一个 channel，再运行一次 `setup`，它会继续帮你补齐缺失项，不会覆盖已有配置。

### 配置流程

如果你第一次配置入站消息投递，可以按这个顺序来：

1. 先确认你本机已经添加好了要接收消息的 OpenClaw channel，例如飞书、QQ 或 Telegram。
2. 运行 `openclaw libp2p-mesh setup`。
3. 在 `Configure where received P2P messages should appear?` 里选择 `Sync from existing channels`。
4. 向导会按你当前已经添加好的 channel 逐个询问 `Target for <channel> (leave empty to skip)`。
5. 依次填好要接收 P2P 消息的 channel target；不想配置的 channel 直接留空跳过。
6. 预览配置，确认 `inboundTargets` 已经列出每个 channel 的 target。
7. 确认应用后重启 gateway，让新的配置生效。

如果你只是临时不想接收消息，可以直接把 `inboundTargets` 设为空数组，不需要配置具体 target。

### 向导交互示例

```text
$ openclaw libp2p-mesh setup

libp2p-mesh is not configured yet.

This wizard will create:
plugins.entries["libp2p-mesh"]

Continue? Yes
Network discovery is enabled automatically.
Bootstrap multiaddr (leave empty to skip):
Relay multiaddr (leave empty to skip):
Configure where received P2P messages should appear? Sync from existing channels
Already configured:
  none

Channels without inbound targets:
  - feishu
  - qqbot

Leave a target empty to skip that channel.
Target for feishu (leave empty to skip): user:ou_xxx
Target for qqbot (leave empty to skip): user:123456
Added:
  - feishu-main     feishu / user:ou_xxx
  - qqbot-main     qqbot / user:123456
Preview: plugins.entries["libp2p-mesh"]

{
  "enabled": true,
  "config": {
    "deliveryAckTimeoutMs": 15000,
    "inboundTargets": [
      {
        "channel": "feishu",
        "target": "user:ou_xxx"
      },
      {
        "channel": "qqbot",
        "target": "user:123456"
      }
    ]
  }
}
Apply this config? Yes
```

### 入站目标示例

```json
{
  "id": "feishu-main",
  "channel": "feishu",
  "target": "user:ou_xxx"
}
```

QQ 单聊示例：

```json
{
  "id": "qqbot-main",
  "channel": "qqbot",
  "target": "user:<senderId>"
}
```

### 关闭入站投递

如果你暂时只想用工具能力，不想接收消息，可以把入站目标设为空数组。

---

## 8. 在 channel 中给别人发消息

可以先在 channel 中先查看当前连接节点的属性，然后再根据方式一或者方式二发送消息给其他的用户。
channel 中可直接使用的消息模板：

```text
列出当前节点的属性
```
下面是一个返回结果示例：

```text
Discovered OpenClaw instances: 2

1. alice-mac@AQIDBAUGBweI.7a3f9e2b
   peerId: 12D3KooW...
   instanceName: alice-mac
   connected: true
   userPublicAttributes:
     kind: tag
     value: P2P
     label: P2P
     source: USER.md
     kind: structured
     key: project
     value: openclaw
     label: project: openclaw
     source: profile
   localLabels:
     kind: structured
     key: group
     value: 实验室
     label: group: 实验室
     source: local

2. bob-mac@AQIDBAUGBweI.1a2b3c4d
   peerId: 12D3KooX...
   instanceName: bob-mac
   connected: true
   userPublicAttributes: none
   localLabels: none
```

### 方式一：按 OpenClaw Instance ID 发

更常见的是按 OpenClaw 的 `instanceId` 发消息。你不需要自己找对方的 libp2p `Peer ID`，插件会在实例发现后负责把消息路由到对应 peer。

这也是你在 OpenClaw 的 channel 里最常用的方式。

channel 中可直接使用的消息模板：

```text
请给实例 `<instanceId>` 发消息：`<消息内容>`
```

示例：

```text
请给实例 `alice-mac@MCowBQYDK2Vw...` 发消息：今晚 8 点开会，记得上线。
```

### 方式二：按属性找人群发

如果你想给某一类人发消息，可以用公开属性或本地标签先筛选，再发给匹配到的实例。

例如：

- `group=实验室`
- `project=openclaw`
- `tag:P2P`
- `#P2P`

这类能力适合群发，不适合点对点私聊。

channel 中可直接使用的消息模板：

```text
请给公开属性为group=实验室的节点发送消息：`<消息内容>`
```

示例：

```text
请给本地标签和公开属性都为project=openclaw的节点发送消息：今晚 8 点开会，记得上线。
```

---

## 9. 用户公开属性与本地标签

`libp2p-mesh` 还支持两类“按属性找人”的能力：

### 用户公开属性

公开属性来源于：

- `USER.md` 中的 tag
- `profile` 工具配置的结构化属性

运行：

```bash
openclaw libp2p-mesh profile
```

适合你想公开表示：

- group
- project
- role
- skill

### 交互示例

```text
$ openclaw libp2p-mesh profile

Read-only USER.md tags:
  1. P2P (USER.md tag, read-only)
  2. OpenClaw (USER.md tag, read-only)

Structured profile attributes:
  none

What do you want to do? Add structured attribute
Attribute category: Project
Attribute value: openclaw

Read-only USER.md tags:
  1. P2P (USER.md tag, read-only)
  2. OpenClaw (USER.md tag, read-only)

Structured profile attributes:
  1. project: openclaw

What do you want to do? Preview and finish
Preview: public attributes

Read-only USER.md tags:
  1. P2P (USER.md tag, read-only)
  2. OpenClaw (USER.md tag, read-only)

Structured profile attributes to save:
  1. project: openclaw

Save profile attributes? Yes
```

### 本地标签

本地标签是你在自己机器上给远端实例做的私有分类，不会广播给对方。

运行：

```bash
openclaw libp2p-mesh labels
```

适合你在本机私下管理：

- 谁属于哪个项目组
- 谁是常联系对象
- 谁该优先接收哪类消息

### 交互示例

```text
$ openclaw libp2p-mesh labels

Discovered instances:
  1. alice-mac alice-mac@AQIDBAUGBweI.7a3f9e2b (public attributes: P2P, project: openclaw)
  2. bob-mac bob-mac@AQIDBAUGBweI.1a2b3c4d (public attributes: none)

Instance to label: alice-mac alice-mac@AQIDBAUGBweI.7a3f9e2b (public attributes: P2P, project: openclaw)
Selected instance: alice-mac alice-mac@AQIDBAUGBweI.7a3f9e2b (public attributes: P2P, project: openclaw)

Local labels:
  none

What do you want to do? Add local label
Label category: Group
Label value: 实验室

Selected instance: alice-mac alice-mac@AQIDBAUGBweI.7a3f9e2b (public attributes: P2P, project: openclaw)

Local labels:
  1. group: 实验室

What do you want to do? Save and finish
```

---

## 10. 排查与调试

### 查看网络信息

查看 gateway 启动日志，确认 Peer ID、实例 ID、连接状态和监听地址。

如果你是在排查消息或发现问题，可以直接运行：

```bash
openclaw libp2p-mesh debug
```

`debug` 命令会显示 announce 日志级别，默认推荐保持 `summary`。只有排查发现、地址或属性广播问题时，才临时切到更详细的输出。

### 重新安装提示词区块

如果 `AGENTS.md` 里的插件提示词区块被误删，可以修复：

```bash
openclaw libp2p-mesh prompt install
```

---

## 11. 常见问题

### 1. 安装后没有发现对方

先检查：

- 两边是否都重启了 gateway
- 是否在同一个局域网
- 跨网络场景是否配置了 bootstrap 或 relay
- 防火墙是否拦截了连接

### 2. 消息发出去了，但对方没显示

检查接收方是否配置了入站目标：

- `inboundTargets` 是否存在
- 对应 channel 是否启用
- `target` 是否正确

如果你后来新增了 channel，可以重新执行：

```bash
openclaw libp2p-mesh setup
```

然后同步补齐缺失的入站目标。

### 3. `USER.md` 里的属性没有马上生效

这是正常的。`USER.md` 的公开 tag 是异步提取的，可能要等后续完整的 `instance-announce` 广播后才会出现在发现结果里。


---

## 12. 建议的最简使用方式

如果你想先快速跑起来，按这个顺序做就够了：

1. 安装插件

```bash
openclaw plugins install libp2p-mesh
```

2. 重启 gateway

```bash
openclaw gateway restart
```

3. 如果是局域网环境，先直接测试

4. 如果需要跨网络或多入站目标，再运行：

```bash
openclaw libp2p-mesh setup
```

5. 如需公开属性或本地标签，再运行：

```bash
openclaw libp2p-mesh profile
openclaw libp2p-mesh labels
```

---
