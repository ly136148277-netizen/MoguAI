const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discoverTests } = require("../src/main/moguai/intelligence/test-discovery");
const { normalizeVerifyStages } = require("../src/main/skills/coding-local-patch");

test("discovers Node, pytest, Go, and Cargo tests without execution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-test-discovery-"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } })
  );
  fs.writeFileSync(path.join(root, "tests", "unit.test.js"), "throw new Error('must not run');\n");
  fs.writeFileSync(path.join(root, "tests", "test_api.py"), "raise RuntimeError('must not run')\n");
  fs.writeFileSync(path.join(root, "src", "thing_test.go"), "package thing\n");
  fs.writeFileSync(path.join(root, "tests", "integration.rs"), "#[test] fn it_works() {}\n");
  fs.writeFileSync(path.join(root, "go.mod"), "module example.test/m\n");
  fs.writeFileSync(path.join(root, "Cargo.toml"), "[package]\nname='m'\nversion='0.1.0'\n");

  const plan = discoverTests(root);
  assert.equal(plan.ok, true);
  assert.ok(plan.tests.some((item) => item.framework === "node" && item.path.endsWith(".test.js")));
  assert.ok(plan.tests.some((item) => item.framework === "pytest" && item.path.endsWith("test_api.py")));
  assert.ok(plan.tests.some((item) => item.framework === "go" && item.path.endsWith("_test.go")));
  assert.ok(plan.tests.some((item) => item.framework === "cargo" && item.path.endsWith(".rs")));
  assert.deepEqual(
    plan.verifyStages.map((stage) => stage.command),
    ["npm test", "python -m pytest", "go test ./...", "cargo test"]
  );
  assert.deepEqual(normalizeVerifyStages("", plan.verifyStages), plan.verifyStages);
});

test("node test files produce quoted read-only plan commands without package script", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-node-discovery-"));
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "test", "space name.test.js"), "");
  const plan = discoverTests(root);
  assert.equal(plan.verifyStages.length, 1);
  assert.match(plan.verifyStages[0].command, /^node --test "test\/space name\.test\.js"$/);
});

test("recognizes configured Jest without running or installing it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-jest-discovery-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ devDependencies: { jest: "^30.0.0" } })
  );
  fs.writeFileSync(path.join(root, "unit.spec.js"), "");
  const plan = discoverTests(root);
  assert.equal(plan.tests[0].framework, "jest");
  assert.equal(plan.verifyStages[0].command, "npx --no-install jest");
});
