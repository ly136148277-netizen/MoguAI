const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSweEvalImage } = require("../src/main/skills/coding-swe-image");
const { wrapSweShellCommand } = require("../src/main/skills/coding-docker-verify");
const { runVerifyWithOptionalDocker } = require("../src/main/skills/coding-docker-verify");

test("resolveSweEvalImage matches harness naming", () => {
  assert.equal(
    resolveSweEvalImage("astropy__astropy-12907"),
    "swebench/sweb.eval.x86_64.astropy_1776_astropy-12907:latest"
  );
  assert.equal(
    resolveSweEvalImage("django__django-11099"),
    "swebench/sweb.eval.x86_64.django_1776_django-11099:latest"
  );
});

test("wrapSweShellCommand activates conda testbed", () => {
  const w = wrapSweShellCommand("python -m pytest x -q");
  assert.match(w, /conda activate testbed/);
  assert.match(w, /cd \/testbed/);
  assert.match(w, /pytest x/);
});

test("strict docker verify fails closed without image", () => {
  const r = runVerifyWithOptionalDocker(
    process.cwd(),
    [{ name: "FAIL_TO_PASS", command: "python -c \"print(1)\"" }],
    { dockerImage: "", dockerStrict: true }
  );
  assert.equal(r.ok, false);
  assert.equal(r.kind, "infra");
});
