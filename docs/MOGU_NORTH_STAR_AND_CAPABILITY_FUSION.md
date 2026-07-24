# MOGU AI 北极星与能力融合总纲 v1.0

```yaml
status: FROZEN · unanimously agreed 2026-07-23
scope: product north star + post-Public-RC roadmap + open-source intake policy
current_milestone: MOGU 2.0 Public RC
execution: PAUSED until explicit "开始"
```

## 当前任务目标（2026-07-23 更新）

```text
总目标：
以 GPT-5.6 为默认大脑，融合经验证的 Agent 能力，
最终成为最强 Windows 个人 AI 工作台。

当前任务：
完成 MOGU 2.0 Public RC 的 Day 5–7：
clean RC tag → 最终签名 Release Set → 三层 Gate → 上传回验。

后续任务：
Capability Intake
→ 2.1 Agent Capability Fusion
→ 2.2 Frontier Coding Agent
→ 2.3 Autonomous Task System
→ 2.4 Evidence-based Memory
→ 3.0 Autonomous Workspace
```

**执行状态：PAUSED。** 本次仅更新任务目标和存档目标；未收到用户明确“开始”前，不执行代码修改、构建、签名、发布、上传或能力接入。

## 北极星目标

> 做最强的 Windows 个人 AI 工作台：以 GPT-5.6 为默认大脑，吸收 Cursor、Trae Agent、OpenClaw 及其他优秀 Agent 的可验证优点，完成代码、电脑、创作和长任务的可信自主执行。

MOGU 的核心价值不是“又一个大脑”，而是：

> 让 GPT-5.6 在 Windows 本机拥有比裸模型更好的上下文、工具、权限、恢复、验证和长期执行能力。

## 目标层级

```text
北极星：最强 Windows 个人 AI 工作台
  └─ 3.0 Autonomous Workspace
      └─ 2.4 Evidence-based Memory
          └─ 2.3 Autonomous Task System
              └─ 2.2 Frontier Coding Agent
                  └─ 2.1 Agent Capability Fusion
                      └─ 当前里程碑：安全、干净、可安装的 MOGU 2.0 Public RC
```

公共化是后续能力真实交付给用户的安全与发行底座，不是项目终点：

```text
公共化与安全底座
→ 能力融合
→ 一线 Coding Agent
→ 长任务通用 Agent
→ 最强 Windows 个人 AI 工作台
```

## 做与不做

### 不做

- 不训练基础模型，不复制 GPT-5.6。
- 不重写 OpenClaw 已成熟的通用 Runtime。
- 不把多个 Agent 未经边界审查地机械拼接。
- 不靠继续堆 Prompt 代替工程能力。
- 不把 Public RC 当成 Agent 能力完成或项目完成。

### 必须做

- GPT-5.6 默认 Brain Adapter；保留本机模型和其他 Provider。
- OpenClaw 等 Runtime Adapter。
- MOGU 自己掌握权限、安全、资产、用户数据、TaskStore、审计与来源证明。
- MOGU 自己掌握 Coding Worker 的上下文、受控终端、LSP、Repo Graph、Patch、测试与验证。
- 学习和复用已被证明有效的 Agent 工程设计。
- 用同任务、同模型、同预算做 A/B、未见 Holdout 和真实用户任务验证。

## 最终架构

```text
MOGU Desktop
├─ Trust Plane
│  ├─ PermissionProxy · Audit · Secrets · User Data
│  └─ Artifact Provenance
├─ Brain Plane
│  ├─ GPT-5.6（默认）
│  ├─ Local Model
│  └─ Other Providers
├─ Runtime Plane
│  ├─ OpenClaw
│  ├─ PAI
│  └─ Dedicated Coding Worker
├─ Tool Plane
│  ├─ 9 Skills · Controlled Terminal · LSP / Repo Graph
│  └─ Browser · ComfyUI / Media
└─ Evidence Plane
   ├─ Test / Verify · Checkpoint / Rollback
   └─ Task Trace · Benchmark / Real Tasks
```

## 能力来源与目标位置

| 来源 | 值得吸收的能力 | MOGU 中的位置 |
|------|----------------|---------------|
| Cursor | 代码库索引、语义检索、LSP、快速编辑、Diff、后台 Agent | 精密工厂 |
| Trae Agent | 任务分解、多 Agent、工具循环、沙箱、轨迹 | Coding Runtime |
| OpenClaw | 长任务 Runtime、连接器、渠道、插件、恢复 | 默认 Runtime |
| Claude Code | 终端自主执行、长轨迹、计划—修改—验证 | Coding Worker |
| Codex | Worktree、并行子任务、测试验证、权限控制 | Coding Worker |
| Aider | Repo Map、Git 原生工作流、最小 Patch | 代码理解与修改 |
| OpenHands | 沙箱、事件流、可重放执行、Benchmark 工程 | Runtime 与评测 |
| Cline / Roo | 工具审批、MCP、用户可见轨迹 | 权限与交互 |
| Continue | 多模型 Provider、Context Provider | Brain / Context Adapter |

此表仅代表候选能力，不代表许可证已确认或允许复制。Cursor 等未开源商业能力只能依据公开行为 clean-room 实现。

## 开源能力引入原则

> 能复用就不重写，能接入就不复制；必须 Fork 时明确维护责任。所有外来能力最终统一进入 MOGU 的权限、任务、数据和审计体系。

允许并鼓励在**许可证兼容、安全可控、效果可验证**的前提下，直接复用、Fork 或改造优秀开源 Agent 代码。

