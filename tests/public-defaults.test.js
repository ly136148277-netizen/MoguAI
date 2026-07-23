const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { DEFAULT_SETTINGS } = require("../src/main/settings");
const { PaiBridge } = require("../src/main/pai-bridge");

test("public defaults do not auto-start PAI or silently fallback", () => {
  assert.equal(DEFAULT_SETTINGS.autoStartPai, false);
  assert.equal(DEFAULT_SETTINGS.openclawFallbackToPai, false);
  assert.equal(DEFAULT_SETTINGS.agentRuntimeMode, "openclaw");
});

test("PaiBridge falls back to app userData, never a developer drive", () => {
  const userDataPath = path.join("C:", "Users", "Public", "MoguTestProfile");
  const bridge = new PaiBridge({ userDataPath });
  assert.equal(bridge.resolvePaiRoot({}), path.join(userDataPath, "pai"));
});

test("PaiBridge preserves explicit user PAI root", () => {
  const bridge = new PaiBridge({ userDataPath: path.join("C:", "profile") });
  const explicit = path.join("F:", "my-pai");
  assert.equal(bridge.resolvePaiRoot({ paiRoot: explicit }), explicit);
});
