#!/usr/bin/env node
/**
 * Release Evidence Manifest template + validator.
 * Evidence Manifest must NOT record its own hash.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function createEvidenceDraft({
  root = path.resolve(__dirname, ".."),
  payloadManifestPath = null,
  profileCheckPath = null,
  testReportPath = null,
  signed = false,
  signatureVerified = false,
  timestampVerified = false,
  artifactVerified = false,
  uploaded = false,
  installedE2E = false,
  testsPassed = false,
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lockPath = path.join(root, "package-lock.json");
  const status = safeGit(["status", "--porcelain"], root);
  const commit = safeGit(["rev-parse", "HEAD"], root);
  const tag = safeGit(["describe", "--tags", "--exact-match"], root);

  let payloadManifestHash = null;
  let payloadFiles = [];
  if (payloadManifestPath && fs.existsSync(payloadManifestPath)) {
    payloadManifestHash = sha256File(payloadManifestPath);
    try {
      const pm = JSON.parse(fs.readFileSync(payloadManifestPath, "utf8"));
      payloadFiles = Array.isArray(pm.files) ? pm.files : [];
    } catch {
      payloadFiles = [];
    }
  }

  let profileHash = null;
  if (profileCheckPath && fs.existsSync(profileCheckPath)) {
    profileHash = sha256File(profileCheckPath);
  }

  let testReportHash = null;
  let testReport = null;
  if (testReportPath && fs.existsSync(testReportPath)) {
    testReportHash = sha256File(testReportPath);
    try {
      testReport = JSON.parse(fs.readFileSync(testReportPath, "utf8"));
    } catch {
      testReport = null;
    }
  }
  const reportPassed =
    testReport?.kind === "release-test-report" &&
    testReport?.result === "pass" &&
    Array.isArray(testReport?.commands) &&
    testReport.commands.length > 0 &&
    testReport.commands.every((command) => command.exitCode === 0 && command.status === "pass");
  const effectiveTestsPassed = testsPassed === true || reportPassed;

  const sourcePassed = status === "" && Boolean(commit) && Boolean(tag);
  const signingPassed = signed === true && signatureVerified === true && timestampVerified === true;
  const artifactPassed =
    artifactVerified === true &&
    signingPassed &&
    Boolean(payloadManifestHash) &&
    Boolean(profileHash) &&
    payloadFiles.length > 0;
  const gates = {
    source: sourcePassed ? "pass" : "blocked/pending",
    artifact: artifactPassed ? "pass" : "blocked/pending",
    installedRuntime: installedE2E === true ? "pass" : "blocked/pending",
    uploadRecheck: uploaded === true ? "pass" : "blocked/pending",
  };

  return {
    schemaVersion: 1,
    kind: "release-evidence-manifest",
    createdAt: new Date().toISOString(),
    selfHashPolicy: "Evidence Manifest must NOT record its own hash.",
    product: {
      name: pkg.productName || pkg.name,
      version: pkg.version,
      appId: pkg.build?.appId || null,
    },
    source: {
      commit: commit || null,
      tag: tag || null,
      cleanTree: status === "",
      dirtySummary: status ? `${status.split(/\r?\n/).length} dirty paths` : null,
    },
    hashes: {
      packageLock: fs.existsSync(lockPath) ? sha256File(lockPath) : null,
      publicBuildProfile: profileHash,
      payloadManifest: payloadManifestHash,
      testReport: testReportHash,
    },
    toolchain: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      electron: pkg.devDependencies?.electron || pkg.dependencies?.electron || null,
      electronBuilder: pkg.devDependencies?.["electron-builder"] || null,
    },
    signing: {
      status: signingPassed ? "signed/verified" : signed ? "claimed/unverified" : "unsigned/internal-preview",
      signatureVerified: signatureVerified === true,
      timestampStatus: timestampVerified === true ? "verified" : "pending",
      cscConfigured: Boolean(process.env.CSC_LINK),
    },
    releaseSet: payloadFiles.map((f) => ({
      path: f.path,
      bytes: f.bytes,
      sha256: f.sha256,
      kind: f.kind,
    })),
    tests: {
      commands: testReport?.commands || [],
      results: effectiveTestsPassed ? "pass" : "pending",
      ranAt: testReport?.endedAt || null,
      environment: testReport?.environment || {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
      },
    },
    gates,
    publicReleaseEligible:
      effectiveTestsPassed &&
      Object.values(gates).every((value) => value === "pass") &&
      signingPassed,
    blockers: [
      ...(sourcePassed ? [] : [status ? "dirty working tree" : "clean RC tag missing"]),
      ...(signingPassed ? [] : [signed ? "signature/timestamp not verified" : "unsigned build"]),
      ...(payloadManifestHash ? [] : ["missing payload manifest"]),
      ...(profileHash ? [] : ["missing Public Build Profile hash"]),
      ...(artifactVerified ? [] : ["Artifact Gate not verified"]),
      ...(effectiveTestsPassed ? [] : ["required tests not recorded as pass"]),
      ...(uploaded ? [] : ["upload recheck not performed"]),
      ...(installedE2E ? [] : ["installed runtime E2E not performed"]),
      ...(!process.env.CSC_LINK && !signingPassed ? ["CSC_LINK not configured"] : []),
    ],
  };
}

function validateEvidence(evidence) {
  const errors = [];
  if (!evidence || evidence.kind !== "release-evidence-manifest") {
    errors.push("kind must be release-evidence-manifest");
  }
  if (evidence?.sha256 || evidence?.selfHash || evidence?.hashes?.self) {
    errors.push("Evidence Manifest must not record its own hash");
  }
  if (!evidence?.product?.version) errors.push("missing product.version");
  if (!evidence?.gates) errors.push("missing gates");
  if (evidence?.publicReleaseEligible === true) {
    if (evidence?.signing?.status !== "signed/verified") {
      errors.push("publicReleaseEligible requires signed/verified status");
    }
    if (evidence?.signing?.signatureVerified !== true) {
      errors.push("publicReleaseEligible requires signature verification");
    }
    if (evidence?.signing?.timestampStatus !== "verified") {
      errors.push("publicReleaseEligible requires verified timestamp");
    }
    if (evidence?.source?.cleanTree !== true) errors.push("publicReleaseEligible requires cleanTree");
    if (!evidence?.source?.commit) errors.push("publicReleaseEligible requires source commit");
    if (!evidence?.source?.tag) errors.push("publicReleaseEligible requires exact RC tag");
    if (!evidence?.hashes?.packageLock) errors.push("publicReleaseEligible requires package-lock hash");
    if (!evidence?.hashes?.publicBuildProfile) {
      errors.push("publicReleaseEligible requires Public Build Profile hash");
    }
    if (!evidence?.hashes?.payloadManifest) errors.push("publicReleaseEligible requires payloadManifest hash");
    if (!evidence?.hashes?.testReport) errors.push("publicReleaseEligible requires release test report hash");
    if (!Array.isArray(evidence?.releaseSet) || evidence.releaseSet.length === 0) {
      errors.push("publicReleaseEligible requires non-empty releaseSet");
    }
    if (evidence?.tests?.results !== "pass") {
      errors.push("publicReleaseEligible requires recorded passing tests");
    }
    for (const gate of ["source", "artifact", "installedRuntime", "uploadRecheck"]) {
      if (evidence?.gates?.[gate] !== "pass") {
        errors.push(`publicReleaseEligible requires ${gate} gate pass`);
      }
    }
    if (Array.isArray(evidence?.blockers) && evidence.blockers.length) {
      errors.push("publicReleaseEligible cannot be true while blockers remain");
    }
  }
  return { ok: errors.length === 0, errors };
}

function parseArgs(argv) {
  const out = {
    mode: "generate",
    output: path.resolve("dist", "release-evidence-manifest.json"),
    payload: null,
    profile: null,
    testsReport: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "validate") out.mode = "validate";
    else if (a === "--output") out.output = path.resolve(argv[++i] || "");
    else if (a === "--payload") out.payload = path.resolve(argv[++i] || "");
    else if (a === "--profile") out.profile = path.resolve(argv[++i] || "");
    else if (a === "--tests-report") out.testsReport = path.resolve(argv[++i] || "");
    else if (a === "--input") out.input = path.resolve(argv[++i] || "");
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.mode === "validate") {
    const input = args.input || args.output;
    const evidence = JSON.parse(fs.readFileSync(input, "utf8"));
    const result = validateEvidence(evidence);
    if (!result.ok) {
      console.error("[validate:release-evidence] FAIL");
      console.error(result.errors.join("\n"));
      process.exit(1);
    }
    console.log("[validate:release-evidence] PASS");
    return;
  }

  const evidence = createEvidenceDraft({
    payloadManifestPath: args.payload,
    profileCheckPath: args.profile,
    testReportPath: args.testsReport,
  });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`[evidence] wrote ${args.output}`);
  console.log(`[evidence] publicReleaseEligible=${evidence.publicReleaseEligible}`);
  console.log(`[evidence] blockers=${evidence.blockers.join("; ") || "(none)"}`);
}

if (require.main === module) {
  main();
}

module.exports = { createEvidenceDraft, validateEvidence };
