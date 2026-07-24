const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RepoIndex } = require("../src/main/moguai/intelligence/repo-index");
const { createCodingToolRunner } = require("../src/main/skills/coding-agent-tools");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-repo-index-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src", "util.js"),
    "export function helper(value) { return value + 1; }\n"
  );
  fs.writeFileSync(
    path.join(root, "src", "app.js"),
    "const { helper } = require('./util');\nexport function run() {\n  return helper(1);\n}\n"
  );
  return root;
}

test("repo index rejects path escape", () => {
  const root = fixture();
  const index = new RepoIndex(root);
  assert.throws(() => index.resolvePath("../outside.js"), (error) => error.code === "path_escape");
});

test("repo index exposes imports, importers, references, definitions, and call edges", () => {
  const root = fixture();
  const index = new RepoIndex(root);
  const first = index.update();
  assert.equal(first.changed, 2);
  assert.deepEqual(index.getImports("src/app.js").paths, ["src/util.js"]);
  assert.deepEqual(index.getImporters("src/util.js"), ["src/app.js"]);
  assert.equal(index.findDefinitions("helper")[0].file, "src/util.js");
  assert.ok(index.findReferences("helper").some((ref) => ref.file === "src/app.js" && ref.line === 3));
  assert.ok(index.getCallEdges("helper").some((edge) => edge.caller === "run"));
});

test("repo index refreshes only changed files and removes deleted files", async () => {
  const root = fixture();
  const index = new RepoIndex(root);
  index.update();
  const unchanged = index.update();
  assert.equal(unchanged.changed, 0);
  await new Promise((resolve) => setTimeout(resolve, 15));
  fs.appendFileSync(path.join(root, "src", "util.js"), "export const added = 2;\n");
  const changed = index.update();
  assert.equal(changed.changed, 1);
  assert.equal(index.findDefinitions("added").length, 1);
  fs.unlinkSync(path.join(root, "src", "app.js"));
  const removed = index.update();
  assert.equal(removed.removed, 1);
  assert.deepEqual(index.getImporters("src/util.js"), []);
});

test("coding tools expose repository intelligence only when opted in", async () => {
  const root = fixture();
  const off = createCodingToolRunner({ workspace: root });
  assert.equal(off.defs.some((item) => item.function.name === "repo_intelligence"), false);
  const on = createCodingToolRunner({ workspace: root, repoIntelligence: true });
  assert.equal(on.defs.some((item) => item.function.name === "discover_tests"), true);
  const result = await on.execute("repo_intelligence", { op: "definitions", symbol: "helper" });
  assert.match(result, /src\/util\.js/);
});
