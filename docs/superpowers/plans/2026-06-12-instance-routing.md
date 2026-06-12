# Instance 路由实现计划

> **给 agentic workers：** 必须使用子技能：推荐使用 `superpowers:subagent-driven-development`，或使用 `superpowers:executing-plans`，按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪进度。

**目标：** 为 `libp2p-mesh` 构建基于 `instanceId` 的路由能力，包括自动维护 `instanceId <-> peerId` 映射表、instance 级 Agent 工具、飞书入站转发和 delivery ACK。

**架构：** 在现有 `MeshNetwork` 之上增加一个职责集中的 `InstanceRouter`。mesh 层增加结构化消息发送和 peer 连接事件；router 负责 announce 处理、`instance-peer.json`、ACK 跟踪和入站投递。OpenClaw 仍然通过插件元数据和 `api.registerTool()` 发现工具。

**技术栈：** TypeScript `NodeNext`、libp2p、OpenClaw plugin SDK、Node `fs/promises`、Node `child_process`、独立 `node --import tsx` 测试脚本。

---

## 文件结构

- 新建 `src/instance-peer-store.ts`：负责 `instance-peer.json` 路径解析、加载、原子写入、损坏文件备份，以及路由 upsert/resolve/list 行为。
- 新建 `src/instance-router.ts`：负责 announce 发送/接收、user-message 发送、pending ACK map、入站 user-message 投递、重复消息抑制和路由查询。
- 新建 `src/inbound-delivery.ts`：封装第一版投递机制，等价于 `openclaw message send --channel <channel> --target <target> --message <text>`。
- 修改 `src/types.ts`：增加消息类型 union、payload interface、instance route/store 类型、router interface、mesh event API、结构化消息 API 和新增配置字段。
- 修改 `src/mesh.ts`：暴露结构化消息发送和 peer-connect 订阅；把 peer connect/disconnect 日志移动到 `info` 级别。
- 修改 `src/agent-tools.ts`：接受可选 `InstanceRouter` 并注册新工具。
- 修改 `src/plugin.ts`：构造 `InstancePeerStore`、`InboundDeliveryAdapter` 和 `InstanceRouter`；把 router 生命周期接入 service start/stop；注册扩展后的工具。
- 修改 `index.ts` 和 `openclaw.plugin.json`：增加 config schema 字段和 tool contract 声明。
- 修改 `api.ts`：导出对测试和消费者有用的新 public types。
- 修改 `README.md` 和 `TESTING.md`：记录配置、自动生成的映射文件、自动工具注册、新工具、飞书入站投递、ACK 语义和可见 info 日志。
- 新增 `test-instance-peer-store.mjs`：独立 store 测试。
- 新增 `test-instance-router.mjs`：使用 fake mesh 和 fake delivery adapter 的独立 router 测试。
- 修改 `test-mesh-core.mjs`：验证 info 级 peer connection 日志和结构化消息支持。
- 新增或修改 `test/nat-docker/config/*/openclaw.json`：包含第一版入站配置，用于 NAT 回归。

除非某个任务明确要求修改，否则不要把现有 dirty 文件纳入本计划的提交。本计划编写时，`package.json` 和 `opencode.json` 存在与本计划无关的本地状态。

---

### 任务 1：扩展共享类型和配置结构

**文件：**
- 修改：`src/types.ts`
- 修改：`index.ts`
- 修改：`openclaw.plugin.json`
- 通过命令测试：`pnpm build`

- [x] **步骤 1：在 `src/types.ts` 中增加 message、route、store、router、delivery 和 config 类型**

在现有 interfaces 附近加入这些 exports。保留现有字段并扩展它们，不要删除兼容性表面。

```ts
export type P2PMessageType =
  | "direct"
  | "broadcast"
  | "agent-sync"
  | "instance-announce"
  | "user-message"
  | "delivery-ack";

export interface InstanceAnnouncePayload {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  multiaddrs: string[];
  pubkey?: string;
  announcedAt: number;
}

export interface UserMessagePayload {
  messageId: string;
  fromInstanceId: string;
  toInstanceId: string;
  text: string;
  metadata: {
    allowAgentAutoReply: boolean;
    replyToInstanceId: string;
    replyTool: "p2p_send_instance_message";
  };
}

export interface DeliveryAckPayload {
  ackFor: string;
  ok: boolean;
  inboundChannel?: string;
  inboundTarget?: string;
  deliveredAt: number;
  error?: string;
}

export interface InstancePeerRecord {
  instanceId: string;
  peerId: string;
  instanceName?: string;
  multiaddrs: string[];
  pubkey?: string;
  lastSeenAt: number;
  lastAnnouncedAt: number;
  source: "announce";
}

export interface InstancePeerTable {
  version: 1;
  updatedAt: number;
  instances: Record<string, InstancePeerRecord>;
}

export interface InstancePeerStore {
  load(): Promise<InstancePeerTable>;
  list(): Promise<InstancePeerRecord[]>;
  resolve(instanceId: string): Promise<InstancePeerRecord | undefined>;
  upsertFromAnnounce(payload: InstanceAnnouncePayload): Promise<{
    record: InstancePeerRecord;
    changed: boolean;
    peerIdSharedBy: string[];
  }>;
}

export interface InboundDeliveryRequest {
  channel: string;
  target: string;
  text: string;
  metadata: {
    fromInstanceId: string;
    fromPeerId: string;
    p2pMessageId: string;
    allowAgentAutoReply: boolean;
    replyToInstanceId: string;
    replyTool: "p2p_send_instance_message";
  };
}

export interface InboundDeliveryResult {
  ok: boolean;
  channel: string;
  target: string;
  error?: string;
}

export interface InboundDeliveryAdapter {
  deliver(request: InboundDeliveryRequest): Promise<InboundDeliveryResult>;
}

export interface InstanceRouter {
  start(): Promise<void>;
  stop(): Promise<void>;
  handleMessage(msg: P2PMessage): Promise<void>;
  announceToPeer(peerId: string): Promise<void>;
  listInstances(): Promise<InstancePeerRecord[]>;
  resolveInstance(instanceId: string): Promise<InstancePeerRecord | undefined>;
  sendInstanceMessage(instanceId: string, message: string): Promise<{
    sent: boolean;
    delivered: boolean;
    toInstanceId: string;
    toPeerId: string;
    ackMessageId?: string;
    inboundChannel?: string;
    error?: string;
  }>;
}
```

将 `P2PMessage.type` 从内联 union 改为 `P2PMessageType`，本任务中继续保持 `payload` 为 `string`，以维持 wire compatibility：

```ts
export interface P2PMessage {
  id: string;
  type: P2PMessageType;
  from: string;
  to?: string;
  topic?: string;
  payload: string;
  timestamp: number;
  instanceId?: string;
  pubkey?: string;
  signature?: string;
}
```

扩展 `MeshConfig`:

```ts
export interface MeshConfig {
  // existing fields remain unchanged
  inboundChannel?: string;
  inboundTarget?: string;
  deliveryAckTimeoutMs?: number;
}
```

扩展 `MeshNetwork`:

```ts
export interface MeshNetwork {
  // existing methods remain unchanged
  sendStructuredMessage(peerId: string, message: Omit<P2PMessage, "from" | "timestamp" | "instanceId" | "pubkey" | "signature"> & { timestamp?: number }): Promise<void>;
  onPeerConnect(handler: (peerId: string) => void): () => void;
  onPeerDisconnect(handler: (peerId: string) => void): () => void;
}
```

