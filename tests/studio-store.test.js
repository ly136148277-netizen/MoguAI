const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { StudioStore, DEFAULT_PIPELINE } = require("../src/main/studio-store");

test("StudioStore persists pipeline fields", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-store-"));
  const store = new StudioStore(path.join(dir, "studio-pipeline.json"));
  const saved = await store.update({ character: "红裙女性", t2iWorkflow: "zimage_gguf", tool: "jianying" });
  assert.equal(saved.character, "红裙女性");
  assert.equal(saved.t2iWorkflow, "zimage_gguf");
  assert.equal(saved.mode, DEFAULT_PIPELINE.mode);

  const store2 = new StudioStore(path.join(dir, "studio-pipeline.json"));
  const loaded = await store2.load();
  assert.equal(loaded.character, "红裙女性");
  assert.equal(loaded.tool, "jianying");
});

test("StudioStore adds and removes custom tools", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-tools-"));
  const fakeExe = path.join(dir, "MyEditor.exe");
  await fs.writeFile(fakeExe, "");
  const store = new StudioStore(path.join(dir, "studio-pipeline.json"));

  const added = await store.addCustomTool({ name: "我的剪辑", path: fakeExe });
  assert.equal(added.ok, true);
  assert.equal(added.tool.name, "我的剪辑");
  assert.equal(added.pipeline.customTools.length, 1);
  assert.equal(added.pipeline.tool, `custom:${added.tool.id}`);

  const again = await store.addCustomTool({ name: "重复", path: fakeExe });
  assert.equal(again.already, true);
  assert.equal(again.pipeline.customTools.length, 1);

  const removed = await store.removeCustomTool(added.tool.id);
  assert.equal(removed.pipeline.customTools.length, 0);
  assert.equal(removed.pipeline.tool, "shotcut");
});
