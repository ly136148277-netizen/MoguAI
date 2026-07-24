#!/usr/bin/env node
/**
 * Mechanical 2.2 Capability Intake audit.
 * Confirms no new runtime npm dependencies beyond the 2.1 pin set,
 * and that LSP servers remain external/config-only with license fields.
 */
const fs = require("node:fs");
const path = require("node:path");
const { EXPECTED: V21_EXPECTED } = require("./audit_v21_dependencies");

const ROOT = path.join(__dirname, "..");

function audit(root = ROOT) {
  const failures = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const deps = pkg.dependencies || {};

  if (deps["node-pty"] !== V21_EXPECTED["node-pty"].version) {
    failures.push("node-pty pin drifted from 2.1 audited version");
  }
  const pty = lock.packages?.["node_modules/node-pty"];
  if (!pty || pty.integrity !== V21_EXPECTED["node-pty"].integrity) {
    failures.push("node-pty integrity drifted from 2.1 audit");
  }

  // 2.2 must not add new production npm dependencies beyond the 2.1 set.
  const allowed = new Set(["axios", "electron-updater", "fs-extra", "monaco-editor", "node-pty", "ws"]);
  for (const name of Object.keys(deps)) {
    if (!allowed.has(name)) failures.push(`unexpected 2.2 runtime dependency: ${name}`);
  }

  const settings = fs.readFileSync(path.join(root, "src/main/settings.js"), "utf8");
  for (const needle of [
    "licenseEvidenceId",
    "v22NeuralLayer",
    "sanitizeV22Config",
  ]) {
    if (!settings.includes(needle)) failures.push(`settings missing ${needle}`);
  }

  const planner = fs.readFileSync(path.join(root, "src/main/moguai/neural/planner.js"), "utf8");
  if (!/licenseEvidenceId/.test(planner)) {
    failures.push("planner does not require LSP licenseEvidenceId");
  }
  if (!/BLOCKED|lsp_fallback|fallback/.test(planner)) {
    failures.push("planner missing LSP fail-closed / fallback path");
  }

  const neuralFiles = [
    "task-classifier.js",
    "model-router.js",
    "planner.js",
    "context-budget.js",
    "tool-chain.js",
    "decision-trace.js",
    "closed-loop.js",
  ];
  for (const name of neuralFiles) {
    const abs = path.join(root, "src/main/moguai/neural", name);
    if (!fs.existsSync(abs)) failures.push(`missing neural module ${name}`);
  }

  const licenseDoc = fs.readFileSync(path.join(root, "docs/CAPABILITY_LICENSE_EVIDENCE.md"), "utf8");
  if (!/2\.2/.test(licenseDoc) || !/未新增运行时 npm 依赖/.test(licenseDoc)) {
    failures.push("license evidence missing 2.2 no-new-deps closure");
  }

  return {
    ok: failures.length === 0,
    failures,
    newRuntimeDependencies: Object.keys(deps).filter((name) => !allowed.has(name)),
    auditedRuntimeDependencies: Object.keys(deps),
  };
}

if (require.main === module) {
  const result = audit();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = { audit };
