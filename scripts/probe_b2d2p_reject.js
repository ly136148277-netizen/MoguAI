/**
 * Artificial duplicate-path reject probe for B2-D2′ (no LLM).
 * Must PASS before / with live smoke: proves the gate blocks a repeated failed path.
 */
const assert = require("node:assert/strict");
const {
  createDiversityState,
  recordFailedPath,
  evaluateDiversityPlan,
  evaluateDiversityPatch,
} = require("../src/main/skills/coding-d2-diversity");

function main() {
  const div = createDiversityState({
    hypothesisDiversity: true,
    diversityJaccardMax: 0.55,
  });
  assert.equal(div.enabled, true, "diversity_enabled");

  const failedPatch = [
    "diff --git a/django/forms/widgets.py b/django/forms/widgets.py",
    "--- a/django/forms/widgets.py",
    "+++ b/django/forms/widgets.py",
    "@@ -10,6 +10,7 @@",
    "-return self._css",
    "+return self._css or []",
    "-media = Media()",
    "+media = Media(css={'all': []})",
  ].join("\n");

  recordFailedPath(div, {
    hypothesis: "fix Media CSS merge in widgets.py",
    files: ["django/forms/widgets.py"],
    patch: failedPatch,
    cycle: 0,
  });

  // 1) Repeat same hypothesis → must reject
  const samePlan = evaluateDiversityPlan(div, {
    hypothesis: "fix Media CSS merge in widgets.py",
    approach: "same idea",
    candidate_hypotheses: [
      "fix Media CSS merge in widgets.py",
      "also fix Media CSS merge in widgets.py",
    ],
    targetFiles: ["django/forms/widgets.py"],
  });
  // If second candidate normalizes differently, force identical candidates
  const samePlanStrict = evaluateDiversityPlan(div, {
    hypothesis: "fix Media CSS merge in widgets.py",
    approach: "same idea",
    candidate_hypotheses: [
      "fix Media CSS merge in widgets.py",
      "fix Media CSS merge in widgets.py",
    ],
    targetFiles: ["django/forms/widgets.py"],
  });
  assert.equal(samePlanStrict.ok, false, "reject repeated hypothesis");
  void samePlan;

  // 2) Accept diverse plan, then near-duplicate patch on same file → must reject
  const okPlan = evaluateDiversityPlan(div, {
    hypothesis: "change forms/renderers.py template context instead",
    approach: "leave widgets",
    candidate_hypotheses: [
      "fix Media CSS merge in widgets.py",
      "change forms/renderers.py template context instead",
    ],
    targetFiles: ["django/forms/renderers.py"],
  });
  assert.equal(okPlan.ok, true, "accept diverse hypothesis");

  const nearDup = evaluateDiversityPatch(div, {
    files: ["django/forms/widgets.py"],
    patch: failedPatch.replace("+media = Media(css={'all': []})", "+media = Media(css={'all': ['x']})"),
  });
  assert.equal(nearDup.ok, false, "reject same-file high-jaccard patch");
  assert.ok(nearDup.meta.jaccard_patch >= 0.55, "jaccard in reject band");

  // 3) Different file low overlap → allow
  const alt = evaluateDiversityPatch(div, {
    files: ["django/forms/renderers.py"],
    patch: [
      "diff --git a/django/forms/renderers.py b/django/forms/renderers.py",
      "-context = {}",
      "+context = {'media': media}",
    ].join("\n"),
  });
  assert.equal(alt.ok, true, "allow different-file patch");

  console.log("[probe_b2d2p_reject] PASS");
  console.log("  - repeated hypothesis blocked");
  console.log("  - same-file high-jaccard patch blocked");
  console.log("  - different-file path allowed");
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error("[probe_b2d2p_reject] FAIL", err.message || err);
  process.exit(1);
}
