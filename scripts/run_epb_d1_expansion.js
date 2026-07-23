/**
 * EPB D1 sample expansion — clean baseline k=1 + official eval.
 *
 *   node scripts/lock_epb_d1_frame.js          # once
 *   node scripts/run_epb_d1_expansion.js --batch 1
 *   node scripts/run_epb_d1_expansion.js --batch 2   # only if protocol allows
 *   node scripts/run_epb_d1_expansion.js --decide    # recompute stop / Gate
 *
 * Rules: D1_EXPANSION_PROTOCOL.md — Spec Frozen · Option F OFF · no CT if n<5
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATE = "20260723";
const EPB_DIR = path.join(
  ROOT,
  "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_evidence_to_patch"
);
const FRAME_PATH = path.join(EPB_DIR, "D1_EXPANSION_FRAME.json");
const STATE_PATH = path.join(EPB_DIR, "D1_EXPANSION_STATE.json");
const LOG_PATH = path.join(EPB_DIR, "D1_EXPANSION_LOG.md");
const GATE_PATH = path.join(EPB_DIR, "SAMPLE_GATE.md");
const CACHE = path.join(ROOT, "benchmarks/swe-bench/cache");
const TASKS = path.join(CACHE, "tasks.json");
const TASKS_FULL = path.join(CACHE, "tasks_full_lite.json");
const TASKS_B1_BAK = path.join(CACHE, "tasks_b1_lite50_backup.json");

const argv = process.argv.slice(2);
const batchArg = (() => {
  const i = argv.indexOf("--batch");
  return i >= 0 ? Number(argv[i + 1]) : 0;
})();
const decideOnly = argv.includes("--decide");
const rescoreOnly = argv.includes("--rescore");
const limitArg = (() => {
  const i = argv.indexOf("--limit");
  return i >= 0 ? Number(argv[i + 1]) : 0;
})();

function loadFrame() {
  if (!fs.existsSync(FRAME_PATH)) {
    console.error("[d1] missing FRAME — run: node scripts/lock_epb_d1_frame.js");
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(FRAME_PATH, "utf8"));
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return {
      protocol: "D1_EXPANSION_PROTOCOL.md",
      seed: null,
      results: {},
      batch1_done: false,
      batch2_started: false,
      batch2_done: false,
      qualified: [],
      decision: null,
      updatedAt: null,
    };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function ensureFullTasks() {
  if (!fs.existsSync(TASKS_FULL)) {
    throw new Error("missing tasks_full_lite.json");
  }
  if (!fs.existsSync(TASKS_B1_BAK) && fs.existsSync(TASKS)) {
    fs.copyFileSync(TASKS, TASKS_B1_BAK);
    console.log(`[d1] backed up tasks.json → ${path.basename(TASKS_B1_BAK)}`);
  }
  fs.copyFileSync(TASKS_FULL, TASKS);
  console.log("[d1] tasks.json ← tasks_full_lite.json (300)");
}

function baseEnv() {
  return {
    ...process.env,
    MOGU_EVIDENCE_PATCH_BIND: "0",
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

function findInstanceResolved(runDir, instance) {
  const logs = path.join(runDir, "logs");
  if (fs.existsSync(logs)) {
    const stack = [logs];
    while (stack.length) {
      const d = stack.pop();
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) stack.push(p);
        else if (name === "report.json") {
          try {
            const j = JSON.parse(fs.readFileSync(p, "utf8"));
            const cell = j?.[instance];
            if (cell && typeof cell.resolved === "boolean") {
              return { resolved: cell.resolved, source: p };
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  // harness summary: moguai-*.<runId>.json
  if (fs.existsSync(runDir)) {
    for (const name of fs.readdirSync(runDir)) {
      if (!/^moguai-.*\.json$/i.test(name)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(runDir, name), "utf8"));
        const resolvedIds = j.resolved_ids || [];
        const unresolvedIds = j.unresolved_ids || [];
        const errorIds = j.error_ids || [];
        if (resolvedIds.includes(instance)) {
          return { resolved: true, source: name };
        }
        if (unresolvedIds.includes(instance)) {
          return { resolved: false, source: name };
        }
        if (errorIds.includes(instance)) {
          return { resolved: null, source: name, error: true };
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function scoreRun(runId, instance) {
  const dir = path.join(ROOT, "benchmarks/swe-bench/runs", runId);
  const metricsPath = path.join(dir, "metrics.json");
  let metrics = null;
  if (fs.existsSync(metricsPath)) {
    const m = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    metrics = (m.metrics || []).find((x) => x.instance_id === instance) || m.metrics?.[0] || m[0] || m;
  }
  const hit = findInstanceResolved(dir, instance);
  let outcome = "ERROR";
  if (hit?.error) outcome = "ERROR";
  else if (hit && typeof hit.resolved === "boolean") {
    outcome = hit.resolved ? "PASS" : "FAIL";
  } else if (metrics) {
    // eval missing — do not invent Fail
    outcome = "NO_EVAL";
  }
  return {
    instance,
    runId,
    outcome,
    resolved: hit?.resolved ?? null,
    verifyOk: metrics?.verifyOk ?? null,
    engineOk: metrics?.ok ?? metrics?.engineOk ?? null,
    patchBytes: metrics?.patchBytes ?? null,
    evalSource: hit?.source || null,
  };
}

function runOne(instance, idx, batch) {
  const short = instance.replace(/^django__django-/, "dj").replace(/^astropy__astropy-/, "as");
  const runId = `epb-d1-b${batch}-${short}-${DATE}`;
  const work = path.join(ROOT, "benchmarks/swe-bench", `work-epb-d1-b${batch}`);
  const dir = path.join(ROOT, "benchmarks/swe-bench/runs", runId);
  if (fs.existsSync(dir)) {
    const scored = scoreRun(runId, instance);
    if (scored.outcome === "PASS" || scored.outcome === "FAIL") {
      console.log(`[d1] skip complete ${runId} → ${scored.outcome}`);
      return scored;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[d1] removed incomplete ${runId}`);
  }
  const env = { ...baseEnv(), MOGU_BENCH_WORKDIR: work };
  console.log(`\n======== [b${batch} ${idx}] ${runId} ========`);
  const r = spawnSync(
    process.execPath,
    ["scripts/bench_swe_wait_relay.js", runId, "--eval", "--only", instance],
    { cwd: ROOT, env, stdio: "inherit", windowsHide: true }
  );
  if ((r.status ?? 1) !== 0) {
    console.error(`[d1] runner exit ${r.status} for ${instance}`);
  }
  return scoreRun(runId, instance);
}

function recompute(state) {
  const qualified = Object.values(state.results)
    .filter((r) => r.outcome === "FAIL")
    .map((r) => r.instance)
    .sort();
  state.qualified = [...new Set(qualified)];
  const n = state.qualified.length;
  const inspected = Object.keys(state.results).length;

  let decision = null;
  if (n >= 5) {
    decision = {
      exit: "A",
      action: "CLOSE_GATE_START_CT",
      qualified_n: n,
      note: "Gate CLOSED with first 5 Fail Class-C; start EPB CT",
    };
  } else if (state.batch1_done && !state.batch2_started && n <= 2) {
    decision = {
      exit: "B",
      action: "SEAL",
      qualified_n: n,
      note: "Batch-1 stop: qualified_n≤2 — no Batch-2; strategy seal",
    };
  } else if (state.batch1_done && !state.batch2_started && n >= 3 && n <= 4) {
    decision = {
      exit: null,
      action: "RUN_BATCH_2",
      qualified_n: n,
      note: "Batch-1 yielded 3–4 — one Batch-2 allowed",
    };
  } else if (state.batch2_done || inspected >= 100) {
    decision = {
      exit: "B",
      action: "SEAL",
      qualified_n: n,
      note: "Cap/Batch-2 exhausted with qualified_n<5 — unproven · sample-constrained",
    };
  } else {
    decision = {
      exit: null,
      action: "CONTINUE",
      qualified_n: n,
      note: "in progress",
    };
  }
  state.decision = decision;
  return state;
}

function writeLog(state, frame) {
  const rows = Object.values(state.results).sort((a, b) =>
    a.instance.localeCompare(b.instance)
  );
  const lines = [
    "# EPB D1 Expansion Log",
    "",
    "```yaml",
    `seed: ${frame.seed}`,
    `frame_n: ${frame.frame_n}`,
    `inspected: ${rows.length}`,
    `qualified_n: ${state.qualified.length}`,
    `batch1_done: ${state.batch1_done}`,
    `batch2_done: ${state.batch2_done}`,
    `decision: ${JSON.stringify(state.decision)}`,
    `updatedAt: ${state.updatedAt}`,
    "```",
    "",
    "## Qualified Fail Class-C",
    "",
    ...(state.qualified.length
      ? state.qualified.map((id) => `- \`${id}\``)
      : ["_(none yet)_"]),
    "",
    "## Results",
    "",
    "| instance | outcome | runId |",
    "|----------|---------|-------|",
    ...rows.map((r) => `| \`${r.instance}\` | **${r.outcome}** | \`${r.runId}\` |`),
    "",
    "## Wording",
    "",
    "> EPB mechanism runnable (prior Smoke); effectiveness not established.",
    "> Insufficient qualifying samples **in this frame/budget** — not “samples do not exist”.",
    "",
  ];
  fs.writeFileSync(LOG_PATH, lines.join("\n"));
}

function closeGateIfReady(state) {
  if (!state.decision || state.decision.action !== "CLOSE_GATE_START_CT") return;
  const set = state.qualified.slice(0, 5);
  const text = `# EPB Sample Gate

\`\`\`yaml
status: CLOSED
n_target: 5
k: 3
branch_map: E   # A≥4/5 · B=3/5 · C≤2/5
closed_via: D1_EXPANSION_PROTOCOL
closed_at: ${new Date().toISOString()}
\`\`\`

## Rules (LOCKED by Spec Review)

**Include：** Class-C · new to this feedback-strategy chain · in-loop verify-fail capable · Fail baseline preferred.

**Hard exclude from scoring：**

\`\`\`text
django__django-13265
django__django-11019
django__django-15695
django__django-12497
django__django-15781
\`\`\`

## Scoring set

\`\`\`yaml
scoring_set: [${set.map((s) => `'${s}'`).join(", ")}]
discovered: ${JSON.stringify(set)}
qualified_n5: ${set.length}
discovery_log: D1_EXPANSION_LOG.md
outcome: CLOSED via D1 expansion Batch results
\`\`\`

## CT readiness

\`\`\`text
CT allowed — SAMPLE_GATE CLOSED · scoring_set length == 5
node scripts/run_b2_evidence_patch_bind_ct.js --ct
\`\`\`
`;
  fs.writeFileSync(GATE_PATH, text);
  console.log(`[d1] SAMPLE_GATE CLOSED with ${set.length}: ${set.join(", ")}`);
}

function sealIfNeeded(state) {
  if (!state.decision || state.decision.action !== "SEAL") return;
  const sealPath = path.join(EPB_DIR, "STRATEGY_SEAL.md");
  fs.writeFileSync(
    sealPath,
    `# Strategy Experiment Seal — EPB sample-constrained

\`\`\`yaml
date: ${new Date().toISOString().slice(0, 10)}
exit: B
qualified_n: ${state.qualified.length}
status: SEALED
\`\`\`

## Conclusion (LOCKED wording)

> EPB has demonstrated that the mechanism can run (Smoke PASS),
> but has **not** demonstrated effectiveness (no completed n=5 CT).
> Under the current pool, frozen eligibility rules, and the pre-registered
> D1 expansion budget (≤100), **insufficient qualifying samples were found
> in-range**.

This is **not** a claim that qualifying samples do not exist anywhere.
This is **not** a claim that EPB is ineffective.
Smoke PASS is engineering feasibility evidence, not effect evidence.

## Forbidden after seal

- further D1 batches beyond protocol
- Option F / hard-exclude recycle
- CT with \`qualified_n < 5\`
- Branch → default-on

See \`D1_EXPANSION_PROTOCOL.md\` · \`D1_EXPANSION_LOG.md\`.
`
  );
  console.log(`[d1] STRATEGY_SEAL.md written (Exit B)`);
}

function runBatch(batchNum) {
  const frame = loadFrame();
  const state = loadState();
  state.seed = frame.seed;
  const ids = batchNum === 1 ? frame.batch1 : frame.batch2;
  if (!ids?.length) {
    console.error(`[d1] batch ${batchNum} empty`);
    process.exit(2);
  }
  if (batchNum === 2) {
    recompute(state);
    if (state.decision?.action !== "RUN_BATCH_2" && !state.batch2_started) {
      console.error(
        `[d1] Batch-2 blocked by protocol. decision=${JSON.stringify(state.decision)}`
      );
      process.exit(3);
    }
    state.batch2_started = true;
  }

  ensureFullTasks();
  saveState(state);

  let todo = ids.filter((id) => {
    const prev = state.results[id];
    return !(prev && (prev.outcome === "PASS" || prev.outcome === "FAIL"));
  });
  if (limitArg > 0) todo = todo.slice(0, limitArg);

  console.log(
    `[d1] batch=${batchNum} todo=${todo.length}/${ids.length} model=${process.env.MOGU_BENCH_MODEL || "gpt-5.5"}`
  );

  let i = 0;
  for (const instance of todo) {
    i += 1;
    const scored = runOne(instance, i, batchNum);
    state.results[instance] = scored;
    recompute(state);
    saveState(state);
    writeLog(state, frame);
    console.log(
      `[d1] progress qualified_n=${state.qualified.length} last=${instance}→${scored.outcome}`
    );
    if (state.qualified.length >= 5) {
      console.log("[d1] early stop: qualified_n≥5");
      break;
    }
  }

  // mark batch complete if all ids scored or early stop with n≥5
  const allDone = ids.every((id) => {
    const r = state.results[id];
    return r && (r.outcome === "PASS" || r.outcome === "FAIL" || r.outcome === "ERROR" || r.outcome === "NO_EVAL");
  });
  if (batchNum === 1 && (allDone || state.qualified.length >= 5)) state.batch1_done = true;
  if (batchNum === 2 && (allDone || state.qualified.length >= 5)) state.batch2_done = true;

  recompute(state);
  saveState(state);
  writeLog(state, frame);
  closeGateIfReady(state);
  sealIfNeeded(state);

  console.log(`\n[d1] decision=${JSON.stringify(state.decision, null, 2)}`);
  if (state.decision?.action === "CLOSE_GATE_START_CT") {
    console.log("[d1] next: wire CT jobs from SAMPLE_GATE scoring_set");
  } else if (state.decision?.action === "RUN_BATCH_2") {
    console.log("[d1] next: node scripts/run_epb_d1_expansion.js --batch 2");
  } else if (state.decision?.action === "SEAL") {
    console.log("[d1] sealed — no CT");
  }
}

function decide() {
  const frame = loadFrame();
  const state = recompute(loadState());
  saveState(state);
  writeLog(state, frame);
  closeGateIfReady(state);
  sealIfNeeded(state);
  console.log(JSON.stringify(state.decision, null, 2));
  console.log(`qualified_n=${state.qualified.length}`);
  console.log(state.qualified.join("\n"));
}

function rescore() {
  const frame = loadFrame();
  const state = loadState();
  const ids = [...frame.batch1, ...frame.batch2];
  for (const instance of ids) {
    const short = instance.replace(/^django__django-/, "dj").replace(/^astropy__astropy-/, "as");
    for (const batch of [1, 2]) {
      const runId = `epb-d1-b${batch}-${short}-${DATE}`;
      const dir = path.join(ROOT, "benchmarks/swe-bench/runs", runId);
      if (!fs.existsSync(dir)) continue;
      const scored = scoreRun(runId, instance);
      state.results[instance] = scored;
      console.log(`[rescore] ${instance} → ${scored.outcome} (${scored.evalSource || "-"})`);
    }
  }
  // batch completeness from scored ids
  state.batch1_done = frame.batch1.every((id) => {
    const r = state.results[id];
    return r && ["PASS", "FAIL", "ERROR", "NO_EVAL"].includes(r.outcome);
  });
  state.batch2_done =
    state.batch2_started &&
    frame.batch2.every((id) => {
      const r = state.results[id];
      return r && ["PASS", "FAIL", "ERROR", "NO_EVAL"].includes(r.outcome);
    });
  recompute(state);
  saveState(state);
  writeLog(state, frame);
  closeGateIfReady(state);
  sealIfNeeded(state);
  console.log(JSON.stringify(state.decision, null, 2));
}

if (rescoreOnly) {
  rescore();
} else if (decideOnly) {
  decide();
} else if (batchArg === 1 || batchArg === 2) {
  runBatch(batchArg);
} else {
  console.error(`usage:
  node scripts/lock_epb_d1_frame.js
  node scripts/run_epb_d1_expansion.js --batch 1 [--limit N]
  node scripts/run_epb_d1_expansion.js --batch 2
  node scripts/run_epb_d1_expansion.js --rescore
  node scripts/run_epb_d1_expansion.js --decide
`);
  process.exit(2);
}
