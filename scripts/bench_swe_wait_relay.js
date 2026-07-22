/**
 * Wait until manylisten (or OPENAI_BASE_URL) chat recovers, then run lite8 + optional eval.
 * Requires env: OPENAI_API_KEY, OPENAI_BASE_URL. Does not read keys from disk/transcripts.
 *
 *   $env:OPENAI_API_KEY="..."
 *   $env:OPENAI_BASE_URL="https://ai-api-router.manylisten.ccwu.cc/v1"
 *   $env:MOGU_CLOUD_PATCH="1"
 *   $env:MOGU_BENCH_MODEL="gpt-5.6-sol"
 *   node scripts/bench_swe_wait_relay.js lite8-autonomy-<date> --eval
 *   node scripts/bench_swe_wait_relay.js smoke-10914 --eval --only django__django-10914 --debug-print-env
 */
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positionals = argv.filter((a) => !a.startsWith("--"));
const runId =
  positionals[0] || `lite8-autonomy-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const fullRun = flags.has("--full");
const doEval = flags.has("--eval") || fullRun;
const debugPrintEnv = flags.has("--debug-print-env");

function flagValue(name) {
  const idx = argv.indexOf(name);
  if (idx < 0) return "";
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) return "";
  return next;
}

// --full = all cached tasks (ignore MOGU_BENCH_ONLY) + eval
const only = fullRun
  ? ""
  : flagValue("--only") ||
    flagValue("--instance") ||
    process.env.MOGU_BENCH_ONLY ||
    "";

const model = process.env.MOGU_BENCH_MODEL || "gpt-5.6-sol";
const base = String(process.env.OPENAI_BASE_URL || "").replace(/\/$/, "");
const key = String(process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "").trim();

if (!base || !key) {
  console.error("需要 OPENAI_BASE_URL + OPENAI_API_KEY（或 MOGU_API_KEY）");
  process.exit(2);
}

const env = {
  ...process.env,
  OPENAI_API_KEY: key,
  OPENAI_BASE_URL: base,
  MOGU_CLOUD_PATCH: process.env.MOGU_CLOUD_PATCH || "1",
  MOGU_BENCH_MODEL: model,
  MOGU_RELAY_RETRIES: process.env.MOGU_RELAY_RETRIES || "8",
  MOGU_BENCH_INSTANCE_RETRIES: process.env.MOGU_BENCH_INSTANCE_RETRIES || "3",
  MOGU_SWE_SCOPE_MODE: process.env.MOGU_SWE_SCOPE_MODE || "warn",
  MOGU_FIND_REFS: process.env.MOGU_FIND_REFS || "1",
  MOGU_GEN_HINTS: process.env.MOGU_GEN_HINTS || (fullRun ? "1" : "0"),
  MOGU_SWE_DOCKER_VERIFY: process.env.MOGU_SWE_DOCKER_VERIFY || "1",
  MOGU_EVAL_VIA_WSL: process.env.MOGU_EVAL_VIA_WSL || "0",
  PYTHONUTF8: process.env.PYTHONUTF8 || "1",
  PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
};
if (fullRun) {
  delete env.MOGU_BENCH_ONLY;
}
if (only) env.MOGU_BENCH_ONLY = only;
if (debugPrintEnv) env.MOGU_BENCH_DEBUG = "1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function chatOk() {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly: PONG" }],
      max_tokens: 16,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  return res.ok;
}

(async () => {
  console.log(
    `[wait] model=${model} runId=${runId} eval=${doEval} only=${only || "(all)"} scopeMode=${env.MOGU_SWE_SCOPE_MODE} find_refs=${env.MOGU_FIND_REFS} debug=${debugPrintEnv}`
  );
  for (let i = 1; i <= 60; i += 1) {
    try {
      const ok = await chatOk();
      console.log(`[wait] try ${i} chatOk=${ok}`);
      if (ok) break;
    } catch (e) {
      console.log(`[wait] try ${i} err=${e.message}`);
    }
    if (i === 60) {
      console.error("[wait] gave up after ~2h — check relay balance / outage");
      process.exit(3);
    }
    await sleep(120_000);
  }

  const onlyIds = only
    ? only
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const runArgs = ["scripts/bench_swe_run.js", "--run-id", runId];
  if (onlyIds.length) {
    runArgs.push("--only", onlyIds.join(","), "--limit", String(onlyIds.length));
  } else if (fullRun) {
    // Use full cached task list (e.g. B1 n=50 / B2 n=300). Do NOT clamp to 8.
  } else {
    // Legacy lite8 default when neither --full nor --only.
    runArgs.push("--limit", process.env.MOGU_BENCH_LIMIT || "8");
  }
  if (debugPrintEnv) runArgs.push("--debug-print-env");

  console.log(`[run] starting bench:swe:run ${runId}`);
  let r = spawnSync(process.execPath, runArgs, {
    cwd: ROOT,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);

  if (doEval) {
    console.log(`[eval] starting bench:swe:eval ${runId}`);
    const evalEnv = {
      ...env,
      PYTHONPATH: `${path.join(ROOT, "scripts", "win_resource_stub")}${path.delimiter}${
        process.env.PYTHONPATH || ""
      }`,
    };
    r = spawnSync(
      process.execPath,
      ["scripts/bench_swe_eval.js", "--run-id", runId, "--workers", "1"],
      {
        cwd: ROOT,
        env: {
          ...evalEnv,
          MOGU_EVAL_VIA_WSL: "0",
          PYTHONPATH: `${path.join(ROOT, "scripts", "win_swebench_lf")}${path.delimiter}${
            evalEnv.PYTHONPATH || ""
          }`,
        },
        stdio: "inherit",
        windowsHide: true,
      }
    );
    process.exit(r.status ?? 1);
  }
  console.log(`[run] done — next: npm run bench:swe:eval -- --run-id ${runId}`);
})();
