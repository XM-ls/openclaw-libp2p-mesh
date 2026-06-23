# libp2p-mesh setup CLI 实现计划

> **给执行者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐步实现此计划。步骤使用复选框（`- [ ]`）语法以便跟踪。

**目标：** 增加 `openclaw libp2p-mesh setup` 交互式配置向导，让用户不手动编辑 `openclaw.json` 也能创建或编辑 `plugins.entries["libp2p-mesh"].config`，并支持多入站目标配置。

**架构：** 将配置逻辑拆成纯函数模块、交互控制器、配置写入适配器和 CLI 注册入口。纯函数负责生成插件 entry、网络模式字段、`inboundTargets`、旧配置迁移和 preview 数据；交互控制器通过依赖注入的 prompter 与 writer 运行，方便测试取消和确认写入；插件入口只负责注册 `openclaw libp2p-mesh setup`。

**技术栈：** TypeScript ESM、Node 内置 `node:test`、OpenClaw Plugin API `api.registerCli(...)`、OpenClaw runtime config mutation、Commander CLI command object。

**Report 对齐：**
- **对应章节：** 本仓库无独立 report；本计划实现 `docs/superpowers/specs/2026-06-23-libp2p-mesh-configure-cli-design.md`。
- **证据层：** 实现代码和测试完成后属于 `repo-observed fact`；设计文档属于 `design intent`。
- **状态追踪：** 完成后更新本计划文件任务状态；无需更新外部 report 章节。

**依赖关系图：**

```text
任务 1 ──→ 任务 2 ──→ 任务 3 ──→ 任务 4 ──→ 任务 5
                                         │
                                         └────→ 任务 6
```

---

## 文件结构

- 创建 `src/setup-config.ts`：纯配置构建函数。负责插件 entry 创建、网络模式字段、默认 `deliveryAckTimeoutMs`、网络字段清理、channel 候选、target id 生成、重复 target 检查、旧配置迁移。
- 创建 `src/setup-wizard.ts`：交互式向导控制器。通过 `SetupPrompter` 和 `SetupConfigWriter` 依赖注入执行首次配置、编辑配置、preview、取消和确认写入。
- 创建 `src/setup-cli.ts`：OpenClaw CLI 注册适配层。负责把 `openclaw libp2p-mesh setup` 挂到 Commander program，并调用向导。
- 修改 `src/plugin.ts`：调用 setup CLI 注册函数。
- 创建 `test/setup-config.test.ts`：纯配置构建和 target 管理测试。
- 创建 `test/setup-wizard.test.ts`：交互流程、取消安全和写入行为测试。
- 创建 `test/setup-cli.test.ts`：CLI 注册测试。
- 修改 `README.md`：记录 `openclaw libp2p-mesh setup` 的用法和写入路径。

---

## 任务 1: 配置构建基础与网络模式

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `ab95c76` `feat: add setup config network builder`

**Harness（测试框架）:**

- **范围：** 创建 `src/setup-config.ts`，实现插件 entry 创建、默认超时、四种网络模式和网络字段清理。不实现 `inboundTargets` 管理、不实现 CLI 交互、不写配置文件。
- **前置条件：** 当前分支包含已确认 spec；`npm test` 和 `npm run build` 在开始前通过。
- **测试入口：** `npm test -- test/setup-config.test.ts`
- **通过标准：** `test/setup-config.test.ts` 中本任务新增测试全部通过，且 `npm test`、`npm run build` 全部通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 无。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/setup-config.ts`
- 创建：`test/setup-config.test.ts`

**行为清单（Behavior List）:**

- [ ] 首次配置会创建 `plugins.entries["libp2p-mesh"]`。
- [ ] 生成的插件 entry 总是包含 `enabled: true`。
- [ ] 生成配置不写 `channels["libp2p-mesh"]`。
- [ ] LAN 模式生成 `discovery: "mdns"` 和 `deliveryAckTimeoutMs: 15000`。
- [ ] tools-only 模式生成 `discovery: "mdns"`、`inboundTargets: []` 和默认超时。
- [ ] cross-network 模式生成 `discovery: "bootstrap"`、`bootstrapList`、可选 `relayList`、`enableNATTraversal: true` 和默认超时。
- [ ] relay-node 模式生成 `listenAddrs`、`announceAddrs`、`enableNATTraversal: true`、`enableCircuitRelayServer: true` 和默认超时。
- [ ] 切换网络模式会清理旧的网络字段：`discovery`、`bootstrapList`、`relayList`、`listenAddrs`、`announceAddrs`、`enableNATTraversal`、`enableCircuitRelayServer`。

**接口合同（Interface Contract）:**

```ts
import type { MeshConfig } from "./types.js";

