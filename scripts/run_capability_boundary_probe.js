/**
 * Capability-boundary probe: baseline k=3, no strategy interventions.
 * Not a Branch CT. Mechanism observation only (no --eval by default).
 *
 *   node scripts/run_capability_boundary_probe.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATE = "20260722";
const JOBS = [
  { instance: "sympy__sympy-13177", prefix: "probe-cap-sympy13177", role: "class-A" },
  { instance: "django__django-15781", prefix: "probe-cap-django15781", role: "class-C" },
];

function runDir(runId) {
  return path.join(ROOT, "benchmarks", "swe-bench", "runs", runId);
}

function baseEnv() {
  return {
    ...process.env,
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

function runOne(runId, instance, work) {
  const dir = runDir(runId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[probe] removed ${runId}`);
  }
  const env = {
    ...baseEnv(),
    MOGU_BENCH_WORKDIR: work,
    MOGU_GEN_HINT_PROFILE: "",
  };
  const args = ["scripts/bench_swe_wait_relay.js", runId, "--only", instance];
  // no --eval: mechanism probe only
  console.log(`\n======== ${runId} ${instance} (no eval) ========`);
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return r.status ?? 1;
}

let fails = 0;
for (const job of JOBS) {
  for (let i = 1; i <= 3; i += 1) {
    const runId = `${job.prefix}-c${i}-${DATE}`;
    const work = path.join(ROOT, "benchmarks", "swe-bench", `work-${job.prefix}-c${i}`);
    if (runOne(runId, job.instance, work) !== 0) fails += 1;
  }
}

console.log(`\n===== CAPABILITY PROBE COMPLETE fails=${fails}/6 =====`);
spawnSync(process.execPath, ["scripts/analyze_capability_boundary_probe.js"], {
  cwd: ROOT,
  stdio: "inherit",
  windowsHide: true,
});
process.exit(fails ? 1 : 0);
