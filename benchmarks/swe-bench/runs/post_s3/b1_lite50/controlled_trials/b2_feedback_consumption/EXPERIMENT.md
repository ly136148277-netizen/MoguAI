# B2-Feedback-Consumption Controlled Trial — Forced Feedback → Decision Binding

```yaml
experiment_id: B2-FEEDBACK-CONSUMPTION
aka: Feedback-Consumption · FC
experiment_type: repeatability
n_instances: 3                            # LOCKED via D+ → Option F (Discovery exhausted)
k_repeats: 3                              # LOCKED
evidence_scope: instance (reused)         # familiar-face · prior exposure threat
lifecycle_status: Archived · Branch B (counting) · mechanism NOT CONFIRMED
model: gpt-5.5
parent_chain: B2-D2 (C) → B2-D2′ (B counting) → Feedback-B (A counting · util Not established)
treatment:
  base:
    feedback_pack: true                   # MOGU_FEEDBACK_PACK=1 (Feedback-B pack; not redesigned)
  delta:
    forced_consumption_gate: true         # MOGU_FEEDBACK_CONSUME=1 (SOLE new variable)
forbidden:
  - MOGU_D2_STRUCTURED_RETRY=1
  - MOGU_D2_HYPOTHESIS_DIVERSITY=1
  - MOGU_GEN_HINT_PROFILE=integrity_v1
  - D1 verify-coverage expansion as part of this CT
  - redesign of P1–P3 pack templates (reuse Feedback-B as base only)
```

> **Status:** Spec Frozen · **D+ executed** → Discovery 预算耗尽 → **Option F locked**（2026-07-22）。  
> **Evidence scope:** `instance (reused)` · **Threat:** `prior exposure`（熟脸第四次同池）。  
> **边界：** `复述存在 ≠ 反馈被消费`。Branch ≠ Mechanism proof。**Positive 不得升默认策略。禁止跨 CT 横向排名。**

---

## §1 Hypothesis

> 在 **已有反馈可见（Feedback-B pack = base）** 的前提下，强制模型把失败证据 **显式绑定** 到下一步假设，是否能提高官方修复成功率，且机制上是否出现 C3/C4 级消费？

```text
Feedback-Consumption = information enters the decision
≠ retry (D2) | diversity (D2′) | presentation polish (Feedback-B delta)
≠ verify coverage expansion (D1)
```

| 实验 | 测什么 |
|------|--------|
| D2 | retry 有没有用 |
| D2′ | 搜索空间变化有没有用 |
| Feedback-B | 信息展示有没有用 |
| **Feedback-Consumption** | **信息是否进入决策** |

```text
复述存在 ≠ 反馈被消费
Branch A/B ≠ mechanism confirmed
```

---

## §2 Intervention delta

### Metadata（强制区分，便于与 Feedback-B 对照）

```yaml
base:
  feedback_pack: true          # P1 status · P2 head/tail/elide · P3 templates — AS-IS from Feedback-B
delta:
  forced_consumption_gate: true
```

对照读法：本试验 = **Feedback-B base + Consumption Constraint**。  
**禁止**把 Resolved 改善单独归因于「又一次打包改进」——pack 不是本试验 delta。

### Baseline（锚）

```text
MOGU_FEEDBACK_PACK=1
MOGU_FEEDBACK_CONSUME=0
D2 / D2′ / integrity OFF
# = Feedback-B treatment 条件（历史对照 / 叙事；本 CT 不并行 control 臂）
```

### Treatment（唯一自变量 = delta）

```text
MOGU_FEEDBACK_PACK=1                 # base ON
MOGU_FEEDBACK_CONSUME=1              # delta
D2 / D2′ / integrity OFF

verify fail
  → Feedback Pack (base, unchanged)
  → mandatory structured consumption record (tool or gated set_plan fields)
  → apply_patch BLOCKED until record validates
```

#### 强制结构化字段（每次失败后、下一轮 apply_patch 前）

| Field | Required content |
|-------|------------------|
| `failedStage` | 复述上一轮失败阶段（须可匹配上一轮 verify） |
| `errorClass` / `failure_class` | 复述错误类型（须可匹配） |
| `evidence_used` | ≥1 条可定位证据（见 §2.1 客观规则） |
| `next_hypothesis` | 新假设 + **与上一假设/失败路径的可描述差异** |

#### §2.1 套话拒绝 — **客观规则（禁止人类语义「明显套话」）**

