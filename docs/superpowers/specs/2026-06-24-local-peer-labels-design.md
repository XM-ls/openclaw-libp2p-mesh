# 本地远端实例标签设计规格

## 概述

`libp2p-mesh` 已经支持用户通过 `USER.md` 和 `user-profile.json` 公开自己的属性，并把这些属性作为 `userPublicAttributes` 随 `instance-announce` 广播。这个模型只能表达“用户自己公开自己是什么”，不能表达“本机用户把已发现的其他实例归类为什么”。

本设计新增本地远端实例标签能力：用户通过交互式命令 `openclaw libp2p-mesh labels` 为当前已发现的远端 OpenClaw 实例配置本地标签。标签只保存在本机 `peer-labels.json`，不广播给网络，也不写入对方的 `userPublicAttributes`。

发送消息时，`p2p_send_user_attribute_message` 增加 `scope` 参数，用于区分匹配对方公开属性、本机本地标签，或两者都匹配。

## 目标

- 新增 `openclaw libp2p-mesh labels` 交互式向导，管理本机给远端实例配置的本地标签。
- 本地标签只写入 `~/.openclaw/libp2p/peer-labels.json` 或 `$OPENCLAW_STATE_DIR/libp2p/peer-labels.json`。
- 本地标签只绑定已发现的远端 `instanceId`，不修改远端数据，不通过 announce 广播。
- 扩展 `p2p_send_user_attribute_message`，通过 `scope="public" | "local" | "all"` 区分属性来源。
- 保持现有公开属性发送语义向后兼容，默认 `scope="public"`。
- 更新系统提示词，让 agent 能正确选择 `public`、`local` 或 `all`。

## 非目标

- 不增加 `openclaw libp2p-mesh peers label add ...` 这类复杂子命令。
- 不把本地标签写入 `instance-peer.json.userPublicAttributes`。
- 不把本地标签广播给远端或同步给其他用户。
- 不允许用户给未发现的任意 instanceId 批量配置标签；第一版只从当前 `instance-peer.json` 已发现实例中选择。
- 不做全网属性搜索、标签 gossip、中心化目录或共享标签数据库。
- 不改变现有 `openclaw libp2p-mesh profile` 的语义。

## 架构

系统保持两套属性来源：

```text
profile      = 我公开给别人看的属性
labels       = 我本地给别人归类的属性
```

公开属性继续由现有链路处理：

```text
USER.md / user-profile.json
  ↓
instance-announce.userPublicAttributes
  ↓
远端 instance-peer.json.instances[instanceId].userPublicAttributes
```

本地标签使用新的本机私有链路：

```text
openclaw libp2p-mesh labels
  ↓
读取 instance-peer.json 中已发现实例
  ↓
用户选择实例并配置本地 labels
  ↓
写入 peer-labels.json
```

按属性发送时，router 根据 `scope` 选择匹配源：

```text
scope=public -> 匹配 instance-peer.json.userPublicAttributes
scope=local  -> 匹配 peer-labels.json
scope=all    -> 同时匹配 public 和 local，并标注 matchSource
```

## 组件

### PeerLabelStore

新增本地标签存储组件，负责解析、规范化、保存 `peer-labels.json`。

路径规则：

```text
~/.openclaw/libp2p/peer-labels.json
```

当 `OPENCLAW_STATE_DIR` 存在时：

```text
$OPENCLAW_STATE_DIR/libp2p/peer-labels.json
```

文件格式：

```json
{
  "version": 1,
  "updatedAt": 1792490500000,
  "peers": {
    "alice-laptop@MCowBQYDK2Vw.a91bd021": {
      "labels": [
        {
          "key": "group",
          "value": "实验室"
        },
        {
          "key": "project",
          "value": "小龙虾"
        }
      ]
    }
  }
}
```

读取时内部转换为可匹配属性：

```json
{
  "kind": "structured",
  "key": "group",
  "value": "实验室",
  "label": "实验室",
  "source": "local"
}
```

`label` 不要求用户手写，默认等于 `value`。

### Labels CLI

新增命令：

```bash
openclaw libp2p-mesh labels
```

该命令是交互式向导，不提供复杂参数子命令。

启动后读取 `instance-peer.json`，列出当前已发现实例：

```text
Discovered instances:

  1. alice-laptop
     alice-laptop@MCowBQYDK2Vw.a91bd021
     public attributes: skill=typescript, tag:P2P

  2. bob-mac
     bob-mac@MCowBQYDK2Vw.b82ca312
     public attributes: role=导师

Choose instance to classify:
> 1
```

选择实例后展示当前本地标签：

```text
Local labels for alice-laptop:

  No local labels yet.

Choose action:
  1. Add local label
  2. Edit local label
  3. Remove local label
  4. Choose another instance
  5. Save and finish
```

添加本地标签：

```text
Choose label category:
  1. group
  2. project
  3. role
  4. skill
  5. custom

Value:
> 实验室
```

