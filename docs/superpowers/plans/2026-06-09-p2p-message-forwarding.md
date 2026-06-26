# P2P 消息转发实现计划

> **给执行者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐步实现此计划。步骤使用复选框（`- [ ]`）语法以便跟踪。

**目标：** 实现两台电脑上的 OpenClaw 通过 libp2p P2P 网络双向转发消息——用户在电脑A的飞书上发消息，Agent 自动判断是否需要转发到电脑B，电脑B 收到后通过飞书回复其用户，反之亦然。

**架构：** 在现有插件基础上，将 `inbound.ts` 从"仅打印日志"改为"收到 P2P 消息后通过 OpenClaw channel 转发给本地用户"。`plugin.ts` 负责将 channel 的发送能力注入 inbound handler。Agent 的行为（何时转发、何时自动回复）由 system prompt 驱动，无需在插件中硬编码。

**技术栈：** TypeScript, libp2p, OpenClaw Plugin SDK

**依赖关系图：**
```
任务 1 ──→ 任务 2 ──→ 任务 3
                               │
任务 4（独立，可并行）─────────────┘
```

---

### 任务 1: 实现 inbound 消息转发逻辑

**Harness（测试框架）:**

- **范围：** 修改 `src/inbound.ts`，将 P2P 收到的 direct 消息通过 `sendToChannel` 回调转发到 OpenClaw channel；broadcast 消息仅记录日志。不修改任何其他文件。
- **前置条件：** 无
- **测试入口：** `npx tsx src/inbound.ts`（手动验证，当前项目无测试框架）
- **通过标准：** `handleP2PInbound` 在收到 direct 消息时，调用 `sendToChannel` 并传入正确的 channelId、target、文本内容；broadcast 消息不调用 `sendToChannel`
- **失败恢复：** `git checkout -- src/inbound.ts`
- **依赖：** 无
- **证据层：** `design intent`

**文件:**

- 创建：`src/inbound.ts`（覆盖现有内容）
- 不修改其他文件

**行为清单（Behavior List）:**

- [ ] 行为 1: 收到 `type: "direct"` 的 P2P 消息时，调用 `sendToChannel` 回调，channelId 为 `"libp2p-mesh"`，target 为消息的 `from` 字段，text 格式为 `[来自 {from}]\n{payload}`
- [ ] 行为 2: 收到 `type: "broadcast"` 的 P2P 消息时，仅记录日志，不调用 `sendToChannel`
- [ ] 行为 3: `sendToChannel` 不存在时（为 undefined），direct 消息不转发，仅记录日志
- [ ] 行为 4: `msg.payload` 为空时，不调用 `sendToChannel`
- [ ] 行为 5: `sendToChannel` 调用失败时，记录 error 日志但不抛异常

**接口合同（Interface Contract）:**

```typescript
// InboundHandlerDeps — 依赖注入接口
export type InboundHandlerDeps = {
  logger?: {
    info?: (msg: string) => void;
    debug?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  sendToChannel?: (channelId: string, target: string, text: string) => Promise<void>;
};

// handleP2PInbound — 入口函数签名
export function handleP2PInbound(msg: P2PMessage, deps: InboundHandlerDeps): void;
```

- [ ] **步骤 1：编写实现代码**（Green）

基于行为清单和接口合同，实现 `src/inbound.ts`：

- 定义 `InboundHandlerDeps` 类型，包含可选的 `logger` 和 `sendToChannel`
- 实现 `handleP2PInbound(msg, deps)`：
  - direct 消息：构造 `[来自 ${msg.from}]\n${msg.payload}`，调用 `deps.sendToChannel("libp2p-mesh", msg.from, forwardText)`，catch 错误记录日志
  - broadcast 消息：记录 info 日志
  - 无 `sendToChannel` 时 fallback 到纯日志模式

- [ ] **步骤 2：编译验证**

```bash
npx tsc --noEmit
```

预期：编译通过，无类型错误。

- [ ] **步骤 3：提交代码**

```bash
git add src/inbound.ts
git commit -m "feat(inbound): forward P2P direct messages to local channel"
```

---

### 任务 2: 修改 plugin.ts 将 channel 发送能力注入 inbound handler

**Harness（测试框架）:**

