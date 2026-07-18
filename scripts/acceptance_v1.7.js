#!/usr/bin/env node
/**
 * v1.7 acceptance: Skills four-piece contract + version/docs gates.
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
  console.log(`MOGU AI acceptance v1.7 — ${pkg.version}\n`);

  if (!String(pkg.version).startsWith("1.7.0")) {
    fail("version", `expected 1.7.0*, got ${pkg.version}`);
  } else {
    pass("version", pkg.version);
  }

  const docs = ["docs/SKILLS_v1.7.md", "docs/ROADMAP_TO_V2.md", "docs/OPENCLAW_BRIDGE.md"];
  for (const rel of docs) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`doc:${rel}`);
    else fail(`doc:${rel}`, "missing");
  }

  const skillIds = ["mogu.comfy", "mogu.studio", "mogu.ollama", "mogu.pc", "mogu.media"];
  for (const id of skillIds) {
    const md = path.join(ROOT, "skills", id, "SKILL.md");
    const handler = path.join(ROOT, "src/main/skills/handlers", `${id.split(".")[1]}.js`);
    if (fs.pathExistsSync(md) && fs.pathExistsSync(handler)) pass(`fourpiece:${id}`);
    else fail(`fourpiece:${id}`, "missing SKILL.md or handler");
  }

  const modules = [
    "src/main/skills/runtime.js",
    "src/main/skills/registry.js",
    "src/renderer/skills-panel.js",
    "tests/skills-runtime.test.js",
  ];
  for (const rel of modules) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`module:${path.basename(rel)}`);
    else fail(`module:${rel}`, "missing");
  }

  const html = fs.readFileSync(path.join(ROOT, "src/renderer/index.html"), "utf8");
  if (html.includes('data-hub-nav="skills"') && html.includes('id="view-skills"')) {
    pass("ui:skills-page");
  } else {
    fail("ui:skills-page", "missing skills view/tab");
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
