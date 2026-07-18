#!/usr/bin/env node
/**
 * Coding bridge acceptance: mogu.coding skill + vendor layout + docs.
 */
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
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
  console.log("MOGU AI acceptance: coding bridge\n");

  const required = [
    "src/main/skills/coding-engines.js",
    "src/main/skills/handlers/coding.js",
    "skills/mogu.coding/SKILL.md",
    "docs/CODING_BRIDGE.md",
    "docs/THIRD_PARTY_CODING.md",
    "tests/coding-skill.test.js",
  ];
  for (const rel of required) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`file:${rel}`);
    else fail(`file:${rel}`, "missing");
  }

  const registry = fs.readFileSync(path.join(ROOT, "src/main/skills/registry.js"), "utf8");
  if (registry.includes("mogu.coding") && registry.includes('source: "coding"')) {
    pass("registry:mogu.coding");
  } else fail("registry:mogu.coding", "not registered");

  const whitelist = fs.readJsonSync(path.join(ROOT, "config/skills-whitelist.json"));
  if ((whitelist.skills || []).some((s) => s.id === "mogu.coding")) pass("whitelist:mogu.coding");
  else fail("whitelist:mogu.coding", "missing");

  const html = fs.readFileSync(path.join(ROOT, "src/renderer/index.html"), "utf8");
  if (html.includes("setting-coding-engine") && html.includes('value="coding"')) {
    pass("ui:coding-settings-tasks");
  } else fail("ui:coding-settings-tasks", "missing controls");

  const vendorCodex = "D:\\Project\\vendor\\openai-codex";
  const vendorTrae = "D:\\Project\\vendor\\trae-agent";
  if (fs.pathExistsSync(vendorCodex)) pass("vendor:openai-codex");
  else fail("vendor:openai-codex", "clone to D:\\Project\\vendor\\openai-codex");
  if (fs.pathExistsSync(vendorTrae)) pass("vendor:trae-agent");
  else fail("vendor:trae-agent", "clone to D:\\Project\\vendor\\trae-agent");

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const test = spawnSync(npmCmd, ["test", "--", "tests/coding-skill.test.js"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (test.status === 0) pass("unit:coding-skill");
  else fail("unit:coding-skill", `exit ${test.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n—— coding acceptance: ${checks.length - failed.length}/${checks.length} passed ——`);
  if (failed.length) {
    for (const item of failed) console.error(`  - ${item.id}: ${item.detail || ""}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