- [x] **步骤 2：在 `index.ts` 中增加 config schema 字段**

把这些属性加入 `createLibp2pMeshConfigSchema().jsonSchema.properties`：

```ts
        inboundChannel: {
          type: "string",
          description: "OpenClaw channel used to display inbound P2P user messages, for example \"feishu\".",
        },
        inboundTarget: {
          type: "string",
          description: "OpenClaw channel target for inbound P2P user messages, for example user:ou_xxx or chat:oc_xxx.",
        },
        deliveryAckTimeoutMs: {
          type: "number",
          default: 15000,
          description: "How long p2p_send_instance_message waits for a remote delivery ACK.",
        },
```

- [x] **步骤 3：在 `openclaw.plugin.json` 中增加 manifest config 和 tool contracts**

在 `configSchema.properties` 下增加配置属性：

```json
      "inboundChannel": {
        "type": "string",
        "description": "OpenClaw channel used to display inbound P2P user messages, for example \"feishu\"."
      },
      "inboundTarget": {
        "type": "string",
        "description": "OpenClaw channel target for inbound P2P user messages, for example user:ou_xxx or chat:oc_xxx."
      },
      "deliveryAckTimeoutMs": {
        "type": "number",
        "default": 15000,
        "description": "How long p2p_send_instance_message waits for a remote delivery ACK."
      }
```

把新工具追加到 `contracts.tools`：

```json
      "p2p_list_instances",
      "p2p_resolve_instance",
      "p2p_send_instance_message"
```

- [x] **步骤 4：运行 build 以捕获类型和 schema 错误**

运行：

```bash
pnpm build
```

预期：如果 TypeScript 错误只来自 `MeshNetwork` 实现还缺少新方法，这一步可以接受。`src/types.ts`、`index.ts` 或 `openclaw.plugin.json` 中的语法错误必须先修复再继续。

- [x] **步骤 5：提交类型和 manifest contract 变更**

```bash
git add src/types.ts index.ts openclaw.plugin.json
git commit -m "feat: define instance routing contracts"
```

---

### 任务 2：增加结构化 Mesh 发送和可见 Peer 日志

**文件：**
- 修改：`src/mesh.ts`
- 修改：`test-mesh-core.mjs`
- 通过命令测试：`node --import tsx test-mesh-core.mjs`

- [x] **步骤 1：扩展 mesh core 测试以覆盖结构化消息**

在 `test-mesh-core.mjs` 的现有 direct message 测试之后，增加结构化消息检查：

```js
  // ---------- Test 1b: Structured instance announce ----------
  console.log("\n[Test 1b] Structured instance announce from A to B...");

  const structuredReceivedByB = [];
  const unsubStructured = nodeB.onMessage((msg) => {
    if (msg.type === "instance-announce") {
      structuredReceivedByB.push(msg);
    }
  });

  await nodeA.sendStructuredMessage(peerIdB, {
    id: crypto.randomUUID(),
    type: "instance-announce",
    to: peerIdB,
    payload: JSON.stringify({
      instanceId: "test-instance-a",
      peerId: peerIdA,
      instanceName: "test-a",
      multiaddrs: nodeA.getMultiaddrs(),
      announcedAt: Date.now(),
    }),
  });
  await delay(500);
  unsubStructured();

  assert(structuredReceivedByB.length === 1, "B received one structured announce");
  assert(structuredReceivedByB[0].type === "instance-announce", "Structured message type is instance-announce");
  assert(structuredReceivedByB[0].from === peerIdA, "Structured message sender is A");
```

通过 `logsA` 和 `logsB` 收集日志，增加可见 info 日志断言。把当前 logger 定义替换为数组：

```js
  const logsA = [];
  const logsB = [];
```

对于 node A：

```js
    logger: {
      info: (m) => {
        logsA.push(m);
        if (LOG) console.log(`[A] ${m}`);
      },
      debug: LOG ? (m) => console.log(`[A] ${m}`) : () => {},
      error: (m) => console.error(`[A] ${m}`),
    },
```

对于 node B：

```js
    logger: {
      info: (m) => {
        logsB.push(m);
        if (LOG) console.log(`[B] ${m}`);
      },
      debug: LOG ? (m) => console.log(`[B] ${m}`) : () => {},
      error: (m) => console.error(`[B] ${m}`),
    },
```

在连接断言之后增加：

```js
  assert(
    logsA.some((m) => m.includes("Peer connected")) || logsB.some((m) => m.includes("Peer connected")),
    "Peer connection is logged at info level"
  );
```

- [x] **步骤 2：运行测试以确认当前失败**

运行：

```bash
node --import tsx test-mesh-core.mjs
```

预期：失败，错误为 `nodeA.sendStructuredMessage is not a function` 或等价错误。

- [x] **步骤 3：实现 mesh 结构化发送和 peer event 订阅**

在 `src/mesh.ts` 中，在 `messageHandlers` 附近增加 handler sets：

```ts
  const peerConnectHandlers = new Set<(peerId: string) => void>();
  const peerDisconnectHandlers = new Set<(peerId: string) => void>();
```

把 peer event listeners 从 `debug` 改为 `info`，并调用 handlers：

```ts
    state.node.addEventListener("peer:connect", (evt) => {
      const peerIdStr = evt.detail.toString();
      logger?.info?.(`[libp2p-mesh] Peer connected: ${peerIdStr}`);
      for (const handler of peerConnectHandlers) {
        try {
          handler(peerIdStr);
        } catch (err) {
          logger?.error?.(`[libp2p-mesh] Peer connect handler error: ${String(err)}`);
        }
      }
    });

    state.node.addEventListener("peer:disconnect", (evt) => {
      const peerIdStr = evt.detail.toString();
      logger?.info?.(`[libp2p-mesh] Peer disconnected: ${peerIdStr}`);
      for (const handler of peerDisconnectHandlers) {
        try {
          handler(peerIdStr);
        } catch (err) {
          logger?.error?.(`[libp2p-mesh] Peer disconnect handler error: ${String(err)}`);
        }
      }
    });
```

把 `sendToPeer` 中写 stream 的部分抽取为 helper：

