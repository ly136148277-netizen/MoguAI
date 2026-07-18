# OpenClaw Bridge 契约（MOGU）

> 状态：**设计冻结草案**（v1.6 开工前唯一事实来源）  
> 日期：2026-07-19  
> 产品主线：[`ROADMAP_TO_V2.md`](./ROADMAP_TO_V2.md)  
> 上游协议：[Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)  
> Skills 语义：[Skills](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md)

---

## 1. 定位

MOGU 不复制 OpenClaw。Bridge 是 **Electron 主进程** 对本地 OpenClaw Gateway 的受控客户端：

| 层 | 职责 |
|----|------|
| OpenClaw Gateway | 会话、Agent Run、事件流、任务账本、精确取消、渠道、Skills 加载 |
| MOGU Bridge | 连接、认证、版本钉扎、ID 映射、流式 UI、超时/重连、降级到 PAI |
| MOGU 权限代理 | 高风险 `mogu.*` 工具的确认与拒绝；令牌永不进渲染层 |
| PAI（过渡） | Bridge 不可用时的本机执行与创作桥；逐步 Skill 化 |

**原则：** 任务中心围绕 Gateway 的 `session` / `run` / `task` 建模，而不是自造平行 ID 宇宙。

---

## 2. 传输与角色

对齐官方 Gateway WS 协议：

- 传输：WebSocket，文本帧，JSON
- 帧类型：`req` / `res` / `event`
- 首帧必须是 `connect`；握手后拿到 `hello-ok`（含 `protocol`、`server.version`、`features.methods` / `features.events`、`auth`、`policy`）
- MOGU 连接角色：`operator`（桌面控制面）
- 建议 scopes（MVP）：`operator.read` + `operator.write`；管理类能力另开，不默认给全量 `admin`

认证令牌、设备密钥、Gateway 密码：

- **仅主进程** 读写（`safeStorage` / Credential Manager）
- 渲染层只见「已连接 / 未连接 / 版本 / 脱敏地址」
- 禁止经 `settings:get`、preload 直出、日志明文落盘

---

## 3. Bridge 最小能力面（不得只做 status/send）

实现可分阶段，但**契约必须一次定义全**，避免 UI 与任务中心返工。

### 3.1 版本 / 能力探测

| Bridge API（MOGU 侧） | 行为 | 映射（Gateway） |
|----------------------|------|-----------------|
| `probe()` | 探测本机安装、进程、端口、协议版本 | TCP/WS 探测 + `connect` → `hello-ok` |
| `capabilities()` | 返回协议版本、方法/事件集合、服务器版本 | `hello-ok.protocol` / `features` / `server` |
| `health()` | 状态灯：未安装 / 未运行 / 可连 / 版本不兼容 | 本地进程检查 + `probe` |

**版本钉扎：** Bridge 声明兼容的 OpenClaw / protocol 区间；超出区间 → 明确错误 + 升级引导，禁止静默硬连。

### 3.2 认证与连接生命周期

| Bridge API | 行为 |
|------------|------|
| `connect({ url, auth })` | 完成 challenge → `connect` → `hello-ok`；持久化 `connId` |
| `disconnect()` | 优雅关闭；清本地订阅 |
| `reconnect()` | 断线后指数退避重连；恢复订阅与 inflight 映射 |
| `getConnectionState()` | `disconnected` / `connecting` / `ready` / `degraded` / `auth_failed` |

设置页可配置：地址、端口、启用开关、兼容版本显示。令牌输入只写主进程保险库。

### 3.3 创建会话与发起 Agent Run

| Bridge API | 行为 | 映射（Gateway，以实际上游为准） |
|------------|------|--------------------------------|
| `sessionCreate(opts)` | 创建会话，返回 MOGU `taskId` + Gateway `sessionKey`/`sessionId` | `sessions.create` |
| `sessionSend(sessionRef, message, opts)` | 向已有会话发消息并启动一轮 | `sessions.send` / `chat.send` |
| `runWait(runRef, timeoutMs)` | 可选：等待终态快照 | `agent.wait` |
| `runQuery(runRef)` / `taskGet(taskRef)` | 查询状态 | `tasks.get` / `audit.*` / session row |

MVP 对话工作台至少要能：建会话 → 发一条消息 → 拿到 `runId` → 订阅事件直到终态。

### 3.4 流式事件订阅

| Bridge API | 行为 | 映射 |
|------------|------|------|
| `subscribeSession(sessionRef)` | 订阅会话变更与消息/Agent 流 | `sessions.subscribe` / `sessions.messages.subscribe` + agent/tool 事件 |
| `unsubscribeSession(sessionRef)` | 取消订阅 | 对应 unsubscribe |
| 事件回调 | 规范化后推给渲染层（无密钥、无原始 token） | Gateway `event` 帧 |

