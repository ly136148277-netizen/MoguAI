const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  isPathInside,
  buildMediaAllowRoots,
  assertAllowedMediaPath,
} = require("../src/main/media-path");

test("isPathInside accepts nested files and rejects escape", () => {
  const root = "E:\\projects\\PAI\\output";
  assert.equal(isPathInside(root, "E:\\projects\\PAI\\output\\a.png"), true);
  assert.equal(isPathInside(root, "E:\\projects\\PAI\\secret.txt"), false);
  assert.equal(isPathInside(root, "E:\\projects\\PAI\\output\\..\\secret.txt"), false);
});

test("buildMediaAllowRoots includes PAI/ComfyUI/storage roots", () => {
  const roots = buildMediaAllowRoots({
    paiRoot: "E:\\projects\\PAI",
    comfyUiPath: "F:\\ComfyUI",
    modelStoragePath: "E:\\models",
    userDataPath: "C:\\Users\\x\\AppData\\Roaming\\ai-model-manager",
  });
  assert.ok(roots.some((r) => /PAI$/i.test(r) || /PAI\\output$/i.test(r) || /PAI\/output$/i.test(r)));
  assert.ok(roots.some((r) => /ComfyUI/i.test(r)));
});

test("assertAllowedMediaPath rejects outside allowlist", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-media-"));
  const allowedDir = path.join(tmp, "allowed");
  const deniedDir = path.join(tmp, "denied");
  await fs.ensureDir(allowedDir);
  await fs.ensureDir(deniedDir);
  const allowedFile = path.join(allowedDir, "ok.png");
  const deniedFile = path.join(deniedDir, "nope.png");
  await fs.writeFile(allowedFile, "x");
  await fs.writeFile(deniedFile, "x");

  const ok = await assertAllowedMediaPath(allowedFile, { allowRoots: [allowedDir] });
  assert.equal(ok.ok, true);

  const bad = await assertAllowedMediaPath(deniedFile, { allowRoots: [allowedDir] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不在允许/);

  const badExt = await assertAllowedMediaPath(path.join(allowedDir, "x.exe"), {
    allowRoots: [allowedDir],
  });
  assert.equal(badExt.ok, false);
});
