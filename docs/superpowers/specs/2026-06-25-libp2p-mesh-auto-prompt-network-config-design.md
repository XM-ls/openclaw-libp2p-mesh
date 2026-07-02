# libp2p-mesh 自动提示词与网络默认配置设计规格

## 概述

`libp2p-mesh` 需要在安装后具备可直接运行的默认体验：插件注册时自动安装或更新其托管的 `AGENTS.md` 提示词区块，并在用户没有显式配置网络字段时自动使用安全的网络默认值。这样首次使用不再依赖用户先运行 `openclaw libp2p-mesh prompt install` 或 `openclaw libp2p-mesh setup`。

当前的 `setup` 和 `prompt install` CLI 仍保留，但定位调整为高级配置、手动修复和显式维护路径。运行时默认配置由纯函数合并，自动提示词安装由非阻塞、非抛错包装器执行，插件生命周期在构造 mesh/router 前应用这些默认行为。

## 目标

- 当插件配置缺失或不是对象时，运行时自动使用 mDNS、NAT traversal、DHT 和默认 delivery ACK timeout。
- 当用户显式配置任意网络、入站投递或其他插件字段时，保留用户值，只补齐缺失默认值。
- 插件注册时自动安装或更新 `~/.openclaw/workspace/AGENTS.md` 中的 libp2p-mesh 托管提示词区块。
- 自动提示词安装失败时只记录 warning，不阻塞插件注册、mesh 构造或 gateway 启动。
- 保留 `setup` 和 `prompt install` 作为高级配置和手动修复命令。
- README 将默认路径改为自动 setup，避免把手动命令描述为首次使用必需步骤。

## 非目标

- 不实现 channel allowlist。
- 不实现入站目标自动发现或自动同步。
- 不实现 targetless delivery。
- 不改变现有提示词托管 marker 语义。
- 不改变现有 `setup` 向导的高级网络配置能力。
- 不手动编辑 `dist/**`；构建产物只由 `npm run build` 生成。

## 架构

新增两个小型运行时能力，并在插件注册入口集中接入：

1. `src/setup-config.ts` 提供 `applyDefaultMeshConfig()` 纯函数。该函数接收现有 `MeshConfig | undefined`，返回补齐默认值后的 `MeshConfig`。
2. `src/prompt-config.ts` 提供 `autoInstallAgentPrompt()`。该函数调用现有 `installAgentPromptFile()`，根据创建或更新结果记录 info，失败时记录 warn 并吞掉异常。
3. `src/plugin.ts` 的 `registerLibp2pMeshWithDeps()` 在创建 mesh/router 前调用 `applyDefaultMeshConfig()`，并以 fire-and-forget 方式启动 `autoInstallAgentPrompt({ logger: api.logger })`。

高层流程：

```text
OpenClaw loads plugin
  -> registerLibp2pMeshWithDeps(api, deps)
  -> config = applyDefaultMeshConfig(api.pluginConfig)
  -> void autoInstallAgentPrompt({ logger: api.logger })
  -> createMeshNetwork({ config, ... })
  -> createInstanceRouter({ config, ... })
  -> register services / channels / tools / hooks / CLI
```

## 组件

### 默认配置合并

`src/setup-config.ts` 新增：

```ts
export function applyDefaultMeshConfig(config: MeshConfig | undefined): MeshConfig;
```

默认字段：

```ts
{
  discovery: "mdns",
  enableNATTraversal: true,
  enableDHT: true,
  deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
}
```

合并规则：

- `undefined`、非对象和数组都视为缺失配置。
- 默认值先写入，用户配置后展开，因此用户显式配置优先。
- `inboundTargets`、`inboundChannel`、`inboundTarget`、`bootstrapList`、`relayList`、`announceAddrs` 等现有字段原样保留。

### 自动提示词安装

`src/prompt-config.ts` 新增：

```ts
export type PromptInstallLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type AutoInstallAgentPromptOptions = {
  agentsPath?: string;
  logger?: PromptInstallLogger;
  install?: (agentsPath?: string) => Promise<PromptInstallResult>;
};

export async function autoInstallAgentPrompt(
  options?: AutoInstallAgentPromptOptions,
): Promise<void>;
```

行为：

- 默认使用现有 `installAgentPromptFile()`。
- `result.existed === false` 时记录：

