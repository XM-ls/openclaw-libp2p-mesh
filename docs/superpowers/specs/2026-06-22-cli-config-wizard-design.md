# CLI Config Wizard Design

> 为 libp2p-mesh 插件增加 CLI 配置向导和增量配置子命令，使用户无需手动编辑 `openclaw.json` 即可完成插件配置。

## 动机

当前 libp2p-mesh 插件的配置流程为：
1. `openclaw install libp2p-mesh` 安装插件
2. 用户手动打开 `~/.openclaw/openclaw.json`
3. 手写 `plugins.libp2p-mesh` 和 `channels.libp2p-mesh` 配置块

步骤 2 和 3 对非技术用户不友好，且容易写错 JSON 格式。本设计提供一套 CLI 工具链，让用户通过终端交互完成配置，做到"装完即配，配完即用"。

## 架构

新增 `src/cli.ts` 模块，通过 OpenClaw SDK 的 `registerCli` 注册 CLI 子树。现有 `index.ts`、`src/plugin.ts`、`src/instance-router.ts`、`src/agent-tools.ts` 等模块不做修改。

```
用户终端
    │
    ▼
openclaw libp2p-mesh <subcommand>     ← Commander.js 路由
    │
    ▼
┌─────────────────────────────────────┐
│  src/cli.ts                         │
│  ├─ registerCli()                   │  ← SDK 回调入口，挂载子命令树
│  ├─ setup 子命令 → setupWizard()    │  ← 交互式分层向导
│  └─ config 子命令                   │  ← 增量增删改查
│       ├─ list                       │
│       ├─ get <key>                  │
│       ├─ set <key> <value>          │
│       └─ unset <key>                │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌───────────┐    ┌──────────────────┐
│ src/      │    │ Config I/O       │
│ wizard.ts │    │ 读/写 openclaw.  │
│ (交互问答) │    │ json 的纯函数     │
└───────────┘    └──────────────────┘
```

- **依赖**：Commander.js 由 OpenClaw 运行时注入（`registerCli` 回调收到 Commander program 对象）。交互式问答使用 Node.js 内置 `readline` 模块，零第三方依赖。
- **Config I/O**：复用 OpenClaw SDK 注入的 `OpenClawConfig` 做读取；写入时直接操作 JSON 文件，采用备份→合并→回写流程。

## 命令树

```
openclaw libp2p-mesh
│
├── setup              ← 交互式配置向导（分层模式）
│
└── config             ← 增量配置管理
    ├── list            ← 列出当前所有非默认配置
    ├── get <key>       ← 读取单个配置值
    ├── set <key> <value> [--add | --remove]  ← 设置配置值
    └── unset <key>     ← 删除 key，恢复默认值
```

## setup 子命令：分层向导

向导分两层。第一层覆盖核心路径（必过），第二层覆盖高级选项（可选跳过）。

### 第一层：核心路径

| 步骤 | 交互内容 |
|------|---------|
| step 1 | 选择 discovery 模式：mDNS（默认）/ bootstrap / DHT |
| step 2 | 若选 bootstrap 或 DHT：逐行输入 bootstrap 节点多地址，空行结束 |
| step 3 | 选择接收 P2P 消息的 channel（自动读取已安装的 channel 插件列表），输入 target（如 `user:ou_xxx`） |
| step 3+ | "是否添加更多接收目标？" 若 yes 则重复 step 3，逐个累积为 `inboundTargets` |
| step 4 | 预览即将写入的配置，用户确认后写入 `openclaw.json` |

用户随时可 Ctrl+C 退出，不会写入任何配置。

### 第二层：高级配置（可选）

核心路径完成后询问"需要在不同网络之间使用吗？"

若用户选 yes，则引导以下项：
- 固定监听端口（`listenAddrs`）
- NAT 穿透主开关（`enableNATTraversal`）
- Circuit Relay 节点列表（`relayList`）
- 自定义实例名称（`instanceName`）

若用户选 no，全部保留默认值，直接跳过。