MOGU 事件信封（渲染层可见）：

```text
{
  moguTaskId, sessionKey, sessionId?, runId?, taskId?,
  kind,           // agent_delta | tool_start | tool_end | status | error | terminal
  status?,        // queued | running | succeeded | failed | cancelled | timed_out
  text?, toolName?, progress?, ts
}
```

### 3.5 ID 映射与持久化

任务中心**必须**持久化三方映射（本地 SQLite/JSON 库均可，需 `schemaVersion`）：

| ID | 所有者 | 用途 |
|----|--------|------|
| `moguTaskId` | MOGU | UI / 取消按钮 / 本地日志主键 |
| `sessionKey` / `sessionId` | Gateway | 会话定位、消息订阅 |
| `runId` | Gateway | 单轮 Agent Run、精确 abort |
| `taskId` | Gateway task ledger | `tasks.get` / `tasks.cancel`、跨客户端一致视图 |
| `source` | MOGU | `openclaw` \| `pai` \| `studio` \| `comfy` |
| `createdAt` / `updatedAt` / `terminalAt` | MOGU | 列表排序与清理 |

规则：

1. 任一 Gateway ID 未知时，不得假装「已精确取消」。
2. Studio / Comfy 任务继续保留本端 `prompt_id`；与 OpenClaw ID 分栏共存，不混名。
3. 断线重连后优先用 Gateway 查询恢复状态，再修补本地映射。

### 3.6 精确取消

| Bridge API | 行为 | 映射 |
|------------|------|------|
| `cancel({ moguTaskId, reason? })` | 按映射选择最精确的取消路径 | 优先 `tasks.cancel`；否则 `sessions.abort` / `chat.abort`（带 `runId`） |
| 无精确 ID | **拒绝静默全局杀**；返回需确认或失败 | — |

取消结果必须回写：`found` / `cancelled` / 终态 / 错误原因（对齐 Gateway `tasks.cancel` 语义）。

### 3.7 超时、断线重连、降级到 PAI

| 场景 | 行为 |
|------|------|
| 连接超时 / 握手失败 | `degraded`；UI 提示；**不**把半连接当就绪 |
| 运行中断线 | 自动重连 → 用 `runId`/`taskId` 查询；恢复事件订阅 |
| 协议/版本不兼容 | 阻断 OpenClaw 模式；提供升级引导 |
| Gateway 不可用且用户允许 | **降级到 PAI**：对话/本机工具走现有 PAI 路径；任务 `source=pai` |
| 降级策略开关 | 设置项：`bridge.fallbackToPai`（默认 true，过渡期） |

降级不是绕过权限：PAI 路径仍走 MOGU 既有确认（并在 v1.5.4+ 精确取消）。

---

## 4. 权限与授权归属

### 4.1 问题

外部渠道（Telegram 等）也可触发 Agent；危险操作若只在「MOGU 聊天页点确认」上拦截，会被旁路。

### 4.2 规则（产品硬约束）

1. 所有高风险 `mogu.*` **工具实现** 必须调用 **MOGU 权限代理**（主进程），不得仅依赖 `SKILL.md` 文案约束。
2. 权限代理统一出口：`requestPermission({ tool, action, argsDigest, sessionKey, runId, channel? })`。
3. **桌面端不在线 / Bridge 权限通道不可达**：默认 **拒绝** 或 **超时拒绝**（可配置超时，默认拒绝）。**禁止**「无人确认则自动执行」。
4. 渠道来源与桌面来源同一策略表；渠道消息不提升权限。
5. Gateway 认证材料只存主进程；渲染层与 Skill 说明文件均不得持有 token。

### 4.3 风险级别（与路线图 L1/L2/L3 对齐）

| 级别 | 例 | 策略 |
|------|----|------|
| L1 只读 | 列模型、查任务状态 | 可自动；可记审计 |
| L2 可逆写入 | 导出备份到默认目录 | 首次或每次确认（设置） |
| L3 高风险 | 执行命令、删文件、全局 Comfy interrupt、改系统 | **每次** MOGU 确认；离线拒绝 |

### 4.4 与 OpenClaw approvals 的关系

若 Gateway 自带 approval / execApprovals：

- MOGU 可订阅并在桌面展示（`sessions.messages.subscribe` + approvals 相关能力，以兼容版本为准）
- **不替代** MOGU 对 `mogu.*` 的本机权限代理；双闸时以「MOGU 未批准则工具层拒绝」为准

---

## 5. Skill ≠ 受控执行能力