```ts
  async function writeMessageToPeer(peerId: string, msg: P2PMessage): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }

    const data = new TextEncoder().encode(JSON.stringify(msg));
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 8000);

    try {
      const { peerIdFromString } = await import("@libp2p/peer-id");
      const targetPid = peerIdFromString(peerId);

      const alreadyConnected = state.node
        .getConnections()
        .some((c) => c.remotePeer.equals(targetPid));
      if (!alreadyConnected) {
        const relayAddrs = config.relayList ?? [];
        for (const relayAddr of relayAddrs) {
          try {
            const circuit = relayAddr.endsWith("/p2p-circuit")
              ? `${relayAddr}/p2p/${peerId}`
              : `${relayAddr}/p2p-circuit/p2p/${peerId}`;
            const { multiaddr } = await import("@multiformats/multiaddr");
            logger?.debug?.(`[libp2p-mesh] sendToPeer: pre-dialling ${peerId} via relay path ${circuit}`);
            await state.node.dial(multiaddr(circuit), { signal: abortController.signal });
            logger?.debug?.(`[libp2p-mesh] sendToPeer: established relayed connection to ${peerId}`);
            break;
          } catch (relayErr) {
            logger?.debug?.(`[libp2p-mesh] sendToPeer: relay pre-dial via ${relayAddr} failed: ${String(relayErr)}`);
          }
        }
      }

      logger?.debug?.(`[libp2p-mesh] dialProtocol to ${peerId}`);
      const stream = await state.node.dialProtocol(targetPid, PROTOCOL, {
        signal: abortController.signal,
        runOnTransientConnection: true,
      });
      if (!stream) {
        throw new Error(`Failed to establish stream to ${peerId}; peer may be unreachable`);
      }
      logger?.debug?.(`[libp2p-mesh] stream opened to ${peerId}`);
      await pipe([new Uint8ArrayList(data)], encode, stream.sink);
      logger?.debug?.(`[libp2p-mesh] message sent to ${peerId}`);
    } catch (err) {
      logger?.error?.(`[libp2p-mesh] sendToPeer error: ${String(err)}`);
      if (abortController.signal.aborted) {
        throw new Error(`Send to ${peerId} timed out after 8s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
```

重构 `sendToPeer`，让它构造现有 direct message 后调用 helper：

```ts
  async function sendToPeer(peerId: string, message: string): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }

    const msg = buildSignedMessage({
      id: crypto.randomUUID(),
      type: "direct",
      from: state.node.peerId.toString(),
      to: peerId,
      payload: message,
      timestamp: Date.now(),
    });

    await writeMessageToPeer(peerId, msg);
  }
```

增加 `sendStructuredMessage`：

```ts
  async function sendStructuredMessage(
    peerId: string,
    message: Omit<P2PMessage, "from" | "timestamp" | "instanceId" | "pubkey" | "signature"> & { timestamp?: number },
  ): Promise<void> {
    if (!state.node) {
      throw new Error("Mesh network is not started");
    }
    const msg = buildSignedMessage({
      ...message,
      from: state.node.peerId.toString(),
      timestamp: message.timestamp ?? Date.now(),
    });
    await writeMessageToPeer(peerId, msg);
  }
```

增加订阅函数：

```ts
  function onPeerConnect(handler: (peerId: string) => void): () => void {
    peerConnectHandlers.add(handler);
    return () => {
      peerConnectHandlers.delete(handler);
    };
  }

  function onPeerDisconnect(handler: (peerId: string) => void): () => void {
    peerDisconnectHandlers.add(handler);
    return () => {
      peerDisconnectHandlers.delete(handler);
    };
  }
```

从 `createMeshNetwork` 返回这些新方法。

- [x] **步骤 4：运行 mesh 测试**

运行：

```bash
node --import tsx test-mesh-core.mjs
```

预期：`All tests passed!`

- [x] **步骤 5：运行 build**

```bash
pnpm build
```

预期：没有 TypeScript 错误。

- [x] **步骤 6：提交 mesh API 和 info 日志变更**

```bash
git add src/mesh.ts test-mesh-core.mjs
git commit -m "feat: add structured mesh messages"
```

---

### 任务 3：实现持久化 Instance Peer Store

**文件：**
- 新建：`src/instance-peer-store.ts`
- 新增：`test-instance-peer-store.mjs`
- 通过命令测试：`node --import tsx test-instance-peer-store.mjs`

- [ ] **步骤 1：编写 store 测试**

Create `test-instance-peer-store.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createInstancePeerStore,
  resolveInstancePeerPath,
} from "./src/instance-peer-store.js";

async function run() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-instance-store-"));
  const filePath = path.join(dir, "libp2p", "instance-peer.json");
  const warnings = [];
  const store = createInstancePeerStore({
    path: filePath,
    logger: { warn: (m) => warnings.push(m), info: () => {}, debug: () => {} },
  });

  const empty = await store.load();
  assert.equal(empty.version, 1);
  assert.deepEqual(empty.instances, {});

  const first = await store.upsertFromAnnounce({
    instanceId: "alice@abc.123",
    peerId: "peer-a",
    instanceName: "alice",
    multiaddrs: ["/ip4/127.0.0.1/tcp/1/p2p/peer-a"],
    pubkey: "pub-a",
    announcedAt: 1000,
  });
  assert.equal(first.changed, true);
  assert.equal(first.record.peerId, "peer-a");

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].instanceId, "alice@abc.123");

  const resolved = await store.resolve("alice@abc.123");
  assert.equal(resolved?.peerId, "peer-a");

  const same = await store.upsertFromAnnounce({
    instanceId: "alice@abc.123",
    peerId: "peer-a",
    instanceName: "alice",
    multiaddrs: ["/ip4/127.0.0.1/tcp/1/p2p/peer-a"],
    pubkey: "pub-a",
    announcedAt: 1000,
  });
  assert.equal(same.changed, false);

  const moved = await store.upsertFromAnnounce({
    instanceId: "alice@abc.123",
    peerId: "peer-a2",
    instanceName: "alice",
    multiaddrs: ["/ip4/127.0.0.1/tcp/2/p2p/peer-a2"],
    pubkey: "pub-a",
    announcedAt: 2000,
  });
  assert.equal(moved.changed, true);
  assert.equal(moved.record.peerId, "peer-a2");

  await store.upsertFromAnnounce({
    instanceId: "alice-copy@abc.123",
    peerId: "peer-a2",
    instanceName: "alice-copy",
    multiaddrs: [],
    pubkey: "pub-copy",
    announcedAt: 3000,
  });
  assert.equal(warnings.some((m) => m.includes("peer-a2")), true);

  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(saved.version, 1);
  assert.equal(saved.instances["alice@abc.123"].peerId, "peer-a2");

  await writeFile(filePath, "{ broken json", "utf8");
  const recovered = await store.load();
  assert.deepEqual(recovered.instances, {});

  const defaultPath = resolveInstancePeerPath();
  assert.equal(defaultPath.endsWith(path.join(".openclaw", "libp2p", "instance-peer.json")), true);

  console.log("test-instance-peer-store: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **步骤 2：运行 store 测试以确认失败**

```bash
node --import tsx test-instance-peer-store.mjs
```

预期：失败，因为 `src/instance-peer-store.ts` 还不存在。

- [ ] **步骤 3：实现 `src/instance-peer-store.ts`**

创建该模块：

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  InstanceAnnouncePayload,
  InstancePeerRecord,
  InstancePeerStore,
  InstancePeerTable,
} from "./types.js";

type StoreLogger = {
  info?: (msg: string) => void;
  debug?: (msg: string) => void;
  warn?: (msg: string) => void;
};

export function resolveInstancePeerPath(customPath?: string): string {
  if (customPath) return customPath;
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, "libp2p", "instance-peer.json");
  }
  return path.join(homedir(), ".openclaw", "libp2p", "instance-peer.json");
}

