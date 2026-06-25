# 本地标签写入 instance-peer.json 快照设计

日期：2026-06-25

## 背景

当前 libp2p-mesh 已支持两类用户属性：

- `userPublicAttributes`：远端实例自己公开广播的属性，来源包括 USER.md agent 提取结果和 `user-profile.json`。
- `localLabels`：本机给远端实例配置的私有标签，真实来源是本机的 `peer-labels.json`。

目前 `p2p_list_instances` 可以动态读取并展示 `localLabels`，但 `instance-peer.json` 中只保存远端 announce 派生的实例记录和 `userPublicAttributes`。这导致直接查看 `instance-peer.json` 时，看不到本机已经给某个远端实例打过哪些本地标签。

本设计目标是：让 `instance-peer.json` 中也能看到本地标签快照，同时保持本地标签的私有语义，不广播给对方，不通知被标记用户。

## 目标

1. 在 `instance-peer.json.instances[instanceId]` 中增加 `localLabels` 快照字段。
2. 保留 `peer-labels.json` 作为本地标签的唯一权威来源。
3. gateway 启动后，将已有 `peer-labels.json` 标签同步到已发现实例记录。
4. 收到远端 announce 更新实例记录时，保留并挂载对应的本地标签快照。
5. 通过 `openclaw libp2p-mesh labels` 修改标签后，同步刷新 `instance-peer.json.localLabels`。
6. `p2p_list_instances` 输出完整节点信息，并明确区分公开属性和本地标签。
7. 同步更新 `prompt-config.ts`，让 agent 正确理解 `localLabels` 的私有语义和 scope 选择。

## 非目标

1. 不把 `localLabels` 放入 `instance-announce` 广播。
2. 不把本机标签通知给被标记用户。
3. 不让远端保存本机的 `localLabels`。
4. 不取消 `peer-labels.json`。
5. 不把本地标签合并进 `userPublicAttributes`。
6. 不为 `peer-labels.json` 中尚未发现的 instanceId 凭空创建实例记录。

## 数据边界

### userPublicAttributes

含义：远端实例代表的用户自己公开广播的属性。

来源：

- USER.md agent 提取出的 tag，`source="USER.md"`。
- `openclaw libp2p-mesh profile` 配置的公开结构化属性，`source="profile"`。

传播：

- 会进入 `instance-announce`。
- 会被其他节点写入自己的 `instance-peer.json`。

### localLabels

含义：本机对远端实例的私有归类。

来源：

- `~/.openclaw/libp2p/peer-labels.json`
- `OPENCLAW_STATE_DIR/libp2p/peer-labels.json`

传播：

- 不进入 `instance-announce`。
- 不发送给对方。
- 不通知被标记用户。
- 只作为本机 `instance-peer.json` 中的派生快照存在。

## instance-peer.json 结构

新增字段：

```ts
localLabels?: LocalPeerLabelAttribute[]
```

示例：

```json
{
  "version": 1,
  "updatedAt": 1782303636573,
  "instances": {
    "fhl-enine@MCowBQYDK2Vw.d073ce70": {
      "instanceId": "fhl-enine@MCowBQYDK2Vw.d073ce70",
      "peerId": "12D3KooWLvw2N15n5dNWVAAARjpLif3w18JfwTr36k7rNJFW5AQA",
      "instanceName": "fhl-enine",
      "pubkey": "MCowBQYDK2Vw...",
      "multiaddrs": [],
      "userPublicAttributes": [
        {
          "kind": "tag",
          "value": "P2P",
          "label": "P2P",
          "source": "USER.md"
        }
      ],
      "localLabels": [
        {
          "kind": "structured",
          "key": "group",
          "value": "实验室",
          "label": "实验室",
          "source": "local"
        }
      ],
      "lastSeenAt": 1782303636573,
      "lastAnnouncedAt": 1782303636721,
      "source": "announce"
    }
  }
}
```

## 同步规则

### gateway 启动

gateway 启动时：

1. 加载 `instance-peer.json`。
2. 加载 `peer-labels.json`。
3. 遍历 `instance-peer.json.instances`。
4. 对每个已存在 instanceId：
   - 如果 `peer-labels.json.peers[instanceId]` 有标签，则转换为 `LocalPeerLabelAttribute[]` 并写入 `record.localLabels`。
   - 如果没有标签，则移除或置空 `record.localLabels`。
