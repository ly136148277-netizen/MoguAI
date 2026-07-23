const test = require("node:test");
const assert = require("node:assert/strict");
const { check } = require("../scripts/check_public_build_profile");

test("public build profile gate passes on current tree", () => {
  const result = check();
  assert.equal(result.ok, true, JSON.stringify(result.hits, null, 2));
  assert.equal(result.profileId, "mogu-public-win-x64-v1");
  assert.equal(result.profileInputs.packageBuildSha256.length, 64);
  assert.equal(result.profileInputs.settingsSourceSha256.length, 64);
});