function emptyTable(): InstancePeerTable {
  return { version: 1, updatedAt: Date.now(), instances: {} };
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameRecord(record: InstancePeerRecord | undefined, payload: InstanceAnnouncePayload): boolean {
  if (!record) return false;
  return (
    record.peerId === payload.peerId &&
    record.instanceName === payload.instanceName &&
    record.pubkey === payload.pubkey &&
    sameStringArray(record.multiaddrs, payload.multiaddrs) &&
    record.lastAnnouncedAt === payload.announcedAt
  );
}

export function createInstancePeerStore(options?: {
  path?: string;
  logger?: StoreLogger;
}): InstancePeerStore {
  const filePath = resolveInstancePeerPath(options?.path);
  const logger = options?.logger;
  let cached: InstancePeerTable | null = null;

  async function load(): Promise<InstancePeerTable> {
    if (cached) return cached;
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as InstancePeerTable;
      cached = {
        version: 1,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
        instances: parsed.instances && typeof parsed.instances === "object" ? parsed.instances : {},
      };
      return cached;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        cached = emptyTable();
        return cached;
      }
      const corruptPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await rename(filePath, corruptPath);
        logger?.warn?.(`[libp2p-mesh] instance-peer.json was corrupt; moved to ${corruptPath}`);
      } catch (renameErr) {
        logger?.warn?.(`[libp2p-mesh] Failed to back up corrupt instance-peer.json: ${String(renameErr)}`);
      }
      cached = emptyTable();
      return cached;
    }
  }

  async function save(table: InstancePeerTable): Promise<void> {
    table.updatedAt = Date.now();
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, `${JSON.stringify(table, null, 2)}\n`, "utf8");
    await rename(tmpPath, filePath);
    cached = table;
  }

  async function list(): Promise<InstancePeerRecord[]> {
    const table = await load();
    return Object.values(table.instances).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async function resolve(instanceId: string): Promise<InstancePeerRecord | undefined> {
    const table = await load();
    return table.instances[instanceId];
  }

  async function upsertFromAnnounce(payload: InstanceAnnouncePayload): Promise<{
    record: InstancePeerRecord;
    changed: boolean;
    peerIdSharedBy: string[];
  }> {
    const table = await load();
    const previous = table.instances[payload.instanceId];
    const now = Date.now();
    const changed = !sameRecord(previous, payload);
    const record: InstancePeerRecord = {
      instanceId: payload.instanceId,
      peerId: payload.peerId,
      instanceName: payload.instanceName,
      multiaddrs: payload.multiaddrs,
      pubkey: payload.pubkey,
      lastSeenAt: now,
      lastAnnouncedAt: payload.announcedAt,
      source: "announce",
    };
    table.instances[payload.instanceId] = record;

    const peerIdSharedBy = Object.values(table.instances)
      .filter((entry) => entry.peerId === payload.peerId)
      .map((entry) => entry.instanceId);
    if (peerIdSharedBy.length > 1) {
      logger?.warn?.(
        `[libp2p-mesh] Peer ID ${payload.peerId} is mapped to multiple instances: ${peerIdSharedBy.join(", ")}`,
      );
    }

    await save(table);
    return { record, changed, peerIdSharedBy };
  }

  return { load, list, resolve, upsertFromAnnounce };
}
```

- [ ] **步骤 4：运行 store 测试**

```bash
node --import tsx test-instance-peer-store.mjs
```

预期：`test-instance-peer-store: all assertions passed`

- [ ] **步骤 5：运行 build**

```bash
pnpm build
```

预期：没有 TypeScript 错误。

- [ ] **步骤 6：提交 store**

```bash
git add src/instance-peer-store.ts test-instance-peer-store.mjs
git commit -m "feat: add instance peer store"
```

---

### 任务 4：增加入站投递 Adapter

**文件：**
- 新建：`src/inbound-delivery.ts`
- 测试覆盖放在下一任务的 `test-instance-router.mjs` 中
- 通过命令测试：`pnpm build`

- [ ] **步骤 1：实现 `src/inbound-delivery.ts`**

创建：

```ts
import { spawn } from "node:child_process";
import type {
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InboundDeliveryResult,
} from "./types.js";

type DeliveryLogger = {
  info?: (msg: string) => void;
  debug?: (msg: string) => void;
  warn?: (msg: string) => void;
};

export function createOpenClawCliInboundDelivery(options?: {
  command?: string;
  logger?: DeliveryLogger;
}): InboundDeliveryAdapter {
  const command = options?.command ?? "openclaw";
  const logger = options?.logger;

  return {
    async deliver(request: InboundDeliveryRequest): Promise<InboundDeliveryResult> {
      const args = [
        "message",
        "send",
        "--channel",
        request.channel,
        "--target",
        request.target,
        "--message",
        request.text,
      ];

      logger?.debug?.(`[libp2p-mesh] Forwarding inbound P2P message via ${command} ${args.join(" ")}`);

      return await new Promise<InboundDeliveryResult>((resolve) => {
        const child = spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];

        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

        child.on("error", (err) => {
          resolve({
            ok: false,
            channel: request.channel,
            target: request.target,
            error: String(err),
          });
        });

        child.on("close", (code) => {
          if (code === 0) {
            logger?.info?.(
              `[libp2p-mesh] Forwarded inbound P2P message to ${request.channel}:${request.target}`,
            );
            resolve({ ok: true, channel: request.channel, target: request.target });
            return;
          }
          const out = Buffer.concat(stdout).toString("utf8").trim();
          const err = Buffer.concat(stderr).toString("utf8").trim();
          resolve({
            ok: false,
            channel: request.channel,
            target: request.target,
            error: err || out || `openclaw message send exited with code ${code}`,
          });
        });
      });
    },
  };
}
```

- [ ] **步骤 2：运行 build**

```bash
pnpm build
```

预期：没有 TypeScript 错误。

- [ ] **步骤 3：提交入站投递 adapter**

```bash
git add src/inbound-delivery.ts
git commit -m "feat: add inbound delivery adapter"
```

---

### 任务 5：实现 Instance Router

**文件：**
- 新建：`src/instance-router.ts`
- 新增：`test-instance-router.mjs`
- 通过命令测试：`node --import tsx test-instance-router.mjs`

- [ ] **步骤 1：编写使用 fake mesh 和 fake delivery 的 router 测试**

Create `test-instance-router.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInstancePeerStore } from "./src/instance-peer-store.js";
import { createInstanceRouter } from "./src/instance-router.js";