选择 `custom` 时额外询问 `Custom key`。保存后提示：

```text
Saved local peer labels.
```

### 发送工具 scope

扩展 `p2p_send_user_attribute_message` 参数：

```json
{
  "selector": "group=实验室",
  "scope": "local",
  "message": "今晚 8 点同步一下进展",
  "dryRun": true
}
```

`scope` 规则：

- `public`：只匹配对方自己公开的 `userPublicAttributes`。
- `local`：只匹配本机 `peer-labels.json`。
- `all`：同时匹配 `public` 和 `local`。

默认值：

```text
scope=public
```

dry run 返回中必须标注匹配来源：

```json
{
  "matched": 2,
  "scope": "all",
  "targets": [
    {
      "instanceId": "alice-laptop@MCowBQYDK2Vw.a91bd021",
      "instanceName": "alice-laptop",
      "peerId": "12D3KooWAlice...",
      "matchedAttribute": {
        "kind": "structured",
        "key": "group",
        "value": "实验室",
        "label": "实验室",
        "source": "local"
      },
      "matchSource": "local"
    }
  ]
}
```

## 数据流

### 配置本地标签

```text
用户运行 openclaw libp2p-mesh labels
  ↓
CLI 读取 instance-peer.json
  ↓
展示当前已发现实例及其公开属性摘要
  ↓
用户选择一个实例
  ↓
CLI 读取 peer-labels.json 中该实例的本地标签
  ↓
用户添加、编辑或删除标签
  ↓
保存 peer-labels.json
```

### 按本地标签发送

```text
agent 调用 p2p_send_user_attribute_message
  selector="group=实验室"
  scope="local"
  dryRun=true
  ↓
router 读取 peer-labels.json
  ↓
匹配本地标签中的 group=实验室
  ↓
返回 dry run targets，标注 matchSource="local"
  ↓
agent 用相同 selector、scope、message 再调用 dryRun=false
  ↓
router 对每个匹配 instanceId 调用 sendInstanceMessage()
  ↓
返回 sent / delivered / failed 汇总
```

### 按公开属性发送

```text
scope="public"
  ↓
只读取 instance-peer.json.userPublicAttributes
  ↓
不读取 peer-labels.json
```

### 同时匹配

```text
scope="all"
  ↓
匹配 public targets
  ↓
匹配 local targets
  ↓
按 instanceId 去重
  ↓
返回每个目标的 matchSource
```

如果同一实例同时命中 public 和 local，第一版返回一个目标即可，`matchSource` 使用 `"all"`，并保留其中一个 `matchedAttribute` 作为展示属性。后续如果需要展示全部命中原因，再扩展为 `matchedAttributes`。

## 系统提示词规则

系统提示词中需要把原来的“按用户公开属性发送”扩展为“按属性或本地分类发送”。

核心规则：

- 用户说“公开属性”“自己公开”“声明为”时，使用 `scope="public"`。
- 用户说“我归类”“我标记”“我配置的标签”“labels 里的分类”时，使用 `scope="local"`。
- 用户明确说“两边都算”“公开属性或我标记的都算”时，使用 `scope="all"`。
- 用户没有说明来源时，默认使用 `scope="public"`。
- agent 不得把本地标签当作对方公开属性展示。
- 群发仍然必须先 dry run，再用完全相同的 `selector`、`scope`、`message` 实际发送。

工具 schema 中应增加：

```ts
scope: {
  type: "string",
  enum: ["public", "local", "all"],
  description:
    'Attribute source scope. "public" matches attributes published by the remote user in userPublicAttributes; "local" matches labels this local user assigned to discovered instances; "all" matches both. Default is "public".',
}
```

## 错误处理

`peer-labels.json`：

- 文件不存在：按空 labels 处理。
- JSON 损坏：备份为 `.corrupt-<timestamp>`，按空 labels 处理。
- 写入使用临时文件加 rename。
- 空 peers 或空 labels 合法。
- 保存时移除空标签数组的 peer 条目，避免文件膨胀。

`labels` 命令：

- 没有已发现实例时，提示先启动 gateway 或等待发现远端实例，不创建标签。
- 用户取消或 Ctrl+C 时不写入。
- 编辑或删除不存在的标签时回到当前实例菜单，不写入损坏状态。
- `key` 和 `value` 不能为空。
- `key` 规范化为小写，`value` trim。

发送工具：

- `scope` 缺省时按 `public` 处理。
- 非法 `scope` 返回参数错误，不发送。
- `scope="local"` 且 `peer-labels.json` 不存在时，按无匹配目标处理。
- 没有匹配目标时不发送。
- 单个目标发送失败不影响其他目标。
- 返回中必须保留每个目标的匹配来源。

## 测试策略

