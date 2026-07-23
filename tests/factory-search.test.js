const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { searchWorkspace } = require("../src/main/moguai/factory/workspace-fs");

describe("moguai factory searchWorkspace", () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "moguai-search-"));
    await fs.writeFile(path.join(dir, "hello-util.js"), "function greetName() { return 1; }\n", "utf8");
    await fs.writeFile(path.join(dir, "readme.md"), "# hi\n", "utf8");
  });
  after(async () => {
    await fs.remove(dir);
  });

  it("finds by filename", async () => {
    const res = await searchWorkspace(dir, "hello");
    assert.equal(res.ok, true);
    assert.ok(res.hits.some((h) => h.path.includes("hello-util")));
  });

  it("finds symbol occurrences", async () => {
    const res = await searchWorkspace(dir, "greetName");
    assert.equal(res.ok, true);
    assert.ok(res.hits.some((h) => h.kind === "symbol" && h.line === 1));
  });
});
