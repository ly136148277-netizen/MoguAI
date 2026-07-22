# 夜间停工存档 · 2026-07-21

> 用户指令：存档后关机。CT 可能被中断。

## 停工点

**B2-D2 Controlled Trial = Running（可能被本机关机打断）**

| 项 | 值 |
|----|-----|
| 规格 | `benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_d2/EXPERIMENT.md` |
| RESULTS 草稿 | `…/b2_d2/RESULTS.md`（§1–§5 骨架；跑完再填） |
| Smoke | Passed · `SMOKE_RESULTS.md`（不计入 Branch） |
| intervention | `MOGU_D2_STRUCTURED_RETRY=1` · hash `3ca4933b3ca2` |
| k | **固定 3**（禁止自动补 k→5） |
| 样本 | known 13265/12497 · blind 11019/15695 |
| 启动脚本 | `scripts/run_b2d2_ct.js` |
| 模型 | gpt-5.5 · manylisten |

## 明早接续

1. 检查 `benchmarks/swe-bench/runs/ct-b2d2-*` 哪些 c1/c2/c3 已完成（含 eval）。
2. **未完成的候选从断点重跑**（勿 splice 半截 run；缺哪个补哪个）。
3. 12 跑齐后按预注册填 `RESULTS.md` §1–§5 定 Branch；中途不解释。
4. 不回写 B1 / R_reg；不与 integrity_v1 合并。

## 链状态（关机前）

```
B1 / Error / Buckets / RootCause / integrity_v1 CT  → Archived
B2-D2 Smoke                                         → Passed
B2-D2 Formal CT                                     → Running (may interrupt)
D1 verify infra                                     → Candidate
D3                                                  → Deferred
R_reg                                               → 6/8 不动
```

## 关机

按用户 2026-07-21 夜间指令执行 `shutdown`。
