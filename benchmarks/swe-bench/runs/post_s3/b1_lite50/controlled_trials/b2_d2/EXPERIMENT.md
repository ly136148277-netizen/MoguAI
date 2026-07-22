# B2-D2 Controlled Trial — structured retry on existing verify loop

```yaml
experiment_id: B2-D2
experiment_type: repeatability
n_instances: 4
k_repeats: 3          # FIXED evaluation k — no auto-extend to k=5 (unlike integrity_v1)
evidence_scope: instance
lifecycle_status: Running
model: gpt-5.5
parent: B1b lite8-b1-gpt55-n50-20260721b
baseline_class: C     # django already has real in-loop verify (see BASELINE_CAPABILITY_AUDIT.md)
gate_env: MOGU_D2_STRUCTURED_RETRY=1
```

> **Status:** **Running**（2026-07-21）。冒烟已过；正式 4×k=3。  
> **k 纪律（开跑前锁定）：** 固定 k=3 收束；单题 1/3、2/3 **只记录**；**不**自动补 k→5（与 integrity_v1 确认规则分离）。  
> **Not D1:** D1（非 django 补 verify）是独立基建，见同目录 `D1_VERIFY_COVERAGE_INFRA.md`，**不算**本 CT。

---

## 1. 要回答的唯一问题

> 在 **已有真实 verify failure 信号** 的 django 任务上，把「失败后是否继续修」从**模型自愿续环**改成**结构化强制 retry loop**，能否提升最终官方 Resolved？

**不回答：**

- 有没有 verify（那是 D1 / 基建）
- 通用自检提示是否有效（integrity_v1，已 Archived · Branch C）
- flask / sympy 行为（A 类，无 stage）

---

## 2. Intervention delta（相对 baseline）

### Baseline（当前 B1 django 路径）

```text
apply_patch → run_tests(real FAIL/PASS)
  → tool result + optional stack_anchor / find_refs
  → 模型自愿决定是否再 apply_patch（受 maxSteps 约束）
  → 无硬性「失败分类 → 新假设 → 强制第二补丁」门闩
```

证据：`BASELINE_CAPABILITY_AUDIT.md` §1.3、§2.3。

### Treatment（本试验唯一自变量）

```text
verify failure (non-env)
  → failure classification（F2P miss / P2P regression / apply-noop / other）
  → force revise set_plan（new hypothesis；禁止空转再测）
  → require ≥1 new apply_patch before next success claim
  → re-run verify
  → 在预算内重复（见下）
```

| 项 | 锁定值 |
|----|--------|
| 触发 | 仅 `run_tests` 真实失败（`ok=false`，非 `NO_VERIFY` / 非 env soft-skip） |
| 最小动作 | 每次失败后：**必须**先 `set_plan`（或显式更新 hypothesis）再 `apply_patch`；禁止连续纯 `run_tests` / 纯 `grep` 耗尽 steps |
| 预算 | 最多 **2** 次结构化 retry 周期（失败→分类→新假设→新补丁→再测）；另受 `maxAgentSteps` 上限 |
| 不变 | 模型 gpt-5.5；docker SWE verify；find_refs / scope warn；**不加** integrity_v1 / 题面 hint；**不**改 `buildSweTestPlan` 覆盖面 |

实现落点（开跑前写代码，本文件只冻行为）：`coding-agent-loop.js`（失败后硬门闩）± 极薄分类文案；**禁止**混入 D1 stage 扩展或 D3 大改反馈格式（D3 仅允许失败分类标签级最小信息）。

---

## 3. 样本（已预注册）

来源：B1b 官方评测 **django Unresolved（Fail）** 全集（恰 4 题）。  
全部具备 Class C 前提（B1 `verifySkipped≠true`，曾见真实失败信号）。

| 角色 | instance_id | B1 官方 | 生成期 verify（metrics） | 选入理由 |
|------|-------------|---------|--------------------------|----------|
| **Known** | `django__django-13265` | Fail | verifyOk=false；apply×6；run_tests×3；anchor | audit 已作「已有闭环仍败」例 |
| **Known** | `django__django-12497` | Fail | F2P✓ P2P✗；rollback+再 patch | 回归型已知失败 |
| **Blind** | `django__django-11019` | Fail | verifyOk=false；apply×8；run_tests×4 | 未做 root-cause 深读 |
| **Blind** | `django__django-15695` | Fail | verifyOk=false；apply×4；run_tests×3 | 未做 root-cause 深读 |

### 排除（强制）

| 排除 | 原因 |
|------|------|
| flask-4045 / sympy-11897 / 一切非 django | Class A 或无 stage；留给 D1 |
| integrity_v1 两题 | 已反复实验 |
| Root-cause sample audit 六题（sphinx×2、sympy-13915/11897、flask、requests） | 已人工深读，非盲 |
| B1 django **Resolved** | 不测「已解再抬」 |
| 生成期 `verifyOk=false` 但官方 **Pass** 的 django | 不测本假设（例 16595 等） |

盲选池本就只有 11019、15695；**不再随机重抽**（池耗尽）。若开跑前发现镜像/基建不可用，替换规则：仅可换成「同为 B1 django Fail 且未被深读」的题——当前无第五候选，则 **缩减为 3 题并在 RESULTS 声明**，不得用非 django 顶替。

---

## 4. 协议

