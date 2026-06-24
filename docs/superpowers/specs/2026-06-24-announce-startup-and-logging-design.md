# instance-announce 启动可靠性与日志设计

## 背景

`libp2p-mesh` 当前通过 `instance-announce` 维护远端 `instance-peer.json`。announce payload 已包含 `instanceId`、`peerId`、`multiaddrs`、`pubkey` 和 `userPublicAttributes`。远端收到 announce 后会更新本地路由表，从而支持按 `instanceId` 或用户公开属性发送消息。

实际双机测试中出现了一个启动期不一致现象：

- ypp 能收到 fhl 的 announce，并在 `instance-peer.json` 中写入 `userPublicAttributes: []`。
- fhl 日志能看到来自 ypp 的签名/DHT 处理日志，但 `instance-peer.json` 中 ypp 记录没有更新到本次启动端口，也没有出现 `userPublicAttributes` 字段。

根因是当前 service 启动顺序为：

```ts
await mesh.start();
await router.start();
```

`mesh.start()` 期间 libp2p 协议 handler 已经可以接收消息，但 `router.start()` 尚未注册 `mesh.onMessage(...)`。如果远端在这个窗口发送 `instance-announce`，mesh 层会收到并处理签名验证日志，但没有 router handler 接管该消息，因此不会调用 `InstancePeerStore.upsertFromAnnounce()`。

## 目标

- 消除 gateway 启动期间早到 `instance-announce` 被丢弃的问题。
- 保持现有 `instance-announce` 协议，不新增 announce ACK 或新的底层消息类型。
- 让 `instance-peer.json.userPublicAttributes` 在双向发现时稳定写入。
- 为 announce 增加可控日志，默认可观察摘要，必要时显式打印完整 payload。
- 避免默认日志泄露用户公开属性、地址列表或实例身份的完整 JSON。

## 非目标

- 不做周期性 announce。
- 不做 mesh 层消息 buffer / replay。
- 不新增中心化目录、全网属性搜索或属性 gossip。
- 不改变 `userPublicAttributes` 的数据模型。
- 不改变 `USER.md` 只读边界。
- 不把 announce 日志配置放入普通 `setup` 主流程。
- 不默认打印完整 announce JSON。

## 设计一：启动生命周期拆分

当前 `router.start()` 同时负责两件事：

1. 注册 router 消息和 peer connect handlers。
2. 对当前已连接 peers 发送 announce。

这两个职责需要拆开。新的 router 生命周期为：

```ts
router.attachHandlers();
await mesh.start();
await router.announceToConnectedPeers();
```

其中：

- `attachHandlers()` 只注册 `mesh.onMessage(...)` 和 `mesh.onPeerConnect(...)`。
- `announceToConnectedPeers()` 只负责对当前 connected peers 发送 announce。
- `start()` 保留兼容，内部等价于：

```ts
router.attachHandlers();
await router.announceToConnectedPeers();
```

这样现有测试或其他内部调用如果仍使用 `router.start()`，行为保持兼容；但插件 service 启动路径使用更可靠的新顺序。

### plugin 启动顺序

`src/plugin.ts` 的 service start 应调整为：

```ts
router.attachHandlers();
attachInboundHandlers();
await mesh.start();
await router.announceToConnectedPeers();
```

这里 `attachInboundHandlers()` 表示当前 direct / broadcast inbound handler 的注册逻辑也应在 `mesh.start()` 前完成。这样不仅 `instance-announce` 不会漏，启动期早到的 direct / broadcast 也不会因为 plugin handler 尚未注册而丢失。

### 幂等性

`attachHandlers()` 必须幂等：

- 多次调用不能重复注册 handlers。
- `stop()` 仍负责清理所有 unsubscribe。
- `stop()` 后再次 `attachHandlers()` 可以重新注册。

建议在 router 内维护状态：

```ts
let handlersAttached = false;
```

如果已 attached，直接返回。

## 设计二：announce 日志

当前 announce 日志只打印：

```text
Sent instance announce to <peerId> (<instanceId>)
Instance mapping updated: <instanceId> -> <peerId>
```

这能说明有发送或更新，但不能确认 payload 是否包含属性，也不能确认地址数量。新增日志应默认打印摘要，而不是完整 JSON。

### 配置项

新增插件配置：

```json
{
  "announceLogDetail": "summary"
}
```

取值：

```ts
"off" | "summary" | "payload"
```

含义：

- `off`：不打印新增的 announce 内容日志，只保留现有基础日志。
- `summary`：默认值。打印 instance、peer、地址数量、属性数量和 changed 状态。
- `payload`：打印完整 announce JSON。仅用于本地调试。

该配置属于插件配置，应写入：

```text
plugins.entries["libp2p-mesh"].config.announceLogDetail
```

不写入 `channels`。

### 默认 summary 日志

发送 announce 时：

```text
[libp2p-mesh] Sent instance announce to <peerId> instance=<instanceId> addrs=<n> attrs=<n>
```

