/**
 * Judge B2-D2′ live smoke — mechanism only (Branch N/A).
 *
 *   node scripts/judge_b2d2p_smoke.js --run-id ct-b2d2p-smoke-django11019-20260722
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const idx = argv.indexOf("--run-id");
const runId = idx >= 0 ? argv[idx + 1] : "";

if (!runId) {
  console.error("usage: node scripts/judge_b2d2p_smoke.js --run-id <id>");
  process.exit(2);
}

const runDir = path.join(ROOT, "benchmarks", "swe-bench", "runs", runId);
const checks = [];

function ok(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function listCycles(cyclesRoot) {
  if (!fs.existsSync(cyclesRoot)) return [];
  return fs
    .readdirSync(cyclesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^cycle_\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));
}

function hypText(cycleDir) {
  const p = path.join(cycleDir, "hypothesis.md");
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

function extractSelected(md) {
  const m = /## Selected\s*\n([\s\S]*?)\n## /i.exec(md);
  return (m ? m[1] : md).trim().toLowerCase().replace(/\s+/g, " ");
}

const metricsPath = path.join(runDir, "metrics.json");
const metricsDoc = readJson(metricsPath);
ok("metrics.json exists", Boolean(metricsDoc), metricsPath);

const metrics = Array.isArray(metricsDoc?.metrics) ? metricsDoc.metrics : [];
const m0 = metrics[0] || null;
const div = m0?.d2Diversity || null;
const d2 = m0?.d2Retry || null;

ok("diversity flag true", div?.enabled === true, `enabled=${div?.enabled}`);
ok("d2 retry enabled", d2?.enabled === true, `enabled=${d2?.enabled}`);

const instance = String(m0?.instance_id || "django__django-11019").replace(/[^\w.-]+/g, "_");
const cyclesRoot = path.join(runDir, "d2_cycles", instance);
const altRoots = [
  cyclesRoot,
  path.join(runDir, "d2_cycles", "django__django-11019"),
  path.join(runDir, "d2_cycles"),
].filter((p, i, arr) => arr.indexOf(p) === i);

let foundRoot = "";
let cycles = [];
for (const root of altRoots) {
  if (!fs.existsSync(root)) continue;
  const direct = listCycles(root);
  if (direct.length) {
    foundRoot = root;
    cycles = direct;
    break;
  }
  // one level down
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const sub = path.join(root, ent.name);
    const c = listCycles(sub);
    if (c.length) {
      foundRoot = sub;
      cycles = c;
      break;
    }
  }
  if (cycles.length) break;
}

ok("cycle dirs present", cycles.length >= 1, `root=${foundRoot || "(missing)"} n=${cycles.length}`);

let allPatches = true;
let allVerify = true;
let allHyp = true;
const hypSelected = [];
for (const c of cycles) {
  const dir = path.join(foundRoot, c);
  const hasHyp = fs.existsSync(path.join(dir, "hypothesis.md"));
  const hasPatch = fs.existsSync(path.join(dir, "patch.diff"));
  const hasVerify = fs.existsSync(path.join(dir, "verify_result.json"));
  allHyp = allHyp && hasHyp;
  allPatches = allPatches && hasPatch;
  allVerify = allVerify && hasVerify;
  if (hasHyp) hypSelected.push(extractSelected(hypText(dir)));
  if (hasPatch) {
    const sz = fs.statSync(path.join(dir, "patch.diff")).size;
    if (sz <= 0) allPatches = false;
  }
}

ok("hypothesis.md each cycle", cycles.length === 0 ? false : allHyp);
ok("patch.diff each cycle (non-empty)", cycles.length === 0 ? false : allPatches);
ok("verify_result.json each cycle", cycles.length === 0 ? false : allVerify);

// cycle count within D2 max (≤2 structured cycles). Opening failure may create cycle_1..cycle_2.
ok(
  "cycle count within budget",
  cycles.length >= 1 && cycles.length <= 2,
  `cycles=${cycles.join(",") || "(none)"}`
);

let hypDiff = null;
if (cycles.length >= 2 && hypSelected.length >= 2) {
  hypDiff = hypSelected[0] !== hypSelected[1] && Boolean(hypSelected[1]);
  ok("cycle2 hypothesis differs from cycle1", hypDiff, `h1≠h2=${hypDiff}`);
} else if (cycles.length === 1) {
  // Single cycle still OK if diversity gate opened and artifacts complete;
  // note for report — may mean verify passed early or max not reached.
  ok(
    "cycle2 hypothesis differs from cycle1",
    false,
    "only one cycle dir — FAIL for full diversity path (need ≥2 cycles to confirm)"
  );
} else {
  ok("cycle2 hypothesis differs from cycle1", false, "insufficient cycles");
}

const failed = checks.filter((c) => !c.pass);
console.log("");
console.log(`D2′ mechanism smoke: ${failed.length ? "FAIL" : "PASS"}`);
console.log("Branch: N/A");
if (failed.length) {
  console.log("failed checks:", failed.map((f) => f.name).join(", "));
}
process.exit(failed.length ? 1 : 0);