- `PeerLabelStore` 测试：路径解析、文件不存在、损坏 JSON 备份、读写、规范化、去重、移除空 peer。
- `labels` CLI 测试：无已发现实例、选择实例、添加标签、编辑标签、删除标签、取消不写入。
- router 匹配测试：`scope=public` 只匹配公开属性；`scope=local` 只匹配本地标签；`scope=all` 合并匹配并去重。
- agent tool 测试：schema 暴露 `scope`，默认 `public`，非法 `scope` 报错，dry run 和实际发送都保留 `matchSource`。
- prompt 测试：安装提示词包含 `scope` 规则、`openclaw libp2p-mesh labels` 说明、默认 `public` 规则。
- 兼容测试：旧调用不传 `scope` 时行为与当前按公开属性发送一致。

## 证据层映射 (Evidence Layer Mapping)

| Spec 章节 | 关键陈述 | 证据层 | 说明 |
|-----------|----------|--------|------|
| 概述 | 当前公开属性模型只能表达用户自公开属性 | `repo-observed fact` | 当前设计文档和代码使用 `userPublicAttributes` 表达远端公开属性 |
| 架构 | 新增 `labels` 表达本机给远端实例配置的本地标签 | `design intent` | 本规格拟新增的能力 |
| 组件 | `peer-labels.json` 作为本地私有标签存储 | `design intent` | 尚未实现的目标文件 |
| 发送工具 scope | `scope=public/local/all` 区分匹配来源 | `design intent` | 尚未实现的工具扩展 |
| 系统提示词规则 | 默认 `scope=public`，明确本地归类才用 `local` | `report synthesis` | 基于兼容性和防止误群发的折中 |
| 测试策略 | 覆盖 store、CLI、router、tool、prompt 和兼容性 | `report synthesis` | 对风险面的综合判断 |

## Report 对齐 (Report Alignment)

当前仓库没有与本功能绑定的 report 章节。本规格用于 `libp2p-mesh` 功能设计和实现计划。

进度追踪：

- 实现前状态：`design intent`。
- 实现后状态：代码、测试和 README 更新后可作为 `repo-observed fact`。
- 更新位置：实现完成后更新 `README.md` 的 User public attributes 相关章节，并在实施计划中记录完成状态。

## Harness 设计

### 上下文工程

- 输入上下文：现有 `userPublicAttributes` 设计、`profile` CLI 模式、`instance-peer.json` 结构、agent tool 发送流程、系统提示词。
- 上下文组装：实现计划应优先读取 `src/types.ts`、`src/user-attributes.ts`、`src/user-profile-store.ts`、`src/profile-wizard.ts`、`src/profile-cli.ts`、`src/instance-router.ts`、`src/agent-tools.ts`、`src/prompt-config.ts` 和对应测试。
- 上下文限制：不需要读取网络层无关实现；`labels` 功能只依赖已发现实例列表、标签存储和按属性发送路径。

### 工具编排

- 可用工具：本地文件读写、测试 runner、TypeScript build、现有 CLI test harness。
- 输入验证：CLI 和 agent tool 都必须验证 `key`、`value`、`selector`、`scope`。
- 输出解析：dry run 和发送结果必须包含 `scope`，目标项必须包含 `matchSource`。
- 错误处理：store 损坏备份、CLI 取消不写、发送部分失败继续汇总。
- 超时管理：发送继续复用现有 `sendInstanceMessage()` ACK 超时机制，不为 labels 另设网络超时。

### 验证循环

- 模式验证：TypeScript 类型、JSON 解析和测试 fixture 覆盖 `peer-labels.json`。
- 语义验证：测试断言 public/local/all 三种 scope 不串源。
- 测试断言：每个新增组件先写 focused test，再跑相关测试，最后跑完整 `npm test` 和 `npm run build`。
- 重试策略：如果 scope 合并或去重测试失败，先修正纯函数，再接入 router 和 tool。

### 成本预算

- 预算上限：实现应保持在小型功能范围，避免引入数据库、同步协议或复杂子命令树。
- 熔断器：如果需要改动底层 P2P 协议或 announce 传播机制，应停止并重新评审范围。
- 成本跟踪：以新增文件数量、测试范围和是否触及网络协议作为复杂度指标。

### 可观测性

- 执行追踪：CLI 保存成功时输出标签文件路径和保存结果。
- 指标：测试中统计匹配目标数、发送成功数、发送失败数和 matchSource。
- 评估标准：用户可以通过 `labels` 向导给已发现实例配置本地标签，并用 `scope="local"` dry run 和发送。
- 告警：如果用户尝试用本地标签发送但没有配置 labels，工具返回无匹配目标，不猜测网络中存在其他目标。

## 开放问题

- `scope="all"` 下同一实例同时命中 public 和 local 时，第一版使用 `matchSource="all"` 并返回单个 `matchedAttribute`。是否需要返回完整 `matchedAttributes` 数组，可以在实现前再次确认。
- `labels` 向导是否需要提供“查看所有本地标签”的入口。第一版可以通过逐个实例查看完成，后续再加汇总视图。
