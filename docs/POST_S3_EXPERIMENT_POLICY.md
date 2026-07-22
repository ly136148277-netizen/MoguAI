# Post-S3 实验策略（活文档）

> 更新：2026-07-21 · 不改写 [`S3_4_HANDOFF_CLOSEOUT.md`](./S3_4_HANDOFF_CLOSEOUT.md)

## 统一元数据（三正交字段）

每个实验目录（`post_s3/<exp>/` 或等价）**开跑第一件事**：写 `metadata.yaml`。报告头部与之对齐，勿口头重申口径。

| 字段 | 回答的问题 | 取值 |
|------|------------|------|
| `experiment_type` | 实验设计是什么？ | `coverage` \| `repeatability` |
| `evidence_scope` | 结论允许推广多远？ | `instance` \| `pattern` \| `system` |
| `lifecycle_status` | 当前走到哪一阶段？ | 见下节四态 |

三者**互不替代、互不推导**（例：coverage 不自动升 pattern；Execution Complete 不自动允许填 Resolved）。  
另建议写清：`n_instances`、`k_repeats`、`run_id`、`model`（禁混模）。  
模板：`benchmarks/swe-bench/runs/post_s3/_templates/metadata.yaml`。

## 实验类型（先分型，再看数字）

**「50」可以是 50 道不同题，也可以是 1 题跑 50 次。数字本身不告诉你该用哪套分析。**  
任何新实验（含 C1/D1）开跑前、出报告前，第一步读 `metadata.yaml`；**禁止先看总分再猜框架**。

| 类型 | 数据结构 | 回答的问题 | 合法输出 | **禁止**套用 |
|------|----------|------------|----------|--------------|
| **Coverage Experiment（覆盖实验）** | n 个 **不同** instance × **N=1** | 覆盖率、失败类型、新坑、能力面 | Resolved 数、逐题 Pass/Fail、失败分桶、相对旧集的新掉绿/意外 Pass | Pass Rate x/n、High Variance、Stable Pass、「模型一致性」 |
| **Repeatability Experiment（重复实验）** | **1**（或少数）instance × **k>1** | 稳定性、BoN 收益 | Pass Rate、HV / Stable Pass / Stable Fail、BoN any-pass | 把单次 Coverage 结果写成「稳定性」 |

**硬规则**：Coverage ≠ Repeatability；覆盖率 ≠ 稳定性。模板混用 = 证据等级错误（假稳定性 / 假能力面）。

**开跑清单**：先写 `metadata.yaml`，再开跑；分析模板只选上表对应列。  
例：B1b = Coverage（50 不同题 × N=1）；R1/R2/BoN = Repeatability（同题 k 次）。

### evidence_scope（与 experiment_type 正交）

取值（建议）：`instance` | `pattern` | `system`

| experiment_type | 默认 evidence_scope（起点，可下不可默认上抬） |
|-----------------|-----------------------------------------------|
| coverage | `instance`；样本与分桶够稳时可写 **部分** `pattern` |
| repeatability | `instance`（单题稳定性；勿写成全库覆盖） |
| 多轮 coverage + 多模型对照 | 可升至 `pattern`（需显式论证） |
| 大规模公开协议验证（如 B-ext） | 才讨论 `system` |

**纪律**：Coverage 因 n 变大 **不**自动升到 system；升档必须另写依据。  
**采纳节奏**：B1 Coverage Report 试填一轮；好用再改为强制字段，现不纠结细则。

### 实验生命周期（含 `--eval` 时强制）

不要用二元「运行中 / 完成」。统一四态；**只有后两态允许引用正式数字**。

| 状态 | 判定 | 允许出结论？ |
|------|------|:------------:|
| **Queued / Running** | agent / `bench_swe_run` 执行中 | ❌ |
| **Execution Complete** | run 产物齐（如 `predictions.jsonl`、process `metrics.json` / `summary.md`） | ❌ |
| **Evaluation Complete** | 官方 `--eval`（`swebench.harness.run_evaluation`）全部结束，eval 汇总落地 | ✅ |
| **Archived** | Coverage/Repeatability 报告填完、文档同步、状态封存 | ✅（只读） |

**执行完成 ≠ 实验完成**：`Execution Complete` 时出现的 `engine ok` / docker-verify **不是**官方 Resolved。  
正式数字（Resolved、Coverage 四项、与 A0 对照）**仅**可在 `Evaluation Complete` 及之后填写。

此前（Queued / Running / Execution Complete）：

- ✅ 可记运行态标签与进度（含 eval %）  
- ✅ 可做僵死排查（环境 / 网络 / Docker 超时）——**不算**提前统计  
- ❌ 不把 `engine ok` / 终端 ok=true 当成 Resolved；不做失败分桶；不与 A0 交叉对照  

