# libp2p-mesh 入站目标同步设计

## 目标

为 `libp2p-mesh` 增加一个“按当前已存在 channel 增量补齐入站目标”的配置体验，让用户不再需要逐个完整配置所有入站目标。

核心目标是：

- 安装后或重新配置时，自动扫描当前 OpenClaw 已存在的 `channels`
- 对已经配置过的 `inboundTargets` 直接复用原值
- 对新出现、尚未配置的 channel，只要求用户输入该 channel 对应的 `target`
- 不覆盖用户已经配置好的 `inboundTargets`

这里的“一键配置”指的是“一次进入向导，按 channel 逐项补齐缺失 target”，不是持续自动同步。

## 非目标

- 不做 `channels` 到 `inboundTargets` 的持续后台同步
- 不自动删除 `inboundTargets` 中已经不存在于 `config.channels` 的旧项
- 不改造每个 channel 插件去暴露统一的“默认 target”接口
- 不尝试从任意 channel 配置中猜测 `target`
- 不改变现有 P2P 协议层的发送方式
- 不让发送方选择接收方 channel

## 当前行为

当前 `libp2p-mesh` 已经支持多入站目标配置，但编辑流程仍然是“按 target 维度手工增删改”。

现有能力包括：

- `setup-config.ts` 可以读取 `config.channels`
- `setup-wizard.ts` 已经能编辑 `inboundTargets`
- `inboundTargets` 作为接收侧配置，决定消息投递到哪些 OpenClaw channel target

当前问题是：

- 用户在有多个 channel 时，需要重复选择 channel 并输入 target
- 新增 channel 后，用户不知道应该如何高效把它纳入入站投递
- 现有流程没有“按当前 channel 快照增量补齐”的入口

## 设计概览

在 `openclaw libp2p-mesh setup` 中新增一个“从当前 channels 同步入站目标”的动作。

该动作的语义是：

1. 读取当前 OpenClaw 配置里的 `channels`
2. 排除 `libp2p-mesh` 自身
3. 以 channel 名称为单位遍历
4. 如果某个 channel 已经在 `inboundTargets` 中出现过，则视为已配置，直接保留
5. 如果某个 channel 尚未配置，则只向用户询问一次该 channel 的 `target`
6. 将新补齐的条目追加到 `inboundTargets`

这意味着：

- 旧配置不会被覆盖
- 新增 channel 只补缺失项
- 不存在的 channel 不会自动删除旧目标

## 用户流程

### 首次配置

当用户第一次进入向导时，可以看到一个新的入口：

```text
? Configure inbound delivery targets?
  1. Sync from configured channels
  2. Add target manually
  3. Disable inbound delivery for now
  4. Skip for now
```

推荐用户选择 `Sync from configured channels`。

向导行为：

- 列出当前已存在的 channel
- 对已经有对应 target 的 channel 直接跳过
- 对缺失的 channel 只询问 target
- 最后展示预览并确认写入

### 后续新增 channel

如果用户后来新增了一个 channel，例如 `qqbot`，再次运行 `openclaw libp2p-mesh setup` 时，可以再次执行同一个同步动作。

同步时：

- `feishu` 仍然保留已有 target
- `telegram` 仍然保留已有 target
- 新增的 `qqbot` 只要求输入一次 target

这样用户不需要重新配置全部入站目标，只补新增项即可。

## 同步规则

### 1. 候选 channel 的来源

候选列表来自：

```ts
Object.keys(config.channels ?? {})
```

同步时排除：

- `libp2p-mesh`

如果某个 channel 在 OpenClaw 里存在，就认为它是候选入站目标。

### 2. 已存在 target 的处理

如果 `inboundTargets` 中已经存在某个 channel 的条目，则认为该 channel 已配置完成：

- 保留原有 target
- 不要求用户重新输入
- 不重排、不重建、不覆盖

如果同一个 channel 存在多个 `inboundTargets` 条目，sync 也不做合并，只要该 channel 已经有至少一个 target，就视为已覆盖。

### 3. 缺失 target 的处理

如果某个 channel 不在 `inboundTargets` 中出现，则对该 channel 询问一次 target。

交互语义：

- 提示语包含 channel 名称
- 允许用户输入对应 target
- 若用户取消整个向导，则不写入任何变更

### 4. 去重规则

同步后保持以下去重约束：

- 同一个 `channel + target` 组合不重复写入
- 已存在的条目不重复追加

### 5. 删除规则

同步动作**不删除**旧目标。

原因：

- 旧目标可能是用户主动保留的
- channel 可能暂时被移除，之后又会恢复
- 自动删除会破坏用户预期

删除和编辑仍然由现有的手工编辑动作负责。

## 预填语义

这里的“预填”只指两种情况：

1. 复用 `inboundTargets` 里已经存在的 target
2. 为新 channel 生成待填写项，并把 channel 名称预先填入上下文

本设计**不**要求：

- 从 channel 插件自动读取“默认 target”
- 从 QQ / Feishu / Telegram 插件的内部状态推断收件人
- 通过通用 SDK 接口强制所有 channel 实现统一 target 元数据

换句话说，`libp2p-mesh` 这版只做“按 channel 增量补齐”，不做“跨插件自动识别 target”。

## 交互细节

### 同步预览

在写入前展示预览，清楚告诉用户：

- 哪些 channel 已经有 target 并保持不变
- 哪些 channel 是新补齐的
- 最终会写入哪些 `inboundTargets`

### 取消语义

如果用户在任意一个 target 输入环节取消：

- 整个同步流程取消
- 不写入部分结果
- 不产生半完成配置

### 手工编辑保留

原有 `Add target`、`Edit target`、`Remove target`、`Disable inbound delivery` 仍然保留。

同步动作只是新增一个更高层的入口，不替代细粒度编辑。

## 配置写入规则

写回时仅更新 `plugins.entries["libp2p-mesh"].config.inboundTargets` 相关内容，不修改其它网络字段。

如果用户当前已有：

- `discovery`
- `bootstrapList`
- `relayList`
- `announceAddrs`

这些字段都必须原样保留。

写入后的结果应满足：

- 已配置 target 原样保留
- 新 channel 的 target 追加进去
- 其它插件配置不受影响

## 错误处理

### channel 列表为空

如果 `config.channels` 中除了 `libp2p-mesh` 外没有其他 channel：

- 同步动作提示没有可配置的目标
- 不写入配置

### channel 名称无效

如果某个 channel 名称为空或异常：

- 跳过该项
- 记录 warning
- 不影响其它 channel 的同步

### 用户输入 target 为空

对于新 channel，target 必须非空。

如果输入为空：

- 重新提示
- 不把空 target 写入配置

### 写入失败

如果配置写入失败：

- 向导返回失败
- 不假装写入成功
- 保留用户输入的预览结果供重新执行

## 测试策略

新增或更新测试应覆盖：

- `listConfiguredChannels()` 返回当前 channel 集合并排除 `libp2p-mesh`
- 同步动作会保留已有 `inboundTargets`
- 同步动作只为缺失 channel 追加新 target
- 同步动作不会删除旧 target
- 同一 `channel + target` 不会重复追加
- 取消同步不会写入任何配置

建议优先补这些测试点：

- `test/setup-config.test.ts`
- `test/setup-wizard.test.ts` 或现有 setup 相关测试文件

## 实施边界

本设计只定义 `libp2p-mesh` 自己的同步体验，不要求：

- 修改 OpenClaw 核心配置模型
- 修改每个 channel 插件的 account / target 语义
- 引入新的通用 target discovery SDK

如果后续要做“从 channel 插件自动读取默认 target”，那会是下一阶段独立设计，不属于本次范围。
