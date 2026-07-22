# B2-Feedback-B Controlled Trial — Failure Feedback Packaging (P1–P3)

```yaml
experiment_id: B2-FEEDBACK-B
aka: Feedback-B
experiment_type: repeatability
n_instances: 3                    # LOCKED — no clean 4th Class-C fail found
k_repeats: 3                      # LOCKED — no auto k→5
evidence_scope: instance
lifecycle_status: Archived · Branch A (counting) · mechanism NOT CONFIRMED · Next Design Pending
model: gpt-5.5
parent_chain: B2-D2 (C) → B2-D2′ (B counting / P7 inconclusive)
principles: ../OPENSOURCE_FAILURE_FEEDBACK_PRINCIPLES.md  # P1–P3
treatment_env: MOGU_FEEDBACK_PACK=1
forbidden:
  - MOGU_D2_STRUCTURED_RETRY=1
  - MOGU_D2_HYPOTHESIS_DIVERSITY=1
  - MOGU_GEN_HINT_PROFILE=integrity_v1
  - D1 verify-coverage expansion
```

> **Status:** Spec Review **PASS**（2026-07-22）。进入 Implementation → Smoke；**CT 须 smoke PASS 后再开**。  
> **边界声明：** Feedback-B tests **information presentation quality**, not **information availability**.  
> （测试的是反馈**呈现**质量，不测试是否增加新的验证能力 / verify 覆盖。）

---

## §1 Hypothesis

> 在 **MOGU + gpt-5.5 + Class-C（真实 in-loop verify）** 上，把失败回灌从裸日志切片改为 **结构化 Feedback Pack（P1–P3）**，能否提升官方 Resolved，且机制上是否改变「读反馈 → 新假设 / 新定位」？

```text
Feedback-B = feedback packaging quality
≠ retry | diversity | verify coverage | prompt goal rewrite
```

```text
Feedback-B tests information presentation quality,
not information availability.
```

证据边界：本栈 + 本计分三题；不推广「一切 agent 需要打包反馈」。  
与 D2（1/4）/ D2′（2/4）横向对比时须标注：**样本池重叠但 n 不同（3 vs 4）**，禁止把 improvement 比例直接并排比大小。

---

## §2 Intervention delta

### Baseline（锚；不并行 control 臂）

```text
failure → 现有裸/硬 slice 回灌 → soft 续环
D2 retry OFF · diversity OFF · integrity OFF
```

### Treatment（唯一自变量）

```text
failure → Feedback Pack:
  P1  机器可读：ok / failedStage|returncode / failure_class
  P2  长输出双端 + 明示 elide；可选全文落盘路径
  P3  分模板：测试失败 / 动作错误 / 基建失败
→ soft 续环（同 baseline 预算与门闩政策）
D2 retry OFF · diversity OFF · integrity OFF
```

| 可改 | 不可改 |
|------|--------|
| 回灌格式 / 摘要 / 分类标签 / 落盘提示 | retry 次数与 D2 门闩、diversity、verify 覆盖、题面/目标策略 prompt |

---

## §3 Baseline definition

| 对照 | 角色 |
|------|------|
| B1 同题官方 Fail | improvement 锚 |
| 本 CT treatment Resolved@k | 主数字 |
| D2 / D2′ 同题历史 | 叙事对照 only（干预不同） |

---

## §4 Sample selection

### 4.1 第 4 题搜寻（冻结记录）

曾寻找 **+1 blind verify-backed failure**，硬性条件：

1. 真实 in-loop verify（Class C / 非 `NO_VERIFY`）  
2. 存在 failure signal（非空转 env soft-skip）  
3. 非 `django-12497`  
4. 非本干预制造的数据；且 **不宜**已深度占用的 CT/R1/R2/integrity 历史题（如 14182/14365）

**结果：** B1 django Fail 仅四题（含 12497）；非 django Unresolved 为 Class A（无 stage）；Error 桶为镜像基建、非语义 Fail；lite8 未解题历史污染重。  
→ **无合格第 4 题。**

### 4.2 锁定样本量（禁止事后改）

```text
sample_size = 3
scoring_set = {13265, 11019, 15695}
excluded_from_scoring = {12497}   # 不跑
branch_threshold = pre-registered in §6.4 (n=3 map)
```

**禁止**开跑后把阈值从「按 4 题」临时改成「按 3 题」或反向。

### 4.3 Scoring set

| instance | 角色标签 | B1 | 备注 |
|----------|----------|----|------|
| `django__django-13265` | reuse-pool | Fail | Class C |
| `django__django-11019` | reuse-pool | Fail | Class C；D2′ 门闩生效仍 0/3 |
| `django__django-15695` | reuse-pool | Fail | Class C |

报告用语：**reuse-pool / held-out from this intervention design** — **禁止** blind validation。

---

## §5 Execution protocol

| 项 | 值 |
|----|-----|
| 模型 | gpt-5.5 |
| k | 3 固定 |
| 环境 | `MOGU_FEEDBACK_PACK=1`；D2/D2′/integrity **关** |
| BoN / splice | 关 / 禁 |
| 官方分 | 每候选 `--eval` |

