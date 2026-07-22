/**
 * Feedback-Consumption: forced bind of failure evidence → next hypothesis (delta).
 * Enable with MOGU_FEEDBACK_CONSUME=1 (expects MOGU_FEEDBACK_PACK=1 as base).
 *
 * valid_consumption = objective §2.1 match rules (no human "boilerplate" judgment).
 * Mechanism ladder C1–C4: only C3/C4 count as utilization proof.
 */

const fs = require("fs");
const path = require("path");
const { normalizeHypothesis } = require("./coding-d2-retry");
const { jaccardPatch, sameFileSet } = require("./coding-d2-diversity");

function isFeedbackConsumeEnabled(opts = {}) {
  if (opts.feedbackConsume === true) return true;
  if (opts.feedbackConsume === false) return false;
  const v = String(process.env.MOGU_FEEDBACK_CONSUME || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function createFeedbackConsumeState(opts = {}) {
  const enabled = isFeedbackConsumeEnabled(opts);
  const artifactDir = String(
    opts.feedbackConsumeDir || process.env.MOGU_FEEDBACK_CONSUME_DIR || ""
  ).trim();
  return {
    enabled,
    artifactDir,
    pending: false,
    validOpen: false,
    lastFingerprint: null,
    lastValid: null,
    lastHypothesisNorm: null,
    lastPatch: null,
    lastFiles: null,
    gateBlocks: 0,
    validCount: 0,
    rejectLog: [],
    cycles: [],
    seq: 0,
  };
}

function ensureDir(dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

function normToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build verify fingerprint from last Feedback Pack meta + raw evidence text.
 */
function buildVerifyFingerprint(packMeta, evidenceText) {
  const text = String(evidenceText || "");
  const meta = packMeta || {};
  const tests = [...text.matchAll(/(?:ERROR|FAIL):\s+([\w_.]+)/g)].map((m) => m[1]);
  const asserts = [...text.matchAll(/AssertionError[^\n]{0,160}/g)].map((m) => m[0]);
  const files = [...text.matchAll(/File "([^"]+\.py)", line (\d+)/g)].map(
    (m) => `${String(m[1]).replace(/^\/testbed\//, "")}:${m[2]}`
  );
  const testNames = [...text.matchAll(/test_[a-z0-9_]+/gi)].map((m) => m[0]);
  return {
    failedStage: meta.failedStage || (/failedStage=([^\s]+)/.exec(text) || [])[1] || null,
    failure_class: meta.failure_class || null,
    tests: [...new Set(tests.map(normToken))],
    testNames: [...new Set(testNames.map(normToken))],
    asserts: asserts.slice(0, 6),
    stackFiles: [...new Set(files)].slice(0, 12),
    evidenceText: text.slice(0, 12000),
  };
}

function stageMatch(claimed, actual) {
  const a = normToken(claimed);
  const b = normToken(actual);
  if (!b || b === "-" || b === "null" || b === "unknown") {
    return !a || a === "-" || a === "unknown" || a === "none";
  }
  if (!a) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function classMatch(claimed, actual) {
  const a = normToken(claimed).replace(/error_?class|failure_?class/g, "").trim();
  const b = normToken(actual);
  if (!b) return false;
  if (!a) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function findLocatableEvidence(evidenceUsed, fp) {
  const blob = normToken(evidenceUsed);
  if (blob.length < 4) return { ok: false, hit: null };
  const candidates = [];
  for (const t of fp.tests || []) candidates.push(t);
  for (const t of fp.testNames || []) candidates.push(t);
  for (const f of fp.stackFiles || []) {
    candidates.push(normToken(f));
    candidates.push(normToken(f.split(":")[0]));
    const base = f.split(":")[0].split("/").pop();
    if (base) candidates.push(normToken(base));
  }
  for (const a of fp.asserts || []) {
    const slice = normToken(a).replace(/^assertionerror:?\s*/i, "");
    if (slice.length >= 8) candidates.push(slice.slice(0, 80));
  }
  for (const c of [...new Set(candidates)]) {
    if (!c || c.length < 4) continue;
    if (blob.includes(c)) return { ok: true, hit: c };
  }
  // continuous crumb from evidence text (≥8 chars) appearing in evidence_used
  const raw = String(fp.evidenceText || "");
  for (const m of raw.matchAll(/[A-Za-z0-9_./:-]{8,}/g)) {
    const tok = normToken(m[0]);
    if (tok.length >= 8 && blob.includes(tok)) return { ok: true, hit: tok.slice(0, 60) };
  }
  return { ok: false, hit: null };
}

/**
 * §2.1 objective validation.
 * @returns {{ ok: boolean, errors: string[], bits: object }}
 */
function validateConsumption(record, fingerprint, prevHypothesisNorm) {
  const errors = [];
  const fp = fingerprint || {};
  const failedStage = record.failedStage || record.failed_stage;
  const errorClass = record.errorClass || record.error_class || record.failure_class;
  const evidenceUsed = record.evidence_used || record.evidenceUsed || "";
  const nextHyp = record.next_hypothesis || record.nextHypothesis || record.hypothesis || "";

  const bits = {
    stage_match: false,
    class_match: false,
    evidence_locatable: false,
    evidence_hit: null,
    hypothesis_changed: false,
  };

  if (!stageMatch(failedStage, fp.failedStage)) {
    errors.push("RULE1_failedStage_mismatch");
  } else {
    bits.stage_match = true;
  }

  if (!classMatch(errorClass, fp.failure_class)) {
    errors.push("RULE2_failure_class_mismatch");
  } else {
    bits.class_match = true;
  }

  const ev = findLocatableEvidence(evidenceUsed, fp);
  if (!ev.ok) {
    errors.push("RULE3_evidence_used_not_locatable");
  } else {
    bits.evidence_locatable = true;
    bits.evidence_hit = ev.hit;
  }

  const nextNorm = normalizeHypothesis(nextHyp);
  if (!nextNorm) {
    errors.push("RULE4_next_hypothesis_empty");
  } else if (prevHypothesisNorm && nextNorm === prevHypothesisNorm) {
    errors.push("RULE4_next_hypothesis_unchanged");
  } else {
    bits.hypothesis_changed = true;
  }

  return { ok: errors.length === 0, errors, bits, nextNorm };
}

function noteVerifyFailure(state, packMeta, evidenceText) {
  if (!state?.enabled) return;
  state.pending = true;
  state.validOpen = false;
  state.lastFingerprint = buildVerifyFingerprint(packMeta, evidenceText);
  state.lastValid = null;
}

function submitConsumption(state, record) {
  if (!state?.enabled) {
    return { ok: false, error: "feedback_consume_disabled" };
  }
  if (!state.pending && !state.lastFingerprint) {
    return {
      ok: false,
      error: "no_pending_verify_failure — run_tests failure required before consumption",
    };
  }
  const prevHyp = state.lastHypothesisNorm;
  const checked = validateConsumption(record, state.lastFingerprint, prevHyp);
  state.seq += 1;
  const entry = {
    seq: state.seq,
    at: new Date().toISOString(),
    record: {
      failedStage: record.failedStage || record.failed_stage || null,
      errorClass: record.errorClass || record.error_class || record.failure_class || null,
      evidence_used: record.evidence_used || record.evidenceUsed || "",
      next_hypothesis: record.next_hypothesis || record.nextHypothesis || record.hypothesis || "",
      diff_vs_previous: record.diff_vs_previous || record.diffVsPrevious || "",
    },
    fingerprint: {
      failedStage: state.lastFingerprint?.failedStage || null,
      failure_class: state.lastFingerprint?.failure_class || null,
      tests: state.lastFingerprint?.tests || [],
    },
    ok: checked.ok,
    errors: checked.errors,
    bits: checked.bits,
    C1: true,
    C2: checked.ok,
    C3: null,
    C4: null,
  };

  if (!checked.ok) {
    state.gateBlocks += 1;
    state.rejectLog.push({
      seq: state.seq,
      errors: checked.errors,
      at: entry.at,
    });
    writeConsumeArtifact(state, entry);
    return {
      ok: false,
      error: `FEEDBACK_CONSUME gate rejected: ${checked.errors.join(",")}`,
      entry,
    };
  }

  state.validOpen = true;
  state.validCount += 1;
  state.lastValid = entry;
  state.lastHypothesisNorm = checked.nextNorm;
  writeConsumeArtifact(state, entry);
  return { ok: true, entry };
}

function writeConsumeArtifact(state, entry) {
  if (!state.artifactDir) return;
  ensureDir(state.artifactDir);
  const name = `consume_${String(entry.seq).padStart(2, "0")}.json`;
  fs.writeFileSync(path.join(state.artifactDir, name), JSON.stringify(entry, null, 2), "utf8");
  fs.writeFileSync(
    path.join(state.artifactDir, "gate_rejects.jsonl"),
    state.rejectLog.map((r) => JSON.stringify(r)).join("\n") + (state.rejectLog.length ? "\n" : ""),
    "utf8"
  );
}

function writePlanArtifact(state, plan, seqHint) {
  if (!state?.enabled || !state.artifactDir || !plan) return;
  ensureDir(state.artifactDir);
  const n = seqHint || state.seq || 0;
  const body = [
    `# plan_${String(n).padStart(2, "0")}`,
    "",
    "## hypothesis",
    String(plan.hypothesis || ""),
    "",
    "## approach",
    String(plan.approach || ""),
    "",
    "## target_files",
    JSON.stringify(plan.target_files || plan.targetFiles || [], null, 2),
  ].join("\n");
  fs.writeFileSync(path.join(state.artifactDir, `plan_${String(n).padStart(2, "0")}.md`), body, "utf8");
}

function consumeBlocksApply(state) {
  return Boolean(state?.enabled && state.pending && !state.validOpen);
}

function notePlanBinding(state, plan) {
  if (!state?.enabled || !state.lastValid) return;
  writePlanArtifact(state, plan, state.lastValid.seq);
  const blob = normalizeHypothesis(
    [plan?.hypothesis, plan?.approach, ...(plan?.target_files || [])].filter(Boolean).join(" ")
  );
  const ev = normToken(state.lastValid.record.evidence_used);
  const hit = state.lastValid.bits?.evidence_hit;
  const cites =
    (hit && blob.includes(normToken(hit))) ||
    (ev && ev.length >= 6 && blob.includes(ev.slice(0, Math.min(40, ev.length))));
  state.lastValid.C3 = Boolean(cites);
  // also allow next_hypothesis itself stored as plan hypothesis
  if (!state.lastValid.C3) {
    const next = normalizeHypothesis(state.lastValid.record.next_hypothesis);
    if (next && blob.includes(next.slice(0, Math.min(40, next.length)))) {
      state.lastValid.C3 = true;
    }
  }
  persistLastValid(state);
}

function notePatchBinding(state, patchText, files) {
  if (!state?.enabled || !state.lastValid) return null;
  const patch = String(patchText || "");
  const fileList = Array.isArray(files) ? files : [];
  const blob = normalizeHypothesis(patch);
  const hit = state.lastValid.bits?.evidence_hit;
  const ev = normToken(state.lastValid.record.evidence_used);
  const citesPatch =
    (hit && blob.includes(normToken(hit))) ||
    (ev && ev.length >= 6 && blob.includes(ev.slice(0, Math.min(40, ev.length))));
  if (citesPatch) state.lastValid.C3 = true;

  let jaccard = null;
  let fileChanged = null;
  if (state.lastPatch != null) {
    jaccard = jaccardPatch(patch, state.lastPatch);
    fileChanged = state.lastFiles != null ? !sameFileSet(fileList, state.lastFiles) : null;
  }
  const hypChanged = Boolean(state.lastValid.bits?.hypothesis_changed);
  const pathChanged = fileChanged === true || (typeof jaccard === "number" && jaccard < 0.85);
  state.lastValid.C4 = Boolean(hypChanged && (pathChanged || citesPatch));
  state.lastValid.jaccard_vs_prev = jaccard;
  state.lastValid.file_set_changed = fileChanged;

  state.cycles.push({ ...state.lastValid });
  state.lastPatch = patch;
  state.lastFiles = fileList;
  // consume slot closed after successful gated patch
  state.pending = false;
  state.validOpen = false;
  persistLastValid(state);
  return state.lastValid;
}

function persistLastValid(state) {
  if (!state.artifactDir || !state.lastValid) return;
  ensureDir(state.artifactDir);
  const name = `consume_${String(state.lastValid.seq).padStart(2, "0")}.json`;
  fs.writeFileSync(path.join(state.artifactDir, name), JSON.stringify(state.lastValid, null, 2), "utf8");
}

function feedbackConsumeSummary(state) {
  if (!state) return null;
  const last = state.cycles[state.cycles.length - 1] || state.lastValid || null;
  return {
    enabled: Boolean(state.enabled),
    base_feedback_pack_expected: true,
    pending: Boolean(state.pending),
    validOpen: Boolean(state.validOpen),
    gateBlocks: state.gateBlocks,
    validCount: state.validCount,
    C1_any: state.validCount > 0 || state.rejectLog.length > 0 || state.seq > 0,
    C2_valid_count: state.validCount,
    C3_any: state.cycles.some((c) => c.C3 === true) || last?.C3 === true,
    C4_any: state.cycles.some((c) => c.C4 === true),
    cycles: state.cycles,
    rejectLog: state.rejectLog.slice(-20),
    artifactDir: state.artifactDir || null,
  };
}

function buildConsumeGateUserMessage(state) {
  if (!state?.enabled || !state.pending) return "";
  const fp = state.lastFingerprint || {};
  return [
    "[Feedback-Consumption gate]",
    "Before apply_patch: call record_failure_consumption with:",
    "- failedStage (must match last verify)",
    "- errorClass / failure_class (must match last pack label)",
    "- evidence_used (≥1 locatable token from last verify: test name, assert crumb, or file:line)",
    "- next_hypothesis (must differ from previous hypothesis)",
    `Last verify fingerprint: failedStage=${fp.failedStage || "-"} failure_class=${fp.failure_class || "-"}`,
    fp.tests?.length ? `Known failing tests: ${fp.tests.slice(0, 4).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  isFeedbackConsumeEnabled,
  createFeedbackConsumeState,
  buildVerifyFingerprint,
  validateConsumption,
  noteVerifyFailure,
  submitConsumption,
  consumeBlocksApply,
  notePlanBinding,
  notePatchBinding,
  feedbackConsumeSummary,
  buildConsumeGateUserMessage,
  writePlanArtifact,
  stageMatch,
  classMatch,
  findLocatableEvidence,
};