```text
valid_consumption ⇔
  (1) failedStage 与上一轮 verify_result.failedStage 可匹配
      （精确相等，或规范后相等；未知/- 仅当上一轮确实无 stage）
  AND
  (2) failure_class 与上一轮 pack/classify 标签可匹配
  AND
  (3) evidence_used 至少包含一个可定位证据 token：
        · 上一轮 pack/verify 文本中出现的 test 名，或
        · AssertionError / 断言片段（≥8 有效字符连续命中），或
        · stack 文件路径（workspace-relative）或 file:line
  AND
  (4) next_hypothesis 规范化文本 ≠ 上一轮 hypothesis 规范化文本
      （须给出非空 diff 描述字段，或 hypothesis 文本实质变化）
```

不满足 → **拒绝** `apply_patch`（返回明确 ERROR + 缺哪条规则），要求重做 consumption。  
**禁止**审稿人主观判定「像不像套话」。

| 可改（delta） | 不可改 |
|---------------|--------|
| consumption 门闩、字段校验、阻断 apply_patch | D2 retry、D2′ diversity、P1–P3 模板内容、verify 覆盖、题面/目标策略 prompt |

---

## §3 Baseline definition

| 对照 | 角色 |
|------|------|
| B1 同题官方 Fail | improvement 锚 |
| 本 CT treatment Resolved@k | 主数字 |
| Feedback-B 同题历史（若样本重叠） | **base 对照 only**；delta = consumption |
| D2 / D2′ 同题历史 | 叙事 only；干预不同 |

---

## §4 Sample selection — **D+ Gate（已关闭）**

### 4.0 D+ 规则（预注册 · 冻结）

```text
Primary:              Option D
Discovery budget:     ≤12 candidates inspected (archive / B1-8 / eval-retry-12 / prior verify-fail)
Success criterion:    n=4 · real in-loop verify-fail · not burned by D2/D2′/Feedback-B · usable Fail baseline
If budget exhausted:  automatic Option F (not optional improvisation)
```

Discovery **不是**新研究项目：只查已有 archive / 已有 verify-fail / 未进本链 CT；**禁止**为凑样本重跑整份 Lite50。

### 4.1 Discovery 执行记录（预算内 · 关闭）

详见 `DISCOVERY.md`。摘要：

| # | candidate | 结果 | 原因 |
|---|-----------|------|------|
| 1–4 | 13265 / 12497 / 11019 / 15695 | reject | 本链熟脸；12497 另排除 |
| 5–8 | B1 非 django Fail（sympy×2, sklearn, matplotlib） | reject | Class A · `NO_VERIFY` |
| 9–10 | eval-retry：flask-4045, sympy-11897 | reject | Class A + integrity 污染 |
| 11 | django-10914 / 10924 | reject | 非 B1 Fail 锚；phase 深史；近栈多 R |
| 12 | astropy-7746 / 12907 等 | reject | 非零历史；R1/R2/phase 污染或无稳定 Fail 锚 |

**Inspected = 12 / budget 12。合格 n=4 = 0。→ 触发 Option F。**

### 4.2 Option F — Locked scoring set

```text
sample_option: F
sample_size: 3
scoring_set: {django__django-13265, django__django-11019, django__django-15695}
excluded: {django__django-12497}   # 仍排除；防零干预型污染
role: reuse-pool / familiar-face
branch_threshold_map: §6.2 Map F (n=3)
```

```yaml
evidence_scope: instance (reused)
threat: prior exposure   # 第四次同池（相对 D2/D2′/Feedback-B；少 12497）
```

**强制降级声明：**

1. 任何 Positive（含 Branch A）**不得**直接升级为默认 coding 策略。  
2. **禁止**跨 CT 横向排名 / 比例并排（勿写 Feedback-B A > D2′ B 之类）。只允许 **within-experiment** 结论。  
3. §7 格外严格：每道 improvement 须核查消费门闩是否真实触发（防「未进 C1–C4 却 Resolved」的 12497 型污染）。  
4. 禁止 blind validation 用语。

---

## §5 Execution protocol

| 项 | 值 |
|----|-----|
| 模型 | gpt-5.5 |
| k | 3 固定；禁止补 k→5 |
| env | `MOGU_FEEDBACK_PACK=1` + `MOGU_FEEDBACK_CONSUME=1` |
| 关 | D2、D2′、integrity |
| BoN / splice | 关 / 禁 |
| 官方分 | 每候选 `--eval` |
| 落盘 | **强制**：每次 consumption 全文 + 每次 `set_plan` hypothesis/approach → `feedback_consume/`（消 Feedback-B 审计缺口） |

Run ID：`ct-fc-…-c{1..3}-YYYYMMDD`  
产物：`controlled_trials/b2_feedback_consumption/`  
Runner：须 `--smoke-only` / `--ct`；无 flag 拒绝。

