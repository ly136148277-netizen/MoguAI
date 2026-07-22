#!/usr/bin/env node
/** Aggregate B2-D2′ CT → aggregate.json for RESULTS.md */
const fs = require("fs");
const path = require("path");
const { jaccardPatch, normalizeFileSet, sameFileSet } = require("../src/main/skills/coding-d2-diversity");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "benchmarks", "swe-bench", "runs");
const DATE = "20260722";
const JOBS = [
  ["django__django-13265", "ct-b2d2p-django13265", "known"],
  ["django__django-12497", "ct-b2d2p-django12497", "known"],
  ["django__django-11019", "ct-b2d2p-django11019", "reuse-blind"],
  ["django__django-15695", "ct-b2d2p-django15695", "reuse-blind"],
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
  const div = m.d2Diversity || null;
  const d2 = m.d2Retry || null;
  const classes = d2?.classifications || [];
  const p2pReg =
    classes.includes("p2p_regression") ||
    (m.failToPassOk === true && m.passToPassOk === false);

  return {
    cell,
    source,
    d2,
    d2Diversity: div,
    verifyOk: m.verifyOk ?? null,
    failToPassOk: m.failToPassOk ?? null,
    passToPassOk: m.passToPassOk ?? null,
    p2p_regression_signal: Boolean(p2pReg),
    engineOk: m.ok ?? null,
    elapsedMs: m.elapsedMs ?? null,
    patch,
    patchFiles: filesFromPatch(patch),
    patchBytes: Buffer.byteLength(patch, "utf8"),
    harnessFile: harness?.file || null,
    reportPath: reportPath ? path.relative(dir, reportPath) : null,
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

  // Cross-repeat final-patch Jaccard pairs
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

  // Within-run cycle metrics from d2Diversity.cycles
  const cycleDiag = c.map((x) => {
    const cycles = x.d2Diversity?.cycles || [];
    return {
      i: x.i,
      enabled: x.d2Diversity?.enabled ?? false,
      blockedPatchCount: x.d2Diversity?.blockedPatchCount ?? null,
      cycles: cycles.map((cy) => ({
        cycle: cy.cycle,
        jaccard_patch: cy.jaccard_patch,
        file_set_changed: cy.file_set_changed,
        hypothesis: String(cy.hypothesis || "").slice(0, 120),
        candidates_n: cy.candidates_n,
      })),
    };
  });

  const p2pCount = c.filter((x) => x.p2p_regression_signal).length;

  rows.push({
    instance,
    role,
    c: c.map(({ patch, ...rest }) => ({
      ...rest,
      patch_omitted: true,
      patchBytes: rest.patchBytes,
    })),
    resolved_k: `${resolved}/3`,
    resolved_n: resolved,
    improvement,
    cross_repeat_jaccard: pairs,
    cycle_diagnostics: cycleDiag,
    p2p_regression_runs: p2pCount,
  });
}

const improved = rows.filter((r) => r.improvement).length;
let branch = "C";
if (improved >= 3) branch = "A";
else if (improved === 2) branch = "B";
else branch = "C";

const knownImp = rows.filter((r) => r.role === "known" && r.improvement).length;
const reuseBlindImp = rows.filter((r) => r.role === "reuse-blind" && r.improvement).length;
if (branch === "A" && knownImp > 0 && reuseBlindImp === 0) branch = "B";

const totalRuns = rows.reduce((n, r) => n + r.c.length, 0);
const p2pRuns = rows.reduce((n, r) => n + r.p2p_regression_runs, 0);
const unresolvedRuns = rows.reduce(
  (n, r) => n + r.c.filter((x) => x.cell === "U" || x.cell === "∅").length,
  0
);

const out = {
  experiment_id: "B2-D2-PRIME",
  date: DATE,
  model: "gpt-5.5",
  intervention: "MOGU_D2_STRUCTURED_RETRY=1 + MOGU_D2_HYPOTHESIS_DIVERSITY=1",
  rows,
  improved_count: improved,
  branch,
  known_improved: knownImp,
  reuse_blind_improved: reuseBlindImp,
  regression_rate: {
    p2p_signal_runs: p2pRuns,
    total_runs: totalRuns,
    rate: Number((p2pRuns / totalRuns).toFixed(4)),
    unresolved_runs: unresolvedRuns,
    note: "p2p_regression_signal from d2 classifications or F2P✓∧P2P✗ metrics",
  },
};

const outDir = path.join(
  ROOT,
  "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_d2_prime"
);
fs.writeFileSync(path.join(outDir, "aggregate.json"), JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      branch: out.branch,
      improved_count: out.improved_count,
      rows: out.rows.map((r) => ({
        instance: r.instance,
        role: r.role,
        cells: r.c.map((x) => x.cell),
        resolved_k: r.resolved_k,
        improvement: r.improvement,
        cross_jaccard: r.cross_repeat_jaccard,
      })),
      regression_rate: out.regression_rate,
    },
    null,
    2
  )
);
