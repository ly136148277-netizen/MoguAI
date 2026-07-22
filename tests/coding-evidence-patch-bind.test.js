const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isEvidencePatchBindEnabled,
  createEvidencePatchBindState,
  noteVerifyFailureForBind,
  checkApplyBindingGate,
  submitPatchBinding,
  noteApplyAttempt,
  notePatchAfterBinding,
  scoreDb2,
  evidencePatchBindSummary,
  parseLocus,
} = require("../src/main/skills/coding-evidence-patch-bind");

const FAIL_TEXT = [
  "failedStage=FAIL_TO_PASS",
  "FAIL: test_form_media",
  'File "/testbed/django/forms/widgets.py", line 72, in render',
  "AssertionError: media mismatch",
].join("\n");

test("EPB defaults off; env enables", () => {
  const prev = process.env.MOGU_EVIDENCE_PATCH_BIND;
  try {
    delete process.env.MOGU_EVIDENCE_PATCH_BIND;
    assert.equal(isEvidencePatchBindEnabled({}), false);
    assert.equal(isEvidencePatchBindEnabled({ evidencePatchBind: true }), true);
    process.env.MOGU_EVIDENCE_PATCH_BIND = "1";
    assert.equal(isEvidencePatchBindEnabled({}), true);
  } finally {
    if (prev === undefined) delete process.env.MOGU_EVIDENCE_PATCH_BIND;
    else process.env.MOGU_EVIDENCE_PATCH_BIND = prev;
  }
});

test("parseLocus accepts path-shaped loci", () => {
  assert.equal(parseLocus("django/forms/widgets.py").ok, true);
  assert.equal(parseLocus("django/forms/widgets.py:72").ok, true);
  assert.equal(parseLocus("django/forms/widgets.py::render").ok, true);
  assert.equal(parseLocus("just a sentence").ok, false);
});

test("BINDING_MISSING then MALFORMED then VALID; DB2 L2 file overlap", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epb-"));
  const state = createEvidencePatchBindState({
    evidencePatchBind: true,
    evidencePatchBindDir: dir,
  });
  const ev = noteVerifyFailureForBind(state, FAIL_TEXT, {
    failedStage: "FAIL_TO_PASS",
  });
  assert.ok(ev.evidence_id);
  assert.equal(ev.error_class, "f2p_miss");

  const missing = checkApplyBindingGate(state);
  assert.equal(missing.allow, false);
  assert.equal(missing.code, "BINDING_MISSING");

  const bad = submitPatchBinding(state, {
    evidence_id: ev.evidence_id,
    failed_stage: "PASS_TO_PASS",
    error_class: "f2p_miss",
    intended_locus: "django/forms/widgets.py",
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "BINDING_MALFORMED");

  const ok = submitPatchBinding(state, {
    evidence_id: ev.evidence_id,
    failed_stage: "FAIL_TO_PASS",
    error_class: "f2p_miss",
    intended_locus: "django/forms/widgets.py::render",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.code, "BINDING_VALID");

  const allow = checkApplyBindingGate(state);
  assert.equal(allow.allow, true);

  noteApplyAttempt(state, { afterFail: true });
  const bound = notePatchAfterBinding(
    state,
    "diff --git a/django/forms/widgets.py\n",
    ["django/forms/widgets.py"]
  );
  assert.equal(bound.DB2, true);
  assert.ok(bound.DB2_level === 1 || bound.DB2_level === 2);
  assert.equal(bound.DB4, true);

  const summary = evidencePatchBindSummary(state);
  assert.equal(summary.binding_missing, 1);
  assert.equal(summary.binding_malformed, 1);
  assert.equal(summary.binding_valid, 1);
  assert.ok(summary.DB0 != null && summary.DB0 > 0);
  assert.ok(fs.existsSync(path.join(dir, "evidence_01.json")));
  assert.ok(fs.existsSync(path.join(dir, "gate_rejects.jsonl")));
});

test("DB2 Level 3 dependency_edge same parent", () => {
  const binding = {
    locus: parseLocus("django/forms/helpers.py::helper_bar"),
    fields: {
      intended_locus: "django/forms/helpers.py::helper_bar",
      dependency_edge: "helper",
    },
  };
  const evidence = {
    anchors: {
      symbols: ["render"],
      files: ["django/forms/widgets.py"],
      file_lines: [],
      assertion_snips: [],
    },
  };
  const scored = scoreDb2(binding, evidence, ["django/forms/helpers.py"]);
  assert.equal(scored.pass, true);
  assert.equal(scored.level, 3);
});
