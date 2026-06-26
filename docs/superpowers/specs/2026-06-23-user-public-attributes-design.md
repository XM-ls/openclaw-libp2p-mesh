# 用户公开属性与按属性发送设计

## 背景

`libp2p-mesh` 当前已经支持 OpenClaw 实例间发现、`instance-peer.json` 路由表维护，以及通过 `p2p_send_instance_message` 按 `instanceId` 发送消息并等待远端投递 ACK。现有 `instance-peer.json` 的核心职责是保存 `instanceId -> peerId` 的当前路由。

本设计在现有实例路由表上增加用户公开属性缓存，让发送方可以在已发现实例范围内按用户属性筛选目标并群发消息。例如：

```text
给所有 group=实验室 的用户发消息：今晚 8 点同步一下进展
```

这里的属性是“用户公开属性”，不是机器属性、网络属性，也不是 OpenClaw 实例能力属性。由于当前网络路由单位是 OpenClaw instance，属性会缓存在 `instance-peer.json` 的 instance record 上，但语义是“该 instance 代表的用户公开了这些属性”。

## 目标

- 在 `instance-announce` 中携带用户公开属性。
- 在远端 `instance-peer.json` 中维护每个已发现实例对应用户的公开属性。
- 从 `USER.md` 中提取自由标签属性，但不修改 `USER.md`，也不写入 `user-profile.json`。
- 通过 `openclaw libp2p-mesh profile` 管理用户手动新增的结构化公开属性。
- 新增按用户属性发送消息的 agent tool，复用现有 `sendInstanceMessage()` 和 ACK 机制。
- 第一版只在本地已发现的 `instance-peer.json` 范围内筛选目标，不做全网搜索或全网属性索引。

## 非目标

- 不修改 `USER.md`。
- 不把从 `USER.md` 提取的属性写入 `user-profile.json`。
- 不把属性配置放进 `openclaw libp2p-mesh setup`。
- 不做中心化目录服务。
- 不做跨全网的属性 gossip、TTL 扩散或分层路由。
- 不要求 `USER.md` 提取结果符合固定类别。
- 不自动确认或静默发送群发消息；群发前应支持 dry run。

## 核心模型

统一使用一个字段：

```json
"userPublicAttributes": []
```

该字段保存这个 instance 对应用户公开出来的属性集合。属性分两种 `kind`。

### 自由标签属性

自由标签来自 `USER.md`，不做类别约束。

```json
{
  "kind": "tag",
  "value": "实验室",
  "label": "实验室",
  "source": "USER.md"
}
```

规则：

- `USER.md` 只读。
- gateway 启动时从 `USER.md` 提取自由 tag。
- 提取结果只参与本次 announce 广播。
- 提取结果不写入 `user-profile.json`。
- 不要求有 `key`。

### 结构化属性

结构化属性来自用户手动管理的 profile。

```json
{
  "kind": "structured",
  "key": "group",
  "value": "实验室",
  "label": "实验室",
  "source": "profile"
}
```

规则：

- 结构化属性写入 `~/.openclaw/libp2p/user-profile.json`。
- 结构化属性有固定 `key` 类别。
- 第一版支持 `group`、`project`、`role`、`skill`、`custom`。
- 结构化属性适合精确匹配和按属性发送。

## 本机文件

### USER.md

`USER.md` 是 OpenClaw 初始化后已有的用户记忆文件。`libp2p-mesh` 只读取它，不修改它。

gateway 启动后，如果 `USER.md` 存在，插件从里面提取自由标签属性。例如提取出：

```json
[
  {
    "kind": "tag",
    "value": "实验室",
    "label": "实验室",
    "source": "USER.md"
  },
  {
    "kind": "tag",
    "value": "ResearchLoop",
    "label": "ResearchLoop",
    "source": "USER.md"
  }
]
```

这些属性只在内存中参与本次 announce，不落盘到 profile。

第一版通过独立的 `USER.md` 读取与提取组件完成这件事：

```text
UserMdAttributeSource
  ↓
读取 OpenClaw 当前实例可见的 USER.md
  ↓
UserMdTagExtractor
  ↓
输出 kind=tag 的 userPublicAttributes
```

读取规则：

- 插件只读取 OpenClaw 当前实例已经初始化并可见的 `USER.md`。
- 如果运行上下文无法定位 `USER.md`，按无 tag 处理。
- 不扫描任意用户目录，不猜测非 OpenClaw 管理路径。
- 不写回 `USER.md`。

提取规则：

- 只输出 `kind="tag"` 的自由标签。
- 不强行分类为 `group`、`project`、`role` 或 `skill`。
- 不调用网络服务。
- 不把原文段落广播出去，只广播短标签。
- 提取不到稳定标签时返回空数组。
- 第一版最多输出 10 个 tag，单个 tag 最长 40 个字符。

### user-profile.json

路径：

```text
~/.openclaw/libp2p/user-profile.json
```

当 `OPENCLAW_STATE_DIR` 存在时，使用：

```text
$OPENCLAW_STATE_DIR/libp2p/user-profile.json
```

