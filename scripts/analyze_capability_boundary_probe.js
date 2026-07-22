#!/usr/bin/env node
/** Analyze capability-boundary probe runs → RESULTS.md */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "benchmarks", "swe-bench", "runs");
const OUT = path.join(
  ROOT,
  "benchmarks",
  "swe-bench",
  "runs",
  "post_s3",
  "b1_lite50",
  "controlled_trials",
  "capability_boundary_probe"
);
const DATE = "20260722";
const JOBS = [
  ["sympy__sympy-13177", "probe-cap-sympy13177", "class-A"],
  ["django__django-15781", "probe-cap-django15781", "class-C"],
];

function analyze(runId) {
  const dir = path.join(RUNS, runId);
  const metPath = path.join(dir, "metrics.json");
  if (!fs.existsSync(metPath)) return { runId, missing: true };
  const m = JSON.parse(fs.readFileSync(metPath, "utf8")).metrics[0] || {};
  const tools = m.toolsUsed || [];
  const runTests = tools.filter((t) => t === "run_tests").length;
  const setPlan = tools.filter((t) => t === "set_plan").length;
  const apply = tools.filter((t) => t === "apply_patch").length;
  // crude: index of first run_tests then whether set_plan/apply after
  const firstRt = tools.indexOf("run_tests");
  const after = firstRt >= 0 ? tools.slice(firstRt + 1) : [];
  const planAfterFail = after.includes("set_plan");
  const applyAfterFail = after.includes("apply_patch");
  const rtAfterFail = after.includes("run_tests");
  return {
    runId,
    missing: false,
    engineOk: m.ok === true,
    verifyOk: m.verifyOk,
    verifySkipped: m.verifySkipped,
    failToPassOk: m.failToPassOk,
    stages: (m.verifyStages || []).map((s) => s.name || s),
    stackAnchorUsed: m.stackAnchorUsed === true,
    findRefsUsed: m.findRefsUsed === true,
    agentSteps: m.agentSteps,
    runTests,
    setPlan,
    apply,
    planAfterFirstRunTests: planAfterFail,
    applyAfterFirstRunTests: applyAfterFail,
    secondRunTests: rtAfterFail,
    tools: tools.join(">"),
    noVerifyLikely:
      m.verifySkipped === true ||
      m.verifyOk == null && (!(m.verifyStages || []).length),
  };
}

const rows = [];
for (const [instance, prefix, role] of JOBS) {
  const runs = [];
  for (let i = 1; i <= 3; i += 1) {
    runs.push({ i, ...analyze(`${prefix}-c${i}-${DATE}`) });
  }
  rows.push({ instance, role, runs });
}

const summary = {
  date: DATE,
  branch: "N/A",
  rows,
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "aggregate.json"), JSON.stringify(summary, null, 2));

const lines = [
  "# Capability-Boundary Probe — RESULTS",
  "",
  "```yaml",
  "status: Complete",
  "branch: N/A",
  "intervention: none (baseline)",
  "```",
  "",
  "> 目的：判断熟脸三题上的「不利用失败反馈」是否可外推。**非 CT Branch。**",
  "",
  "## Slot A — Class A (`sympy-13177`)",
  "",
  "| c | engineOk | verify | stages | run_tests | plan/apply after 1st RT | tools tail |",
  "|---|----------|--------|--------|-----------|-------------------------|------------|",
];

const a = rows[0];
for (const r of a.runs) {
  lines.push(
    `| ${r.i} | ${r.engineOk} | ok=${r.verifyOk} skip=${r.verifySkipped} | ${(r.stages || []).join(",") || "∅"} | ${r.runTests} | plan=${r.planAfterFirstRunTests} apply=${r.applyAfterFirstRunTests} 2ndRT=${r.secondRunTests} | \`${String(r.tools || "").slice(-80)}\` |`
  );
}
lines.push("");
lines.push("## Slot C — Class C-capable (`django-15781`)", "");
lines.push(
  "| c | engineOk | verifyOk | f2p | stack/refs | after 1st RT: plan/apply/2ndRT | reading |"
);
lines.push("|---|----------|----------|-----|------------|--------------------------------|---------|");
const c = rows[1];
for (const r of c.runs) {
  lines.push(
    `| ${r.i} | ${r.engineOk} | ${r.verifyOk} | ${r.failToPassOk} | sa=${r.stackAnchorUsed} fr=${r.findRefsUsed} | plan=${r.planAfterFirstRunTests} apply=${r.applyAfterFirstRunTests} 2ndRT=${r.secondRunTests} | steps=${r.agentSteps} |`
  );
}
lines.push("");
lines.push("## Verdict (fill after inspect)");
lines.push("");
lines.push("See narrative in RESULTS body after human/agent pass.");
lines.push("");
fs.writeFileSync(path.join(OUT, "RESULTS.md"), lines.join("\n"));
console.log(JSON.stringify(summary, null, 2));
