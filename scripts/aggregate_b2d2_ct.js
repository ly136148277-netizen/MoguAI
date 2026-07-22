#!/usr/bin/env node
/** Aggregate B2-D2 CT outcomes into JSON for RESULTS.md */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "benchmarks", "swe-bench", "runs");
const JOBS = [
  ["django__django-13265", "ct-b2d2-django13265", "known"],
  ["django__django-12497", "ct-b2d2-django12497", "known"],
  ["django__django-11019", "ct-b2d2-django11019", "blind"],
  ["django__django-15695", "ct-b2d2-django15695", "blind"],
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

  return {
    cell,
    source,
    d2: m.d2Retry || null,
    verifyOk: m.verifyOk ?? null,
    engineOk: m.ok ?? null,
    elapsedMs: m.elapsedMs ?? null,
    harnessFile: harness?.file || null,
    reportPath: reportPath ? path.relative(dir, reportPath) : null,
  };
}

const rows = [];
for (const [instance, prefix, role] of JOBS) {
  const c = [];
  for (let i = 1; i <= 3; i += 1) {
    const runId = `${prefix}-c${i}-20260721`;
    c.push({ i, runId, ...outcome(runId, instance) });
  }
  const resolved = c.filter((x) => x.cell === "R").length;
  const improvement = resolved >= 2;
  rows.push({ instance, role, c, resolved_k: `${resolved}/3`, improvement });
}

const improved = rows.filter((r) => r.improvement).length;
let branch = "C";
if (improved >= 3) branch = "A";
else if (improved === 2) branch = "B";
else branch = "C";

const knownImp = rows.filter((r) => r.role === "known" && r.improvement).length;
const blindImp = rows.filter((r) => r.role === "blind" && r.improvement).length;
if (branch === "A" && knownImp > 0 && blindImp === 0) branch = "B"; // overfitting rule

const out = {
  intervention_hash: fs
    .readFileSync(
      path.join(
        ROOT,
        "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_d2/INTERVENTION_HASH.txt"
      ),
      "utf8"
    )
    .trim(),
  rows,
  improved_count: improved,
  branch,
  known_improved: knownImp,
  blind_improved: blindImp,
};

const outPath = path.join(
  ROOT,
  "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_d2/aggregate.json"
);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
