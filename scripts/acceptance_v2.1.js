#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { audit } = require("./audit_v21_dependencies");

const ROOT = path.join(__dirname, "..");
const checks = [];

function check(id, condition, detail = "") {
  checks.push({ id, ok: Boolean(condition), detail });
  const line = `[${condition ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`;
  (condition ? console.log : console.error)(line);
}

function hasFile(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

function main() {
  const required = [
    "docs/V2.1_EXECUTION_PLAN.md",
    "docs/V2.1_AB_PROTOCOL.md",
    "benchmarks/swe-bench/holdout/manifest.json",
    "src/main/moguai/intelligence/repo-index.js",
    "src/main/moguai/intelligence/lsp-manager.js",
    "src/main/moguai/intelligence/test-discovery.js",
    "src/main/moguai/terminal/session-manager.js",
    "src/main/moguai/worktree/worktree-manager.js",
    "src/main/moguai/runtime/run-event-store.js",
    "src/main/moguai/runtime/retry-executor.js",
    "src/main/moguai/runtime/subtask-coordinator.js",
    "src/main/brain/openai-compatible-adapter.js",
  ];
  for (const relative of required) check(`file:${relative}`, hasFile(relative));

  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "benchmarks/swe-bench/holdout/manifest.json"), "utf8")
  );
  check("holdout:frozen", manifest.frozen === true);
  check("holdout:count", manifest.taskCount === 20);
  check(
    "holdout:no-gold",
    manifest.noGoldFields === true &&
      manifest.tasks.every(
        (task) =>
          !["patch", "test_patch", "problem_statement", "hints_text", "FAIL_TO_PASS", "PASS_TO_PASS"].some(
            (field) => field in task
          )
      )
  );

  const settings = fs.readFileSync(path.join(ROOT, "src/main/settings.js"), "utf8");
  for (const flag of [
    "v21RepoIntelligence",
    "v21Lsp",
    "v21ControlledTerminal",
    "v21ParallelWorktrees",
    "v21RecoverableRuntime",
    "v21Gpt56Adapter",
  ]) {
    check(`default-off:${flag}`, new RegExp(`${flag}:\\s*false`).test(settings));
  }
  const dependencyAudit = audit(ROOT);
  check("capability-intake:dependencies", dependencyAudit.ok, dependencyAudit.failures.join("; "));

  const npm = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "npm test"]] : ["npm", ["test"]];
  const result = spawnSync(npm[0], npm[1], { cwd: ROOT, stdio: "inherit", windowsHide: true });
  check("npm-test", result.status === 0, `exit ${result.status}`);

  const failed = checks.filter((item) => !item.ok);
  console.log(`\nMOGU 2.1 acceptance: ${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
