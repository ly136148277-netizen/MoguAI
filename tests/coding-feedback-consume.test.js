const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isFeedbackConsumeEnabled,
  createFeedbackConsumeState,
  noteVerifyFailure,
  submitConsumption,
  consumeBlocksApply,
  notePlanBinding,
  notePatchBinding,
  validateConsumption,
  feedbackConsumeSummary,
} = require("../src/main/skills/coding-feedback-consume");

test("consume defaults off; env enables", () => {
  const prev = process.env.MOGU_FEEDBACK_CONSUME;
  try {
    delete process.env.MOGU_FEEDBACK_CONSUME;
    assert.equal(isFeedbackConsumeEnabled({}), false);
    assert.equal(isFeedbackConsumeEnabled({ feedbackConsume: true }), true);
    process.env.MOGU_FEEDBACK_CONSUME = "1";
    assert.equal(isFeedbackConsumeEnabled({}), true);
  } finally {
    if (prev === undefined) delete process.env.MOGU_FEEDBACK_CONSUME;
    else process.env.MOGU_FEEDBACK_CONSUME = prev;
  }
});

test("§2.1 rejects stage/class/evidence/hypothesis failures objectively", () => {
  const fp = {
    failedStage: "FAIL_TO_PASS",
    failure_class: "f2p_miss",
    tests: ["test_media_deduplication"],
    testNames: ["test_media_deduplication"],
    asserts: ["AssertionError: expected css"],
    stackFiles: ["django/forms/widgets.py:85"],
    evidenceText: "FAIL: test_media_deduplication\nAssertionError: expected css\nFile \"/testbed/django/forms/widgets.py\", line 85",
  };
  const badStage = validateConsumption(
    {
      failedStage: "PASS_TO_PASS",
      errorClass: "f2p_miss",
      evidence_used: "test_media_deduplication",
      next_hypothesis: "fix render_css sort",
    },
    fp,
    "old hyp"
  );
  assert.equal(badStage.ok, false);
  assert.ok(badStage.errors.includes("RULE1_failedStage_mismatch"));

  const badEv = validateConsumption(
    {
      failedStage: "FAIL_TO_PASS",
      errorClass: "f2p_miss",
      evidence_used: "I will fix the bug",
      next_hypothesis: "fix render_css sort",
    },
    fp,
    "old hyp"
  );
  assert.equal(badEv.ok, false);
  assert.ok(badEv.errors.includes("RULE3_evidence_used_not_locatable"));

  const sameHyp = validateConsumption(
    {
      failedStage: "FAIL_TO_PASS",
      errorClass: "f2p_miss",
      evidence_used: "test_media_deduplication",
      next_hypothesis: "old hyp",
    },
    fp,
    "old hyp"
  );
  assert.equal(sameHyp.ok, false);
  assert.ok(sameHyp.errors.includes("RULE4_next_hypothesis_unchanged"));

  const ok = validateConsumption(
    {
      failedStage: "FAIL_TO_PASS",
      errorClass: "f2p_miss",
      evidence_used: "test_media_deduplication in widgets.py:85",
      next_hypothesis: "fix Media CSS merge order in render_css",
    },
    fp,
    "old hyp"
  );
  assert.equal(ok.ok, true);
});

test("gate blocks apply until valid consumption; C3/C4 track binding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-consume-"));
  const state = createFeedbackConsumeState({ feedbackConsume: true, feedbackConsumeDir: dir });
  noteVerifyFailure(
    state,
    { failedStage: "FAIL_TO_PASS", failure_class: "f2p_miss" },
    "FAIL: test_form_media\nFile \"/testbed/django/forms/widgets.py\", line 72\nAssertionError: media mismatch"
  );
  assert.equal(consumeBlocksApply(state), true);

  const reject = submitConsumption(state, {
    failedStage: "FAIL_TO_PASS",
    errorClass: "f2p_miss",
    evidence_used: "please fix",
    next_hypothesis: "tweak widgets",
  });
  assert.equal(reject.ok, false);
  assert.equal(consumeBlocksApply(state), true);

  const ok = submitConsumption(state, {
    failedStage: "FAIL_TO_PASS",
    errorClass: "f2p_miss",
    evidence_used: "test_form_media widgets.py:72",
    next_hypothesis: "change Media render_css dedup order",
  });
  assert.equal(ok.ok, true);
  assert.equal(consumeBlocksApply(state), false);
  assert.ok(fs.existsSync(path.join(dir, "consume_02.json")));

  notePlanBinding(state, {
    hypothesis: "change Media render_css dedup order using test_form_media evidence",
    approach: "edit widgets.py",
    target_files: ["django/forms/widgets.py"],
  });
  assert.equal(state.lastValid.C3, true);

  notePatchBinding(
    state,
    "diff --git a/django/forms/widgets.py\n-old\n+new render_css\n",
    ["django/forms/widgets.py"]
  );
  noteVerifyFailure(
    state,
    { failedStage: "FAIL_TO_PASS", failure_class: "f2p_miss" },
    "FAIL: test_form_media\nFile \"/testbed/django/forms/widgets.py\", line 72"
  );
  submitConsumption(state, {
    failedStage: "FAIL_TO_PASS",
    errorClass: "f2p_miss",
    evidence_used: "test_form_media",
    next_hypothesis: "different approach to Media join",
  });
  notePatchBinding(
    state,
    "diff --git a/django/forms/widgets.py\n-old\n+completely different patch body for media\n",
    ["django/forms/widgets.py"]
  );

  const summary = feedbackConsumeSummary(state);
  assert.equal(summary.enabled, true);
  assert.ok(summary.validCount >= 2);
  assert.equal(summary.C3_any, true);
});
