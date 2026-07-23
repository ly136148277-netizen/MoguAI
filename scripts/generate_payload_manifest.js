#!/usr/bin/env node
/**
 * Generate a stable SHA-256 Payload Manifest for a release dist directory.
 * Does not self-hash the manifest. Never writes secrets/env values.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SECRET_NAME = /(token|secret|password|passwd|api[-_]?key|\.env$|credentials)/i;

function parseArgs(argv) {
  const out = {
    input: path.resolve("dist"),
    output: path.resolve("dist", "payload-manifest.json"),
    signed: false,
    version: "",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--input") out.input = path.resolve(argv[++i] || "");
    else if (a === "--output") out.output = path.resolve(argv[++i] || "");
    else if (a === "--signed") out.signed = true;
    else if (a === "--version") out.version = String(argv[++i] || "").trim();
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function walk(dir, root, files, excludedPaths = new Set()) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (excludedPaths.has(path.resolve(abs))) continue;
    if (/^(payload-manifest(?:-[^/]+)?|release-evidence-manifest)\.json$/i.test(ent.name)) continue;
    if (SECRET_NAME.test(ent.name) || SECRET_NAME.test(rel)) continue;
    if (ent.isDirectory()) {
      // Skip huge non-payload trees if present
      if (ent.name === "node_modules" && !rel.includes("app.asar.unpacked")) continue;
      walk(abs, root, files, excludedPaths);
    } else if (ent.isFile()) {
      files.push({ abs, rel });
    }
  }
}

function classify(rel) {
  const name = rel.toLowerCase();
  if (name.endsWith(".blockmap")) return "blockmap";
  if (/setup.*\.exe$/.test(name) || /mogu-ai-setup/i.test(name)) return "nsis-installer";
  if (/portable|\.exe$/.test(name) && !/setup/i.test(name) && !name.includes("/")) return "portable-exe";
  if (/(^|\/)(latest|alpha|beta|rc)\.ya?ml$/.test(name)) return "update-manifest";
  if (name.endsWith("app.asar")) return "app-asar";
  if (name.includes("app.asar.unpacked")) return "asar-unpacked";
  if (name.includes("resources/")) return "resources";
  return "other";
}

function generatePayloadManifest({ inputDir, outputPath = null, signed = false, version = "" }) {
  const root = path.resolve(inputDir);
  if (!fs.existsSync(root)) {
    throw new Error(`input directory missing: ${root}`);
  }
  const collected = [];
  const excludedPaths = new Set();
  if (outputPath) excludedPaths.add(path.resolve(outputPath));
  walk(root, root, collected, excludedPaths);
  collected.sort((a, b) => a.rel.localeCompare(b.rel));

  const ver = String(version || "").trim();
  const filtered = ver
    ? collected.filter(({ rel }) => {
        const name = rel.toLowerCase();
        // Keep current release artifacts + unpacked tree needed for Artifact Gate
        if (rel.startsWith("win-unpacked/") || rel === "win-unpacked") return true;
        if (name.includes(ver.toLowerCase())) return true;
        if (/^(latest|alpha|beta|rc)\.ya?ml$/.test(name)) return true;
        if (name === "public-build-profile.json") return true;
        return false;
      })
    : collected;

  const files = filtered.map(({ abs, rel }) => {
    const st = fs.statSync(abs);
    return {
      path: rel,
      bytes: st.size,
      sha256: sha256File(abs),
      kind: classify(rel),
    };
  });

  return {
    schemaVersion: 1,
    kind: "payload-manifest",
    createdAt: new Date().toISOString(),
    inputRoot: ".",
    versionFilter: ver || null,
    signingStatus: signed ? "signed" : "unsigned/internal-preview",
    publicReleaseEligible: false,
    note:
      signed === true
        ? "Signed bit set by operator; Artifact Gate still required."
        : "Unsigned/internal-preview only. Must not be labeled Public Release.",
    fileCount: files.length,
    files,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/generate_payload_manifest.js --input dist --output dist/payload-manifest.json [--version x.y.z] [--signed]"
    );
    process.exit(0);
  }
  const manifest = generatePayloadManifest({
    inputDir: args.input,
    outputPath: args.output,
    signed: args.signed,
    version: args.version,
  });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[manifest:payload] wrote ${args.output} (${manifest.fileCount} files, ${manifest.signingStatus})`);
}

if (require.main === module) {
  main();
}

module.exports = { generatePayloadManifest, parseArgs, classify, SECRET_NAME };
