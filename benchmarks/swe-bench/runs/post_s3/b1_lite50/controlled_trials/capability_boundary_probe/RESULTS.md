# Capability-Boundary Probe — RESULTS

```yaml
status: Complete
branch: N/A
intervention: none (baseline)
date: 20260722
eval_focus: mechanism / behavior only (not Branch, not improvement)
```

> 目的：判断熟脸三题上的「不利用失败反馈」是否可外推。**非 CT Branch。**

## Slot A — Class A (`sympy-13177`)

| c | engineOk | verify | stages | run_tests | plan/apply after 1st RT | tools |
|---|----------|--------|--------|-----------|-------------------------|-------|
| 1 | true | ok=null skip=true | ∅ | 1 | plan=false apply=false 2ndRT=false | `grep>grep>read>set_plan>apply_patch>read>grep>run_tests` |
| 2 | true | ok=null skip=true | ∅ | 1 | plan=false apply=false 2ndRT=false | `grep>grep>read>set_plan>apply_patch>git_diff>run_tests` |
| 3 | true | ok=null skip=true | ∅ | 1 | plan=false apply=false 2ndRT=false | `grep>grep>set_plan>read>apply_patch>git_diff>run_tests` |

**Reading：** 3/3 `verifySkipped` + 单次 `set_plan → apply_patch → run_tests`，无失败后续环。  
→ Class A 上「是否利用失败信息」**不可测**（与 PROBE 诚实约束一致）。B1 语义 Unresolved 里多数非 django 同此。

## Slot C — Class C-capable (`django-15781`)

未进 D2 / D2′ / Feedback-B / Feedback-Consumption。B1 官方为 Pass；本探针只观察 baseline 失败后续行为，**不**谈 improvement / 回归。

| c | engineOk | verifyOk | f2p | stack/refs | after 1st RT: plan / apply / 2ndRT | tools |
|---|----------|----------|-----|------------|-------------------------------------|-------|
| 1 | false | false | false | sa=true fr=true | **false / false / true** | `…apply_patch>run_tests>git_diff>grep>read>run_tests` |
| 2 | false | false | false | sa=true fr=true | **true / false / true** | `…run_tests>grep>run_tests>set_plan>read>run_tests>…`（无第二 apply） |
| 3 | false | false | false | sa=true fr=true | **false / false / true** | `…apply_patch>run_tests>run_tests>git_diff>grep>read>run_tests>…` |

| Signal | Rate |
|--------|------|
| 续环（first `run_tests` 后再 `run_tests`） | **3/3** |
| 失败后再 `set_plan` | **1/3**（仅 c2） |
| 失败后再 `apply_patch` | **0/3** |

**Reading：** 新 Class-C 题上，baseline 会继续 grep/read/再跑测，但 **从不把失败转成第二次 patch**；最多一次 replan 仍不 apply。这与反馈链上「环能转、决策不因证据改绑」的结构同型——不是「熟脸三题独有的死题表象」。

## Verdict

```text
Fork answer (Co):
  更接近「广谱行为缺口」一侧，而非「仅熟脸天花板」。
  → Decision Binding Spec Draft 值得开（仍 Spec → Review → Smoke → CT）。
  → 不建议再在同一熟脸三题上堆 packaging / consume / retry。
```

### Caveats（必须保留）

1. **n=1** Class-C 实例 × k=3 — 外推力度薄；扩 Class-C 池或 D1 verify coverage 仍必要。
2. Slot A 证明：Unresolved 里随便抽非 django 题，**测不到**「用不用失败信息」。
3. 续环 / 再测 ≠ evidence-driven localization change；本探针以 **第二 apply=0/3** 为主判决。
4. `15781` B1 Pass vs 本批 3/3 Fail：只作行为观察，不作分数主张。

## Artifacts

- `aggregate.json`
- runs: `probe-cap-sympy13177-c{1..3}-20260722`, `probe-cap-django15781-c{1..3}-20260722`
