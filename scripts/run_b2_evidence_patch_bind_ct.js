/**
 * EPB runner — Evidence-to-Patch Binding.
 *
 *   --smoke-only   unit + live mechanism smoke (15781; no eval; Branch N/A)
 *   --ct           formal n=5×k=3 + eval (requires SAMPLE_GATE CLOSED)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATE = "20260722";
const SMOKE_INSTANCE = "django__django-15781";
const SMOKE_PREFIX = "ct-epb-smoke-django15781";
const GATE_PATH = path.join(
  ROOT,
  "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_evidence_to_patch/SAMPLE_GATE.md"
);

const argv = process.argv.slice(2);
const smokeOnly = argv.includes("--smoke-only");
const formalCt = argv.includes("--ct");

function runDir(runId) {
  return path.join(ROOT, "benchmarks", "swe-bench", "runs", runId);
}

function sampleGateClosed() {
  if (!fs.existsSync(GATE_PATH)) return false;
  const text = fs.readFileSync(GATE_PATH, "utf8");
  return /status:\s*CLOSED/i.test(text) && /scoring_set:\s*\[/.test(text);
}

function baseEnv() {
  return {
    ...process.env,
    MOGU_EVIDENCE_PATCH_BIND: "1",
    MOGU_FEEDBACK_PACK: "0",
    MOGU_FEEDBACK_CONSUME: "0",
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
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[epb] removed ${runId}`);
  }
  const env = {
    ...baseEnv(),
    MOGU_BENCH_WORKDIR: work,
    MOGU_EVIDENCE_PATCH_BIND_DIR: path.join(dir, "evidence_patch_bind"),
    MOGU_GEN_HINT_PROFILE: "",
  };
  const args = ["scripts/bench_swe_wait_relay.js", runId, "--only", instance];
  if (withEval) args.push("--eval");
  console.log(`\n======== ${runId} only=${instance} eval=${withEval ? 1 : 0} ========`);
  console.log(
    `[epb] BIND=1 PACK=0 CONSUME=0 D2=0 D2′=0 model=${env.MOGU_BENCH_MODEL}`
  );
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  return r.status || 0;
}

function runUnit() {
  console.log("\n======== EPB unit tests ========");
  const r = spawnSync(
    process.execPath,
    ["--test", "tests/coding-evidence-patch-bind.test.js"],
    { cwd: ROOT, stdio: "inherit" }
  );
  return r.status || 0;
}

function main() {
  if (!smokeOnly && !formalCt) {
    console.error(`usage:
  node scripts/run_b2_evidence_patch_bind_ct.js --smoke-only
  node scripts/run_b2_evidence_patch_bind_ct.js --ct
`);
    process.exit(2);
  }

  let code = runUnit();
  if (code !== 0) process.exit(code);

  if (smokeOnly) {
    const runId = `${SMOKE_PREFIX}-${DATE}`;
    const work = path.join(ROOT, "benchmarks/swe-bench/work-epb-smoke");
    code = runBench({ runId, instance: SMOKE_INSTANCE, work, withEval: false });
    if (code !== 0) process.exit(code);
    const judge = spawnSync(
      process.execPath,
      ["scripts/judge_b2_evidence_patch_bind_smoke.js", "--run-id", runId],
      { cwd: ROOT, stdio: "inherit" }
    );
    process.exit(judge.status || 0);
  }

  if (!sampleGateClosed()) {
    console.error(
      "[epb] CT blocked: SAMPLE_GATE.md must be status: CLOSED with scoring_set of 5"
    );
    process.exit(3);
  }
  console.error("[epb] CT path ready after Gate close — wire jobs from SAMPLE_GATE scoring_set");
  process.exit(0);
}

main();
