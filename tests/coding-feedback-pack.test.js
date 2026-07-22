const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isFeedbackPackEnabled,
  createFeedbackPackState,
  classifyFeedbackTemplate,
  headTailWithElide,
  formatFeedbackPack,
  applyFeedbackPack,
  noteReadOfFullLog,
  notePlanAfterFeedback,
  notePatchAfterFeedback,
  feedbackPackSummary,
  TEMPLATES,
} = require("../src/main/skills/coding-feedback-pack");

test("feedback pack defaults off; env enables", () => {
  const prev = process.env.MOGU_FEEDBACK_PACK;
  try {
    delete process.env.MOGU_FEEDBACK_PACK;
    assert.equal(isFeedbackPackEnabled({}), false);
    assert.equal(isFeedbackPackEnabled({ feedbackPack: true }), true);
    process.env.MOGU_FEEDBACK_PACK = "1";
    assert.equal(isFeedbackPackEnabled({}), true);
  } finally {
    if (prev === undefined) delete process.env.MOGU_FEEDBACK_PACK;
    else process.env.MOGU_FEEDBACK_PACK = prev;
  }
});

test("P3 templates: test / action / infra", () => {
  assert.equal(
    classifyFeedbackTemplate("ok=false failedStage=FAIL_TO_PASS\nAssertionError"),
    TEMPLATES.test_failure
  );
  assert.equal(
    classifyFeedbackTemplate("ERROR: unknown tool", { toolName: "apply_patch" }),
    TEMPLATES.action_error
  );
  assert.equal(classifyFeedbackTemplate("NO_VERIFY: no stages"), TEMPLATES.infra_failure);
  assert.equal(
    classifyFeedbackTemplate("ok=false kind=env\nHINT: host env missing deps"),
    TEMPLATES.infra_failure
  );
});

test("P2 head+tail with explicit elide", () => {
  const long = `${"H".repeat(3000)}${"T".repeat(3000)}`;
  const { body, elided, headTail } = headTailWithElide(long, 100, 100);
  assert.equal(headTail, true);
  assert.ok(elided > 0);
  assert.match(body, /\[elided \d+ chars/);
  assert.ok(body.startsWith("H".repeat(100)));
  assert.ok(body.endsWith("T".repeat(100)));
});

test("P1 status prefix + pack meta", () => {
  const raw = [
    "ok=false failedStage=FAIL_TO_PASS via=docker strict=true",
    "[FAIL_TO_PASS] ok=false kind=test",
    "cmd: pytest tests/foo.py",
    "AssertionError: expected 1",
  ].join("\n");
  const { visible, meta } = formatFeedbackPack(raw, {
    toolName: "run_tests",
    seq: 1,
    fullLogPath: "/tmp/full_log.txt",
  });
  assert.ok(visible.startsWith("FEEDBACK_PACK"));
  assert.equal(meta.has_status_prefix, true);
  assert.equal(meta.failure_class, "f2p_miss");
  assert.equal(meta.template, TEMPLATES.test_failure);
  assert.equal(meta.full_log_path, "/tmp/full_log.txt");
  assert.match(visible, /failure_class=f2p_miss/);
  assert.match(visible, /full_log_path=/);
});

test("applyFeedbackPack writes artifacts and tracks M6–M9 signals", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-pack-"));
  const state = createFeedbackPackState({ feedbackPack: true, feedbackPackDir: dir });
  const longTail = `TAIL_MARKER_${"x".repeat(4000)}`;
  const raw = `ok=false failedStage=PASS_TO_PASS\n[PASS_TO_PASS] ok=false\n${"y".repeat(4000)}\n${longTail}`;
  const { out, pack } = applyFeedbackPack(state, raw, { toolName: "run_tests" });
  assert.ok(out.startsWith("FEEDBACK_PACK"));
  assert.ok(pack.meta.has_elide_marker || pack.meta.head_tail);
  assert.ok(fs.existsSync(path.join(dir, "last_verify.txt")));
  assert.ok(fs.existsSync(path.join(dir, "full_log.txt")));
  assert.ok(fs.existsSync(path.join(dir, "meta.json")));

  assert.equal(noteReadOfFullLog(state, path.join(dir, "full_log.txt")), true);
  notePlanAfterFeedback(state, {
    hypothesis: "FAIL_TO_PASS was wrong; fix PASS_TO_PASS regression in widgets",
    approach: "address p2p_regression",
  });
  notePlanAfterFeedback(state, {
    hypothesis: "different hypothesis about forms/renderers",
    approach: "new path",
  });
  notePatchAfterFeedback(state, "diff --git a/a.py\n-old\n+new\n", ["a.py"]);
  notePatchAfterFeedback(state, "diff --git a/b.py\n-old\n+new2\n", ["b.py"]);

  const summary = feedbackPackSummary(state);
  assert.equal(summary.enabled, true);
  assert.equal(summary.has_status_prefix, true);
  assert.equal(summary.tools_read_full_log, true);
  assert.equal(summary.hypothesis_cites_feedback, true);
  assert.equal(summary.hypothesis_text_changed, true);
  assert.equal(summary.file_set_changed, true);
  assert.ok(summary.jaccard_patch == null || typeof summary.jaccard_patch === "number");
});
