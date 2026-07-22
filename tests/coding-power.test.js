const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseDiffHunks,
  enrichPrompt,
  assessChangeQuality,
  scoreEngineTrial,
  RULE_FILES,
} = require("../src/main/skills/coding-power");
const { getSkillDef } = require("../src/main/skills/registry");

const SAMPLE_DIFF = `diff --git a/src/a.js b/src/a.js
index 111..222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
@@ -10,2 +11,3 @@
 keep
+more
`;

test("parseDiffHunks extracts file hunks with ids", () => {
  const hunks = parseDiffHunks(SAMPLE_DIFF);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].file, "src/a.js");
  assert.equal(hunks[0].id, "src/a.js#0");
  assert.match(hunks[0].header, /^@@ /);
  assert.ok(hunks[0].body.some((l) => l.startsWith("+added")));
  assert.equal(hunks[1].id, "src/a.js#1");
});

test("enrichPrompt prepends project preamble", () => {
  const out = enrichPrompt("fix login", { preamble: "【项目约定】用 ESM" });
  assert.match(out, /项目约定/);
  assert.match(out, /用户任务/);
  assert.match(out, /fix login/);
  assert.equal(enrichPrompt("x", { preamble: "" }), "x");
});

test("assessChangeQuality flags sprawling unrelated edits", () => {
  const clean = assessChangeQuality({
    files: [{ path: "src/login.js" }, { path: "tests/login.test.js" }],
  }, "fix login");
  assert.equal(clean.ok, true);

  const noisy = assessChangeQuality(
    {
      files: Array.from({ length: 16 }, (_, i) => ({ path: `docs/noise-${i}.md` })),
    },
    "fix login button"
  );
  assert.equal(noisy.ok, false);
  assert.ok(noisy.warning);
});

test("scoreEngineTrial prefers verify pass and small diffs", () => {
  const high = scoreEngineTrial({
    verify: { ok: true },
    review: { canCommit: true, fileCount: 3 },
    quality: { ok: true },
  });
  const low = scoreEngineTrial({
    verify: { ok: false },
    review: { canCommit: false, fileCount: 30 },
    quality: { ok: false, flags: ["a", "b"] },
  });
  assert.ok(high > low);
});

test("mogu.coding registers power ops", () => {
  const def = getSkillDef("mogu.coding");
  for (const op of ["compare", "hunks", "rejectHunk", "acceptHunk", "projectContext"]) {
    assert.ok(def.ops.includes(op), op);
  }
  assert.ok(RULE_FILES.includes(".moguai/rules.md"));
});
