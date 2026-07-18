#!/usr/bin/env node
/**
 * v1.6 soak runner.
 * - Pre-release (alpha/beta): automated gates only.
 * - Stable 1.6.0: same tests + CHANGELOG / version consistency checks.
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
  const version = String(pkg.version || "");
  const isPrerelease = /-(alpha|beta)/.test(version);
  const isStable = version === "1.6.0";

  console.log(`MOGU AI v1.6 soak — package ${version}`);
  console.log(isStable ? "Scope: stable cut gates.\n" : "Scope: automated gates (pre-release).\n");

  if (!version.startsWith("1.6.0")) {
    fail("version-prefix", `expected 1.6.0*, got ${version}`);
  } else {
    pass("version-prefix", version);
  }

  if (isPrerelease) {
    pass("channel", "pre-release");
  } else if (isStable) {
    pass("channel", "stable 1.6.0");
  } else {
    fail("channel", `unexpected version shape: ${version}`);
  }

  const requiredDocs = [
    "docs/ROADMAP_TO_V2.md",
    "docs/OPENCLAW_BRIDGE.md",
    "docs/BETA_SOAK_v1.6.md",
    "docs/RELEASE.md",
  ];
  for (const rel of requiredDocs) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`doc:${rel}`);
    else fail(`doc:${rel}`, "missing");
  }

  if (isStable) {
    const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
    if (/## \[1\.6\.0\]/.test(changelog)) pass("changelog-1.6.0");
    else fail("changelog-1.6.0", "CHANGELOG.md missing ## [1.6.0] section");

    const html = fs.readFileSync(path.join(ROOT, "src/renderer/index.html"), "utf8");
    if (/data-nav="chat"[^>]*>对话</.test(html) && /环境与数据/.test(html) && !/data-nav="compose"/.test(html)) {
      pass("ia-6.5", "nav: 对话/创作/环境与数据; compose not top-level");
    } else {
      fail("ia-6.5", "index.html nav does not match ROADMAP §6.5");
    }
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

  if (isStable) {
    console.log(`
Stable soak green. Next:
  1) npm run preflight:release
  2) tag v1.6.0 (keep v1.5.5 as prior customer baseline until announce)
  3) publish installer only when ready for customer switch

See docs/BETA_SOAK_v1.6.md + docs/RELEASE.md
`);
  } else {
    console.log(`
Manual soak still required before stable v1.6.0:
  1) Real local Gateway connect + one Agent chat round-trip
  2) Kill Gateway mid-run → reconnect → task status recovers
  3) L3 delete command → UI confirm required; cancel denies
  4) Task center shows OpenClaw/PAI/Studio rows; cancel/retry works
  5) Data center export opens pack without secrets.json
  6) npm run preflight:release when cutting stable

See docs/BETA_SOAK_v1.6.md
`);
  }
  process.exit(0);
}

main();
