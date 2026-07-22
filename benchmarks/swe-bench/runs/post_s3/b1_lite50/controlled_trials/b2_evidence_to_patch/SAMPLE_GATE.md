# EPB Sample Gate

```yaml
status: OPEN · Discovery pending
n_target: 5
k: 3
branch_map: E   # A≥4/5 · B=3/5 · C≤2/5
```

## Rules (LOCKED by Spec Review)

**Include：** Class-C · new to this feedback-strategy chain · in-loop verify-fail capable · Fail baseline preferred.

**Hard exclude from scoring：**

```text
django__django-13265
django__django-11019
django__django-15695
django__django-12497
django__django-15781
```

`15781`：Discovery / smoke only.

**No familiar-face Option F** if Discovery fails — stop or expand Discovery; do not silently reuse excluded set.

## Scoring set

```yaml
scoring_set: TBD
discovered: []
inspected: 0
budget: TBD at Discovery kickoff
```

## CT readiness

```text
CT blocked until scoring_set length == 5 and this file status: CLOSED
```
