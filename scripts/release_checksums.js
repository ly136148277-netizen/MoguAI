#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const EVIDENCE_FILES = new Set([
  "public-build-profile.json",
  "release-test-report.json",
  "release-evidence-manifest.json",
  "installed-e2e-report.json",
  "internal-test-signing-report.json",
  "signed-e2e-report.json",
  "upload-recheck-report.json",
]);

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function selectReleaseFiles(root, version, outputName = "SHA256SUMS.txt") {
  const normalizedVersion = String(version || "").trim().toLowerCase();
  if (!normalizedVersion) throw new Error("version is required");
  const channel = normalizedVersion.includes("-rc.") ? "rc.yml" : "latest.yml";
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      const lower = name.toLowerCase();
      if (name === outputName || lower.endsWith(".sigstore.json")) return false;
      if (lower.includes(normalizedVersion)) return true;
      if (name === channel || EVIDENCE_FILES.has(name)) return true;
      return false;
    })
    .sort((a, b) => a.localeCompare(b));
}

function generateChecksums({ root, version, output }) {
  const resolvedRoot = path.resolve(root);
  const outputName = path.basename(output);
  const files = selectReleaseFiles(resolvedRoot, version, outputName);
  if (!files.length) throw new Error(`no release files found for ${version}`);
  const lines = files.map((name) => `${sha256File(path.join(resolvedRoot, name))} *${name}`);
  fs.writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
  return { files, lines };
}

function validateChecksums({ root, checksumFile }) {
  const errors = [];
  const lines = fs
    .readFileSync(checksumFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) \*(.+)$/i.exec(line);
    if (!match) {
      errors.push(`invalid checksum line: ${line}`);
      continue;
    }
    const name = match[2];
    if (path.isAbsolute(name) || name.includes("..") || name.includes("/") || name.includes("\\")) {
      errors.push(`unsafe checksum path: ${name}`);
      continue;
    }
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) errors.push(`missing file: ${name}`);
    else if (sha256File(filePath) !== match[1].toLowerCase()) errors.push(`sha256 mismatch: ${name}`);
  }
  return { ok: errors.length === 0, errors, fileCount: lines.length };
}

function parseArgs(argv) {
  const args = { root: path.resolve("dist"), output: null, input: null, version: "", verify: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "verify") args.verify = true;
    else if (argv[i] === "--root") args.root = path.resolve(argv[++i] || "");
    else if (argv[i] === "--output") args.output = path.resolve(argv[++i] || "");
    else if (argv[i] === "--input") args.input = path.resolve(argv[++i] || "");
    else if (argv[i] === "--version") args.version = String(argv[++i] || "");
  }
  args.output ||= path.join(args.root, "SHA256SUMS.txt");
  args.input ||= args.output;
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.verify) {
    const result = validateChecksums({ root: args.root, checksumFile: args.input });
    if (!result.ok) {
      console.error("[release:checksums] FAIL");
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
    console.log(`[release:checksums] PASS (${result.fileCount} files)`);
    return;
  }
  const result = generateChecksums(args);
  console.log(`[release:checksums] wrote ${args.output} (${result.files.length} files)`);
}

if (require.main === module) main();

module.exports = { generateChecksums, validateChecksums, selectReleaseFiles, sha256File };