export const LIBP2P_MESH_PLUGIN_ID = "libp2p-mesh";
export const DEFAULT_DELIVERY_ACK_TIMEOUT_MS = 15000;

export type SetupMode = "lan" | "cross-network" | "relay-node" | "tools-only";

export type OpenClawConfigLike = {
  plugins?: {
    entries?: Record<string, {
      enabled?: boolean;
      config?: Record<string, unknown>;
    }>;
  };
  channels?: Record<string, { enabled?: boolean } | Record<string, unknown>>;
};

export type CrossNetworkOptions = {
  bootstrapList: string[];
  relayList?: string[];
};

export type RelayNodeOptions = {
  listenAddrs: string[];
  announceAddrs: string[];
};

export function getLibp2pMeshConfig(config: OpenClawConfigLike): MeshConfig | undefined;

export function buildNetworkConfig(
  mode: SetupMode,
  options?: {
    crossNetwork?: CrossNetworkOptions;
    relayNode?: RelayNodeOptions;
  },
): MeshConfig;

export function applyPluginConfig(
  config: OpenClawConfigLike,
  pluginConfig: MeshConfig,
): OpenClawConfigLike;

export function mergeNetworkConfig(
  existing: MeshConfig | undefined,
  networkConfig: MeshConfig,
): MeshConfig;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/setup-config.test.ts`，写入以下完整测试：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  applyPluginConfig,
  buildNetworkConfig,
  getLibp2pMeshConfig,
  mergeNetworkConfig,
  type OpenClawConfigLike,
} from "../src/setup-config.js";

test("applyPluginConfig creates plugins entry without writing channels entry", () => {
  const config: OpenClawConfigLike = {
    channels: {
      feishu: { enabled: true },
    },
  };

  const next = applyPluginConfig(config, buildNetworkConfig("lan"));

  assert.equal(next.plugins?.entries?.["libp2p-mesh"]?.enabled, true);
  assert.deepEqual(next.plugins?.entries?.["libp2p-mesh"]?.config, {
    discovery: "mdns",
    deliveryAckTimeoutMs: DEFAULT_DELIVERY_ACK_TIMEOUT_MS,
  });
  assert.equal(next.channels?.["libp2p-mesh"], undefined);
  assert.deepEqual(next.channels?.feishu, { enabled: true });
});

test("buildNetworkConfig supports lan tools-only cross-network and relay-node modes", () => {
  assert.deepEqual(buildNetworkConfig("lan"), {
    discovery: "mdns",
    deliveryAckTimeoutMs: 15000,
  });

  assert.deepEqual(buildNetworkConfig("tools-only"), {
    discovery: "mdns",
    inboundTargets: [],
    deliveryAckTimeoutMs: 15000,
  });

  assert.deepEqual(
    buildNetworkConfig("cross-network", {
      crossNetwork: {
        bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3bootstrap"],
        relayList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3relay"],
      },
    }),
    {
      discovery: "bootstrap",
      bootstrapList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3bootstrap"],
      relayList: ["/ip4/1.2.3.4/tcp/4001/p2p/12D3relay"],
      enableNATTraversal: true,
      deliveryAckTimeoutMs: 15000,
    },
  );

  assert.deepEqual(
    buildNetworkConfig("relay-node", {
      relayNode: {
        listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
        announceAddrs: ["/ip4/203.0.113.10/tcp/4001"],
      },
    }),
    {
      discovery: "bootstrap",
      listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
      announceAddrs: ["/ip4/203.0.113.10/tcp/4001"],
      enableNATTraversal: true,
      enableCircuitRelayServer: true,
      deliveryAckTimeoutMs: 15000,
    },
  );
});

test("mergeNetworkConfig replaces network fields while preserving inbound targets", () => {
  const existing = {
    discovery: "bootstrap" as const,
    bootstrapList: ["/ip4/old/tcp/4001/p2p/old"],
    relayList: ["/ip4/relay/tcp/4001/p2p/relay"],
    listenAddrs: ["/ip4/0.0.0.0/tcp/4001"],
    announceAddrs: ["/ip4/203.0.113.10/tcp/4001"],
    enableNATTraversal: true,
    enableCircuitRelayServer: true,
    inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    deliveryAckTimeoutMs: 9000,
  };

  assert.deepEqual(mergeNetworkConfig(existing, buildNetworkConfig("lan")), {
    discovery: "mdns",
    inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    deliveryAckTimeoutMs: 15000,
  });
});

test("getLibp2pMeshConfig reads plugin entry config", () => {
  const config: OpenClawConfigLike = {
    plugins: {
      entries: {
        "libp2p-mesh": {
          enabled: true,
          config: {
            discovery: "mdns",
            deliveryAckTimeoutMs: 15000,
          },
        },
      },
    },
  };

  assert.deepEqual(getLibp2pMeshConfig(config), {
    discovery: "mdns",
    deliveryAckTimeoutMs: 15000,
  });
});
```

