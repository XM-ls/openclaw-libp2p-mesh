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

如果你还打算跨网络连接，后面需要额外配置 bootstrap 或 relay。

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

## 3. 安装后要做什么

安装完成后，建议重启 gateway：

```bash
openclaw gateway restart
```

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

如果两台机器不在同一个局域网，建议使用 setup 向导配置 bootstrap 或 relay。

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

常见网络模式：

- `LAN`：同一局域网
- `Cross-network`：通过 bootstrap 或 relay 连接
- `Relay node`：当前机器作为中继节点
- `Tools only`：只需要工具能力，不接收消息

如果你只是普通用户，通常只需要保留默认网络设置，不必改。

---

## 7. 配置入站消息投递

这是 `libp2p-mesh` 最重要的使用场景之一。

接收方实例决定收到的 P2P 消息最终显示到哪里。你可以把消息投递到一个或多个本地 OpenClaw channel target，例如：

- 飞书
- QQ
- Telegram

### 推荐做法

现在的 setup 向导支持：

- 从当前已经存在的 `channels` 同步入站目标
- 保留你已经配置好的 `inboundTargets`
- 只让你为新增 channel 补一次 `target`

命令：

```bash
openclaw libp2p-mesh setup
```

如果你后来新增了一个 channel，再运行一次 `setup`，它会继续帮你补齐缺失项，不会覆盖已有配置。

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

## 8. 消息怎么发

### 按 Peer ID 直发

如果你知道对方的 libp2p `Peer ID`，可以直接发送：

```bash
openclaw message send libp2p-mesh <PEER-ID> "你好"
```

### 按 OpenClaw Instance ID 发

更常见的是按 OpenClaw 的 `instanceId` 发消息。你不需要自己找对方的 libp2p `Peer ID`，插件会在实例发现后负责把消息路由到对应 peer。

在对端正确上线并完成实例发现后，发送流程会自动走 `p2p_send_instance_message` 这条路径。

### 广播

如果你需要在 mesh 内广播消息，可以使用广播能力。广播适合做发现、通知或调试，不适合发私密内容。

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

---

## 10. 排查与调试

### 查看网络信息

查看 gateway 启动日志，确认 Peer ID、实例 ID、连接状态和监听地址。

如果你是在排查消息或发现问题，可以直接运行：

```bash
openclaw libp2p-mesh debug
```

### 查看 announce 日志

```bash
openclaw libp2p-mesh debug
```

默认推荐保持 `summary`，只在排查时临时切换到更详细的输出。

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

### 4. 我不想手动改 `openclaw.json`

正常情况下不需要。安装、网络配置、入站目标配置都可以通过 `setup` / `profile` / `labels` / `debug` 这些命令完成。

---

## 12. 建议的最简使用方式

如果你想先快速跑起来，按这个顺序做就够了：

1. 安装插件

```bash
openclaw install libp2p-mesh
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

## 13. 一句话总结

安装 `libp2p-mesh` 后，普通用户通常只需要：

- 安装插件
- 重启 gateway
- 必要时运行一次 `setup` 补齐网络或入站目标

多数默认场景不需要手动编辑配置文件。
