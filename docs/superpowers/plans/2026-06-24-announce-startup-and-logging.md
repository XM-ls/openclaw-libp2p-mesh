# instance-announce 启动可靠性与日志实现计划

> **给执行者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐步实现此计划。步骤使用复选框（`- [ ]`）语法以便跟踪。

**目标：** 修复 gateway 启动期间早到 `instance-announce` 被 router 漏处理的问题，并新增可控 announce 摘要/payload 日志与独立 debug CLI。

**架构：** 将 `InstanceRouter.start()` 拆成“注册 handlers”和“向已连接 peers announce”两个阶段；插件 service 先注册 router 与 inbound handlers，再启动 mesh，最后发送 connected announce。新增 `announceLogDetail` 配置驱动 announce 日志输出，默认 `summary`，完整 payload 只能通过 `openclaw libp2p-mesh debug` 显式开启。

**技术栈：** TypeScript ESM、Node 内置 `node:test`、OpenClaw Plugin API `api.registerCli(...)`、现有 `InstanceRouter` / `MeshNetwork` / `setup-wizard` prompter 风格。

**Report 对齐：**
- **对应章节：** 本仓库无独立 report；本计划实现 `docs/superpowers/specs/2026-06-24-announce-startup-and-logging-design.md`。
- **证据层：** 实现代码和测试完成后属于 `repo-observed fact`；设计文档属于 `design intent`。
- **状态追踪：** 完成后更新本计划文件任务状态；无需更新外部 report 章节。

**依赖关系图：**

```text
任务 1 ──→ 任务 2 ──→ 任务 3 ──→ 任务 4 ──→ 任务 5
```

---

## 文件结构

- 修改 `src/types.ts`：扩展 `MeshConfig`、`InstanceRouter` 接口，增加 `AnnounceLogDetail` 类型。
- 修改 `src/instance-router.ts`：拆分 router 生命周期，增加幂等 `attachHandlers()`、公开 `announceToConnectedPeers()`，实现 announce 日志摘要/payload 输出。
- 修改 `src/plugin.ts`：调整 service start 顺序，提前注册 router 和 direct/broadcast inbound handlers。
- 修改 `src/profile-cli.ts` 或新增 `src/debug-cli.ts`：注册 `openclaw libp2p-mesh debug`，复用现有 CLI root 注册方式。
- 新增 `src/debug-wizard.ts`：debug 配置交互逻辑。
- 修改 `src/setup-config.ts` 或新增调试配置 helper：读写 `plugins.entries["libp2p-mesh"].config.announceLogDetail`。
- 修改 `openclaw.plugin.json`：在 `configSchema` 中声明 `announceLogDetail`。
- 修改 `test/instance-router.test.ts`：生命周期、早到 announce、日志模式测试。
- 修改 `test/setup-cli.test.ts` 或新增 `test/plugin-lifecycle.test.ts`：plugin start 顺序测试。
- 新增 `test/debug-cli.test.ts`、`test/debug-wizard.test.ts`：debug CLI 注册和交互测试。
- 修改 `README.md`：记录启动可靠性日志、debug 命令、payload 隐私风险。
- 修改根目录 smoke test（如需要）：覆盖早到 announce 场景。

---

## 任务 1: 拆分 InstanceRouter 生命周期

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `37d180d` `fix: attach instance router before mesh startup`

**Harness（测试框架）:**