- **范围：** 修改 `src/plugin.ts`，将 `createLibp2pMeshChannel` 返回的 channel 实例的 `messaging.sendText` 能力作为 `sendToChannel` 回调传入 `handleP2PInbound`。不修改 `inbound.ts`、`mesh.ts`、`channel.ts`。
- **前置条件：** 任务 1 已提交
- **测试入口：** `npx tsc --noEmit`
- **通过标准：** 编译通过；`registerLibp2pMesh` 中 `mesh.onMessage` 的回调正确调用 `handleP2PInbound` 并传入 `sendToChannel` 实现
- **失败恢复：** `git checkout -- src/plugin.ts`
- **依赖：** 任务 1
- **证据层：** `design intent`

**文件:**

- 修改：`src/plugin.ts`

**行为清单（Behavior List）**

- [ ] 行为 1: `registerLibp2pMesh` 中先创建 `channel` 实例，再注册 Service（而非先注册 Service）
- [ ] 行为 2: `mesh.onMessage` 回调中调用 `handleP2PInbound` 时传入 `sendToChannel`，该回调内部调用 `channel.messaging.sendText({ to, text })`
- [ ] 行为 3: `sendToChannel` 内部 catch 错误并通过 `api.logger.error` 记录
- [ ] 行为 4: 保持现有 registerChannel、registerTool、registerHook 逻辑不变
- [ ] 行为 5: 从 `inbound.ts` 导入 `handleP2PInbound` 和 `InboundHandlerDeps`

**接口合同（Interface Contract）**

```typescript
// registerLibp2pMesh 函数签名不变
export function registerLibp2pMesh(api: OpenClawPluginApi): void;

// channel 实例类型
const channel: ReturnType<typeof createLibp2pMeshChannel>;

// sendToChannel 回调签名（与 InboundHandlerDeps 对齐）
sendToChannel: (channelId: string, target: string, text: string) => Promise<void>;
```

- [ ] **步骤 1：编写实现代码**（Green）

- 导入 `handleP2PInbound` 和 `InboundHandlerDeps`（从 `./inbound.js`）
- 将 `const channel = createLibp2pMeshChannel(mesh)` 移到 `registerService` 之前
- 在 `mesh.onMessage` 回调中，调用 `handleP2PInbound(msg, { logger: api.logger, sendToChannel: async (...) => { ... } } satisfies InboundHandlerDeps)`
- `sendToChannel` 内部调用 `channel.messaging.sendText({ to: target, text })`，catch 后用 `api.logger.error` 记录
- 其余 registerChannel、registerTool、registerHook 逻辑保持原样

- [ ] **步骤 2：编译验证**

```bash
npx tsc --noEmit
```

预期：编译通过，无类型错误。

- [ ] **步骤 3：提交代码**

```bash
git add src/plugin.ts
git commit -m "feat(plugin): wire channel send to inbound handler"
```

---

### 任务 3: 安装插件到 OpenClaw 并验证端到端

**Harness（测试框架）:**

- **范围：** 在两台电脑上安装插件、配置 system prompt、启动 gateway、验证 P2P 消息可双向到达。不修改插件代码。
- **前置条件：** 任务 1 和任务 2 已提交；插件已构建（`dist/` 目录存在）
- **测试入口：** 在两台电脑上分别执行 `openclaw gateway`，观察日志输出
- **通过标准：** 两台 gateway 启动后日志显示 libp2p 节点启动成功、peer ID 可读；通过 `p2p_list_peers` 工具确认对方在线
- **失败恢复：** `openclaw plugin uninstall libp2p-mesh`
- **依赖：** 任务 1, 任务 2
- **证据层：** `repo-observed fact`

**文件:**

- 修改：两台电脑上的 `~/.openclaw/config.json`
- 新建：`docs/superpowers/plans/2026-06-09-p2p-install-guide.md`（安装验证文档）

**行为清单（Behavior List）**

- [ ] 行为 1: 在两台电脑上执行 `openclaw plugin install /path/to/openclaw-libp2p-mesh` 安装插件
- [ ] 行为 2: 构建插件：在插件目录执行 `npm install && npx tsc`
- [ ] 行为 3: 在 config.json 中添加 system prompt（两台机器相同）
- [ ] 行为 4: 启动 gateway 后，日志显示 `[libp2p-mesh] Service started. Peer ID: xxx`
- [ ] 行为 5: 通过飞书向 Agent 发送消息，Agent 正常回复（验证 P2P 插件加载不影响正常对话）
- [ ] 行为 6: 在一台电脑上调用 `p2p_list_peers` 工具，能看到另一台电脑的 peerId

