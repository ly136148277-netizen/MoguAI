const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { audit } = require("../scripts/audit_v21_dependencies");

test("2.1 external runtime dependency is pinned, licensed and packaged", () => {
  const result = audit(path.join(__dirname, ".."));
  assert.equal(result.ok, true, result.failures.join("; "));
  assert.equal(result.expected["node-pty"].version, "1.1.0");
  assert.equal(result.expected["node-pty"].license, "MIT");
  assert.equal(result.expected["node-addon-api"].version, "7.1.1");
});