> **MOGU 鼓励研究、复现、组合并改进所有公开可观察的竞品能力；对许可证兼容的开源代码，可直接依赖、Fork、移植或重构。对未开源实现，采用公开行为分析和 clean-room 实现。最终成果必须统一进入 MOGU 的权限、任务、数据和审计体系，并在同模型、同预算对照中证明不低于原能力。**

目标不是避免相似，而是避免无授权搬运具体专有实现；功能可以相同，体验可以更好，架构和代码由 MOGU 合法掌握。

公开行为研究必须沉淀为独立行为 Spec：输入、输出、中间状态、失败恢复和相对 MOGU 当前实现的预期增益。可以系统拆解 Cursor 的上下文选择、Trae 的任务分解、Claude Code 的终端循环、Codex 的 Worktree、OpenHands 的事件/沙箱、OpenClaw 的长任务调度和 Aider 的 Repo Map，并在独立实现后继续超越。

优先顺序：

1. **直接依赖**：LSP 客户端、Repo Map、Diff/Patch、PTY、Git/Worktree、解析器、Sandbox 工具。
2. **Adapter 接入**：完整 Runtime 或 Agent；能力由上游提供，信任边界由 MOGU 掌握。
3. **Fork 深改**：记录上游仓库、License、Fork commit、改动、同步策略、安全差异和维护责任。
4. **Clean-room**：未开源、License 不兼容或原安全边界不适用时，依据公开行为和独立 Spec 复现功能、流程与交互，不接触或搬运未授权专有源码、私有资源、密钥和内部数据。

### 统一信任边界

```text
Brain
→ Runtime Adapter
→ MOGU PermissionProxy
→ Capability Interface
→ Imported Component
→ Audit / Artifact / Verify
```

外来组件不得自行读取任意路径、执行未授权命令、获取 MOGU 凭据、静默上传、另建长期状态库、绕过 TaskStore 或自行更新二进制。删除、安装、修改、commit/push、发布和系统操作可以在用户授予的有限 Sovereign lease 内自动连续执行并完整审计；模型不能自行签发、扩大或续期该权力。

### 许可证最低检查

- 一手仓库及具体版本/commit 的 License，不凭项目名猜测。
- 二级依赖、模型、数据集、图标、商标和专利条款。
- 商业分发、修改公开、Notice、网络服务等义务。
- 无 License 默认不可复制和分发。
- MIT/BSD/Apache 通常较易接入但仍保留版权/Notice；MPL/GPL/AGPL/自定义 License 单独评估。

## Capability Intake Gate

每项能力必须登记：

```text
1. 能力价值与行为 Spec
2. 来源、版本、License 与法律边界
3. 采用方式：依赖 / Adapter / Fork / Clean-room
4. 数据、权限、遥测、更新与长期状态范围
5. 维护成本、上游同步与漏洞响应
6. 安全扫描和 MOGU 接口适配
7. 同模型、同任务、同预算 A/B
8. 未见 Holdout + 真实用户任务
9. 稳定增益才 Default-On；否则保持插件 / OFF
```

能力矩阵字段固定为：

```text
能力 · 竞品/上游来源 · 当前状态 · 采用方式 · License
权限/数据风险 · 预期收益 · 验证指标 · A/B结果 · Default-On
```

## Public RC 后版本

### 2.1 Agent Capability Fusion

1. 通用受控终端。
2. 多语言 LSP、Repo Map、引用与调用图。
3. 测试发现、失败诊断和验证闭环。
4. 只读并行子任务与 Worktree 隔离。

GPT-5.6 作为主要大脑，统一验证增益。七天 Public RC 窗口内仅整理能力矩阵和许可证清单，不引入新能力代码。

### 2.2 Frontier Coding Agent

多候选 Patch、不同根因假设、独立 Worktree 验证、最优 Patch 选择、调试器、依赖/构建管理、长任务恢复、后台 Coding Agent，并与 Cursor、Trae、Claude Code、Codex 做同协议对照。

### 2.3 Autonomous Task System

长任务图、并行 Agent、预算调度、OpenClaw 与专用 Worker 协同、失败策略切换、暂停/迁移/恢复，以及跨创作、电脑、编程的组合任务。

### 2.4 Evidence-based Memory

只保存经过验证的经验；项目长期记忆；用户习惯和权限偏好；成功 Patch/失败模式检索；过期和错误记忆淘汰。

### 3.0 Autonomous Workspace

用户只表达目标，MOGU 自动调用 GPT-5.6、OpenClaw、Skills、Coding Worker 和创作工具完成：

```text
“把这个项目修好并发布”
“根据这些素材生成视频并发给我”
“整理电脑、提取资料并制作报告”
```

## 当前实际进度与暂停点

| 范围 | 状态 |
|------|------|
| Public RC Phase 0 | COMPLETE |
| Day 1 个人/构建输入审计 | COMPLETE |
| Day 2 首次使用与显式路由 | COMPLETE |
| Day 3 数据隔离 | COMPLETE |
| Day 4 自动门禁与安全 | COMPLETE：259/259、17/17、23/23 |
| Day 5–7 Release Set / 上传回验 | PENDING：签名证书与 GitHub Release 权限未就绪 |
| 2.1 能力融合代码 | NOT STARTED |
| 能力矩阵与许可证清单 | 已冻结字段与 Gate，尚未逐项目取证 |

## 执行令

```text
本总纲已敲定。
当前暂停，不继续构建、签名、发布或引入能力代码。
收到明确“开始”后：
1. 继续完成 Public RC Day 5–7；
2. Public RC 完成后立即启动 2.1 Capability Intake 与能力融合；
3. 不再无限打磨包装。
```
