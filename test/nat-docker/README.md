# nat-docker —— openclaw + libp2p-mesh 端到端 NAT 穿透集成测试

这是一套用 docker-compose 在**单台机器**上模拟"两个客户端在不同 NAT 后，经云中继互通"的端到端测试 harness。**不需要任何公网 IP、不需要租云服务器**。

> 与 `test-nat-relay.mjs` 的关键区别：
> - `test-nat-relay.mjs` 只测 `createMeshNetwork()` 这一层 libp2p 协议，跳过整个 OpenClaw。
> - 本目录里的测试**跑完整的 `openclaw gateway run`**（plugin loader / channel / agent-tools / CLI / hooks 全部经过），通过 `openclaw message send` CLI 来发消息。
> - 三个容器在三个互相隔离的 docker bridge 网络里，模拟"两台 NAT 后客户端只能通过中继互通"的真实拓扑。

## 拓扑

```
┌───────────────────────────────────────────────────────────────────────┐
│ docker bridge:  relay-net  (172.30.0.0/24)                            │
│                                                                       │
│     ┌────────────────────────────────────────┐                        │
│     │ container: nat-test-relay               │                        │
│     │   openclaw + libp2p-mesh                │                        │
│     │   enableCircuitRelayServer = true       │                        │
│     │   listens on 0.0.0.0:4001               │                        │
│     │   hostname "relay" 在 3 个 bridge 都有 alias │                    │
│     └──────┬─────────────────┬───────────────┘                        │
└────────────┼─────────────────┼────────────────────────────────────────┘
             │                 │
┌────────────┴────────┐  ┌─────┴─────────────────┐
│ bridge: nat-a       │  │ bridge: nat-b         │
│ (172.31.0.0/24)     │  │ (172.32.0.0/24)       │
│                     │  │                       │
│ container:          │  │ container:            │
│ nat-test-client-a   │  │ nat-test-client-b     │
│   relayList = relay │  │   relayList = relay   │
└─────────────────────┘  └───────────────────────┘
```

**为什么这个拓扑能模拟真实 NAT**：

1. docker 的 user-defined bridge 默认互相隔离（`docker network` 默认开 `--internal=false` 但跨 bridge 流量被 iptables 的 `DOCKER-ISOLATION-STAGE-2` 链丢弃）。所以 `client-a` 看不见 `client-b` 的 IP，也拨不到。
2. 唯一的"公共入口"是 `relay` 容器——它通过 multi-homed 同时挂在 `nat-a`、`nat-b`、`relay-net` 三个 bridge 上，相当于"运营商在出口架了一台公网中继"。
3. 客户端的 `bootstrapList` / `relayList` 用 `/dns4/relay/tcp/4001/...`，让 docker DNS 在各自的 bridge 里把 `relay` 解析到不同的 IP（自己 bridge 上的那个）。

## 局限（必须诚实地承认）

| 维度 | docker 模拟是否反映真实情况？ |
|------|------------------------------|
| Circuit Relay v2 协议握手、Reservation、transient stream | ✅ 完全一致——同一份 libp2p 代码 |
| openclaw plugin loader / CLI / channel 集成 | ✅ 完全一致（容器里跑的是完整 openclaw） |
| 跨 NAT 不可直拨 → 必须走中继 | ✅ 一致 |
| Symmetric NAT 行为（许多 CGNAT / 4G 网络是这种） | ❌ docker iptables MASQUERADE 是 endpoint-independent，类似 full-cone NAT；DCUtR 在这里会无脑成功，但真实 Symmetric NAT 下 DCUtR 会失败 |
| WAN 延迟、丢包、MTU 抖动 | ❌ 容器间几乎 0 延迟、0 丢包 |
| DPI / TCP RST 注入、端口封禁 | ❌ docker 不模拟主动拦截 |
| 双层 NAT（CGNAT + 家用路由器） | ❌ docker 单层 NAT |
| 真实 IPv6 双栈降级 | ❌ docker 默认禁 v6 |

**结论**：这套测试能证明"插件的 Circuit Relay v2 协议路径正确，且能被 openclaw 正确加载和使用"，但**不能**证明"在你具体的 NAT 环境下能打通"。后者必须用真实异地机器 + 真实公网中继验证（见 [`../../README.md` 的 NAT 章节](../../README.md) 与 `openclaw_add/openclaw-nat-3node-guide.md`）。

## 先决条件

- Docker ≥ 20.10（含 buildkit）
- docker compose —— **v2 plugin (`docker compose`) 或 classic v1 (`docker-compose ≥ 1.27`) 任一都可**；`run.sh` 会自动探测可用的版本
- 至少 4 GB 空闲内存（首次 build 时 pnpm install 较占内存）
- 首次 build 大约 5–10 分钟（源码 + node_modules + pnpm build），之后镜像缓存，二次启动几秒钟
- 端口 4001 在宿主上**没有**被占用（不必映射，但 docker-compose 用到 4001 这个内部端口号）

