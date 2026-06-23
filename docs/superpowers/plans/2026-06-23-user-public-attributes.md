# 用户公开属性与按属性发送实现计划

> **给执行者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐步实现此计划。步骤使用复选框（`- [ ]`）语法以便跟踪。

**目标：** 在 `libp2p-mesh` 中增加用户公开属性公告、`instance-peer.json` 属性缓存、`openclaw libp2p-mesh profile` 属性管理命令，以及按用户属性群发消息的 agent tool。

**架构：** 新增用户公开属性类型、规范化和 profile store；gateway 启动时读取 `USER.md` 提取自由 tag，并与 `user-profile.json` 中的结构化属性在内存中合并进 `instance-announce`。远端 `InstancePeerStore` 保存 `userPublicAttributes`，agent tool 按本地已发现实例筛选后复用现有 `sendInstanceMessage()` 发送。

**技术栈：** TypeScript ESM、Node 内置 `node:test`、OpenClaw Plugin API `api.registerCli(...)`、现有 `InstanceRouter` / `InstancePeerStore` / `buildP2PTools`。

**Report 对齐：**
- **对应章节：** 本仓库无独立 report；本计划实现 `docs/superpowers/specs/2026-06-23-user-public-attributes-design.md`。
- **证据层：** 实现代码和测试完成后属于 `repo-observed fact`；设计文档属于 `design intent`。
- **状态追踪：** 完成后更新本计划文件任务状态；无需更新外部 report 章节。

**依赖关系图：**

```text
任务 1 ──→ 任务 2 ──┐
          └→ 任务 3 ─┼→ 任务 4 ──→ 任务 6 ──→ 任务 7
任务 1 ──→ 任务 5 ──┘
```

---

## 文件结构

- 修改 `src/types.ts`：增加用户公开属性类型、profile 类型、announce/peer record 字段、attribute message result 类型。
- 创建 `src/user-attributes.ts`：属性规范化、校验、去重、匹配、合并逻辑。
- 创建 `test/user-attributes.test.ts`：纯函数行为测试。
- 创建 `src/user-profile-store.ts`：`user-profile.json` 路径解析、读写、损坏备份、增删改、原子写入。
- 创建 `test/user-profile-store.test.ts`：profile store 测试。
- 创建 `src/user-md-attributes.ts`：只读 `USER.md` 输入源和自由 tag 提取器。
- 创建 `test/user-md-attributes.test.ts`：`USER.md` 提取测试。
- 修改 `src/instance-peer-store.ts`：保存和读取 `userPublicAttributes`。
- 修改 `src/instance-router.ts`：构造 announce 时合并 USER.md tag 与 profile structured attributes；增加按属性发送能力。
- 修改 `test/instance-router.test.ts`：announce 和按属性路由测试。
- 修改 `src/agent-tools.ts`：新增 `p2p_send_user_attribute_message`。
- 修改 `test/agent-tools.test.ts`：agent tool dry run / send 测试。
- 修改 `src/setup-cli.ts` 或拆分 `src/profile-cli.ts`：注册 `openclaw libp2p-mesh profile`，复用现有 readline prompter 风格。
- 创建 `test/profile-cli.test.ts`：CLI 注册和 profile action 测试。
- 修改 `README.md`：记录用户公开属性、profile 命令、按属性发送工具和隐私边界。
- 修改 `openclaw.plugin.json`：把新增 agent tool 加入 manifest 工具列表。

---

## 任务 1: 用户公开属性类型与纯函数

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `cf3c0b2` `feat: add user public attribute helpers`

**Harness（测试框架）:**

