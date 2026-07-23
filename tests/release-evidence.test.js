const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createEvidenceDraft, validateEvidence } = require("../scripts/generate_release_evidence");

test("evidence draft is unsigned/internal-preview and lists blockers", () => {
  const evidence = createEvidenceDraft({ signed: false, uploaded: false, installedE2E: false });
  assert.equal(evidence.kind, "release-evidence-manifest");
  assert.equal(evidence.signing.status, "unsigned/internal-preview");
  assert.equal(evidence.publicReleaseEligible, false);
  assert.ok(evidence.blockers.includes("unsigned build"));
  assert.ok(!evidence.sha256);
  assert.ok(!evidence.hashes.self);
});

test("validateEvidence rejects self-hash and false public eligibility", () => {
  const bad = createEvidenceDraft({});
  bad.hashes.self = "abc";
  bad.publicReleaseEligible = true;
  const result = validateEvidence(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /own hash/i.test(e)));
});

test("validateEvidence rejects public eligibility while tests and gates are pending", () => {
  const bad = createEvidenceDraft({});
  bad.publicReleaseEligible = true;
  bad.signing = {
    status: "signed/verified",
    signatureVerified: true,
    timestampStatus: "verified",
  };
  bad.source = { cleanTree: true, commit: "abc", tag: "v2.0.0-rc.1" };
  bad.hashes = {
    packageLock: "a",
    publicBuildProfile: "b",
    payloadManifest: "c",
  };
  bad.releaseSet = [{ path: "installer.exe", bytes: 1, sha256: "d", kind: "nsis-installer" }];
  bad.blockers = [];
  const result = validateEvidence(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /passing tests/i.test(e)));
  assert.ok(result.errors.some((e) => /artifact gate pass/i.test(e)));
});

test("validateEvidence accepts a blocked draft", () => {
  const evidence = createEvidenceDraft({});
  const result = validateEvidence(evidence);
  assert.equal(result.ok, true);
});

test("evidence binds a passing machine-readable test report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-test-report-"));
  try {
    const reportPath = path.join(dir, "release-test-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: "release-test-report",
        result: "pass",
        endedAt: "2026-07-23T00:00:00.000Z",
        environment: { platform: "win32", arch: "x64", node: process.version },
        commands: [{ id: "unit", command: "npm test", exitCode: 0, status: "pass" }],
      })
    );
    const evidence = createEvidenceDraft({ testReportPath: reportPath });
    assert.equal(evidence.tests.results, "pass");
    assert.equal(evidence.tests.commands.length, 1);
    assert.equal(evidence.hashes.testReport.length, 64);
    assert.ok(!evidence.blockers.includes("required tests not recorded as pass"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
