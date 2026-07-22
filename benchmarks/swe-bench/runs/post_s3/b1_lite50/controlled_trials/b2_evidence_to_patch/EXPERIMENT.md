# B2-Evidence-to-Patch Binding — Controlled Trial Spec

```yaml
experiment_id: B2-EVIDENCE-TO-PATCH-BINDING
aka: EPB · Evidence-to-Patch Binding · Decision Binding (narrow)
experiment_type: repeatability
n_instances: 5                            # LOCKED · Sample Gate primary
k_repeats: 3                              # LOCKED
evidence_scope: TBD until Sample Gate close (Discovery)
lifecycle_status: Spec Review PASS · Implementation in progress
model: gpt-5.5                            # LOCKED
parent_chain: >
  Integrity_v1 → D2 (C) → D2′ (B) → Feedback-B (A·util NC)
  → Feedback-Consumption (B·util NC) → Capability Probe (Complete)
treatment:
  base:
    strategy_flags: all OFF               # clean coding loop (= capability probe)
  delta:
    evidence_to_patch_binding: true       # SOLE new variable · MOGU_EVIDENCE_PATCH_BIND=1
forbidden:
  - MOGU_D2_STRUCTURED_RETRY=1
  - MOGU_D2_HYPOTHESIS_DIVERSITY=1
  - MOGU_FEEDBACK_PACK=1
  - MOGU_FEEDBACK_CONSUME=1
  - MOGU_GEN_HINT_PROFILE=integrity_v1
  - forced_second_apply_after_fail
  - binding fallback / silent old-path apply
  - D1 verify-coverage expansion as part of this CT
  - LLM-as-judge for DB2
```

> **Status:** Spec Review **PASS** (2026-07-22). Open items **closed** (§9).  
> **边界：** `patch 绑定证据 ≠ 读了反馈 ≠ 复述了反馈 ≠ 强制多 patch`。  
> **`Branch != Mechanism`。`Resolved ≠ binding worked`。**  
> Positive **不得**升默认策略。禁止跨 CT 横向排名。

---

## §0 Naming & scope

| 口头名 | 正式名 | 测什么 |
|--------|--------|--------|
| Decision Binding（宽） | 弃用为实验标题 | 太大 |
| **Evidence-to-Patch Binding (EPB)** | **本试验唯一标题** | 失败证据是否进入 **patch 决策** |

```text
Core hypothesis (single):
  After verify fail, does apply_patch bind to a concrete Evidence Object
  via an explicit BINDING token — and does that binding align change locus?
```

---

## §1 Hypothesis

> 在干净 baseline 环上，强制 `apply_patch` 前发出显式 **PatchBinding**（绑定系统 Evidence Object），  
> 是否提高官方修复成功率，且机制上出现 **DB2 ∧ DB4**（并报告 **DB0** 触发率）？

```text
EPB = evidence enters the patch decision via explicit BINDING
≠ retry · ≠ diversity · ≠ packaging · ≠ consume/rehearsal
≠ mandatory second apply after fail
```

Capability Probe 模式（`django-15781`）：失败后可续环，但再 `apply_patch`=0/3。  
EPB **不**强迫第二次 apply；测的是：一旦 apply，是否被证据约束，以及失败后是否形成新绑定链（DB4）。

---

## §2 Intervention delta

### Metadata

```yaml
base:
  strategy_flags: OFF
delta:
  evidence_to_patch_binding: true   # MOGU_EVIDENCE_PATCH_BIND=1
```

### Pipeline（冻结）

```text
verify failure
      ↓
Evidence Object (system-extracted; machine id)
      ↓
BINDING block (tool: record_patch_binding)
      ↓
apply_patch
```

**禁止：**

* 隐式读取状态当 binding  
* 自由文本解释代替 binding  
* 无 binding fallback（走旧路径 apply）

### §2.1 Evidence Object（系统抽取）

```yaml
evidence_id: "ev_{run}_{cycle}"     # opaque; model cannot invent
failed_stage: string                # from verify
error_class: string                 # coarse classifier tag
anchors:
  symbols: string[]                 # test names / traceback funcs
  files: string[]                   # workspace-relative paths
  file_lines: string[]              # path:line
  assertion_snips: string[]
source_fingerprint: hash
```