- **范围：** 定义用户公开属性类型和纯函数；实现规范化、校验、去重、合并和匹配。不读写文件、不接 router、不注册 CLI。
- **前置条件：** 当前分支包含已确认 spec；`npm test` 和 `npm run build` 在开始前通过。
- **测试入口：** `npm test -- test/user-attributes.test.ts`
- **通过标准：** 用户属性纯函数测试通过，且完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 无。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/types.ts`
- 创建：`src/user-attributes.ts`
- 创建：`test/user-attributes.test.ts`

**行为清单（Behavior List）:**

- [ ] 支持 `kind="tag"` 的自由属性，只有 `value` / `label` / `source`，没有 `key`。
- [ ] 支持 `kind="structured"` 的结构化属性，必须有 `key` / `value` / `label`。
- [ ] `key` 规范化为小写，`value` 和 `label` trim。
- [ ] tag 去重键为 `kind + normalized(value)`。
- [ ] structured 去重键为 `kind + normalized(key) + normalized(value)`。
- [ ] USER.md tag 和 profile structured 即使 value 相同也不互相覆盖。
- [ ] tag match 只匹配 `kind="tag"` 和 normalized value。
- [ ] structured match 匹配 `kind="structured"`、normalized key 和 normalized value。
- [ ] 无效属性会被过滤，不抛出。

**接口合同（Interface Contract）:**

```ts
export type UserPublicAttribute =
  | {
      kind: "tag";
      value: string;
      label: string;
      source: "USER.md";
    }
  | {
      kind: "structured";
      key: "group" | "project" | "role" | "skill" | "custom" | string;
      value: string;
      label: string;
      source: "profile";
    };

export type UserAttributeMatch =
  | { kind: "tag"; value: string }
  | { kind: "structured"; key: string; value: string };

export function normalizeAttributeValue(value: string): string;
export function normalizeAttributeKey(key: string): string;
export function normalizeUserPublicAttribute(value: unknown): UserPublicAttribute | undefined;
export function mergeUserPublicAttributes(
  userMdTags: UserPublicAttribute[],
  profileAttributes: UserPublicAttribute[],
): UserPublicAttribute[];
export function matchesUserAttribute(
  attribute: UserPublicAttribute,
  match: UserAttributeMatch,
): boolean;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/user-attributes.test.ts`，覆盖行为清单中的规范化、去重和匹配。测试应先导入 `../src/user-attributes.js`。

运行：`npm test -- test/user-attributes.test.ts`

预期：FAIL，原因是模块或导出不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是功能缺失，不是测试语法错误。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/user-attributes.ts` 并修改 `src/types.ts`，只实现接口合同中的纯函数和类型。

- [ ] **步骤 4：运行完整验证** (Green)

运行：

```bash
npm test -- test/user-attributes.test.ts
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/types.ts src/user-attributes.ts test/user-attributes.test.ts
git commit -m "feat: add user public attribute helpers"
```

---

## 任务 2: user-profile.json 存储

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `0031945` `feat: add user profile store`

**Harness（测试框架）:**

- **范围：** 实现 `user-profile.json` 的路径解析、读取、写入、损坏备份、结构化属性增删改。不读取 USER.md、不广播、不注册 CLI。
- **前置条件：** 任务 1 已提交。
- **测试入口：** `npm test -- test/user-profile-store.test.ts`
- **通过标准：** profile store 测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/user-profile-store.ts`
- 创建：`test/user-profile-store.test.ts`

**行为清单（Behavior List）:**

- [ ] 默认路径为 `~/.openclaw/libp2p/user-profile.json`。
- [ ] 设置 `OPENCLAW_STATE_DIR` 时路径为 `$OPENCLAW_STATE_DIR/libp2p/user-profile.json`。
- [ ] 文件不存在时读取为空 profile。
- [ ] JSON 损坏时备份为 `.corrupt-<timestamp>` 并返回空 profile。
- [ ] 保存时使用临时文件 + rename。
- [ ] 只保存 `kind="structured"` 属性。
- [ ] 添加重复 structured 属性时去重。
- [ ] 支持按 stable id 或 index 编辑/删除结构化属性。

**接口合同（Interface Contract）:**

```ts
import type { UserPublicAttribute } from "./types.js";

export type UserProfile = {
  version: 1;
  updatedAt: number;
  attributes: UserPublicAttribute[];
};

export function resolveUserProfilePath(customPath?: string): string;

