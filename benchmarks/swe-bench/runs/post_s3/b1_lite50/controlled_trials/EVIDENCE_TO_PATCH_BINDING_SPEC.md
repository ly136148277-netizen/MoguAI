# Evidence-to-Patch Binding — Entry

```yaml
status: Spec Review PASS · Implementation in progress
experiment_id: B2-EVIDENCE-TO-PATCH-BINDING
aka: EPB
n: 5
k: 3
sample_gate: open (Discovery pending before CT)
default_integration: NO
```

→ 规格：[`b2_evidence_to_patch/EXPERIMENT.md`](./b2_evidence_to_patch/EXPERIMENT.md)  
→ 样本闸：[`b2_evidence_to_patch/SAMPLE_GATE.md`](./b2_evidence_to_patch/SAMPLE_GATE.md)

### 冻结要点

```text
verify fail → Evidence Object → record_patch_binding → apply_patch
no fallback · BINDING_MISSING|MALFORMED|VALID
DB0–DB4 · Branch Map E (A≥4/5 B=3/5 C≤2/5)
Branch != Mechanism
exclude: 13265,11019,15695,12497,15781(scoring)
```