该文件只保存用户手动新增、编辑、删除的结构化属性。

示例：

```json
{
  "version": 1,
  "updatedAt": 1792490400000,
  "attributes": [
    {
      "kind": "structured",
      "key": "group",
      "value": "实验室",
      "label": "实验室"
    },
    {
      "kind": "structured",
      "key": "skill",
      "value": "typescript",
      "label": "TypeScript"
    }
  ]
}
```

如果文件不存在，等价于：

```json
{
  "attributes": []
}
```

只有用户第一次手动新增结构化属性时才创建文件。

## announce 数据流

gateway 启动后的 announce 数据流：

```text
gateway start
  ↓
读取 USER.md，提取 kind=tag 的用户公开属性
  ↓
读取 user-profile.json；如果不存在则按空 profile 处理
  ↓
在内存中合并 USER.md tags + profile structured attributes
  ↓
随 instance-announce 一起广播
  ↓
远端写入 instance-peer.json.instances[instanceId].userPublicAttributes
```

合并只发生在内存中的 announce payload 中。`USER.md` 提取结果不会写入 `user-profile.json`。

## instance-announce 结构

现有 announce payload 增加 `userPublicAttributes`。

```json
{
  "instanceId": "fhl-enine@MCowBQYDK2Vw.d073ce70",
  "peerId": "12D3KooW...",
  "instanceName": "fhl-enine",
  "multiaddrs": [
    "/ip4/127.0.0.1/tcp/42547/p2p/12D3KooW..."
  ],
  "pubkey": "MCowBQYDK2Vw...",
  "userPublicAttributes": [
    {
      "kind": "tag",
      "value": "实验室",
      "label": "实验室",
      "source": "USER.md"
    },
    {
      "kind": "structured",
      "key": "group",
      "value": "实验室",
      "label": "实验室",
      "source": "profile"
    }
  ],
  "announcedAt": 1781507817973
}
```

旧节点不带 `userPublicAttributes` 时，接收方按空数组处理。

## instance-peer.json 结构

远端收到 announce 后，在对应 record 上保存完整 `userPublicAttributes`。

```json
{
  "version": 1,
  "updatedAt": 1792490400000,
  "instances": {
    "fhl-enine@MCowBQYDK2Vw.d073ce70": {
      "instanceId": "fhl-enine@MCowBQYDK2Vw.d073ce70",
      "peerId": "12D3KooW...",
      "instanceName": "fhl-enine",
      "multiaddrs": [
        "/ip4/127.0.0.1/tcp/42547/p2p/12D3KooW..."
      ],
      "pubkey": "MCowBQYDK2Vw...",
      "lastSeenAt": 1792490400000,
      "lastAnnouncedAt": 1781507817973,
      "source": "announce",
      "userPublicAttributes": [
        {
          "kind": "tag",
          "value": "实验室",
          "label": "实验室",
          "source": "USER.md"
        },
        {
          "kind": "structured",
          "key": "group",
          "value": "实验室",
          "label": "实验室",
          "source": "profile"
        }
      ]
    }
  }
}
```

`instance-peer.json` 仍然是实例路由表。新增字段只是缓存该 instance 对应用户公开出来的属性。

## profile 命令

新增或扩展 CLI：

```bash
openclaw libp2p-mesh profile
```

该命令只管理 `user-profile.json.attributes` 中的结构化属性，不修改 `USER.md`，也不编辑从 `USER.md` 提取出来的 tag。

界面示例：

```text
User public attributes announced by this instance

From USER.md (read-only, extracted on gateway start):
  1. tag: 实验室
  2. tag: ResearchLoop

From user-profile.json (editable):
  3. group: 实验室
  4. skill: TypeScript

Choose action:
  1. Add structured attribute
  2. Edit structured attribute
  3. Remove structured attribute
  4. Preview announced attributes
  5. Finish
```

添加结构化属性：

```text
Choose attribute category:
  1. group
  2. project
  3. role
  4. skill
  5. custom
```

选择 `group`：

```text
Value: 实验室
Public label: 实验室
```

写入 `user-profile.json`：

```json
{
  "kind": "structured",
  "key": "group",
  "value": "实验室",
  "label": "实验室"
}
```

选择 `custom`：

```text
Custom key: location
Value: 深圳
Public label: 深圳
```

保存后提示：

```text
Saved user profile attributes.
Restart the gateway to announce updated profile attributes.
```

第一版不要求 profile 命令实时触发 announce。修改 profile 后通过重启 gateway 生效。

## 按属性发送工具

新增 agent tool：

```text
p2p_send_user_attribute_message
```

### 参数

自由 tag 匹配：

```json
{
  "match": {
    "kind": "tag",
    "value": "实验室"
  },
  "message": "今晚 8 点同步一下进展",
  "dryRun": true
}
```

结构化属性匹配：

```json
{
  "match": {
    "kind": "structured",
    "key": "group",
    "value": "实验室"
  },
  "message": "今晚 8 点同步一下进展",
  "dryRun": true
}
```

字段：

