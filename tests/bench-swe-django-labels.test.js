const test = require("node:test");
const assert = require("node:assert/strict");
const {
  toDjangoRuntestsLabel,
  buildSweTestPlan,
} = require("../scripts/bench_swe_lib");

test("toDjangoRuntestsLabel converts unittest-style labels", () => {
  assert.equal(
    toDjangoRuntestsLabel(
      "test_override_file_upload_permissions (test_utils.tests.OverrideSettingsTests)"
    ),
    "test_utils.tests.OverrideSettingsTests.test_override_file_upload_permissions"
  );
  assert.equal(
    toDjangoRuntestsLabel("already.dotted.Class.test_name"),
    "already.dotted.Class.test_name"
  );
});

test("buildSweTestPlan django fail command uses dotted labels", () => {
  const plan = buildSweTestPlan({
    repo: "django/django",
    FAIL_TO_PASS: JSON.stringify([
      "test_override_file_upload_permissions (test_utils.tests.OverrideSettingsTests)",
    ]),
    PASS_TO_PASS: "[]",
  });
  assert.match(
    plan.failCommand,
    /test_utils\.tests\.OverrideSettingsTests\.test_override_file_upload_permissions/
  );
  assert.doesNotMatch(plan.failCommand, /test_override_file_upload_permissions \(/);
});