### §2.2 PatchBinding（显式 token · 客观校验）

Tool：`record_patch_binding`（BINDING block）。字段：

| Field | Required |
|-------|----------|
| `evidence_id` | ∈ open_evidence_set |
| `failed_stage` | match that evidence |
| `error_class` | match that evidence |
| `intended_locus` | non-empty path-shaped（file / file:line / file::symbol） |
| `supersedes_prior` | 若本 run 已有 fail-后 apply：**非空**且规范化 ≠ 上一轮 |
| `dependency_edge` | optional：`caller` \| `callee` \| `import` \| `helper`（助 DB2 L3） |

```text
valid_binding ⇔ §2.2 字段客观通过
```

门闩仅在 **至少一次 verify fail 且 open_evidence_set 非空** 后生效。  
首轮失败前的 `apply_patch`：**不**强制 EPB。

### §2.3 无 Binding → 拒绝（无 fallback）

```text
missing binding
      ↓
BINDING_MISSING
      ↓
no apply_patch
```

| Code | 含义 | CT 读法 |
|------|------|---------|
| **BINDING_MISSING** | 模型没给 binding 就 apply | **机制未触发**（≠ 机制失败） |
| **BINDING_MALFORMED** | 给了但客观校验失败 | **机制未触发** |
| **BINDING_VALID** | 校验过，允许进入 apply | 可进入 DB1+ |

**禁止** malformed/missing 时静默走旧 apply 路径。

### §2.4 OUT OF SCOPE

| 规则 | 本 Spec |
|------|---------|
| 失败后必须再 `apply_patch` | **拒绝**（另开 Forced-Repair-Attempt） |

---

## §3 Baseline definition

| 对照 | 角色 |
|------|------|
| B1 同题官方 Fail | improvement 主锚 |
| Capability Probe | 叙事 only |
| D2/D2′/FB/FC 历史 | 禁止比例并排 |

---

## §4 Sample Gate（冻结规则 · Discovery 待关）

### 4.0 Primary（LOCKED）

```text
n = 5
Class-C
new instance (not burned by D2/D2′/FB/FC scoring)
real in-loop verify-fail capable
usable Fail baseline preferred
```

### 4.1 Hard exclude（LOCKED）

```text
django__django-13265
django__django-11019
django__django-15695
django__django-12497
django__django-15781      # Discovery / smoke only — NOT CT scoring
```

### 4.2 Fallback

若 Discovery 预算耗尽仍 <5：  
→ Option F **不得**自动塞回熟脸三题（已 hard-exclude）。  
→ 停 CT / 扩 Discovery / 或降级声明后另批；**禁止**静默用 Option F 熟脸。

### 4.3 15781

```text
role: Discovery / mechanism smoke only
not CT sample
```

scoring_set：**TBD** until Discovery closes（见 `SAMPLE_GATE.md`）。

---

## §5 Execution protocol

| 项 | 值 |
|----|-----|
| 模型 | gpt-5.5 |
| k | 3 |
| env | **仅** `MOGU_EVIDENCE_PATCH_BIND=1`；PACK/CONSUME/D2/DIVERSITY OFF |
| BoN / splice | 关 / 禁 |
| 官方分 | `--eval` |
| 落盘 | `evidence_patch_bind/`：evidence_*.json · binding_*.json · gate_rejects.jsonl |

Run ID：`ct-epb-…-c{1..3}-YYYYMMDD`  
产物：`controlled_trials/b2_evidence_to_patch/`  
Runner：`--smoke-only` / `--ct`；无 flag 拒绝。

```text
Spec Review PASS → Implementation → Smoke → Sample Gate close → CT
```

（实现与 Smoke 可先于 scoring_set 关闭；**CT 不得**在 Gate 未关时开跑。）

---

## §6 Judge rules（n=5 · LOCKED）

### 6.1 题级 improvement

```text
improvement ⇔ 官方 Resolved ≥ 2/3
```

### 6.2 试验级 Branch（Map E · n=5）

| Branch | 条件 |
|--------|------|
| **A** | ≥4/5 improvement |
| **B** | =3/5 |
| **C** | ≤2/5 |