- `match.kind`: `"tag"` 或 `"structured"`。
- `match.key`: `kind="structured"` 时必填。
- `match.value`: 必填。
- `message`: 必填。
- `dryRun`: 默认建议为 `true`，用于预览目标。

### 执行流程

```text
读取 router.listInstances()
  ↓
遍历 instance-peer records
  ↓
筛选 record.userPublicAttributes
  ↓
dryRun=true：只返回目标列表，不发送
dryRun=false：对每个 instanceId 调用 sendInstanceMessage()
  ↓
汇总每个目标的 sent / delivered / error
```

### dry run 返回

```json
{
  "matched": 2,
  "targets": [
    {
      "instanceId": "fhl-enine@MCowBQYDK2Vw.d073ce70",
      "instanceName": "fhl-enine",
      "peerId": "12D3KooW...",
      "matchedAttribute": {
        "kind": "structured",
        "key": "group",
        "value": "实验室",
        "label": "实验室",
        "source": "profile"
      }
    }
  ]
}
```

### 实际发送返回

```json
{
  "matched": 2,
  "sent": 2,
  "delivered": 1,
  "failed": 1,
  "results": [
    {
      "instanceId": "fhl-enine@MCowBQYDK2Vw.d073ce70",
      "instanceName": "fhl-enine",
      "peerId": "12D3KooW...",
      "matchedAttribute": {
        "kind": "structured",
        "key": "group",
        "value": "实验室",
        "label": "实验室",
        "source": "profile"
      },
      "sent": true,
      "delivered": true
    },
    {
      "instanceId": "alice-laptop@MCowBQYDK2Vw.a91bd021",
      "instanceName": "alice-laptop",
      "peerId": "12D3KooWAlice...",
      "sent": true,
      "delivered": false,
      "error": "ACK timeout after 15000ms"
    }
  ]
}
```

没有匹配目标时返回：

```text
No discovered users match structured group=实验室.
Ask them to start their gateway, connect to this mesh, or publish the matching user attribute.
```

自然语言使用时，agent 应先调用 `dryRun: true` 展示目标并请求用户确认；用户确认后再调用 `dryRun: false`。

## 匹配规则

`tag` 匹配：

```text
attr.kind == "tag"
normalized(attr.value) == normalized(match.value)
```

`structured` 匹配：

```text
attr.kind == "structured"
normalized(attr.key) == normalized(match.key)
normalized(attr.value) == normalized(match.value)
```

第一版 normalization：

- trim 前后空白。
- `key` 转小写。
- 英文 `value` 可转小写；中文按原文比较。

## 去重规则

生成 announce 前去重：

```text
tag:
  kind + normalized(value)

structured:
  kind + normalized(key) + normalized(value)
```

如果 `USER.md` 提取出 `tag: 实验室`，profile 中也有 `structured group=实验室`，两者不互相覆盖，因为它们的 `kind` 和匹配语义不同。

## 错误处理

`USER.md`：

- 文件不存在：按无 tag 处理。
- 读取失败：记录 warn，不阻止 gateway 启动。
- 提取失败：记录 warn，不阻止 gateway 启动。
- 第一版限制最多提取 10 个 tag。
- 单个 label/value 最长 40 个字符。

`user-profile.json`：

- 文件不存在：按空 profile 处理。
- JSON 损坏：备份为 `.corrupt-<timestamp>`，按空 profile 处理。
- 写入使用临时文件 + rename。
- profile 命令取消或 Ctrl+C：不写入。

`instance-peer.json`：

- 旧记录没有 `userPublicAttributes`：按空数组处理。
- 旧节点 announce 不带属性：保存为空数组或省略字段都可，读取时必须兼容。

按属性发送：

- 没有匹配目标：返回说明，不发送。
- 单个目标发送失败：不影响其他目标发送。
- 返回中必须包含每个目标的结果。

## 测试策略

- profile store 测试：不存在文件、损坏文件、读写、去重、取消不写。
- USER.md 提取测试：不存在、空文件、正常提取、数量和长度限制。
- announce 测试：合并 USER.md tag 和 profile structured attributes。
- instance peer store 测试：收到 announce 后保存 `userPublicAttributes`。
- agent tool 测试：tag dry run、structured dry run、实际发送、部分失败、无匹配目标。
- 兼容测试：旧 announce 和旧 `instance-peer.json` 不带属性时仍可按 instanceId 发送。

## 兼容性

本设计向后兼容旧节点：

- 旧节点不会发送 `userPublicAttributes`。
- 新节点收到旧 announce 时按空属性处理。
- 旧 `instance-peer.json` 没有 `userPublicAttributes` 时按空数组读取。
- 现有 `p2p_send_instance_message` 不改变。
- 现有 `openclaw libp2p-mesh setup` 不改变。

## 小 mesh 边界

第一版只在本机已经发现过的实例范围内工作。属性发送读取的是本地 `instance-peer.json`，因此它不是全网搜索。

这符合当前 10 个左右 OpenClaw 实例组成小 mesh 的使用目标。后续如果要扩大范围，再设计 gossip、TTL、room/topic 或分层 relay，而不是在第一版引入复杂全网索引。
