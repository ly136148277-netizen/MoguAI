#!/usr/bin/env node
/**
 * B2-D2 failure retrospective helpers — compare final patches & tool sequences.
 * Note: intermediate SEARCH/REPLACE bodies are not persisted in metrics;
 * we use toolsUsed order + final prediction + optional workdir leftover.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "benchmarks", "swe-bench", "runs");
const JOBS = [
  ["django__django-13265", "ct-b2d2-django13265"],
  ["django__django-12497", "ct-b2d2-django12497"],
  ["django__django-11019", "ct-b2d2-django11019"],
  ["django__django-15695", "ct-b2d2-django15695"],
];

function filesTouched(patch) {
  const files = new Set();
  const text = String(patch || "");
  for (const line of text.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const parts = line.split(" ");
    // diff --git a/path b/path
    const a = parts[2] || "";
    if (a.startsWith("a/")) files.add(a.slice(2));
  }
  return [...files];
}

function patchBody(patch) {
  return String(patch || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.startsWith("+") || l.startsWith("-"))
    .filter((l) => !l.startsWith("+++") && !l.startsWith("---"))
    .join("\n");
}

function jaccardTokens(a, b) {
  const tok = (s) => new Set(String(s || "").split(/\s+/).filter(Boolean));
  const A = tok(a);
  const B = tok(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function splitToolPhases(tools) {
  const t = tools || [];
  const firstRt = t.indexOf("run_tests");
  if (firstRt < 0) {
    return { beforeFirstVerify: t, afterFirstVerify: [], applyBefore: 0, applyAfter: 0 };
  }
  const before = t.slice(0, firstRt + 1);
  const after = t.slice(firstRt + 1);
  return {
    beforeFirstVerify: before,
    afterFirstVerify: after,
    applyBefore: before.filter((x) => x === "apply_patch").length,
    applyAfter: after.filter((x) => x === "apply_patch").length,
    setPlanAfter: after.filter((x) => x === "set_plan").length,
    runTestsTotal: t.filter((x) => x === "run_tests").length,
  };
}

function officialOf(harness, inst) {
  if ((harness.resolved_ids || []).includes(inst)) return "R";
  if ((harness.empty_patch_ids || []).includes(inst)) return "∅";
  if ((harness.error_ids || []).includes(inst)) return "E";
  if ((harness.unresolved_ids || []).includes(inst)) return "U";
  return "?";
}

const runs = [];
for (const [inst, prefix] of JOBS) {
  for (let i = 1; i <= 3; i += 1) {
    const runId = `${prefix}-c${i}-20260721`;
    const dir = path.join(RUNS, runId);
    const pred = JSON.parse(
      fs.readFileSync(path.join(dir, "predictions.jsonl"), "utf8").trim().split(/\n/)[0]
    );
    const met = JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8")).metrics[0];
    const harnessFile = fs.readdirSync(dir).find((f) => f.startsWith("moguai-") && f.endsWith(".json"));
    const harness = JSON.parse(fs.readFileSync(path.join(dir, harnessFile), "utf8"));
    const phases = splitToolPhases(met.toolsUsed || []);
    runs.push({
      instance: inst,
      runId,
      official: officialOf(harness, inst),
      patchBytes: Buffer.byteLength(pred.model_patch || "", "utf8"),
      files: filesTouched(pred.model_patch),
      body: patchBody(pred.model_patch),
      phases,
      d2: met.d2Retry,
      tools: met.toolsUsed || [],
      focusPaths: met.focusPaths || [],
    });
  }
}

// Within-instance pairwise similarity of final patches across c1/c2/c3
const byInst = {};
for (const r of runs) {
  (byInst[r.instance] ||= []).push(r);
}
const diversity = {};
for (const [inst, arr] of Object.entries(byInst)) {
  const pairs = [];
  for (let a = 0; a < arr.length; a += 1) {
    for (let b = a + 1; b < arr.length; b += 1) {
      pairs.push({
        a: arr[a].runId.slice(-14),
        b: arr[b].runId.slice(-14),
        jaccard: Number(jaccardTokens(arr[a].body, arr[b].body).toFixed(3)),
        sameFiles:
          JSON.stringify([...arr[a].files].sort()) === JSON.stringify([...arr[b].files].sort()),
      });
    }
  }
  diversity[inst] = pairs;
}

// Mechanism signals per run
const mechanism = runs.map((r) => ({
  runId: r.runId,
  official: r.official,
  applyBeforeFirstVerify: r.phases.applyBefore,
  applyAfterFirstVerify: r.phases.applyAfter,
  setPlanAfterFirstVerify: r.phases.setPlanAfter,
  runTestsTotal: r.phases.runTestsTotal,
  d2Cycles: r.d2?.cyclesCompleted ?? null,
  forcedPlan: r.d2?.forcedPlanCount ?? null,
  forcedPatch: r.d2?.forcedPatchCount ?? null,
  finalFiles: r.files,
  patchBytes: r.patchBytes,
  // Heuristic: gate "worked" as behavior if forcedPatch>=1 and applyAfter>=1
  gateBehaviorOk: Boolean(r.d2?.enabled && (r.d2.forcedPatchCount || 0) >= 1 && r.phases.applyAfter >= 1),
}));

const out = {
  note: "Intermediate patch bodies not persisted; applyAfterFirstVerify proxies retry activity; cross-candidate jaccard proxies whether repeats explore different finals.",
  mechanism,
  diversity,
  summary: {
    runs_with_apply_after_first_verify: mechanism.filter((m) => m.applyAfterFirstVerify >= 1).length,
    runs_with_forced_patch_ge1: mechanism.filter((m) => (m.forcedPatch || 0) >= 1).length,
    runs_official_R: mechanism.filter((m) => m.official === "R").length,
    mean_apply_after: Number(
      (
        mechanism.reduce((s, m) => s + m.applyAfterFirstVerify, 0) / mechanism.length
      ).toFixed(2)
    ),
  },
};

const outPath = path.join(
  ROOT,
  "benchmarks/swe-bench/runs/post_s3/b1_lite50/controlled_trials/b2_d2/FAILURE_RETRO_DATA.json"
);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
