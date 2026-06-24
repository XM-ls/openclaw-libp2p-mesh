# 本地远端实例标签实现计划

> **给执行者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐步实现此计划。步骤使用复选框（`- [ ]`）语法以便跟踪。

**目标：** 实现 `openclaw libp2p-mesh labels` 交互式向导，让用户给已发现远端实例配置本地标签，并让 `p2p_send_user_attribute_message` 通过 `scope` 区分公开属性、本地标签和两者合并。

**架构：** 新增 `peer-labels.json` 私有本地存储和 `PeerLabelStore`，复用现有 `profile` wizard/CLI 模式提供交互式配置。router 在按属性发送时根据 `scope=public|local|all` 从 `instance-peer.json.userPublicAttributes` 和 `peer-labels.json` 中选择匹配源，agent tool 和系统提示词负责把用户意图映射到正确 scope。

**技术栈：** TypeScript、Node.js `node:test`、OpenClaw plugin CLI、现有 `SetupPrompter`、现有 `sendInstanceMessage()` ACK 流程。

**Report 对齐：**
- **对应章节：** N/A；本仓库当前没有绑定 report 章节。
- **证据层：** 实现完成后的代码和测试属于 `repo-observed fact`；本计划和 spec 属于 `design intent`。
- **状态追踪：** 完成后更新 `README.md` 的 User public attributes/attribute sending 文档，并在本计划中记录任务完成状态和 commit SHA。

**依赖关系图：**

```text
任务 1 ──→ 任务 2 ──→ 任务 3 ──→ 任务 4 ──→ 任务 5
```

---

## 文件结构

- 创建：`src/peer-label-store.ts`  
  负责 `peer-labels.json` 路径解析、读写、规范化、去重和按 `instanceId` 查询本地标签。
- 创建：`test/peer-label-store.test.ts`  
  覆盖 store 的路径、空文件、损坏备份、保存格式、规范化和移除空 peer。
- 创建：`src/labels-wizard.ts`  
  负责 `openclaw libp2p-mesh labels` 的交互式流程，不直接读写文件，只通过注入的实例列表、初始 labels 和 writer 操作数据。
- 创建：`test/labels-wizard.test.ts`  
  覆盖无实例、添加、编辑、删除、自定义 key、取消不写。
- 修改：`src/profile-cli.ts`  
  注册 `labels` 子命令，注入 `InstancePeerStore` 和 `PeerLabelStore`。
- 修改：`test/profile-cli.test.ts`  
  覆盖 `labels` 命令注册和 action 数据流。
- 修改：`src/types.ts`  
  增加本地标签类型、`UserAttributeMatchScope`、`matchSource` 字段和 router options 中的 peer label store 依赖。
- 修改：`src/instance-router.ts`  
  增加 `scope` 匹配逻辑，保持默认 `public`。
- 修改：`src/agent-tools.ts`  
  tool schema 增加 `scope`，执行时传给 router，输出中展示匹配来源。
- 修改：`test/agent-tools.test.ts`、`test/instance-router.test.ts`  
  覆盖 scope 行为和兼容性。
- 修改：`src/prompt-config.ts`、`README.md`  
  文档化 `labels`、`peer-labels.json` 和 `scope` 规则。

---

### 任务 1: PeerLabelStore 本地标签存储

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `5b763da` `feat: add local peer label store`

**Harness（测试框架）:**

- **范围：** 只实现 `peer-labels.json` 的纯本地存储、规范化和查询；不注册 CLI，不接入 router，不改 agent tool。
- **前置条件：** spec 已确认；工作区允许新增文件。
- **测试入口：** `npm test -- test/peer-label-store.test.ts`
- **通过标准：** `test/peer-label-store.test.ts` 全部通过，`npm run build` 通过。
- **失败恢复：** `git restore --staged src/peer-label-store.ts test/peer-label-store.test.ts && rm -f src/peer-label-store.ts test/peer-label-store.test.ts`
- **依赖：** 无。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/peer-label-store.ts`
- 创建：`test/peer-label-store.test.ts`
- 修改：`src/types.ts`

**行为清单（Behavior List）:**

- [ ] `resolvePeerLabelsPath()` 默认返回 `~/.openclaw/libp2p/peer-labels.json`。
- [ ] 设置 `OPENCLAW_STATE_DIR` 时返回 `$OPENCLAW_STATE_DIR/libp2p/peer-labels.json`。
- [ ] 文件不存在时 `load()` 返回空 labels。
- [ ] JSON 损坏时备份为 `.corrupt-<timestamp>` 并返回空 labels。
- [ ] `save()` 只写入 `{ key, value }`，去掉空 peer 和重复标签。
- [ ] `listRawLabels(instanceId)` 返回配置文件中的 `{ key, value }[]`，供 wizard 编辑。
- [ ] `listLabels(instanceId)` 返回内部可匹配结构，补齐 `kind="structured"`、`label=value`、`source="local"`。
- [ ] `replaceLabels(instanceId, labels)` 可替换、清空单个实例的本地标签。

**接口合同（Interface Contract）:**

```ts
export type LocalPeerLabel = {
  key: string;
  value: string;
};

