# libp2p-mesh Instance 路由设计

日期：2026-06-12

## 目标

扩展现有 `libp2p-mesh` OpenClaw 插件，让 OpenClaw 实例之间可以通过 `instanceId` 互相寻址，而不是要求用户或 Agent 直接使用 libp2p 的 `peerId`。

第一版目标场景是飞书：

1. 用户 A 在飞书中告诉 botA：给某个目标 `instanceId` 发消息。
2. botA 所属 OpenClaw 的 Agent 调用插件工具。
3. 插件从本地 instance peer 映射表中解析 `instanceId -> peerId`。
4. 消息通过 libp2p 发送到 botB 所属 OpenClaw 实例。
5. botB 把收到的 P2P 入站消息转发到自己配置的飞书目标。
6. 只有当 botB 成功完成飞书 channel 转发后，才向 botA 返回 ACK。
7. botA 把投递结果返回给用户 A。

一个 OpenClaw 实例对应一个用户。插件不负责把“用户 B”这类自然语言名字解析成实例；用户或 Agent 需要明确使用远端 `instanceId`。

## 现有项目上下文

当前插件已经具备：

- `src/mesh.ts` 中的 libp2p 生命周期管理。
- 通过 mDNS、bootstrap、DHT、NAT traversal 和 relay 进行 peer discovery。
- 本地持久化 `InstanceIdentity`，路径为 `~/.openclaw/libp2p/instance-id.json`。
- 带 `instanceId`、`pubkey` 和 `signature` 的签名 P2P 消息。
- `src/dht-registry.ts` 中的 DHT pubkey 注册和查询。
- `index.ts` 和 `src/plugin.ts` 中的 OpenClaw 插件注册。
- `src/plugin.ts` 中通过 `api.registerTool()` 注册 Agent 工具。
- `src/agent-tools.ts` 中的现有工具，包括 `p2p_send_message(peerId, message)`。
- `src/channel.ts` 中的 `libp2p-mesh` channel 表面。

当前缺少的是 instance 路由层：自动交换并持久化 `instanceId <-> peerId` 映射，然后把它暴露为 Agent 可直接使用的一等工具。

## 配置

用户不需要在 `openclaw.json` 中逐个配置工具。插件启用后会自动注册工具。

第一版用户配置：

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
    "libp2p-mesh": {
      "enabled": true
    }
  }
}
```

新增配置项：

- `inboundChannel`：用于显示 P2P 入站用户消息的 channel，例如 `"feishu"`。
- `inboundTarget`：本实例用户接收入站消息的 channel target，例如 `user:ou_xxx`、`chat:oc_xxx`、`open_id:ou_xxx`、裸 `ou_xxx` 或 `oc_xxx`，以及现有 `feishu:` / `lark:` provider 前缀格式。
- `deliveryAckTimeoutMs`：`p2p_send_instance_message` 等待远端 `delivery-ack` 的时间。默认值：`15000`。

内部状态路径：

- 优先使用 `$OPENCLAW_STATE_DIR/libp2p/instance-peer.json`。
- 否则使用 `~/.openclaw/libp2p/instance-peer.json`。

该路径不是用户配置项。测试可以通过内部构造参数或测试环境设置覆盖它。

## 架构

在 `MeshNetwork` 和 Agent tools 之间新增 `InstanceRouter` 层。

职责：

- 向已连接 peers 发送本实例的路由公告。
- 接收远端路由公告并更新 instance peer 映射表。
- 解析 `instanceId -> peerId`。
- 通过 `instanceId` 发送用户消息。
- 跟踪出站用户消息的 pending ACK。
- 把入站用户消息转发到配置的 OpenClaw channel target。
- 在 channel 转发成功或失败后，把 delivery ACK 返回给发送方。

建议模块：

- `src/instance-peer-store.ts`：负责 `instance-peer.json` 的持久化读写。
- `src/instance-router.ts`：负责 announce、resolve、ACK 跟踪和入站 `user-message` 处理。
- `src/inbound-delivery.ts`：适配现有 OpenClaw message-send 能力。
- `src/agent-tools.ts`：新增 instance 级工具，同时保留现有 peer 级工具。

入站 delivery adapter 应隐藏第一版的具体投递机制。当前它等价于：

```bash
openclaw message send \
  --channel feishu \
  --target user:ou_xxx \
  --message "<text>"
