# EPB Sample Gate

```yaml
status: OPEN · D1 expansion in progress (qualified_n5 = 0 until Fail baselines land)
n_target: 5
k: 3
branch_map: E   # A≥4/5 · B=3/5 · C≤2/5
d1_protocol: D1_EXPANSION_PROTOCOL.md
d1_frame: D1_EXPANSION_FRAME.json
prior_shortfall: SHORTFALL.md  # archive discovery; superseded by one-shot D1
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
inspected: 15
budget: 15
qualified_n5: 0
discovery_log: DISCOVERY.md
outcome: SHORTFALL — B1 Fail Class-C exhausted by hard exclude; A0 Fail Class-C (3 astropy) heavily burned by R1/R2/phase; Class-A Fail pool must not be invented as Class-C
```

## CT readiness

```text
CT blocked until scoring_set length == 5 and this file status: CLOSED
```