```text
[libp2p-mesh] Installed AGENTS.md prompt block automatically.
```

- `result.existed === true` 时记录：

```text
[libp2p-mesh] Updated AGENTS.md prompt block automatically.
```

- 安装失败时记录：

```text
[libp2p-mesh] Failed to install AGENTS.md prompt automatically: <message>
```

### 插件生命周期接线

`src/plugin.ts` 的依赖注入类型增加：

```ts
export type Libp2pMeshPluginDeps = {
  createMeshNetwork?: typeof createMeshNetwork;
  createInstanceRouter?: typeof createInstanceRouter;
  autoInstallAgentPrompt?: (options?: AutoInstallAgentPromptOptions) => Promise<void>;
};
```

`registerLibp2pMeshWithDeps()` 使用默认化后的 `config` 创建 mesh 和 router。自动提示词安装通过依赖注入支持测试，但默认使用真实 `autoInstallAgentPrompt()`。

## 数据流

### 配置数据流

```text
api.pluginConfig
  -> applyDefaultMeshConfig()
  -> config
  -> createMeshNetwork({ config })
  -> createInstanceRouter({ config })
  -> inbound handler / router behavior continues using same config
```

用户配置只在内存中被合并为运行时配置。本设计不要求自动把默认值写回 `openclaw.json`。

### 提示词安装数据流

```text
registerLibp2pMeshWithDeps()
  -> autoInstallAgentPrompt({ logger: api.logger })
  -> installAgentPromptFile(agentsPath?)
  -> create or replace managed block in AGENTS.md
  -> info/warn log
```

`installAgentPromptFile()` 继续只管理 `LIBP2P_MESH_PROMPT_START` 和 `LIBP2P_MESH_PROMPT_END` marker 之间的区块，不覆盖用户在文件中的其他内容。

## 错误处理

- 默认配置合并必须是纯函数，不访问文件系统，不抛出因非对象配置导致的异常。
- 自动提示词安装捕获所有异常，并将 `Error.message` 或 `String(error)` 写入 warning。
- 自动提示词安装不被 `await` 阻塞插件注册；即使安装失败，mesh/router 构造和服务注册仍继续。
- 如果 logger 缺少 `info` 或 `warn` 方法，对应日志调用应安全跳过。
- 手动 `prompt install` CLI 保持原有错误暴露语义，作为用户主动修复路径。

## 测试策略

新增 focused node:test 覆盖：

- `test/setup-config.test.ts`
  - 缺失配置返回完整默认网络配置。
  - 显式用户网络字段优先于默认值。
  - 入站投递配置在默认合并后保留。
  - 非对象配置按缺失配置处理。

- `test/prompt-config.test.ts`
  - `installAgentPromptFile()` 能创建含托管区块的 `AGENTS.md`。
  - 已有 `AGENTS.md` 中只替换托管区块，保留用户内容。
  - `autoInstallAgentPrompt()` 对 install/update 写入预期 info 日志。
  - `autoInstallAgentPrompt()` 在安装失败时写入 warn 且不抛错。

- `test/plugin-lifecycle.test.ts`
  - `registerLibp2pMeshWithDeps()` 将默认化后的 config 传给 mesh 和 router。
  - 显式配置被保留，缺失默认字段被补齐。
  - 自动提示词安装被启动，并收到 `api.logger`。

验证命令：

```bash
npm test -- test/setup-config.test.ts test/prompt-config.test.ts test/plugin-lifecycle.test.ts
npm test
npm run build
```

README 验证：

```bash
rg -n "Then run the setup wizard|prompt install|完成 `setup` 或 `prompt install`|run `openclaw libp2p-mesh setup`" README.md
```

匹配结果只能描述高级配置或手动修复用途，不能再把 `setup` 或 `prompt install` 作为首次默认路径的必需步骤。

## 证据层映射 (Evidence Layer Mapping)

