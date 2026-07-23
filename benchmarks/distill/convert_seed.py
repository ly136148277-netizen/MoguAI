#!/usr/bin/env python3
"""Convert public seed datasets (HumanEval / SWE-bench Lite) into tasks.json.

Only public sources. Rejects vendor-private labels.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

FORBIDDEN = re.compile(r"cursor|trae|vendor_private|proprietary", re.I)


def load_humaneval(limit: int) -> list[dict]:
    try:
        from datasets import load_dataset
    except ImportError as e:
        raise SystemExit("pip install datasets") from e

    ds = load_dataset("openai_humaneval", split="test")
    tasks = []
    for i, row in enumerate(ds):
        if i >= limit:
            break
        tasks.append(
            {
                "id": f"humaneval_{row['task_id'].replace('/', '_')}",
                "source": "humaneval_public",
                "difficulty": "medium",
                "category": "programming",
                "prompt": row["prompt"],
                "expected_output": row.get("canonical_solution") or "",
                "entry_point": row.get("entry_point"),
                "test": row.get("test"),
                "tags": ["humaneval", "public"],
            }
        )
    return tasks


def load_swebench(limit: int) -> list[dict]:
    try:
        from datasets import load_dataset
    except ImportError as e:
        raise SystemExit("pip install datasets") from e

    # Public lite set; no gold patch fed into teacher by default.
    ds = load_dataset("SWE-bench/SWE-bench_Lite", split="test")
    tasks = []
    for i, row in enumerate(ds):
        if i >= limit:
            break
        tasks.append(
            {
                "id": row["instance_id"],
                "source": "swebench_lite_public",
                "difficulty": "hard",
                "category": "software_engineering",
                "prompt": (
                    f"Repository: {row['repo']}\n\n"
                    f"Issue:\n{row['problem_statement']}\n\n"
                    "Write a minimal patch-style solution outline and key code changes."
                ),
                "expected_output": "",
                "repo": row["repo"],
                "base_commit": row["base_commit"],
                "tags": ["swebench", "public"],
            }
        )
    return tasks


def load_sample_fallback(limit: int) -> list[dict]:
    sample = Path(__file__).resolve().parents[1] / "swe-bench" / "sample_tasks.json"
    data = json.loads(sample.read_text(encoding="utf-8"))
    tasks = []
    for row in data.get("tasks", [])[:limit]:
        tasks.append(
            {
                "id": row["instance_id"],
                "source": "swebench_sample_public",
                "difficulty": "hard",
                "category": "software_engineering",
                "prompt": (
                    f"Repository: {row['repo']}\n\n"
                    f"Issue:\n{row['problem_statement']}\n\n"
                    "Write a minimal fix outline and key code changes."
                ),
                "expected_output": "",
                "tags": ["swebench", "public", "sample"],
            }
        )
    return tasks


def validate(tasks: list[dict]) -> None:
    for t in tasks:
        src = str(t.get("source", ""))
        if FORBIDDEN.search(src) and "moguai_private" not in src.lower():
            raise SystemExit(f"Rejected non-public vendor source: {src}")


def main() -> None:
    p = argparse.ArgumentParser(description="Public seed → tasks.json")
    p.add_argument("--seed-dataset", choices=["humaneval", "swebench", "sample"], default="humaneval")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--output", type=str, default=str(Path(__file__).parent / "tasks.json"))
    args = p.parse_args()

    if args.seed_dataset == "humaneval":
        try:
            tasks = load_humaneval(args.limit)
        except Exception as exc:  # noqa: BLE001
            print(f"[convert_seed] HumanEval load failed ({exc}); using sample")
            tasks = load_sample_fallback(args.limit)
    elif args.seed_dataset == "swebench":
        try:
            tasks = load_swebench(args.limit)
        except Exception as exc:  # noqa: BLE001
            print(f"[convert_seed] SWE-bench load failed ({exc}); using sample")
            tasks = load_sample_fallback(args.limit)
    else:
        tasks = load_sample_fallback(args.limit)

    validate(tasks)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "name": f"public_{args.seed_dataset}",
        "note": "Public seed only. No vendor-private suites.",
        "tasks": tasks,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[convert_seed] wrote {len(tasks)} tasks → {out}")


if __name__ == "__main__":
    main()
