# B2-D2′ Controlled Trial — Hypothesis Diversity Constraint

```yaml
experiment_id: B2-D2-PRIME
aka: D2′
experiment_type: repeatability
n_instances: 4          # FIXED before thresholds — B1 django Fail 全集；无第五候选
k_repeats: 3            # FIXED — no auto-extend to k=5
evidence_scope: instance
lifecycle_status: Archived · Branch B (counting) · mechanism inconclusive/mixed
model: gpt-5.5
parent_ct: B2-D2 Archived · Final Branch C
principles: ../OPENSOURCE_FAILURE_FEEDBACK_PRINCIPLES.md  # P7 tested; P1–P3 = next candidate
gate_env_base: MOGU_D2_STRUCTURED_RETRY=1
gate_env_treatment: MOGU_D2_HYPOTHESIS_DIVERSITY=1
```

> **Status:** **Archived**（2026-07-22）。计数 Branch B；机制归因见 `DIAGNOSIS_BRANCH_B.md`（inconclusive/mixed）。  
> **禁止：** 写「diversity 导致提升」；把 12497 无门闩 3/3 当 P7 证据；未拍板就开 Feedback-B。  
> **报告用语：** reuse-blind / held-out from intervention execution（禁止 blind validation）。

---

## 0. 决策记录（为何是 A 而非 B→A）

| 主张 | 结论 |
|------|------|
| DeepSeek：先 B 冒烟再 A，「分阶段便于归因」 | **不采纳**作下一步 |
| GPT + CO：直接锁 **hypothesis diversity constraint** | **采纳** |

理由（CO）：若先做 B（只改反馈格式），B 的结果会与「假设是否自然变多样」纠缠——提升/不提升都无法干净归因。当前复盘最硬证据是 **下一轮补丁实质同向（Jaccard 高）**；应对准的可操作变量是 **显式多样性约束（P7）**，不是反馈打包（P1–P3）。

**B（反馈打包）地位：** 工程候选，**排在 D2′ 归档之后**另开；不阻塞、不并行混跑。

---

## 1. 要回答的唯一问题

> 在 **当前 MOGU + gpt-5.5 + B1 django Fail 池** 上，在已有结构化 retry（D2）之上，增加 **显式假设多样性约束**（失败路径 → ≥2 候选假设 → 排除上一失败路径 → 选一执行），能否提升官方 Resolved，并且机制上是否真的换了修复路径？

**本试验是：**

```text
D2′ = hypothesis diversity constraint
```

**本试验不是：**

```text
D2′ = better feedback prompt / P1–P3 repack
```

**不回答 / 不推广：**

- 「所有 agent 都需要 hypothesis diversity」
- 反馈打包（P1–P3）是否独立有效
- D1 verify 覆盖、integrity hint、产品化接口
- 非 django / Class A（NO_VERIFY）行为

证据边界一句话：只回答 **本栈 + 本失败池** 上，显式多样性约束是否改善修复结果。

---

## 2. Intervention delta（相对 D2 baseline）

### Baseline（行为锚 = B2-D2 treatment，**不再重跑 control 臂**）

```text
verify fail (non-env)
  → classify (label only)
  → force set_plan + require apply_patch
  → re-verify
  → ≤2 structured cycles
```

历史数字：见 `../b2_d2/RESULTS.md`（同四题 × k=3）。  
本 CT **不**并行重跑「无 diversity 的 D2」k=3（成本纪律，同 D2 vs B1）。

### Treatment（本试验唯一自变量）

```text
verify fail (non-env)
  → extract failure pattern（沿用 D2 分类标签级；禁止扩写 D3 式反馈打包）
  → require ≥2 explicit candidate repair hypotheses
  → exclude previous failed path（文件集合 / 假设摘要 / 已尝试编辑靶）
  → select one unused candidate → set_plan → apply_patch → re-verify
  → ≤2 structured cycles（与 D2 相同预算；不因 diversity 加周期）
```