**接口合同（Interface Contract）**

```json
// config.json 中新增的 agents 配置
{
  "agents": {
    "defaults": {
      "systemPrompt": "你是用户的飞书助手。当用户要求你给另一台电脑发消息时，调用 p2p_send_message 工具，peerId 填目标电脑的 peerId，message 填要转发的内容。当收到以 [来自 xxx] 开头的消息时，这是从另一台电脑转发来的，根据内容决定是直接回复还是请用户确认。其他情况正常回复用户。"
    }
  },
  "plugins": {
    "config": {
      "libp2p-mesh": {
        "discovery": "mdns"
      }
    }
  }
}
```

- [ ] **步骤 1：构建插件**

```bash
cd /path/to/openclaw-libp2p-mesh
npm install
npx tsc
```

预期：`dist/` 目录生成，包含编译后的 JS 文件。

- [ ] **步骤 2：在两台电脑上安装插件**

```bash
openclaw plugin install /path/to/openclaw-libp2p-mesh
```

预期：安装成功，插件出现在 `plugins.entries` 中。

- [ ] **步骤 3：配置 system prompt**

编辑两台电脑的 `~/.openclaw/config.json`，在 `agents.defaults` 下添加 `systemPrompt`（见上方接口合同）。

- [ ] **步骤 4：启动 gateway 并验证**

```bash
openclaw gateway
```

预期日志：
- `[libp2p-mesh] Service started. Peer ID: QmXxx...`
- `[libp2p-mesh] Listening on: /ip4/0.0.0.0/tcp/xxxxx`
- 正常飞书消息收发无异常

- [ ] **步骤 5：验证 P2P 连通性**

在飞书中对任一 bot 发送：
```
列出已连接的 peers
```

预期：Agent 调用 `p2p_list_peers` 工具，返回对方电脑的 peerId。

- [ ] **步骤 6：提交配置变更**

```bash
git add ~/.openclaw/config.json
git commit -m "feat(config): add P2P system prompt and plugin config"
```

---

### 任务 4: 编写跨网络 bootstrap 配置文档（可选）

**Harness（测试框架）:**

- **范围：** 编写 bootstrap 跨网络配置指南，当两台电脑不在同一局域网时使用。不修改代码。
- **前置条件：** 任务 3 已完成（局域网验证通过）
- **测试入口：** 文档可读性检查
- **通过标准：** 文档包含获取公网地址、配置 bootstrapList、验证跨网络连接的完整步骤
- **失败恢复：** 无代码风险，仅文档可回滚
- **依赖：** 任务 3（可独立编写，但需知道实际 peerId 格式）
- **证据层：** `design intent`

**文件:**

- 创建：`docs/bootstrap-setup.md`

- [ ] **步骤 1：编写 bootstrap 配置文档**

文档需包含：
1. 如何获取每台电脑的公网可达地址（公网 IP + 端口映射 或 VPS 中转）
2. 如何从 `peerId` 和地址构造 bootstrap 多地址
3. 在 config.json 中配置 `discovery: "bootstrap"` + `bootstrapList`
4. 验证跨网络连通性的命令
5. 防火墙/端口映射注意事项

- [ ] **步骤 2：提交文档**

```bash
git add docs/bootstrap-setup.md
git commit -m "docs: add cross-network bootstrap setup guide"
```

---

## Report 进度更新

### 1. 更新进度章节
- [ ] 标记"P2P 消息中继"为已完成（任务 1-3 commit SHA 填入）
- [ ] 如有偏离原始 spec 的地方，在"风险与边界"中注明

### 2. 更新风险/下一步章节
- [ ] 补充风险项：跨网络依赖 bootstrap，如无公网可达节点则无法互联
- [ ] 补充风险项：P2P 消息无端到端确认机制，发送失败仅记录日志

### 3. 证据层标记
- [ ] 任务 1-2 代码 → `repo-observed fact`
- [ ] 任务 4 文档 → `design intent`

### 4. 交叉检查
- [ ] 进度章节未把未实现的 roadmap 写成已实现事实
- [ ] 风险章节未遗漏已知风险

---

## 计划完成后的代码质量审查

所有任务完成后，必须调用 `superpowers:requesting-code-review` 进行统一代码质量审查，审查范围涵盖全部 commit。审查通过后方可合并。
