# B2-Feedback-Consumption Controlled Trial — RESULTS

```yaml
lifecycle_status: Archived
experiment_id: B2-FEEDBACK-CONSUMPTION
aka: Feedback-Consumption · FC
date_completed: 2026-07-22
sample_option: F                      # D+ Discovery exhausted → F
evidence_scope: instance (reused)
threat: prior exposure
final_branch: B                       # counting only (n=3 Map F)
mechanism_attribution: NOT CONFIRMED
default_integration: NO
```

> R=Resolved · U=Unresolved · ∅=empty · E=Error  
> **within-experiment only** — 禁止跨 CT 排名。  
> Positive ≠ default-on。  
> 机制权威：**最终 attempt 的 metrics + toolsUsed**（磁盘 `consume_*.json` 可能含 instance-retry 残留，见 §7）。

---

## §1 Metadata

| 项 | 值 |
|----|-----|
| base | `MOGU_FEEDBACK_PACK=1` |
| delta | `MOGU_FEEDBACK_CONSUME=1` |
| off | D2 · D2′ · integrity |
| n / k | **3** / **3** |
| scoring | 13265 · 11019 · 15695（排除 12497） |
| Discovery | budget 12/12 · 合格 0 → F（`DISCOVERY.md`） |
| smoke | PASS（`SMOKE_RESULTS.md`） |
| aggregate | `aggregate.json` |

Process：9/9 gen+eval 齐。13265×3 在本次 runner 启动时已是 complete（同日更早 FC 跑次，flags 正确：pack+consume、D2 off）→ SKIP 复用，未重跑。

---

## §2 原始逐轮表

| instance | role | c1 | c2 | c3 | Resolved/k | improvement（≥2/3） |
|----------|------|----|----|----|------------|---------------------|
| `django__django-13265` | reuse-pool | **R** | **U** | **R** | **2/3** | **yes** |
| `django__django-11019` | reuse-pool | **U** | **U** | **U** | **0/3** | no |
| `django__django-15695` | reuse-pool | **E** | **U** | **R** | **1/3** | no |

题级 improvement 计数：**1 / 3**

### Run IDs

`ct-fc-django{13265\|11019\|15695}-c{1..3}-20260722`

---

## §3 Branch（Map F · n=3）

```text
improvement_rate = 1/3
Map F: A ≥2/3 · B =1/3 · C =0/3
→ Branch B
```

| 允许 | 禁止 |
|------|------|
| within-experiment 弱信号 | 默认开启；跨 CT 比 Feedback-B/D2′；机制已证实 |

`p2p_regression_signal`：**0/9**

---

## §7 Mechanism Attribution（强制）

### 7.0 读数纪律

```text
复述存在 ≠ 反馈被消费
C1/C2 ≠ C3/C4
Resolved ∧ ¬gateTriggered ≠ FC 机制证据
```

最终 attempt 判定：

| 信号 | 定义 |
|------|------|
| gateTriggered | `validCount>0` 或 toolsUsed 含 `record_failure_consumption` |
| firstShotNoConsume | （R 或 verifyOk）且无 consume 调用且 `run_tests≤1` |
| C1–C4 | 来自 **metrics.feedbackConsume**（非磁盘残留） |

### 7.1 试验合计（metrics-first）

| 指标 | 合计 |
|------|------|
| pack enabled | 9/9 |
| consume enabled | 9/9 |
| gateTriggered | **6/9** |
| firstShotNoConsume | **3/9**（全为 13265×3） |
| C1 | 6/9 |
| C2 | 6/9 |
| C3 | **3/9** |
| C4 | **3/9** |

### 7.2 逐轮 C1–C4

| run | cell | gate | 1st-shot¬consume | validCount | C1 | C2 | C3 | C4 | 备注 |
|-----|------|------|------------------|------------|----|----|----|----|------|
| 13265-c1 | **R** | no | **yes** | 0 | — | — | — | — | apply→单次 run_tests 成功；磁盘 consume 为 retry 残留 |
| 13265-c2 | U | no | yes* | 0 | — | — | — | — | 同：无 consume 调用；*engine verifyOk 但官方 U |
| 13265-c3 | **R** | no | **yes** | 0 | — | — | — | — | 同 c1 |
| 11019-c1 | U | yes | no | 5 | ✓ | ✓ | ✓ | ✓ | 门闩深触发仍未解 |
| 11019-c2 | U | yes | no | 4 | ✓ | ✓ | — | ✓ | C3 未过 |
| 11019-c3 | U | yes | no | 5 | ✓ | ✓ | ✓ | ✓ | 门闩深触发仍未解 |
| 15695-c1 | E | yes | no | 2 | ✓ | ✓ | ✓ | — | harness Error |
| 15695-c2 | U | yes | no | 1 | ✓ | ✓ | — | — | |
| 15695-c3 | **R** | yes | no | 2 | ✓ | ✓ | — | — | **唯一「有门闩的 R」；停在 C1/C2** |

\*13265-c2：`firstShotNoConsume` 因 `verifyOk===true` 且无 consume。

### 7.3 唯一 improvement 题（13265）— 重点核查

```text
improvement = yes (2/3)
但 gate_triggered_among_R = 0/2
C3∧C4 among R = 0/2
first_shot_R_no_consume = 2/2
```

toolsUsed 模式（两道 R）：

```text
… → apply_patch → run_tests(一次成功)
record_failure_consumption 调用次数 = 0
```

磁盘上虽有 `consume_01.json`，与 metrics/`toolsUsed` 矛盾 → **判定为 instance-retry 残留**，不得计入机制。

**结论（13265）：计分改善存在，但不是 Feedback-Consumption 机制证据。**  
与 Feedback-B / D2′ 的「结果好看 ≠ intervention 生效」同构（12497 型风险在熟脸池上重演）。

### 7.4 联合读法

| Resolved Branch | C3/C4 on improvements | 读法 |
|-----------------|----------------------|------|
| **B** | **无**（improvement 题 R 全无门闩） | **不可**归因 forced consumption |
| — | 11019：C3/C4 常见仍 0/3 | 消费触发 ≠ 修得过 |
| — | 15695-c3：R 有 C1/C2 无 C3/C4 | 形式绑定未升到决策层 |

```text
Mechanism attribution: NOT CONFIRMED
Branch B = counting weak signal only
```

---

## §8 归档边界

1. Option F + prior exposure：证据强度已降级。  
2. 不得默认开启 `MOGU_FEEDBACK_CONSUME`。  
3. 不得与 Feedback-B Branch A / D2′ Branch B 横向比大小。  
4. 实现层门闩在 11019/15695 上可触发；**计分唯一 improvement 未走门闩**。

```text
Feedback-Consumption → Archived · Branch B (counting) · mechanism NOT CONFIRMED
```
