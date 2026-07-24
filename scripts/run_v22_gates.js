#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const OUTPUT = path.join(ROOT, "benchmarks", "v2.2", "results", "regression-gates.json");
const gates = [
  { id: "unit", args: ["test"], count: /ℹ pass (\d+)/ },
  { id: "acceptance-v2.0", args: ["run", "acceptance:v2.0"], count: /acceptance: (\d+)\/(\d+) passed/ },
  { id: "acceptance-coding", args: ["run", "acceptance:coding"], count: /coding acceptance: (\d+)\/(\d+) passed/ },
  { id: "acceptance-v2.1", args: ["run", "acceptance:v2.1"], count: /MOGU 2\.1 acceptance: (\d+)\/(\d+) passed/ },
  { id: "acceptance-v2.2", args: ["run", "acceptance:v2.2"], count: /MOGU 2\.2 acceptance: (\d+)\/(\d+) passed/ },
  { id: "dependency-audit-v2.1", args: ["run", "audit:v2.1-deps"], count: /"ok": true/ },
  { id: "intake-audit-v2.2", args: ["run", "audit:v2.2-intake"], count: /"ok": true/ },
];

function runGate(gate) {
  const command =
    process.platform === "win32"
      ? { file: "cmd.exe", args: ["/d", "/s", "/c", "npm", ...gate.args] }
      : { file: "npm", args: gate.args };
  const result = spawnSync(command.file, command.args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const match = output.match(gate.count);
  return {
    id: gate.id,
    command: `npm ${gate.args.join(" ")}`,
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status,
    observed: match ? match.slice(1).map((value) => Number(value) || value) : null,
  };
}

const startedAt = new Date().toISOString();
const results = gates.map(runGate);
const report = {
  schemaVersion: 1,
  kind: "mogu-v2.2-regression-gates",
  status: results.every((gate) => gate.status === "PASS") ? "PASS" : "FAIL",
  startedAt,
  completedAt: new Date().toISOString(),
  results,
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
process.exit(report.status === "PASS" ? 0 : 1);
