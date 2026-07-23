# Cross-Experiment Synthesis — Failure Feedback → Decision (Post-S3)

```yaml
date: 2026-07-22
status: Complete
scope: Integrity_v1 → D2 → D2′ → Feedback-B → Feedback-Consumption
purpose: 把分散 RESULTS 收成一条排除链；冻结「下一刀砍哪里」的判断前提
```

---

## 1. 一句话

四次策略干预都出现同一结构：

```text
实现层落地 ✅
计数偶有改善 △
机制归因（模型真用了干预） ❌ / Not Confirmed
```

共同指向：瓶颈不在「再多给一点循环 / 包装 / 强制复述」，而在 **evidence → localization → repair decision** 是否发生。

---

## 2. 逐实验归档（counting vs mechanism）

| 实验 | 变量 | Counting | Mechanism |
|------|------|----------|-----------|
| **D2** | 强制 structured retry | **C** (1/4) | retry 触发 ≠ 有用（H-mech 不足） |
| **D2′** | hypothesis diversity | **B** (2/4) | mixed；**12497** 零 diversity 周期仍 3/3 |
| **Feedback-B** | P1–P3 packaging | **A** (2/3, n=3) | **M6=0/9 · M7=0/9**；呈现 ≠ 使用 |
| **Feedback-Consumption** | 强制消费门闩 | **B** (1/3, F) | 唯一 improvement **13265** 两道 R 均为 **first-shot / 无 consume 调用** |

权威指针：

- `b2_d2/` · `b2_d2_prime/` · `b2_feedback_b/` · `b2_feedback_consumption/`

纪律重申：

```text
Branch ≠ Mechanism proof
Resolved ≠ intervention worked
```

---

## 3. 递进诊断链（排除法本身是证据）

```text
失败发生
  ↓
反馈产生              ✅  (Class-C in-loop verify 上已成立)
  ↓
反馈展示              ✅  Feedback-B（pack 落地）
  ↓
模型读取全文/引用     ❌  M6/M7 = 0/9
  ↓
强制复述/绑定门闩     △  FC：门闩可触发（11019），但
  ↓                      唯一计分改善未走门闩（13265 first-shot）
模型因证据改定位/决策 ❌  未证实
  ↓
有效 patch            △  偶发 Resolved，不可归因策略
```

因此当前**不建议**继续堆：

- 更多 retry
- 更多 diversity  alone
- 更多 presentation polish
- 在同一熟脸三题上再加一层「强制读」而不先验样本外推

---

## 4. 熟脸样本威胁（prior exposure）

反复使用：`13265 / 11019 / 15695`（±`12497`）

| 风险 | 表现 |
|------|------|
| 零门闩改善 | 12497（D2′）；13265 FC first-shot R |
| 门闩深触发仍败 | 11019（FC C3/C4 常见，0/3） |
| Familiar-face | FC 已 Option F 降级声明 |

**曾开放（Co）：** 熟脸是否只是「能力边界内死题」？
→ **探针已答（§5）：** 新 Class-C `django-15781` baseline 上再 apply 仍 0/3，更偏广谱缺口，非仅熟脸天花板。

---

## 5. 能力边界探针（已完成）→ 下一刀

权威：`capability_boundary_probe/RESULTS.md`

| Slot | Instance | 结论 |
|------|----------|------|
| A | `sympy-13177` | Class A：3/3 `NO_VERIFY`；利用问题 **N/A** |
| C | `django-15781`（未进前四轮 CT） | 失败后续环 3/3；再 `set_plan` 1/3；**再 `apply_patch` 0/3** |

**Fork 落点：** 更接近「广谱：失败信息不转化为新定位/新 patch」，而非「仅熟脸死题」。
→ **EPB Spec Draft 已开**（`EVIDENCE_TO_PATCH_BINDING_SPEC.md`；窄变量 Evidence→Patch Binding）。
→ **不**再在熟脸三题上堆 packaging / consume / retry；**不**把「失败后必须再 apply」并进本 Spec。
→ Caveat：Class-C 仅 n=1；扩池 / D1 仍必要；**Sample Gate 未关**。

**禁止：** 无 Spec Review / Sample Gate 就实现或开 CT；Branch 字母不得默认开 flag。

---

## 6. 与产品化

策略轨与产品化轨继续分列。
本综合报告 **不**授权默认开启 D2 / diversity / pack / consume。

---

## 7. 状态板

```text
Integrity_v1 / D2 / D2′ / Feedback-B / Feedback-Consumption
→ 策略链 Archived（各见 RESULTS）

Capability-boundary probe → Complete
  Slot A: utilization N/A (Class A)
  Slot C: post-fail second apply = 0/3 → broad pattern

Next gate:
  EPB — Smoke PASS (2026-07-23) · Sample Gate SHORTFALL (qualified_n5=0)
  → Exit B frozen · CT blocked
  → need D1 Class-C Fail pool (or Spec re-n) before Gate CLOSED → CT
  Freeze: b2_evidence_to_patch/SHORTFALL.md
  Gate:   b2_evidence_to_patch/SAMPLE_GATE.md (OPEN)
```