运行：`npm test -- test/setup-config.test.ts`

预期：FAIL，错误为找不到 `../src/setup-config.js` 或导出函数不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

运行：

```bash
npm test -- test/setup-config.test.ts
```

必须确认失败原因是功能缺失，不是测试语法错误。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/setup-config.ts`，按接口合同实现最小逻辑。不得实现 `inboundTargets` 的添加、编辑、迁移或 CLI。

运行：

```bash
npm test -- test/setup-config.test.ts
```

预期：PASS。

- [ ] **步骤 4：运行完整验证** (Green)

运行：

```bash
npm test
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/setup-config.ts test/setup-config.test.ts
git commit -m "feat: add setup config network builder"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 行为清单每一项都有测试覆盖。
- [ ] `applyPluginConfig()` 只写 `plugins.entries["libp2p-mesh"]`。
- [ ] 网络模式切换会清理旧网络字段。
- [ ] 没有 CLI、prompt、配置写入 side effect。

---

## 任务 2: 多入站目标管理与旧配置迁移

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `f24946d` `feat: add setup inbound target helpers`

**Harness（测试框架）:**

- **范围：** 扩展 `src/setup-config.ts`，实现 channel 候选、target id 生成、重复 target 阻止、`inboundTargets` 添加/编辑/删除/禁用/跳过语义、旧 `inboundChannel/inboundTarget` 迁移。不实现 CLI 交互和配置写入。
- **前置条件：** 任务 1 已提交。
- **测试入口：** `npm test -- test/setup-config.test.ts`
- **通过标准：** setup-config 测试全部通过，完整 `npm test` 和 `npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/setup-config.ts`
- 修改：`test/setup-config.test.ts`

**行为清单（Behavior List）:**

- [ ] 从 `config.channels` 返回已配置 channel 名，并排除 `libp2p-mesh` 自身。
- [ ] 每个 channel 第一次 target id 为 `<channel>-main`。
- [ ] 同一 channel 后续 target id 为 `<channel>-2`、`<channel>-3`。
- [ ] 添加重复 `channel + target` 会返回错误，不改变 target 列表。
- [ ] disable inbound delivery 会写入 `inboundTargets: []`。
- [ ] skip inbound delivery 不写 `inboundTargets`。
- [ ] 旧 `inboundChannel/inboundTarget` 可以转换为一个 `inboundTargets`。
- [ ] replace 旧配置时删除旧字段。
- [ ] keep 旧配置时不新增 `inboundTargets`，保留旧字段。

**接口合同（Interface Contract）:**

```ts
import type { InboundTargetConfig, MeshConfig } from "./types.js";

export type AddInboundTargetResult =
  | { ok: true; targets: InboundTargetConfig[]; added: InboundTargetConfig }
  | { ok: false; targets: InboundTargetConfig[]; error: string };

export type LegacyInboundMigrationMode = "convert" | "keep" | "replace";

export function listConfiguredChannels(config: OpenClawConfigLike): string[];

export function generateInboundTargetId(
  channel: string,
  existingTargets: InboundTargetConfig[],
): string;

export function addInboundTarget(
  existingTargets: InboundTargetConfig[],
  target: { channel: string; target: string },
): AddInboundTargetResult;

export function removeInboundTarget(
  existingTargets: InboundTargetConfig[],
  id: string,
): InboundTargetConfig[];

export function setInboundTargets(
  existing: MeshConfig | undefined,
  targets: InboundTargetConfig[] | undefined,
): MeshConfig;

export function disableInboundDelivery(existing: MeshConfig | undefined): MeshConfig;

export function migrateLegacyInboundConfig(
  existing: MeshConfig,
  mode: LegacyInboundMigrationMode,
  replacementTargets?: InboundTargetConfig[],
): MeshConfig;
```

- [ ] **步骤 1：编写失败的测试** (Red)

在 `test/setup-config.test.ts` 追加：

