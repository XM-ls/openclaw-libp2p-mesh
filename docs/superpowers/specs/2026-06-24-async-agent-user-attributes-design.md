# 异步 Agent 提取 USER.md 公开属性设计

## 背景

当前插件在 `src/user-md-attributes.ts` 中使用本地启发式代码从 USER.md
提取公开 tag。这个方式能识别 `P2P` 这类简单技术词，但也会从自然语言中发布一些价值较低或无关的 tag，例如 `专注于`、`了解`、`随时告诉我`。

期望行为是：让 OpenClaw 使用用户已经配置好的 agent/API 模型来提取更精准的公开属性，同时不影响 libp2p 节点发现和连接速度。

## 目标

- peer 发现和连接建立不被模型调用阻塞。
- USER.md 属性提取走 OpenClaw 已配置的 agent/model 路径。
- libp2p-mesh 不保存模型供应商 API key，也不直接选择模型。
- 保留现有 `instance-announce` 按 `instanceId` upsert 的模型。
- 将 `user-profile.json` 手动属性和 USER.md 提取 tag 合并为同一个公开属性快照。
- 模型调用失败不影响联网。
- 更新面向 agent 的 prompt 说明，让工具正确区分公开属性和本地标签。

## 非目标

- 不新增单独的属性 delta 协议消息。
- 不让普通对话 agent 自己读取 USER.md 并决定发布什么属性。
- 第一版不增加插件级模型 override 配置。
- 不改变本地 peer labels 或 `scope="local"` 的行为。

## 推荐流程

### 1. 先发送快速基础 announce

gateway 启动或连接 peer 时，立即发送普通 `instance-announce`，只包含身份和网络字段：

```json
{
  "instanceId": "ypp-n206-System-Product-Name@MCowBQYDK2Vw.ea04bf61",
  "peerId": "12D3KooWJG3qqCpaQCtkMpXvVyttFVr916dfVnEC5kVTGCUvTwRd",
  "instanceName": "ypp-n206-System-Product-Name",
  "pubkey": "MCowBQYDK2Vw...",
  "multiaddrs": ["/ip4/127.0.0.1/tcp/37967/p2p/12D3Koo..."],
  "announcedAt": 1782303636721
}
```

基础 announce 省略 `userPublicAttributes` 字段。不要用空数组占位，因为字段缺失表示“这次 announce 没有携带属性”，而空数组表示“当前公开属性快照明确为空”。

### 2. 异步提取 USER.md 属性

基础 announce 发出后，gateway 启动一个异步刷新任务：

1. 读取 `~/.openclaw/workspace/USER.md`，或 `OPENCLAW_STATE_DIR` 下对应的 USER.md。
2. 计算稳定的内容 hash。
3. 如果 hash 命中有效缓存，复用缓存中的 USER.md 属性。
4. 如果 hash 发生变化，调用 OpenClaw runtime 已配置的 agent/model 提取能力。
5. 校验返回的 JSON 属性。
6. 将校验后的结果按 USER.md hash 写入缓存文件。

插件应通过 OpenClaw runtime 能力请求提取。它不应读取模型供应商凭证、不应选择模型供应商，也不应直接调用 OpenAI-compatible API。默认情况下，提取使用当前 OpenClaw 配置的 agent/API 模型。

第一版应在 libp2p-mesh 内定义一个小的可注入提取器接口。生产环境接线在 OpenClaw runtime 能力可用时调用它；测试可以注入确定性的提取器。如果当前 OpenClaw SDK 还没有暴露所需 runtime 方法，生产环境接线应返回“不可用”，并跳过 USER.md 派生 tag，而不是直接调用模型供应商。

### 3. 合并 USER.md tag 和 profile 属性

USER.md 提取完成后，重建公开属性快照：

- USER.md 提取出来的 tag 使用 `source: "USER.md"`。
- `user-profile.json` 中的结构化属性使用 `source: "profile"`。
- 继续使用现有 normalization 和去重规则。

示例快照：

```json
[
  { "kind": "tag", "value": "P2P", "label": "P2P", "source": "USER.md" },
  {
    "kind": "structured",
    "key": "group",
    "value": "实验室",
    "label": "group: 实验室",
    "source": "profile"
  }
]
```

### 4. 广播完整属性 announce

合并后的属性快照准备好后，再发送一次完整 `instance-announce`。第二次 announce 仍然包含所有身份和网络字段，并携带完整 `userPublicAttributes` 快照：

