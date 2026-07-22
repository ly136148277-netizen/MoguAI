# Capability-Boundary Probe — Before Decision Binding

```yaml
status: Complete
parent: CROSS_EXPERIMENT_SYNTHESIS.md
date: 2026-07-22
k: 3
intervention: NONE (baseline)
eval: optional / off for mechanism focus
results: RESULTS.md
```

## Question

> 熟脸三题上「不利用失败反馈」是题特异天花板，还是更广的行为模式？

## Honest sample constraint

B1 语义 Unresolved 中，**除 django-4 外均为 Class A**（`NO_VERIFY`）——环内**没有**真实测试失败可「利用」。  
因此探针必须拆两格：

| Slot | Instance | Class | Role |
|------|----------|-------|------|
| A | `sympy__sympy-13177` | A | 对照：确认无 in-loop fail feedback（利用问题 N/A） |
| C | `django__django-15781` | C (in B1-50 cache) | **主探针**：未进 D2/D2′/FB/FC；B1 官方 Pass，但可观察 in-loop fail→续环行为 |

`15781`：B1 为 Pass（非 Fail 锚），本探针**不**谈 improvement；只谈「若出现真实 verify fail，后续是否续环/改定位」。  
（`10914` 不在当前 50-task 缓存 → 改用缓存内未进反馈链的 django。）

## Baseline env

```text
MOGU_FEEDBACK_PACK=0
MOGU_FEEDBACK_CONSUME=0
MOGU_D2_STRUCTURED_RETRY=0
MOGU_D2_HYPOTHESIS_DIVERSITY=0
MOGU_GEN_HINT_PROFILE=
```

## What we score（mechanism only · Branch N/A）

| Signal | Class A expect | Class C interesting if… |
|--------|----------------|-------------------------|
| `run_tests` → NO_VERIFY | yes | — |
| after real verify fail: further `set_plan` / `apply_patch` | n/a | yes = loop continues |
| `stackAnchorUsed` / `findRefsUsed` | n/a | often true on this stack |
| soft: later behavior changes file set / lowers jaccard vs prior fail | n/a | yes = weak “uses fail” |
| soft: zero retry after fail (stop or flail same file high Jaccard) | n/a | same pattern as familiar faces |

**不**报 Branch；**不**与 D2/FB/FC 比例并排。

## Run IDs

`probe-cap-{sympy13177|django15781}-c{1..3}-20260722`