export type LocalPeerLabelAttribute = {
  kind: "structured";
  key: string;
  value: string;
  label: string;
  source: "local";
};

export type PeerLabelsFile = {
  version: 1;
  updatedAt: number;
  peers: Record<string, { labels: LocalPeerLabel[] }>;
};

export type PeerLabelStore = {
  load(): Promise<PeerLabelsFile>;
  save(file: PeerLabelsFile): Promise<PeerLabelsFile>;
  listRawLabels(instanceId: string): Promise<LocalPeerLabel[]>;
  listLabels(instanceId: string): Promise<LocalPeerLabelAttribute[]>;
  replaceLabels(instanceId: string, labels: LocalPeerLabel[]): Promise<PeerLabelsFile>;
};

export function resolvePeerLabelsPath(customPath?: string): string;
export function createPeerLabelStore(options?: {
  path?: string;
  logger?: { debug?: (message: string) => void; warn?: (message: string) => void };
}): PeerLabelStore;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/peer-label-store.test.ts`，包含以下测试骨架并按行为清单补全断言：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPeerLabelStore, resolvePeerLabelsPath } from "../src/peer-label-store.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "libp2p-peer-labels-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolves default and OPENCLAW_STATE_DIR peer labels paths", async () => {
  const previous = process.env.OPENCLAW_STATE_DIR;
  try {
    delete process.env.OPENCLAW_STATE_DIR;
    assert.match(resolvePeerLabelsPath(), /\.openclaw[/\\]libp2p[/\\]peer-labels\.json$/);

    await withTempDir(async (stateDir) => {
      process.env.OPENCLAW_STATE_DIR = stateDir;
      assert.equal(resolvePeerLabelsPath(), path.join(stateDir, "libp2p", "peer-labels.json"));
    });
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previous;
  }
});

test("load returns an empty labels file when missing", async () => {
  await withTempDir(async (dir) => {
    const store = createPeerLabelStore({ path: path.join(dir, "libp2p", "peer-labels.json") });
    const labels = await store.load();
    assert.equal(labels.version, 1);
    assert.deepEqual(labels.peers, {});
    assert.equal(typeof labels.updatedAt, "number");
  });
});

test("load backs up corrupt JSON and returns empty labels", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "peer-labels.json");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{not json", "utf8");
    const warnings: string[] = [];
    const store = createPeerLabelStore({ path: filePath, logger: { warn: (message) => warnings.push(message) } });

    const labels = await store.load();
    const files = await readdir(path.dirname(filePath));

    assert.deepEqual(labels.peers, {});
    assert.equal(files.includes("peer-labels.json"), false);
    assert.equal(files.some((name) => /^peer-labels\.json\.corrupt-\d+$/.test(name)), true);
    assert.equal(warnings.length, 1);
  });
});

test("save normalizes labels deduplicates and removes empty peers", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "libp2p", "peer-labels.json");
    const store = createPeerLabelStore({ path: filePath });

    const saved = await store.save({
      version: 1,
      updatedAt: 1,
      peers: {
        "alice@abc.111": { labels: [
          { key: " Group ", value: " 实验室 " },
          { key: "group", value: "实验室" },
          { key: "project", value: " 小龙虾 " },
          { key: "", value: "ignored" },
        ] },
        "empty@abc.222": { labels: [] },
      },
    });
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    assert.deepEqual(saved.peers, {
      "alice@abc.111": {
        labels: [
          { key: "group", value: "实验室" },
          { key: "project", value: "小龙虾" },
        ],
      },
    });
    assert.deepEqual(parsed.peers, saved.peers);
    assert.equal(raw.endsWith("\n"), true);
  });
});

test("replaceLabels and listLabels persist local structured attributes", async () => {
  await withTempDir(async (dir) => {
    const store = createPeerLabelStore({ path: path.join(dir, "libp2p", "peer-labels.json") });

    await store.replaceLabels("alice@abc.111", [
      { key: "group", value: "实验室" },
      { key: "skill", value: "TypeScript" },
    ]);

    assert.deepEqual(await store.listLabels("alice@abc.111"), [
      { kind: "structured", key: "group", value: "实验室", label: "实验室", source: "local" },
      { kind: "structured", key: "skill", value: "TypeScript", label: "TypeScript", source: "local" },
    ]);

    await store.replaceLabels("alice@abc.111", []);
    assert.deepEqual((await store.load()).peers, {});
  });
});
```