- **范围：** 在 `InstanceRouter` 中新增幂等 `attachHandlers()` 和公开 `announceToConnectedPeers()`；保留 `start()` 兼容行为。不修改 `plugin.ts` 启动顺序，不实现 debug CLI。
- **前置条件：** `docs/superpowers/specs/2026-06-24-announce-startup-and-logging-design.md` 已提交。
- **测试入口：** `npm test -- test/instance-router.test.ts`
- **通过标准：** instance router 相关测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 无。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/types.ts`
- 修改：`src/instance-router.ts`
- 修改：`test/instance-router.test.ts`
- 修改：`test-instance-router.mjs`（如现有 smoke test 需要适配）

**行为清单（Behavior List）:**

- [ ] `attachHandlers()` 注册 `mesh.onMessage()` 和 `mesh.onPeerConnect()`。
- [ ] `attachHandlers()` 可在 mesh start 前调用。
- [ ] `attachHandlers()` 多次调用不会重复注册 handlers。
- [ ] `announceToConnectedPeers()` 只负责向当前 connected peers 发送 announce。
- [ ] `start()` 保持兼容，等价于 `attachHandlers()` 后再 `announceToConnectedPeers()`。
- [ ] `stop()` 能清理已注册 handlers，并允许后续重新 attach。
- [ ] 早到 `instance-announce` 在 handler 已 attach 后能写入 store。

**接口合同（Interface Contract）:**

```ts
export interface InstanceRouter {
  attachHandlers(): void;
  announceToConnectedPeers(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  // existing list/resolve/send APIs stay unchanged
}
```

- [ ] **步骤 1：编写失败的测试** (Red)

在 `test/instance-router.test.ts` 中新增测试，使用 fake mesh 捕获 `onMessage` / `onPeerConnect` 注册次数，并模拟 handler attach 后收到 `instance-announce`。

运行：

```bash
npm test -- test/instance-router.test.ts
```

预期：FAIL，原因是 `attachHandlers()` / `announceToConnectedPeers()` 尚不存在或行为不满足。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是功能缺失，不是测试拼写错误或 fake mesh 构造错误。

- [ ] **步骤 3：编写最小实现** (Green)

修改 `src/types.ts` 与 `src/instance-router.ts`，拆分生命周期并保持 `start()` 兼容。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/instance-router.test.ts
node --import tsx test-instance-router.mjs
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/types.ts src/instance-router.ts test/instance-router.test.ts test-instance-router.mjs
git commit -m "fix: attach instance router before mesh startup"
```

---

## 任务 2: 调整 plugin service 启动顺序

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `15f5d3e` `fix: register mesh handlers before startup`

**Harness（测试框架）:**

- **范围：** 修改 `src/plugin.ts`，让 router 与 direct/broadcast inbound handlers 在 `mesh.start()` 前注册，mesh 启动后再调用 `router.announceToConnectedPeers()`。不新增日志配置，不新增 debug CLI。
- **前置条件：** 任务 1 已提交。
- **测试入口：** `npm test -- test/setup-cli.test.ts test/instance-router.test.ts`
- **通过标准：** plugin 注册/启动相关测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/plugin.ts`
- 修改：`test/setup-cli.test.ts` 或新增 `test/plugin-lifecycle.test.ts`
- 修改：`test-instance-router.mjs`（如需要补双 router smoke）

**行为清单（Behavior List）:**

- [ ] service start 调用顺序为 `router.attachHandlers()` -> inbound handler attach -> `mesh.start()` -> `router.announceToConnectedPeers()`。
- [ ] mesh start 前收到的 `instance-announce` 不再因为 router handler 未注册而丢失。
- [ ] direct / broadcast inbound handler 也在 mesh start 前注册。
- [ ] service 重复 start 不重复注册 handlers。
- [ ] service stop 仍能释放 inbound unsubscribe 和 router handlers。

**接口合同（Interface Contract）:**

```ts
// plugin service start expected order
router.attachHandlers();
unsubscribeInbound = attachInboundHandlers();
await mesh.start();
await router.announceToConnectedPeers();
```

- [ ] **步骤 1：编写失败的测试** (Red)

在现有 plugin 注册测试或新 `test/plugin-lifecycle.test.ts` 中使用 fake mesh/router，记录调用顺序。测试应能证明 `mesh.start()` 前已经调用 `router.attachHandlers()`。

运行：

```bash
npm test -- test/setup-cli.test.ts test/instance-router.test.ts
```

预期：FAIL，原因是当前 service start 仍先 `mesh.start()`。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败是启动顺序不符合预期。

- [ ] **步骤 3：编写最小实现** (Green)

修改 `src/plugin.ts`，提取 direct/broadcast inbound handler attach 逻辑，并调整 service start 顺序。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/setup-cli.test.ts test/instance-router.test.ts
node --import tsx test-instance-router.mjs
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/plugin.ts test/setup-cli.test.ts test/instance-router.test.ts test-instance-router.mjs
git commit -m "fix: register mesh handlers before startup"
```

---

## 任务 3: announce 日志配置与输出

**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `9bb50fd` `feat: add announce log detail`, `5dd7174` `fix: preserve instance mapping logs`, `fcc0a01` `fix: preserve announce sent logs`

**Harness（测试框架）:**

- **范围：** 新增 `announceLogDetail` 配置，支持 `off` / `summary` / `payload`；发送和接收 announce 时按配置打印日志。不新增 debug CLI，不修改启动顺序。
- **前置条件：** 任务 1、任务 2 已提交。
- **测试入口：** `npm test -- test/instance-router.test.ts`
- **通过标准：** 日志模式测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 1、任务 2。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`src/types.ts`
- 修改：`src/instance-router.ts`
- 修改：`openclaw.plugin.json`
- 修改：`test/instance-router.test.ts`

**行为清单（Behavior List）:**

- [ ] `announceLogDetail` 支持 `off`、`summary`、`payload`。
- [ ] 缺省或未知值按 `summary` 处理。
- [ ] `summary` 发送日志包含 peer、instance、`addrs=<n>`、`attrs=<n>`。
- [ ] `summary` 接收日志包含 peer、instance、`addrs=<n>`、`attrs=<n>`、`changed=<boolean>`。
- [ ] `payload` 模式额外打印完整 announce JSON。
- [ ] `off` 模式不打印新增 summary/payload 日志，但不影响现有 warn/error。
- [ ] payload 序列化异常时降级为 summary，不影响 announce 发送或接收。
- [ ] `openclaw.plugin.json` schema 声明 `announceLogDetail` enum 和默认值。

**接口合同（Interface Contract）:**

```ts
export type AnnounceLogDetail = "off" | "summary" | "payload";

export interface MeshConfig {
  announceLogDetail?: AnnounceLogDetail;
}
```

- [ ] **步骤 1：编写失败的测试** (Red)

在 `test/instance-router.test.ts` 中为 fake logger 增加日志捕获，覆盖 `summary`、`payload`、`off` 和未知值。

运行：

```bash
npm test -- test/instance-router.test.ts
```

预期：FAIL，原因是配置和日志输出尚不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败是缺少日志配置或输出不符合预期。

- [ ] **步骤 3：编写最小实现** (Green)

实现类型、schema 和 router 日志输出。避免默认打印完整 JSON。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/instance-router.test.ts
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/types.ts src/instance-router.ts openclaw.plugin.json test/instance-router.test.ts
git commit -m "feat: add announce log detail"
```

---

## 任务 4: debug CLI 管理 announce 日志配置

**Harness（测试框架）:**

- **范围：** 新增 `openclaw libp2p-mesh debug`，只管理调试配置 `announceLogDetail`。不进入普通 `setup` 主流程，不修改 profile CLI，不修改 announce 发送逻辑。
- **前置条件：** 任务 3 已提交。
- **测试入口：** `npm test -- test/debug-wizard.test.ts test/debug-cli.test.ts`
- **通过标准：** debug wizard/CLI 测试通过，完整 `npm test`、`npm run build` 通过。
- **失败恢复：** `git reset --hard HEAD~1`
- **依赖：** 任务 3。
- **证据层：** `repo-observed fact`

**文件:**

- 新增：`src/debug-wizard.ts`
- 新增或修改：`src/debug-cli.ts`
- 修改：`src/profile-cli.ts` 或现有 CLI root 注册文件
- 修改：`src/setup-config.ts`（如复用 config mutation helpers）
- 新增：`test/debug-wizard.test.ts`
- 新增：`test/debug-cli.test.ts`
- 修改：`test/profile-cli.test.ts` 或 `test/setup-cli.test.ts`（如 root command 子命令数量断言需要更新）

**行为清单（Behavior List）:**

- [ ] 注册命令路径 `openclaw libp2p-mesh debug`。
- [ ] `debug` 与 `setup`、`profile` 同属 `libp2p-mesh` root command。
- [ ] 显示当前 `announceLogDetail`，缺失时显示 `summary`。
- [ ] 支持设置 `summary`、`off`、`payload`。
- [ ] 选择 `payload` 必须二次确认。
- [ ] payload 二次确认拒绝时不写入。
- [ ] Ctrl+C 或取消不写入。
- [ ] 写入位置为 `plugins.entries["libp2p-mesh"].config.announceLogDetail`，不写 `channels`。
- [ ] 保存后提示重启 gateway 生效。

**接口合同（Interface Contract）:**

```ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { SetupPrompter } from "./setup-wizard.js";
import type { AnnounceLogDetail } from "./types.js";

export type RunDebugWizardOptions = {
  prompter: SetupPrompter;
  current: AnnounceLogDetail;
  writer: {
    saveAnnounceLogDetail(detail: AnnounceLogDetail): Promise<void>;
  };
};

export function runDebugWizard(options: RunDebugWizardOptions): Promise<
  | { status: "saved"; announceLogDetail: AnnounceLogDetail; message: string }
  | { status: "cancelled"; message: string }
>;

export function registerLibp2pMeshDebugCli(api: OpenClawPluginApi): void;
```

- [ ] **步骤 1：编写失败的测试** (Red)

创建 `test/debug-wizard.test.ts` 和 `test/debug-cli.test.ts`，复用 setup/profile CLI 的 fake prompter 与 fake command 模式。

运行：

```bash
npm test -- test/debug-wizard.test.ts test/debug-cli.test.ts
```

预期：FAIL，原因是模块或命令不存在。

- [ ] **步骤 2：运行测试确认失败** (Red)

确认失败原因是 debug CLI/wizard 缺失。

- [ ] **步骤 3：编写最小实现** (Green)

实现 debug wizard、CLI 注册和 config 写入 helper。确保不改普通 setup 流程。

- [ ] **步骤 4：运行完整验证** (Green)

```bash
npm test -- test/debug-wizard.test.ts test/debug-cli.test.ts
npm test
npm run build
```

- [ ] **步骤 5：提交代码**

```bash
git add src/debug-wizard.ts src/debug-cli.ts src/profile-cli.ts src/setup-config.ts test/debug-wizard.test.ts test/debug-cli.test.ts test/profile-cli.test.ts test/setup-cli.test.ts
git commit -m "feat: add libp2p mesh debug cli"
```

---

## 任务 5: README、最终验证与计划状态

**Harness（测试框架）:**

- **范围：** 更新 README，记录启动可靠性、`announceLogDetail`、`openclaw libp2p-mesh debug`、payload 隐私风险和排查步骤；运行最终验证并更新本计划状态。不修改功能代码。
- **前置条件：** 任务 1-4 已提交。
- **测试入口：** `npm test && npm run build`
- **通过标准：** README 包含新命令和配置说明；最终测试和构建通过；计划文件记录完成状态。
- **失败恢复：** 如果仅文档错误，`git restore README.md docs/superpowers/plans/2026-06-24-announce-startup-and-logging.md` 后重做。
- **依赖：** 任务 1、任务 2、任务 3、任务 4。
- **证据层：** `repo-observed fact`

**文件:**

- 修改：`README.md`
- 修改：`docs/superpowers/plans/2026-06-24-announce-startup-and-logging.md`

**行为清单（Behavior List）:**

- [ ] README 说明 gateway 启动时先注册 handlers，再启动 mesh。
- [ ] README 说明 `announceLogDetail` 的 `off`、`summary`、`payload`。
- [ ] README 说明默认 `summary` 不打印完整 JSON。
- [ ] README 说明 `payload` 可能包含 `userPublicAttributes`、multiaddrs、pubkey、instance identity。
- [ ] README 说明 `openclaw libp2p-mesh debug`。
- [ ] README 提供双机排查时如何启用 payload 日志。
- [ ] 最终 `npm test` 通过。
- [ ] 最终 `npm run build` 通过。
- [ ] 根目录 smoke tests 通过：`test-instance-router.mjs`、`test-instance-peer-store.mjs`。
- [ ] 计划文件记录每个任务 commit SHA。

**接口合同（Interface Contract）:**

```md
### Announce startup and logging

`libp2p-mesh` registers instance router handlers before starting the mesh node so early instance announcements are not lost.
```

- [ ] **步骤 1：编写失败的文档检查** (Red)

运行：

```bash
rg "openclaw libp2p-mesh debug" README.md
rg "announceLogDetail" README.md
rg "Full payload" README.md
```

预期：至少一个失败，表示 README 尚未记录新功能。

- [ ] **步骤 2：更新 README** (Green)

添加启动可靠性和 announce 日志配置说明。

- [ ] **步骤 3：运行最终验证** (Green)

```bash
rg "openclaw libp2p-mesh debug" README.md
rg "announceLogDetail" README.md
rg "Full payload" README.md
node --import tsx test-instance-router.mjs
node --import tsx test-instance-peer-store.mjs
npm test
npm run build
```

- [ ] **步骤 4：更新计划状态**

在每个任务标题下添加：

```md
**Status:** ✅ COMPLETE
**Completed:** 2026-06-24
**Commits:** `<sha>` `<message>`
```

- [ ] **步骤 5：提交文档和计划状态**

```bash
git add README.md docs/superpowers/plans/2026-06-24-announce-startup-and-logging.md
git commit -m "docs: document announce startup and logging"
```

---

## 计划级质量门

完成所有任务后，执行统一代码质量审查：

- [ ] 审查范围：从任务 1 第一个提交到任务 5 最后一个提交。
- [ ] 审查重点：启动期早到 announce 不丢失、handler attach 幂等、stop 清理、direct/broadcast handler 启动顺序、默认日志不泄露完整 payload、payload 日志显式配置和二次确认、debug CLI 不污染 setup 主流程。
- [ ] 审查通过后才能合并分支。

## Report 进度更新

本仓库没有外部 report 章节需要更新。本计划完成后只需要更新本计划文件任务状态，并在最终交付中说明：

- 设计 spec：`docs/superpowers/specs/2026-06-24-announce-startup-and-logging-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-24-announce-startup-and-logging.md`
- 最终测试命令：`npm test`
- 最终构建命令：`npm run build`
