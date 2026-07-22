/**
 * B2-D2 structured retry gate helpers (Class-C verify loop only).
 * Enable with MOGU_D2_STRUCTURED_RETRY=1 or opts.structuredRetry=true.
 * Does not expand verify coverage (D1) or rewrite failure feedback (D3).
 */

const FAILURE_CLASSES = Object.freeze([
  "f2p_miss",
  "p2p_regression",
  "mixed_fail",
  "apply_noop",
  "other",
]);

/**
 * Classify a run_tests tool payload. Labels only — no root-cause inference.
 * @param {string} out
 * @returns {{ class: string, failedStage: string|null, detail: string }}
 */
function classifyVerifyFailure(out) {
  const text = String(out || "");
  if (!text || text.startsWith("NO_VERIFY")) {
    return { class: "other", failedStage: null, detail: "no_verify_or_empty" };
  }
  if (/补丁已应用但工作区无改动|noop|empty patch|dirty=false/i.test(text)) {
    return { class: "apply_noop", failedStage: null, detail: "empty_or_noop_signal" };
  }

  const failedStage = (/failedStage=([^\s]+)/.exec(text) || [])[1] || null;
  const f2pFail =
    /\[FAIL_TO_PASS\][^\n]*ok=false/i.test(text) ||
    /FAIL_TO_PASS.*(?:failed|ERROR|AssertionError)/i.test(text);
  const f2pOk = /\[FAIL_TO_PASS\][^\n]*ok=true/i.test(text);
  const p2pFail =
    /\[PASS_TO_PASS\][^\n]*ok=false/i.test(text) ||
    /PASS_TO_PASS.*(?:failed|ERROR|AssertionError)/i.test(text);

  if (failedStage && /PASS_TO_PASS/i.test(failedStage) && (f2pOk || !f2pFail)) {
    return { class: "p2p_regression", failedStage, detail: "pass_to_pass_failed" };
  }
  if (failedStage && /FAIL_TO_PASS/i.test(failedStage)) {
    return { class: "f2p_miss", failedStage, detail: "fail_to_pass_failed" };
  }
  if (f2pFail && p2pFail) {
    return { class: "mixed_fail", failedStage, detail: "both_stages_signal_fail" };
  }
  if (f2pOk && p2pFail) {
    return { class: "p2p_regression", failedStage, detail: "f2p_ok_p2p_fail" };
  }
  if (f2pFail) {
    return { class: "f2p_miss", failedStage, detail: "f2p_fail_signal" };
  }
  if (p2pFail) {
    return { class: "p2p_regression", failedStage, detail: "p2p_fail_signal" };
  }
  return {
    class: "other",
    failedStage,
    detail: "unclassified_verify_fail",
  };
}

