#!/usr/bin/env node
/** Read-only diagnostic dump for D2′ Branch B (no new experiment). */
const fs = require("fs");
const path = require("path");
const { jaccardPatch } = require("../src/main/skills/coding-d2-diversity");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "benchmarks", "swe-bench", "runs");
const agg = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT,
      "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_d2_prime/aggregate.json"
    ),
    "utf8"
  )
);

function parseHypMd(mdPath) {
  if (!fs.existsSync(mdPath)) return null;
  const t = fs.readFileSync(mdPath, "utf8");
  const sel = (/## Selected\s*\n([\s\S]*?)\n## /i.exec(t) || [])[1] || "";
  let meta = {};
  const jm = /```json\n([\s\S]*?)\n```/i.exec(t);
  if (jm) {
    try {
      meta = JSON.parse(jm[1]);
    } catch {
      meta = {};
    }
  }
  return {
    selected: sel.trim().replace(/\s+/g, " ").slice(0, 200),
    candidates_n: meta.candidate_hypotheses_n || (meta.candidates || []).length || 0,
    candidates: (meta.candidates || []).map((c) => String(c).slice(0, 100)),
    previous_hypothesis: String(meta.previous_hypothesis || "").slice(0, 160),
    file_set_changed_vs_prev: meta.file_set_changed_vs_prev,
    hypothesis_text_changed: meta.hypothesis_text_changed,
    target_files: meta.target_files || [],
  };
}

function dumpRun(runId, instance) {
  const root = path.join(RUNS, runId, "d2_cycles", instance);
  const out = { runId, cycles: {}, hasCycleDir: fs.existsSync(root) };
  if (!out.hasCycleDir) return out;
  for (const name of fs.readdirSync(root).filter((x) => /^cycle_\d+$/.test(x)).sort()) {
    const dir = path.join(root, name);
    const hyp = parseHypMd(path.join(dir, "hypothesis.md"));
    let verify = null;
    const vr = path.join(dir, "verify_result.json");
    if (fs.existsSync(vr)) verify = JSON.parse(fs.readFileSync(vr, "utf8"));
    const pd = path.join(dir, "patch.diff");
    out.cycles[name] = {
      hyp,
      verifyOk: verify?.ok ?? null,
      jaccard_vs_prev_failed: verify?.jaccard_patch_vs_prev_failed ?? null,
      file_set_changed: verify?.file_set_changed ?? null,
      patchBytes: fs.existsSync(pd) ? fs.statSync(pd).size : 0,
    };
  }
  // cycle1 vs cycle2 selected hyp text + patch jaccard
  const c1 = out.cycles.cycle_1;
  const c2 = out.cycles.cycle_2;
  if (c1?.hyp && c2?.hyp) {
    out.cycle12 = {
      hyp_differ:
        String(c1.hyp.selected || "").toLowerCase() !==
        String(c2.hyp.selected || "").toLowerCase(),
      hyp1: c1.hyp.selected,
      hyp2: c2.hyp.selected,
      patch_jaccard: Number(
        jaccardPatch(
          fs.existsSync(path.join(root, "cycle_1", "patch.diff"))
            ? fs.readFileSync(path.join(root, "cycle_1", "patch.diff"), "utf8")
            : "",
          fs.existsSync(path.join(root, "cycle_2", "patch.diff"))
            ? fs.readFileSync(path.join(root, "cycle_2", "patch.diff"), "utf8")
            : ""
        ).toFixed(4)
      ),
      files1: c1.hyp.target_files,
      files2: c2.hyp.target_files,
    };
  }
  return out;
}

const report = [];
for (const r of agg.rows) {
  const entry = {
    instance: r.instance,
    role: r.role,
    cells: r.c.map((x) => x.cell),
    resolved_k: r.resolved_k,
    improvement: r.improvement,
    cross_repeat_jaccard: r.cross_repeat_jaccard,
    runs: [],
  };
  for (const cell of r.c) {
    entry.runs.push({
      cell: cell.cell,
      blockedPatchCount: cell.d2Diversity?.blockedPatchCount ?? null,
      forcedPatchCount: cell.d2?.forcedPatchCount ?? null,
      cyclesCompleted: cell.d2?.cyclesCompleted ?? null,
      metrics_cycles: cell.d2Diversity?.cycles || [],
      artifacts: dumpRun(cell.runId, r.instance),
    });
  }
  report.push(entry);
}

const outPath = path.join(
  ROOT,
  "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_d2_prime/DIAGNOSIS_BRANCH_B.json"
);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log("wrote", outPath);

// Compact stdout
for (const e of report) {
  console.log("\n====", e.instance, e.role, e.resolved_k, "imp=" + e.improvement);
  console.log("cross", JSON.stringify(e.cross_repeat_jaccard));
  for (const run of e.runs) {
    const a = run.artifacts;
    console.log(
      `  ${a.runId} cell=${run.cell} blockedPatch=${run.blockedPatchCount} forcedPatch=${run.forcedPatchCount} cycleDirs=${Object.keys(a.cycles).join(",") || "(none)"}`
    );
    if (a.cycle12) {
      console.log(
        `    cycle1→2 hyp_differ=${a.cycle12.hyp_differ} patch_j=${a.cycle12.patch_jaccard} files1=${JSON.stringify(a.cycle12.files1)} files2=${JSON.stringify(a.cycle12.files2)}`
      );
      console.log("    hyp1:", a.cycle12.hyp1);
      console.log("    hyp2:", a.cycle12.hyp2);
    } else if (!a.hasCycleDir) {
      console.log("    (no d2_cycles artifacts — may have resolved before diversity cycles / early exit)");
    } else {
      for (const [cn, cy] of Object.entries(a.cycles)) {
        console.log(
          `    ${cn}: verifyOk=${cy.verifyOk} j_vs_prev=${cy.jaccard_vs_prev_failed} file_chg=${cy.file_set_changed} hyp=${(cy.hyp?.selected || "").slice(0, 100)}`
        );
      }
    }
  }
}
