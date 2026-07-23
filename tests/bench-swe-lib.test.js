const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAgentPrompt,
  buildSweTestPlan,
  predictionLine,
  parseArgs,
} = require("../scripts/bench_swe_lib");

test("buildAgentPrompt includes issue and forbids unrelated scope language", () => {
  const prompt = buildAgentPrompt({
    instance_id: "django__django-123",
    repo: "django/django",
    problem_statement: "Fix validation when password empty",
    hints_text: "check auth forms",
  });
  assert.match(prompt, /django__django-123/);
  assert.match(prompt, /password empty/);
  assert.match(prompt, /minimal correct patch/i);
});

test("buildAgentPrompt includes FAIL_TO_PASS nodes", () => {
  const prompt = buildAgentPrompt({
    instance_id: "astropy__astropy-1",
    repo: "astropy/astropy",
    problem_statement: "fix matrix",
    FAIL_TO_PASS: ["astropy/modeling/tests/test_separable.py::test_nested"],
  });
  assert.match(prompt, /Failing tests/);
  assert.match(prompt, /test_nested/);
});

test("buildSweTestPlan keeps pytest node ids for astropy", () => {
  const plan = buildSweTestPlan({
    repo: "astropy/astropy",
    FAIL_TO_PASS: ["astropy/io/ascii/tests/test_qdp.py::test_lower"],
    PASS_TO_PASS: [
      "astropy/io/ascii/tests/test_qdp.py::test_ok",
      "astropy/table/tests/test_table.py::test_other",
    ],
  });
  assert.match(plan.failCommand, /test_qdp\.py::test_lower/);
  assert.equal(plan.stages[0].name, "FAIL_TO_PASS");
  assert.equal(plan.stages[1].name, "PASS_TO_PASS");
  assert.match(plan.passCommand, /test_qdp\.py::test_ok/);
  assert.ok(!plan.passCommand.includes("test_table.py"));
  assert.ok(plan.sourceHintPaths.includes("astropy/io/ascii/qdp.py"));
});

test("buildSweTestPlan builds django runtests labels", () => {
  const plan = buildSweTestPlan({
    repo: "django/django",
    FAIL_TO_PASS: ["file_uploads.tests.TestUpload.test_perm"],
    PASS_TO_PASS: ["file_uploads.tests.TestUpload.test_ok", "admin.tests.Foo.test_x"],
  });
  assert.match(plan.failCommand, /tests\/runtests\.py/);
  assert.match(plan.failCommand, /file_uploads\.tests\.TestUpload\.test_perm/);
  assert.match(plan.passCommand, /file_uploads\.tests\.TestUpload\.test_ok/);
  assert.ok(!plan.passCommand.includes("admin.tests"));
});

test("predictionLine matches SWE-bench jsonl shape", () => {
  const row = predictionLine({
    instanceId: "x__y-1",
    modelName: "moguai-moguai_a",
    patch: "diff --git a/a b/a\n",
  });
  assert.equal(row.instance_id, "x__y-1");
  assert.equal(row.model_name_or_path, "moguai-moguai_a");
  assert.match(row.model_patch, /diff --git/);
});

test("parseArgs reads limit and dry-run", () => {
  const a = parseArgs(["--limit", "3", "--dry-run"]);
  assert.equal(a.limit, "3");
  assert.equal(a["dry-run"], true);
});