```text
Branch != Mechanism
Branch A + DB0/DB2/DB4 weak = counting success only
```

### 6.3 regression_rate

`p2p_regression_signal` / (n×k)；升高则 Branch 解读降级。

---

## §7 Mechanism Attribution — DB0–DB4

| ID | 名称 | 判定 | 含义 |
|----|------|------|------|
| **DB0** | Binding Trigger Rate | `valid_binding_used_on_apply / gated_apply_attempts` | 是否进入 EPB（防 first-shot Branch A） |
| **DB1** | Binding declared | fail-后每次成功 apply 均有 **BINDING_VALID** | 门闩表层服从 |
| **DB2** | Evidence-to-change alignment | 见 §7.1 三级任一成立 | patch 对准证据区域（机械） |
| **DB3** | Supersede prior | 非首轮 fail-后 patch：`supersedes_prior` 非空且可区分 | 弃旧假设 |
| **DB4** | New bind chain | verify fail **之后** ≥1 次 BINDING_VALID + apply | 失败后再动手且绑证据 |

```text
最终机制结论：须看 DB0（触发）+ DB2 + DB4。
仅 DB1 / 低 DB0 = 形式或未进入；不可归因。
```

### §7.1 DB2 levels（机械 · 任一级 = pass）

```text
Level 1: target_symbol overlap
  intended_locus / patch 符号 ∩ evidence.anchors.symbols

Level 2: target_file overlap
  intended_locus 文件或实际 diff 文件 ∩ evidence.anchors.files

Level 3: dependency edge overlap
  intended/patch 文件 ≠ evidence 主文件
  AND dependency_edge ∈ {caller,callee,import,helper}
  AND (同父目录 OR 声明 related 命中 evidence 文件)
```

**禁止：** LLM judge；人工语义「看起来相关」。

### §7.2 联合读法

| Resolved Branch | DB0 / DB2∧DB4 | 读法 |
|-----------------|---------------|------|
| A/B | DB0 高 ∧ DB2∧DB4 | binding **可能**贡献 |
| A/B | DB0 低或仅 DB1 | **不可**归因（first-shot / 未触发） |
| C | DB2∧DB4 仍败 | 绑了仍不够修 |
| C | 大量 MISSING/MALFORMED | 机制未触发 / 先修服从 |

### §7.3 Artifacts

```text
evidence_patch_bind/
  evidence_{nn}.json
  binding_{nn}.json
  gate_rejects.jsonl
metrics.evidencePatchBind: {
  enabled, DB0, DB1, DB2, DB3, DB4,
  gated_apply_attempts, binding_missing, binding_malformed,
  binding_valid, second_apply_after_fail
}
```

---

## §8 Non-goals / Stop

- 不做大「Decision Binding」产品化  
- 不与 pack/consume 同开  
- Smoke 失败 → 停  
- Branch A + 弱 DB → Not Confirmed；不得 default-on  
- Sample Gate 未关 → 禁止 CT  

---

## §9 Open items — **CLOSED** (Spec Review 2026-07-22)

| # | Item | Resolution |
|---|------|------------|
| 1 | Tool 形态 | **显式** `record_patch_binding` → 再 `apply_patch`；禁止隐式/自由文本 |
| 2 | DB2 邻域 | **L1 symbol / L2 file / L3 dependency_edge**；任一级；不锁函数作用域 |
| 3 | n | **5**；Branch Map E |
| 4 | 15781 | Discovery/smoke only；**不进** scoring |
| 5 | abandon | v1 **不**提供 skip-apply abandon（防变量稀释）；步数耗尽即停 |
| 6 | 提示文案 | 仅 gate user 短讯（指纹 + 必填字段）；非长 reasoning scaffold |
| 7 | 错误码 | BINDING_MISSING / MALFORMED / VALID |
| 8 | DB0 | **加入** Binding Trigger Rate |
| 9 | fallback | **禁止** |

---

## §10 Change log

| Date | Change |
|------|--------|
| 2026-07-22 | Spec Draft |
| 2026-07-22 | Spec Review PASS：DB0–DB4、n=5、exclude 熟脸+15781、no fallback、错误码、DB2 三级；§9 closed |
