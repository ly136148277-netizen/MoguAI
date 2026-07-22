# S3.4 传达-only 结案（已封存）

> **状态：Pass（通过）** · 封存日期：2026-07-21  
> **本文件封存后不得被后续讨论悄悄改写。** 新研究进 [`RESEARCH_BACKLOG_POST_S3.md`](./RESEARCH_BACKLOG_POST_S3.md)。  
> 日常接续仍看 [`HANDOFF_AUTONOMY.md`](./HANDOFF_AUTONOMY.md)（指向本结案 + Backlog）。

---

## 判定

**S3.4：通过（Pass）。**

不是因为刷到了 6/8，而是因为：

1. 工程闭环已建立（invoke → agent → Docker 真验 → 回报）  
2. 公开 SWE-bench 路线已证明可行（结束线 ≥2/8；当前单次回归基线 **6/8**）  
3. 实验与归因纪律已立（实例级、不拼接口径、证据边界清晰）  
4. 剩余事项已从「补验收漏洞」转为「下一阶段研究」

---

## 单一现状版本（以本表为准）

| 项 | 最终状态 |
|----|----------|
| 当前官方回归基线 | **`R_reg = 6/8`**（`benchmarks/swe-bench/runs/lite8-phaseX-regression-20260720/`） |
| 绿集（基线） | 12907, 14995, 6938, 7746, 10914, 10924 |
| 未解（基线） | 14182, 14365 |
| BoN | High Variance **可选**恢复策略；**不默认开启**；**不并入** R_reg。门禁报告：`benchmarks/swe-bench/runs/lite8-bon-20260720/BON_REPORT.md` |
| 14182 | 见下节：单次实验 Resolved，**不计入基线** |
| 14365 | High Variance（方差跑 2/3）；基线仍记未解；BoN 可抬 any-pass，≠ 单次稳定能力 |
| 下一阶段 | 全部进入 [`RESEARCH_BACKLOG_POST_S3.md`](./RESEARCH_BACKLOG_POST_S3.md)，**不属于** S3.4 未完成项 |

早期「官方 0/8 / chat 全线 503 / 尚未验收」等叙述为**历史水位**，已被本结案与 `R_reg=6/8` 取代；不得再当作当前真相。

---

## 终态 5 条（工程验收口径）

| # | 条件 | 判定 |
|---|------|------|
| 1 | Cursor 只 invoke `mogu.coding` / `dispatch`，不手写业务补丁 | ✅ |
| 2 | 无人值守：改码 → 验证 → 失败再修 → 结构化回报 | ✅ |
| 3 | 同一套公开 8 题官方 eval：**Resolved ≥ 2/8** | ✅（基线现为 **6/8**） |
| 4 | 默认大脑配置指向新家中转 + `gpt-5.6-sol` | ✅ **设计层面**达标（见附注） |
| 5 | 有存档可交接 | ✅（本文件 + HANDOFF + BoN/基线目录） |

### 附注 · 第 4 条：设计默认 vs 运行时可用性（拆开判定）

| 层 | 内容 | 与 S3.4 关系 |
|----|------|----------------|
| **设计默认** | 配置与文档约定：`OPENAI_BASE_URL` = manylisten；`MOGU_BENCH_MODEL` / 大脑 = `gpt-5.6-sol` | **达标**；不因短暂 503 回滚本判定 |
| **运行时可用性** | 中转对部分模型返回 503；实测曾被迫用 `gpt-5.5` / `gpt-5.4` 顶替；本 key 为 GPT 多余额度，deepseek 等不在目录 | **运维风险**，记入交接附注；**不**与第 4 条「是否通过」混判 |

sol 恢复后只需更新运维风险描述，无需改写本结案的 Pass。

---

## 14182 为何不计入基线（性质，不只是样本量）

归档事实：

- 跑次：`lite8-phaseX-14182-C-gpt-20260720`  
- 结果：`gpt-5.6-sol` + **no-hints** → 官方 **Resolved**（单次）

**不计入 `R_reg` 的原因（须同时理解）：**

1. **未做 k=3 复现**，单次绿不能升基线。  
2. **更重要：实验性质已偏离原计划。** 原冻结对照是 deepseek-v3-0324 的 C（无 hints）/ D（+hints）换脑归因；因本 key **无法使用 deepseek**（目录无模型 / chat 503），破冻结后改为 **gpt-5.6-sol 单次裸跑**。  
3. 因此该结果回答的是：「在当前默认脑、关 hints 时，14182 能否被修掉（单次）」，**没有回答**最初的「换脑 / hints 贡献」问题。Hints contribution 仍为 **Unmeasured**（D 未跑）。

禁止误读为：「只差再跑两次就能把 7/8 写进基线」。

---

## 工程已交付（S3.4 范围内）

- 传达入口：`dispatch`（`mogu.coding`）  
- 修码闭环：coding agent + Docker SWE 真验 + 官方 eval  
- 合入栈（基线跑所用）：UTF-8 eval · test_patch · Django 标签 · scope warn · find_refs · gen-hints  
- 实验规范：实例级归因；禁止拼接口径；BoN 与 R_reg 分账  
- 交接：本结案 + [`HANDOFF_AUTONOMY.md`](./HANDOFF_AUTONOMY.md)

---

## 明确不在本结案内

下列一律视为 **Post-S3 研究**，见 Backlog 文件；**不是** S3.4 缺口：

- 14182 k=3；Hints D 臂；抬基线讨论  
- BoN 产品化 / Hard Fail × BoN  
- LSP 全量；多模型 system 对照  
- `test_roundtrip[True]` 根因  

---

## 红线（结案后仍有效）

- 不宣称「已超过 Cursor」或「全面超过市面 agent」  
- 不把 BoN any-pass 写进 `R_reg`  
- 不把单次 14182 绿写成 7/8 基线  
- Key / 竞品私有数据不进仓库  
- **已封存结论文本不得被后续实验讨论 silently 改写**；若事实变更，另开新版本结案，不覆写本文件正文结论段  

---

## 权威证据路径

| 用途 | 路径 |
|------|------|
| 回归基线 | `benchmarks/swe-bench/runs/lite8-phaseX-regression-20260720/` |
| BoN 门禁 | `benchmarks/swe-bench/runs/lite8-bon-20260720/BON_REPORT.md` |
| 14182 单次 C | `benchmarks/swe-bench/runs/lite8-phaseX-14182-C-gpt-20260720/` |
| 研究 Backlog | [`RESEARCH_BACKLOG_POST_S3.md`](./RESEARCH_BACKLOG_POST_S3.md) |