| 项 | 锁定值 |
|----|--------|
| 模型 | gpt-5.5 |
| verify / `buildSweTestPlan` | **不改** |
| D2 retry 门闩 | **保持开启**（`MOGU_D2_STRUCTURED_RETRY=1`） |
| retry 周期上限 | **2**（同 D2） |
| integrity hint | **禁止**（`MOGU_GEN_HINT_PROFILE` 非 integrity_v1） |
| 反馈打包 P1–P3 | **禁止**混入（head/tail elide、新模板等另轨） |
| 新增变量 | **仅**假设多样性约束（`MOGU_D2_HYPOTHESIS_DIVERSITY=1`） |

### 多样性约束的可检验定义（实现必须可测）

每次结构化 retry 周期，treatment **必须**满足：

1. **候选数：** 模型（或门闩强制的结构化输出）给出 **≥2** 条候选假设，每条含：目标文件/符号意图 + 一句话机制差异。  
2. **排除：** 至少 1 条候选必须相对「上一失败路径」可区分——满足下列 **至少一条**：  
   - 修改文件集合与上一轮最终 patch 的文件集合 **不完全相同**；或  
   - 假设摘要与上一轮 `set_plan` 假设的规范化文本 **不相同**；或  
   - 显式标注「放弃路径 X，改试 Y」且 Y ∉ 已失败路径集合。  
3. **执行：** 只执行一条未排除候选；禁止「两条候选文字不同但 patch 落回同一单文件同向编辑」而无记录——若发生，机制指标会暴露（见 §5）。  
4. **持久化（修 D2 复盘缺口）：** 每一轮 `apply_patch` 正文（或等价 unified diff）写入 metrics / artifact，供 Jaccard；不得只存最终 patch。

实现落点（开跑前写代码；本文件只冻行为）：扩展 `coding-d2-retry.js` + `coding-agent-loop.js`；**新模块名建议** `coding-d2-diversity.js`（或同文件 gated 分支）。单测必须覆盖：候选不足 / 未排除旧路径 / 门闩拒绝空转。

---

## 3. 样本（样本数先于门槛 — 已定死）

来源：B1b 官方评测 **django Unresolved（Fail）** 全集（恰 4 题）。  
**无第五 Class-C Fail 候选** → 无法在本池内再抽「全新盲题」。

| 角色 | instance_id | B1 | D2 Resolved@3 | 本 CT 角色说明 |
|------|-------------|----|---------------|----------------|
| **Known** | `django__django-13265` | Fail | 0/3 | 复盘：重试触发仍未解 |
| **Known** | `django__django-12497` | Fail | 2/3 | 复盘：偶发不同编辑才过 |
| **Reuse-blind** | `django__django-11019` | Fail | 0/3 | held-out from intervention execution；高 Jaccard 锁死例 |
| **Reuse-blind** | `django__django-15695` | Fail | 1/3 | held-out from intervention execution；成功轮像短假设抽签 |

### 角色纪律（重要）

- **Reuse-blind = held-out from intervention execution**，**不是**新分布上的 blind validation。  
  四题均来自 B1 django Fail 全集且已被 D2 CT 暴露；报告中 **禁止**写 “blind validation”。  
- Known vs Reuse-blind **分裂规则仍执行**：仅 Known 达 improvement、Reuse-blind 全无 → 试验级最高 **Branch B**（过拟合已知题风险）。  
- **禁止**用非 django / Class A / B1 django Pass 题顶替以「凑新盲」。

### 排除（强制）

同 D2：flask/sympy、integrity_v1 题、Root-cause 深读六题、B1 django Resolved、生成期 verifyOk=false 但官方 Pass 的 django。

---

## 4. 协议

| 项 | 值 |
|----|-----|
| 模型 | gpt-5.5 |
| 栈 | 对齐 B2-D2（coding_agent + SWE docker verify + D2 retry）+ **仅** diversity 门闩 |
| BoN | 关 |
| 每题 | 独立 runId × k；干净 workdir；禁止 splice |
| 官方分 | 每候选 `--eval`；预拉四题镜像 |
| 对照 | 同题 B1 Fail（N=1）+ 同题 D2 Resolved@3 历史表；**不**并行重跑无-diversity D2 |