| Spec 章节 | 关键陈述 | 证据层 | 说明 |
|-----------|----------|--------|------|
| 概述 | 插件应自动安装提示词并自动补齐网络默认值 | `design intent` | 来自实施计划的目标态 |
| 目标 | 首次使用不再依赖 `setup` 或 `prompt install` | `design intent` | 计划要求的用户体验变化 |
| 非目标 | 不实现 channel allowlist、target auto-discovery、targetless delivery | `design intent` | 实施计划明确排除 |
| 架构 | 在 `setup-config.ts`、`prompt-config.ts` 和 `plugin.ts` 三处接入 | `design intent` | 计划指定的模块边界 |
| 组件 | `applyDefaultMeshConfig()` 和 `autoInstallAgentPrompt()` 的接口 | `design intent` | 目标接口，待实现后转为 repo-observed fact |
| 数据流 | 默认 config 流入 mesh/router，提示词安装 fire-and-forget | `design intent` | 计划中的生命周期设计 |
| 错误处理 | 自动提示词安装失败只 warn 不 throw | `design intent` | 目标故障语义 |
| 测试策略 | 三个 focused test 文件和 full verification | `design intent` + `report synthesis` | 计划中的验收路径与覆盖判断 |

## Report 对齐 (Report Alignment)

对应章节：

- Report 章节：N/A
- Report 文件：N/A

本仓库当前任务是插件设计与实现计划转换，不对应单独的研究 report 章节。

进度追踪：

- 实现前状态：`design intent`
- 实现后状态：`repo-observed fact`
- 更新位置：实现完成后可在 README 和对应计划文件的任务勾选状态中反映进度。

禁止：

- 不把本 spec 中的目标行为描述为已经实现。
- 不把计划中的默认配置写回行为误写为已存在的持久化能力。

## Harness 设计 (必需)

### 上下文工程

- **输入上下文**: 实施计划、现有 `src/setup-config.ts`、`src/prompt-config.ts`、`src/plugin.ts`、README 和相关测试习惯。
- **上下文组装**: 先从计划提取接口、生命周期、测试和文档要求，再按文件边界组织实现任务。
- **上下文限制**: 只读取与默认配置、提示词安装、插件注册和 README 安装说明相关的文件；不展开 libp2p 底层网络实现。

### 工具编排

- **可用工具**: `rg`/`sed` 用于阅读，`apply_patch` 用于编辑，`npm test` 和 `npm run build` 用于验证。
- **输入验证**: 测试用例验证非对象配置、显式配置覆盖、提示词 marker 替换和依赖注入路径。
- **输出解析**: 以 node:test 通过/失败、build exit code 和 README 搜索结果作为验收输出。
- **错误处理**: 如果 focused test 失败，先定位失败测试对应组件；如果 build 失败，优先处理类型导出和 ESM import 路径。
- **超时管理**: focused test 优先运行，full test 和 build 放在实现后；长耗时命令失败时保留输出用于诊断。

### 验证循环

- **模式验证**: TypeScript 类型检查和 node:test import 路径验证新增导出是否正确。
- **语义验证**: 测试断言默认值、用户覆盖、托管区块替换和非阻塞安装语义。
- **测试断言**: 每个新增组件至少有一个失败优先测试，再实现并跑通 focused tests。
- **重试策略**: 失败时按 `setup-config`、`prompt-config`、`plugin lifecycle` 的依赖顺序逐层修复，不先改 README 掩盖行为问题。

### 成本预算

- **预算上限**: 该变更应保持为小范围实现，主要编辑 4 个源码/文档文件和 3 个测试文件。
- **熔断器**: 如果需要改动 mesh、router 或 CLI 大量逻辑才能通过测试，应暂停并重新审查范围。
- **成本跟踪**: 以最终 diff、focused test 数量和 full verification 命令作为工作量边界。

### 可观测性

- **执行追踪**: 自动提示词安装通过 info/warn 日志暴露创建、更新或失败结果。
- **指标**: 不新增运行时指标。
- **评估标准**: 缺省安装后无需 `setup`/`prompt install` 即具备默认网络配置和托管提示词；测试和 build 通过。
- **告警**: 自动提示词安装失败时写 warning，但不升级为启动失败。

## 开放问题

- 自动提示词安装的默认 `agentsPath` 继续沿用现有 `installAgentPromptFile()` 默认路径；本设计不重新定义路径解析规则。
- README 是否需要同步其他外部文档或发布说明，不在本 spec 范围内。
- `dist/**` 是否随提交纳入版本控制取决于仓库发布策略；本设计只要求由 build 生成，不手工编辑。
