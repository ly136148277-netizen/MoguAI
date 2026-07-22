/**
 * B2-D2′ hypothesis diversity helpers (P7 only).
 * Enable with MOGU_D2_HYPOTHESIS_DIVERSITY=1 (requires D2 structured retry).
 * Does not change verify coverage or feedback packing (P1–P3).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { normalizeHypothesis } = require("./coding-d2-retry");

const DEFAULT_JACCARD_MAX = 0.55;

function isHypothesisDiversityEnabled(opts = {}) {
  if (opts.hypothesisDiversity === false) return false;
  if (opts.hypothesisDiversity === true) return true;
  return process.env.MOGU_D2_HYPOTHESIS_DIVERSITY === "1";
}

function diversityJaccardMax(opts = {}) {
  const n = Number(
    opts.diversityJaccardMax != null
      ? opts.diversityJaccardMax
      : process.env.MOGU_D2_DIVERSITY_JACCARD_MAX || DEFAULT_JACCARD_MAX
  );
  if (!Number.isFinite(n) || n <= 0 || n > 1) return DEFAULT_JACCARD_MAX;
  return n;
}

function createDiversityState(opts = {}) {
  return {
    enabled: isHypothesisDiversityEnabled(opts),
    jaccardMax: diversityJaccardMax(opts),
    artifactDir: String(opts.cycleArtifactDir || process.env.MOGU_D2_CYCLE_ARTIFACT_DIR || "").trim(),
    failedPaths: [],
    cycles: [],
    blockedPlanCount: 0,
    blockedPatchCount: 0,
    lastPlanMeta: null,
  };
}

function tokenizePatchLines(diff) {
  const set = new Set();
  for (const line of String(diff || "").split(/\n/)) {
    if (!(line.startsWith("+") || line.startsWith("-"))) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const body = line.slice(1).trim();
    if (body) set.add(body);
  }
  return set;
}

function jaccardPatch(a, b) {
  const A = tokenizePatchLines(a);
  const B = tokenizePatchLines(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function normalizeFileSet(files) {
  return [
    ...new Set(
      (Array.isArray(files) ? files : [])
        .map((f) =>
          String(f || "")
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .trim()
        )
        .filter(Boolean)
    ),
  ].sort();
}

function sameFileSet(a, b) {
  const A = normalizeFileSet(a);
  const B = normalizeFileSet(b);
  if (A.length !== B.length) return false;
  return A.every((x, i) => x === B[i]);
}

function fileSetOverlap(a, b) {
  const A = new Set(normalizeFileSet(a));
  const B = new Set(normalizeFileSet(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / new Set([...A, ...B]).size;
}

function parseCandidateHypotheses({ hypothesis = "", approach = "", candidate_hypotheses } = {}) {
  if (Array.isArray(candidate_hypotheses) && candidate_hypotheses.length) {
    return candidate_hypotheses
      .map((c) => String(c || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  const blob = `${hypothesis}\n${approach}`;
  const numbered = [];
  const re = /(?:^|\n)\s*(?:CANDIDATE\s*)?(\d+)[\)\].:]\s*([^\n]+)/gi;
  let m;
  while ((m = re.exec(blob))) {
    numbered.push(m[2].trim());
  }
  if (numbered.length >= 2) return [...new Set(numbered)].slice(0, 8);

  const bullets = [];
  for (const line of blob.split(/\n/)) {
    const t = line.trim();
    if (/^[-*]\s+\S/.test(t)) bullets.push(t.replace(/^[-*]\s+/, "").trim());
  }
  if (bullets.length >= 2) return [...new Set(bullets)].slice(0, 8);
  return [];
}

function gitDiffText(workspace) {
  const r = spawnSync("git", ["diff", "HEAD", "--", "."], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  return String(r.stdout || "");
}

function gitTouchedFiles(workspace) {
  const r = spawnSync("git", ["diff", "HEAD", "--name-only", "--", "."], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return normalizeFileSet(String(r.stdout || "").split(/\r?\n/));
}

function patchSummary(diff, maxLines = 40) {
  const lines = String(diff || "")
    .split(/\n/)
    .filter((l) => l.startsWith("+") || l.startsWith("-") || l.startsWith("@@") || l.startsWith("diff "))
    .slice(0, maxLines);
  return lines.join("\n").slice(0, 4000);
}

function lastFailedPath(div) {
  if (!div?.failedPaths?.length) return null;
  return div.failedPaths[div.failedPaths.length - 1];
}

/**
 * Record a failed repair path (hypothesis + files + patch) for exclusion.
 */