```ts
import {
  addInboundTarget,
  disableInboundDelivery,
  generateInboundTargetId,
  listConfiguredChannels,
  migrateLegacyInboundConfig,
  removeInboundTarget,
  setInboundTargets,
} from "../src/setup-config.js";

test("listConfiguredChannels returns configured channels with manual fallback handled by wizard", () => {
  assert.deepEqual(
    listConfiguredChannels({
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
        "libp2p-mesh": { enabled: true },
      },
    }),
    ["feishu", "telegram"],
  );
});

test("generateInboundTargetId uses channel-main then channel indexes", () => {
  const existing = [
    { id: "feishu-main", channel: "feishu", target: "user:ou_1" },
    { id: "telegram-main", channel: "telegram", target: "chat:1" },
    { id: "feishu-2", channel: "feishu", target: "chat:2" },
  ];

  assert.equal(generateInboundTargetId("feishu", existing), "feishu-3");
  assert.equal(generateInboundTargetId("telegram", existing), "telegram-2");
  assert.equal(generateInboundTargetId("slack", existing), "slack-main");
});

test("addInboundTarget adds generated id and rejects duplicate channel target", () => {
  const first = addInboundTarget([], { channel: "feishu", target: "user:ou_xxx" });
  assert.equal(first.ok, true);
  assert.deepEqual(first.ok ? first.added : undefined, {
    id: "feishu-main",
    channel: "feishu",
    target: "user:ou_xxx",
  });

  const duplicate = addInboundTarget(first.ok ? first.targets : [], {
    channel: "feishu",
    target: "user:ou_xxx",
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.ok ? undefined : duplicate.error, "inbound target already exists: feishu / user:ou_xxx");
  assert.deepEqual(duplicate.targets, first.ok ? first.targets : []);
});

test("removeInboundTarget removes by id without mutating other targets", () => {
  const targets = [
    { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
    { id: "telegram-main", channel: "telegram", target: "chat:123" },
  ];

  assert.deepEqual(removeInboundTarget(targets, "feishu-main"), [
    { id: "telegram-main", channel: "telegram", target: "chat:123" },
  ]);
});

test("setInboundTargets supports disable and skip semantics", () => {
  assert.deepEqual(disableInboundDelivery({ discovery: "mdns" }), {
    discovery: "mdns",
    inboundTargets: [],
  });

  assert.deepEqual(setInboundTargets({ discovery: "mdns" }, undefined), {
    discovery: "mdns",
  });

  assert.deepEqual(
    setInboundTargets({ discovery: "mdns" }, [
      { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
    ]),
    {
      discovery: "mdns",
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
    },
  );
});

test("migrateLegacyInboundConfig converts keeps or replaces legacy fields", () => {
  const legacy = {
    discovery: "mdns" as const,
    inboundChannel: "feishu",
    inboundTarget: "user:ou_xxx",
  };

  assert.deepEqual(migrateLegacyInboundConfig(legacy, "convert"), {
    discovery: "mdns",
    inboundTargets: [
      { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
    ],
  });

  assert.deepEqual(migrateLegacyInboundConfig(legacy, "keep"), legacy);

  assert.deepEqual(
    migrateLegacyInboundConfig(legacy, "replace", [
      { id: "telegram-main", channel: "telegram", target: "chat:123" },
    ]),
    {
      discovery: "mdns",
      inboundTargets: [
        { id: "telegram-main", channel: "telegram", target: "chat:123" },
      ],
    },
  );
});
```

运行：`npm test -- test/setup-config.test.ts`

预期：FAIL，错误为新增函数未导出。

- [ ] **步骤 2：运行测试确认失败** (Red)

运行：

```bash
npm test -- test/setup-config.test.ts
```

必须确认失败原因是缺少 target 管理函数。

- [ ] **步骤 3：编写最小实现** (Green)

扩展 `src/setup-config.ts`，按接口合同实现 target 管理和迁移逻辑。不实现向导 prompt。

- [ ] **步骤 4：运行完整验证** (Green)

运行：

```bash
npm test -- test/setup-config.test.ts
npm test
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/setup-config.ts test/setup-config.test.ts
git commit -m "feat: add setup inbound target helpers"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 支持多 target。
- [ ] `id` 生成规则符合 spec。
- [ ] 重复 `channel + target` 被阻止。
- [ ] 旧字段迁移行为符合 convert/keep/replace 语义。
- [ ] 没有 CLI 或配置写入 side effect。

---

## 任务 3: 向导控制器与写入安全

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `77ef96f` `feat: add libp2p mesh setup wizard`, `bb4d86c` `fix: complete setup wizard edit flow`

**Harness（测试框架）:**

- **范围：** 创建 `src/setup-wizard.ts`，实现首次配置、已有配置编辑、preview、确认写入、取消不写入、Ctrl+C 取消语义的控制器。不注册真实 CLI，不依赖真实终端输入。
- **前置条件：** 任务 1 和任务 2 已提交。
- **测试入口：** `npm test -- test/setup-wizard.test.ts`
- **通过标准：** 向导测试全部通过，完整 `npm test` 和 `npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1、任务 2。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/setup-wizard.ts`
- 创建：`test/setup-wizard.test.ts`

**行为清单（Behavior List）:**

- [ ] 首次配置会创建 `plugins.entries["libp2p-mesh"]` 并写 `enabled: true`。
- [ ] 首次 LAN + 多 target 流程生成 `discovery: "mdns"`、多个 `inboundTargets`、默认超时。
- [ ] 已有配置进入编辑模式，允许添加 target 并保留网络模式。
- [ ] preview 阶段选择不应用时，不调用 writer。
- [ ] 任意 prompt 抛出 `SetupCancelledError` 时，不调用 writer，并返回 cancelled。
- [ ] apply 确认后才调用 writer。
- [ ] 写入成功后返回 restart 提示文本。

**接口合同（Interface Contract）:**

```ts
import type { MeshConfig } from "./types.js";
import type { OpenClawConfigLike, SetupMode } from "./setup-config.js";