function createFakeMesh(identity, peerId) {
  const messages = [];
  const messageHandlers = new Set();
  const connectHandlers = new Set();
  return {
    messages,
    emitConnect(id) {
      for (const handler of connectHandlers) handler(id);
    },
    emitMessage(msg) {
      for (const handler of messageHandlers) handler(msg);
    },
    async start() {},
    async stop() {},
    async sendToPeer() {},
    async sendStructuredMessage(targetPeerId, message) {
      messages.push({ targetPeerId, message });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onPeerConnect(handler) {
      connectHandlers.add(handler);
      return () => connectHandlers.delete(handler);
    },
    onPeerDisconnect() {
      return () => {};
    },
    async publishToTopic() {},
    async subscribeToTopic() {},
    getLocalPeerId() {
      return peerId;
    },
    getConnectedPeers() {
      return ["peer-b"];
    },
    getMultiaddrs() {
      return [`/ip4/127.0.0.1/tcp/1/p2p/${peerId}`];
    },
    async dial() {},
    getInstanceIdentity() {
      return identity;
    },
    getNATStatus() {
      return {
        enabled: {
          identify: false,
          autoNAT: false,
          upnp: false,
          circuitRelay: false,
          circuitRelayServer: false,
          dcutr: false,
        },
        reservedRelays: [],
        hasRelayedListenAddr: false,
      };
    },
  };
}

async function run() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openclaw-instance-router-"));
  const store = createInstancePeerStore({
    path: path.join(dir, "libp2p", "instance-peer.json"),
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  });

  const logs = [];
  const mesh = createFakeMesh(
    {
      id: "alice@abc.123",
      name: "alice",
      pubkey: "pub-a",
      binding: "binding",
      bindingComponents: { username: "alice", hostname: "host", platform: "linux" },
      createdAt: 1,
    },
    "peer-a",
  );

  const deliveries = [];
  const delivery = {
    async deliver(request) {
      deliveries.push(request);
      return { ok: true, channel: request.channel, target: request.target };
    },
  };

  const router = createInstanceRouter({
    mesh,
    store,
    delivery,
    config: {
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      deliveryAckTimeoutMs: 50,
    },
    logger: {
      info: (m) => logs.push(`info:${m}`),
      warn: (m) => logs.push(`warn:${m}`),
      debug: () => {},
      error: (m) => logs.push(`error:${m}`),
    },
  });

  await router.start();
  assert.equal(mesh.messages.length, 1);
  assert.equal(mesh.messages[0].message.type, "instance-announce");

  mesh.emitConnect("peer-b");
  assert.equal(mesh.messages.filter((m) => m.message.type === "instance-announce").length, 2);

  await router.handleMessage({
    id: "announce-b",
    type: "instance-announce",
    from: "peer-b",
    payload: JSON.stringify({
      instanceId: "bob@def.456",
      peerId: "peer-b",
      instanceName: "bob",
      multiaddrs: ["/ip4/127.0.0.1/tcp/2/p2p/peer-b"],
      pubkey: "pub-b",
      announcedAt: 100,
    }),
    timestamp: Date.now(),
  });

  const resolved = await router.resolveInstance("bob@def.456");
  assert.equal(resolved?.peerId, "peer-b");
  assert.equal(logs.some((m) => m.includes("Instance mapping updated")), true);

  const sendPromise = router.sendInstanceMessage("bob@def.456", "今晚出来吃饭");
  const outbound = mesh.messages.find((m) => m.message.type === "user-message");
  assert.equal(outbound.targetPeerId, "peer-b");
  const outboundPayload = JSON.parse(outbound.message.payload);
  assert.equal(outboundPayload.toInstanceId, "bob@def.456");
  assert.equal(outboundPayload.text, "今晚出来吃饭");

  await router.handleMessage({
    id: "ack-b",
    type: "delivery-ack",
    from: "peer-b",
    payload: JSON.stringify({
      ackFor: outboundPayload.messageId,
      ok: true,
      inboundChannel: "feishu",
      inboundTarget: "user:ou_xxx",
      deliveredAt: Date.now(),
    }),
    timestamp: Date.now(),
  });

  const result = await sendPromise;
  assert.equal(result.sent, true);
  assert.equal(result.delivered, true);
  assert.equal(result.toPeerId, "peer-b");

  await router.handleMessage({
    id: "user-message-b",
    type: "user-message",
    from: "peer-b",
    payload: JSON.stringify({
      messageId: "remote-message-1",
      fromInstanceId: "bob@def.456",
      toInstanceId: "alice@abc.123",
      text: "收到",
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: "bob@def.456",
        replyTool: "p2p_send_instance_message",
      },
    }),
    timestamp: Date.now(),
  });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].text, "收到");
  assert.equal(mesh.messages.some((m) => m.message.type === "delivery-ack"), true);

  const timeoutResult = await router.sendInstanceMessage("bob@def.456", "timeout");
  assert.equal(timeoutResult.sent, true);
  assert.equal(timeoutResult.delivered, false);
  assert.equal(timeoutResult.error.includes("ACK timeout after 50ms"), true);

  await router.stop();
  console.log("test-instance-router: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **步骤 2：运行 router 测试以确认失败**

```bash
node --import tsx test-instance-router.mjs
```

预期：失败，因为 `src/instance-router.ts` 还不存在。

- [ ] **步骤 3：实现 `src/instance-router.ts`**

创建：

```ts
import type {
  DeliveryAckPayload,
  InboundDeliveryAdapter,
  InstanceAnnouncePayload,
  InstancePeerStore,
  InstanceRouter,
  MeshConfig,
  MeshNetwork,
  P2PMessage,
  UserMessagePayload,
} from "./types.js";

type RouterLogger = {
  info?: (msg: string) => void;
  debug?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

type PendingAck = {
  resolve: (payload: DeliveryAckPayload) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DeliveryCacheEntry = {
  peerId: string;
  payload: DeliveryAckPayload;
};

function parsePayload<T>(msg: P2PMessage): T | undefined {
  try {
    return JSON.parse(msg.payload) as T;
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createInstanceRouter(options: {
  mesh: MeshNetwork;
  store: InstancePeerStore;
  delivery: InboundDeliveryAdapter;
  config?: MeshConfig;
  logger?: RouterLogger;
}): InstanceRouter {
  const { mesh, store, delivery } = options;
  const config = options.config ?? {};
  const logger = options.logger;
  const ackTimeoutMs = config.deliveryAckTimeoutMs ?? 15000;
  const announcedPeers = new Set<string>();
  const pendingAcks = new Map<string, PendingAck>();
  const deliveryCache = new Map<string, DeliveryCacheEntry>();
  const unsubs: Array<() => void> = [];

  function localInstanceId(): string {
    const identity = mesh.getInstanceIdentity();
    if (!identity) {
      throw new Error("Local instance identity is not initialized");
    }
    return identity.id;
  }

  function buildAnnouncePayload(): InstanceAnnouncePayload {
    const identity = mesh.getInstanceIdentity();
    if (!identity) {
      throw new Error("Local instance identity is not initialized");
    }
    return {
      instanceId: identity.id,
      peerId: mesh.getLocalPeerId(),
      instanceName: identity.name,
      multiaddrs: mesh.getMultiaddrs(),
      pubkey: identity.pubkey,
      announcedAt: Date.now(),
    };
  }

  async function announceToPeer(peerId: string): Promise<void> {
    if (!peerId || peerId === mesh.getLocalPeerId()) return;
    const payload = buildAnnouncePayload();
    await mesh.sendStructuredMessage(peerId, {
      id: crypto.randomUUID(),
      type: "instance-announce",
      to: peerId,
      payload: JSON.stringify(payload),
    });
    announcedPeers.add(peerId);
    logger?.info?.(`[libp2p-mesh] Sent instance announce to ${peerId} (${payload.instanceId})`);
  }

  async function announceToConnectedPeers(): Promise<void> {
    for (const peerId of mesh.getConnectedPeers()) {
      await announceToPeer(peerId).catch((err) => {
        logger?.warn?.(`[libp2p-mesh] Failed to announce to ${peerId}: ${summarizeError(err)}`);
      });
    }
  }

  async function handleAnnounce(msg: P2PMessage): Promise<void> {
    const payload = parsePayload<InstanceAnnouncePayload>(msg);
    if (
      !payload ||
      !isNonEmptyString(payload.instanceId) ||
      !isNonEmptyString(payload.peerId) ||
      !Array.isArray(payload.multiaddrs) ||
      typeof payload.announcedAt !== "number"
    ) {
      logger?.warn?.(`[libp2p-mesh] Ignoring malformed instance announce from ${msg.from}`);
      return;
    }
    if (payload.instanceId === mesh.getInstanceIdentity()?.id) {
      return;
    }

    const result = await store.upsertFromAnnounce(payload);
    if (result.changed) {
      logger?.info?.(
        `[libp2p-mesh] Instance mapping updated: ${payload.instanceId} -> ${payload.peerId}`,
      );
    } else {
      logger?.debug?.(`[libp2p-mesh] Instance mapping unchanged: ${payload.instanceId}`);
    }

    if (!announcedPeers.has(msg.from)) {
      await announceToPeer(msg.from).catch((err) => {
        logger?.warn?.(`[libp2p-mesh] Failed to respond to announce from ${msg.from}: ${summarizeError(err)}`);
      });
    }
  }

  async function sendAck(peerId: string, ack: DeliveryAckPayload): Promise<void> {
    await mesh.sendStructuredMessage(peerId, {
      id: crypto.randomUUID(),
      type: "delivery-ack",
      to: peerId,
      payload: JSON.stringify(ack),
    });
  }

  async function handleUserMessage(msg: P2PMessage): Promise<void> {
    const payload = parsePayload<UserMessagePayload>(msg);
    if (
      !payload ||
      !isNonEmptyString(payload.messageId) ||
      !isNonEmptyString(payload.fromInstanceId) ||
      !isNonEmptyString(payload.toInstanceId) ||
      !isNonEmptyString(payload.text)
    ) {
      logger?.warn?.(`[libp2p-mesh] Ignoring malformed user-message from ${msg.from}`);
      return;
    }
    if (payload.toInstanceId !== localInstanceId()) {
      logger?.warn?.(
        `[libp2p-mesh] Ignoring user-message for ${payload.toInstanceId}; local instance is ${localInstanceId()}`,
      );
      return;
    }

    const cached = deliveryCache.get(payload.messageId);
    if (cached) {
      await sendAck(cached.peerId, cached.payload);
      return;
    }

    let ack: DeliveryAckPayload;
    if (!config.inboundChannel || !config.inboundTarget) {
      ack = {
        ackFor: payload.messageId,
        ok: false,
        inboundChannel: config.inboundChannel,
        inboundTarget: config.inboundTarget,
        deliveredAt: Date.now(),
        error: "inbound delivery is not configured",
      };
    } else {
      const result = await delivery.deliver({
        channel: config.inboundChannel,
        target: config.inboundTarget,
        text: payload.text,
        metadata: {
          fromInstanceId: payload.fromInstanceId,
          fromPeerId: msg.from,
          p2pMessageId: payload.messageId,
          allowAgentAutoReply: payload.metadata?.allowAgentAutoReply === true,
          replyToInstanceId: payload.fromInstanceId,
          replyTool: "p2p_send_instance_message",
        },
      });
      ack = {
        ackFor: payload.messageId,
        ok: result.ok,
        inboundChannel: result.channel,
        inboundTarget: result.target,
        deliveredAt: Date.now(),
        error: result.error,
      };
    }

    deliveryCache.set(payload.messageId, { peerId: msg.from, payload: ack });
    await sendAck(msg.from, ack);
  }

  function handleAck(msg: P2PMessage): void {
    const payload = parsePayload<DeliveryAckPayload>(msg);
    if (!payload || !isNonEmptyString(payload.ackFor) || typeof payload.ok !== "boolean") {
      logger?.warn?.(`[libp2p-mesh] Ignoring malformed delivery-ack from ${msg.from}`);
      return;
    }
    const pending = pendingAcks.get(payload.ackFor);
    if (!pending) {
      logger?.debug?.(`[libp2p-mesh] Ignoring unmatched delivery ACK for ${payload.ackFor}`);
      return;
    }
    clearTimeout(pending.timer);
    pendingAcks.delete(payload.ackFor);
    pending.resolve(payload);
  }

  async function handleMessage(msg: P2PMessage): Promise<void> {
    if (msg.type === "instance-announce") {
      await handleAnnounce(msg);
      return;
    }
    if (msg.type === "user-message") {
      await handleUserMessage(msg);
      return;
    }
    if (msg.type === "delivery-ack") {
      handleAck(msg);
    }
  }

  async function start(): Promise<void> {
    unsubs.push(mesh.onMessage((msg) => {
      handleMessage(msg).catch((err) => {
        logger?.error?.(`[libp2p-mesh] Instance router message error: ${summarizeError(err)}`);
      });
    }));
    unsubs.push(mesh.onPeerConnect((peerId) => {
      announceToPeer(peerId).catch((err) => {
        logger?.warn?.(`[libp2p-mesh] Failed to announce to connected peer ${peerId}: ${summarizeError(err)}`);
      });
    }));
    await announceToConnectedPeers();
  }

  async function stop(): Promise<void> {
    for (const unsub of unsubs.splice(0)) {
      unsub();
    }
    for (const [messageId, pending] of pendingAcks) {
      clearTimeout(pending.timer);
      pending.resolve({
        ackFor: messageId,
        ok: false,
        deliveredAt: Date.now(),
        error: "instance router stopped",
      });
    }
    pendingAcks.clear();
  }

  async function listInstances() {
    return await store.list();
  }

  async function resolveInstance(instanceId: string) {
    return await store.resolve(instanceId);
  }

  async function sendInstanceMessage(instanceId: string, message: string) {
    const route = await store.resolve(instanceId);
    if (!route) {
      return {
        sent: false,
        delivered: false,
        toInstanceId: instanceId,
        toPeerId: "",
        error: `Instance ${instanceId} has not been discovered. Ask the user to confirm the remote gateway is running and connected to the same P2P network.`,
      };
    }

    const fromInstanceId = localInstanceId();
    const messageId = crypto.randomUUID();
    const payload: UserMessagePayload = {
      messageId,
      fromInstanceId,
      toInstanceId: instanceId,
      text: message,
      metadata: {
        allowAgentAutoReply: true,
        replyToInstanceId: fromInstanceId,
        replyTool: "p2p_send_instance_message",
      },
    };

    const ackPromise = new Promise<DeliveryAckPayload>((resolve) => {
      const timer = setTimeout(() => {
        pendingAcks.delete(messageId);
        resolve({
          ackFor: messageId,
          ok: false,
          deliveredAt: Date.now(),
          error: `ACK timeout after ${ackTimeoutMs}ms`,
        });
      }, ackTimeoutMs);
      pendingAcks.set(messageId, { resolve, timer });
    });

    try {
      await mesh.sendStructuredMessage(route.peerId, {
        id: messageId,
        type: "user-message",
        to: route.peerId,
        payload: JSON.stringify(payload),
      });
    } catch (err) {
      const pending = pendingAcks.get(messageId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingAcks.delete(messageId);
      }
      return {
        sent: false,
        delivered: false,
        toInstanceId: instanceId,
        toPeerId: route.peerId,
        error: summarizeError(err),
      };
    }

    const ack = await ackPromise;
    return {
      sent: true,
      delivered: ack.ok,
      toInstanceId: instanceId,
      toPeerId: route.peerId,
      ackMessageId: ack.ackFor,
      inboundChannel: ack.inboundChannel,
      error: ack.error,
    };
  }

  return {
    start,
    stop,
    handleMessage,
    announceToPeer,
    listInstances,
    resolveInstance,
    sendInstanceMessage,
  };
}
```

- [ ] **步骤 4：运行 router 测试**

```bash
node --import tsx test-instance-router.mjs
```

预期：`test-instance-router: all assertions passed`

- [ ] **步骤 5：运行 store 测试 and build**

```bash
node --import tsx test-instance-peer-store.mjs
pnpm build
```

预期：两者都通过。

- [ ] **步骤 6：提交 router**

```bash
git add src/instance-router.ts test-instance-router.mjs
git commit -m "feat: add instance router"
```

---

### 任务 6：增加 Instance 级 Agent 工具

**文件：**
- 修改：`src/agent-tools.ts`
- 修改：`src/plugin.ts`
- 修改：`api.ts`
- 通过命令测试：`pnpm build`

- [ ] **步骤 1：更新 `buildP2PTools` 签名并增加新工具**

修改 import 和函数签名：

```ts
import type { InstanceRouter, MeshNetwork } from "./types.js";

export function buildP2PTools(mesh: MeshNetwork, router?: InstanceRouter) {
```

在返回数组中、`p2p_get_network_info` 之后追加这些工具：

```ts
    {
      name: "p2p_list_instances",
      label: "P2P List Instances",
      description: "List OpenClaw instances discovered through the P2P mesh instance routing table.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute(_toolCallId: string) {
        if (!router) {
          return {
            content: [{ type: "text" as const, text: "Instance router is not initialized." }],
            details: { initialized: false },
            isError: true,
          };
        }
        try {
          const instances = await router.listInstances();
          const connected = new Set(mesh.getConnectedPeers());
          const rows = instances.map((entry) => ({
            ...entry,
            connected: connected.has(entry.peerId),
          }));
          const text = rows.length === 0
            ? "No OpenClaw instances discovered yet."
            : rows.map((entry) => `${entry.instanceId} -> ${entry.peerId}${entry.connected ? " (connected)" : ""}`).join("\n");
          return {
            content: [{ type: "text" as const, text }],
            details: { instances: rows, count: rows.length },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Failed to list instances: ${String(err)}` }],
            details: { error: String(err) },
            isError: true,
          };
        }
      },
    },
    {
      name: "p2p_resolve_instance",
      label: "P2P Resolve Instance",
      description: "Resolve an OpenClaw instance ID to the current libp2p Peer ID route.",
      parameters: {
        type: "object" as const,
        properties: {
          instanceId: {
            type: "string" as const,
            description: "Target OpenClaw instance ID",
          },
        },
        required: ["instanceId"],
      },
      async execute(_toolCallId: string, params: { instanceId: string }) {
        if (!router) {
          return {
            content: [{ type: "text" as const, text: "Instance router is not initialized." }],
            details: { initialized: false },
            isError: true,
          };
        }
        const instanceId = params.instanceId?.trim();
        if (!instanceId) {
          return {
            content: [{ type: "text" as const, text: "instanceId is required." }],
            details: { error: "instanceId is required" },
            isError: true,
          };
        }
        const route = await router.resolveInstance(instanceId);
        if (!route) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Instance ${instanceId} has not been discovered. Ask the user to confirm the remote gateway is running and connected to the same P2P network.`,
              },
            ],
            details: { instanceId, found: false },
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `${route.instanceId} -> ${route.peerId}` }],
          details: { found: true, route },
        };
      },
    },
    {
      name: "p2p_send_instance_message",
      label: "P2P Send Instance Message",
      description: "Send a user message to another OpenClaw instance by instance ID and wait for remote channel delivery ACK.",
      parameters: {
        type: "object" as const,
        properties: {
          instanceId: {
            type: "string" as const,
            description: "Target OpenClaw instance ID",
          },
          message: {
            type: "string" as const,
            description: "Message content to send",
          },
        },
        required: ["instanceId", "message"],
      },
      async execute(_toolCallId: string, params: { instanceId: string; message: string }) {
        if (!router) {
          return {
            content: [{ type: "text" as const, text: "Instance router is not initialized." }],
            details: { initialized: false },
            isError: true,
          };
        }
        const instanceId = params.instanceId?.trim();
        const message = params.message?.trim();
        if (!instanceId || !message) {
          return {
            content: [{ type: "text" as const, text: "instanceId and message are required." }],
            details: { error: "instanceId and message are required" },
            isError: true,
          };
        }
        const result = await router.sendInstanceMessage(instanceId, message);
        if (!result.delivered) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to deliver message to ${instanceId}: ${result.error ?? "unknown error"}`,
              },
            ],
            details: result,
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Message delivered to ${instanceId} via ${result.inboundChannel ?? "remote inbound channel"}.`,
            },
          ],
          details: result,
        };
      },
    },
```