### Run ID 前缀

| 样本 | prefix |
|------|--------|
| 13265 | `ct-b2d2p-django13265` |
| 12497 | `ct-b2d2p-django12497` |
| 11019 | `ct-b2d2p-django11019` |
| 15695 | `ct-b2d2p-django15695` |

候选：`{prefix}-c{1..k}-YYYYMMDD`  
产物目录：`controlled_trials/b2_d2_prime/`（**禁止**并入 B1 / B2-D2 RESULTS）

---

## 5. 指标（跑前冻结）

### 5.1 Primary（主结论）

- 每题 **官方 Resolved 次数 / k**（k=3）
- 「该题明显改善」：**Resolved ≥ 2/3**（相对 B1 同题 Fail；与 D2 同门槛）
- **不**把 process `engine ok`、仅 F2P、仅次数增加当作成功

### 5.2 Mechanism（必须报告；不定主 Branch，但决定解读）

目标：区分

| 诊断 | 含义 |
|------|------|
| 多样性做到了但 Resolved 不涨 | P7 机制生效，但对 Resolved 无帮助 |
| 号称多样但 Jaccard/文件集未变 | 约束未真正约束（实现或服从失败） |

**强制采集（每候选、每个 structured cycle）：**

| 指标 | 定义 |
|------|------|
| `candidate_hypotheses_n` | 该周期声明的候选数（须 ≥2） |
| `excluded_paths` | 被排除的上一失败路径摘要 |
| `files_t` / `files_t-1` | 相邻两轮 patch 修改文件集合 |
| `jaccard_patch(t, t-1)` | 相邻轮 patch 文本 Jaccard（token/行级；实现与 D2 复盘脚本对齐） |
| `file_set_changed` | `files_t ≠ files_t-1` |
| `hypothesis_text_changed` | 规范化假设文本是否变化 |

**机制通过（诊断用，非 Branch 主条件）：**  
在发生 ≥1 次 diversity 周期的跑次中，报告：

- 中位 / 均值 `jaccard_patch(t, t-1)` 是否 **低于** 同题 D2 复盘中跨-repeat 高相似带（参考：11019 曾见 0.60–0.71；本试验看 **轮间** 而非仅跨 c）  
- `file_set_changed` 或 `hypothesis_text_changed` 发生率  

若 Resolved 不涨且轮间 Jaccard 仍高 → 记 **constraint non-compliance / ineffective**，不得写成「H-info 已证伪」。

### 5.3 Negative protection

| 指标 | 定义 | 用途 |
|------|------|------|
| `regression_rate` | 官方 Unresolved 且失败形态为 **P2P regression**（F2P✓ P2P✗ 或 eval 等价）的候选占比；另报相对 D2 同题是否恶化 | 防止「换路径却拆绿测」（11897 类教训） |
| 空补丁率 | `model_patch` 空 / eval 不计 | 单独列，不进 Resolved 分子 |

`regression_rate` **升高** 而 Resolved 微涨 → Branch 解读必须降级（最高按弱信号），并在 RESULTS 开节说明。

### 5.4 Secondary（报告用）

- diversity 门闩触发次数、`forcedPatchCount`、空转再测≈0  
- 与 D2 同题 Resolved@3 对照表（历史，非同期 control）

---

## 6. 预注册判读规则（样本数已定 = 4 → 门槛如下）

> 先定 n=4，再写门槛（GPT）。与 D2 题级门槛对齐，便于跨 CT 对照。

### 题级 improvement

- 官方 Resolved **≥ 2/3** ⇒ improvement  
- 1/3、2/3 只记录；**禁止**中途因 2/3 自动补 k→5  

### 试验级 Branch

| Branch | 条件 | 允许读法 | 禁止读法 |
|--------|------|----------|----------|
| **A** | ≥3/4 题达 improvement | 多样性约束 **可能**在本栈本池有效（instance） | 已升 pattern；一切 agent 都需要；P1–P3 已证明 |
| **B** | 恰好 2/4 题达 improvement | 弱信号；可停或设计下一刀 | 「策略已证实」 |
| **C** | ≤1/4 题达 improvement | 当前形式的 P7 约束 **可能不足** | 「H-info 假说整体作废」；必须上 LSP |

