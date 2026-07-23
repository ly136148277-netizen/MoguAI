#!/usr/bin/env node
/**
 * MOGU AI coding acceptance: owned runtime surface + skill wiring.
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
  console.log("MOGU AI acceptance: coding runtime\n");

  const required = [
    "src/main/moguai/coding/runtime.js",
    "src/main/moguai/coding/index.js",
    "src/main/moguai/factory/workspace-fs.js",
    "src/main/moguai/factory/debug-session.js",
    "src/main/moguai/coding/runtime-update.js",
    "config/moguai-runtime-compat.json",
    "src/renderer/factory-panel.js",
    "src/shared/moguai-coding.js",
    "src/main/skills/handlers/coding.js",
    "skills/mogu.coding/SKILL.md",
    "docs/MOGUAI_CODING.md",
    "tests/coding-skill.test.js",
    "tests/factory-workspace.test.js",
    "tests/coding-runtime-update.test.js",
  ];
  for (const rel of required) {
    if (fs.pathExistsSync(path.join(ROOT, rel))) pass(`file:${rel}`);
    else fail(`file:${rel}`, "missing");
  }

  const runtime = fs.readFileSync(path.join(ROOT, "src/main/moguai/coding/runtime.js"), "utf8");
  const brands = fs.readFileSync(path.join(ROOT, "src/shared/moguai-coding.js"), "utf8");
  if (
    brands.includes("moguai_a") &&
    brands.includes("moguai-coding-a") &&
    brands.includes("moguai-runtime-a") &&
    runtime.includes("ensureRuntimeLayout") &&
    runtime.includes("moguai-runtimes")
  ) {
    pass("runtime:moguai-owned");
  } else fail("runtime:moguai-owned", "missing moguai ownership markers");

  const registry = fs.readFileSync(path.join(ROOT, "src/main/skills/registry.js"), "utf8");
  if (registry.includes("mogu.coding") && registry.includes("moguai_a")) pass("registry:mogu.coding");
  else fail("registry:mogu.coding", "not registered");

  const whitelist = fs.readJsonSync(path.join(ROOT, "config/skills-whitelist.json"));
  if ((whitelist.skills || []).some((s) => s.id === "mogu.coding")) pass("whitelist:mogu.coding");
  else fail("whitelist:mogu.coding", "missing");

  const html = fs.readFileSync(path.join(ROOT, "src/renderer/index.html"), "utf8");
  if (html.includes("MOGU AI 编程") && html.includes('value="moguai_a"')) pass("ui:moguai-coding");
  else fail("ui:moguai-coding", "missing controls");
  if (html.includes("coding-runtime-check-btn") && html.includes("coding-runtime-upgrade-btn")) {
    pass("ui:coding-runtime-upgrade");
  } else fail("ui:coding-runtime-upgrade", "missing check/upgrade controls");
  if (html.includes("agent-coding-install-btn") && html.includes("agent-coding-redispatch-btn")) {
    pass("ui:coding-loop-cta");
  } else fail("ui:coding-loop-cta", "missing install/redispatch on task card");
  if (html.includes("factory-install-engine-btn")) pass("ui:factory-install-cta");
  else fail("ui:factory-install-cta", "missing factory install button");

  const compat = fs.readJsonSync(path.join(ROOT, "config/moguai-runtime-compat.json"));
  if (compat?.engines?.moguai_a?.adaptedVersion && compat?.engines?.moguai_b?.adaptedVersion) {
    pass("compat:adapted-versions");
  } else fail("compat:adapted-versions", "missing engine adaptedVersion");

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const test = spawnSync(npmCmd, ["test", "--", "tests/coding-skill.test.js"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (test.status === 0) pass("unit:coding-skill");
  else fail("unit:coding-skill", `exit ${test.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n—— moguai coding acceptance: ${checks.length - failed.length}/${checks.length} passed ——`);
  if (failed.length) {
    for (const item of failed) console.error(`  - ${item.id}: ${item.detail || ""}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
