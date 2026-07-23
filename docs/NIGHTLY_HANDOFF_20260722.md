# Nightly Handoff — 2026-07-22

```yaml
date: 2026-07-22
branch: develop/v2.0
model: gpt-5.5
shutdown: requested after archive
```

## 一句话

反馈策略链已 Archived；能力边界探针 Complete；**EPB Spec Review PASS + 实现已合入 + 单元 PASS**；live smoke（15781）关机时仍在跑/未出最终 judge；**Sample Gate OPEN → CT 禁止**。

## 已完成证据链

| 项 | 状态 |
|----|------|
| D2 / D2′ / Feedback-B / Feedback-Consumption | Archived（Branch ≠ Mechanism） |
| `CROSS_EXPERIMENT_SYNTHESIS.md` | Complete |
| Capability probe | Complete：Slot C 再 apply=0/3 → 广谱缺口 |
| EPB Spec | Review PASS；§9 CLOSED |
| EPB 实现 | `coding-evidence-patch-bind.js` + loop/tools/handlers/bench 接线 |
| EPB 单元 | `tests/coding-evidence-patch-bind.test.js` **4/4 PASS** |
| EPB live smoke | `ct-epb-smoke-django15781-20260722` — 关机中断；**2026-07-23 晨已重跑** |
| Sample Gate | **OPEN**；n=5；排除熟脸+15781 |

## 冻结口径（勿改）

```text
MOGU_EVIDENCE_PATCH_BIND=1
PACK/CONSUME/D2/DIVERSITY = 0
record_patch_binding → apply_patch
BINDING_MISSING | MALFORMED | VALID
DB0–DB4 · Branch Map E (A≥4/5 B=3/5 C≤2/5)
Branch != Mechanism
CT blocked until SAMPLE_GATE CLOSED
```

## 开机后第一步

1. 读本文件 + `EVIDENCE_TO_PATCH_BINDING_SPEC.md`
2. 重跑或续：`node scripts/run_b2_evidence_patch_bind_ct.js --smoke-only`
3. Smoke PASS 后：执行 Sample Discovery → 关 `SAMPLE_GATE.md`（n=5）
4. 再 `--ct`（Gate 未关会 exit 3）

## 权威路径

- Spec：`benchmarks/.../controlled_trials/b2_evidence_to_patch/EXPERIMENT.md`
- Gate：`.../b2_evidence_to_patch/SAMPLE_GATE.md`
- 综合：`.../controlled_trials/CROSS_EXPERIMENT_SYNTHESIS.md`
- 探针：`.../capability_boundary_probe/RESULTS.md`
- Backlog：`docs/RESEARCH_BACKLOG_POST_S3.md`

## 明确不做

- 不在熟脸三题上再堆 packaging/consume/retry
- 不把 forced-second-apply 并进 EPB
- Gate 未关不开 CT；Branch A 不 default-on
