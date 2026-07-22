/**
 * Judge Feedback-Consumption live smoke — mechanism only.
 * Checks gate can reject invalid consumption and accept valid (unit covers rules);
 * live: consume enabled, pack base on, D2 off, artifacts present.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const idx = argv.indexOf("--run-id");
const runId = idx >= 0 ? argv[idx + 1] : "";
if (!runId) {
  console.error("usage: node scripts/judge_b2_feedback_consume_smoke.js --run-id <id>");
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

const metricsDoc = readJson(path.join(runDir, "metrics.json"));
ok("metrics.json", Boolean(metricsDoc));
const m0 = (metricsDoc?.metrics || [])[0] || {};
const fc = m0.feedbackConsume || null;
const fb = m0.feedbackPack || null;
const d2 = m0.d2Retry || null;
const div = m0.d2Diversity || null;

ok("M base pack enabled", fb?.enabled === true, `pack=${fb?.enabled}`);
ok("delta consume enabled", fc?.enabled === true, `consume=${fc?.enabled}`);
ok("D2 OFF", !d2?.enabled);
ok("D2′ OFF", !div?.enabled);

const consumeRoot = path.join(runDir, "feedback_consume");
let art = "";
if (fs.existsSync(consumeRoot)) {
  if (fs.existsSync(path.join(consumeRoot, "django__django-11019"))) {
    art = path.join(consumeRoot, "django__django-11019");
  } else {
    for (const ent of fs.readdirSync(consumeRoot, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        art = path.join(consumeRoot, ent.name);
        break;
      }
    }
  }
}
ok("feedback_consume artifacts", Boolean(art), art || "(missing)");

const hasConsumeJson =
  art &&
  fs.readdirSync(art).some((f) => /^consume_\d+\.json$/.test(f));
ok("consume_*.json present OR gate never pending", hasConsumeJson || fc?.validCount === 0, `validCount=${fc?.validCount}`);

// Soft info
console.log(`INFO  gateBlocks=${fc?.gateBlocks} validCount=${fc?.validCount} C3=${fc?.C3_any} C4=${fc?.C4_any}`);
console.log(`INFO  Branch N/A — mechanism smoke only`);

const hard = checks.filter((c) => !c.pass);
console.log(`\n===== FC SMOKE JUDGE ${hard.length ? "FAIL" : "PASS"} =====`);
process.exit(hard.length ? 1 : 0);
