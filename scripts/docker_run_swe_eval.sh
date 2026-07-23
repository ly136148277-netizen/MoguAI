#!/usr/bin/env bash
set -euo pipefail
pip install -q -U pip swebench
cd /work/benchmarks/swe-bench/runs/lite8-manylisten-merged
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path /work/benchmarks/swe-bench/runs/lite8-manylisten-merged/predictions.jsonl \
  --max_workers 1 \
  --namespace swebench \
  --run_id lite8-manylisten-merged \
  2>&1 | tee /work/benchmarks/swe-bench/runs/lite8-manylisten-merged/eval.log
echo DONE
