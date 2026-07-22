# B2-Feedback-B Controlled Trial — RESULTS

```yaml
lifecycle_status: Archived
experiment_id: B2-FEEDBACK-B
aka: Feedback-B
date_completed: 2026-07-22
final_branch: A                    # counting rule only (n=3 map)
mechanism_attribution: NOT CONFIRMED
default_integration: NO
boundary: presentation quality ≠ information availability
post_audit: DIAGNOSIS_M67_AUDIT.md  # M6/M7 false-negative check
next: Design Pending
```

> R=Resolved · U=Unresolved · ∅=empty patch · E=Error  
> **不**回写 B1 / R_reg / D2 / D2′。  
> 样本角色：**reuse-pool**（held-out from this intervention design；**禁止** blind validation）。  
> 与 D2（1/4）/ D2′（2/4）对照时须标注：**样本池重叠但 n=3 vs n=4**，禁止直接比 improvement 比例。

---

## §1 Metadata

| 项 | 值 |
|----|-----|
| experiment | Feedback-B failure feedback packaging（P1–P3 only） |
| model | gpt-5.5 |
| intervention | `MOGU_FEEDBACK_PACK=1` |
| forbidden | D2 retry · D2′ diversity · integrity · D1 verify expansion |
| k | **3（固定；未补 k→5）** |
| n | **3**（预注册；排除 12497） |
| scoring set | `13265`, `11019`, `15695` |
| excluded | `12497` |
| baseline | B1 Fail（同题） |
| smoke | Unit + live（11019）mechanism PASS；**不计** Branch |
| aggregate | `aggregate.json` |
| boundary | Feedback-B tests **presentation quality**, not **availability** |

---

## §2 原始逐轮表（c1–c3 × 3）

| instance | role | c1 | c2 | c3 | Resolved/k | improvement（≥2/3） |
|----------|------|----|----|----|------------|---------------------|
| `django__django-13265` | reuse-pool | **R** | **U** | **R** | **2/3** | **yes** |
| `django__django-11019` | reuse-pool | **U** | **U** | **U** | **0/3** | no |
| `django__django-15695` | reuse-pool | **R** | **R** | **R** | **3/3** | **yes** |

### Run IDs

| cell | runId |
|------|-------|
| 13265 c1–c3 | `ct-fb-django13265-c{1,2,3}-20260722` |
| 11019 c1–c3 | `ct-fb-django11019-c{1,2,3}-20260722` |
| 15695 c1–c3 | `ct-fb-django15695-c{1,2,3}-20260722` |

CT process：9/9 gen+official eval 齐；fails=0/9；无 key/quota 中断。

---

## §3 Instance-level Resolved@k 与对照

| instance | B1 | Feedback-B Resolved/k | improvement |
|----------|----|----------------------|-------------|
| 13265 | Fail | **2/3** | **yes** |
| 11019 | Fail | 0/3 | no |
| 15695 | Fail | **3/3** | **yes** |

题级 improvement 计数：**2 / 3**

叙事对照（**非**同规格对比；n 不同）：

| 试验 | n | improvement |
|------|---|-------------|
| D2 | 4 | 1/4 |
| D2′ | 4 | 2/4（counting；机制 inconclusive） |
| Feedback-B | **3** | **2/3** |

---

## §4 Branch（n=3 预注册映射）

```text
improvement_rate = 2/3
Branch rule: A ≥2/3 · B =1/3 · C =0/3
```

| Branch | 条件 | 本试验 |
|--------|------|--------|
| **A** | ≥2/3 | **命中** |
| B | =1/3 | — |
| C | 0/3 | — |

### regression_rate

`p2p_regression_signal`：**0/9**（未升高；不降级 Branch 读法）。

### Branch 允许 / 禁止读法（摘自规格）

| 允许 | 禁止 |
|------|------|
| 当前打包设计在 **instance 计分**上可能有效（counting） | 已升 pattern；可进默认环；P7 已证实 |
| | 因 Resolved 好看就归因「模型正确使用了反馈」——**须看 §7** |

---

## §5–§6 跨重复路径（辅助）