所有步骤结束后再次预览完整配置并确认写入。

### 交互示例

```
$ openclaw libp2p-mesh setup

┌─────────────────────────────────────────────┐
│   🕸️  libp2p-mesh 配置向导                    │
│                                              │
│   我们将引导你完成 P2P Mesh 网络的基础配置。     │
│   任何时候按 Ctrl+C 可退出，配置不会被保存。     │
└─────────────────────────────────────────────┘

? 选择节点发现方式：
  1. mDNS — 局域网自动发现（默认，同一 WiFi 下推荐）
  2. Bootstrap — 手动指定已知节点地址（跨网络场景）
  3. DHT — Kademlia 分布式发现（需要至少一个 bootstrap 入口）
  → 2

? 输入 Bootstrap 节点地址（每行一个，空行结束）：
  /ip4/198.51.100.5/tcp/4001/p2p/12D3KooW...
  ↵
  ✓ 已添加 1 个 bootstrap 节点

? 选择接收 P2P 消息的聊天频道：
  1. Feishu（飞书）
  2. Telegram
  → 1

? 输入飞书的接收目标（如 user:ou_xxx 或 chat:oc_xxx）：
  → user:ou_abc123

? 是否添加更多接收目标？（y/N）
  → n

┌─────────────────────────────────────────────┐
│  即将写入以下配置：                            │
│                                              │
│  discovery:       bootstrap                  │
│  bootstrapList:   1 个节点                    │
│  inboundTargets:                             │
│    - feishu / user:ou_abc123                 │
│                                              │
│  确认写入？（Y/n）                             │
└─────────────────────────────────────────────┘
  → y
  ✓ 配置已写入 ~/.openclaw/openclaw.json

? 需要在不同网络之间使用吗（跨 WiFi / 跨城市）？（y/N）
  → n
  ✓ 基础配置完成。运行 openclaw gateway restart 使配置生效。
```

### 交互规则

- 每个选项标注默认值（如 `（Y/n）`，大写=默认）
- 地址列表支持多行粘贴，单行正则验证多地址格式合法性
- 每个写入点前有预览→确认环节
- 写完提示 `openclaw gateway restart`

## config 子命令：增量配置

面向日常微调场景，不走向导。

### config list

列出当前所有非默认值的配置项。默认值项不展示以减少噪音。

```
$ openclaw libp2p-mesh config list
─────────────────────────────────
  当前 libp2p-mesh 配置：

  discovery:          bootstrap
  bootstrapList:
    /ip4/198.51.100.5/tcp/4001/p2p/12D3KooW...
  inboundTargets:
    - feishu / user:ou_abc123
  enableNATTraversal:  true
  ...共 5 项非默认配置
```

### config get

读取单个配置项的值，支持嵌套路径。

```
$ openclaw libp2p-mesh config get discovery
  bootstrap

$ openclaw libp2p-mesh config get bootstrapList
  /ip4/198.51.100.5/tcp/4001/p2p/12D3KooW...
```

### config set

标量类型直接赋值；数组类型通过 `--add` / `--remove` 操作。

```
$ openclaw libp2p-mesh config set discovery mdns
  ✓ discovery: bootstrap → mdns

$ openclaw libp2p-mesh config set listenAddrs /ip4/0.0.0.0/tcp/4001
  ✓ listenAddrs → ["/ip4/0.0.0.0/tcp/4001"]

$ openclaw libp2p-mesh config set bootstrapList --add /ip4/10.0.0.5/tcp/4001/p2p/12D3KooW...
  ✓ 已追加 bootstrap 节点

$ openclaw libp2p-mesh config set bootstrapList --remove /ip4/203.0.113.10/tcp/4001/p2p/12D3KooW...
  ✓ 已移除 bootstrap 节点
```

### config unset

删除 key，回退到 schema default。

```
$ openclaw libp2p-mesh config unset relayList
  ✓ relayList 已恢复为默认值
```

## 配置读写机制

### 读路径

通过 OpenClaw SDK 的 `registerCli` 回调直接拿到已解析的 `OpenClawConfig`：

