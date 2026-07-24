const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { collectSeenIds, freezeHoldout, seededShuffle } = require("../scripts/freeze_v21_holdout");

test("seededShuffle is deterministic", () => {
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5], 2101), seededShuffle([1, 2, 3, 4, 5], 2101));
});

test("freezeHoldout excludes historical IDs and omits gold fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-v21-holdout-"));
  try {
    const source = path.join(root, "tasks.json");
    const seenRoot = path.join(root, "runs");
    const output = path.join(root, "holdout", "manifest.json");
    fs.mkdirSync(seenRoot);
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      instance_id: `repo__repo-${index + 1}`,
      repo: "repo/repo",
      base_commit: `commit-${index + 1}`,
      patch: "must-not-leak",
      problem_statement: "must-not-leak",
    }));
    fs.writeFileSync(source, JSON.stringify({ dataset: "fixture", tasks }));
    fs.writeFileSync(path.join(seenRoot, "result.json"), JSON.stringify({ instance_id: "repo__repo-1" }));
    const manifest = freezeHoldout({ source, seenRoots: [seenRoot], output, count: 3, seed: 7 });
    assert.equal(manifest.taskCount, 3);
    assert.equal(manifest.excludedSeenCount, 1);
    assert.ok(!manifest.tasks.some((task) => task.instance_id === "repo__repo-1"));
    assert.ok(manifest.tasks.every((task) => !("patch" in task) && !("problem_statement" in task)));
    assert.deepEqual(collectSeenIds([seenRoot]), new Set(["repo__repo-1"]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
