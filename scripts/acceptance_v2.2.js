#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DEFAULT_SETTINGS } = require("../src/main/settings");

const ROOT = path.join(__dirname, "..");
const V21_HOLDOUT = "benchmarks/swe-bench/holdout/manifest.json";
const V21_HOLDOUT_SHA256 = "f50ddda9f230861980ad37e844b64c72341b88f8604bad6b1b9af3adbfa9225d";
const checks = [];

function check(id, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ id, ok, detail });
  const line = `[${ok ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`;
  (ok ? console.log : console.error)(line);
}

function absolute(relative) {
  return path.join(ROOT, relative);
}

function hasFile(relative) {
  return fs.existsSync(absolute(relative));
}

function read(relative) {
  return fs.readFileSync(absolute(relative), "utf8");
}

function sha256(relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(absolute(relative))).digest("hex");
}

function verifyDocs() {
  const docs = ["docs/V2.2_EXECUTION_PLAN.md", "docs/V2.2_AB_PROTOCOL.md"];
  for (const relative of docs) check(`file:${relative}`, hasFile(relative));
  if (!docs.every(hasFile)) return;

  const combined = docs.map(read).join("\n");
  for (const term of [
    "task classification",
    "model routing",
    "planner",
    "context budget",
    "tool-chain",
    "decision trace",
    "bounded closed loop",
  ]) {
    check(`docs:single-task:${term}`, combined.toLowerCase().includes(term));
  }
  for (const boundary of ["full DAG", "cross-skill self-healing", "global scheduling", "migration"]) {
    check(`docs:2.3-boundary:${boundary}`, combined.toLowerCase().includes(boundary.toLowerCase()));
  }
}

function verifySettings() {
  for (const flag of [
    "v22NeuralLayer",
    "v22ModelRouting",
    "v22Planner",
    "v22ContextBudget",
    "v22ToolChain",
    "v22DecisionTrace",
    "v22ClosedLoop",
  ]) {
    check(`default-off:${flag}`, DEFAULT_SETTINGS[flag] === false);
  }
  check("config:model-profiles", Array.isArray(DEFAULT_SETTINGS.v22Config?.modelProfiles));
  check("config:task-policies", Array.isArray(DEFAULT_SETTINGS.v22Config?.taskPolicies));
  check("config:budget", Boolean(DEFAULT_SETTINGS.v22Config?.budget));
  check("config:no-model-fallback", DEFAULT_SETTINGS.v22Config?.allowModelFallback === false);
}

function verifyFutureModules() {
  for (const relative of [
    "src/main/moguai/neural/task-classifier.js",
    "src/main/moguai/neural/model-router.js",
    "src/main/moguai/neural/planner.js",
    "src/main/moguai/neural/context-budget.js",
    "src/main/moguai/neural/tool-chain.js",
    "src/main/moguai/neural/decision-trace.js",
    "src/main/moguai/neural/closed-loop.js",
  ]) {
    check(`future-module:${relative}`, hasFile(relative), "expected to fail before its implementation wave");
  }
}

function verifyV21Holdout() {
  check(`file:${V21_HOLDOUT}`, hasFile(V21_HOLDOUT));
  if (!hasFile(V21_HOLDOUT)) return;

  const manifest = JSON.parse(read(V21_HOLDOUT));
  check("v2.1-holdout:frozen", manifest.frozen === true);
  check("v2.1-holdout:sealed-count", manifest.taskCount === 20);
  check("v2.1-holdout:no-gold", manifest.noGoldFields === true);
  check(
    "v2.1-holdout:untouched",
    sha256(V21_HOLDOUT) === V21_HOLDOUT_SHA256,
    `sha256 ${sha256(V21_HOLDOUT)}`
  );
}

function runTests() {
  const command =
    process.platform === "win32"
      ? { file: "cmd.exe", args: ["/d", "/s", "/c", "npm test"] }
      : { file: "npm", args: ["test"] };
  const result = spawnSync(command.file, command.args, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  check("npm-test", result.status === 0, `exit ${result.status}`);
}

verifyDocs();
verifySettings();
verifyFutureModules();
verifyV21Holdout();
runTests();

const failed = checks.filter((item) => !item.ok);
console.log(`\nMOGU 2.2 acceptance: ${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
