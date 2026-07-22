const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isHypothesisDiversityEnabled,
  createDiversityState,
  parseCandidateHypotheses,
  evaluateDiversityPlan,
  evaluateDiversityPatch,
  recordFailedPath,
  jaccardPatch,
  writeCycleHypothesis,
  writeCyclePatch,
  writeCycleVerify,
  diversitySummary,
} = require("../src/main/skills/coding-d2-diversity");

test("diversity defaults off; env enables", () => {
  const prev = process.env.MOGU_D2_HYPOTHESIS_DIVERSITY;
  try {
    delete process.env.MOGU_D2_HYPOTHESIS_DIVERSITY;
    assert.equal(isHypothesisDiversityEnabled({}), false);
    assert.equal(isHypothesisDiversityEnabled({ hypothesisDiversity: true }), true);
    process.env.MOGU_D2_HYPOTHESIS_DIVERSITY = "1";
    assert.equal(isHypothesisDiversityEnabled({}), true);
  } finally {
    if (prev === undefined) delete process.env.MOGU_D2_HYPOTHESIS_DIVERSITY;
    else process.env.MOGU_D2_HYPOTHESIS_DIVERSITY = prev;
  }
});

test("parseCandidateHypotheses prefers array then numbered lines", () => {
  assert.deepEqual(
    parseCandidateHypotheses({
      candidate_hypotheses: ["fix A in foo", "fix B in bar"],
    }),
    ["fix A in foo", "fix B in bar"]
  );
  const fromText = parseCandidateHypotheses({
    hypothesis: "SELECTED: change bar",
    approach: "1) edit foo.py ordering\n2) edit bar.py validation",
  });
  assert.equal(fromText.length >= 2, true);
});

test("diversity plan requires ≥2 candidates and non-repeat hypothesis", () => {
  const div = createDiversityState({ hypothesisDiversity: true });
  recordFailedPath(div, {
    hypothesis: "tweak widgets.py Media css",
    files: ["django/forms/widgets.py"],
    patch: "diff --git a/django/forms/widgets.py\n-old\n+new\n",
  });

  const tooFew = evaluateDiversityPlan(div, {
    hypothesis: "try something else",
    approach: "only one idea",
    targetFiles: ["django/forms/widgets.py"],
  });
  assert.equal(tooFew.ok, false);

  const sameHyp = evaluateDiversityPlan(div, {
    hypothesis: "tweak widgets.py Media css",
    approach: "x",
    candidate_hypotheses: ["tweak widgets.py Media css", "tweak widgets.py Media css"],
    targetFiles: ["django/forms/widgets.py"],
  });
  assert.equal(sameHyp.ok, false);

  const ok = evaluateDiversityPlan(div, {
    hypothesis: "fix forms/renderers.py context",
    approach: "different module",
    candidate_hypotheses: [
      "tweak widgets.py Media css",
      "fix forms/renderers.py context",
    ],
    targetFiles: ["django/forms/renderers.py"],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.meta.candidate_hypotheses_n, 2);
  assert.equal(ok.meta.hypothesis_text_changed, true);
});

test("smoke criterion: cycle2 differs by hypothesis OR low patch similarity", () => {
  const div = createDiversityState({ hypothesisDiversity: true, diversityJaccardMax: 0.55 });
  assert.equal(div.enabled, true);

  // cycle_0 failure path
  recordFailedPath(div, {
    hypothesis: "edit widgets Media",
    files: ["django/forms/widgets.py"],
    patch: "-a\n+b\n-c\n+d\n-e\n+f\n",
  });

  // cycle2 plan: new hypothesis
  const plan = evaluateDiversityPlan(div, {
    hypothesis: "edit renderers context instead",
    approach: "leave widgets alone",
    candidate_hypotheses: ["edit widgets Media", "edit renderers context instead"],
    targetFiles: ["django/forms/renderers.py"],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.meta.hypothesis_text_changed, true);

  const patch = evaluateDiversityPatch(div, {
    files: ["django/forms/renderers.py"],
    patch: "-x\n+y\n",
  });
  assert.equal(patch.ok, true);
  const hypDiff = plan.meta.hypothesis_text_changed;
  const simOk = patch.meta.jaccard_patch < div.jaccardMax || patch.meta.file_set_changed;
  assert.equal(hypDiff || simOk, true);
});

test("diversity patch blocks same-file high jaccard", () => {
  const div = createDiversityState({ hypothesisDiversity: true, diversityJaccardMax: 0.55 });
  const patchA = [
    "diff --git a/django/forms/widgets.py b/django/forms/widgets.py",
    "--- a/django/forms/widgets.py",
    "+++ b/django/forms/widgets.py",
    "@@ -1,3 +1,3 @@",
    "-return self.css",
    "+return self.css or []",
    "-extra = 1",
    "+extra = 2",
  ].join("\n");
  recordFailedPath(div, {
    hypothesis: "h1",
    files: ["django/forms/widgets.py"],
    patch: patchA,
  });

  const nearDup = evaluateDiversityPatch(div, {
    files: ["django/forms/widgets.py"],
    patch: patchA.replace("+extra = 2", "+extra = 3"),
  });
  // Still high overlap on shared lines → should block
  assert.equal(nearDup.ok, false);
  assert.ok(nearDup.meta.jaccard_patch >= 0.55);

  const differentFile = evaluateDiversityPatch(div, {
    files: ["django/forms/renderers.py"],
    patch: [
      "diff --git a/django/forms/renderers.py b/django/forms/renderers.py",
      "-ctx = {}",
      "+ctx = {'media': media}",
    ].join("\n"),
  });
  assert.equal(differentFile.ok, true);
  assert.equal(differentFile.meta.file_set_changed, true);
});

test("jaccard identical patches is 1", () => {
  const p = "-a\n+b\n-c\n+d\n";
  assert.equal(jaccardPatch(p, p), 1);
});

test("cycle artifacts land under cycle_N/", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d2p-art-"));
  writeCycleHypothesis(root, 1, {
    hypothesis: "h",
    approach: "a",
    meta: { candidate_hypotheses_n: 2 },
  });
  writeCyclePatch(root, 1, "diff --git a/x\n+y\n");
  writeCycleVerify(root, 1, { ok: false, failedStage: "FAIL_TO_PASS" });
  assert.ok(fs.existsSync(path.join(root, "cycle_1", "hypothesis.md")));
  assert.ok(fs.existsSync(path.join(root, "cycle_1", "patch.diff")));
  assert.ok(fs.existsSync(path.join(root, "cycle_1", "verify_result.json")));
});

test("diversitySummary exposes enabled flag for smoke", () => {
  const div = createDiversityState({ hypothesisDiversity: true });
  const s = diversitySummary(div);
  assert.equal(s.enabled, true);
  assert.equal(s.failedPathCount, 0);
});