- [ ] **步骤 2：在 `src/plugin.ts` 中接入 router 构造**

增加 imports：

```ts
import { createInstancePeerStore } from "./instance-peer-store.js";
import { createInstanceRouter } from "./instance-router.js";
import { createOpenClawCliInboundDelivery } from "./inbound-delivery.js";
```

在 `registerLibp2pMesh` 中，`mesh` 构造之后创建 store/delivery/router：

```ts
  const config = api.pluginConfig as MeshConfig | undefined;
  const store = createInstancePeerStore({ logger: api.logger });
  const delivery = createOpenClawCliInboundDelivery({ logger: api.logger });
  const router = createInstanceRouter({
    mesh,
    store,
    delivery,
    config,
    logger: api.logger,
  });
```

在现有 `createMeshNetwork` 调用中使用 `config`：

```ts
  const mesh = createMeshNetwork({
    config,
    logger: api.logger,
  });
```

在 service `start` 中，`await mesh.start();` 之后启动 router：

```ts
      await router.start();
```

移除直接的 `mesh.onMessage((msg) => handleP2PInbound(...))` handler，或只让它处理非 router 消息类型：

```ts
      mesh.onMessage((msg) => {
        if (msg.type === "direct" || msg.type === "broadcast" || msg.type === "agent-sync") {
          handleP2PInbound(msg, { logger: api.logger });
        }
      });
```

