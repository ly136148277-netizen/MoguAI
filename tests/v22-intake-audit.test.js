const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { audit } = require("../scripts/audit_v22_intake");

test("2.2 intake audit: no new runtime deps and LSP remains external", () => {
  const result = audit(path.join(__dirname, ".."));
  assert.equal(result.ok, true, result.failures.join("; "));
  assert.deepEqual(result.newRuntimeDependencies, []);
  assert.ok(result.auditedRuntimeDependencies.includes("node-pty"));
});