5. 保存更新后的 `instance-peer.json`。

这样已有用户在升级插件后，只要 `peer-labels.json` 中已有标签，并且 `instance-peer.json` 已发现对应实例，启动 gateway 后就能在 `instance-peer.json` 中看到 `localLabels`。

### 收到 instance announce

收到远端 announce 时：

1. 正常更新 announce 派生字段：
   - `peerId`
   - `instanceName`
   - `pubkey`
   - `multiaddrs`
   - `userPublicAttributes`
   - `lastSeenAt`
   - `lastAnnouncedAt`
2. 从 `peer-labels.json` 查找同一 instanceId 的本地标签。
3. 写入 `record.localLabels` 快照。
4. 如果 announce payload 省略 `userPublicAttributes`，仍保留已有公开属性，符合当前设计。
5. announce 永远不能覆盖或删除本地标签的权威来源。

### labels 命令保存后

用户通过：

```bash
openclaw libp2p-mesh labels
```

修改本地标签后：

1. 写入 `peer-labels.json`。
2. 如果 `instance-peer.json` 中已经存在该 instanceId，同步刷新该记录的 `localLabels`。
3. 如果 `instance-peer.json` 中不存在该 instanceId，不创建新实例记录。

## p2p_list_instances 输出

`p2p_list_instances` 应输出每个实例的完整本机可见信息：

- `instanceId`
- `peerId`
- `instanceName`
- `connected`
- `multiaddrs`
- `pubkey`
- `lastSeenAt`
- `lastAnnouncedAt`
- `source`
- `userPublicAttributes`
- `localLabels`

输出必须明确区分：

```text
userPublicAttributes: 远端公开广播的属性
localLabels: 本机私有标签，不广播，不通知对方
```

读取策略：

1. 优先使用 `InstancePeerRecord.localLabels`。
2. 如果记录中没有 `localLabels`，但 `peerLabelStore` 可用，则从 `peer-labels.json` 动态读取作为兜底。
3. 输出中不要把 `localLabels` 混称为公开属性。

## 按属性发送消息的匹配规则

匹配规则保持不变：

- `scope="public"`：只匹配 `userPublicAttributes`。
- `scope="local"`：只匹配 `localLabels`。
- `scope="all"`：同时匹配两者。

即使 `localLabels` 出现在 `instance-peer.json` 中，也仍然属于本机私有标签，不属于远端公开属性。

## prompt-config.ts 更新

需要同步更新 `src/prompt-config.ts`，加入明确规则：

1. 即使 `localLabels` 出现在 `instance-peer.json` 或 `p2p_list_instances` 输出中，它仍然是本机私有标签快照。
2. `localLabels` 不是远端公开属性，不来自对方广播。
3. `localLabels` 不会通过 `instance-announce` 广播，也不会通知被标记用户。
4. 用户说“本地标签”“我归类”“我标记”或 labels/local labels 时，按属性发送必须使用 `scope="local"`。
5. 用户说“公开属性”“对方公开”“USER.md”“profile”时，使用 `scope="public"`。
6. 展示节点信息时，必须分开展示 `userPublicAttributes` 和 `localLabels`。

## 修改范围

### src/types.ts

- `InstancePeerRecord` 增加：

```ts
localLabels?: LocalPeerLabelAttribute[];
```

- `InstancePeerStore` 增加同步能力，例如：

```ts
syncLocalLabels(labelsByInstance?: Record<string, LocalPeerLabelAttribute[]>): Promise<InstancePeerTable>;
updateLocalLabels(instanceId: string, labels: LocalPeerLabelAttribute[]): Promise<InstancePeerRecord | undefined>;
```

具体命名可在实现时按代码风格调整。

### src/instance-peer-store.ts

- 加载时规范化 `localLabels`。
- 保存时保留 `localLabels`。
- `upsertFromAnnounce` 时保留或设置本地标签快照。
- 提供批量同步和单实例同步方法。

### src/instance-router.ts