在 service `stop` 中，先停止 router，再停止 mesh：

```ts
      await router.stop();
      await mesh.stop();
```

用 router 注册 tools：

```ts
  const tools = buildP2PTools(mesh, router);
```

- [ ] **步骤 3：在 `api.ts` 中导出有用类型**

修改 export，加入面向 router/store 的类型：

```ts
export { createMeshNetwork } from "./src/mesh.js";
export { createInstancePeerStore } from "./src/instance-peer-store.js";
export { createInstanceRouter } from "./src/instance-router.js";
export type {
  DeliveryAckPayload,
  InboundDeliveryAdapter,
  InboundDeliveryRequest,
  InboundDeliveryResult,
  InstanceAnnouncePayload,
  InstanceIdentity,
  InstancePeerRecord,
  InstancePeerStore,
  InstancePeerTable,
  InstanceRouter,
  MeshConfig,
  MeshNetwork,
  P2PMessage,
  UserMessagePayload,
} from "./src/types.js";
```

- [ ] **步骤 4：运行测试和 build**

```bash
node --import tsx test-instance-peer-store.mjs
node --import tsx test-instance-router.mjs
node --import tsx test-mesh-core.mjs
pnpm build
```

预期：全部通过。

- [ ] **步骤 5：提交工具和插件接线**