export function createUserProfileStore(options?: {
  path?: string;
  logger?: {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
  };
}): {
  load(): Promise<UserProfile>;
  save(profile: UserProfile): Promise<UserProfile>;
  listAttributes(): Promise<UserPublicAttribute[]>;
  replaceAttributes(attributes: UserPublicAttribute[]): Promise<UserProfile>;
};
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/user-profile-store.test.ts`，使用临时目录测试不存在文件、损坏文件、保存、去重。

运行：`npm test -- test/user-profile-store.test.ts`

预期：FAIL，原因是模块不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是 store 未实现。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/user-profile-store.ts`，复用 `instance-peer-store.ts` 的原子写入和损坏备份风格。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/user-profile-store.test.ts
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/user-profile-store.ts test/user-profile-store.test.ts
git commit -m "feat: add user profile store"
```

---

## 任务 3: USER.md 只读 tag 提取

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `d8a18f9` `feat: extract user public tags from user md`, `dab80b6` `fix: keep user md tag extraction conservative`

**Harness（测试框架）:**

- **范围：** 实现 `USER.md` 只读读取和自由 tag 提取。不能修改 `USER.md`，不能写入 `user-profile.json`，不能调用网络服务。
- **前置条件：** 任务 1 已提交。
- **测试入口：** `npm test -- test/user-md-attributes.test.ts`
- **通过标准：** USER.md 提取测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/user-md-attributes.ts`
- 创建：`test/user-md-attributes.test.ts`

**行为清单（Behavior List）:**

- [ ] 文件不存在时返回空 tag。
- [ ] 读取失败时返回空 tag 并 warn。
- [ ] 不修改 `USER.md`。
- [ ] 从自然语言内容中提取短 tag。
- [ ] 不输出原文段落。
- [ ] 最多输出 10 个 tag。
- [ ] 单个 tag 最长 40 个字符。
- [ ] 不强行设置 `key`。
- [ ] 提取结果全部为 `kind="tag"`、`source="USER.md"`。

**接口合同（Interface Contract）:**

```ts
import type { UserPublicAttribute } from "./types.js";

export type UserMdAttributeSource = {
  path?: string;
  logger?: {
    debug?: (message: string) => void;
    warn?: (message: string) => void;
  };
};

export function extractUserMdTags(markdown: string): UserPublicAttribute[];
export function createUserMdAttributeSource(options?: UserMdAttributeSource): {
  loadTags(): Promise<UserPublicAttribute[]>;
};
```

**提取策略约束：**

第一版使用保守本地规则，不调用 LLM 或网络。执行者应从 `USER.md` 的 `Name`、`What to call them`、`Notes`、`Context` 等文本中提取明显短语，过滤模板占位文本和长句。实现可以先支持中文/英文词组和常见项目名，测试只要求稳定、保守、有限数量。

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/user-md-attributes.test.ts`，覆盖不存在文件、模板空内容、包含“实验室 / ResearchLoop / TypeScript”的内容、长度和数量限制。

运行：`npm test -- test/user-md-attributes.test.ts`

预期：FAIL，原因是模块不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是功能缺失。

- [ ] **步骤 3：编写最小实现** (Green)

创建 `src/user-md-attributes.ts`，只做本地保守提取。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/user-md-attributes.test.ts
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/user-md-attributes.ts test/user-md-attributes.test.ts
git commit -m "feat: extract user public tags from user md"
```

---

## 任务 4: announce 与 instance-peer.json 集成

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `8d24141` `feat: announce user public attributes`

**Harness（测试框架）:**

- **范围：** 在 `InstanceAnnouncePayload` 和 `InstancePeerRecord` 中加入 `userPublicAttributes`；构造 announce 时合并 USER.md tag 和 profile structured 属性；远端 store 保存属性。暂不实现 profile CLI 和按属性发送工具。
- **前置条件：** 任务 1、任务 2、任务 3 已提交。
- **测试入口：** `npm test -- test/instance-router.test.ts`
- **通过标准：** instance router/store 相关测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1、任务 2、任务 3。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/types.ts`
- 修改：`src/instance-peer-store.ts`
- 修改：`src/instance-router.ts`
- 修改：`src/plugin.ts`
- 修改：`test/instance-router.test.ts`
- 修改：`test-instance-peer-store.mjs`

**行为清单（Behavior List）:**

- [ ] announce payload 包含合并后的 `userPublicAttributes`。
- [ ] USER.md tag 不写入 profile，只随 announce 出现。
- [ ] profile structured 属性随 announce 出现。
- [ ] 合并前会去重。
- [ ] 远端 `upsertFromAnnounce()` 保存 `userPublicAttributes`。
- [ ] 旧 announce 没有 `userPublicAttributes` 时按空数组处理。
- [ ] 旧 `instance-peer.json` 没有 `userPublicAttributes` 时读取兼容。
- [ ] `sameRecord()` 会比较属性变化，属性变化时认为 record changed。

**接口合同（Interface Contract）:**

```ts
export interface InstanceAnnouncePayload {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  multiaddrs: string[];
  pubkey?: string;
  userPublicAttributes?: UserPublicAttribute[];
  announcedAt: number;
}

