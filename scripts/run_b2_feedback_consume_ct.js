/**
 * Feedback-Consumption runner — forced evidence→decision binding.
 *
 *   --smoke-only   unit + live mechanism smoke (11019; no eval; Branch N/A)
 *   --ct           formal 3×k=3 + eval (Option F sample)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATE = "20260722";
const SMOKE_INSTANCE = "django__django-11019";
const SMOKE_PREFIX = "ct-fc-smoke-django11019";
const CT_JOBS = [
  { instance: "django__django-13265", prefix: "ct-fc-django13265" },
  { instance: "django__django-11019", prefix: "ct-fc-django11019" },
  { instance: "django__django-15695", prefix: "ct-fc-django15695" },
];

const argv = process.argv.slice(2);
const smokeOnly = argv.includes("--smoke-only");
const formalCt = argv.includes("--ct");

function runDir(runId) {
  return path.join(ROOT, "benchmarks", "swe-bench", "runs", runId);
}

function isComplete(runId) {
  const dir = runDir(runId);
  const pred = path.join(dir, "predictions.jsonl");
  const metrics = path.join(dir, "metrics.json");
  if (!fs.existsSync(pred) || !fs.existsSync(metrics)) return false;
  if (
    [path.join(dir, "report.json"), path.join(dir, "eval_report.json")].some((p) =>
      fs.existsSync(p)
    )
  ) {
    return true;
  }
  const evalRoot = path.join(dir, "logs", "run_evaluation");
  if (!fs.existsSync(evalRoot)) return false;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (walk(p)) return true;
      } else if (ent.name === "report.json") return true;
    }
    return false;
  };
  try {
    return walk(evalRoot);
  } catch {
    return false;
  }
}

function baseEnv() {
  return {
    ...process.env,
    MOGU_FEEDBACK_PACK: "1",
    MOGU_FEEDBACK_CONSUME: "1",
    MOGU_D2_STRUCTURED_RETRY: "0",
    MOGU_D2_HYPOTHESIS_DIVERSITY: "0",
    MOGU_GEN_HINTS: "0",
    MOGU_GEN_HINT_PROFILE: "",
    MOGU_CLOUD_PATCH: process.env.MOGU_CLOUD_PATCH || "1",
    MOGU_BENCH_MODEL: process.env.MOGU_BENCH_MODEL || "gpt-5.5",
    MOGU_SWE_SCOPE_MODE: process.env.MOGU_SWE_SCOPE_MODE || "warn",
    MOGU_FIND_REFS: process.env.MOGU_FIND_REFS || "1",
    MOGU_SWE_DOCKER_VERIFY: process.env.MOGU_SWE_DOCKER_VERIFY || "1",
  };
}

function runBench({ runId, instance, work, withEval }) {
  const dir = runDir(runId);
  if (withEval && isComplete(runId)) {
    console.log(`\n======== SKIP complete ${runId} ========`);
    return 0;
  }
  if (fs.existsSync(dir) && !(withEval && isComplete(runId))) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[fc] removed ${runId}`);
  }
  const env = {
    ...baseEnv(),
    MOGU_BENCH_WORKDIR: work,
    MOGU_FEEDBACK_PACK_DIR: path.join(dir, "feedback_pack"),
    MOGU_FEEDBACK_CONSUME_DIR: path.join(dir, "feedback_consume"),
    MOGU_GEN_HINT_PROFILE: "",
  };
  const args = ["scripts/bench_swe_wait_relay.js", runId, "--only", instance];
  if (withEval) args.push("--eval");
  console.log(`\n======== ${runId} only=${instance} eval=${withEval ? 1 : 0} ========`);
  console.log(`[fc] PACK=1 CONSUME=1 D2=0 D2′=0 model=${env.MOGU_BENCH_MODEL}`);
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return r.status ?? 1;
}

function runUnitSmoke() {
  console.log("\n======== unit smoke ========");
  const r = spawnSync(
    process.execPath,
    ["--test", "tests/coding-feedback-consume.test.js"],
    { cwd: ROOT, stdio: "inherit", windowsHide: true }
  );
  return r.status ?? 1;
}

function runSmokeJudge(runId) {
  const r = spawnSync(
    process.execPath,
    ["scripts/judge_b2_feedback_consume_smoke.js", "--run-id", runId],
    { cwd: ROOT, stdio: "inherit", windowsHide: true }
  );
  return r.status ?? 1;
}

function printHelp() {
  console.error(`Feedback-Consumption runner — choose one:

  node scripts/run_b2_feedback_consume_ct.js --smoke-only
  node scripts/run_b2_feedback_consume_ct.js --ct

Option F sample: 13265 / 11019 / 15695 (exclude 12497).`);
}

if (smokeOnly === formalCt) {
  printHelp();
  process.exit(2);
}

if (smokeOnly) {
  const unit = runUnitSmoke();
  if (unit !== 0) process.exit(unit);
  const runId = `${SMOKE_PREFIX}-${DATE}`;
  const work = path.join(ROOT, "benchmarks", "swe-bench", `work-${SMOKE_PREFIX}`);
  const code = runBench({ runId, instance: SMOKE_INSTANCE, work, withEval: false });
  const judge = runSmokeJudge(runId);
  console.log(`\n===== FC LIVE SMOKE ${code === 0 && judge === 0 ? "PASS" : "FAIL"} =====`);
  console.log(`Branch: N/A · runId=${runId}`);
  process.exit(code !== 0 || judge !== 0 ? 1 : 0);
}

let fails = 0;
for (const job of CT_JOBS) {
  for (let i = 1; i <= 3; i += 1) {
    const runId = `${job.prefix}-c${i}-${DATE}`;
    const work = path.join(ROOT, "benchmarks", "swe-bench", `work-${job.prefix}-c${i}`);
    if (runBench({ runId, instance: job.instance, work, withEval: true }) !== 0) fails += 1;
  }
}
console.log(`\n===== FC CT COMPLETE fails=${fails}/9 =====`);
process.exit(fails ? 1 : 0);