```bash
git add src/agent-tools.ts src/plugin.ts api.ts
git commit -m "feat: expose instance routing tools"
```

---

### 任务 7：更新文档、测试指南和 NAT 配置

**文件：**
- 修改：`README.md`
- 修改：`TESTING.md`
- 修改：`test/nat-docker/config/client-a/openclaw.json`
- 修改：`test/nat-docker/config/client-b/openclaw.json`
- 通过命令测试：`pnpm build`

- [ ] **步骤 1：更新 README 配置参考**

把这些行加入配置表：

```md
| `inboundChannel` | `string` | `undefined` | OpenClaw channel used to display inbound P2P user messages, for example `"feishu"` |
| `inboundTarget` | `string` | `undefined` | OpenClaw channel target for inbound P2P messages, for example `user:ou_xxx` or `chat:oc_xxx` |
| `deliveryAckTimeoutMs` | `number` | `15000` | Timeout for waiting on remote channel delivery ACKs |
```

在基础用法之后增加一节：

````md
## Sending by OpenClaw Instance ID

When two gateways connect, `libp2p-mesh` exchanges instance route announcements and automatically writes:

```text
~/.openclaw/libp2p/instance-peer.json
```

When `OPENCLAW_STATE_DIR` is set, the file is written to:

```text
$OPENCLAW_STATE_DIR/libp2p/instance-peer.json
```

Users do not configure this file path. It is plugin-managed state.

For Feishu inbound display, configure the receiving instance:

```json
{
  "plugins": {
    "libp2p-mesh": {
      "enabled": true,
      "config": {
        "discovery": "mdns",
        "inboundChannel": "feishu",
        "inboundTarget": "user:ou_xxx",
        "deliveryAckTimeoutMs": 15000
      }
    }
  },
  "channels": {
    "libp2p-mesh": { "enabled": true }
  }
}
```

The OpenClaw agent should prefer:

```text
p2p_send_instance_message({ "instanceId": "<target-instance-id>", "message": "今晚出来吃饭" })
```

The sender reports success only after the remote OpenClaw instance forwards the message to its configured inbound channel and returns a delivery ACK.

Tools are not configured in `openclaw.json`; they are registered automatically by the plugin through `api.registerTool()`.
````

加入排障部分：

````md
### Connected peers are not visible in logs

Peer connection and disconnection are logged at `info` level:

```text
[libp2p-mesh] Peer connected: 12D3KooW...
[libp2p-mesh] Instance mapping updated: bob@def.456 -> 12D3KooW...
```

如果 these lines are missing, confirm the gateway is running with normal info logs enabled and that both instances are on the same mDNS/bootstrap/relay network.
````

- [ ] **步骤 2：更新 `TESTING.md` 工具列表和 instance routing 检查**

在工具注册的预期输出中加入：

```text
p2p_list_instances         — List OpenClaw instances discovered through the P2P mesh instance routing table
p2p_resolve_instance       — Resolve an OpenClaw instance ID to the current libp2p Peer ID route
p2p_send_instance_message  — Send a user message by instance ID and wait for remote channel delivery ACK
```

增加测试章节：

````md
## 测试 6: Instance ID 路由

启动两个 gateway 后，检查映射表：

```bash
cat ~/.openclaw/libp2p/instance-peer.json
```

预期包含远端实例：

```json
{
  "version": 1,
  "instances": {
    "remote-instance-id": {
      "peerId": "12D3KooW..."
    }
  }
}
```

通过 Agent 工具发送：

```text
p2p_send_instance_message({ "instanceId": "remote-instance-id", "message": "今晚出来吃饭" })
```

预期发送方工具返回 `delivered: true`，接收方配置的 `inboundChannel/inboundTarget` 收到消息。
````

- [ ] **步骤 3：给 NAT docker clients 增加入站配置**

在 `test/nat-docker/config/client-a/openclaw.json` 的 `plugins.libp2p-mesh.config` 下增加：

```json
          "inboundChannel": "feishu",
          "inboundTarget": "user:client-a",
          "deliveryAckTimeoutMs": 15000
```

在 `test/nat-docker/config/client-b/openclaw.json` 的 `plugins.libp2p-mesh.config` 下增加：

```json
          "inboundChannel": "feishu",
          "inboundTarget": "user:client-b",
          "deliveryAckTimeoutMs": 15000
```

保持 JSON 逗号有效。

- [ ] **步骤 4：运行 build**

```bash
pnpm build
```

预期： no errors.

- [ ] **步骤 5：提交文档和 NAT 配置更新**

```bash
git add README.md TESTING.md test/nat-docker/config/client-a/openclaw.json test/nat-docker/config/client-b/openclaw.json
git commit -m "docs: document instance routing workflow"
```

---

### 任务 8：最终验证

**文件：**
- 预计不新增源文件
- 使用下列命令测试

- [ ] **步骤 1：运行独立测试**

```bash
node --import tsx test-instance-peer-store.mjs
node --import tsx test-instance-router.mjs
node --import tsx test-mesh-core.mjs
```

预期：

```text
test-instance-peer-store: all assertions passed
test-instance-router: all assertions passed
All tests passed!
```

- [ ] **步骤 2：运行 TypeScript build**

```bash
pnpm build
```

预期：没有 TypeScript 错误，并重新生成 `dist/`。

- [ ] **步骤 3：检查插件元数据**

```bash
node -e "const p=require('./openclaw.plugin.json'); console.log(p.contracts.tools.join('\\n'))"
```

预期输出包含：

```text
p2p_send_message
p2p_broadcast
p2p_list_peers
p2p_get_instance_identity
p2p_get_network_info
p2p_list_instances
p2p_resolve_instance
p2p_send_instance_message
```

- [ ] **步骤 4：检查 git 状态**

```bash
git status --short
```

预期：只剩下预先存在且无关的本地文件。如果 `dist/` 已生成且被 Git 跟踪，则把生成文件纳入实现提交；如果 `dist/` 被忽略，则按照仓库当前模式保持未跟踪或不存在。

- [ ] **步骤 5：通过归属任务解决最终验证失败**

如果步骤 1-4 暴露失败，回到引入失败文件的任务，在该任务中修复，重跑该任务的测试，并更新该任务的提交。不要创建含糊的最终兜底提交。如果步骤 1-4 通过，则不需要最终验证提交。

---

## 自检

Spec 覆盖：

- Instance 路由交换由任务 2 和任务 5 覆盖。
- `instance-peer.json` 持久化由任务 3 覆盖。
- Instance 级工具由任务 6 覆盖。
- OpenClaw config 和 manifest 更新由任务 1 和任务 7 覆盖。
- 飞书风格入站投递由任务 4 和任务 5 覆盖。
- channel 转发后 ACK 由任务 5 覆盖。
- 不做周期 announce 由任务 5 测试和 README 文案覆盖。
- info 级 peer/mapping 日志由任务 2、5、7 覆盖。
- 现有 peer 级工具保留，不会删除。

占位符扫描：

- 计划避免了开放式占位说明。
- 每个改代码的任务都列出了具体文件、命令和预期结果。

类型一致性：

- `InstanceRouter`、`InstancePeerStore`、`InboundDeliveryAdapter`、payload type 名称、config keys 和工具名在各任务之间一致。
- 主工具名始终是 `p2p_send_instance_message`。
- 状态文件始终是 `instance-peer.json`，不会作为用户配置项暴露。