- 接收 announce 后，使用 `peerLabelStore` 给记录挂载 `localLabels`。
- 启动后调用 store 的批量同步方法。
- `sendUserAttributeMessage` 匹配 `scope="local"` 时，可以优先使用记录中的 `localLabels`，再从 `peerLabelStore` 兜底。

### src/plugin.ts

- 创建 store/router 时接入 `peerLabelStore`。
- gateway service start 后触发一次已有记录的 localLabels 同步。
- labels CLI 保存后触发单实例或全量 localLabels 同步。

### src/profile-cli.ts

- labels 命令保存后调用同步回调。
- 保持 `peer-labels.json` 为唯一真实写入来源。

### src/agent-tools.ts

- `p2p_list_instances` 输出完整字段。
- 优先读取 `record.localLabels`，再读取 `peerLabelStore` 兜底。
- 输出文案明确本地标签不广播。

### src/prompt-config.ts

- 添加 `localLabels` 快照语义和 scope 规则。

## 迁移行为

升级插件后无需手动迁移。

已有文件：

```text
~/.openclaw/libp2p/peer-labels.json
~/.openclaw/libp2p/instance-peer.json
```

在 gateway 启动后自动同步：

- 如果两边都有同一个 instanceId，`instance-peer.json` 会出现 `localLabels`。
- 如果只有 `peer-labels.json` 有标签，但尚未发现该 instance，不创建实例记录。
- 当该 instance 后续被发现时，再自动挂载 `localLabels`。

## 错误处理

1. `peer-labels.json` 不存在：视为空标签文件。
2. `peer-labels.json` 损坏：沿用现有逻辑备份损坏文件并返回空标签。
3. 同步 `localLabels` 失败：记录 warn，不影响基础 announce、消息发送和公开属性处理。
4. `instance-peer.json` 损坏：沿用现有逻辑备份损坏文件并重建空表。
5. labels 命令保存成功但快照同步失败：保留 `peer-labels.json` 结果，提示或记录同步失败；下次 gateway 启动会再次尝试同步。

## 测试计划

### instance-peer-store

- 加载旧格式记录时，缺失 `localLabels` 不报错。
- 加载含 `localLabels` 的记录时，规范化并保留。
- `upsertFromAnnounce` 不会删除已有 `localLabels`。
- 批量同步能把已有 `peer-labels.json` 标签写入对应记录。
- 单实例同步不会为未知 instanceId 创建新记录。

### instance-router

- 收到 announce 后，记录包含对应 `localLabels` 快照。
- 没有本地标签时，记录不包含或包含空 `localLabels`。
- `scope="local"` 能匹配 `localLabels`。
- `scope="public"` 不匹配 `localLabels`。
- `scope="all"` 同时匹配公开属性和本地标签。

### labels CLI

- 保存标签后，`peer-labels.json` 更新。
- 如果 instance 已发现，`instance-peer.json.localLabels` 同步更新。
- 删除标签后，`instance-peer.json.localLabels` 同步清空。

### p2p_list_instances

- 输出基础字段、公开属性、本地标签。
- 文案区分 `userPublicAttributes` 和 `localLabels`。
- 当 record 中没有 localLabels 时，能从 `peerLabelStore` 兜底展示。

### prompt-config

- 提示词包含 localLabels 快照不广播规则。
- 提示词包含 `scope="local"`、`scope="public"`、`scope="all"` 的区分规则。

## 验收标准

1. 更新插件后启动 gateway，已有 `peer-labels.json` 中的标签会出现在已发现实例的 `instance-peer.json.localLabels`。
2. 新发现实例如果已有本地标签，会在写入 `instance-peer.json` 时带上 `localLabels`。
3. labels 命令增删改标签后，`instance-peer.json.localLabels` 同步变化。
4. `p2p_list_instances` 能展示完整节点信息，并区分公开属性和本地标签。
5. 本地标签不会出现在任何 outgoing `instance-announce` payload 中。
6. 按属性发送的 scope 行为保持清晰、可预测。

## 自检

- 无占位符和未完成项。
- `peer-labels.json` 是权威来源，`instance-peer.json.localLabels` 是派生快照，边界一致。
- 本地标签不广播、不通知对方，和安全要求一致。
- 该设计聚焦在本地标签快照和工具展示，不包含无关网络协议改造。