function recordFailedPath(div, { hypothesis = "", files = [], patch = "", cycle = null } = {}) {
  if (!div) return null;
  const entry = {
    cycle: cycle == null ? div.failedPaths.length + 1 : cycle,
    hypothesis: String(hypothesis || "").trim(),
    files: normalizeFileSet(files),
    patch: String(patch || ""),
    patchSummary: patchSummary(patch),
    at: new Date().toISOString(),
  };
  div.failedPaths.push(entry);
  return entry;
}

/**
 * @returns {{ ok: boolean, error?: string, meta?: object }}
 */
function evaluateDiversityPlan(div, {
  hypothesis = "",
  approach = "",
  candidate_hypotheses,
  targetFiles = [],
} = {}) {
  if (!div?.enabled) return { ok: true };
  const candidates = parseCandidateHypotheses({ hypothesis, approach, candidate_hypotheses });
  const prev = lastFailedPath(div);
  const prevH = normalizeHypothesis(prev?.hypothesis || "");
  const nextH = normalizeHypothesis(hypothesis);

  if (candidates.length < 2) {
    div.blockedPlanCount += 1;
    return {
      ok: false,
      error:
        "B2-D2′ diversity: set_plan needs ≥2 candidate_hypotheses (array) or numbered candidates in hypothesis/approach, then select one as hypothesis.",
    };
  }
  if (!nextH) {
    div.blockedPlanCount += 1;
    return { ok: false, error: "B2-D2′ diversity: hypothesis must be non-empty (selected candidate)." };
  }
  if (prevH && nextH === prevH) {
    div.blockedPlanCount += 1;
    return {
      ok: false,
      error:
        "B2-D2′ diversity: selected hypothesis repeats the previous failed hypothesis. Pick a different candidate.",
    };
  }
  const distinctFromPrev = prevH
    ? candidates.filter((c) => normalizeHypothesis(c) !== prevH)
    : candidates;
  if (prevH && distinctFromPrev.length < 1) {
    div.blockedPlanCount += 1;
    return {
      ok: false,
      error: "B2-D2′ diversity: all candidates match the previous failed hypothesis; propose different paths.",
    };
  }

  const files = normalizeFileSet(targetFiles);
  const filesDiffer = prev?.files?.length ? !sameFileSet(files, prev.files) : true;
  const meta = {
    candidate_hypotheses_n: candidates.length,
    candidates,
    selected: hypothesis,
    target_files: files,
    previous_hypothesis: prev?.hypothesis || "",
    file_set_changed_vs_prev: filesDiffer,
    hypothesis_text_changed: !prevH || nextH !== prevH,
  };
  div.lastPlanMeta = meta;
  return { ok: true, meta };
}

/**
 * Block same-file high-similarity patches vs last failed path.
 * @returns {{ ok: boolean, error?: string, meta?: object }}
 */
function evaluateDiversityPatch(div, { files = [], patch = "" } = {}) {
  if (!div?.enabled) return { ok: true };
  const prev = lastFailedPath(div);
  if (!prev?.patch && !prev?.files?.length) return { ok: true };

  const nextFiles = normalizeFileSet(files.length ? files : []);
  const prevFiles = normalizeFileSet(prev.files || []);
  const j = jaccardPatch(patch, prev.patch || "");
  const sameFiles = prevFiles.length > 0 && nextFiles.length > 0 && sameFileSet(nextFiles, prevFiles);
  const meta = {
    jaccard_patch: j,
    files_t: nextFiles,
    files_t_1: prevFiles,
    file_set_changed: !sameFiles,
    jaccardMax: div.jaccardMax,
  };

  if (sameFiles && j >= div.jaccardMax) {
    div.blockedPatchCount += 1;
    return {
      ok: false,
      error: `B2-D2′ diversity: patch too similar to previous failed path (same files, jaccard=${j.toFixed(2)} ≥ ${div.jaccardMax}). Change files or mechanism.`,
      meta,
    };
  }
  return { ok: true, meta };
}