| instance | c1–c2 Jaccard | c1–c3 | c2–c3 | 文件集 |
|----------|---------------|-------|-------|--------|
| 13265 | 0.24 | 0.15 | 0.17 | **同文件**（autodetector.py） |
| 11019 | 0.04 | 0.44 | 0.03 | **同文件**（widgets.py） |
| 15695 | 0.12 | 0.33 | 0.06 | **同文件**（models.py） |

Within-run M9（失败后续 patch，metrics）：多轮仍见高 Jaccard（如 11019 c1≈0.86、c3≈0.96；13265 c2≈0.93）且 `file_set_changed=false`——与 smoke 软诊断同向。

---

## §7 Mechanism Attribution（强制）

> 规格联合读法：Resolved Branch A/B **且**机制全无变化 → **不可**归因打包（疑似方差 / 易题 / 他因）。

### 7.1 汇总（metrics 为准；不以磁盘 stale pack 覆盖）

| ID | 字段 | 试验合计 | 读法 |
|----|------|----------|------|
| M1 | `feedbackPack.enabled` | **9/9** | 开关落地 |
| — | `packCount>0`（本轮确实发出过 pack） | **8/9** | 13265-c1 为 first-shot R，无失败可打包 |
| M2 | `has_status_prefix` | 与 pack 发出轮次一致 | P1 前缀在发出时存在 |
| M3 | elide / head_tail | 多数短日志未触发 elide | P2 策略可用；非本试验失败点 |
| M4 | `failure_class` | 失败轮多为 `f2p_miss` | P3 分类非空 |
| M5 | `full_log_path` | 发出 pack 的轮次有路径 | 可回读入口存在 |
| **M6** | **read full log** | **0/9** | **模型从未 `read` 全文落盘** |
| **M7** | **hypothesis cites feedback** | **0/9** | **下一轮 plan 未引用 failedStage/class 等** |
| M8 | hypothesis text changed | **5/9** | 有文本变化，但未必来自反馈字段 |
| M9 | jaccard / file_set | 高 Jaccard + 同文件常见 | 路径锁定未因打包解除 |
| M10 | stack_anchor changed | 全 null / 未观测到变化 | 无新定位信号 |

D2 / D2′ 在全部 9 轮均为 **OFF**（单变量服从）。

### 7.2 按题

| instance | Resolved | pack 发出 | M6 | M7 | M8 | 联合读法 |
|----------|----------|-----------|----|----|-----|----------|
| 13265 | 2/3 yes | 2/3 轮（c1 无失败 pack） | 0/3 | 0/3 | 2/3 | **不可**把 improvement 归因于「利用打包反馈」 |
| 11019 | 0/3 no | 3/3 | 0/3 | 0/3 | 3/3 | 打包落地仍败；且未读/未引 |
| 15695 | 3/3 yes | 3/3（各 packCount=1） | 0/3 | 0/3 | 0/3 | **Resolved 全中但利用行为为零** → 疑似易题/方差，**非**打包利用证据 |

### 7.3 机制结论（老实记录）

```text
better feedback format exists  ≠  model uses feedback correctly
```

正式判定：

1. **Counting Branch = A**（2/3 improvement）——按预注册阈值成立。  
2. **Mechanism attribution = 不可归因于反馈利用行为**：M6=0/9、M7=0/9 贯穿全试验（与 smoke 软诊断一致）。  
3. 因此：**反馈打包本身没有改变模型的实际利用行为**（未读全文、未在假设中引用反馈字段）。  
4. Resolved 变好看 **不能**跳过本层诊断；联合读法下，A 只能读成「计分面可能有效 / 或他因」，**不能**读成「P1–P3 已被模型正确使用」。  
5. 负结果边界仍成立：本结论只否定「当前打包 → 利用行为」链路；**不**自动跳转 D1/LSP。

---

## §8 归档指针

| 文件 | 路径 |
|------|------|
| Spec | `EXPERIMENT.md` |
| Smoke | `SMOKE_RESULTS.md` |
| Aggregate | `aggregate.json` |
| Entry | `../FEEDBACK_B_EXPERIMENT.md` |

```text
Feedback-B → Archived · Branch A (counting) · mechanism NOT CONFIRMED
Default integration: NO
Next: Design Pending (interpretation / action binding — not more P1–P3)
```

M6/M7 假阴性审计：见 `DIAGNOSIS_M67_AUDIT.md`（正式谓词无假阴；消息通道可见 ≠ 利用）。