```
registerCli({ config }) → config.plugins?.["libp2p-mesh"]?.config
```

无需自己解析 JSON。

### 写路径

自建轻量写入函数（约 40 行）：

1. 读取 `~/.openclaw/openclaw.json` 全文
2. `JSON.parse`
3. 深度合并 setup/config 收集到的配置到 `plugins.libp2p-mesh` 和 `channels.libp2p-mesh` 路径
4. 保留所有其他插件的配置，不做格式化破坏
5. `JSON.stringify` 回写（缩进 2 空格，trailing newline）

### 合并策略

浅合并到 key 级别。向导收集的配置对象作为整体 merged 到目标路径下。已有 key 覆盖，未涉及的 key 保留原值。

### 安全措施

- 写前自动备份：`openclaw.json → openclaw.json.bak`（同目录）
- 写入失败回滚：从 `.bak` 恢复
- 若 `plugins.libp2p-mesh.enabled` 未设置，自动补 `true`；同理 `channels.libp2p-mesh.enabled`

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/cli.ts` | 新增 | CLI 入口，通过 `registerCli` 注册 Commander 子命令树 |
| `src/wizard.ts` | 新增 | `setupWizard()` 纯函数，分层交互式问答逻辑 |
| `src/config-io.ts` | 新增 | `readPluginConfig()` / `writePluginConfig()` 配置读写纯函数 |
| `src/types.ts` | 不改 | 配置类型已完备 |
| `index.ts` | 修改 | 在 `register` 回调中调用 `registerCli` |
| `openclaw.plugin.json` | 不改 | manifest 已完备 |
| `package.json` | 不改 | 无需新增依赖（仅用 Node 内置模块） |
| `README.md` | 修改 | 添加 CLI 配置文档 |

## 错误处理

| 场景 | 行为 |
|------|------|
| 用户 Ctrl+C 退出向导 | 不写入任何配置，打印 "已取消" |
| 写入时磁盘满 | 回滚 .bak，打印 "写入失败，配置未更改" |
| 输入的地址格式非法 | 打印错误提示（如 "多地址必须以 /ip4/ 或 /dns/ 开头"），允许重输 |
| `openclaw.json` 不存在 | 创建新文件，填充最小合法结构 |
| `openclaw.json` JSON 解析失败 | 打印错误，提示用户手动修复 |
| 重复添加相同地址 | 去重提示 "该地址已存在" |
| 移除不存在的地址 | 提示 "未找到该地址" |
| 插件未安装（config 子命令） | 提示 "libp2p-mesh 插件未安装或未启用" |

## 测试

| 测试类型 | 测试内容 |
|----------|---------|
| 单元测试 | `wizard.ts` 输入收集逻辑 / `config-io.ts` 读、合并、写、回滚 |
| 单元测试 | CLI 参数解析（`--add` / `--remove` / key 提取） |
| 集成测试 | 完整 setup 流程 → 检查写入的 JSON 结构 |
| 集成测试 | 完整 setup → 关闭 gateway，再次启动验证配置生效 |
| 集成测试 | config set / unset → 验证 JSON 变更 |
| 边界测试 | 写入失败回滚、空文件、损坏 JSON、地址格式验证 |

## 非目标

- 本设计不提供 Web UI / 图形界面形式的配置
- 不修改 `openclaw.plugin.json` 的 schema 或 manifest 结构
- 不改变现有 `index.ts` 入口和 `registerLibp2pMesh` 插件注册逻辑
- 不引入 `inquirer` / `commander` 等第三方 npm 依赖（Commander 由 OpenClaw 运行时注入；readline 是 Node 内置）

## 与现有 bootstrap-setup.md 的关系

`docs/bootstrap-setup.md` 是面向手动配置的文档式指南，保留不变。本设计新增的 `setup` 向导本质上是将文档指南中的配置步骤转化为交互式流程，二者内容一致但渠道不同。CLI 向导比文档指南多了输入验证和直接写入能力。
