#!/usr/bin/env node
/**
 * v1.6 beta soak runner (dev gate — does not build user installer).
 * Usage: node scripts/soak_v1.6_beta.js
 */
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

const checks = [];

function pass(id, detail) {
  checks.push({ id, ok: true, detail });
  console.log(`[PASS] ${id}${detail ? ` — ${detail}` : ""}`);
}

function fail(id, detail) {
  checks.push({ id, ok: false, detail });
  console.error(`[FAIL] ${id}${detail ? ` — ${detail}` : ""}`);
}

function main() {
  console.log(`MOGU AI v1.6 beta soak — package ${pkg.version}`);
  console.log("Scope: automated gates only (no stable installer).\n");

  if (!String(pkg.version).startsWith("1.6.0")) {
    fail("version-prefix", `expected 1.6.0*, got ${pkg.version}`);
  } else {
    pass("version-prefix", pkg.version);
  }

  if (!/beta|alpha/.test(pkg.version)) {
    fail("dev-channel", "stable version without soak tag — refuse silent stable cut");
  } else {
    pass("dev-channel", "pre-release channel");
  }

  const requiredDocs = [
    "docs/ROADMAP_TO_V2.md",
    "docs/OPENCLAW_BRIDGE.md",
    "docs/BETA_SOAK_v1.6.md",
  ];
  for (const rel of requiredDocs) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`doc:${rel}`);
    else fail(`doc:${rel}`, "missing");
  }

  const requiredModules = [
    "src/main/task-store.js",
    "src/main/openclaw/agent-run.js",
    "src/main/openclaw/permissions.js",
    "src/main/data-center.js",
    "src/main/openclaw/lifecycle.js",
    "src/renderer/tasks-panel.js",
    "src/renderer/data-panel.js",
    "src/renderer/openclaw-panel.js",
    "tests/beta-soak.test.js",
  ];
  for (const rel of requiredModules) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`module:${path.basename(rel)}`);
    else fail(`module:${rel}`, "missing");
  }

  console.log("\nRunning npm test (includes beta-soak.test.js)…\n");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const test = spawnSync(npmCmd, ["test"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (test.status === 0) pass("npm-test", "all unit/contract tests");
  else fail("npm-test", `exit ${test.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n—— soak summary: ${checks.length - failed.length}/${checks.length} passed ——`);
  if (failed.length) {
    for (const item of failed) console.error(`  - ${item.id}: ${item.detail || ""}`);
    process.exit(1);
  }

  console.log(`
Manual soak still required before stable v1.6.0:
  1) Real local Gateway connect + one Agent chat round-trip
  2) Kill Gateway mid-run → reconnect → task status recovers
  3) L3 delete command → UI confirm required; cancel denies
  4) Task center shows OpenClaw/PAI/Studio rows; cancel/retry works
  5) Data center export opens pack without secrets.json
  6) npm run preflight:release when cutting stable (not for beta tag)

See docs/BETA_SOAK_v1.6.md
`);
  process.exit(0);
}

main();
