const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { generateChecksums, validateChecksums, selectReleaseFiles } = require("../scripts/release_checksums");

test("release checksums select only current version and evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-checksums-"));
  try {
    for (const name of [
      "MOGU-AI-Setup-2.0.1-rc.1.exe",
      "MOGU AI 2.0.1-rc.1.exe",
      "rc.yml",
      "release-evidence-manifest.json",
      "MOGU-AI-Setup-2.0.0.exe",
      "builder-debug.yml",
    ]) {
      fs.writeFileSync(path.join(root, name), name);
    }
    assert.deepEqual(selectReleaseFiles(root, "2.0.1-rc.1"), [
      "MOGU AI 2.0.1-rc.1.exe",
      "MOGU-AI-Setup-2.0.1-rc.1.exe",
      "rc.yml",
      "release-evidence-manifest.json",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release checksums detect artifact tampering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-checksums-verify-"));
  try {
    const artifact = path.join(root, "MOGU-AI-Setup-2.0.1-rc.1.exe");
    const output = path.join(root, "SHA256SUMS.txt");
    fs.writeFileSync(artifact, "original");
    generateChecksums({ root, version: "2.0.1-rc.1", output });
    assert.equal(validateChecksums({ root, checksumFile: output }).ok, true);
    fs.appendFileSync(artifact, "tampered");
    const result = validateChecksums({ root, checksumFile: output });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /sha256 mismatch/.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
