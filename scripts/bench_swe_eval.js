#!/usr/bin/env node
/**
 * Official SWE-bench harness on MOGU predictions.jsonl.
 *
 * Windows trust path (default): host Python + win_swebench_lf sitecustomize
 * (forces LF for eval.sh / patches — prevents activate\\r / pytest-not-found noise).
 *
 * Optional: --via-wsl when Ubuntu has Docker Desktop integration enabled.
 */
const fs = require("fs-extra");
const path = require("path");
const { spawnSync } = require("node:child_process");
const { BENCH_ROOT, parseArgs, ROOT } = require("./bench_swe_lib");

function normalizePredictionsLf(predPath) {
  const raw = fs.readFileSync(predPath, "utf8");
  const lf = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (lf !== raw) {
    fs.writeFileSync(predPath, lf, { encoding: "utf8" });
    console.log(`[bench:swe:eval] normalized CRLF→LF: ${predPath}`);
  }
  const lines = lf.split("\n").filter((l) => l.trim());
  let changed = false;
  const out = lines.map((line) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return line;
    }
    if (typeof obj.model_patch === "string" && obj.model_patch.includes("\r")) {
      obj.model_patch = obj.model_patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      changed = true;
    }
    return JSON.stringify(obj);
  });
  if (changed) {
    fs.writeFileSync(predPath, `${out.join("\n")}\n`, { encoding: "utf8" });
    console.log(`[bench:swe:eval] stripped CR from model_patch fields`);
  }
}

function toWslPath(winPath) {
  const abs = path.resolve(winPath);
  const m = /^([A-Za-z]):\\(.*)$/.exec(abs);
  if (!m) return abs.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

function hostPythonPath() {
  return [
    path.join(ROOT, "scripts", "win_swebench_lf"),
    path.join(ROOT, "scripts", "win_resource_stub"),
    process.env.PYTHONPATH || "",
  ]
    .filter(Boolean)
    .join(path.delimiter);
}

function main() {
  const args = parseArgs();
  const runId = String(args["run-id"] || args.runId || "").trim();
  if (!runId) {
    console.error("用法: npm run bench:swe:eval -- --run-id <id> [--via-wsl]");
    process.exit(1);
  }
  const predPath = path.resolve(
    String(args.predictions || path.join(BENCH_ROOT, "runs", runId, "predictions.jsonl"))
  );
  if (!fs.pathExistsSync(predPath)) {
    console.error(`找不到 predictions: ${predPath}`);
    process.exit(1);
  }

  normalizePredictionsLf(predPath);

  const dataset = String(args.dataset || "princeton-nlp/SWE-bench_Lite");
  const maxWorkers = String(args.workers || args["max-workers"] || "1");
  const namespace = String(args.namespace || process.env.MOGU_SWEBENCH_NAMESPACE || "swebench");
  // Default host+LF on Windows (Ubuntu often lacks Docker Desktop integration).
  // Opt into WSL with --via-wsl or MOGU_EVAL_VIA_WSL=1.
  const viaWsl =
    Boolean(args["via-wsl"] || args.viaWsl) || process.env.MOGU_EVAL_VIA_WSL === "1";

  if (viaWsl && process.platform === "win32") {
    const wslPred = toWslPath(predPath);
    const wslCwd = toWslPath(path.dirname(predPath));
    const py = String(args.python || process.env.MOGU_WSL_PYTHON || "python");
    const bash = [
      "set -euo pipefail",
      `cd ${JSON.stringify(wslCwd)}`,
      'if [ -f "$HOME/mogu-swebench/bin/activate" ]; then source "$HOME/mogu-swebench/bin/activate"; fi',
      // Docker Desktop must enable WSL integration for this distro
      'docker info >/dev/null 2>&1 || { echo "[eval] Docker not available in this WSL distro — enable Docker Desktop → WSL integration, or omit --via-wsl"; exit 2; }',
      [
        py,
        "-m",
        "swebench.harness.run_evaluation",
        "--dataset_name",
        dataset,
        "--predictions_path",
        wslPred,
        "--max_workers",
        maxWorkers,
        "--run_id",
        runId,
        "--namespace",
        namespace,
      ]
        .map((x) => JSON.stringify(x))
        .join(" "),
    ].join("\n");
    console.log(`[bench:swe:eval] via WSL\n${bash}`);
    const r = spawnSync("wsl.exe", ["-d", "Ubuntu", "-e", "bash", "-lc", bash], {
      encoding: "utf8",
      windowsHide: true,
      stdio: "inherit",
    });
    if (r.error) {
      console.error(`[bench:swe:eval] WSL failed: ${r.error.message}`);
      process.exit(1);
    }
    process.exit(r.status == null ? 1 : r.status);
  }

  const py = String(args.python || process.env.PYTHON || "python");
  const cmdArgs = [
    "-m",
    "swebench.harness.run_evaluation",
    "--dataset_name",
    dataset,
    "--predictions_path",
    predPath,
    "--max_workers",
    maxWorkers,
    "--run_id",
    runId,
    "--namespace",
    namespace,
  ];

  console.log(`[bench:swe:eval] host+LF ${py} ${cmdArgs.join(" ")}`);
  console.log(`[bench:swe:eval] PYTHONPATH includes win_swebench_lf (force LF eval.sh)`);

  // Smoke-check sitecustomize is on path
  const smoke = spawnSync(
    py,
    [
      "-c",
      "import pathlib; p=pathlib.Path('_mogu_lf_smoke.sh'); p.write_text('#!/bin/bash\\necho ok\\n'); b=p.read_bytes(); p.unlink(missing_ok=True); import sys; sys.exit(0 if b'\\r' not in b else 1)",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PYTHONPATH: hostPythonPath() },
      cwd: path.dirname(predPath),
    }
  );
  if (smoke.status !== 0) {
    console.error("[bench:swe:eval] LF sitecustomize smoke failed — aborting to avoid noisy Resolved");
    console.error(smoke.stderr || smoke.stdout || "");
    process.exit(2);
  }
  console.log("[bench:swe:eval] LF sitecustomize smoke ok");

  const r = spawnSync(py, cmdArgs, {
    cwd: path.dirname(predPath),
    encoding: "utf8",
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONPATH: hostPythonPath(),
      // Avoid Windows GBK UnicodeEncodeError when harness writes test_output.
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });

  if (r.error) {
    console.error(`[bench:swe:eval] 无法启动 Python: ${r.error.message}`);
    console.error("请先: pip install swebench");
    process.exit(1);
  }
  process.exit(r.status == null ? 1 : r.status);
}

main();
