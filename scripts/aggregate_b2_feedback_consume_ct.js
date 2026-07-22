#!/usr/bin/env node
/** Aggregate Feedback-Consumption CT (Option F) → aggregate.json */
const fs = require("fs");
const path = require("path");
const { jaccardPatch, normalizeFileSet, sameFileSet } = require("../src/main/skills/coding-d2-diversity");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "benchmarks", "swe-bench", "runs");
const OUT = path.join(
  ROOT,
  "benchmarks",
  "swe-bench",
  "runs",
  "post_s3",
  "b1_lite50",
  "controlled_trials",
  "b2_feedback_consumption"
);
const DATE = "20260722";
const JOBS = [
  ["django__django-13265", "ct-fc-django13265", "reuse-pool"],
  ["django__django-11019", "ct-fc-django11019", "reuse-pool"],
  ["django__django-15695", "ct-fc-django15695", "reuse-pool"],
];

function walkFind(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const r = walkFind(p, name);
      if (r) return r;
    } else if (ent.name === name) return p;
  }
  return null;
}

function loadHarness(dir, runId) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    if (!f.includes(runId) && !f.startsWith("moguai-")) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (
        j.resolved_ids ||
        j.unresolved_ids ||
        j.error_ids ||
        typeof j.total_resolved === "number" ||
        j.resolved
      ) {
        return { file: f, data: j };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function listHas(list, id) {
  if (!list) return false;
  if (Array.isArray(list)) return list.includes(id);
  if (typeof list === "object") return Boolean(list[id]);
  return false;
}

function readPredPatch(dir) {
  const pred = path.join(dir, "predictions.jsonl");
  if (!fs.existsSync(pred)) return "";
  const line = fs.readFileSync(pred, "utf8").split(/\n/).find((l) => l.trim());
  if (!line) return "";
  try {
    return String(JSON.parse(line).model_patch || "");
  } catch {
    return "";
  }
}

function filesFromPatch(patch) {
  const files = [];
  for (const m of String(patch || "").matchAll(/^diff --git a\/(.+?) b\//gm)) {
    files.push(m[1]);
  }
  return normalizeFileSet(files);
}

function loadConsumeArts(dir, instance) {
  const roots = [
    path.join(dir, "feedback_consume", instance),
    path.join(dir, "feedback_consume", instance.replace(/[^\w.-]+/g, "_")),
    path.join(dir, "feedback_consume"),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = fs.readdirSync(root).filter((f) => /^consume_\d+\.json$/.test(f));
    if (files.length) {
      const cycles = files
        .sort()
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return { root, cycles };
    }
    try {
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const sub = path.join(root, ent.name);
        const subFiles = fs.readdirSync(sub).filter((f) => /^consume_\d+\.json$/.test(f));
        if (subFiles.length) {
          const cycles = subFiles
            .sort()
            .map((f) => JSON.parse(fs.readFileSync(path.join(sub, f), "utf8")));
          return { root: sub, cycles };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { root: null, cycles: [] };
}

function outcome(runId, instance) {
  const dir = path.join(RUNS, runId);
  if (!fs.existsSync(dir)) return { cell: "E", detail: "missing_run_dir" };
  const pred = path.join(dir, "predictions.jsonl");
  const met = path.join(dir, "metrics.json");
  if (!fs.existsSync(pred) || !fs.existsSync(met)) {
    return { cell: "E", detail: "missing_pred_or_metrics" };
  }
  const metrics = JSON.parse(fs.readFileSync(met, "utf8"));
  const m = (metrics.metrics || [])[0] || {};
  const harness = loadHarness(dir, runId);
  const reportPath = walkFind(path.join(dir, "logs"), "report.json");
  let report = null;
  if (reportPath) {
    try {
      report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch {
      report = null;
    }
  }

  let cell = null;
  let source = null;
  if (harness?.data) {
    const h = harness.data;
    if (listHas(h.resolved_ids, instance) || listHas(h.resolved, instance)) {
      cell = "R";
      source = harness.file;
    } else if (listHas(h.unresolved_ids, instance) || listHas(h.unresolved, instance)) {
      cell = "U";
      source = harness.file;
    } else if (listHas(h.empty_patch_ids, instance)) {
      cell = "∅";
      source = harness.file;
    } else if (listHas(h.error_ids, instance) || listHas(h.errors, instance)) {
      cell = "E";
      source = harness.file;
    }
  }
  if (!cell && report) {
    const inst = report[instance] || report;
    if (inst.resolved === true) {
      cell = "R";
      source = "report.json";
    } else if (inst.resolved === false) {
      cell = "U";
      source = "report.json";
    }
  }
  if (!cell) cell = "E";

  const patch = readPredPatch(dir);
  const fc = m.feedbackConsume || null;
  const fb = m.feedbackPack || null;
  const arts = loadConsumeArts(dir, instance);
  const tools = Array.isArray(m.toolsUsed) ? m.toolsUsed : [];
  const consumeCalls = tools.filter((t) => t === "record_failure_consumption").length;
  const runTestsCount = tools.filter((t) => t === "run_tests").length;

  // Authority: metrics + toolsUsed of the FINAL attempt (not stale retry artifacts on disk).
  const validCount = Number(fc?.validCount || 0);
  const gateBlocks = Number(fc?.gateBlocks || 0);
  const gateTriggered = validCount > 0 || consumeCalls > 0;
  const firstShotNoConsume =
    (cell === "R" || m.verifyOk === true) &&
    !gateTriggered &&
    consumeCalls === 0 &&
    runTestsCount <= 1;

  const C1 = gateTriggered || gateBlocks > 0 || Boolean(fc?.C1_any);
  const C2 = validCount > 0 || Boolean(fc?.C2_valid_count > 0);
  const C3 = fc?.C3_any === true;
  const C4 = fc?.C4_any === true;

  // Disk artifacts are diagnostic only (instance retries may leave prior consume_*.json).
  const diskValid = (arts.cycles || []).filter((c) => c.ok === true);
  const diskStaleSuspect =
    diskValid.length > 0 && validCount === 0 && consumeCalls === 0;

  const p2pReg = m.failToPassOk === true && m.passToPassOk === false;

  return {
    cell,
    source,
    feedbackConsume: fc,
    feedbackPack: fb,
    d2Enabled: Boolean(m.d2Retry?.enabled),
    divEnabled: Boolean(m.d2Diversity?.enabled),
    verifyOk: m.verifyOk ?? null,
    failToPassOk: m.failToPassOk ?? null,
    passToPassOk: m.passToPassOk ?? null,
    p2p_regression_signal: Boolean(p2pReg),
    engineOk: m.ok ?? null,
    elapsedMs: m.elapsedMs ?? null,
    patch,
    patchFiles: filesFromPatch(patch),
    patchBytes: Buffer.byteLength(patch, "utf8"),
    toolsUsed: tools,
    consumeCalls,
    runTestsCount,
    gateTriggered,
    firstShotNoConsume,
    diskStaleSuspect,
    validCount,
    gateBlocks,
    C1,
    C2,
    C3,
    C4,
    consumeCyclesDisk: arts.cycles,
    artRoot: arts.root,
  };
}

const rows = [];
for (const [instance, prefix, role] of JOBS) {
  const c = [];
  for (let i = 1; i <= 3; i += 1) {
    const runId = `${prefix}-c${i}-${DATE}`;
    c.push({ i, runId, ...outcome(runId, instance) });
  }
  const resolved = c.filter((x) => x.cell === "R").length;
  const improvement = resolved >= 2;

  const pairs = [];
  for (let a = 0; a < 3; a += 1) {
    for (let b = a + 1; b < 3; b += 1) {
      if (!c[a].patch && !c[b].patch) continue;
      pairs.push({
        pair: `c${a + 1}-c${b + 1}`,
        jaccard: Number(jaccardPatch(c[a].patch, c[b].patch).toFixed(4)),
        file_set_same: sameFileSet(c[a].patchFiles, c[b].patchFiles),
      });
    }
  }

  const rRuns = c.filter((x) => x.cell === "R");
  const rWithGate = rRuns.filter((x) => x.gateTriggered);
  const rFirstShot = rRuns.filter((x) => x.firstShotNoConsume);
  const rWithC3C4 = rRuns.filter((x) => x.C3 && x.C4);

  rows.push({
    instance,
    role,
    cells: c.map((x) => x.cell).join(""),
    resolved_k: `${resolved}/3`,
    improvement,
    mechanism_on_improvements: {
      resolved_runs: rRuns.length,
      gate_triggered_among_R: rWithGate.length,
      first_shot_R_no_consume: rFirstShot.length,
      C3_and_C4_among_R: rWithC3C4.length,
      note:
        rFirstShot.length > 0
          ? "WARNING: some R without consumption gate — do not attribute to FC mechanism"
          : null,
    },
    cross_repeat_jaccard: pairs,
    runs: c.map((x) => ({
      i: x.i,
      runId: x.runId,
      cell: x.cell,
      source: x.source,
      engineOk: x.engineOk,
      verifyOk: x.verifyOk,
      failToPassOk: x.failToPassOk,
      passToPassOk: x.passToPassOk,
      p2p_regression_signal: x.p2p_regression_signal,
      elapsedMs: x.elapsedMs,
      patchBytes: x.patchBytes,
      patchFiles: x.patchFiles,
      packEnabled: x.feedbackPack?.enabled === true,
      consumeEnabled: x.feedbackConsume?.enabled === true,
      d2Enabled: x.d2Enabled,
      divEnabled: x.divEnabled,
      gateTriggered: x.gateTriggered,
      firstShotNoConsume: x.firstShotNoConsume,
      diskStaleSuspect: x.diskStaleSuspect,
      consumeCalls: x.consumeCalls,
      runTestsCount: x.runTestsCount,
      validCount: x.validCount,
      gateBlocks: x.gateBlocks,
      C1: x.C1,
      C2: x.C2,
      C3: x.C3,
      C4: x.C4,
    })),
  });
}

const improved = rows.filter((r) => r.improvement).length;
let branch = "C";
if (improved >= 2) branch = "A";
else if (improved === 1) branch = "B";

const allRuns = rows.flatMap((r) => r.runs);
const aggregate = {
  experiment_id: "B2-FEEDBACK-CONSUMPTION",
  sample_option: "F",
  evidence_scope: "instance (reused)",
  threat: "prior exposure",
  date: DATE,
  n: 3,
  k: 3,
  scoring_set: JOBS.map((j) => j[0]),
  excluded: ["django__django-12497"],
  improvement_count: improved,
  improvement_rate: improved / 3,
  branch,
  branch_rule: "F map: A>=2/3 · B=1/3 · C=0/3",
  branch_note: "Branch != Mechanism proof. Positive ≠ default-on. No cross-CT ranking.",
  p2p_regression_rate: `${allRuns.filter((x) => x.p2p_regression_signal).length}/9`,
  mechanism_totals: {
    pack_enabled: `${allRuns.filter((x) => x.packEnabled).length}/9`,
    consume_enabled: `${allRuns.filter((x) => x.consumeEnabled).length}/9`,
    gate_triggered: `${allRuns.filter((x) => x.gateTriggered).length}/9`,
    first_shot_R_no_consume: `${allRuns.filter((x) => x.firstShotNoConsume).length}/9`,
    C1: `${allRuns.filter((x) => x.C1).length}/9`,
    C2: `${allRuns.filter((x) => x.C2).length}/9`,
    C3: `${allRuns.filter((x) => x.C3).length}/9`,
    C4: `${allRuns.filter((x) => x.C4).length}/9`,
  },
  rows,
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "aggregate.json"), JSON.stringify(aggregate, null, 2), "utf8");
console.log(`Branch ${branch} improvement=${improved}/3`);
console.log(JSON.stringify(aggregate.mechanism_totals, null, 2));