```

如果后续 OpenClaw 提供类似 `deliverInboundMessage()` 的插件 API，adapter 可以切换到该 API，而无需改变 router 或工具契约。

## 消息类型

扩展 `P2PMessage.type`，新增：

- `instance-announce`：路由公告。
- `user-message`：从一个用户实例发送到另一个用户实例的业务消息。
- `delivery-ack`：针对某条 `user-message` 的投递结果。

`instance-announce` payload 字段：

```json
{
  "instanceId": "alice@abc.123",
  "peerId": "12D3KooW...",
  "instanceName": "alice-mac",
  "multiaddrs": ["/ip4/192.168.1.2/tcp/4001/p2p/12D3..."],
  "pubkey": "base64url...",
  "announcedAt": 1781190000000
}
```

`user-message` payload 字段：

```json
{
  "messageId": "uuid",
  "fromInstanceId": "alice@abc.123",
  "toInstanceId": "bob@def.456",
  "text": "今晚出来吃饭",
  "metadata": {
    "allowAgentAutoReply": true,
    "replyToInstanceId": "alice@abc.123",
    "replyTool": "p2p_send_instance_message"
  }
}
```

`delivery-ack` payload 字段：

```json
{
  "ackFor": "uuid",
  "ok": true,
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveredAt": 1781190000000
}
```

失败 ACK 使用 `ok: false`，并包含错误摘要：

```json
{
  "ackFor": "uuid",
  "ok": false,
  "error": "inbound delivery is not configured",
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveredAt": 1781190000000
}
```

消息继续使用现有签名字段：`instanceId`、`pubkey` 和 `signature`。

## Announce 流程

第一版不做周期性 announce。

Announce 行为：

1. 本地 mesh 启动完成后，发送一次本实例的 `instance-announce`。
2. 每次 `peer:connect` 时，向该 peer 发送一次本实例的 `instance-announce`。
3. 收到远端 `instance-announce` 时，更新本地 peer 映射表。
4. 如果本实例还没有向该 peer 发送过 announce，则回发一次本机 announce。
5. 不按固定 interval 重发未变化的公告。

这样可以在启动、重连和首次接触时填充映射表，同时避免日志被周期公告刷屏。

## Instance Peer 映射表

`instance-peer.json` 结构：

```json
{
  "version": 1,
  "updatedAt": 1781190000000,
  "instances": {
    "alice@abc.123": {
      "instanceId": "alice@abc.123",
      "peerId": "12D3KooW...",
      "instanceName": "alice-mac",
      "multiaddrs": ["/ip4/192.168.1.2/tcp/4001/p2p/12D3..."],
      "pubkey": "base64url...",
      "lastSeenAt": 1781190000000,
      "lastAnnouncedAt": 1781190000000,
      "source": "announce"
    }
  }
}
```

持久化规则：

- 第一次发现远端实例后自动创建文件。
- 使用原子写入：先写临时文件，再 rename。
- 如果同一个 `instanceId` 公告了新的 `peerId`，替换旧 peer 并更新时间戳。
- 如果同一个 `peerId` 出现在多个 `instanceId` 下，保留全部记录并打印 warning。
- 第一版不自动删除旧记录；通过 `lastSeenAt` 表示新鲜度。
- 如果启动时 JSON 文件损坏，将其重命名为 `.corrupt-<timestamp>`，并创建新的空表。

## Agent 工具

保留现有工具：

- `p2p_send_message(peerId, message)`
- `p2p_broadcast(topic, message)`
- `p2p_list_peers()`
- `p2p_get_instance_identity()`
- `p2p_get_network_info()`

新增工具：

### `p2p_list_instances()`

列出 `instance-peer.json` 中已知的实例。

返回详情包括：

- `instanceId`
- `peerId`
- `instanceName`
- `lastSeenAt`
- `connected`

### `p2p_resolve_instance({ instanceId })`

查询单个 `instanceId`。

如果找到，返回当前路由详情。如果没找到，返回 `isError: true`，错误信息类似：

`Instance <id> has not been discovered. Ask the user to confirm the remote gateway is running and connected to the same P2P network.`

### `p2p_send_instance_message({ instanceId, message })`

Agent 应优先使用的主工具。

行为：

1. 从 `instance-peer.json` 解析 `instanceId`。
2. 向解析出的 `peerId` 发送签名 `user-message`。
3. 最多等待 `deliveryAckTimeoutMs` 时间接收 `delivery-ack`。
4. 只有当远端实例报告已成功转发到其配置的 inbound channel 时，才返回成功。

成功返回结构：

```json
{
  "sent": true,
  "delivered": true,
  "toInstanceId": "bob@def.456",
  "toPeerId": "12D3KooW...",
  "ackMessageId": "uuid",
  "inboundChannel": "feishu"
}
```

失败模式返回 `isError: true`，并包含结构化 details。

## OpenClaw 注册

OpenClaw 通过现有 package/plugin 元数据发现插件：

- `package.json.openclaw.extensions` 指向 `./dist/index.js`。
- `index.ts` 导出 `definePluginEntry()` 入口。
- `src/plugin.ts` 注册 service、channel、tools 和 hooks。
- `openclaw.plugin.json` 描述插件元数据和 contracts。

需要更新的元数据：

- 新增 config schema 字段：
  - `inboundChannel`
  - `inboundTarget`
  - `deliveryAckTimeoutMs`
- 新增 contract tools：
  - `p2p_list_instances`
  - `p2p_resolve_instance`
  - `p2p_send_instance_message`

用户不需要在 `openclaw.json` 中添加工具列表。只要启用插件，`registerLibp2pMesh(api)` 就会调用 `api.registerTool()`，把工具暴露给 OpenClaw/Agent。

## 入站投递与自动回复

入站 P2P `user-message` 处理：

1. 校验消息格式和签名。
2. 确认消息目标是本地 `instanceId`。
3. 将文本转发到 `config.inboundChannel` 和 `config.inboundTarget`。
4. 如果转发成功，发送 `delivery-ack { ok: true }`。
5. 如果转发失败，发送 `delivery-ack { ok: false, error }`。

自动回复策略：

- 插件不判断是否自动调用 Agent 回复。
- 插件传递 `allowAgentAutoReply`、`replyToInstanceId` 和 `replyTool` 等 metadata。
- OpenClaw 或接收端 Agent 可以基于这些 metadata 决定是否回复。
- 第一版不能引入 Agent 之间自动互相回复的循环。

## 错误处理

- 未知 `instanceId`：发送前直接返回工具错误。
- P2P 发送失败：返回工具错误，包含目标 `peerId` 和错误摘要。
- ACK 超时：返回工具错误 `ACK timeout after <deliveryAckTimeoutMs>ms`。
- 接收端缺少 `inboundChannel` 或 `inboundTarget`：接收端返回失败 ACK。
- 入站 channel 转发失败：接收端返回失败 ACK，包含 channel、target 和错误摘要。
- 签名无效或 payload 格式错误：拒绝处理，不更新状态，并打印 warning。
- 重复 `user-message`：不重复转发到飞书；如果已有上一次投递结果，则重复发送同一个 ACK。

## 日志

关键运行状态必须在 `info` 级别可见。

需要调整现有日志预期：

- `peer:connect` 应使用 `info` 级别，而不是 `debug`。
- `peer:disconnect` 应使用 `info` 级别，而不是 `debug`。
- 第一次发送 `instance-announce` 应使用 `info` 级别。
- 第一次接收远端 announce 并更新映射表应使用 `info` 级别。
- 内容没有变化的重复 announce 不应在 `info` 级别打印；可以静默或使用 `debug`。
- relay pre-dial 尝试、DHT 内部事件、重复消息去重等底层细节继续使用 `debug`。

README 排障部分应说明：用户在正常终端输出中应能看到 peer connection 和 instance mapping update 日志。

## 测试

### 单元测试

`InstancePeerStore`：

- 文件不存在时创建空表。
- 读取已有表。
- 原子写入更新。
- 备份损坏 JSON。
- 同一 `instanceId` 下替换 `peerId`。
- 一个 `peerId` 映射到多个 `instanceId` 时打印 warning。

`InstanceRouter`：

- 启动和 peer connect 时发送 announce。
- 收到远端 announce 时更新 store。
- 对未变化的重复 announce 不打印嘈杂的 info 日志。
- 正确解析已知和未知实例。
- 正确处理 ACK pending map 的成功和超时。
- 对入站 `user-message` 去重。

工具：

- `p2p_list_instances` 返回已知记录。
- `p2p_resolve_instance` 成功和失败都正确。
- `p2p_send_instance_message` 在收到 ACK 时返回 delivered success，在超时或失败 ACK 时返回 error。

### 本地集成测试

用不同 state dir 启动两个 mesh 实例：

- 验证双方都创建 `libp2p/instance-peer.json`。
- 验证双方都学习到对方的 `instanceId` 和 `peerId`。
- 通过 `instanceId` 从 A 发送到 B。
- B 使用 mock inbound delivery adapter 模拟转发成功。
- 验证 A 收到 delivered ACK。

### NAT/Docker 回归

扩展现有 `test/nat-docker` 配置：

- 增加 `inboundChannel`、`inboundTarget` 和 `deliveryAckTimeoutMs`。
- 验证 relay/NAT 路径下 announce 和 user-message 都能正常投递。

## 文档更新

更新 README：

- 安装和 `openclaw.json` 配置示例，包含 `inboundChannel`、`inboundTarget` 和 `deliveryAckTimeoutMs`。
- 说明 `instance-peer.json` 会自动生成，不需要用户配置。
- 说明工具由插件自动注册，用户不需要在 `openclaw.json` 中列出工具。
- 飞书示例：
  - 用户要求 botA 给明确的 `instanceId` 发送消息。
  - Agent 调用 `p2p_send_instance_message`。
  - botB 转发到 Feishu target。
  - botA 在远端 channel 转发成功后收到 ACK。
- 排障说明：正常日志应在 info 级别显示 peer connection 和 instance mapping update。

## 不在第一版范围内

- 自然语言人名或联系人别名解析。
- 用户维护的通讯录。
- 周期性路由公告。
- 自动删除过期 instance 路由。
- 插件自行决定 Agent 自动回复。
- 要求用户在 `openclaw.json` 中配置插件工具。
- 除非现有 message-send 能力不足，否则不修改 OpenClaw core SDK。