接收 announce 并处理后：

```text
[libp2p-mesh] Received instance announce from <peerId> instance=<instanceId> addrs=<n> attrs=<n> changed=<true|false>
```

当 `changed=true` 时，仍保留现有 mapping 更新日志：

```text
[libp2p-mesh] Instance mapping updated: <instanceId> -> <peerId>
```

重复且内容未变化的 announce 不应提升为额外 noisy `info` 日志。`summary` 的接收日志可与 `changed` 信息合并，避免多条重复日志。

### payload 日志

当 `announceLogDetail === "payload"` 时，额外打印完整 payload：

```text
[libp2p-mesh] Instance announce payload sent to <peerId>: {...}
[libp2p-mesh] Instance announce payload received from <peerId>: {...}
```

完整 payload 可能包含：

- `userPublicAttributes`
- `multiaddrs`
- `pubkey`
- `instanceId`
- `instanceName`

因此 `payload` 不作为默认值，也不放进普通 setup 主流程。

## debug CLI

新增独立调试命令：

```bash
openclaw libp2p-mesh debug
```

该命令管理调试相关配置，不进入普通 `setup` 主流程。

交互流程：

```text
libp2p-mesh debug settings

Current announce log detail: summary

Choose action:
  1. Set announce log detail
  2. Preview current debug config
  3. Finish
```

设置日志级别：

```text
Announce log detail:
  1. Summary (recommended)
  2. Off
  3. Full payload
```

如果选择 `Full payload`，必须二次确认：

```text
Full payload logs may include public user attributes, multiaddrs, pubkey, and instance identity.
Use this only for local debugging. Continue? (y/N)
```

保存后写入：

```json
{
  "plugins": {
    "entries": {
      "libp2p-mesh": {
        "enabled": true,
        "config": {
          "announceLogDetail": "payload"
        }
      }
    }
  }
}
```

完成提示：

```text
Saved debug config.
Restart the gateway for the new announce log detail to take effect.
```

## 数据流

修复后的启动数据流：

```text
gateway service start
  ↓
router.attachHandlers()
  ↓
plugin attach direct/broadcast inbound handlers
  ↓
mesh.start()
  ↓
libp2p peer connects / remote announce arrives
  ↓
router handler already registered, handleAnnounce()
  ↓
InstancePeerStore.upsertFromAnnounce()
  ↓
instance-peer.json includes userPublicAttributes
  ↓
router.announceToConnectedPeers()
```

该流程修复的是“早到 announce 无 handler”的 race，不依赖周期重发。

## 错误处理

- 如果 `attachHandlers()` 重复调用，应安全 no-op。
- 如果 `mesh.start()` 失败，已注册 handlers 应在 service stop 或失败清理路径中释放。
- 如果 `announceToConnectedPeers()` 失败，只记录 per-peer warning，不阻止 gateway ready。
- 如果 `announceLogDetail` 是未知值，按 `summary` 处理。
- 如果 payload 日志序列化失败，降级打印 summary，不影响 announce 发送或接收。

## 测试要求

- `instance-router` 单测覆盖：
  - `attachHandlers()` 在 mesh start 前注册 handler。
  - 早到 `instance-announce` 能调用 `upsertFromAnnounce()`。
  - `attachHandlers()` 多次调用不重复注册。
  - `start()` 保持兼容行为。
  - `announceLogDetail` 的 `off`、`summary`、`payload` 输出差异。

- `plugin` 或 service 启动测试覆盖：
  - plugin service start 调用顺序为 attach handlers -> mesh.start -> announce connected peers。

- debug CLI 测试覆盖：
  - 注册 `openclaw libp2p-mesh debug`。
  - 选择 `summary` / `off` / `payload` 写入插件配置。
  - `payload` 需要二次确认。
  - Ctrl+C 或取消不写入。

- smoke test 覆盖：
  - 双 router 模拟场景中，一端 mesh start 期间收到 announce，不丢失 mapping。

## 兼容性

- 现有 `router.start()` 继续可用。
- 现有 `instance-announce` payload 不变。
- 现有 `instance-peer.json` schema 不变。
- 现有 `setup` 主流程不增加 debug 问题。
- 默认日志比当前多摘要信息，但不打印完整 JSON。

## 风险与缓解

- 风险：提前注册 handlers 后，如果 mesh 尚未启动，handler 内调用 mesh 状态可能失败。
  - 缓解：handler 只在收到消息或 peer connect 后运行；这些事件只会在 mesh 启动后触发。

- 风险：重复注册导致 announce 重复发送。
  - 缓解：`attachHandlers()` 幂等，测试覆盖重复调用。

- 风险：payload 日志泄露公开属性和地址。
  - 缓解：默认 `summary`，`payload` 只能通过 debug 命令显式开启，并二次确认。

- 风险：debug CLI 增加配置入口复杂度。
  - 缓解：独立于 `setup`，只管理调试配置，不影响首次安装体验。

