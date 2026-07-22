#!/usr/bin/env node
/** Aggregate Feedback-B CT → aggregate.json for RESULTS.md (§7 M1–M10). */
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
  "b2_feedback_b"
);
const DATE = "20260722";
const JOBS = [
  ["django__django-13265", "ct-fb-django13265", "reuse-pool"],
  ["django__django-11019", "ct-fb-django11019", "reuse-pool"],
  ["django__django-15695", "ct-fb-django15695", "reuse-pool"],
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

function findPackMeta(dir, instance) {
  const roots = [
    path.join(dir, "feedback_pack", instance),
    path.join(dir, "feedback_pack", instance.replace(/[^\w.-]+/g, "_")),
    path.join(dir, "feedback_pack"),
  ];
  for (const root of roots) {
    const metaPath = path.join(root, "meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        return { root, meta: JSON.parse(fs.readFileSync(metaPath, "utf8")) };
      } catch {
        /* ignore */
      }
    }
    if (!fs.existsSync(root)) continue;
    try {
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const p = path.join(root, ent.name, "meta.json");
        if (fs.existsSync(p)) {
          return { root: path.join(root, ent.name), meta: JSON.parse(fs.readFileSync(p, "utf8")) };
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { root: null, meta: null };
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
  const fb = m.feedbackPack || null;
  const pack = findPackMeta(dir, instance);
  const d2 = m.d2Retry || null;
  const div = m.d2Diversity || null;
  const p2pReg =
    (m.failToPassOk === true && m.passToPassOk === false) ||
    fb?.failure_class === "p2p_regression";

  return {
    cell,
    source,
    feedbackPack: fb,
    packMeta: pack.meta,
    packRoot: pack.root,
    d2Enabled: Boolean(d2?.enabled),
    divEnabled: Boolean(div?.enabled),
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
    M1_enabled: fb?.enabled === true,
    M2_has_status_prefix: Boolean(fb?.has_status_prefix),
    M3_has_elide_or_head_tail: Boolean(fb?.has_elide_marker || fb?.head_tail),
    M4_failure_class: fb?.failure_class || null,
    M5_full_log_path: Boolean(fb?.full_log_path),
    M6_read_full_log: Boolean(fb?.tools_read_full_log),
    M7_hypothesis_cites_feedback: fb?.hypothesis_cites_feedback === true,
    M8_hypothesis_text_changed: fb?.hypothesis_text_changed === true,
    M9_jaccard_patch: fb?.jaccard_patch ?? null,
    M9_file_set_changed: fb?.file_set_changed ?? null,
    M10_stack_anchor_changed: fb?.stack_anchor_changed ?? null,
    packCount: fb?.packCount ?? 0,
    // Disk meta is diagnostic only (retries may leave stale packs).
    disk_meta_seq: pack.meta?.seq ?? null,
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

  const p2pCount = c.filter((x) => x.p2p_regression_signal).length;
  const m6Yes = c.filter((x) => x.M6_read_full_log).length;
  const m7Yes = c.filter((x) => x.M7_hypothesis_cites_feedback).length;
  const m8Yes = c.filter((x) => x.M8_hypothesis_text_changed).length;
  const packLanded = c.filter((x) => x.M1_enabled && Number(x.packCount) > 0).length;

  rows.push({
    instance,
    role,
    cells: c.map((x) => x.cell).join(""),
    resolved_k: `${resolved}/3`,
    improvement,
    p2p_regression_runs: p2pCount,
    pack_landed_runs: packLanded,
    M6_read_full_log_runs: m6Yes,
    M7_cites_feedback_runs: m7Yes,
    M8_hypothesis_changed_runs: m8Yes,
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
      d2Enabled: x.d2Enabled,
      divEnabled: x.divEnabled,
      M1_enabled: x.M1_enabled,
      M2_has_status_prefix: x.M2_has_status_prefix,
      M3_has_elide_or_head_tail: x.M3_has_elide_or_head_tail,
      M4_failure_class: x.M4_failure_class,
      M5_full_log_path: x.M5_full_log_path,
      M6_read_full_log: x.M6_read_full_log,
      M7_hypothesis_cites_feedback: x.M7_hypothesis_cites_feedback,
      M8_hypothesis_text_changed: x.M8_hypothesis_text_changed,
      M9_jaccard_patch: x.M9_jaccard_patch,
      M9_file_set_changed: x.M9_file_set_changed,
      M10_stack_anchor_changed: x.M10_stack_anchor_changed,
      packCount: x.packCount,
    })),
  });
}

const improved = rows.filter((r) => r.improvement).length;
const rate = improved / 3;
let branch = "C";
if (improved >= 2) branch = "A";
else if (improved === 1) branch = "B";

const allRuns = rows.flatMap((r) => r.runs);
const p2pTotal = allRuns.filter((x) => x.p2p_regression_signal).length;
const m6Total = allRuns.filter((x) => x.M6_read_full_log).length;
const m7Total = allRuns.filter((x) => x.M7_hypothesis_cites_feedback).length;
const packOk = allRuns.filter((x) => x.M1_enabled && Number(x.packCount) > 0).length;
const firstShotNoFailPack = allRuns.filter(
  (x) => x.M1_enabled && Number(x.packCount) === 0 && x.cell === "R"
).length;

const aggregate = {
  experiment_id: "B2-FEEDBACK-B",
  date: DATE,
  n: 3,
  k: 3,
  scoring_set: JOBS.map((j) => j[0]),
  excluded: ["django__django-12497"],
  improvement_count: improved,
  improvement_rate: rate,
  branch,
  branch_rule: "A>=2/3 · B=1/3 · C=0/3",
  p2p_regression_rate: `${p2pTotal}/9`,
  mechanism_totals: {
    pack_enabled_flag: `${allRuns.filter((x) => x.M1_enabled).length}/9`,
    pack_emitted_packCount_gt0: `${packOk}/9`,
    first_shot_R_no_fail_pack: firstShotNoFailPack,
    M6_read_full_log: `${m6Total}/9`,
    M7_hypothesis_cites_feedback: `${m7Total}/9`,
    M8_hypothesis_text_changed: `${allRuns.filter((x) => x.M8_hypothesis_text_changed).length}/9`,
  },
  rows,
};

fs.mkdirSync(OUT, { recursive: true });
const outPath = path.join(OUT, "aggregate.json");
fs.writeFileSync(outPath, JSON.stringify(aggregate, null, 2), "utf8");
console.log(`wrote ${outPath}`);
console.log(
  `Branch ${branch} improvement=${improved}/3 pack=${packOk}/9 M6=${m6Total}/9 M7=${m7Total}/9`
);
