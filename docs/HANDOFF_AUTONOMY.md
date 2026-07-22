# MOGU 自治 · 交任务表（新聊天挂本文件）

> 更新：2026-07-21 · **S3.4 已 Pass 并封存**  
> 不含 API Key。

---

## 权威文档（不要混读）

| 文件 | 角色 |
|------|------|
| **[`S3_4_HANDOFF_CLOSEOUT.md`](./S3_4_HANDOFF_CLOSEOUT.md)** | **已封存**的工程结案；单一现状真相；勿改写正文结论 |
| **[`RESEARCH_BACKLOG_POST_S3.md`](./RESEARCH_BACKLOG_POST_S3.md)** | Post-S3 **研究课题**；可增删；不回写结案 |
| 本文件 | 日常接续指针 + 关键路径 |

---

## 🛑 停工点（从这里接）

**一句话：Feedback-B **Spec Frozen · Pending Review** → `b2_feedback_b/EXPERIMENT.md`。n=3 已锁（无干净第 4 题）；§7=M1–M10。**只做 spec review**；未实现/未冒烟/未 CT。结案 6/8 不动。**

| | |
|--|--|
| 仓库 | `D:/Project/ai-model-manager`（分支 `develop/v2.0`） |
| **结案** | [`S3_4_HANDOFF_CLOSEOUT.md`](./S3_4_HANDOFF_CLOSEOUT.md) → **Pass** |
| **当前基线** | **`R_reg = 6/8`** → `benchmarks/swe-bench/runs/lite8-phaseX-regression-20260720/` |
| 绿集 / 未解 | 绿：12907, 14995, 6938, 7746, 10914, 10924 · 未解：14182, 14365 |
| BoN | HV 可选、不默认；报告 `runs/lite8-bon-20260720/BON_REPORT.md` |
| 研究下一刀 | [`RESEARCH_BACKLOG_POST_S3.md`](./RESEARCH_BACKLOG_POST_S3.md)（默认建议 R1） |

### 运维风险（≠ 结案失败）

- 设计默认：manylisten + `gpt-5.6-sol`（S3.4 第 4 条设计层已达标）  
- 运行时：`gpt-5.6-sol` / 部分 5.6 系可能 **503**；曾降级 `gpt-5.5` / `gpt-5.4`  
- 本 key 为 GPT 多余额度：**deepseek 等不可用**（换脑压测需别的 key）

---

## 终态 5 条（摘要；全文见结案）

1. ✅ 只 invoke `dispatch`  
2. ✅ 无人值守改验修  
3. ✅ 官方 ≥2/8（现基线 6/8）  
4. ✅ 设计默认 sol（运行时可用性另记）  
5. ✅ 存档可交接  

---

## 历史沙盘（已完成，只读）

| 阶段 | 状态 |
|------|------|
| 1 修假反馈 | ✅ |
| 2 补感知（find_references） | ✅ 工程；LSP 全量 → Backlog R7 |
| 3 战术冗余 BoN 门禁 | ✅ 数据已收；产品化 → Backlog R3 |
| 换脑压测 | → Backlog R8（key 受限） |

---

## 大步状态（结案后）

| 大步 | 状态 |
|------|------|
| S0 归档 | ✅ |
| S1 传达入口 | ✅ |
| S2 修对码工程 | ✅ |
| S3 验收 | ✅ **含 S3.4 结论文档** |

旧文中「官方仍 0/8 / S3.4 🔶」等为历史水位，以结案文件为准。

---

## 关键路径

| 用途 | 路径 |
|------|------|
| **结案（封存）** | `docs/S3_4_HANDOFF_CLOSEOUT.md` |
| **研究 Backlog** | `docs/RESEARCH_BACKLOG_POST_S3.md` |
| 总档 | `docs/PROJECT_AUTONOMY_ROADMAP.md` |
| 工人入口 | `src/main/skills/handlers/coding.js`（`dispatch`） |
| Agent | `coding-agent-loop.js` / `coding-agent-tools.js` |
| Bench | `scripts/bench_swe_*.js`、`bench_swe_bon_*.js` |
| 基线 | `benchmarks/swe-bench/runs/lite8-phaseX-regression-20260720/` |
| BoN | `benchmarks/swe-bench/runs/lite8-bon-20260720/` |
| 中转说明 | `docs/RELAY_MANYLISTEN_REPORT.md` |

---

## 红线

- 不宣称「已超过 Cursor」  
- 不改写已封存结案正文结论；事实变更另开新版结案  
- 不把 BoN / 单次 14182 写入 `R_reg` 而不走 Backlog 闸门  
- Key 不进仓库  

---

## 合计

```text
工程：S0–S3（含 S3.4）已收口 · Pass
研究：见 RESEARCH_BACKLOG_POST_S3.md · 不挡结案
基线：R_reg = 6/8（单次回归）
```