Run ID：`ct-fb-django{13265|11019|15695}-c{1..3}-YYYYMMDD`  
产物：`controlled_trials/b2_feedback_b/`  
Runner（实现阶段）：须 `--smoke-only` / `--ct`，无 flag 拒绝。

---

## §6 Judge rules

### 6.1 题级 improvement

```text
improvement ⇔ 官方 Resolved ≥ 2/3
```

相对 B1 同题 Fail；禁止补 k→5；禁止 `engine ok` 当 Resolved。

### 6.2 试验级 Branch（**n=3 专用映射 — 已预注册**）

```text
improvement_rate = count(scoring improvement) / 3
```

| Branch | 条件 | 允许读法 | 禁止读法 |
|--------|------|----------|----------|
| **A** | ≥2/3 | 当前打包设计可能有效（instance） | 已升 pattern；可进默认环；P7 已证实 |
| **B** | 恰好 1/3 | 弱信号 | 「策略已证实」 |
| **C** | 0/3 | 当前打包设计可能不足 | H-info 整体作废；**自动**转 D1/LSP |

> 若未来另开 n=4 规格，必须 **新文件重冻** A≥3/4 · B=2/4 · C≤1/4；**不得**改写本文件数字事后套用。

### 6.3 regression_rate

`p2p_regression_signal` 跑次 / 12（定义同 D2′）。升高则 Branch 解读降级。

---

## §7 Mechanism Attribution（强制；不定主 Branch）

> 教训（D2′）：**结果改善 ≠ intervention 生效**（12497 零 diversity 周期仍 3/3）。  
> Feedback-B **必须**同级诊断，禁止只报 Resolved。

### 7.1 必采字段（实现须写入 metrics / artifacts）

| ID | 字段 | 来源 | 通过含义 |
|----|------|------|----------|
| M1 | `feedbackPack.enabled` | metrics | 打包开关落地 |
| M2 | `feedbackPack.has_status_prefix` | 解析回灌 / metrics | P1 机器可读行存在 |
| M3 | `feedbackPack.has_elide_marker` 或 `head_tail` | 回灌文本 | P2 双端策略可见 |
| M4 | `feedbackPack.failure_class` | 分类标签 | P3 分类非空（测试/动作/基建） |
| M5 | `feedbackPack.full_log_path`（若落盘） | artifact | 可回读入口 |
| M6 | `toolsUsed` 含对落盘路径的 `read` | tools / trace | **模型是否实际读取**全文 |
| M7 | `hypothesis_cites_feedback` | 下一轮 `set_plan` 文本 vs 失败字段 | 假设是否引用 failedStage/assert/class |
| M8 | `hypothesis_text_changed` | 相邻 plan 规范化文本 | 下一轮假设是否变化 |
| M9 | `jaccard_patch(t,t-1)` / `file_set_changed` | cycle 或相邻 apply | 是否减少同类重复路径 |
| M10 | `stack_anchor` / 定位文件是否变化 | trace | 是否产生新有效定位 |

Artifacts 建议（与 D2′ 对齐精神）：

```text
feedback_pack/
  last_verify.txt          # 模型可见回灌原文
  full_log.txt             # 可选全文
  meta.json                # M1–M5 结构化
```

### 7.2 机制 × Resolved 联合读法（RESULTS 强制表）

| Resolved Branch | 机制（M6–M10） | 读法 |
|-----------------|----------------|------|
| A/B | 引用反馈 + 假设/路径有变 | 打包可能贡献 |
| A/B | 机制全无变化 | **不可**归因打包（疑似方差/易题） |
| C | 打包落地且被读取仍败 | 当前设计不足以驱动修复 |
| C | 打包未落地 / 未见读取 | 先修实现服从，再谈假说 |

### 7.3 失败解释边界

负结果 **只否定当前 Feedback Pack 设计/实现**。

**禁止**预注册自动跳转：

> Feedback-B 失败 ⇒ 三路径否证 ⇒ 转 D1/LSP

须先完成 §7 诊断，再**另开**决策是否改打包或开基建轨。

---

## §8 明确不做

- 不改 D2 / D2′ / B1 / R_reg 归档  
- 不计 12497  
- 不并默认环（除非后续另决策）  
- 不在 Pending Review 通过前实现/开跑  

---

## §9 开跑检查清单

### Spec review

- [x] 单变量 = P1–P3 only  
- [x] n=3 锁定 + 第 4 题搜寻失败记录  
- [x] n=3 Branch 映射预注册（非临时转换）  
- [x] §7 机制字段可操作（M1–M10）  
- [x] 边界声明：presentation ≠ availability  
- [x] **Spec Review PASS**（三方）  

### 实现 / Smoke（当前）

- [x] `MOGU_FEEDBACK_PACK` 实现 + 单测  
- [x] artifacts / metrics 含 M1–M10  
- [x] smoke（机制 only；不计 Branch）→ `SMOKE_RESULTS.md`  
- [x] runner `--smoke-only` / `--ct`  
- [ ] 三题镜像预拉（CT 前）  
- [ ] `metadata.yaml` → Queued / Running（仅 CT）  

---

## §10 相邻工作

```text
D2 / D2′     → Archived
Feedback-B   → Spec Review PASS · Implementation / Smoke
CT           → 仅 smoke PASS 后
D1 / LSP     → 单列；不由本 CT 自动触发
```
