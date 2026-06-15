# P2P Mesh 导师讲解 PPT 设计

日期：2026-06-15

## 目标

生成一份面向导师讲解的 PPTX，主题是 `libp2p-mesh` 在 OpenClaw 中如何实现跨实例 P2P 消息通信。

PPT 需要回答两个核心问题：

1. P2P 网络中的消息如何最终让用户在飞书等 channel 中看见。
2. 用户在飞书中发出的自然语言指令如何被 OpenClaw Agent 读取，并通过 P2P 网络执行。

PPT 还需要覆盖近期新增的关键能力，包括 instance routing、instance peer 映射表、delivery ACK、新增工具、NAT/relay 可达性、安全边界以及移除 shell 调用后的运行时投递方式。

## 听众与篇幅

听众是导师，材料应偏工程方案讲解，而不是纯产品演示或纯代码评审。

篇幅控制在 10-12 页。推荐 12 页，保证链路、架构、可靠性和新增功能都有独立空间。

## 叙事策略

采用“问题背景 -> 用户可见链路 -> 内部实现 -> 可靠性与边界 -> 总结展望”的技术汇报结构。

重点不是逐行解释代码，而是说明系统边界和关键设计决策：

- 为什么从 `peerId` 直发升级为 `instanceId` 用户级通信。
- 为什么需要 `InstanceRouter` 和 `instance-peer.json`。
- 为什么 `p2p_send_instance_message` 是主工具，而 `p2p_send_message` 只保留为低层调试接口。
- 为什么成功标准不是“P2P 发出”，而是“远端 channel 投递成功并返回 ACK”。
- 为什么远端收到的 P2P 内容只作为普通文本，不作为指令执行。

## PPT 页面设计

### 1. 标题页

标题：OpenClaw libp2p-mesh 跨实例消息通信机制

副标题：从飞书用户指令到 P2P 网络投递与远端可见消息

要点：

- 项目：OpenClaw 插件 `libp2p-mesh`
- 核心能力：通过 `instanceId` 在不同 OpenClaw 实例之间通信
- 场景：用户 A 在飞书中给用户 B 的 OpenClaw 实例发送消息

### 2. 背景与目标

说明原始 P2P 能力偏底层，只能通过 libp2p `peerId` 直接发送调试消息。导师需要看到升级目标：让用户和 Agent 使用稳定的 `instanceId`，而不是要求用户理解 peer routing。

要点：

- `peerId` 是网络层身份，不适合作为用户操作入口。
- `instanceId` 是 OpenClaw 实例身份，更贴近用户和设备。
- 新目标是形成“用户指令 -> Agent 工具 -> P2P 网络 -> 远端用户可见”的完整链路。

### 3. 总体通信链路

用一页流程图解释端到端路径：

用户 A 飞书消息 -> botA/OpenClaw Agent -> `p2p_send_instance_message` -> `InstanceRouter` -> libp2p `user-message` -> botB/OpenClaw -> inbound delivery -> 用户 B 飞书消息。

强调发送方最终拿到的成功结果来自远端 `delivery-ack`，不是本地发送成功。

### 4. 用户指令如何触发 P2P

解释 Agent 层如何从用户话语选择工具：

- 用户给出目标 `instanceId` 和消息内容。
- Agent 调用 `p2p_send_instance_message({ instanceId, message })`。
- 不再手动先查映射再调用 `p2p_send_message`。
- `p2p_send_message` 只用于已知 `peerId` 的低层调试直发。

### 5. instanceId 如何找到 peerId

解释 instance routing 的发现机制：

- mesh 启动和 peer 连接时交换 `instance-announce`。
- announce 中包含 `instanceId`、`peerId`、`instanceName`、multiaddrs、pubkey 和时间戳。
- 本地持久化到 `~/.openclaw/libp2p/instance-peer.json` 或 `$OPENCLAW_STATE_DIR/libp2p/instance-peer.json`。
- `p2p_resolve_instance` 和 `p2p_list_instances` 用于查询这张表。

### 6. P2P 网络中传输什么

解释结构化消息类型：

- `instance-announce`：路由公告。
- `user-message`：用户业务消息。
- `delivery-ack`：远端投递结果。

重点展示 `user-message` 包含：

- `messageId`
- `fromInstanceId`
- `toInstanceId`
- `text`
- `metadata.replyTool = "p2p_send_instance_message"`

