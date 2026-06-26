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

PPTX 风格应清晰、正式、偏工程技术汇报。整体观感应像“系统设计说明”，而不是产品宣传页或课堂科普页。视觉目标是帮助导师快速建立链路模型：谁发起、哪个模块处理、消息如何进入 P2P、远端如何投递给用户、失败如何回传。

### 版式基调

- 使用 16:9 横版 PPTX。
- 以白底或极浅灰背景为主，保证投影和屏幕共享时清晰。
- 每页上方固定标题区，正文区采用“两栏”或“上图下文”布局。
- 每页只保留一个主结论，避免把 spec 文字直接堆到页面上。
- 每页不超过 4 个核心 bullet；流程页可以少写文字，多用箭头和标签。
- 页脚可放短小的章节标识，例如“链路 / 路由 / 投递 / 可靠性”。

### 配色

- 主色使用深蓝灰或深青色，表达网络和工程系统感。
- 强调色使用绿色表示成功投递、橙色表示等待或超时、红色表示失败。
- `instanceId`、`peerId`、`ACK`、`user-message` 等关键词可以使用统一的浅色标签样式。
- 避免大面积紫色渐变、深色全屏背景、装饰性光效或营销风格插画。

推荐颜色方向：

- 背景：`#F8FAFC` 或白色。
- 正文：`#0F172A`。
- 次级文字：`#475569`。
- 主强调：`#0F766E`。
- 成功：`#16A34A`。
- 警告/超时：`#D97706`。
- 失败：`#DC2626`。
- 连接线：`#94A3B8`。

### 字体与层级

- 标题使用 30-36 pt，短句化。
- 副标题或页内结论使用 18-22 pt。
- 正文 bullet 使用 16-20 pt。
- 代码、工具名和字段名使用等宽字体或等宽样式，例如 `p2p_send_instance_message`、`instance-peer.json`。
- 不使用过小代码块；如果必须展示 JSON，只展示 4-6 行关键字段。

### 图形语言

PPT 应形成一致的“模块盒子 + 箭头 + 状态标签”语言：

- 用户/channel：用圆角矩形或人物/消息图标表示，例如“用户 A 飞书”“用户 B 飞书”。
- OpenClaw 实例：用较大的容器框表示，内部放 Agent、Tools、InstanceRouter、MeshNetwork。
- P2P 网络：用中间横向通道或云状区域表示，但不要做复杂网络拓扑。
- 消息类型：用小标签表示，例如 `instance-announce`、`user-message`、`delivery-ack`。
- 成功路径：实线箭头。
- ACK 返回路径：反向虚线箭头。
- 失败路径：红色或橙色短箭头加错误标签。

### 页面类型规范

1. 标题页：简洁标题 + 一句话副标题 + 小型端到端链路线条图。
2. 背景页：左侧放“旧方式 peerId 直发”，右侧放“新方式 instanceId 发消息”，形成对比。
3. 总体链路页：用横向 7 步流程图，突出“用户可见”和“ACK 回传”。
4. 工具触发页：左侧放用户飞书指令气泡，右侧放工具调用卡片，强调 Agent 选择主工具。
5. 映射表页：上方画 announce 流程，下方展示 `instance-peer.json` 的简化表格。
6. 消息结构页：使用三张卡片并列展示 `instance-announce`、`user-message`、`delivery-ack`，突出职责差异。
7. 入站可见页：画远端 OpenClaw 内部处理链路，从 `user-message` 到 Feishu `sendText`。
8. ACK 与错误页：用状态机或表格展示 success、remote failure、timeout 三类结果。
9. 工具能力页：用三组表格呈现低层 peer 工具、身份网络工具、instance routing 工具。
10. 网络可达性页：用分层能力图展示 mDNS/bootstrap/DHT/NAT/relay，不深入协议细节。
11. 安全边界页：用“允许/禁止”两栏，强调普通文本转发、不执行远端指令、去重、防循环、移除 shell。
12. 总结页：三层价值金字塔或三列卡片：用户层、Agent 层、网络层。

### 讲解辅助

- 每张流程图要能让讲解者顺着箭头讲，不依赖大段备注。
- 关键术语第一次出现时加简短解释，例如 `instanceId = OpenClaw 实例身份`。
- “用户如何看见消息”和“用户指令如何触发工具”应在视觉上出现两次：一次在总体链路页，一次在对应细节页。
- 错误处理不只列异常名，要展示错误如何回到发送方用户。

### 不采用的视觉方式

- 不使用复杂动画。
- 不使用大段源代码截图。
- 不使用花哨渐变、装饰性背景图、3D 网络球或营销海报风格。
- 不把所有模块堆成一张过密架构图；复杂链路拆成总体链路、路由、投递、ACK 四页讲。

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