function normalizeHypothesis(h) {
  return String(h || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isStructuredRetryEnabled(opts = {}) {
  if (opts.structuredRetry === false) return false;
  if (opts.structuredRetry === true) return true;
  return process.env.MOGU_D2_STRUCTURED_RETRY === "1";
}

function structuredRetryMaxCycles(opts = {}) {
  const n = Number(opts.structuredRetryMaxCycles || process.env.MOGU_D2_MAX_CYCLES || 2);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(2, Math.floor(n)); // hard cap 2 per frozen spec
}

/**
 * @returns {{
 *   enabled: boolean,
 *   maxCycles: number,
 *   cyclesCompleted: number,
 *   active: null | object,
 *   classifications: object[],
 *   forcedPlanCount: number,
 *   forcedPatchCount: number,
 *   blockedToolCount: number,
 * }}
 */
function createD2State(opts = {}) {
  return {
    enabled: isStructuredRetryEnabled(opts),
    maxCycles: structuredRetryMaxCycles(opts),
    cyclesCompleted: 0,
    active: null,
    classifications: [],
    forcedPlanCount: 0,
    forcedPatchCount: 0,
    blockedToolCount: 0,
  };
}

function buildGateUserMessage(active) {
  const c = active?.classification || {};
  return [
    "[B2-D2 structured retry gate]",
    `cycle=${active.cycle}/${active.maxCycles} phase=${active.phase}`,
    `failure_class=${c.class || "other"} failedStage=${c.failedStage || "-"} (${c.detail || ""})`,
    "Required sequence before claiming success:",
    "1) set_plan with a NEW hypothesis (must differ from the previous hypothesis text)",
    "2) apply_patch with a real code change",
    "3) run_tests again",
    "Do not only re-run tests or only grep. Do not invent root causes beyond the failure class label.",
    active.phase === "need_plan"
      ? "NOW: call set_plan (new hypothesis). Investigating with grep/read/rollback is allowed."
      : active.phase === "need_patch"
        ? "NOW: call apply_patch (set_plan already accepted for this cycle)."
        : "NOW: call run_tests to close this retry cycle.",
  ].join("\n");
}

const INVESTIGATE = new Set([
  "grep",
  "search",
  "read",
  "list",
  "git_diff",
  "rollback",
  "find_references",
  "checkpoint",
]);

/**
 * Decide whether a tool call is allowed under the active gate.
 * @returns {{ allow: boolean, error?: string, advance?: string, note?: string }}
 */
function evaluateD2Tool(active, toolName, { hypothesis = "", applyOk = false, verifyOk = false } = {}) {
  const name = String(toolName || "");
  if (!active) return { allow: true };

  if (active.phase === "need_plan") {
    if (name === "set_plan") {
      const prev = normalizeHypothesis(active.previousHypothesis);
      const next = normalizeHypothesis(hypothesis);
      if (!next) {
        return { allow: false, error: "B2-D2 gate: set_plan needs a non-empty hypothesis." };
      }
      if (prev && next === prev) {
        return {
          allow: false,
          error:
            "B2-D2 gate: hypothesis must change vs previous plan. State a different hypothesis, then apply_patch.",
        };
      }
      return { allow: true, advance: "need_patch", note: "plan_accepted" };
    }
    if (name === "run_tests" || name === "apply_patch") {
      return {
        allow: false,
        error: `B2-D2 gate (need_plan): ${name} blocked until set_plan with a NEW hypothesis.`,
      };
    }
    if (INVESTIGATE.has(name)) return { allow: true };
    return { allow: true };
  }

  if (active.phase === "need_patch") {
    if (name === "run_tests") {
      return {
        allow: false,
        error: "B2-D2 gate (need_patch): run_tests blocked until apply_patch succeeds this cycle.",
      };
    }
    if (name === "apply_patch") {
      if (!applyOk) return { allow: true };
      return { allow: true, advance: "need_verify", note: "patch_accepted" };
    }
    if (name === "set_plan") {
      const prev = normalizeHypothesis(active.previousHypothesis);
      const next = normalizeHypothesis(hypothesis);
      if (prev && next === prev) {
        return {
          allow: false,
          error: "B2-D2 gate: hypothesis unchanged; revise set_plan or proceed to apply_patch.",
        };
      }
      return { allow: true, note: "plan_updated" };
    }
    if (INVESTIGATE.has(name)) return { allow: true };
    return { allow: true };
  }

  if (active.phase === "need_verify") {
    if (name === "run_tests") {
      if (verifyOk) return { allow: true, advance: "clear_success", note: "cycle_closed_ok" };
      return { allow: true, advance: "cycle_failed", note: "cycle_closed_fail" };
    }
    if (name === "apply_patch") {
      if (applyOk) return { allow: true, note: "extra_patch_before_verify" };
      return { allow: true };
    }
    if (INVESTIGATE.has(name) || name === "set_plan") return { allow: true };
    return { allow: true };
  }

  return { allow: true };
}

/**
 * Start a new structured cycle after a real verify failure.
 * @returns {boolean} whether a new gate was opened
 */
function tryOpenD2Cycle(state, classification, previousHypothesis = "") {
  if (!state?.enabled) return false;
  if (state.active) return false;
  if (state.cyclesCompleted >= state.maxCycles) return false;
  const cycle = state.cyclesCompleted + 1;
  state.classifications.push(classification);
  state.active = {
    cycle,
    maxCycles: state.maxCycles,
    phase: "need_plan",
    classification,
    previousHypothesis: String(previousHypothesis || ""),
  };
  return true;
}

function applyD2Advance(state, advance, { hypothesis = "" } = {}) {
  if (!state?.active || !advance) return;
  if (advance === "need_patch") {
    state.active.phase = "need_patch";
    if (hypothesis) state.active.previousHypothesis = hypothesis;
    state.forcedPlanCount += 1;
    return;
  }
  if (advance === "need_verify") {
    state.active.phase = "need_verify";
    state.forcedPatchCount += 1;
    return;
  }
  if (advance === "clear_success") {
    state.cyclesCompleted += 1;
    state.active = null;
    return;
  }
  if (advance === "cycle_failed") {
    state.cyclesCompleted += 1;
    state.active = null;
  }
}

function d2Summary(state) {
  if (!state) return null;
  return {
    enabled: Boolean(state.enabled),
    cyclesCompleted: state.cyclesCompleted,
    maxCycles: state.maxCycles,
    activePhase: state.active?.phase || null,
    classifications: state.classifications.map((c) => c.class),
    forcedPlanCount: state.forcedPlanCount,
    forcedPatchCount: state.forcedPatchCount,
    blockedToolCount: state.blockedToolCount,
  };
}

module.exports = {
  FAILURE_CLASSES,
  classifyVerifyFailure,
  isStructuredRetryEnabled,
  structuredRetryMaxCycles,
  createD2State,
  buildGateUserMessage,
  evaluateD2Tool,
  tryOpenD2Cycle,
  applyD2Advance,
  d2Summary,
  normalizeHypothesis,
};
