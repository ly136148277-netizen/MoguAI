/**
 * Aggregate independent SWE candidate runs into Best-of-N slices (N=1/3/5).
 *
 *   node scripts/bench_swe_bon_aggregate.js \
 *     --bon-id lite8-bon-20260720 \
 *     --instance astropy__astropy-14365 \
 *     --runs runA,runB,runC,runD,runE \
 *     [--ns 1,3,5]
 *
 * Reads each run's metrics.json + official report.json under logs/.
 * Writes benchmarks/swe-bench/runs/<bon-id>/bon_summary.json + BON_REPORT.md
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const RUNS = path.join(ROOT, "benchmarks", "swe-bench", "runs");

function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx < 0) return "";
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) return "";
  return next;
}

function findReport(runDir, instanceId) {
  const logs = path.join(runDir, "logs");
  if (!fs.existsSync(logs)) return null;
  const stack = [logs];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name === "report.json") {
        try {
          const j = JSON.parse(fs.readFileSync(p, "utf8"));
          if (j && j[instanceId]) return { path: p, data: j[instanceId] };
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null;
}

function patchFingerprint(patch) {
  const text = String(patch || "");
  if (!text.trim()) {
    return { files: [], hunkCount: 0, sha1: "", bytes: 0 };
  }
  const files = [];
  const fileRe = /^(?:diff --git a\/(.+?) b\/|--- a\/(.+?)|\+\+\+ b\/(.+?))$/gm;
  let m;
  while ((m = fileRe.exec(text))) {
    const f = m[1] || m[2] || m[3];
    if (f && f !== "/dev/null" && !files.includes(f)) files.push(f);
  }
  const hunkCount = (text.match(/^@@/gm) || []).length;
  const sha1 = crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
  return { files, hunkCount, sha1, bytes: Buffer.byteLength(text, "utf8") };
}

function loadPredictionPatch(runDir, instanceId) {
  const predPath = path.join(runDir, "predictions.jsonl");
  if (!fs.existsSync(predPath)) return "";
  const lines = fs.readFileSync(predPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.instance_id === instanceId) return String(row.model_patch || row.patch || "");
    } catch {
      /* ignore */
    }
  }
  return "";
}

function failTaxonomy(report) {
  const ts = report?.tests_status || {};
  const ftpFail = ts.FAIL_TO_PASS?.failure || [];
  const ptfFail = ts.PASS_TO_FAIL?.failure || [];
  const ptpFail = ts.PASS_TO_PASS?.failure || [];
  return {
    fail_to_pass_failure: ftpFail,
    pass_to_fail_failure: ptfFail,
    pass_to_pass_failure: ptpFail,
    summary:
      ftpFail.length || ptfFail.length || ptpFail.length
        ? [
            ftpFail.length ? `FAIL_TO_PASS fail: ${ftpFail.join("; ")}` : "",
            ptfFail.length ? `PASS_TO_FAIL fail: ${ptfFail.join("; ")}` : "",
            ptpFail.length ? `PASS_TO_PASS fail: ${ptpFail.join("; ")}` : "",
          ]
            .filter(Boolean)
            .join(" | ")
        : report?.resolved
          ? "resolved"
          : "unresolved (no failed test names in report)",
  };
}

function loadCandidate(runId, instanceId) {
  const runDir = path.join(RUNS, runId);
  const metricsPath = path.join(runDir, "metrics.json");
  let metric = null;
  if (fs.existsSync(metricsPath)) {
    const mj = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    metric = (mj.metrics || []).find((x) => x.instance_id === instanceId) || null;
  }
  const reportHit = findReport(runDir, instanceId);
  const patch = loadPredictionPatch(runDir, instanceId);
  const fp = patchFingerprint(patch);
  const resolved = reportHit ? Boolean(reportHit.data.resolved) : null;
  const tax = reportHit ? failTaxonomy(reportHit.data) : null;
  return {
    runId,
    instanceId,
    resolved,
    elapsedMs: metric?.elapsedMs ?? null,
    patchBytes: metric?.patchBytes ?? fp.bytes,
    genHintUsed: metric?.genHintUsed ?? null,
    findRefsUsed: metric?.findRefsUsed ?? null,
    verifyOk: metric?.verifyOk ?? null,
    agentSteps: metric?.agentSteps ?? null,
    error: metric?.error ?? null,
    patchFingerprint: fp,
    failTaxonomy: tax,
    reportPath: reportHit?.path || null,
    missingReport: !reportHit,
    missingMetrics: !metric,
  };
}

function anyPass(candidates, n) {
  const slice = candidates.slice(0, n);
  const known = slice.filter((c) => c.resolved !== null);
  const pass = known.some((c) => c.resolved === true);
  const totalMs = known.reduce((s, c) => s + (Number(c.elapsedMs) || 0), 0);
  return {
    N: n,
    candidates: known.length,
    anyResolved: pass,
    resolvedCount: known.filter((c) => c.resolved).length,
    cumulativeElapsedMs: totalMs,
    runIds: slice.map((c) => c.runId),
  };
}

