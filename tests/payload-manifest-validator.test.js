const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validatePayloadManifest, sha256File } = require("../scripts/validate_payload_manifest");

function makeManifest(root) {
  const entries = [
    ["setup.exe", "nsis-installer"],
    ["portable.exe", "portable-exe"],
    ["setup.exe.blockmap", "blockmap"],
    ["rc.yml", "update-manifest"],
    ["win-unpacked/resources/app.asar", "app-asar"],
    ["public-build-profile.json", "other"],
  ];
  const files = entries.map(([rel, kind], index) => {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `payload-${index}`);
    return { path: rel, bytes: fs.statSync(abs).size, sha256: sha256File(abs), kind };
  });
  return { kind: "payload-manifest", fileCount: files.length, files };
}

test("validatePayloadManifest verifies required files and hashes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-manifest-validate-"));
  try {
    const manifest = makeManifest(root);
    assert.deepEqual(validatePayloadManifest(manifest, { root }), { ok: true, errors: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("validatePayloadManifest rejects tampering and traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-manifest-tamper-"));
  try {
    const manifest = makeManifest(root);
    fs.appendFileSync(path.join(root, "setup.exe"), "tampered");
    manifest.files.push({ path: "../escape.exe", bytes: 1, sha256: "x", kind: "other" });
    manifest.fileCount = manifest.files.length;
    const result = validatePayloadManifest(manifest, { root });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /sha256 mismatch: setup\.exe/.test(error)));
    assert.ok(result.errors.some((error) => /unsafe payload path/.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
