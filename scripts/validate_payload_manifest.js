#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validatePayloadManifest(manifest, { root }) {
  const errors = [];
  if (manifest?.kind !== "payload-manifest") errors.push("kind must be payload-manifest");
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    errors.push("files must be a non-empty array");
    return { ok: false, errors };
  }
  if (manifest.fileCount !== manifest.files.length) errors.push("fileCount does not match files.length");

  const resolvedRoot = path.resolve(root);
  const kinds = new Set();
  const seen = new Set();
  for (const file of manifest.files) {
    const rel = String(file?.path || "").replace(/\\/g, "/");
    if (!rel || path.isAbsolute(rel) || rel.split("/").includes("..")) {
      errors.push(`unsafe payload path: ${rel || "(empty)"}`);
      continue;
    }
    if (seen.has(rel)) errors.push(`duplicate payload path: ${rel}`);
    seen.add(rel);
    if (/^(payload-manifest(?:-[^/]+)?|release-evidence-manifest)\.json$/i.test(rel)) {
      errors.push(`manifest must not hash itself/evidence: ${rel}`);
    }
    const abs = path.resolve(resolvedRoot, rel);
    if (abs !== resolvedRoot && !abs.startsWith(`${resolvedRoot}${path.sep}`)) {
      errors.push(`payload path escapes root: ${rel}`);
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      errors.push(`missing payload file: ${rel}`);
      continue;
    }
    const actualBytes = fs.statSync(abs).size;
    const actualHash = sha256File(abs);
    if (actualBytes !== file.bytes) errors.push(`size mismatch: ${rel}`);
    if (actualHash !== file.sha256) errors.push(`sha256 mismatch: ${rel}`);
    kinds.add(file.kind);
  }

  for (const kind of ["nsis-installer", "portable-exe", "blockmap", "update-manifest", "app-asar"]) {
    if (!kinds.has(kind)) errors.push(`missing required payload kind: ${kind}`);
  }
  if (!seen.has("public-build-profile.json")) errors.push("missing public-build-profile.json");
  return { ok: errors.length === 0, errors };
}

function main() {
  const manifestPath = path.resolve(process.argv[2] || path.join("dist", "payload-manifest.json"));
  const root = process.argv[3] ? path.resolve(process.argv[3]) : path.dirname(manifestPath);
  if (!fs.existsSync(manifestPath)) {
    console.error(`[manifest:validate] missing ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const result = validatePayloadManifest(manifest, { root });
  if (!result.ok) {
    console.error("[manifest:validate] FAIL");
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(`[manifest:validate] PASS (${manifest.files.length} files)`);
}

if (require.main === module) main();

module.exports = { validatePayloadManifest, sha256File };