export class SetupCancelledError extends Error {
  constructor();
}

export type SetupPromptChoice =
  | "continue"
  | "cancel"
  | "lan"
  | "cross-network"
  | "relay-node"
  | "tools-only"
  | "add-targets"
  | "disable-inbound"
  | "skip-inbound"
  | "add-target"
  | "finish-targets"
  | "preview-apply";

export type SetupPrompter = {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  select<T extends string>(message: string, choices: Array<{ label: string; value: T }>): Promise<T>;
  input(message: string, options?: { defaultValue?: string; required?: boolean }): Promise<string>;
  print(message: string): void;
};

export type SetupConfigWriter = {
  write(nextConfig: OpenClawConfigLike): Promise<void>;
};

export type SetupWizardResult =
  | { status: "applied"; nextConfig: OpenClawConfigLike; message: string }
  | { status: "cancelled"; message: string };

export type RunSetupWizardOptions = {
  currentConfig: OpenClawConfigLike;
  prompter: SetupPrompter;
  writer: SetupConfigWriter;
};

export function runSetupWizard(options: RunSetupWizardOptions): Promise<SetupWizardResult>;
export function formatPluginEntryPreview(pluginConfig: MeshConfig): string;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/setup-wizard.test.ts`，写入：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  SetupCancelledError,
  formatPluginEntryPreview,
  runSetupWizard,
  type SetupConfigWriter,
  type SetupPrompter,
} from "../src/setup-wizard.js";
import type { OpenClawConfigLike } from "../src/setup-config.js";

function makePrompter(script: Array<string | boolean>): SetupPrompter {
  const values = [...script];
  return {
    async confirm() {
      const value = values.shift();
      assert.equal(typeof value, "boolean");
      return value;
    },
    async select() {
      const value = values.shift();
      assert.equal(typeof value, "string");
      return value;
    },
    async input() {
      const value = values.shift();
      assert.equal(typeof value, "string");
      return value;
    },
    print() {},
  };
}

function makeWriter() {
  const writes: OpenClawConfigLike[] = [];
  const writer: SetupConfigWriter = {
    async write(nextConfig) {
      writes.push(nextConfig);
    },
  };
  return { writer, writes };
}

test("first run applies LAN config with multiple inbound targets after preview confirmation", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    },
    writer,
    prompter: makePrompter([
      true,
      "lan",
      "add-targets",
      "feishu",
      "user:ou_xxx",
      "add-target",
      "telegram",
      "chat:123456",
      "finish-targets",
      true,
    ]),
  });

  assert.equal(result.status, "applied");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.plugins?.entries?.["libp2p-mesh"], {
    enabled: true,
    config: {
      discovery: "mdns",
      inboundTargets: [
        { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
        { id: "telegram-main", channel: "telegram", target: "chat:123456" },
      ],
      deliveryAckTimeoutMs: 15000,
    },
  });
  assert.equal(writes[0]?.channels?.["libp2p-mesh"], undefined);
});

test("existing config edit can add target and keep network mode", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {
      plugins: {
        entries: {
          "libp2p-mesh": {
            enabled: true,
            config: {
              discovery: "mdns",
              inboundTargets: [
                { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
              ],
              deliveryAckTimeoutMs: 15000,
            },
          },
        },
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    },
    writer,
    prompter: makePrompter([
      "inbound-targets",
      "add-target",
      "telegram",
      "chat:123456",
      "finish-targets",
      true,
    ]),
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(writes[0]?.plugins?.entries?.["libp2p-mesh"]?.config, {
    discovery: "mdns",
    inboundTargets: [
      { id: "feishu-main", channel: "feishu", target: "user:ou_xxx" },
      { id: "telegram-main", channel: "telegram", target: "chat:123456" },
    ],
    deliveryAckTimeoutMs: 15000,
  });
});

test("preview rejection cancels without writing", async () => {
  const { writer, writes } = makeWriter();
  const result = await runSetupWizard({
    currentConfig: {},
    writer,
    prompter: makePrompter([true, "tools-only", "disable-inbound", false]),
  });

  assert.equal(result.status, "cancelled");
  assert.equal(writes.length, 0);
});

test("Ctrl+C cancellation exits without writing", async () => {
  const { writer, writes } = makeWriter();
  const prompter: SetupPrompter = {
    async confirm() {
      throw new SetupCancelledError();
    },
    async select() {
      throw new SetupCancelledError();
    },
    async input() {
      throw new SetupCancelledError();
    },
    print() {},
  };

  const result = await runSetupWizard({
    currentConfig: {},
    writer,
    prompter,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.message, "Configuration cancelled. No changes were written.");
  assert.equal(writes.length, 0);
});

test("formatPluginEntryPreview prints enabled plugin entry JSON", () => {
  assert.match(
    formatPluginEntryPreview({
      discovery: "mdns",
      inboundTargets: [{ id: "feishu-main", channel: "feishu", target: "user:ou_xxx" }],
      deliveryAckTimeoutMs: 15000,
    }),
    /"enabled": true/,
  );
});
```

