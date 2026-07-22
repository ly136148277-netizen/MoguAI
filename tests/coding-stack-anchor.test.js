const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractStackAnchor,
  isThirdPartyPath,
  buildAnchorInjection,
} = require("../src/main/skills/coding-stack-anchor");

test("extractStackAnchor prefers project File frame over site-packages", () => {
  const log = `
E   AssertionError: assert False
/opt/miniconda3/lib/python3.10/site-packages/pytest/foo.py:12: in helper
    raise AssertionError
File "/testbed/astropy/modeling/separable.py", line 88, in _cstack
    return np.vstack
File "/opt/miniconda3/lib/python3.10/site-packages/numpy/core/shape_base.py", line 1, in <module>
    pass
`;
  const a = extractStackAnchor(log, { workspace: "/testbed" });
  assert.ok(a);
  assert.equal(a.path, "astropy/modeling/separable.py");
  assert.equal(a.line, 88);
});

test("extractStackAnchor returns null when only third-party frames", () => {
  const log = `
File "/usr/lib/python3.10/site-packages/pytest/runner.py", line 10, in run
    pass
`;
  assert.equal(extractStackAnchor(log), null);
  assert.equal(isThirdPartyPath("/usr/lib/python3.10/site-packages/x.py"), true);
});

test("buildAnchorInjection mentions path and line", () => {
  const s = buildAnchorInjection({ path: "pkg/mod.py", line: 12 }, "12|def f():");
  assert.match(s, /HARD ANCHOR/);
  assert.match(s, /pkg\/mod\.py:12/);
  assert.match(s, /def f/);
});
