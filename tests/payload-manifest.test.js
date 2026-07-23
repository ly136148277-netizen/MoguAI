const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { generatePayloadManifest, classify, SECRET_NAME } = require("../scripts/generate_payload_manifest");

test("classify recognizes installer/portable/asar kinds", () => {
  assert.equal(classify("MOGU-AI-Setup-2.0.0.exe"), "nsis-installer");
  assert.equal(classify("MOGU AI 2.0.0.exe"), "portable-exe");
  assert.equal(classify("MOGU-AI-Setup-2.0.0.exe.blockmap"), "blockmap");
  assert.equal(classify("latest.yml"), "update-manifest");
  assert.equal(classify("rc.yml"), "update-manifest");
  assert.equal(classify("win-unpacked/resources/app.asar"), "app-asar");
});

test("generatePayloadManifest hashes files and skips secret-looking names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-payload-"));
  try {
    fs.writeFileSync(path.join(dir, "a.txt"), "hello");
    fs.writeFileSync(path.join(dir, "secrets.json"), "nope");
    fs.writeFileSync(path.join(dir, "github.token"), "nope");
    const manifest = generatePayloadManifest({ inputDir: dir, signed: false });
    assert.equal(manifest.signingStatus, "unsigned/internal-preview");
    assert.equal(manifest.publicReleaseEligible, false);
    assert.equal(manifest.fileCount, 1);
    assert.equal(manifest.files[0].path, "a.txt");
    assert.equal(manifest.files[0].sha256.length, 64);
    assert.equal(manifest.inputRoot, ".");
    assert.equal("inputDir" in manifest, false);
    assert.ok(!("sha256Self" in manifest));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("generatePayloadManifest excludes existing manifests and explicit output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-payload-self-"));
  try {
    const output = path.join(dir, "payload-manifest-2.0.0.json");
    fs.writeFileSync(path.join(dir, "MOGU AI 2.0.0.exe"), "payload");
    fs.writeFileSync(output, "old manifest");
    fs.writeFileSync(path.join(dir, "release-evidence-manifest.json"), "old evidence");
    const manifest = generatePayloadManifest({
      inputDir: dir,
      outputPath: output,
      signed: false,
      version: "2.0.0",
    });
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      ["MOGU AI 2.0.0.exe"]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("SECRET_NAME catches common credential filenames", () => {
  assert.ok(SECRET_NAME.test("secrets.json"));
  assert.ok(SECRET_NAME.test("github.token"));
  assert.ok(SECRET_NAME.test(".env"));
});