运行：`npm test -- test/setup-wizard.test.ts`

预期：FAIL，错误为找不到 `../src/setup-wizard.js`。

- [ ] **步骤 2：运行测试确认失败** (Red)

运行：

```bash
npm test -- test/setup-wizard.test.ts
```

确认失败原因是向导控制器缺失。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/setup-wizard.ts`。实现依赖注入式向导控制器。实现时遵守：

- 所有用户输入先写入内存变量。
- `writer.write()` 只在最终 `confirm()` 返回 `true` 后调用。
- 捕获 `SetupCancelledError` 并返回 cancelled 结果。
- 不注册 CLI。
- 不访问真实文件系统。

- [ ] **步骤 4：运行完整验证** (Green)

运行：

```bash
npm test -- test/setup-wizard.test.ts
npm test
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/setup-wizard.ts test/setup-wizard.test.ts
git commit -m "feat: add libp2p mesh setup wizard"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 首次配置流程覆盖。
- [ ] 已有配置编辑流程覆盖。
- [ ] Preview 后确认才写入。
- [ ] Cancel 和 Ctrl+C 不写入。
- [ ] 写入路径仍由纯配置构建函数控制，不写 `channels["libp2p-mesh"]`。

---

## 任务 4: OpenClaw CLI 注册与配置写入适配器

**Harness（测试框架）:**

- **范围：** 创建 `src/setup-cli.ts` 并修改 `src/plugin.ts`，注册 `openclaw libp2p-mesh setup`。封装 OpenClaw CLI prompter 和 config writer 适配器。不扩展向导行为，不修改 router 或 agent tools。
- **前置条件：** 任务 1、任务 2、任务 3 已提交。
- **测试入口：** `npm test -- test/setup-cli.test.ts`
- **通过标准：** CLI 注册测试通过，完整 `npm test` 和 `npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 3。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/setup-cli.ts`
- 创建：`test/setup-cli.test.ts`
- 修改：`src/plugin.ts`

**行为清单（Behavior List）:**

- [ ] 注册命令路径 `libp2p-mesh setup`。
- [ ] 命令 action 调用 `runSetupWizard()`。
- [ ] writer 使用 config mutation 写入完整 next config。
- [ ] 注册函数提供 descriptors，使根命令可被 OpenClaw lazy CLI 发现。
- [ ] `registerLibp2pMesh()` 会调用 setup CLI 注册函数。

**接口合同（Interface Contract）:**

