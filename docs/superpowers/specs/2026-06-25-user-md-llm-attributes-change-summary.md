# USER.md 属性提取版本修改总结

日期：2026-06-25

## 背景

之前版本中，libp2p-mesh 会在 gateway 启动或 peer 连接后，通过 OpenClaw subagent 从 `USER.md` 中提取公开 tag，再把结果作为 `userPublicAttributes` 广播给其他节点。

实际运行中发现两个问题：

1. gateway 启动早期调用 subagent 时，可能出现 `agent.wait unavailable during gateway startup`。
2. subagent 会创建 agent session/transcript，可能触发 `EmbeddedAttemptSessionTakeoverError`：

```text
session file changed while embedded prompt lock was released
```

该错误不是网络问题，而是 OpenClaw embedded agent session 文件竞争。

## 核心改动

### 1. USER.md 属性提取改用 `api.runtime.llm.complete`

旧方案：

```ts
api.runtime.subagent.run(...)
api.runtime.subagent.waitForRun(...)
api.runtime.subagent.getSessionMessages(...)
api.runtime.subagent.deleteSession(...)
```

新方案：

```ts
api.runtime.llm.complete({
  messages: [
    { role: "system", content: USER_MD_ATTRIBUTE_EXTRACTION_PROMPT },
    { role: "user", content: buildUserMdExtractionMessage(markdown, sourcePath) },
  ],
  purpose: "libp2p-mesh.user-md-attributes",
  maxTokens: 512,
  temperature: 0.1,
  timeoutMs,
})
```

这样 USER.md 提取不再创建 `agent:main:libp2p-mesh:user-md-attributes...` 子 session，也不再读写或删除 subagent transcript，从根源上避开 `EmbeddedAttemptSessionTakeoverError`。

### 2. 启动期基础 announce 和属性 announce 分离

peer 连接后仍然立即发送基础 announce：

```text
instanceId / peerId / instanceName / multiaddrs / pubkey / announcedAt
```

基础 announce 不携带 `userPublicAttributes`，日志中表现为：

```text
Sent instance announce ... attrs=0
```

gateway ready 后再延迟刷新并广播属性，默认延迟 10 秒。刷新成功后再次发送带属性的 announce：

```text
Sent instance announce ... attrs=3
Sent instance announce ... attrs=4
```

### 3. 属性刷新增加启动门控

`instance-router` 增加了属性刷新门控：

- 启动期间只记录 pending peers，不立即调用 USER.md 提取。
- `plugin.ts` 在 service start 完成后，通过定时器启用属性刷新。
- 启用后 drain pending peers，并发送带属性的 announce。

新增配置项：

```ts
publicAttributeRefreshStartupDelayMs?: number
```

默认值：

```ts
10000
```

### 4. 完善 completion 返回解析

新增 `extractCompletionText`，兼容常见 completion 返回形态：

- 直接字符串
- `{ content: "..." }`
- `{ content: [{ text: "..." }] }`
- `{ text: "..." }`
- `{ outputText: "..." }`
- OpenAI 风格 `{ choices: [{ message: { content: "..." } }] }`

解析得到文本后，继续用原来的 JSON 校验逻辑过滤无效属性。

### 5. 系统提示词补充异步属性说明

`prompt-config.ts` 中补充说明：

- `USER.md` 属性由 gateway 后台异步提取。
- 基础 `instance-announce` 可能省略 `userPublicAttributes`。
- 刚连接时 `attrs=0` 不代表用户没有公开属性。
- 按属性发送前应先用 `p2p_list_instances` 查看当前实例记录。

## 运行流程

现在完整流程如下：

1. gateway 启动。
2. libp2p 节点启动并发现 peer。
3. 立即发送基础 announce，`attrs=0`。
4. gateway ready。
5. agent runtime / provider auth 预热完成。
6. 到达属性刷新延迟时间。
7. 使用 `api.runtime.llm.complete` 读取并提取 `USER.md` tag。
8. 合并 `USER.md` tag 和 `user-profile.json` 中的公开结构化属性。
9. 发送第二次 instance announce，携带 `userPublicAttributes`。
10. 对端收到后更新 `instance-peer.json`。

## 日志验证结果

ypp 日志显示：

```text
12:38:23 [gateway] ready
12:38:33 [gateway] agent runtime plugins pre-warmed in 8ms
12:38:33 [plugins] [libp2p-mesh] Sent instance announce ... attrs=3
```

fhl 日志显示：

```text
12:38:33 [gateway] agent runtime plugins pre-warmed in 7ms
12:38:33 [plugins] [libp2p-mesh] Sent instance announce ... attrs=4
```

双方都成功收到对方属性：

```text
Received instance announce ... ypp ... attrs=3 changed=true
Received instance announce ... fhl ... attrs=4 changed=true
```

后续 XM 节点也正常收到属性：

```text
Received instance announce ... XXMM-XM ... attrs=5 changed=true
```

## 旧日志说明

启动时仍可能看到类似：

```text
Subagent orphan run pruned source=restore ...
```

这是之前旧版本 subagent 路径遗留的 orphan run，被 OpenClaw 启动恢复流程清理。它不是新版本 `llm.complete` 路径产生的，也不影响当前 USER.md 属性提取。

## 修改文件

主要修改：

- `src/user-md-openclaw-extractor.ts`
  - 从 subagent 切换到 `api.runtime.llm.complete`。
  - 新增 completion 返回文本解析。

- `src/instance-router.ts`
  - 增加公开属性刷新门控。
  - 启动期只排队，不立即跑 USER.md 提取。

- `src/plugin.ts`
  - 创建 router 时默认关闭启动期属性刷新。
  - service start 成功后延迟启用属性刷新。

- `src/types.ts`
  - 增加 `enablePublicAttributeRefresh()`。
  - 增加 `publicAttributeRefreshInitiallyEnabled`。
  - 增加 `publicAttributeRefreshStartupDelayMs`。

- `src/prompt-config.ts`
  - 补充 USER.md 属性异步刷新说明。

- `test/user-md-openclaw-extractor.test.ts`
  - 覆盖 `llm.complete` 调用和 completion 返回解析。

- `test/instance-router.test.ts`
  - 覆盖属性刷新门控行为。

- `test/plugin-lifecycle.test.ts`
  - 覆盖 service start 后延迟启用属性刷新。

## 验证命令

已通过：

```bash
npm run build
npm test -- test/user-md-openclaw-extractor.test.ts test/user-md-agent-attributes.test.ts test/instance-router.test.ts test/plugin-lifecycle.test.ts test/prompt-config.test.ts
```

测试结果：

```text
168 pass / 0 fail
```

## 当前结论

当前版本已经可以正常调用 OpenClaw 配置的模型提取 USER.md 属性，并通过 libp2p-mesh 广播给其他节点。

新的实现不再依赖 subagent session，因此不会再因为 USER.md 属性提取本身产生 `EmbeddedAttemptSessionTakeoverError`。
