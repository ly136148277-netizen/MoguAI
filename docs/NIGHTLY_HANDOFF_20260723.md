# Nightly Handoff — 2026-07-23

```yaml
date: 2026-07-23
product_north_star: GPT-5.6-powered strongest Windows personal AI workspace
current_milestone: PUBLIC RELEASE FINAL FREEZE v1.0 · Day 5–7 owner review active
research_track: EPB / D1 parallel · Default-Off · non-blocking
authority: docs/MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md
```

## 一句话

**目标层级已修正并敲定：** 北极星是以 GPT-5.6 为默认大脑、融合经验证 Agent 能力，成为最强 Windows 个人 AI 工作台；Public RC 是当前安全与发行里程碑，不是项目终点。

## 北极星与当前里程碑

北极星总纲：[`MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md`](./MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md)
当前里程碑：[`PUBLIC_RELEASE_FINAL_FREEZE.md`](./PUBLIC_RELEASE_FINAL_FREEZE.md)

```text
Public RC → 2.1 Capability Fusion → 2.2 Frontier Coding
→ 2.3 Autonomous Tasks → 2.4 Evidence Memory → 3.0 Autonomous Workspace
```

| 项 | 值 |
|----|-----|
| 不做 | 重写 · 新仓库 · 重造 Runtime · CLI 主入口 · 遥测 · 研究作门槛 |
| 路由 | 显式选择 · 不静默降级 · `builtin`≠拦死 OpenClaw |
| 证据 | Release Evidence Binding · Payload Manifest · 上传后回验 |
| 出口 | 全过 Public · 否则仅 Internal Preview |
| 开源复用 | License + 安全 + MOGU 信任边界 + A/B；能复用不重写 |

执行状态：

```text
Phase 0–Day 4 COMPLETE
Grok G1–G7 REVIEWED AND CORRECTED
2.0.1-rc.1 unsigned/internal-preview candidate built and gated
Public Release BLOCKED on clean tag + verified signing + installed E2E + upload recheck
```

### 当前任务目标（最终）

```text
当前：完成 Public RC Day 5–7
随后：Capability Intake → 2.1 Agent Capability Fusion
长期：2.2 → 2.3 → 2.4 → 3.0 北极星
```

用户已下令继续 Public RC 收口；能力接入仍冻结到 Public RC 完成后。

### Cursor Grok 4.5 委派包

已准备 [`GROK45_PUBLIC_RC_TASK_BRIEF.md`](./GROK45_PUBLIC_RC_TASK_BRIEF.md)，覆盖无需所有者凭据的 G1–G7：

```text
文档一致性 → Public Profile Gate → Payload Manifest
→ Evidence Manifest → unsigned Artifact Gate
→ clean-profile E2E 草案 → Capability Intake 矩阵
```

签名、clean tag、上传回验、最终安全复核与 Default-On 决策保留给 GPT-5.6 Sol / 项目所有者。

## 研究轨（并行 · 不阻塞）

| 项 | 状态 |
|----|------|
| EPB Smoke | **PASS**（机制≠效果） |
| Sample Gate | OPEN · SHORTFALL 后改 D1 扩样 |
| D1 | 50→条件+50 · 帽 100 · Option F OFF · `qualified_n<5` 不开 CT |
| Protocol | `b2_evidence_to_patch/D1_EXPANSION_PROTOCOL.md` |

## Phase 0 已知事实（开工前已静态确认）

1. `builtin+openclaw`：`runAgentText` 提前拦截 → OpenClaw 不可达（UI 与执行不一致）
2. `coding-skill` Key 断言：宿主 `OPENAI_API_KEY` 污染；隔离后可通过
3. `moguai-runtime-compat.json` 未进打包白名单（P0）
4. Portable ≠ 数据自包含（共用 AppData）
5. 签名证书为外部硬前置

## Phase 0 结果（COMPLETE）

见 [`PUBLIC_RELEASE_PHASE0_FACTS.md`](./PUBLIC_RELEASE_PHASE0_FACTS.md)。路由 / Key / compat 白名单 / 干净 Profile 已落地；证书与 `gh auth` 未就绪 → 仅能冲向 Unsigned/Internal Preview，直至外部前置恢复。

## Day 1–4（本窗口已推进）

| Day | 文档 | 状态 |
|-----|------|------|
| 1 审计 | `PUBLIC_RELEASE_DAY1_AUDIT.md` | COMPLETE · P0 PAI 路径回填已修 |
| 2 首启路由 | `PUBLIC_RELEASE_DAY2_FIRST_RUN.md` | COMPLETE |
| 3 数据隔离 | `PUBLIC_RELEASE_DAY3_DATA_ISOLATION.md` | COMPLETE |
| 4 门禁 | `PUBLIC_RELEASE_DAY4_GATES.md` | COMPLETE；最新复核 **272/272** · acceptance 17/17 + coding 23/23 |

| G5 | Unsigned Artifact Gate | [`PUBLIC_RELEASE_ARTIFACT_GATE_DRAFT.md`](./PUBLIC_RELEASE_ARTIFACT_GATE_DRAFT.md) · **unsigned PASS** |
| Grok delivery | [`GROK45_PUBLIC_RC_DELIVERY.md`](./GROK45_PUBLIC_RC_DELIVERY.md) | GPT-5.6 Sol 已复核并修正 P0/P1 |

**已完成：** GitHub 公共证据确认 `v2.0.0` 已发布，RC 版本确定为 `2.0.1-rc.1`；`dist-rc-final/` unsigned 候选、Payload/Evidence/Test reports 已生成并校验。

**仍阻塞 Public Release：** dirty tree 整理并形成 clean RC tag · `CSC_LINK`/签名与时间戳 · 最终签名安装包 E2E · GitHub 上传及下载回验。

## 权威路径

- 北极星总纲：`docs/MOGU_NORTH_STAR_AND_CAPABILITY_FUSION.md`
- 当前里程碑：`docs/PUBLIC_RELEASE_FINAL_FREEZE.md`
- Phase 0–4：`docs/PUBLIC_RELEASE_PHASE0_FACTS.md` … `DAY4_GATES.md`
- 研究 SHORTFALL / D1：`b2_evidence_to_patch/`
- Synthesis：`controlled_trials/SYNTHESIS_REPORT.md` · `NEXT_STEPS_BRIEF.md`
