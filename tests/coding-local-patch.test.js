const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterBlocksToAllow,
  sanitizeUnifiedDiff,
  extractSearchReplaceBlocks,
  rankAllowPaths,
  normalizeVerifyStages,
  classifyVerifyFailure,
} = require("../src/main/skills/coding-local-patch");
const { normalizeModelPatch } = require("../scripts/bench_swe_lib");

test("filterBlocksToAllow remaps basename to allowPaths", () => {
  const blocks = [{ file: "separable.py", search: "a", replace: "b" }];
  const out = filterBlocksToAllow(blocks, ["astropy/modeling/separable.py"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].file, "astropy/modeling/separable.py");
});

test("rankAllowPaths demotes fixture data files", () => {
  const ranked = rankAllowPaths(
    ["astropy/io/fits/tests/data/test.fits", "astropy/io/fits/hdu/base.py"],
    "fix HDU base class for fits",
    2
  );
  assert.ok(ranked.includes("astropy/io/fits/hdu/base.py"));
  assert.ok(!ranked.includes("astropy/io/fits/tests/data/test.fits"));
});

test("sanitizeUnifiedDiff trims trailing spaces on hunk lines", () => {
  const raw = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old  \n+new  \n";
  const cleaned = sanitizeUnifiedDiff(raw);
  assert.match(cleaned, /\n-old\n/);
  assert.match(cleaned, /\n\+new\n/);
});

test("extractSearchReplaceBlocks parses aider format", () => {
  const raw = [
    "pkg/mod.py",
    "<<<<<<< SEARCH",
    "x = 1",
    "=======",
    "x = 2",
    ">>>>>>> REPLACE",
  ].join("\n");
  const blocks = extractSearchReplaceBlocks(raw);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].file, "pkg/mod.py");
  assert.equal(blocks[0].replace, "x = 2");
});

test("normalizeModelPatch rejects empty / fenceless junk", () => {
  assert.equal(normalizeModelPatch(""), "");
  assert.equal(normalizeModelPatch("hello world"), "");
  const ok = normalizeModelPatch("diff --git a/a.py b/a.py\n@@ -1 +1 @@\n-a\n+b\n");
  assert.ok(ok.includes("diff --git"));
});

test("normalizeVerifyStages prefers staged FAIL/PASS plan", () => {
  const stages = normalizeVerifyStages("python -m pytest a.py", [
    { name: "FAIL_TO_PASS", command: "python -m pytest a.py::t1" },
    { name: "PASS_TO_PASS", command: "python -m pytest a.py::t2" },
  ]);
  assert.equal(stages.length, 2);
  assert.equal(stages[0].name, "FAIL_TO_PASS");
  assert.match(stages[0].command, /a\.py::t1/);
});

test("classifyVerifyFailure distinguishes env vs test", () => {
  assert.equal(classifyVerifyFailure("ModuleNotFoundError: No module named 'astropy'"), "env");
  assert.equal(classifyVerifyFailure("FAILED test_x.py::test_y - AssertionError"), "test");
});
