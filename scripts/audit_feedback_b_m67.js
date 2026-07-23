#!/usr/bin/env node
/**
 * Feedback-B post-hoc: M6/M7 false-negative audit.
 * Hypothesis text was NOT persisted in metrics — soft proxies only.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "benchmarks", "swe-bench", "runs");
const OUT = path.join(
  ROOT,
  "post_s3",
  "b1_lite50",
  "controlled_trials",
  "b2_feedback_b"
);
const JOBS = [
  ["django__django-13265", "ct-fb-django13265"],
  ["django__django-11019", "ct-fb-django11019"],
  ["django__django-15695", "ct-fb-django15695"],
];

function walk(d, acc = []) {
  if (!fs.existsSync(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function extractSignals(text) {
  const t = String(text || "");
  const tests = [...t.matchAll(/(?:ERROR|FAIL):\s+([\w_.]+)/g)].map((m) => m[1]);
  const files = [...t.matchAll(/File "([^"]+\.py)", line (\d+)/g)].map(
    (m) => `${m[1].replace(/^\/testbed\//, "")}:${m[2]}`
  );
  const asserts = [...t.matchAll(/AssertionError[^\n]{0,160}/g)].map((m) => m[0]);
  const failedStage = (/failedStage=([^\s]+)/.exec(t) || [])[1] || null;
  const failureClass = (/failure_class=([^\s]+)/.exec(t) || [])[1] || null;
  return {
    tests: [...new Set(tests)],
    stackFiles: [...new Set(files)].slice(0, 10),
    asserts: asserts.slice(0, 4),
    failedStage,
    failureClass,
  };
}

function readPred(runId) {
  const p = path.join(ROOT, runId, "predictions.jsonl");
  if (!fs.existsSync(p)) return "";
  const line = fs.readFileSync(p, "utf8").split(/\n/).find((l) => l.trim());
  try {
    return String(JSON.parse(line).model_patch || "");
  } catch {
    return "";
  }
}

function softCiteExpand(blob, signals) {
  const b = String(blob || "").toLowerCase();
  if (!b) return { hit: false, reasons: [] };
  const reasons = [];
  const tokens = [];
  for (const s of signals || []) {
    if (s.failedStage) tokens.push(String(s.failedStage).toLowerCase());
    if (s.failureClass) tokens.push(String(s.failureClass).toLowerCase());
    for (const t of s.tests || []) {
      tokens.push(t.toLowerCase());
      const short = t.split(".").pop();
      if (short) tokens.push(short.toLowerCase());
    }
    for (const f of s.stackFiles || []) {
      const base = f.split(":")[0].split("/").pop();
      if (base) tokens.push(base.toLowerCase());
    }
  }
  tokens.push(
    "fail_to_pass",
    "f2p_miss",
    "test_failure",
    "assertionerror",
    "media_deduplication",
    "combine_media",
    "form_media",
    "render_css",
    "autodetector",
    "alter_unique_together"
  );
  for (const t of [...new Set(tokens)]) {
    if (!t || t === "-") continue;
    if (b.includes(t) || b.includes(t.replace(/_/g, " "))) reasons.push(t);
  }
  return { hit: reasons.length > 0, reasons: reasons.slice(0, 12) };
}

const agg = JSON.parse(fs.readFileSync(path.join(OUT, "aggregate.json"), "utf8"));
const cellByRun = {};
for (const r of agg.rows) {
  for (const run of r.runs) cellByRun[run.runId] = run.cell;
}

const rows = [];
for (const [inst, prefix] of JOBS) {
  for (let i = 1; i <= 3; i += 1) {
    const runId = `${prefix}-c${i}-20260722`;
    const dir = path.join(ROOT, runId);
    const m = JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8")).metrics[0];
    const fb = m.feedbackPack || {};
    const packDir = path.join(dir, "feedback_pack", inst);
    const packFiles = walk(packDir)
      .filter((p) => /pack_\d+[\\/]last_verify\.txt$/.test(p))
      .sort();
    const signals = packFiles.map((p) => ({
      pack: path.basename(path.dirname(p)),
      ...extractSignals(fs.readFileSync(p, "utf8")),
    }));
    const patch = readPred(runId);
    const first = signals[0] || null;
    const last = signals[signals.length - 1] || null;
    const signalStable =
      first && last && JSON.stringify(first.tests) === JSON.stringify(last.tests);

    const tools = m.toolsUsed || [];
    const firstFailIdx = tools.indexOf("run_tests");
    let postFailSetPlan = false;
    let postFailRead = false;
    let postFailReadThenPlan = false;
    let setPlanWithoutReadAfterFail = false;
    if (firstFailIdx >= 0) {
      const after = tools.slice(firstFailIdx + 1);
      postFailSetPlan = after.includes("set_plan");
      postFailRead = after.includes("read");
      const ri = after.indexOf("read");
      const si = after.indexOf("set_plan");
      postFailReadThenPlan = ri >= 0 && si >= 0 && si > ri;
      setPlanWithoutReadAfterFail = si >= 0 && (ri < 0 || si < ri);
    }

    // Soft M7 against patch only (hypothesis text unavailable).
    // Strict: require pack-specific test/assert crumbs — NOT just the production file
    // the model already planned to edit (widgets.py / autodetector.py alone is too weak).
    const specificTokens = [];
    for (const s of signals) {
      for (const t of s.tests || []) {
        specificTokens.push(t.toLowerCase());
        const short = t.split(".").pop();
        if (short) specificTokens.push(short.toLowerCase());
      }
      for (const a of s.asserts || []) {
        const am = /test_[a-z0-9_]+/i.exec(a);
        if (am) specificTokens.push(am[0].toLowerCase());
      }
    }
    // also scrape pack body for distinctive django-test tokens
    for (const pf of packFiles) {
      const body = fs.readFileSync(pf, "utf8").toLowerCase();
      for (const m of body.matchAll(
        /test_[a-z0-9_]+|render_css|media_deduplication|combine_media|form_media|unique_together|alter_unique/g
      )) {
        specificTokens.push(m[0]);
      }
    }
    const patchLower = patch.toLowerCase();
    const strictHits = [...new Set(specificTokens)].filter(
      (t) => t && patchLower.includes(t)
    );
    const softPatch = {
      hit: strictHits.length > 0,
      reasons: strictHits.slice(0, 12),
    };

    // Soft M6': consumed in-message pack via stack_anchor path (not full_log read).
    const softM6_messageChannel =
      Number(fb.packCount || 0) > 0 && m.stackAnchorUsed === true;

    // Generic file-only overlap (weak; reported separately)
    const weakFileOverlap = softCiteExpand(patch, signals);

    rows.push({
      runId,
      instance: inst,
      i,
      cell: cellByRun[runId] || "?",
      packCount: fb.packCount || 0,
      formal_M6_read_full_log: fb.tools_read_full_log === true,
      formal_M7_cites_feedback: fb.hypothesis_cites_feedback === true,
      formal_M8_hyp_changed: fb.hypothesis_text_changed === true,
      stackAnchorUsed: m.stackAnchorUsed === true,
      findRefsUsed: m.findRefsUsed === true,
      hypothesis_text_persisted: false,
      pack_tests: [...new Set(signals.flatMap((s) => s.tests))],
      pack_signal_stable_across_packs: signalStable,
      postFail_set_plan: postFailSetPlan,
      postFail_read: postFailRead,
      postFail_read_then_set_plan: postFailReadThenPlan,
      postFail_set_plan_before_or_without_read: setPlanWithoutReadAfterFail,
      soft_M6_stack_anchor_from_pack_text: softM6_messageChannel,
      soft_M7_patch_specific_token_overlap: softPatch.hit,
      soft_M7_patch_specific_reasons: softPatch.reasons,
      weak_M7_any_token_overlap: weakFileOverlap.hit,
      weak_M7_reasons: weakFileOverlap.reasons,
      first_pack_asserts: first?.asserts || [],
      last_pack_asserts: last?.asserts || [],
    });
  }
}

const summary = {
  n_runs: rows.length,
  formal_M6_yes: rows.filter((r) => r.formal_M6_read_full_log).length,
  formal_M7_yes: rows.filter((r) => r.formal_M7_cites_feedback).length,
  soft_M6_stack_anchor_yes: rows.filter((r) => r.soft_M6_stack_anchor_from_pack_text).length,
  soft_M7_specific_patch_overlap_yes: rows.filter((r) => r.soft_M7_patch_specific_token_overlap)
    .length,
  weak_M7_any_overlap_yes: rows.filter((r) => r.weak_M7_any_token_overlap).length,
  hypothesis_text_available_runs: 0,
  note:
    "M6 formal = read(full_log_path) only. Pack body is already in the tool message; stack_anchor parses that text (soft M6). Soft M7-strict requires patch to contain pack-specific test/assert crumbs — NOT merely the same production file. Hypothesis text was not persisted, so true M7 false-negative on set_plan wording cannot be fully closed.",
  rows,
};

fs.writeFileSync(path.join(OUT, "m67_false_negative_audit.json"), JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      formal_M6: `${summary.formal_M6_yes}/9`,
      formal_M7: `${summary.formal_M7_yes}/9`,
      soft_M6_stack_anchor: `${summary.soft_M6_stack_anchor_yes}/9`,
      soft_M7_specific: `${summary.soft_M7_specific_patch_overlap_yes}/9`,
      weak_M7_any: `${summary.weak_M7_any_overlap_yes}/9`,
      hyp_text: summary.hypothesis_text_available_runs,
    },
    null,
    2
  )
);
