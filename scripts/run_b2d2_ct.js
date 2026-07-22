/**
 * B2-D2 formal CT runner: 4 instances × k=3 + official eval.
 * Does not interpret mid-run. Fixed k=3 (no auto k→5).
 *
 * Usage (env must already set API key/base URL + MOGU_D2_STRUCTURED_RETRY=1):
 *   node scripts/run_b2d2_ct.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATE = "20260721";

const JOBS = [
  { instance: "django__django-13265", prefix: "ct-b2d2-django13265" },
  { instance: "django__django-12497", prefix: "ct-b2d2-django12497" },
  { instance: "django__django-11019", prefix: "ct-b2d2-django11019" },
  { instance: "django__django-15695", prefix: "ct-b2d2-django15695" },
];

function runDir(runId) {
  return path.join(ROOT, "benchmarks", "swe-bench", "runs", runId);
}

/** Complete = predictions + metrics + eval report present (no splice of half runs). */
function isComplete(runId) {
  const dir = runDir(runId);
  const pred = path.join(dir, "predictions.jsonl");
  const metrics = path.join(dir, "metrics.json");
  if (!fs.existsSync(pred) || !fs.existsSync(metrics)) return false;
  const reportCandidates = [
    path.join(dir, "report.json"),
    path.join(dir, "eval_report.json"),
  ];
  if (reportCandidates.some((p) => fs.existsSync(p))) return true;
  // harness layout: logs/run_evaluation/<runId>/<instance>/report.json
  const evalRoot = path.join(dir, "logs", "run_evaluation");
  if (!fs.existsSync(evalRoot)) return false;
  try {
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) {
          if (walk(p)) return true;
        } else if (ent.name === "report.json") {
          return true;
        }
      }
      return false;
    };
    return walk(evalRoot);
  } catch {
    return false;
  }
}

function runOne(instance, prefix, i) {
  const runId = `${prefix}-c${i}-${DATE}`;
  if (isComplete(runId)) {
    console.log(`\n======== SKIP complete ${runId} ========`);
    return 0;
  }
  // Wipe incomplete dir so we never splice aborted artifacts.
  const dir = runDir(runId);
  if (fs.existsSync(dir) && !isComplete(runId)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[b2d2] removed incomplete ${runId}`);
  }
  const work = path.join(ROOT, "benchmarks", "swe-bench", `work-${prefix}-c${i}`);
  console.log(`\n======== ${runId} only=${instance} ========`);
  const env = {
    ...process.env,
    MOGU_D2_STRUCTURED_RETRY: "1",
    MOGU_GEN_HINTS: "0",
    MOGU_GEN_HINT_PROFILE: "",
    MOGU_BENCH_WORKDIR: work,
    MOGU_CLOUD_PATCH: process.env.MOGU_CLOUD_PATCH || "1",
    MOGU_BENCH_MODEL: process.env.MOGU_BENCH_MODEL || "gpt-5.5",
    MOGU_SWE_SCOPE_MODE: process.env.MOGU_SWE_SCOPE_MODE || "warn",
    MOGU_FIND_REFS: process.env.MOGU_FIND_REFS || "1",
    MOGU_SWE_DOCKER_VERIFY: process.env.MOGU_SWE_DOCKER_VERIFY || "1",
  };
  delete env.MOGU_GEN_HINT_PROFILE;
  env.MOGU_GEN_HINT_PROFILE = "";

  const r = spawnSync(
    process.execPath,
    ["scripts/bench_swe_wait_relay.js", runId, "--eval", "--only", instance],
    { cwd: ROOT, env, stdio: "inherit", windowsHide: true }
  );
  const code = r.status ?? 1;
  console.log(`[b2d2] ${runId} exit=${code}`);
  return code;
}

let fails = 0;
for (const job of JOBS) {
  for (let i = 1; i <= 3; i += 1) {
    const code = runOne(job.instance, job.prefix, i);
    if (code !== 0) fails += 1;
  }
}

console.log(`\n===== B2-D2 CT COMPLETE fails=${fails}/12 =====`);
process.exit(fails ? 1 : 0);
