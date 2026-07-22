const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const {
  extractFromSource,
  resolveImport,
  planEditAccuracy,
  enrichPromptWithAccuracy,
  assessContentAccuracy,
  buildContentFixPrompt,
} = require("../src/main/skills/coding-accuracy");

function initGitRepo(dir) {
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8", windowsHide: true });
  spawnSync("git", ["config", "user.email", "t@t.com"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir, windowsHide: true });
}

test("extractFromSource finds symbols and imports", () => {
  const src = `
import { helper } from './util';
export function validateLogin() {}
export class AuthService {}
const unused = require('./other');
`;
  const { symbols, imports } = extractFromSource("src/auth.js", src);
  assert.ok(symbols.includes("validateLogin"));
  assert.ok(symbols.includes("AuthService"));
  assert.ok(imports.includes("./util"));
  assert.ok(imports.includes("./other"));
});

test("resolveImport maps relative specs", () => {
  const all = new Set(["src/util.js", "src/auth.js", "src/lib/index.ts"]);
  assert.equal(resolveImport("src/auth.js", "./util", all), "src/util.js");
  assert.equal(resolveImport("src/auth.js", "./lib", all), "src/lib/index.ts");
  assert.equal(resolveImport("src/auth.js", "lodash", all), null);
});

test("planEditAccuracy uses symbols and import hop", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-acc-"));
  initGitRepo(dir);
  await fs.ensureDir(path.join(dir, "src"));
  await fs.writeFile(
    path.join(dir, "src", "util.js"),
    "export function helper() { return 1 }\n"
  );
  await fs.writeFile(
    path.join(dir, "src", "login.js"),
    "import { helper } from './util';\nexport function validateLogin() { return helper() }\n"
  );
  await fs.writeFile(path.join(dir, "README.md"), "# app\n");
  spawnSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dir, windowsHide: true });

  const plan = planEditAccuracy(dir, "fix validateLogin to reject empty password");
  assert.ok(plan.targetPaths.some((p) => p.includes("login.js")));
  assert.ok(plan.mustTouch.some((t) => /validatelogin|password|login/i.test(t)));
  assert.ok(plan.locked);
  const prompt = enrichPromptWithAccuracy("fix it", plan);
  assert.match(prompt, /改对位置/);
  assert.match(prompt, /改对内容/);
});

test("assessContentAccuracy flags off-topic diffs", () => {
  const plan = {
    targetPaths: ["src/login.js"],
    mustTouch: ["validateLogin", "password"],
  };
  const bad = assessContentAccuracy(
    {
      files: [{ path: "README.md" }],
      diff: `diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # app\n+totally unrelated blurb\n`,
    },
    "fix validateLogin password",
    plan
  );
  assert.equal(bad.needsContentFix, true);
  assert.ok(bad.warning);

  const good = assessContentAccuracy(
    {
      files: [{ path: "src/login.js" }],
      diff: `diff --git a/src/login.js b/src/login.js\n--- a/src/login.js\n+++ b/src/login.js\n@@ -1 +1,2 @@\n export function validateLogin() {}\n+if (!password) throw new Error('empty')\n`,
    },
    "fix validateLogin password",
    plan
  );
  assert.equal(good.needsContentFix, false);
  assert.ok(good.hitCount >= 1);

  const fix = buildContentFixPrompt("fix login", bad, plan);
  assert.match(fix, /内容纠偏/);
});
