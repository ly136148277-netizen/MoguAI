const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const {
  planChangeScope,
  pathInScope,
  checkScopeViolation,
  enforceScope,
  enrichPromptWithScope,
  normalizeScopeMode,
  extractPathHints,
} = require("../src/main/skills/coding-scope");
const { getSkillDef } = require("../src/main/skills/registry");

function initGitRepo(dir) {
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8", windowsHide: true });
  spawnSync("git", ["config", "user.email", "t@t.com"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir, windowsHide: true });
}

test("extractPathHints and explicit allowPaths lock scope", () => {
  const hints = extractPathHints("请改 src/auth/login.js 和 helpers.ts");
  assert.ok(hints.some((h) => h.includes("login.js")));
  const scope = planChangeScope("/tmp/nope", "anything", {
    allowPaths: ["src/a.js", "src/b.js"],
  });
  assert.equal(scope.locked, true);
  assert.equal(scope.source, "explicit");
  assert.deepEqual(scope.allowedPaths, ["src/a.js", "src/b.js"]);
});

test("planChangeScope infers files from prompt against repo", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-scope-"));
  initGitRepo(dir);
  await fs.ensureDir(path.join(dir, "src"));
  await fs.writeFile(path.join(dir, "src", "login.js"), "export const x = 1\n");
  await fs.writeFile(path.join(dir, "src", "login.test.js"), "test('x', () => {})\n");
  await fs.writeFile(path.join(dir, "README.md"), "# hi\n");
  spawnSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });

  const scope = planChangeScope(dir, "fix login button validation in src/login.js");
  assert.ok(scope.allowedPaths.some((p) => p.includes("login.js")));
  assert.equal(scope.locked, true);
});

test("pathInScope supports directory allow and check/enforce trim", async () => {
  assert.equal(pathInScope("src/auth/a.js", ["src/auth"]), true);
  assert.equal(pathInScope("docs/x.md", ["src/auth"]), false);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-scope-en-"));
  initGitRepo(dir);
  await fs.writeFile(path.join(dir, "keep.js"), "keep\n");
  await fs.writeFile(path.join(dir, "noise.js"), "noise\n");
  spawnSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });
  await fs.writeFile(path.join(dir, "keep.js"), "keep2\n");
  await fs.writeFile(path.join(dir, "noise.js"), "noise2\n");

  const review = {
    files: [
      { path: "keep.js", status: "M" },
      { path: "noise.js", status: "M" },
    ],
  };
  const scope = { locked: true, allowedPaths: ["keep.js"] };
  const checked = checkScopeViolation(review, scope);
  assert.equal(checked.violation, true);
  assert.deepEqual(checked.outOfScope, ["noise.js"]);

  const enforced = enforceScope(dir, review, scope, { mode: "trim" });
  assert.equal(enforced.enforced, true);
  assert.ok(enforced.trimmed.includes("noise.js"));
  assert.match(await fs.readFile(path.join(dir, "noise.js"), "utf8"), /^noise\r?\n?$/);
  assert.match(await fs.readFile(path.join(dir, "keep.js"), "utf8"), /keep2/);
});

test("enrichPromptWithScope and normalizeScopeMode", () => {
  const hard = enrichPromptWithScope("do it", {
    locked: true,
    allowedPaths: ["a.js"],
  });
  assert.match(hard, /文件集锁定/);
  assert.match(hard, /a\.js/);
  assert.equal(normalizeScopeMode("trim"), "trim");
  assert.equal(normalizeScopeMode(undefined, { enforce: false }), "off");
  assert.equal(normalizeScopeMode("warn"), "warn");
});

test("mogu.coding registers planScope", () => {
  const def = getSkillDef("mogu.coding");
  assert.ok(def.ops.includes("planScope"));
});
