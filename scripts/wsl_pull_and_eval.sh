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

IDS=$(python - <<'PY'
import json
from pathlib import Path
p=Path("/mnt/d/Project/ai-model-manager/benchmarks/swe-bench/runs/lite8-manylisten-merged/predictions.jsonl")
for line in p.read_text(encoding="utf-8").splitlines():
    if line.strip():
        print(json.loads(line)["instance_id"])
PY
)

echo "[pull] resolving image names..."
python - <<PY
from swebench.harness.utils import load_swebench_dataset
from swebench.harness.test_spec.test_spec import make_test_spec
ids = """$IDS""".strip().split()
ds = {x["instance_id"]: x for x in load_swebench_dataset("princeton-nlp/SWE-bench_Lite", "test")}
for i in ids:
    spec = make_test_spec(ds[i], namespace="swebench")
    print(spec.instance_image_key)
PY

echo "[pull] pulling images..."
while read -r img; do
  [[ -z "$img" ]] && continue
  echo ">>> docker pull $img"
  docker pull "$img"
done < <(python - <<PY
from swebench.harness.utils import load_swebench_dataset
from swebench.harness.test_spec.test_spec import make_test_spec
ids = """$IDS""".strip().split()
ds = {x["instance_id"]: x for x in load_swebench_dataset("princeton-nlp/SWE-bench_Lite", "test")}
for i in ids:
    spec = make_test_spec(ds[i], namespace="swebench")
    print(spec.instance_image_key)
PY
)

echo "[eval] starting..."
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path "$PRED" \
  --max_workers 1 \
  --namespace swebench \
  --run_id "$RUN_ID" \
  2>&1 | tee "$OUT_DIR/eval.log"

echo "[eval] DONE"