export interface InstancePeerRecord {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  multiaddrs: string[];
  pubkey?: string;
  userPublicAttributes?: UserPublicAttribute[];
  lastSeenAt: number;
  lastAnnouncedAt: number;
  source: "announce";
}

export type InstanceRouterOptions = {
  userAttributeSource?: {
    loadTags(): Promise<UserPublicAttribute[]>;
  };
  userProfileStore?: {
    listAttributes(): Promise<UserPublicAttribute[]>;
  };
};
```

- [ ] **步骤 1：编写失败的测试** (Red)

在 `test/instance-router.test.ts` 中新增测试：构造 router 时注入 fake USER.md source 和 fake profile store，调用 `announceToPeer()` 后断言 sent `instance-announce` payload 包含合并属性。在 store 测试中断言 `upsertFromAnnounce()` 保存属性。

运行：`npm test -- test/instance-router.test.ts`

预期：FAIL，属性字段缺失。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是 announce/store 未实现属性字段。

- [ ] **步骤 3：编写最小实现** (Green)

修改类型、store、router。`src/plugin.ts` 创建真实 `userAttributeSource` 和 `userProfileStore` 并注入 router。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/instance-router.test.ts
node --import tsx test-instance-peer-store.mjs
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/types.ts src/instance-peer-store.ts src/instance-router.ts src/plugin.ts test/instance-router.test.ts test-instance-peer-store.mjs
git commit -m "feat: announce user public attributes"
```

---

## 任务 5: profile CLI 管理结构化属性

**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `c566b72` `feat: add libp2p mesh profile cli`

**Harness（测试框架）:**

- **范围：** 注册 `openclaw libp2p-mesh profile`，实现手动结构化属性的新增、编辑、删除、预览和取消安全。只管理 `user-profile.json`，不修改 `USER.md`，不改 setup 流程。
- **前置条件：** 任务 1、任务 2 已提交。
- **测试入口：** `npm test -- test/profile-cli.test.ts`
- **通过标准：** profile CLI 测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1、任务 2。
- **证据层：** `repo-observed fact`

**文件:**

- 创建：`src/profile-cli.ts`
- 创建：`src/profile-wizard.ts`
- 创建：`test/profile-cli.test.ts`
- 创建：`test/profile-wizard.test.ts`
- 修改：`src/setup-cli.ts` 或 `src/plugin.ts`

**行为清单（Behavior List）:**

- [ ] 注册命令路径 `openclaw libp2p-mesh profile`。
- [ ] `profile` 命令与 `setup` 同属 `libp2p-mesh` 根命令。
- [ ] 展示 USER.md tag 为 read-only。
- [ ] 只允许编辑 `user-profile.json` 中的 structured 属性。
- [ ] 支持 add/edit/remove/preview/finish。
- [ ] `custom` 类别允许输入 custom key。
- [ ] Ctrl+C 或取消不写入。
- [ ] 保存后提示重启 gateway 才会广播更新属性。

**接口合同（Interface Contract）:**