Smoke：单元（校验规则）+ live 一题（门闩阻断无效 consumption；**不计** Branch）。

---

## §6 Judge rules

### 6.1 题级 improvement

```text
improvement ⇔ 官方 Resolved ≥ 2/3
```

相对 B1 同题 Fail；禁止 `engine ok` 当 Resolved。

### 6.2 试验级 Branch（预注册；随 §4.3 选用）

#### Map D（n=4）

```text
A: ≥3/4 improvement
B: =2/4
C: ≤1/4
```

#### Map F（n=3）

```text
A: ≥2/3
B: =1/3
C: 0/3
```

```text
Branch != Mechanism proof
```

允许读：计分面信号。  
禁止读：已证实「消费改变决策」；可进默认环——须看 §7 C3/C4。

### 6.3 regression_rate

`p2p_regression_signal` 跑次 / (n×k)。升高则 Branch 解读降级。

---

## §7 Mechanism Attribution（强制；不定主 Branch）

### 7.1 Consumption evidence ladder（C1–C4）

| ID | 层级 | 判定 | 通过含义 |
|----|------|------|----------|
| **C1** | 字段存在 | consumption 记录写出四字段 | 门闩表层触发 |
| **C2** | 匹配真实 verify | 通过 §2.1 (1)(2)(3) | 复述非空转；对齐真实失败 |
| **C3** | 决策引用 | 下一轮 hypothesis **或** patch 明确引用 evidence_used / 同批可定位 token | 信息进入假设或补丁内容 |
| **C4** | 行为变化 | vs 上一失败路径：hypothesis 变 **且**（Jaccard 下降 **或** file_set_changed **或** 指向复述中的新定位） | 后续行为因消费而变 |

```text
最终机制结论必须看 C3/C4。
仅有 C1（或 C1+C2）= 形式通过，机制未证实。
```

反例（须记为机制失败）：

```text
复述: "failedStage=FAIL_TO_PASS …"
然后继续同文件高 Jaccard 微改，且 patch/hypothesis 不引用 evidence_used
→ C1/C2 可能过；C3/C4 失败
```

### 7.2 必采字段 / artifacts

```text
feedback_consume/
  consume_{nn}.json     # 四字段 + validation bits + verify fingerprint
  plan_{nn}.md          # set_plan 原文（强制持久化）
  gate_rejects.jsonl    # 被 §2.1 拒绝的次数与原因码
meta in metrics.json:
  feedbackPack: { … }           # base
  feedbackConsume: {
    enabled, gate_blocks, valid_count,
    C1, C2, C3, C4 per cycle,
    jaccard_vs_prev, file_set_changed
  }
```

### 7.3 联合读法（RESULTS 强制表）

| Resolved Branch | C3/C4 | 读法 |
|-----------------|-------|------|
| A/B | C3/C4 过 | consumption **可能**贡献 |
| A/B | 仅 C1/C2 | **不可**归因消费（形式通过 / 方差） |
| C | C3/C4 过仍败 | 绑定了但仍不足以修 |
| C | 门闩未落地 | 先修实现服从 |

---

## §8 明确不做

- 不回写 D2 / D2′ / Feedback-B 归档结论  
- 不把 Branch A 当默认开启许可  
- 不开跑后改样本 / 阈值  
- 不在 Sample Gate 未关闭时 Implementation→CT  
- 不并行 D1「为了凑样本」除非另开基建轨并重冻规格  

---

## §9 检查清单

### Spec review

- [x] 单变量 = consumption gate（delta）；pack = base  
- [x] 假设改为「可见反馈下强制绑定证据→决策」  
- [x] C1–C4 ladder  
- [x] 套话拒绝 = §2.1 客观规则  
- [x] 样本须真实 verify failure；B1 零历史 Class-C 枯竭已记录  
- [x] Branch 与 mechanism 分离；D/F 两套阈值预注册  
- [x] **Spec Frozen**（Sample Gate 仍开）  

### Sample Gate / 实现

- [x] §4.3 锁定 Option F（D+ Discovery 12/12 → 0 合格）  
- [x] `MOGU_FEEDBACK_CONSUME` + 单测（含 §2.1 拒绝规则）  
- [x] artifacts 含 plan/consume 全文路径  
- [x] runner `--smoke-only` / `--ct`  
- [x] smoke（门闩 only）→ `SMOKE_RESULTS.md`  
- [x] CT → `RESULTS.md` / `aggregate.json`  

---

## §10 相邻工作

```text
Feedback-B              → Archived (A counting · util Not established)
Feedback-Consumption    → Spec Frozen · Sample Gate
Implementation          → only after §4.3 locked
D1 verify coverage      → 另轨；不由本 CT 自动触发
```
