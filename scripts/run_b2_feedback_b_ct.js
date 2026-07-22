/**
 * Feedback-B runner — P1–P3 feedback packaging CT / live smoke.
 *
 * Safety: no bare default run. Must pass one of:
 *   --smoke-only   single-instance live mechanism smoke (no eval, not Branch)
 *   --ct           formal 3 × k=3 + eval
 *
 * Usage:
 *   $env:OPENAI_API_KEY="..."
 *   $env:OPENAI_BASE_URL="https://ai-api-router.manylisten.ccwu.cc/v1"
 *   $env:MOGU_BENCH_MODEL="gpt-5.5"
 *   node scripts/run_b2_feedback_b_ct.js --smoke-only
 *   node scripts/run_b2_feedback_b_ct.js --ct
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATE = "20260722";

const SMOKE_INSTANCE = "django__django-11019";
const SMOKE_PREFIX = "ct-fb-smoke-django11019";

const CT_JOBS = [
  { instance: "django__django-13265", prefix: "ct-fb-django13265" },
  { instance: "django__django-11019", prefix: "ct-fb-django11019" },
  { instance: "django__django-15695", prefix: "ct-fb-django15695" },
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
    // Explicitly off — Feedback-B sole variable is packaging.
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
    if (!withEval || !isComplete(runId)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[feedback-b] removed ${withEval ? "incomplete " : ""}${runId}`);
    }
  }

  const env = {
    ...baseEnv(),
    MOGU_BENCH_WORKDIR: work,
    MOGU_FEEDBACK_PACK_DIR: path.join(dir, "feedback_pack"),
    MOGU_GEN_HINT_PROFILE: "",
  };

  const args = ["scripts/bench_swe_wait_relay.js", runId, "--only", instance];
  if (withEval) args.push("--eval");

  console.log(`\n======== ${runId} only=${instance} eval=${withEval ? 1 : 0} ========`);
  console.log(
    `[feedback-b] flags: FEEDBACK_PACK=1 D2=0 D2′=0 model=${env.MOGU_BENCH_MODEL}`
  );

  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const code = r.status ?? 1;
  console.log(`[feedback-b] ${runId} exit=${code}`);
  return code;
}

function runUnitSmoke() {
  console.log("\n======== unit smoke (coding-feedback-pack.test.js) ========");
  const r = spawnSync(
    process.execPath,
    ["--test", "tests/coding-feedback-pack.test.js"],
    { cwd: ROOT, stdio: "inherit", windowsHide: true }
  );
  return r.status ?? 1;
}

function runSmokeJudge(runId) {
  console.log("\n======== smoke judge (mechanism only) ========");
  const r = spawnSync(
    process.execPath,
    ["scripts/judge_b2_feedback_b_smoke.js", "--run-id", runId],
    { cwd: ROOT, stdio: "inherit", windowsHide: true }
  );
  return r.status ?? 1;
}

function printHelp() {
  console.error(`Feedback-B runner — choose exactly one mode:

  node scripts/run_b2_feedback_b_ct.js --smoke-only
      Unit tests + live mechanism smoke on ${SMOKE_INSTANCE} (no --eval, Branch N/A)

  node scripts/run_b2_feedback_b_ct.js --ct
      Formal CT: 3 instances × k=3 + official eval (smoke must PASS first)

Refusing to run without a mode flag (prevents accidental CT).`);
}

if (smokeOnly === formalCt) {
  if (smokeOnly && formalCt) {
    console.error("[feedback-b] refuse: pass only one of --smoke-only | --ct");
  } else {
    printHelp();
  }
  process.exit(2);
}

if (smokeOnly) {
  const unitCode = runUnitSmoke();
  if (unitCode !== 0) {
    console.error("[feedback-b] unit smoke FAIL — fix pack before live smoke");
    process.exit(unitCode);
  }

  const runId = `${SMOKE_PREFIX}-${DATE}`;
  const work = path.join(ROOT, "benchmarks", "swe-bench", `work-${SMOKE_PREFIX}`);
  const code = runBench({ runId, instance: SMOKE_INSTANCE, work, withEval: false });
  const judgeCode = runSmokeJudge(runId);

  console.log(`\n===== Feedback-B LIVE SMOKE =====`);
  console.log(`mechanism smoke: ${code === 0 && judgeCode === 0 ? "PASS" : "FAIL"}`);
  console.log(`Branch: N/A`);
  console.log(`runId=${runId}`);
  process.exit(code !== 0 || judgeCode !== 0 ? 1 : 0);
}

// Formal CT
let fails = 0;
for (const job of CT_JOBS) {
  for (let i = 1; i <= 3; i += 1) {
    const runId = `${job.prefix}-c${i}-${DATE}`;
    const work = path.join(ROOT, "benchmarks", "swe-bench", `work-${job.prefix}-c${i}`);
    const code = runBench({ runId, instance: job.instance, work, withEval: true });
    if (code !== 0) fails += 1;
  }
}
console.log(`\n===== Feedback-B CT COMPLETE fails=${fails}/9 =====`);
process.exit(fails ? 1 : 0);