官方定义：Skills 是教 Agent **何时、如何使用工具** 的 Markdown 说明（`SKILL.md`），不是工具本身。

因此每个 `mogu.*` 交付物必须拆成四件套：

```text
1. Skill 说明（SKILL.md）
   - 触发场景、参数约定、禁止事项、对用户可见的能力边界

2. 实际工具实现
   - Bridge Plugin / MCP / 主进程本地服务（真正执行的代码）

3. 权限声明与确认策略
   - 风险级别、是否需桌面在线、超时拒绝、审计字段

4. 任务 / 日志 / 输出契约
   - 写入任务中心的 ID、进度事件、输出路径、失败码
```

**反模式（v1.7 禁止）：** 只提交一堆 `SKILL.md`，没有实现、没有权限代理、没有任务 ID —— 即「会描述、但不可控」。

Skills 包装清单（与路线图一致，验收按四件套）：

| 名称 | Skill 说明 | 工具实现 | 权限 | 任务契约 |
|------|------------|----------|------|----------|
| `mogu.pc` | ✓ | 本机/PAI 桥 | L2–L3 | `moguTaskId` + 日志 |
| `mogu.comfy` | ✓ | Comfy 桥 | L2–L3 | `prompt_id` / 取消 |
| `mogu.studio` | ✓ | Studio IPC | L2 | 与创作台同步 |
| `mogu.ollama` | ✓ | Ollama 模块 | L1–L2 | 模型操作可追踪 |
| `mogu.media` | ✓ | FFmpeg 等 | L2 | 输出路径白名单 |

---

## 6. 主进程模块边界（实现指引）

```text
main/
  openclaw/
    bridge.js          # WS 客户端、握手、重连
    protocol.js        # 帧编解码、方法白名单
    id-map.js          # moguTaskId ↔ session/run/task
    permissions.js     # 权限代理（确认窗口 / 超时拒绝）
    fallback-pai.js    # 降级入口
preload/
  openclaw-api.js      # 仅安全子集 IPC
renderer/
  只消费规范化事件与任务列表，不持有 token
```

IPC 命名建议：`openclaw:probe` / `openclaw:connect` / `openclaw:send` / `openclaw:cancel` / `openclaw:tasks` …  
全部经主进程；渲染层无裸 WS。

---

## 7. 与 PAI / Studio 的共存

| 模式 | 对话内核 | 创作 |
|------|----------|------|
| OpenClaw（主推，v1.6+） | Bridge → Gateway | `mogu.comfy` / `mogu.studio` Skills 或现有 UI 直连（仍进任务中心） |
| PAI（兼容） | 现有 Agent 路径 | 不变 |
| 降级 | Gateway 挂了自动/手动切 PAI | 不受影响 |

任务中心列表字段至少：`source`、状态、`moguTaskId`、Gateway IDs（若有）、重试、取消、日志、输出路径。

---

## 8. 安全清单（Bridge 专项）

- [ ] Token 仅主进程保险库
- [ ] `settings:get` 不返回 Gateway 密钥
- [ ] 日志禁止打印 auth、nonce、完整 challenge
- [ ] 高风险工具离线默认拒绝
- [ ] 取消必须带精确 ID；禁止默认全局清队列
- [ ] 媒体/文件类工具输出路径走白名单（与 v1.5.4 一致）
- [ ] Bridge 方法白名单：未声明 method 不得从渲染层透传

---

## 9. 测试要求（v1.6 退出前）

- [ ] Mock Gateway：握手、`hello-ok.features`、发消息、事件流、`tasks.cancel`
- [ ] 断线重连后 ID 映射仍可取消
- [ ] 超时降级到 PAI（开关 on/off）
- [ ] 权限代理：桌面离线时 L3 工具返回拒绝
- [ ] 渲染层内存/IPC 快照无 token

---

## 10. 文档与版本

| 项 | 说明 |
|----|------|
| 兼容 OpenClaw | 在实现 PR 中钉扎具体版本号区间（安装引导同版本） |
| 协议 | 以官方 `docs/gateway/protocol.md` 为准；本文件方法名为 MOGU 侧逻辑名 |
| 变更 | 破坏性变更只升 Bridge 契约小版本，并改 `ROADMAP_TO_V2.md` 引用 |

---

## 11. 开工顺序（确认）

1. **本文档** 作为 Bridge / Skills / 权限的契约基线（已完成草案）
2. **v1.5.4** 安全热修（精确取消、密钥、媒体白名单、单实例、文档卫生）
3. **v1.6** 按本文 §3–§4 实现 Bridge MVP + 任务中心
4. **v1.7** 按 §5 四件套交付 Skills，禁止「仅 SKILL.md」
|