## 快速开始

```bash
cd openclaw-libp2p-mesh/test/nat-docker

./run.sh build    # 第一次需要 5–10 分钟
./run.sh up       # 起 relay → 抓 PeerID → 起 client-a / client-b → 等 reservation
./run.sh verify   # 双向发消息并验证收到，全过则 exit 0

# 看具体日志
./run.sh logs relay
./run.sh logs client-a
./run.sh logs client-b

# 看 NAT 状态摘要
./run.sh status

./run.sh down     # 停容器，保留卷（下次启动 PeerID 还在）
./run.sh clean    # 彻底清掉容器、卷、.state 临时配置
```

## 期望的 verify 输出

```
[run.sh] client-a → client-b ...
[run.sh] client-b → client-a ...
[run.sh] ✓ client-b received: nat-docker-ab-1747000000
[run.sh] ✓ client-a received: nat-docker-ba-1747000000
[run.sh] End-to-end NAT-traversal verification PASSED.
```

## 期望的 status 输出（节选）

```
=== nat-test-relay ===
[libp2p-mesh] Node started. Peer ID: 12D3KooW...
[libp2p-mesh] Listening on: /ip4/0.0.0.0/tcp/4001/p2p/12D3KooW..., /dns4/relay/tcp/4001/p2p/12D3KooW...
[libp2p-mesh] NAT traversal services: identify, circuitRelay, circuitRelayServer, dcutr

=== nat-test-client-a ===
[libp2p-mesh] Connected to relay /dns4/relay/tcp/4001/p2p/12D3KooW<RELAY> — reservation in progress
[libp2p-mesh] Active relay reservations: /dns4/relay/tcp/4001/p2p/12D3KooW<RELAY>/p2p-circuit/p2p/12D3KooW<A>

=== nat-test-client-b ===
[libp2p-mesh] Active relay reservations: /dns4/relay/tcp/4001/p2p/12D3KooW<RELAY>/p2p-circuit/p2p/12D3KooW<B>
```

## 验证"不是 docker 偷直连"——硬性证据

如果你不放心，想自己确认 `client-a` 和 `client-b` 真的拨不通对方、必须经 relay：

```bash
# A 容器 ping B 容器（应该失败）
docker exec nat-test-client-a ping -c 2 -W 1 nat-test-client-b
# 期望：bad address 'nat-test-client-b' 或 Network unreachable

# A 容器 dns 解析 client-b（应该解析失败）
docker exec nat-test-client-a getent hosts client-b
# 期望：空输出

# 反之：A 容器 ping relay（应该成功）
docker exec nat-test-client-a ping -c 2 relay
# 期望：64 bytes from 172.31.0.x

docker exec nat-test-client-b ping -c 2 relay
# 期望：64 bytes from 172.32.0.x  ← 注意是不同的 IP！
```

如果上面 4 条都符合预期，那"client-a 和 client-b 之间被网络隔离、只能经 relay 互通"这一前提就立住了。

## 常见问题

### 1. `up` 卡在 `Waiting for 'Peer ID: ...' in nat-test-relay`

可能是镜像还没 build 完。打开另一个终端跑 `docker logs -f nat-test-relay`，能看到具体进展。

### 2. `client-a` 起来了但一直没 `Active relay reservations`

检查 `./run.sh logs client-a` 里有没有 `Could not resolve 'relay'`。如果有，说明 docker DNS 没把 `relay` 解析到对的 IP——可能是 docker-compose 网络 alias 没生效。重启：`./run.sh down && ./run.sh up`。

### 3. `verify` 报 "did NOT receive"

按顺序排查：
1. `./run.sh status` —— 三方 reservation 都成立吗？
2. `./run.sh logs client-b | tail -50` —— 看到过 `[libp2p-mesh] Peer connected: 12D3KooW<A>` 吗？
3. `./run.sh logs relay | grep -c "relay:reservation"` —— 应该至少有 2 条（每个客户端一条）。

### 4. 想换更长的等待时间

`run.sh` 里把 `wait_for_log` 第三个参数从 `90` 改大。

### 5. 镜像太大想删

```bash
./run.sh clean
docker image rm openclaw-nat-test:latest
```

## 想看更多

- 协议层冒烟测试（无 docker，3 秒跑完）：`../../test-nat-relay.mjs`
- 完整三节点真机部署指南（含腾讯云步骤）：`openclaw_add/openclaw-nat-3node-guide.md`
- 插件 NAT 测试总览：`openclaw_add/TESTING_NAT.md`