function renderMd(bonId, instanceId, candidates, slices, ns) {
  const lines = [];
  lines.push(`# Best-of-N report — ${bonId}`);
  lines.push("");
  lines.push(`- instance: \`${instanceId}\``);
  lines.push(`- candidates: ${candidates.length}`);
  lines.push(`- N slices: ${ns.join(", ")}`);
  lines.push(`- R_reg: **unchanged** (this report does not rewrite regression baseline)`);
  lines.push("");
  lines.push("## Experiment question");
  lines.push("");
  lines.push(
    "> Does independent sampling redundancy raise “at least one Resolved” for a High Variance instance? Wrong patches must be diagnosed; any-pass ≠ “more samples = stronger model”."
  );
  lines.push("");
  lines.push("## Candidates");
  lines.push("");
  lines.push("| # | runId | Resolved | elapsedMs | patchBytes | sha1 | files | fail taxonomy |");
  lines.push("|---|-------|----------|-----------|------------|------|-------|---------------|");
  candidates.forEach((c, i) => {
    const res =
      c.resolved === true ? "Resolved" : c.resolved === false ? "Unresolved" : "MISSING";
    const files = (c.patchFingerprint?.files || []).join(", ") || "-";
    const sha = c.patchFingerprint?.sha1 || "-";
    const tax = c.failTaxonomy?.summary || (c.missingReport ? "no report" : "-");
    lines.push(
      `| ${i + 1} | \`${c.runId}\` | ${res} | ${c.elapsedMs ?? "-"} | ${c.patchBytes ?? "-"} | \`${sha}\` | ${files} | ${tax} |`
    );
  });
  lines.push("");
  lines.push("## N slices (shared pool, prefix any-pass)");
  lines.push("");
  lines.push("| N | anyResolved | resolvedCount | cumulativeElapsedMs | runIds |");
  lines.push("|---|-------------|---------------|---------------------|--------|");
  for (const s of slices) {
    lines.push(
      `| ${s.N} | ${s.anyResolved} | ${s.resolvedCount}/${s.candidates} | ${s.cumulativeElapsedMs} | ${s.runIds.map((r) => `\`${r}\``).join(", ")} |`
    );
  }
  lines.push("");
  lines.push("## Unresolved patch details");
  lines.push("");
  const fails = candidates.filter((c) => c.resolved === false);
  if (!fails.length) {
    lines.push("_No unresolved candidates with reports._");
  } else {
    for (const c of fails) {
      lines.push(`### \`${c.runId}\``);
      lines.push("");
      lines.push(`- files: ${(c.patchFingerprint?.files || []).join(", ") || "(empty)"}`);
      lines.push(`- hunks: ${c.patchFingerprint?.hunkCount ?? 0}`);
      lines.push(`- sha1: \`${c.patchFingerprint?.sha1 || ""}\``);
      lines.push(`- FAIL_TO_PASS failures: ${(c.failTaxonomy?.fail_to_pass_failure || []).join(", ") || "(none)"}`);
      lines.push(`- PASS_TO_FAIL failures: ${(c.failTaxonomy?.pass_to_fail_failure || []).join(", ") || "(none)"}`);
      lines.push(`- PASS_TO_PASS failures: ${(c.failTaxonomy?.pass_to_pass_failure || []).join(", ") || "(none)"}`);
      if (c.error) lines.push(`- agent error: \`${String(c.error).slice(0, 200)}\``);
      lines.push("");
    }
  }
  lines.push("## Cost note");
  lines.push("");
  lines.push(
    "Cost proxy = sum of candidate `elapsedMs` (wall agent time). API $ not metered here. BoN cumulative cost ≈ prefix sum in the N-slice table."
  );
  lines.push("");
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const bonId = flagValue(argv, "--bon-id") || flagValue(argv, "--out") || `bon-${Date.now()}`;
  const instanceId = flagValue(argv, "--instance") || flagValue(argv, "--only");
  const runsRaw = flagValue(argv, "--runs") || flagValue(argv, "--run-ids");
  const nsRaw = flagValue(argv, "--ns") || "1,3,5";
  if (!instanceId || !runsRaw) {
    console.error(
      "用法: node scripts/bench_swe_bon_aggregate.js --bon-id <id> --instance <id> --runs r1,r2,... [--ns 1,3,5]"
    );
    process.exit(2);
  }
  const runIds = runsRaw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ns = nsRaw
    .split(/[,;\s]+/)
    .map((s) => Number(s))
    .filter((n) => n > 0);
  const candidates = runIds.map((id) => loadCandidate(id, instanceId));
  const slices = ns.map((n) => anyPass(candidates, n));
  const outDir = path.join(RUNS, bonId);
  fs.mkdirSync(outDir, { recursive: true });
  const summary = {
    bonId,
    instanceId,
    createdAt: new Date().toISOString(),
    ns,
    candidates,
    slices,
    note: "Does not rewrite R_reg. anyResolved is pool-prefix OR, not model strength.",
  };
  fs.writeFileSync(path.join(outDir, "bon_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  const md = renderMd(bonId, instanceId, candidates, slices, ns);
  fs.writeFileSync(path.join(outDir, "BON_REPORT.md"), md, "utf8");
  // also stash per-instance copy when aggregating multiple arms into one bon folder later
  const safeInst = instanceId.replace(/[^\w.-]+/g, "_");
  fs.writeFileSync(path.join(outDir, `bon_summary_${safeInst}.json`), JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, `BON_REPORT_${safeInst}.md`), md, "utf8");
  console.log(`[bon] wrote ${path.join(outDir, "BON_REPORT.md")}`);
  for (const s of slices) {
    console.log(
      `[bon] N=${s.N} anyResolved=${s.anyResolved} resolved=${s.resolvedCount}/${s.candidates} ms=${s.cumulativeElapsedMs}`
    );
  }
}

main();
