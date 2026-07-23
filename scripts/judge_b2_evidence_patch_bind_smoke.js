/**
 * EPB smoke judge — mechanism gate landed (not Branch).
 * Expect: evidence artifact OR BINDING_MISSING/VALID signals in metrics.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const idx = args.indexOf("--run-id");
const runId = idx >= 0 ? args[idx + 1] : "";
if (!runId) {
  console.error("usage: node scripts/judge_b2_evidence_patch_bind_smoke.js --run-id <id>");
  process.exit(2);
}

const runDir = path.join(ROOT, "benchmarks", "swe-bench", "runs", runId);
const metricsPath = path.join(runDir, "metrics.json");
if (!fs.existsSync(metricsPath)) {
  console.error("FAIL: missing metrics.json");
  process.exit(1);
}

const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
const m0 = metrics.metrics?.[0] || metrics[0] || {};
const epb = m0.evidencePatchBind || null;

function ok(label, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  return cond;
}

let pass = true;
pass = ok("metrics present", Boolean(m0), runId) && pass;
pass = ok("EPB enabled in metrics", epb?.enabled === true, JSON.stringify(epb && { enabled: epb.enabled })) && pass;

const artRoot = path.join(runDir, "evidence_patch_bind");
const hasArt =
  fs.existsSync(artRoot) &&
  fs.readdirSync(artRoot, { recursive: true }).some((n) => /evidence_/.test(String(n)));
const tools = m0.toolsUsed || [];
const usedBind = tools.includes("record_patch_binding");
const sawMissing = (epb?.binding_missing || 0) > 0;
const sawValid = (epb?.binding_valid || 0) > 0;
const sawEvidence = hasArt || Boolean(epb?.openEvidenceId) || (epb?.cycles || []).length > 0;

// Evidence path must open after real verify fail.
pass =
  ok(
    "EPB evidence opened",
    sawEvidence === true,
    `evidence=${sawEvidence} openId=${epb?.openEvidenceId || "-"}`
  ) && pass;

// Gate must be exercised: either a blocked apply or a valid binding.
const gateExercised = sawMissing || sawValid || usedBind || (epb?.gated_apply_attempts || 0) > 0;
pass =
  ok(
    "EPB binding gate exercised",
    gateExercised,
    `missing=${sawMissing} valid=${sawValid} toolBind=${usedBind} gatedAttempts=${epb?.gated_apply_attempts || 0}`
  ) && pass;

console.log(pass ? "\nSMOKE PASS (mechanism; Branch N/A)" : "\nSMOKE FAIL");
process.exit(pass ? 0 : 1);
