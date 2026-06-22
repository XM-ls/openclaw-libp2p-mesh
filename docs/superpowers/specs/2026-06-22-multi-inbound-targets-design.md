# 多入站目标设计

## 目标

扩展 `libp2p-mesh` 的入站投递能力，让接收方 OpenClaw 实例可以把一条收到的 P2P 用户消息投递到一个或多个本地配置的 channel 会话中。

发送方仍然只通过接收方的 `instanceId` 寻址。发送方不能选择接收方的 channel、target 或具体会话。接收方通过自己的本地插件配置决定消息最终显示在哪里。

## 当前行为

当前插件只支持一个入站显示目标：

```json
{
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveryAckTimeoutMs": 15000
}
```

当 `p2p_send_instance_message` 发送 `user-message` 后，接收方会把文本转发到 `inboundChannel/inboundTarget`，然后返回一个 `delivery-ack`。

本设计会继续保留这个行为，保证现有用户配置升级后仍然可用。

## 新增配置

新增一个可选的 `inboundTargets` 数组：

```json
{
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
  ]
}
```

字段含义：

- `id`：可选的本地显示名，用于日志和 ACK 展示；不参与真实投递。
- `channel`：OpenClaw channel 名称，例如 `feishu`。
- `target`：该 channel 的接收会话，例如 `user:ou_xxx` 或 `chat:123456`。

运行时目标选择规则：

```text
if inboundTargets is present:
  use inboundTargets
else:
  fall back to inboundChannel + inboundTarget
```

也就是说：

- 如果存在 `inboundTargets` 字段，就使用 `inboundTargets`。
- 如果不存在 `inboundTargets` 字段，才回退到旧的 `inboundChannel/inboundTarget`。
- 如果配置了 `inboundTargets: []`，表示没有入站目标，不再回退旧字段。

## 兼容性

旧配置继续有效，行为不变：

```json
{
  "discovery": "mdns",
  "inboundChannel": "feishu",
  "inboundTarget": "user:ou_xxx",
  "deliveryAckTimeoutMs": 15000
}
```

想启用多 channel 投递的用户，只需要新增 `inboundTargets`。

如果旧字段和 `inboundTargets` 同时存在，以 `inboundTargets` 为准，避免同一个消息被重复投递。

## 消息流程

发送方工具契约保持不变：

```json
{
  "instanceId": "receiver-instance-id",
  "message": "今晚来吃饭"
}
```

完整流程：

```text
发送方用户
-> 发送方 Agent 调用 p2p_send_instance_message(instanceId, message)
-> 发送方发出一条 P2P user-message
-> 接收方 InstanceRouter 校验消息
-> 接收方计算有效入站目标
-> 接收方通过 OpenClaw runtime channel outbound adapter 逐个投递
-> 接收方汇总每个目标的投递结果
-> 接收方返回一个 delivery-ack
-> 发送方工具展示每个目标的投递状态
```

P2P 协议层仍然只发送一条 `user-message`。多目标 fan-out 只发生在接收方 OpenClaw 实例内部。

## ACK 结构

扩展 `delivery-ack`，增加逐目标结果：

```json
{
  "ackFor": "message-id",
  "ok": true,
  "deliveredAt": 1710000000000,
  "results": [
    {
      "id": "feishu-main",
      "channel": "feishu",
      "target": "user:ou_xxx",
      "ok": true
    },
    {
      "id": "telegram-main",
      "channel": "telegram",
      "target": "chat:123456",
      "ok": false,
      "error": "Bot has NO availability to this user."
    }
  ]
}
```

`ok` 的定义：

```text
results 中至少有一个目标 ok=true，则整体 ok=true
```

原因是：只要接收方至少有一个主会话框收到消息，就说明消息已经对接收方可见。其他 channel 的失败仍然需要在明细中展示。

为了兼容旧逻辑，`DeliveryAckPayload` 继续保留旧字段：

```ts
inboundChannel?: string;
inboundTarget?: string;
```

多目标 ACK 中，这两个旧字段可以指向第一个成功目标。如果全部失败，则可以指向第一个尝试投递的目标。

## 发送方展示

发送方工具不能只展示“成功 / 部分成功 / 失败”这种摘要。它必须展示每个 target 的具体结果。

至少一个目标投递成功时：

```text
Message delivery results for ypp@xxx:
- feishu-main (feishu / user:ou_xxx): delivered
- telegram-main (telegram / chat:123456): failed: Bot has NO availability to this user.
```

全部目标投递失败时：

```text
Failed to deliver message to ypp@xxx:
- feishu-main (feishu / user:ou_xxx): failed: Bot has NO availability to this user.
- telegram-main (telegram / chat:123456): failed: channel telegram does not expose runtime text delivery
```

工具错误状态规则：

- 至少一个目标成功：不设置 `isError`，但文本中必须展示失败目标明细。
- 全部目标失败：设置 `isError: true`。
- ACK 超时：保持现有超时失败路径。

## 错误处理

目标计算规则：

- `inboundTargets` 缺失：使用旧的 `inboundChannel/inboundTarget`。
- `inboundTargets` 为空数组：返回失败 ACK，错误为 `inbound delivery is not configured`。
- 没有 `inboundTargets`，旧字段也缺失：返回同样的未配置失败 ACK。

逐目标投递规则：

- 某个目标配置不完整：为该目标返回失败结果，并继续处理其他目标。
- channel adapter 不存在或没有 `sendText`：为该目标返回失败结果。
- channel 权限失败，例如 Feishu bot 不可用：为该目标返回失败结果，错误中包含 adapter 返回的摘要。
- 部分失败不会阻止后续目标继续投递。

重复处理规则：

- 使用 `channel + "\0" + target` 对完全相同的目标去重。
- 如果收到重复的 P2P `messageId`，复用缓存的 ACK，不重新投递，避免重复通知用户。

## 数据模型

新增类型：

```ts
export interface InboundTargetConfig {
  id?: string;
  channel: string;
  target: string;
}

export interface DeliveryTargetResult {
  id?: string;
  channel: string;
  target: string;
  ok: boolean;
  error?: string;
}
```

扩展现有类型：

```ts
export interface MeshConfig {
  inboundTargets?: InboundTargetConfig[];
}

export interface DeliveryAckPayload {
  results?: DeliveryTargetResult[];
}
```

现有 `InboundDeliveryAdapter.deliver()` 可以继续保持单目标接口。`InstanceRouter` 负责对每个有效目标调用一次 `deliver()`，再聚合结果。

## 测试策略

单元测试需要覆盖：

- 旧单目标配置仍然只投递一次。
- 非空 `inboundTargets` 会覆盖旧字段。
- 空 `inboundTargets` 返回未配置失败。
- 多个目标全部成功。
- 部分成功部分失败时，整体 `ok: true`，并返回所有目标明细。
- 全部失败时，整体 `ok: false`，并返回所有错误。
- 重复的 channel/target 只投递一次。
- 重复 P2P `messageId` 返回缓存 ACK，不重复投递。
- 发送方工具格式化逐目标结果，并且只有全部失败时才设置 `isError`。

Schema 测试需要覆盖：

- `openclaw.plugin.json` 接受 `inboundTargets`。
- `id` 是可选字段。
- 每个 target 必须包含 `channel` 和 `target`。

## 非目标

- 不允许发送方选择接收方 channel。
- 不允许发送方传入 `target` 或 channel-specific routing hints。
- 插件不自动发现某个 channel 的“主会话”。
- 插件不会自动 fan-out 到所有已配置的 OpenClaw channel；只有接收方在 `inboundTargets` 中显式列出的目标才会收到消息。