Known / Reuse-blind 分裂：仅 Known 改善 → 最高 **Branch B**。

### 机制 × Branch 联合解读（强制写进 RESULTS）

| Resolved Branch | 机制指标 | 读法 |
|-----------------|----------|------|
| A/B | Jaccard↓ 或 file_set 常变 | 多样性约束可能贡献 |
| A/B | Jaccard 仍高 | **不可**归因多样性；疑似别的方差 / 运气 |
| C | Jaccard↓ | 多样了但无助于 Resolved → 下一刀不是「再加强换文件」盲加 |
| C | Jaccard 仍高 | 约束没落地 → 先修门闩服从，再谈假说 |

---

## 7. Threats to Validity

### Methodological

- 无同期无-diversity control 臂；对照依赖 D2 历史 k=3 + B1 N=1。  
- 四题均 D2 暴露 → 无新鲜盲题；外推更弱。  
- 干预若滑向「大段反馈重写 / 换文件硬配额当唯一条件」→ **作废重冻**（那是别的变量）。  
- 「≥2 候选」若只变成 prompt 装饰而无门闩拒绝 → 机制指标会抓；主结论仍不得美化。

### Infrastructure

- 镜像 / TLS：Error 单列，不操纵 Resolved 分母。  
- 脏工作区禁止。  
- 中间 patch 必须落盘；否则机制节作废、试验最高记 **Execution incomplete for mechanism**。

---

## 8. 明确不做

- 不改 B1 / R_reg / B2-D2 归档结论  
- 不并行产品化打包  
- 不把 P1–P3 反馈打包塞进本 CT  
- 不扩到 50 题 / 非 django  
- 不在本文件未勾完 §9 前开跑  

---

## 9. 开跑检查清单（全勾才可 → Running）

### 规格

- [x] 主变量锁定为 hypothesis diversity（A）；B 冒烟跳过  
- [x] n=4、k=3 已定死；Branch 表已按 n=4 填写  
- [x] 实现：`coding-d2-diversity.js` + loop / tools / bench 接入  
- [x] 单测：`tests/coding-d2-diversity.test.js`（含 smoke criterion）  
- [x] 中间 patch 落盘：`d2_cycles/<instance>/cycle_N/{hypothesis.md,patch.diff,verify_result.json}`  
- [ ] `regression_rate` 聚合进 RESULTS（eval 后；CT 报告脚本）  
- [x] 门闩冒烟文档：`SMOKE.md`（不计 Branch）  
- [x] 活跑冒烟（11019）→ `SMOKE_RESULTS.md`：**mechanism PASS / Branch N/A**  
- [ ] `MOGU_D2_STRUCTURED_RETRY=1` 且 `MOGU_D2_HYPOTHESIS_DIVERSITY=1`；**未**开 integrity / P1–P3  
- [ ] 四题 eval 镜像预拉  
- [ ] `metadata.yaml` → Queued / Running  
- [ ] 人类确认：仍是 P7-only；Reuse-blind 用语已锁  

---

## 10. 与相邻工作的关系

```text
B2-D2          → Archived · Branch C（retry 触发≠够用）
Principles     → Done（P7 = D2′；P1–P3 = post-D2′ 候选）
B2-D2′         → 本文件（Spec Frozen · 未跑）
Feedback B     → D2′ 归档后再决定是否单开
D1 / 产品化    → 单列，不混绑
```

---

## 11. 下一步（冻结后的工程序）

1. 实现 diversity 门闩 + 中间 patch 落盘 + 单测  
2. 单题冒烟（不计 Branch）  
3. 正式 4×k=3 + 官方 eval  
4. RESULTS：Primary + Mechanism + regression_rate + 与 D2 对照表  
5. 再决定是否开反馈打包（原 Option B）或停  