```json
{
  "instanceId": "ypp-n206-System-Product-Name@MCowBQYDK2Vw.ea04bf61",
  "peerId": "12D3KooWJG3qqCpaQCtkMpXvVyttFVr916dfVnEC5kVTGCUvTwRd",
  "instanceName": "ypp-n206-System-Product-Name",
  "pubkey": "MCowBQYDK2Vw...",
  "multiaddrs": ["/ip4/127.0.0.1/tcp/37967/p2p/12D3Koo..."],
  "userPublicAttributes": [
    { "kind": "tag", "value": "P2P", "label": "P2P", "source": "USER.md" },
    {
      "kind": "structured",
      "key": "group",
      "value": "实验室",
      "label": "group: 实验室",
      "source": "profile"
    }
  ],
  "announcedAt": 1782303636721
}
```

接收方继续按 `instanceId` upsert。这保持了协议幂等性，也能自然表达属性删除：新的完整快照直接替换旧快照，不需要新增 delta 合并规则。

### 5. profile 变化后的刷新

用户运行：

```bash
openclaw libp2p-mesh profile
```

并保存 `user-profile.json` 变化后，gateway 应刷新公开属性并重新广播完整 `instance-announce` 快照。刷新时如果 USER.md hash 没变，则复用缓存的 USER.md 提取结果，然后合并新的 profile 属性。

第一版中，如果 profile 命令和 gateway 运行在同一个 plugin runtime 内，应立即刷新。如果 CLI 进程无法通知正在运行的 gateway，保存后的 profile 仍会在下一次启动、peer 连接或定时属性刷新时生效。这样第一版不需要新增跨进程控制通道，也能保证最终一致。

## 校验与安全

模型输出必须被当作不可信数据处理：

- 只解析严格 JSON。
- 只接受兼容 `UserPublicAttribute[]` 的条目。
- 第一版 USER.md 提取只接受 tag 属性。
- 限制最大数量和最大 value 长度。
- 丢弃空值、像句子的值、重复值或 schema 无效值。
- 使用现有 `user-attributes.ts` helper 做 normalization。
- 绝不允许模型输出设置 `source: "profile"`。
- 绝不因为提取失败而影响 peer 连接。

提取失败时，记录 warning，并使用可用的最佳降级结果：

1. 如果同一个文件 hash 已有有效 USER.md 提取缓存，则使用缓存。
2. 否则不发布 USER.md tag。

profile 属性只要可用，仍应正常包含在公开属性快照中。

当前启发式提取器可以暂时保留为本地实现工具，直到被替换；但异步 agent 提取流程不应把启发式 USER.md tag 作为公开降级结果。这样可以避免继续发布本功能想要消除的低价值 tag。

## Prompt 说明变更

`src/prompt-config.ts` 应更新说明新行为：

- `source="USER.md"` 表示 gateway 使用 OpenClaw 已配置的 agent/API 模型，从 USER.md 异步提取并公开广播的 tag。
- `source="profile"` 表示用户通过 `openclaw libp2p-mesh profile` 手动配置的公开结构化属性。
- 基础 announce 可能省略 `userPublicAttributes`；这表示本次 announce 没有携带属性，不一定表示该用户没有公开属性。
- `scope="public"` 匹配远端 `userPublicAttributes`，包括 USER.md 提取 tag 和 profile 属性。
- `scope="local"` 只匹配 `openclaw libp2p-mesh labels` 配置的本地标签。
- `scope="all"` 同时匹配公开属性和本地标签。
- 普通对话 agent 不应自己读取 USER.md 来决定公开属性。属性提取是 gateway 后台职责。

## 测试策略

- 单元测试基础 announce 构造时省略 `userPublicAttributes`。
- 单元测试异步刷新会发送第二次完整 announce，并包含合并后的属性。
- 单元测试 USER.md hash 缓存能避免重复调用提取器。
- 单元测试提取器失败不阻塞基础 announce。
- 单元测试无效模型输出会被丢弃。
- 单元测试 profile 变化会重建并重新广播完整快照。
- prompt 测试应断言更新后的 source 和 scope 说明。

## 第一版决策

- 在 libp2p-mesh 内定义本地可注入提取器接口，并在 OpenClaw runtime 提取能力可用时接入。
- 不增加直接模型供应商 API 调用，也不保存插件自己的模型凭证。
- 异步提取不可用时，不发布启发式 USER.md tag 作为降级结果。
- 当 CLI 无法通知运行中的 gateway 进程时，profile 更新保持最终一致。