运行：`npm test -- test/peer-label-store.test.ts`  
预期：FAIL，错误为模块 `../src/peer-label-store.js` 不存在或导出缺失。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是缺少 `peer-label-store` 功能，不是测试语法错误。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/peer-label-store.ts`，按接口合同实现路径解析、load/save/list/replace。复用 `user-profile-store.ts` 的损坏备份、临时文件写入和 mutation queue 模式。不要接入 CLI 或 router。

运行：`npm test -- test/peer-label-store.test.ts`  
预期：PASS。

- [ ] **步骤 4：运行测试确认通过** (Green)

运行：

```bash
npm test -- test/peer-label-store.test.ts
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/types.ts src/peer-label-store.ts test/peer-label-store.test.ts
git commit -m "feat: add local peer label store"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 每个 store 行为都有测试覆盖。
- [ ] `peer-labels.json` 没有保存 `source`、`kind`、`label` 等用户不需要手写的字段。
- [ ] 本地标签没有写入 `instance-peer.json`。
- [ ] `OPENCLAW_STATE_DIR` 路径规则与 spec 一致。

---

### 任务 2: Labels Wizard 交互式本地标签配置

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `982cb2a` `feat: add local peer labels wizard`; `edeb4b7` `test: cover choosing another peer label instance`

**Harness（测试框架）:**

- **范围：** 只实现纯 wizard 函数，使用注入的实例列表、初始 labels 和 writer；不注册真实 CLI，不读写真实文件。
- **前置条件：** 任务 1 已提交。
- **测试入口：** `npm test -- test/labels-wizard.test.ts`
- **通过标准：** wizard 测试通过，任务 1 测试仍通过。
- **失败恢复：** `git restore --staged src/labels-wizard.ts test/labels-wizard.test.ts && rm -f src/labels-wizard.ts test/labels-wizard.test.ts`
- **依赖：** 任务 1。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/labels-wizard.ts`
- 创建：`test/labels-wizard.test.ts`

**行为清单（Behavior List）:**

- [ ] 没有已发现实例时提示并取消，不调用 writer。
- [ ] 展示已发现实例和公开属性摘要。
- [ ] 可选择实例并添加 `group/project/role/skill/custom` 标签。
- [ ] 可编辑已存在标签。
- [ ] 可删除已存在标签。
- [ ] 保存时只写选中实例的新 labels。
- [ ] Ctrl+C 或 Cancel 不写入。

**接口合同（Interface Contract）:**

```ts
import type { SetupPrompter } from "./setup-wizard.js";
import type { InstancePeerRecord, LocalPeerLabel } from "./types.js";

export type PeerLabelsWriter = {
  replaceLabels(instanceId: string, labels: LocalPeerLabel[]): Promise<void>;
};

export type RunLabelsWizardOptions = {
  prompter: SetupPrompter;
  instances: InstancePeerRecord[];
  getLabels(instanceId: string): Promise<LocalPeerLabel[]>;
  writer: PeerLabelsWriter;
};

export type LabelsWizardResult =
  | { status: "saved"; instanceId: string; labels: LocalPeerLabel[]; message: string }
  | { status: "cancelled"; message: string };

