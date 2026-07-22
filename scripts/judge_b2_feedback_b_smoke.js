/**
 * Judge Feedback-B live smoke — mechanism only (Branch N/A).
 *
 * Checks M1–M5 landed (packaging). M6–M10 recorded if present; not hard-fail
 * if model did not read full log (that is outcome, not implementation).
 *
 *   node scripts/judge_b2_feedback_b_smoke.js --run-id ct-fb-smoke-django11019-20260722
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const idx = argv.indexOf("--run-id");
const runId = idx >= 0 ? argv[idx + 1] : "";

if (!runId) {
  console.error("usage: node scripts/judge_b2_feedback_b_smoke.js --run-id <id>");
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

function findFeedbackRoot() {
  const candidates = [
    path.join(runDir, "feedback_pack"),
    path.join(runDir, "feedback_pack", "django__django-11019"),
    path.join(runDir, "feedback_pack", "django__django_11019"),
  ];
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    if (fs.existsSync(path.join(root, "meta.json"))) return root;
    try {
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const sub = path.join(root, ent.name);
        if (fs.existsSync(path.join(sub, "meta.json"))) return sub;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

const metricsPath = path.join(runDir, "metrics.json");
const metricsDoc = readJson(metricsPath);
ok("metrics.json exists", Boolean(metricsDoc), metricsPath);

const metrics = Array.isArray(metricsDoc?.metrics) ? metricsDoc.metrics : [];
const m0 = metrics[0] || null;
const fb = m0?.feedbackPack || null;
const d2 = m0?.d2Retry || null;
const div = m0?.d2Diversity || null;

ok("M1 feedbackPack.enabled", fb?.enabled === true, `enabled=${fb?.enabled}`);
ok(
  "D2 structured retry OFF",
  !d2?.enabled,
  `d2.enabled=${d2?.enabled}`
);
ok(
  "D2′ diversity OFF",
  !div?.enabled,
  `div.enabled=${div?.enabled}`
);

const artRoot = findFeedbackRoot();
ok("feedback_pack artifacts dir", Boolean(artRoot), artRoot || "(missing)");

let meta = null;
if (artRoot) {
  meta = readJson(path.join(artRoot, "meta.json"));
  ok("last_verify.txt", fs.existsSync(path.join(artRoot, "last_verify.txt")));
  ok("full_log.txt", fs.existsSync(path.join(artRoot, "full_log.txt")));
  ok("meta.json", Boolean(meta));
}

const hasPrefix =
  fb?.has_status_prefix === true ||
  meta?.has_status_prefix === true ||
  (artRoot &&
    fs.existsSync(path.join(artRoot, "last_verify.txt")) &&
    fs.readFileSync(path.join(artRoot, "last_verify.txt"), "utf8").startsWith("FEEDBACK_PACK"));
ok("M2 has_status_prefix", hasPrefix);

const hasElide =
  fb?.has_elide_marker === true ||
  fb?.head_tail === true ||
  meta?.has_elide_marker === true ||
  meta?.head_tail === true ||
  (artRoot &&
    fs.existsSync(path.join(artRoot, "last_verify.txt")) &&
    /\[elided \d+ chars/.test(fs.readFileSync(path.join(artRoot, "last_verify.txt"), "utf8")));
// Elide only required when log was long enough; packCount>=1 + prefix is enough if short.
const packCount = Number(fb?.packCount || meta?.seq || 0);
ok(
  "M3 elide/head_tail OR short-pack exempt",
  hasElide || packCount >= 1,
  `hasElide=${hasElide} packCount=${packCount}`
);

const failureClass = fb?.failure_class || meta?.failure_class || null;
ok("M4 failure_class non-empty", Boolean(failureClass), `class=${failureClass}`);

const fullPath = fb?.full_log_path || meta?.full_log_path || null;
ok("M5 full_log_path present", Boolean(fullPath), fullPath || "(none)");

// Soft diagnostics (do not fail smoke)
console.log(
  `INFO  M6 tools_read_full_log=${fb?.tools_read_full_log} reads=${fb?.fullLogReads}`
);
console.log(
  `INFO  M7 hypothesis_cites_feedback=${fb?.hypothesis_cites_feedback}`
);
console.log(
  `INFO  M8 hypothesis_text_changed=${fb?.hypothesis_text_changed}`
);
console.log(
  `INFO  M9 jaccard_patch=${fb?.jaccard_patch} file_set_changed=${fb?.file_set_changed}`
);
console.log(`INFO  M10 stack_anchor_changed=${fb?.stack_anchor_changed}`);

const hardFails = checks.filter((c) => !c.pass);
console.log(`\n===== Feedback-B SMOKE JUDGE ${hardFails.length ? "FAIL" : "PASS"} =====`);
console.log(`Branch: N/A (mechanism only)`);
process.exit(hardFails.length ? 1 : 0);