### 7. 用户如何看见 P2P 消息

解释远端消息可见性的实现：

- `InstanceRouter` 收到 `user-message` 后校验目标是否为本地 `instanceId`。
- 通过 `inboundChannel` 和 `inboundTarget` 决定投递到哪个 OpenClaw channel 和目标。
- 当前实现通过 OpenClaw runtime channel outbound adapter 投递，例如 Feishu 的 `sendText`。
- 远端用户最终在飞书私聊或群聊中看到普通文本消息。

### 8. 可靠投递与错误回传

说明 ACK 机制：

- 发送方维护 pending ACK map。
- 远端 channel 投递成功后返回 `delivery-ack { ok: true }`。
- 远端配置缺失、channel 不可用、Feishu 权限失败等情况返回 `ok: false` 和错误摘要。
- 超过 `deliveryAckTimeoutMs` 后发送方返回 ACK timeout。

强调：成功定义为“远端用户 channel 投递成功”，不是“P2P 包已发出”。

### 9. 新增工具能力

按功能分组介绍工具：

- 低层 peer 工具：`p2p_send_message`、`p2p_broadcast`、`p2p_list_peers`
- 身份与网络信息：`p2p_get_instance_identity`、`p2p_get_network_info`
- instance routing 工具：`p2p_list_instances`、`p2p_resolve_instance`、`p2p_send_instance_message`

说明导师关心的边界：普通用户通信应走 instance 工具；peer 工具主要用于调试。

### 10. 网络可达性增强

介绍已有和新增相关网络能力：

- LAN 内 mDNS 自动发现。
- bootstrap 静态 peer 列表。
- DHT 用于 WAN peer discovery 和 pubkey registry。
- NAT traversal、AutoNAT、UPnP、Circuit Relay v2、DCUtR。
- relay server 和 relay reservation 支持跨 NAT 场景。

这页只讲能力层，不展开 libp2p 协议细节。

### 11. 安全边界与鲁棒性

解释防止误执行和循环的设计：

- P2P 入站文本只作为普通文本转发，不作为系统提示词或工具指令执行。
- `delivery-ack` 不作为普通消息继续转发，避免确认循环。
- 重复 `user-message` 使用 delivery cache 去重，并复用上次 ACK。
- 签名、instance envelope、发送方路由一致性检查用于拒绝伪造或错路消息。
- 最新修复移除了 shell-based delivery，不再通过 `child_process` 执行 `openclaw message send`，避免插件安装安全扫描拦截。

### 12. 总结与后续方向

总结三层价值：

- 用户层：用户只需要说“给某 instanceId 发消息”，不需要理解 libp2p peer。
- Agent 层：工具接口清晰，主路径是 `p2p_send_instance_message`。
- 网络层：自动路由公告、持久化映射、结构化消息、ACK 和错误回传形成闭环。

后续方向：

- 联系人别名或通讯录，把自然语言用户名称映射到 `instanceId`。
- 周期性路由刷新和过期清理。
- 更丰富的 inbound metadata，用于受控自动回复。
- 更完整的跨 NAT 实测和可视化诊断。

## 视觉风格

PPTX 风格应清晰、正式、适合导师汇报。

建议：

- 以白底或浅色背景为主，使用深色正文。
- 每页不超过 4 个核心 bullet。
- 关键流程页使用横向流程图。
- 架构页使用分层框图：用户/channel、Agent 工具、InstanceRouter、MeshNetwork、远端 channel。
- 工具页使用分组表格。
- 错误处理页使用“失败场景 -> 返回方式”的小表格。

不需要复杂动画。

## 验收标准

生成的 PPTX 应满足：

- 10-12 页。
- 能独立解释“用户如何看见 P2P 消息”。
- 能独立解释“用户指令如何触发 P2P 网络执行”。
- 明确区分 `p2p_send_instance_message` 和 `p2p_send_message`。
- 覆盖 instance mapping、structured messages、inbound delivery、delivery ACK、工具列表、NAT/relay、安全边界。
- 适合导师在 8-12 分钟内听懂核心实现。

## 不包含内容

- 不讲完整 libp2p 协议实现细节。
- 不展示过多代码片段。
- 不做产品营销式页面。
- 不把旧版 `p2p_relay_status` 作为当前主流程介绍。
- 不宣称自然语言联系人解析已经实现。