function ensureArtifactDir(dir) {
  if (!dir) return false;
  fs.mkdirSync(dir, { recursive: true });
  return true;
}

function cycleDir(artifactRoot, cycle) {
  return path.join(artifactRoot, `cycle_${cycle}`);
}

function writeCycleHypothesis(artifactRoot, cycle, { hypothesis, approach, meta } = {}) {
  if (!artifactRoot || !ensureArtifactDir(artifactRoot)) return null;
  const dir = cycleDir(artifactRoot, cycle);
  ensureArtifactDir(dir);
  const body = [
    `# Cycle ${cycle} hypothesis`,
    "",
    "## Selected",
    String(hypothesis || ""),
    "",
    "## Approach",
    String(approach || ""),
    "",
    "## Meta",
    "```json",
    JSON.stringify(meta || {}, null, 2),
    "```",
    "",
  ].join("\n");
  const p = path.join(dir, "hypothesis.md");
  fs.writeFileSync(p, body, "utf8");
  return p;
}

function writeCyclePatch(artifactRoot, cycle, patchText) {
  if (!artifactRoot || !ensureArtifactDir(artifactRoot)) return null;
  const dir = cycleDir(artifactRoot, cycle);
  ensureArtifactDir(dir);
  const p = path.join(dir, "patch.diff");
  fs.writeFileSync(p, String(patchText || ""), "utf8");
  return p;
}

function writeCycleVerify(artifactRoot, cycle, verifyResult) {
  if (!artifactRoot || !ensureArtifactDir(artifactRoot)) return null;
  const dir = cycleDir(artifactRoot, cycle);
  ensureArtifactDir(dir);
  const p = path.join(dir, "verify_result.json");
  fs.writeFileSync(p, JSON.stringify(verifyResult || {}, null, 2), "utf8");
  return p;
}

function noteCycleMetrics(div, cycleEntry) {
  if (!div) return;
  div.cycles.push(cycleEntry);
}

function buildDiversityGateExtra(div) {
  if (!div?.enabled) return "";
  const prev = lastFailedPath(div);
  const lines = [
    "[B2-D2′ hypothesis diversity]",
    "Before set_plan: propose ≥2 distinct repair candidates (candidate_hypotheses array preferred).",
    "Select ONE unused candidate as hypothesis; it must differ from the previous failed hypothesis.",
    "Avoid same-file micro-tweaks of the last failed patch (jaccard gate).",
  ];
  if (prev) {
    lines.push(`Previous failed hypothesis: ${String(prev.hypothesis || "").slice(0, 240)}`);
    lines.push(`Previous failed files: ${(prev.files || []).join(", ") || "(unknown)"}`);
    if (prev.patchSummary) {
      lines.push("Previous patch summary (truncated):");
      lines.push(String(prev.patchSummary).slice(0, 600));
    }
  }
  return lines.join("\n");
}

function diversitySummary(div) {
  if (!div) return null;
  const last = div.cycles[div.cycles.length - 1] || null;
  return {
    enabled: Boolean(div.enabled),
    jaccardMax: div.jaccardMax,
    artifactDir: div.artifactDir || null,
    failedPathCount: div.failedPaths.length,
    blockedPlanCount: div.blockedPlanCount,
    blockedPatchCount: div.blockedPatchCount,
    cycles: div.cycles,
    lastCycleJaccard: last?.jaccard_patch ?? null,
    lastFileSetChanged: last?.file_set_changed ?? null,
  };
}

module.exports = {
  DEFAULT_JACCARD_MAX,
  isHypothesisDiversityEnabled,
  diversityJaccardMax,
  createDiversityState,
  tokenizePatchLines,
  jaccardPatch,
  normalizeFileSet,
  sameFileSet,
  fileSetOverlap,
  parseCandidateHypotheses,
  gitDiffText,
  gitTouchedFiles,
  patchSummary,
  lastFailedPath,
  recordFailedPath,
  evaluateDiversityPlan,
  evaluateDiversityPatch,
  writeCycleHypothesis,
  writeCyclePatch,
  writeCycleVerify,
  noteCycleMetrics,
  buildDiversityGateExtra,
  diversitySummary,
};