| 项 | 值 |
|----|-----|
| 模型 | gpt-5.5 |
| 栈 | 对齐 B1b（coding_agent + SWE docker verify）+ **仅** D2 retry 门闩 |
| BoN | 关 |
| 每题 | 独立 runId × k；干净 workdir；禁止 splice |
| 官方分 | 每候选 `--eval`；预拉四题镜像 |
| 对照 | B1 N=1 Unresolved 为历史锚；本试验 **不**并行跑无门闩 k=3 control（成本；与 integrity CT 同纪律） |

### Run ID 前缀

| 样本 | prefix |
|------|--------|
| 13265 | `ct-b2d2-django13265` |
| 12497 | `ct-b2d2-django12497` |
| 11019 | `ct-b2d2-django11019` |
| 15695 | `ct-b2d2-django15695` |

候选：`{prefix}-c{1..k}-YYYYMMDD`  
产物：`controlled_trials/b2_d2/RESULTS.md`（**禁止**并入 B1 / 24/50）

---

## 5. 指标

### Primary

- 每题 **官方 Resolved 次数 / k**

### Secondary（报告用，不定主结论）

- `apply_patch` 次数、结构化 retry 周期是否触发
- F2P / P2P 桶移动（相对 B1 失败形态）
- 是否出现「空转再测」（treatment 下应≈0）

---

## 6. 预注册判读规则（跑前锁定）

### 「该题明显改善」（improvement）

- **仅**官方 **Resolved@final**；相对 B1 同题 Fail。
- **本试验评价 k 固定为 3**：该题 Resolved 次数 **≥ 2/3** ⇒ 记为 improvement。
- 1/3、2/3 均只作原始记录；**禁止**中途因 2/3 自动补跑至 k=5（integrity_v1 的确认规则 **不**适用于本 CT）。
- **不**把下列视为成功：
  - 仅 iteration / `apply_patch` / `run_tests` 次数增加；
  - 仅 F2P 过但官方仍因 P2P 回归 Unresolved；
  - 冒烟跑或 process `engine ok`。

### 题级 → 试验级 Branch

| Branch | 条件（确认后的 k） | 允许读法 | 禁止读法 |
|--------|-------------------|----------|----------|
| **A** | ≥3/4 题达「明显改善」 | 结构化 retry **可能**在 django Class C 上有效（instance 级） | 已升 pattern；可开 B2-300；D1 已证明；「模型变强了」 |
| **B** | 恰好 2/4 题达改善 | 弱信号 / HV；可定向补样本或停 | 「策略已证实」 |
| **C** | ≤1/4 题达改善 | 当前缺口 **可能不在**「缺强制 retry」 | 「必须上 LSP」；否定一切反馈工作 |

（与 GPT checklist 对齐的简写：≥3 → signal；1–2 → inconclusive；0 → no observed benefit。正式报告仍用上表 A/B/C。）

Known vs Blind 分裂：仅 Known 改善、Blind 无 → 最高 Branch **B**（过拟合已知题风险）。


---

## 7. Threats to Validity

### Methodological

- 无并行 control 臂；对照依赖 B1 N=1。
- 干预含「分类标签」极薄文案，须避免滑向 D3；若实现时扩写反馈摘要 → **试验作废重冻**。
- 4 题全来自 B1 Fail，选择偏差（难例）；结论不得外推全量 Lite。
- Known 两题在 audit 中被提及 → Blind 分裂规则强制执行。

### Infrastructure

- 镜像拉取 / TLS；失败记 Error，**不**计入 Resolved 率分母操纵（分母=完成评测的候选；Error 单独列）。
- Workspace 卫生：禁止脏树复用导致假 patch。

---

## 8. 明确不做

- 不改 B1 / R_reg / integrity 归档结论  
- 不据此自动排序 LSP / terminal / memory  
- 不与 D1 基建同 PR 混变量开跑  
- 不把 flask/sympy 塞进本 CT  

---

## 9. 开跑检查清单（全勾才可 Running）

### 实现验收（代码）

- [x] D2 门闩模块：`src/main/skills/coding-d2-retry.js`
- [x] 接入：`coding-agent-loop.js`（`MOGU_D2_STRUCTURED_RETRY=1`）
- [x] metrics：`d2Retry` 写入 bench `metrics.json`
- [x] 单测：`tests/coding-d2-retry.test.js`
- [x] **冒烟**：`b2_d2/SMOKE.md`（django-13265）通过 §核对表 → 见 `SMOKE_RESULTS.md`

### 实验纪律

- [ ] 本文件无未决「TBD」行为项  
- [ ] D2 门闩开启且 **未**改 `buildSweTestPlan` 非 django 覆盖  
- [ ] `MOGU_GEN_HINT_PROFILE` 非 integrity_v1（或显式关闭）  
- [ ] 四题 eval 镜像预拉成功  
- [ ] `metadata.yaml` → `Queued / Running`  
- [ ] 人类确认：主变量仍为 D2（非 D1/D3）  
- [x] 正式跑前冒烟已通过（见上）

---

## 10. 与 D1 / D3 关系

```text
B2
 ├─ D2 structured retry     ← 本文件（CT · Spec Frozen）
 ├─ D1 verify coverage      ← 基建，非 CT（见 D1_VERIFY_COVERAGE_INFRA.md）
 └─ D3 feedback quality     ← D2 归档后再议
```