```ts
import type { OpenClawPluginApi, OpenClawPluginCliContext } from "openclaw/plugin-sdk/core";
import type { SetupPrompter, SetupConfigWriter } from "./setup-wizard.js";

export type SetupCliDeps = {
  createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
  createWriter?: (api: OpenClawPluginApi) => SetupConfigWriter;
};

export function registerLibp2pMeshSetupCli(api: OpenClawPluginApi, deps?: SetupCliDeps): void;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/setup-cli.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { registerLibp2pMeshSetupCli } from "../src/setup-cli.js";

type FakeCommand = {
  name: string;
  descriptionText?: string;
  children: FakeCommand[];
  actionHandler?: () => Promise<void> | void;
  command(name: string): FakeCommand;
  description(text: string): FakeCommand;
  action(handler: () => Promise<void> | void): FakeCommand;
};

function makeCommand(name: string): FakeCommand {
  return {
    name,
    children: [],
    command(childName: string) {
      const child = makeCommand(childName);
      this.children.push(child);
      return child;
    },
    description(text: string) {
      this.descriptionText = text;
      return this;
    },
    action(handler: () => Promise<void> | void) {
      this.actionHandler = handler;
      return this;
    },
  };
}

function makeApi(root: FakeCommand) {
  const registrations: Array<{ opts?: unknown }> = [];
  const api = {
    config: {},
    runtime: {
      config: {
        current: () => ({}),
        mutateConfigFile: async () => ({ result: undefined }),
      },
    },
    registerCli(registrar: (ctx: { program: FakeCommand; config: unknown; parentPath: string[]; logger: unknown }) => void, opts?: unknown) {
      registrations.push({ opts });
      registrar({ program: root, config: {}, parentPath: [], logger: {} });
    },
  };
  return { api: api as never, registrations };
}

test("registerLibp2pMeshSetupCli registers libp2p-mesh setup command", async () => {
  const root = makeCommand("openclaw");
  const { api, registrations } = makeApi(root);

  registerLibp2pMeshSetupCli(api, {
    createPrompter: () => ({
      async confirm() { return false; },
      async select() { return "cancel"; },
      async input() { return ""; },
      print() {},
    }),
    createWriter: () => ({
      async write() {},
    }),
  });

  const libp2p = root.children.find((child) => child.name === "libp2p-mesh");
  assert.ok(libp2p);
  const setup = libp2p.children.find((child) => child.name === "setup");
  assert.ok(setup);
  assert.equal(typeof setup.actionHandler, "function");
  assert.deepEqual(registrations[0]?.opts, {
    commands: ["libp2p-mesh"],
    descriptors: [
      { name: "libp2p-mesh", description: "Configure libp2p-mesh plugin.", hasSubcommands: true },
    ],
  });
});
```

运行：`npm test -- test/setup-cli.test.ts`

预期：FAIL，错误为找不到 `../src/setup-cli.js`。

- [ ] **步骤 2：运行测试确认失败** (Red)

运行：

```bash
npm test -- test/setup-cli.test.ts
```

确认失败原因是 CLI 注册模块缺失。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/setup-cli.ts` 并修改 `src/plugin.ts`：

- `registerLibp2pMeshSetupCli(api)` 调用 `api.registerCli(...)`。
- 在 registrar 中注册 `program.command("libp2p-mesh").description(...).command("setup").description(...).action(...)`。
- action 调用 `runSetupWizard({ currentConfig: ctx.config, prompter, writer })`。
- writer 内部调用 `api.runtime.config.mutateConfigFile({ afterWrite: "defer", mutate })` 或 OpenClaw 类型允许的等价 afterWrite 值。执行者必须先查看当前 OpenClaw 类型中 `RuntimeConfigAfterWrite` 的取值，并使用类型允许的非自动重启选项。
- `src/plugin.ts` 在 `registerLibp2pMesh(api)` 中调用 `registerLibp2pMeshSetupCli(api)`。

- [ ] **步骤 4：运行完整验证** (Green)

运行：

```bash
npm test -- test/setup-cli.test.ts
npm test
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/setup-cli.ts src/plugin.ts test/setup-cli.test.ts
git commit -m "feat: register libp2p mesh setup cli"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 命令名是 `openclaw libp2p-mesh setup`，不是 `configure`。
- [ ] CLI 注册不改变现有 service/channel/tool/hook 注册行为。
- [ ] 写入只通过 writer 适配器发生。
- [ ] `registerCli` descriptors 覆盖 `libp2p-mesh` 根命令。

---

## 任务 5: README 使用说明

**Harness（测试框架）:**

- **范围：** 更新 README，说明 `openclaw libp2p-mesh setup` 用法、首次配置、编辑配置、写入路径、多入站目标和重启提示。不修改代码。
- **前置条件：** 任务 4 已提交。
- **测试入口：** `npm test && npm run build`
- **通过标准：** README 包含命令、写入路径和示例；测试和构建通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 4。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`README.md`

**行为清单（Behavior List）:**

- [ ] README 展示 `openclaw libp2p-mesh setup`。
- [ ] README 明确写入 `plugins.entries["libp2p-mesh"].config`。
- [ ] README 明确不需要手动编辑 `openclaw.json`。
- [ ] README 展示多个 `inboundTargets` 示例。
- [ ] README 提醒写入后重启 gateway。

**接口合同（Interface Contract）:**

```md
### Interactive setup

Run:

```bash
openclaw libp2p-mesh setup
```

The wizard writes `plugins.entries["libp2p-mesh"].config`.
```

- [ ] **步骤 1：编写失败的文档检查** (Red)

运行：

```bash
rg "openclaw libp2p-mesh setup" README.md
rg "plugins.entries" README.md
```

预期：至少有一个命令失败，表示 README 尚未记录新向导。

- [ ] **步骤 2：运行检查确认失败** (Red)

确认失败原因是 README 未包含新 setup 文档。