export async function runLabelsWizard(options: RunLabelsWizardOptions): Promise<LabelsWizardResult>;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/labels-wizard.test.ts`，复用 `profile-wizard.test.ts` 的 fake prompter 模式。测试必须覆盖以下核心用例：

```ts
test("adds a local label for a selected discovered instance", async () => {
  const writes: Array<{ instanceId: string; labels: LocalPeerLabel[] }> = [];
  const printed: string[] = [];
  const result = await runLabelsWizard({
    prompter: makePrompter(["instance-index-0", "add-label", "group", "实验室", "save-finish"], printed),
    instances: [aliceRecord],
    async getLabels() { return []; },
    writer: { async replaceLabels(instanceId, labels) { writes.push({ instanceId, labels }); } },
  });

  assert.equal(result.status, "saved");
  assert.deepEqual(writes, [{ instanceId: "alice@abc.111", labels: [{ key: "group", value: "实验室" }] }]);
  assert.match(printed.join("\n"), /Discovered instances/);
  assert.match(printed.join("\n"), /public attributes/);
});
```

还要加入：

- `test("cancels without writing when there are no discovered instances", ...)`
- `test("edits an existing local label", ...)`
- `test("removes an existing local label", ...)`
- `test("custom label prompts for custom key", ...)`
- `test("Ctrl+C cancellation exits without writing", ...)`

运行：`npm test -- test/labels-wizard.test.ts`  
预期：FAIL，错误为模块缺失。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是 `labels-wizard` 不存在或行为未实现。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/labels-wizard.ts`。复用 `SetupCancelledError`、`SetupPrompter` 和 `profile-wizard.ts` 的菜单结构，但文案使用 Local labels。保存动作直接调用 `writer.replaceLabels(instanceId, labels)`。

运行：`npm test -- test/labels-wizard.test.ts`  
预期：PASS。

- [ ] **步骤 4：运行测试确认通过** (Green)

运行：

```bash
npm test -- test/labels-wizard.test.ts test/peer-label-store.test.ts
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/labels-wizard.ts test/labels-wizard.test.ts
git commit -m "feat: add local peer labels wizard"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] wizard 只管理本地 labels，不修改 profile。
- [ ] 用户不需要输入 `kind/source/label`。
- [ ] 保存前没有复杂子命令或 flags。
- [ ] 取消路径不调用 writer。

---

### 任务 3: 注册 `openclaw libp2p-mesh labels` CLI

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `e0f1fec` `feat: add libp2p mesh labels cli`

**Harness（测试框架）:**

- **范围：** 把 labels wizard 接入现有 `libp2p-mesh` root CLI；不改 router 发送逻辑。
- **前置条件：** 任务 1-2 已提交。
- **测试入口：** `npm test -- test/profile-cli.test.ts`
- **通过标准：** `profile-cli` 测试通过，新增 labels 命令和 action 数据流被覆盖。
- **失败恢复：** `git restore src/profile-cli.ts test/profile-cli.test.ts`
- **依赖：** 任务 1、任务 2。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/profile-cli.ts`
- 修改：`test/profile-cli.test.ts`

**行为清单（Behavior List）:**

- [ ] `registerLibp2pMeshCli()` 在同一个 `libp2p-mesh` root 下注册 `labels`。
- [ ] `labels` action 读取已发现 instances。
- [ ] `labels` action 读取和写入 `PeerLabelStore`。
- [ ] action 结束时关闭 prompter。
- [ ] plugin 主注册路径包含 labels 命令。

**接口合同（Interface Contract）:**

```ts
export type LabelsCliDeps = {
  createPrompter?: (ctx: OpenClawPluginCliContext) => SetupPrompter;
  createPeerStore?: (api: OpenClawPluginApi) => Pick<InstancePeerStore, "list">;
  createPeerLabelStore?: (api: OpenClawPluginApi) => Pick<PeerLabelStore, "listRawLabels" | "replaceLabels">;
};

export type Libp2pMeshCliDeps = {
  setup?: SetupCliDeps;
  profile?: ProfileCliDeps;
  labels?: LabelsCliDeps;
  debug?: DebugCliDeps;
  prompt?: PromptCliDeps;
};
```

- [ ] **步骤 1：编写失败的测试** (Red)

修改 `test/profile-cli.test.ts`：

