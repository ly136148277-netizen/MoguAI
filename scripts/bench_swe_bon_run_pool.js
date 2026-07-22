/**
 * Serially run N independent SWE candidates (separate workdir/runId) then stop.
 * Stack defaults match regression: gpt-5.6-sol + gen-hints + find_refs + scope warn + docker verify.
 *
 *   node scripts/bench_swe_bon_run_pool.js \
 *     --instance astropy__astropy-14365 \
 *     --prefix lite8-bon-14365 \
 *     --n 5
 */
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);

function flagValue(name) {
  const idx = argv.indexOf(name);
  if (idx < 0) return "";
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) return "";
  return next;
}

const instance = flagValue("--instance") || flagValue("--only");
const prefix = flagValue("--prefix") || `bon-${Date.now()}`;
const n = Math.max(1, Number(flagValue("--n") || 5) || 5);
const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");

if (!instance) {
  console.error("用法: node scripts/bench_swe_bon_run_pool.js --instance <id> --prefix <p> --n 5");
  process.exit(2);
}
if (!process.env.OPENAI_API_KEY && !process.env.MOGU_API_KEY) {
  console.error("需要 OPENAI_API_KEY");
  process.exit(2);
}
if (!process.env.OPENAI_BASE_URL) {
  console.error("需要 OPENAI_BASE_URL");
  process.exit(2);
}

const runIds = [];
for (let i = 1; i <= n; i += 1) {
  const runId = `${prefix}-c${i}-${dateTag}`;
  const work = path.join(ROOT, "benchmarks", "swe-bench", `work-${prefix}-c${i}`);
  console.log(`\n======== BoN candidate ${i}/${n} runId=${runId} ========`);
  const env = {
    ...process.env,
    MOGU_CLOUD_PATCH: process.env.MOGU_CLOUD_PATCH || "1",
    MOGU_BENCH_MODEL: process.env.MOGU_BENCH_MODEL || "gpt-5.6-sol",
    MOGU_SWE_SCOPE_MODE: process.env.MOGU_SWE_SCOPE_MODE || "warn",
    MOGU_FIND_REFS: process.env.MOGU_FIND_REFS || "1",
    MOGU_GEN_HINTS: process.env.MOGU_GEN_HINTS || "1",
    MOGU_SWE_DOCKER_VERIFY: process.env.MOGU_SWE_DOCKER_VERIFY || "1",
    MOGU_EVAL_VIA_WSL: process.env.MOGU_EVAL_VIA_WSL || "0",
    PYTHONUTF8: process.env.PYTHONUTF8 || "1",
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
    MOGU_BENCH_WORKDIR: work,
  };
  const r = spawnSync(
    process.execPath,
    ["scripts/bench_swe_wait_relay.js", runId, "--eval", "--only", instance],
    { cwd: ROOT, env, stdio: "inherit" }
  );
  runIds.push(runId);
  if (r.status !== 0) {
    console.error(`[bon-pool] candidate ${i} exited ${r.status} — continue pool`);
  }
}

console.log("\n[bon-pool] done runIds=");
console.log(runIds.join(","));
console.log(
  `[bon-pool] next: node scripts/bench_swe_bon_aggregate.js --bon-id ${prefix}-${dateTag} --instance ${instance} --runs ${runIds.join(",")}`
);