- [ ] **步骤 3：编写最小文档更新** (Green)

在 README 的配置或发送 by instance ID 章节附近增加 `Interactive setup` 小节，包含命令、写入路径、多 target 示例和重启提示。

- [ ] **步骤 4：运行完整验证** (Green)

运行：

```bash
rg "openclaw libp2p-mesh setup" README.md
rg "plugins.entries" README.md
npm test
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交文档**

```bash
git add README.md
git commit -m "docs: document libp2p mesh setup cli"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] README 命令名与 spec 一致。
- [ ] README 不要求用户手动编辑 `openclaw.json`。
- [ ] README 示例写 `plugins.entries`，不写 `channels["libp2p-mesh"]`。

---

## 任务 6: 最终验证与计划状态更新

**Harness（测试框架）:**

- **范围：** 运行最终验证，更新本计划文件任务状态和提交记录。不修改功能代码。
- **前置条件：** 任务 1-5 已提交。
- **测试入口：** `npm test && npm run build`
- **通过标准：** 所有测试和构建通过；计划文件记录完成状态；工作区无未提交的本计划相关代码改动。
- **失败恢复：** 如果仅计划文件更新错误，使用 `git restore docs/superpowers/plans/2026-06-23-libp2p-mesh-setup-cli.md` 后重做。
- **依赖：** 任务 1-5。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`docs/superpowers/plans/2026-06-23-libp2p-mesh-setup-cli.md`

**行为清单（Behavior List）:**

- [ ] 最终 `npm test` 通过。
- [ ] 最终 `npm run build` 通过。
- [ ] 计划文件记录每个任务的 commit SHA。
- [ ] `git status --short` 只显示与本计划无关的预先存在文件，或为空。

**接口合同（Interface Contract）:**

```md
**Status:** COMPLETE
**Completed:** 2026-06-23
**Commits:** `<sha>` `<message>`
```

- [ ] **步骤 1：运行最终测试**

```bash
npm test
```

预期：全部测试通过。

- [ ] **步骤 2：运行最终构建**

```bash
npm run build
```

预期：TypeScript 构建通过。

- [ ] **步骤 3：更新计划状态**

在每个任务标题下补充：

```md
**Status:** COMPLETE
**Completed:** 2026-06-23
**Commits:** `<sha>` `<message>`
```

- [ ] **步骤 4：检查工作区**

```bash
git status --short
```

预期：没有本计划相关未提交代码改动。

- [ ] **步骤 5：提交计划状态**

```bash
git add docs/superpowers/plans/2026-06-23-libp2p-mesh-setup-cli.md
git commit -m "docs: record libp2p mesh setup cli progress"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 计划状态只记录真实完成的任务。
- [ ] 没有把未实现的后续能力标记为完成。
- [ ] 最终测试和构建结果记录准确。

---

## 计划级质量门

完成所有任务后，执行统一代码质量审查：

- [ ] 审查范围：从任务 1 第一个提交到任务 6 最后一个提交。
- [ ] 审查重点：配置写入路径、取消安全、CLI 注册路径、`inboundTargets` 语义、OpenClaw runtime mutation 用法、测试覆盖。
- [ ] 审查通过后才能合并分支。

## Report 进度更新

本仓库没有外部 report 章节需要更新。本计划完成后只需要更新本计划文件任务状态，并在最终交付中说明：

- 设计 spec：`docs/superpowers/specs/2026-06-23-libp2p-mesh-configure-cli-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-23-libp2p-mesh-setup-cli.md`
- 最终测试命令：`npm test`
- 最终构建命令：`npm run build`

## Self-Review

- **Spec coverage:** 任务 1 覆盖网络模式和写入路径；任务 2 覆盖多入站目标和旧配置迁移；任务 3 覆盖首次配置、编辑、preview、取消安全；任务 4 覆盖 OpenClaw CLI 注册和 writer；任务 5 覆盖 README；任务 6 覆盖最终验证和计划状态。
- **Placeholder scan:** 本计划不包含 TBD、TODO、待定或未定义接口。
- **Type consistency:** 命令名统一为 `openclaw libp2p-mesh setup`；配置路径统一为 `plugins.entries["libp2p-mesh"]`；target 类型沿用 `InboundTargetConfig`。
- **Harness completeness:** 每个任务包含范围、前置条件、测试入口、通过标准、失败恢复、依赖和证据层。
- **Atomicity check:** 每个任务只处理一个关注点，并以独立提交结束。
- **TDD compliance:** 每个实现任务先写失败测试，再实现，再完整验证。
- **Spec compliance verification:** 每个任务包含行为清单、接口合同和 spec 合规自检。
- **Report alignment check:** 本计划无外部 report；已明确状态追踪只更新计划文件。