```ts
test("registerLibp2pMeshCli registers setup profile labels and debug under one root command", () => {
  // 在现有 root command 测试中加入 labels 断言：
  assert.ok(libp2pRoots[0]?.children.find((child) => child.name === "labels"));
});

test("labels command action loads discovered instances and local labels then writes labels", async () => {
  const root = makeCommand("openclaw");
  const printed: string[] = [];
  const writes: Array<{ instanceId: string; labels: LocalPeerLabel[] }> = [];
  const { api } = makeApi(root);

  registerLibp2pMeshCli(api, {
    setup: { createPrompter: () => makePrompter([false]), createWriter: () => ({ async write() {} }) },
    profile: { /* existing fake deps */ },
    labels: {
      createPrompter: () => makePrompter(["instance-index-0", "add-label", "group", "实验室", "save-finish"], printed),
      createPeerStore: () => ({
        async list() {
          return [{ instanceId: "alice@abc.111", peerId: "peer-alice", multiaddrs: [], lastSeenAt: 1, lastAnnouncedAt: 1, source: "announce" }];
        },
      }),
      createPeerLabelStore: () => ({
        async listRawLabels() { return []; },
        async replaceLabels(instanceId, labels) { writes.push({ instanceId, labels }); },
      }),
    },
  });

  const labels = root.children[0]?.children.find((child) => child.name === "labels");
  await labels?.actionHandler?.();

  assert.deepEqual(writes, [{ instanceId: "alice@abc.111", labels: [{ key: "group", value: "实验室" }] }]);
});
```

运行：`npm test -- test/profile-cli.test.ts`  
预期：FAIL，原因是 `labels` 命令未注册。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败点是缺少 labels CLI，而不是 fake deps 类型错误。

- [ ] **步骤 3：编写最小实现** (Green)

修改 `src/profile-cli.ts`：新增 `LabelsCliDeps`、`registerLibp2pMeshLabelsCommand()`，并在 `registerLibp2pMeshCli()` 中注册。默认 store 使用现有 instance peer store 创建函数和 `createPeerLabelStore()`。

运行：`npm test -- test/profile-cli.test.ts`  
预期：PASS。

- [ ] **步骤 4：运行测试确认通过** (Green)

运行：

```bash
npm test -- test/profile-cli.test.ts test/labels-wizard.test.ts test/peer-label-store.test.ts
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/profile-cli.ts test/profile-cli.test.ts src/peer-label-store.ts
git commit -m "feat: add libp2p mesh labels cli"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 命令名是 `labels`，不是 `peer-labels` 或 `peers label add`。
- [ ] `labels` 与 `profile` 同属一个 root command。
- [ ] 命令 action 只面向已发现实例。
- [ ] prompter 总是关闭。

---

### 任务 4: 按属性发送支持 `scope=public|local|all`

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `97c4e0b` `feat: send user attribute messages by scope`; `a65a681` `fix: include scope in user attribute results`

**Harness（测试框架）:**

- **范围：** 扩展 router、类型和 agent tool 的 scope 支持；不改 CLI wizard，不改 README。
- **前置条件：** 任务 1-3 已提交。
- **测试入口：** `npm test -- test/instance-router.test.ts test/agent-tools.test.ts`
- **通过标准：** public/local/all、默认 public、非法 scope、dry run/发送结果来源展示全部通过。
- **失败恢复：** `git restore src/types.ts src/instance-router.ts src/agent-tools.ts test/instance-router.test.ts test/agent-tools.test.ts`
- **依赖：** 任务 1。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/types.ts`
- 修改：`src/instance-router.ts`
- 修改：`src/agent-tools.ts`
- 修改：`test/instance-router.test.ts`
- 修改：`test/agent-tools.test.ts`

**行为清单（Behavior List）:**

- [ ] `sendUserAttributeMessage(match, message, options)` 支持 `options.scope`。
- [ ] 不传 scope 时行为等同 `public`。
- [ ] `scope=public` 只匹配 `record.userPublicAttributes`。
- [ ] `scope=local` 只匹配 `peerLabelStore.listLabels(instanceId)`。
- [ ] `scope=all` 合并 public/local，按 `instanceId` 去重。
- [ ] target/result 包含 `matchSource`。
- [ ] agent tool schema 暴露 `scope`，并把参数传给 router。
- [ ] 非法 scope 返回工具参数错误，不调用 router。

**接口合同（Interface Contract）:**

```ts
export type UserAttributeMatchScope = "public" | "local" | "all";
export type UserAttributeMatchSource = "public" | "local" | "all";

export type UserAttributeMessageTarget = {
  instanceId: string;
  instanceName?: string;
  peerId: string;
  matchedAttribute: UserPublicAttribute | LocalPeerLabelAttribute;
  matchSource: UserAttributeMatchSource;
};

export type UserAttributeMessageOptions = {
  dryRun?: boolean;
  scope?: UserAttributeMatchScope;
};
```

- [ ] **步骤 1：编写失败的测试** (Red)

在 `test/instance-router.test.ts` 添加：