报告数字只追溯**官方 eval 产物**，不用 run 日志或 process metrics 垫底。  
`lifecycle_status` 写在 `metadata.yaml`（并同步报告头部）；状态变更时更新该文件。

### 工具缺口优先级（禁止预设映射）

等待窗口可做 P1 **设计草稿**（LSP / 受控终端 / 长轨迹记忆），**不**混入进行中的 Coverage 变量。  
「通过率低→定位 / 中→环境 / 高→策略」等区间映射 = **未验证假设**，**禁止**在 Coverage Report 落地前当作决策表。  
正式排序须看失败分桶的**具体类型分布**（空补丁 / 语义 / harness…）后再定；禁止先有结论再对号。

若 Coverage 出现高比例 **Error（eval 镜像/Hub 不可达）**：视为 **扩展硬闸门**，优先修基建（预拉、重试、可达性），**不**据此排序 P1 工具，也**不**直接开 B2。

### Coverage 报告固定节：Threats to Validity

每份 Coverage Report 末尾须有短节 **Threats to Validity**，并**分两类**列出：

| 类型 | 示例 |
|------|------|
| **Infrastructure Threats** | TLS、Docker Hub 可达性、本地 ImageNotFound、manifest unknown、429、磁盘 |
| **Methodological Threats** | 样本量 n、单模型、Coverage vs Repeatability、`evidence_scope`、与旧集无交集 |

至少覆盖：基础设施限制、样本范围、单模型/单次、当前 `evidence_scope`；（若有 Error）有效判分样本数 vs submitted。  
`Resolved/(submitted−Error)` 等仅可作**补充透镜**，**不得**升格为主指标或改写 Archived 数字。

防止读者把 `Resolved/submitted` 误读成干净能力通过率。

## 模型路由（锁死）

| 角色 | 模型 | 说明 |
|------|------|------|
| **实验主力** | `gpt-5.5` | 本阶段所有 k=N / 基线重测默认用它 |
| 设计默认（结案仍写） | `gpt-5.6-sol` | 有空探活；稳定后再讨论切回实验默认 |
| 兜底探活 | `gpt-5.4` | 仅探活/应急；**不得**混进已声明为 5.5 的 cohort |

报告必须显式写：

> 本轮实验模型=`gpt-5.5`（非设计默认 sol；因 sol 可用性问题临时切换为实验主力）。

## 硬规则：禁止混模凑 k=N

1. 开跑前：`npm run bench:probe-models -- --require gpt-5.5 --fail-exit`  
2. cohort 锁定单一 `MOGU_BENCH_MODEL`  
3. 中途该模型 503 → **整组作废重跑**，不许换 5.4/sol 拼进同批结果  

## Docker 存储

- 清理：`docker system prune -a --volumes`（只清 Docker 缓存，不动项目/系统）  
- 建议：Docker Desktop → Settings → Resources → **Disk image location** 改到 `D:\DockerData`（C 盘仅约 19GB 空闲时强烈建议）  

## R1 读法（禁止翻篇）

14182：`gpt-5.6-sol` 单次 Resolved ≠ 稳定；`gpt-5.5` k=3 = 0/3 ≠ 永久无解。  
**分账、不合并。** 全文：`benchmarks/swe-bench/runs/post_s3/r1_14182_k3/RESULTS.md`

## 三表并立（禁止排行榜化）

| 表 | 数字 | 职责 |
|----|------|------|
| Official Anchor | phase1-anchor **3/8**（sol） | 横向/原生能力参照 |
| Engineering Baseline | phaseX-regression **6/8**（sol）= 结案 R_reg | 工程闭环验收 |
| R_reg@gpt-5.5 | A0（进行中） | 单模型 gpt-5.5 独立基线 |

详见 `runs/lite8-phase1-anchor-20260720/ANCHOR_COMPARE.md` 文首准则。  
A0 已完成（5/8）。**不讨论默认换脑**，除非出现 Pattern 级证据（7746 单点不够）。

## 规模化 vs 公开对标（拆开）

| 目标 | 做法 | 默认模型 |
|------|------|----------|
| 内部规模化（B1/B2） | 先跑顺 30–50 → 300；看稳、省、基建 | **`gpt-5.5`** |
| 真·公开榜同台（B-ext） | 官方 key + 协议对齐；**另开跑批** | 榜上收录模型（非中转代号） |

禁止理由：「选 sol 因为更接近公开榜」——错误（身份/协议问题，不是代号正宗问题）。

## 路线

`A0 已完成` → `B1（30–50 @gpt-5.5）` → `B2（≈300 @gpt-5.5）`；B-ext 独立规划。  
Docker 数据已在 D:；镜像按需重拉。
