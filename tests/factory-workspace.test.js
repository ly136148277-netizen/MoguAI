const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  listTree,
  readFileInWorkspace,
  writeFileInWorkspace,
  assertInsideWorkspace,
} = require("../src/main/moguai/factory/workspace-fs");

describe("moguai factory workspace-fs", () => {
  let dir;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-factory-"));
    await fs.outputFile(path.join(dir, "src", "a.js"), "console.log(1);\n");
    await fs.outputFile(path.join(dir, "readme.md"), "# hi\n");
    await fs.ensureDir(path.join(dir, "node_modules", "pkg"));
    await fs.outputFile(path.join(dir, "node_modules", "pkg", "x.js"), "x");
  });

  after(async () => {
    await fs.remove(dir);
  });

  it("lists workspace and skips node_modules", async () => {
    const result = await listTree(dir);
    assert.equal(result.ok, true);
    assert.ok(result.entries.some((e) => e.path === "src/a.js"));
    assert.ok(result.entries.some((e) => e.path === "readme.md"));
    assert.ok(!result.entries.some((e) => e.path.includes("node_modules")));
  });

  it("reads and writes inside workspace", async () => {
    const read = await readFileInWorkspace(dir, "src/a.js");
    assert.match(read.content, /console\.log/);
    const written = await writeFileInWorkspace(dir, "src/a.js", "console.log(2);\n");
    assert.equal(written.ok, true);
    const again = await readFileInWorkspace(dir, "src/a.js");
    assert.match(again.content, /console\.log\(2\)/);
  });

  it("rejects path escape", () => {
    assert.throws(() => assertInsideWorkspace(dir, "../outside.txt"), (err) => err.code === "path_escape");
  });

  it("rejects read outside via relative escape", async () => {
    await assert.rejects(() => readFileInWorkspace(dir, "../../etc/passwd"), (err) => err.code === "path_escape");
  });
});