```ts
test("send user attribute message with local scope matches peer labels only", async () => {
  const router = createTestRouter({
    peerLabelStore: {
      async listLabels(instanceId) {
        return instanceId === "alice@abc.111"
          ? [{ kind: "structured", key: "group", value: "实验室", label: "实验室", source: "local" }]
          : [];
      },
    },
    records: [
      recordWithPublicAttribute("alice@abc.111", { kind: "structured", key: "skill", value: "rust", label: "Rust", source: "profile" }),
    ],
  });

  const result = await router.sendUserAttributeMessage(
    { kind: "structured", key: "group", value: "实验室" },
    "hello",
    { dryRun: true, scope: "local" },
  );

  assert.equal(result.matched, 1);
  assert.equal(result.targets?.[0]?.matchSource, "local");
});
```

在 `test/agent-tools.test.ts` 添加：

```ts
test("send user attribute tool passes scope to router", async () => {
  const calls: Parameters<InstanceRouter["sendUserAttributeMessage"]>[] = [];
  await userAttributeTool(makeUserAttributeRouter(async (...args) => {
    calls.push(args);
    return { matched: 1, sent: 0, delivered: 0, failed: 0, targets: [] };
  })).execute("call-1", {
    selector: "group=实验室",
    scope: "local",
    message: "今晚同步",
    dryRun: true,
  });

  assert.equal(calls[0]?.[2]?.scope, "local");
});
```

还要覆盖：

- `scope=public` 不读取 local labels。
- `scope=all` 对同一 instance 命中 public/local 时去重并返回 `matchSource="all"`。
- 不传 scope 时传入 router options 中没有 scope 或等价 `public`。
- 非法 `scope="team"` 返回 `isError=true`。

运行：`npm test -- test/instance-router.test.ts test/agent-tools.test.ts`  
预期：FAIL，原因是 scope 类型或行为缺失。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是缺少 scope 支持。

- [ ] **步骤 3：编写最小实现** (Green)

修改 `src/types.ts`、`src/instance-router.ts`、`src/agent-tools.ts`。router options 注入 `peerLabelStore`，缺省时 local 匹配为空。agent tool 校验 scope，只允许 `public/local/all`。

运行：`npm test -- test/instance-router.test.ts test/agent-tools.test.ts`  
预期：PASS。

- [ ] **步骤 4：运行测试确认通过** (Green)

运行：

```bash
npm test -- test/instance-router.test.ts test/agent-tools.test.ts test/peer-label-store.test.ts
npm run build
```

预期：全部通过。

- [ ] **步骤 5：提交代码**

```bash
git add src/types.ts src/instance-router.ts src/agent-tools.ts test/instance-router.test.ts test/agent-tools.test.ts
git commit -m "feat: send user attribute messages by scope"
```

- [ ] **步骤 6：验证 spec 合规（自检）**

- [ ] 默认 scope 仍是公开属性，旧调用行为不变。
- [ ] `scope=local` 不读取公开属性。
- [ ] `scope=public` 不读取本地标签。
- [ ] 所有目标结果都有 `matchSource`。
- [ ] 没有新增底层 P2P 消息类型。

---

### 任务 5: 系统提示词、README 和最终验证

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `e21ad39` `docs: document local peer labels`

**Harness（测试框架）:**

- **范围：** 更新提示词、工具描述文档和 README；运行完整验证；不新增功能代码。
- **前置条件：** 任务 1-4 已提交。
- **测试入口：** `npm test -- test/prompt-config.test.ts test/agent-tools.test.ts && npm test && npm run build`
- **通过标准：** 完整测试和 build 通过，README 包含 labels/scope 使用说明。
- **失败恢复：** `git restore src/prompt-config.ts README.md test/prompt-config.test.ts test/agent-tools.test.ts`
- **依赖：** 任务 4。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/prompt-config.ts`
- 修改：`README.md`
- 创建：`test/prompt-config.test.ts`
- 修改：`test/agent-tools.test.ts` 中工具 schema 描述断言
- 修改：`docs/superpowers/plans/2026-06-24-local-peer-labels.md`

**行为清单（Behavior List）:**

- [x] 系统提示词说明 `openclaw libp2p-mesh labels` 管理本机给远端实例配置的本地标签。
- [x] 系统提示词说明 `scope=public/local/all` 的选择规则。
- [x] 系统提示词明确默认 `scope=public`。
- [x] 系统提示词要求 dry run 后用相同 `selector/scope/message` 发送。
- [x] README 说明 `peer-labels.json` 格式和隐私边界。
- [x] README 给出 public/local/all 三个发送示例。
- [x] 最终运行 `npm test` 和 `npm run build`。

**接口合同（Interface Contract）:**

```ts
// src/prompt-config.ts 中 LIBP2P_MESH_AGENT_PROMPT 必须包含：
// - openclaw libp2p-mesh labels
// - scope="public"
// - scope="local"
// - scope="all"
// - peer-labels.json
// - 默认使用 scope="public"
```

- [x] **步骤 1：编写失败的测试** (Red)

创建 `test/prompt-config.test.ts`：

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { LIBP2P_MESH_AGENT_PROMPT } from "../src/prompt-config.js";

test("agent prompt explains labels scope rules", () => {
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /openclaw libp2p-mesh labels/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="public"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="local"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /scope="all"/);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /默认.*scope="public"/s);
  assert.match(LIBP2P_MESH_AGENT_PROMPT, /peer-labels\.json/);
});
```