```ts
import type { OpenClawPluginApi, OpenClawPluginCliContext } from "openclaw/plugin-sdk/core";
import type { SetupPrompter } from "./setup-wizard.js";
import type { UserPublicAttribute } from "./types.js";

export type UserProfileWriter = {
  replaceAttributes(attributes: UserPublicAttribute[]): Promise<void>;
};

export type RunProfileWizardOptions = {
  prompter: SetupPrompter;
  readOnlyTags: UserPublicAttribute[];
  profileAttributes: UserPublicAttribute[];
  writer: UserProfileWriter;
};

export function runProfileWizard(options: RunProfileWizardOptions): Promise<
  | { status: "saved"; attributes: UserPublicAttribute[]; message: string }
  | { status: "cancelled"; message: string }
>;

export function registerLibp2pMeshProfileCli(api: OpenClawPluginApi): void;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 profile wizard 和 CLI 测试。复用 setup CLI 测试里的 fake command/prompter 模式。

运行：

```bash
npm test -- test/profile-wizard.test.ts test/profile-cli.test.ts
```

预期：FAIL，模块不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是 profile CLI/wizard 缺失。

- [ ] **步骤 3：编写最小实现** (Green)

实现 profile wizard 和 CLI 注册。若 `setup-cli.ts` 当前独占 `libp2p-mesh` root command，需要提取共享注册帮助函数或在同一个 registrar 内注册 `setup` 与 `profile`，避免重复 root 命令冲突。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/profile-wizard.test.ts test/profile-cli.test.ts
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/profile-cli.ts src/profile-wizard.ts src/setup-cli.ts src/plugin.ts test/profile-cli.test.ts test/profile-wizard.test.ts
git commit -m "feat: add libp2p mesh profile cli"
```

---

## 任务 6: 按用户属性发送 agent tool

**Harness（测试框架）:**

- **范围：** 新增 `p2p_send_user_attribute_message` agent tool，并在 router 中提供按属性匹配、dry run 和实际发送。复用现有 `sendInstanceMessage()`，不新增底层 P2P 消息类型。
- **前置条件：** 任务 1、任务 4 已提交。
- **测试入口：** `npm test -- test/agent-tools.test.ts test/instance-router.test.ts`
- **通过标准：** 属性发送工具测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1、任务 4。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/types.ts`
- 修改：`src/instance-router.ts`
- 修改：`src/agent-tools.ts`
- 修改：`test/instance-router.test.ts`
- 修改：`test/agent-tools.test.ts`
- 修改：`openclaw.plugin.json`

**行为清单（Behavior List）:**

- [ ] 工具名为 `p2p_send_user_attribute_message`。
- [ ] 支持 `match.kind="tag"` 且只按 tag value 匹配。
- [ ] 支持 `match.kind="structured"` 且按 key/value 匹配。
- [ ] `dryRun=true` 只返回目标列表，不发送消息。
- [ ] `dryRun=false` 对每个匹配 instance 调用 `sendInstanceMessage()`。
- [ ] 单个目标失败不阻止其他目标。
- [ ] 返回 matched/sent/delivered/failed 和每个目标结果。
- [ ] 无匹配目标时返回 isError 和明确说明。
- [ ] agent tool 自然语言描述要求群发前先 dry run。

**接口合同（Interface Contract）:**

```ts
export interface InstanceRouter {
  sendUserAttributeMessage(
    match: UserAttributeMatch,
    message: string,
    options?: { dryRun?: boolean },
  ): Promise<{
    matched: number;
    sent: number;
    delivered: number;
    failed: number;
    targets?: Array<{
      instanceId: string;
      instanceName?: string;
      peerId: string;
      matchedAttribute: UserPublicAttribute;
    }>;
    results?: Array<{
      instanceId: string;
      instanceName?: string;
      peerId: string;
      matchedAttribute: UserPublicAttribute;
      sent: boolean;
      delivered: boolean;
      error?: string;
    }>;
    error?: string;
  }>;
}
```

- [ ] **步骤 1：编写失败的测试** (Red)

在 `test/instance-router.test.ts` 中测试 router 的 dry run 和发送结果。在 `test/agent-tools.test.ts` 中测试 tool 参数、无 router、无匹配和部分失败输出。

运行：`npm test -- test/agent-tools.test.ts test/instance-router.test.ts`

预期：FAIL，router/tool 方法不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是功能缺失。

- [ ] **步骤 3：编写最小实现** (Green)

实现 router 方法、tool 注册和 manifest 工具列表更新。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/agent-tools.test.ts test/instance-router.test.ts
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/types.ts src/instance-router.ts src/agent-tools.ts test/instance-router.test.ts test/agent-tools.test.ts openclaw.plugin.json
git commit -m "feat: send messages by user public attribute"
```

---

## 任务 7: README 与最终验证

**Harness（测试框架）:**

