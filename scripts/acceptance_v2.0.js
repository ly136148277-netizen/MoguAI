#!/usr/bin/env node
/**
 * v2.0 acceptance: chat home, OpenClaw default, permissions/backup/whitelist gates.
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
  console.log(`MOGU AI acceptance v2.0 — ${pkg.version}\n`);

  if (!String(pkg.version).startsWith("2.0.0")) {
    fail("version", `expected 2.0.0*, got ${pkg.version}`);
  } else {
    pass("version", pkg.version);
  }

  const docs = [
    "docs/ROADMAP_TO_V2.md",
    "docs/RELEASE.md",
    "CHANGELOG.md",
    "config/skills-whitelist.json",
  ];
  for (const rel of docs) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`doc:${rel}`);
    else fail(`doc:${rel}`, "missing");
  }

  const modules = [
    "src/main/permission-grants.js",
    "src/renderer/permissions-panel.js",
    "src/renderer/channels-panel.js",
    "src/main/data-center.js",
    "tests/v2-control-center.test.js",
  ];
  for (const rel of modules) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`module:${path.basename(rel)}`);
    else fail(`module:${rel}`, "missing");
  }

  const settingsSrc = fs.readFileSync(path.join(ROOT, "src/main/settings.js"), "utf8");
  if (settingsSrc.includes('agentRuntimeMode: "openclaw"') && settingsSrc.includes("openclawEnabled: true")) {
    pass("defaults:openclaw");
  } else {
    fail("defaults:openclaw", "settings defaults not OpenClaw");
  }

  const html = fs.readFileSync(path.join(ROOT, "src/renderer/index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(ROOT, "src/renderer/app.js"), "utf8");
  if (appJs.includes('currentPage = "chat"') && html.includes('id="view-chat"') && html.includes("is-active")) {
    pass("ui:chat-home");
  } else {
    fail("ui:chat-home", "chat not default home");
  }
  if (html.includes('id="view-permissions"') && html.includes('id="view-channels"') && html.includes("agent-oc-banner")) {
    pass("ui:permissions-channels-banner");
  } else {
    fail("ui:permissions-channels-banner", "missing views/banner");
  }
  if (html.includes('id="data-backup-btn"') && html.includes('id="skills-whitelist-btn"')) {
    pass("ui:backup-whitelist");
  } else {
    fail("ui:backup-whitelist", "missing backup or whitelist controls");
  }

  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  if (changelog.includes("[2.0.0]")) pass("changelog:2.0.0");
  else fail("changelog:2.0.0", "missing [2.0.0] section");

  const roadmap = fs.readFileSync(path.join(ROOT, "docs/ROADMAP_TO_V2.md"), "utf8");
  if (roadmap.includes("- [x] **对话**") && roadmap.includes("v2.0.0` 已切割")) {
    pass("roadmap:v2-marker");
  } else {
    fail("roadmap:v2-marker", "ROADMAP §8 checkboxes / cut marker missing");
  }

  console.log("\nRunning npm test…\n");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const test = spawnSync(npmCmd, ["test"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (test.status === 0) pass("npm-test");
  else fail("npm-test", `exit ${test.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n—— acceptance: ${checks.length - failed.length}/${checks.length} passed ——`);
  if (failed.length) {
    for (const item of failed) console.error(`  - ${item.id}: ${item.detail || ""}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