在 agent tool schema 测试中加入：

```ts
assert.ok(tool.parameters.properties.scope);
assert.deepEqual(tool.parameters.properties.scope.enum, ["public", "local", "all"]);
assert.match(tool.description, /scope="public"/);
assert.match(tool.description, /scope="local"/);
```

运行：`npm test -- test/prompt-config.test.ts test/agent-tools.test.ts`  
预期：FAIL，原因是 prompt/schema 文案尚未更新。

- [x] **步骤 2：运行测试确认失败** (Red)

确认失败原因是缺少 prompt 或 schema 文案，不是 import 路径问题。

- [x] **步骤 3：编写最小实现** (Green)

修改 `src/prompt-config.ts` 和 agent tool description。更新 `README.md` 的 User public attributes 章节，新增 `labels` 命令、`peer-labels.json` 示例、`scope` 示例和隐私边界。

运行：`npm test -- test/prompt-config.test.ts test/agent-tools.test.ts`  
预期：PASS。

- [x] **步骤 4：运行测试确认通过** (Green)

运行：

```bash
npm test
npm run build
rg "openclaw libp2p-mesh labels" README.md src/prompt-config.ts
rg "scope=\\\"local\\\"" README.md src/prompt-config.ts
```

预期：全部通过，`rg` 能找到对应文档。

- [ ] **步骤 5：提交代码**

```bash
git add src/prompt-config.ts README.md test/prompt-config.test.ts test/agent-tools.test.ts docs/superpowers/plans/2026-06-24-local-peer-labels.md
git commit -m "docs: document local peer labels"
```

- [x] **步骤 6：验证 spec 合规（自检）**

- [x] README 没有把本地标签描述成广播属性。
- [x] prompt 没有要求默认使用 `local` 或 `all`。
- [x] prompt 明确本地归类才使用 `scope="local"`。
- [x] 完整测试和 build 输出已记录在最终回复。

---

## 最终质量门

- [x] `npm test` 通过。
- [x] `npm run build` 通过。
- [x] `openclaw libp2p-mesh labels` 已注册在同一个 `libp2p-mesh` root command 下。
- [x] `peer-labels.json` 只保存 `{ key, value }`。
- [x] `p2p_send_user_attribute_message` 默认仍按公开属性发送。
- [x] `scope=local` 的 dry run 和发送都能匹配本地标签。
- [x] prompt 和 README 都解释了 public/local/all。
- [x] 没有 TODO、TBD 或占位符。

## Spec 覆盖自检

- **本地标签存储：** 任务 1 覆盖。
- **交互式 labels 命令：** 任务 2 和任务 3 覆盖。
- **scope 匹配和发送：** 任务 4 覆盖。
- **系统提示词和文档：** 任务 5 覆盖。
- **隐私边界：** 任务 1、任务 4、任务 5 均覆盖，不广播、不写入 `userPublicAttributes`。
- **兼容性：** 任务 4 覆盖旧调用默认 `public`。

## Report 进度更新

当前无绑定 report。实现完成后只需：

- [ ] 在本计划中填入每个任务的 commit SHA。
- [ ] 在 README 中记录 `labels` 和 `scope`。
- [ ] 最终回复列出测试结果。

## 执行交接

Plan complete and saved to `docs/superpowers/plans/2026-06-24-local-peer-labels.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - fresh subagent per task, spec review per task, unified quality review at plan end.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