- **范围：** 更新 README，记录用户公开属性、`profile` 命令、`user-profile.json`、`instance-peer.json.userPublicAttributes`、按属性发送工具和隐私边界；运行最终验证并更新本计划状态。不修改功能代码。
- **前置条件：** 任务 1-6 已提交。
- **测试入口：** `npm test && npm run build`
- **通过标准：** README 包含新命令和字段说明；最终测试和构建通过；计划文件记录完成状态。
- **失败恢复：** 如果仅文档错误，`git restore README.md docs/superpowers/plans/2026-06-23-user-public-attributes.md` 后重做。
- **依赖：** 任务 1-6。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-06-23-user-public-attributes.md`

**行为清单（Behavior List）:**

- [ ] README 说明 `USER.md` 只读，不修改。
- [ ] README 说明 `USER.md` tag 不写入 `user-profile.json`。
- [ ] README 说明 `openclaw libp2p-mesh profile`。
- [ ] README 展示 `userPublicAttributes` 示例。
- [ ] README 展示 `p2p_send_user_attribute_message` 的 dry run 使用建议。
- [ ] README 说明第一版只在本地已发现实例范围内匹配，不是全网搜索。
- [ ] 最终 `npm test` 通过。
- [ ] 最终 `npm run build` 通过。
- [ ] 计划文件记录每个任务 commit SHA。

**接口合同（Interface Contract）:**

```md
### User public attributes

`libp2p-mesh` can announce user public attributes with instance route announcements.
```

- [ ] **步骤 1：编写失败的文档检查** (Red)

运行：

```bash
rg "openclaw libp2p-mesh profile" README.md
rg "userPublicAttributes" README.md
rg "p2p_send_user_attribute_message" README.md
```

预期：至少一个失败，表示 README 尚未记录新功能。

- [ ] **步骤 2：更新 README** (Green)

添加用户公开属性章节和按属性发送说明。

- [ ] **步骤 3：运行最终验证** (Green)

```bash
rg "openclaw libp2p-mesh profile" README.md
rg "userPublicAttributes" README.md
rg "p2p_send_user_attribute_message" README.md
npm test
npm run build
```

- [ ] **步骤 4：更新计划状态**

在每个任务标题下添加：

```md
**Status:** ✅ COMPLETE
**Completed:** 2026-06-23
**Commits:** `<sha>` `<message>`
```

- [ ] **步骤 5：提交文档和计划状态**

```bash
git add README.md docs/superpowers/plans/2026-06-23-user-public-attributes.md
git commit -m "docs: document user public attributes"
```

---

## 计划级质量门

完成所有任务后，执行统一代码质量审查：

- [ ] 审查范围：从任务 1 第一个提交到任务 7 最后一个提交。
- [ ] 审查重点：`USER.md` 只读边界、属性是否错误写入 profile、announce 兼容性、`instance-peer.json` 向后兼容、profile CLI 取消安全、按属性发送 dry run、群发部分失败处理。
- [ ] 审查通过后才能合并分支。

## Report 进度更新

本仓库没有外部 report 章节需要更新。本计划完成后只需要更新本计划文件任务状态，并在最终交付中说明：

- 设计 spec：`docs/superpowers/specs/2026-06-23-user-public-attributes-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-23-user-public-attributes.md`
- 最终测试命令：`npm test`
- 最终构建命令：`npm run build`

## Self-Review

- **Spec coverage:** 任务覆盖类型/纯函数、profile store、USER.md 提取、announce/store 集成、profile CLI、按属性发送、README 和最终验证。
- **Placeholder scan:** 本计划不包含占位任务或未完成接口说明。
- **Type consistency:** 字段统一为 `userPublicAttributes`；工具名统一为 `p2p_send_user_attribute_message`；CLI 命令统一为 `openclaw libp2p-mesh profile`。
- **Harness completeness:** 每个任务包含范围、前置条件、测试入口、通过标准、失败恢复、依赖和证据层。
- **Atomicity check:** 每个任务只处理一个关注点，并以独立提交结束。
- **TDD compliance:** 每个实现任务先写失败测试，再实现，再完整验证。
- **Privacy boundary:** 计划明确 `USER.md` 只读、不修改、不写入 profile，并限制提取数量和长度。
