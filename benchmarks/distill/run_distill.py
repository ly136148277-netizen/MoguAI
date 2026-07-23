#!/usr/bin/env python3
"""
Public-data knowledge distillation for MOGUAI experiments.

Teacher = paid OpenAI / Anthropic APIs (your keys) OR mock cache.
Student = HuggingFace CausalLM.
Seeds  = HumanEval / SWE-bench public only.

Chat APIs do not expose full-vocab teacher logits; soft targets use:
  - teacher text (token CE on teacher tokens), and
  - optional OpenAI logprobs when available.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

FORBIDDEN_SOURCE = re.compile(r"cursor_?private|trae_?private|cursor_trae|vendor_private", re.I)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_config(path: Path) -> dict[str, Any]:
    cfg = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    return cfg or {}


def assert_public_tasks(tasks: list[dict]) -> None:
    for t in tasks:
        src = str(t.get("source", ""))
        if FORBIDDEN_SOURCE.search(src):
            raise SystemExit(f"Rejected vendor-private source in tasks: {src}")


def load_tasks(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    tasks = data["tasks"] if isinstance(data, dict) else data
    assert_public_tasks(tasks)
    return tasks


class TeacherCache:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict[str, Any] = {}
        if path.exists():
            self.data = json.loads(path.read_text(encoding="utf-8"))

    def key(self, model: str, prompt: str) -> str:
        h = hashlib.sha256(f"{model}\n{prompt}".encode("utf-8")).hexdigest()
        return h

    def get(self, model: str, prompt: str) -> dict | None:
        return self.data.get(self.key(model, prompt))

    def set(self, model: str, prompt: str, value: dict) -> None:
        self.data[self.key(model, prompt)] = value
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")


class TeacherClient:
    def __init__(self, model: str, cache: TeacherCache):
        self.model = model
        self.cache = cache
        self.openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()

    def generate(self, prompt: str) -> dict[str, Any]:
        cached = self.cache.get(self.model, prompt)
        if cached:
            return cached

        system = (
            "You are a careful coding teacher. Provide step-by-step reasoning, "
            "then a final answer/code. Keep solutions minimal and correct."
        )
        if self.model.startswith("claude") or self.model.startswith("anthropic"):
            out = self._anthropic(system, prompt)
        elif self.openai_key:
            out = self._openai(system, prompt)
        else:
            out = {
                "text": (
                    "MOCK_TEACHER\nReasoning: allocate stack vs heap briefly.\n"
                    "Final: use stack for short-lived locals; heap for dynamic lifetime."
                ),
                "logprobs": None,
                "mock": True,
            }

        self.cache.set(self.model, prompt, out)
        return out

    def _openai(self, system: str, prompt: str) -> dict[str, Any]:
        from openai import OpenAI

        client = OpenAI(api_key=self.openai_key)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
        }
        # Best-effort logprobs (not full vocab KD).
        try:
            resp = client.chat.completions.create(**kwargs, logprobs=True, top_logprobs=5)
            choice = resp.choices[0]
            text = choice.message.content or ""
            lp = None
            if getattr(choice, "logprobs", None) and choice.logprobs.content:
                lp = [
                    {"token": x.token, "logprob": x.logprob}
                    for x in choice.logprobs.content
                    if x is not None
                ]
            return {"text": text, "logprobs": lp, "mock": False}
        except Exception:
            resp = client.chat.completions.create(**kwargs)
            return {"text": resp.choices[0].message.content or "", "logprobs": None, "mock": False}

    def _anthropic(self, system: str, prompt: str) -> dict[str, Any]:
        if not self.anthropic_key:
            return {
                "text": "MOCK_TEACHER (no ANTHROPIC_API_KEY)\nFinal: placeholder solution.",
                "logprobs": None,
                "mock": True,
            }
        from anthropic import Anthropic

        client = Anthropic(api_key=self.anthropic_key)
        model = self.model.replace("anthropic/", "")
        msg = client.messages.create(
            model=model,
            max_tokens=2048,
            temperature=0.2,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content)
        return {"text": text, "logprobs": None, "mock": False}


class GradientReversalFn:
    """GRL for adversarial robustness head (prompt-injection defense toy head)."""

    @staticmethod
    def apply(x, alpha: float):
        import torch

        class _Fn(torch.autograd.Function):
            @staticmethod
            def forward(ctx, inp, a):
                ctx.a = a
                return inp.view_as(inp)

            @staticmethod
            def backward(ctx, grad):
                return -ctx.a * grad, None

        return _Fn.apply(x, alpha)


def mmd_rbf(x, y, sigma: float = 1.0):
    import torch

    xx = torch.cdist(x, x, p=2).pow(2)
    yy = torch.cdist(y, y, p=2).pow(2)
    xy = torch.cdist(x, y, p=2).pow(2)
    k_xx = torch.exp(-xx / (2 * sigma**2)).mean()
    k_yy = torch.exp(-yy / (2 * sigma**2)).mean()
    k_xy = torch.exp(-xy / (2 * sigma**2)).mean()
    return k_xx + k_yy - 2 * k_xy


def tok_pad_id(model) -> int:
    pad = getattr(model.config, "pad_token_id", None)
    if pad is None or pad < 0:
        eos = getattr(model.config, "eos_token_id", None)
        return int(eos) if eos is not None else -100
    return int(pad)


def ensure_mock_logits(path: Path, vocab: int = 128, seq: int = 32) -> None:
    import torch

    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"logits": torch.randn(1, seq, vocab)}, path)


def build_student(model_name: str, device: str):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(model_name)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(model_name)
    model.to(device)
    # Tiny adversarial head on pooled hidden states.
    hidden = model.config.n_embd if hasattr(model.config, "n_embd") else model.config.hidden_size
    adv_head = torch.nn.Linear(hidden, 2).to(device)
    return tok, model, adv_head


def tokenize_pair(tok, prompt: str, target: str, max_length: int, device: str):
    import torch

    enc = tok(
        prompt,
        text_target=target,
        max_length=max_length,
        truncation=True,
        padding="max_length",
        return_tensors="pt",
    )
    return {k: v.to(device) for k, v in enc.items()}


def distill_step(model, adv_head, batch, teacher_ids, weights, temperature, grl_alpha, device):
    import torch
    import torch.nn.functional as F

    out = model(
        input_ids=batch["input_ids"],
        attention_mask=batch["attention_mask"],
        labels=batch["labels"],
        output_hidden_states=True,
    )
    hard = out.loss

    # Soft: CE against teacher token ids (text-level KD; APIs rarely give full logits).
    s_logits = out.logits / max(temperature, 1e-5)
    t_labels = teacher_ids["input_ids"][:, 1:]
    s_log = F.log_softmax(s_logits[:, :-1, :], dim=-1)
    pad_id = tok_pad_id(model)
    soft = F.nll_loss(
        s_log.reshape(-1, s_log.size(-1)),
        t_labels.reshape(-1),
        ignore_index=pad_id,
    )

    s_hid = out.hidden_states[-1].mean(dim=1)
    with torch.no_grad():
        t_feat = model(
            input_ids=teacher_ids["input_ids"],
            attention_mask=teacher_ids["attention_mask"],
            output_hidden_states=True,
        ).hidden_states[-1].mean(dim=1)
    feat = mmd_rbf(s_hid, t_feat)

    # Adversarial: classify "clean" vs "injected" with GRL (synthetic labels).
    pooled = GradientReversalFn.apply(s_hid, grl_alpha)
    adv_logits = adv_head(pooled)
    adv_labels = torch.zeros(adv_logits.size(0), dtype=torch.long, device=device)
    # randomly flip some as injection for toy training signal
    if random.random() < 0.3:
        adv_labels = torch.ones_like(adv_labels)
    adv = F.cross_entropy(adv_logits, adv_labels)

    total = (
        weights["hard"] * hard
        + weights["soft"] * soft
        + weights["feature_mmd"] * feat
        + weights["adversarial"] * adv
    )
    return {
        "total": total,
        "hard": float(hard.detach()),
        "soft": float(soft.detach()),
        "feature_mmd": float(feat.detach()),
        "adversarial": float(adv.detach()),
    }


def run_training(args, cfg: dict[str, Any], tasks: list[dict], teacher: TeacherClient) -> dict:
    import torch
    from tqdm import tqdm

    device = cfg.get("device") or ("cuda" if torch.cuda.is_available() else "cpu")
    tok, model, adv_head = build_student(args.student_model or cfg.get("student_model"), device)
    opt = torch.optim.AdamW(list(model.parameters()) + list(adv_head.parameters()), lr=float(cfg.get("lr", 5e-5)))
    weights = cfg.get("loss_weights") or {}
    temperature = float(cfg.get("teacher_temperature", 2.0))
    grl_alpha = float(args.grl_alpha if args.grl_alpha is not None else cfg.get("grl_alpha", 0.1))
    max_length = int(cfg.get("max_length", 512))
    epochs = int(args.epochs or cfg.get("epochs", 1))

    mock_path = Path(args.mock_logits or cfg.get("mock_logits_path", "./mock_teacher_logits.pt"))
    ensure_mock_logits(mock_path)

    metrics = []
    model.train()
    for epoch in range(epochs):
        random.shuffle(tasks)
        pbar = tqdm(tasks, desc=f"epoch {epoch+1}/{epochs}")
        for task in pbar:
            prompt = task["prompt"]
            hard_target = task.get("expected_output") or task.get("canonical_solution") or ""
            teacher_out = teacher.generate(prompt)
            soft_text = teacher_out.get("text") or hard_target or "OK"

            batch = tokenize_pair(tok, prompt, hard_target or soft_text, max_length, device)
            # HF maps text_target → labels
            if "labels" not in batch:
                batch["labels"] = batch["input_ids"].clone()
            teacher_ids = tok(
                soft_text,
                max_length=max_length,
                truncation=True,
                padding="max_length",
                return_tensors="pt",
            )
            teacher_ids = {k: v.to(device) for k, v in teacher_ids.items()}

            losses = distill_step(
                model,
                adv_head,
                batch,
                teacher_ids,
                weights={
                    "hard": float(weights.get("hard", 1.0)),
                    "soft": float(weights.get("soft", 0.5)),
                    "feature_mmd": float(weights.get("feature_mmd", 0.1)),
                    "adversarial": float(weights.get("adversarial", 0.1)),
                },
                temperature=temperature,
                grl_alpha=grl_alpha,
                device=device,
            )
            opt.zero_grad()
            losses["total"].backward()
            opt.step()
            row = {k: v for k, v in losses.items() if k != "total"}
            row["total"] = float(losses["total"].detach())
            row["id"] = task.get("id")
            metrics.append(row)
            pbar.set_postfix(total=row["total"])

    out_dir = Path(args.output_dir or cfg.get("output_dir", "./runs/distill_out"))
    out_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(out_dir / "student")
    tok.save_pretrained(out_dir / "student")
    summary = {
        "epochs": epochs,
        "tasks": len(tasks),
        "teacher_model": args.teacher_model,
        "student_model": args.student_model or cfg.get("student_model"),
        "mean_total": sum(m["total"] for m in metrics) / max(1, len(metrics)),
        "note": "Public seeds + paid teacher APIs only. No vendor-private ingestion.",
    }
    (out_dir / "metrics.json").write_text(json.dumps({"summary": summary, "steps": metrics}, indent=2), encoding="utf-8")
    (out_dir / "summary.md").write_text(
        f"# Distill run\n\n- teacher: {summary['teacher_model']}\n"
        f"- student: {summary['student_model']}\n"
        f"- tasks: {summary['tasks']}\n"
        f"- mean_total: {summary['mean_total']:.4f}\n",
        encoding="utf-8",
    )
    return summary


def main() -> None:
    load_dotenv(Path(__file__).parent / ".env")
    load_dotenv()

    p = argparse.ArgumentParser(description="MOGUAI public KD distill (legal path)")
    p.add_argument("--config", default=str(Path(__file__).parent / "config.yaml"))
    p.add_argument("--seed-dataset", choices=["swebench", "humaneval", "sample", "tasks"], default=None)
    p.add_argument("--tasks", default=str(Path(__file__).parent / "tasks.json"))
    p.add_argument("--teacher-model", default=None)
    p.add_argument("--student-model", default=None)
    p.add_argument("--output-dir", default=None)
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--cache", default=None)
    p.add_argument("--mock-logits", default=None)
    p.add_argument("--grl-alpha", type=float, default=None)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--convert-first", action="store_true")
    args = p.parse_args()

    cfg = load_config(Path(args.config))
    if args.teacher_model is None:
        args.teacher_model = cfg.get("teacher_model", "gpt-4o")
    if args.student_model is None:
        args.student_model = cfg.get("student_model", "sshleifer/tiny-gpt2")
    if args.output_dir is None:
        args.output_dir = cfg.get("output_dir", str(Path(__file__).parent / "runs" / "distill_out"))

    if args.convert_first or args.seed_dataset in {"swebench", "humaneval", "sample"}:
        import subprocess
        import sys

        seed = args.seed_dataset or cfg.get("seed_dataset", "humaneval")
        if seed == "tasks":
            seed = "humaneval"
        cmd = [
            sys.executable,
            str(Path(__file__).parent / "convert_seed.py"),
            "--seed-dataset",
            seed,
            "--output",
            args.tasks,
        ]
        if args.limit:
            cmd += ["--limit", str(args.limit)]
        subprocess.check_call(cmd)

    tasks_path = Path(args.tasks)
    if not tasks_path.exists():
        raise SystemExit(f"Missing {tasks_path}; run convert_seed.py or --convert-first")

    tasks = load_tasks(tasks_path)
    if args.limit:
        tasks = tasks[: args.limit]

    cache_path = Path(args.cache or cfg.get("cache_path", Path(__file__).parent / "teacher_cache.json"))
    teacher = TeacherClient(args.teacher_model, TeacherCache(cache_path))

    print(
        f"[run_distill] public KD | teacher={args.teacher_model} student={args.student_model} "
        f"tasks={len(tasks)}"
    )
    summary = run_training(args, cfg, tasks, teacher)
    print(f"[run_distill] done mean_total={summary['mean_total']:.4f} → {args.output_dir}")


if __name__ == "__main__":
    main()
