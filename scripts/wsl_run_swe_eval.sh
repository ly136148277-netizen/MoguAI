#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
# shellcheck disable=SC1091
source "$HOME/mogu-swebench/bin/activate"

ROOT="/mnt/d/Project/ai-model-manager"
PRED="$ROOT/benchmarks/swe-bench/runs/lite8-manylisten-merged/predictions.jsonl"
OUT_DIR="$ROOT/benchmarks/swe-bench/runs/lite8-manylisten-merged"
RUN_ID="lite8-manylisten-merged"
cd "$OUT_DIR"

echo "[eval] pred=$PRED"
python - <<'PY'
import json
from pathlib import Path
p = Path("/mnt/d/Project/ai-model-manager/benchmarks/swe-bench/runs/lite8-manylisten-merged/predictions.jsonl")
rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
print("instances", len(rows))
for r in rows:
    patch = r.get("model_patch") or ""
    print(r.get("instance_id"), "patch_bytes", len(patch.encode("utf-8")), "keys", sorted(r.keys()))
PY

# Official harness — first run pulls images (slow / large disk).
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path "$PRED" \
  --max_workers 1 \
  --run_id "$RUN_ID" \
  2>&1 | tee "$OUT_DIR/eval.log"

echo "[eval] DONE exit=$?"
