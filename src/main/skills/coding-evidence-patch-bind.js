/**
 * Evidence-to-Patch Binding (EPB): explicit BINDING before apply_patch after verify fail.
 * Enable with MOGU_EVIDENCE_PATCH_BIND=1 (all other strategy flags OFF per Spec).
 *
 * Codes: BINDING_MISSING | BINDING_MALFORMED | BINDING_VALID
 * Mechanism: DB0–DB4 (DB0 = trigger rate; DB2 = L1∪L2∪L3 mechanical alignment)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { classifyVerifyFailure } = require("./coding-d2-retry");

function isEvidencePatchBindEnabled(opts = {}) {
  if (opts.evidencePatchBind === true) return true;
  if (opts.evidencePatchBind === false) return false;
  const v = String(process.env.MOGU_EVIDENCE_PATCH_BIND || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function createEvidencePatchBindState(opts = {}) {
  const enabled = isEvidencePatchBindEnabled(opts);
  const artifactDir = String(
    opts.evidencePatchBindDir || process.env.MOGU_EVIDENCE_PATCH_BIND_DIR || ""
  ).trim();
  return {
    enabled,
    artifactDir,
    pending: false,
    validOpen: false,
    openEvidence: null,
    lastBinding: null,
    lastIntendedNorm: null,
    applyCountBeforeFail: 0,
    applyCountAfterFail: 0,
    gatedApplyAttempts: 0,
    bindingMissing: 0,
    bindingMalformed: 0,
    bindingValid: 0,
    validUsedOnApply: 0,
    evidenceSeq: 0,
    bindingSeq: 0,
    rejectLog: [],
    evidences: [],
    bindings: [],
    cycles: [],
  };
}

function ensureDir(dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^testbed\//i, "")
    .trim();
}

function normToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprintHash(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

/**
 * Machine-extract Evidence Object from verify failure text.
 */
function extractEvidenceObject(evidenceText, meta = {}) {
  const text = String(evidenceText || "");
  const classified = classifyVerifyFailure(text) || {};
  const failedStage =
    meta.failedStage ||
    (/failedStage=([^\s]+)/.exec(text) || [])[1] ||
    classified.failedStage ||
    null;
  const errorClass =
    meta.failure_class ||
    meta.error_class ||
    classified.class ||
    classified.failureClass ||
    classified.errorClass ||
    (/failure_class=([^\s]+)/.exec(text) || [])[1] ||
    (/AssertionError/i.test(text)
      ? "assertion"
      : /ImportError|ModuleNotFoundError/i.test(text)
        ? "import"
        : "other");

  const tests = [...text.matchAll(/(?:ERROR|FAIL):\s+([\w_.]+)/g)].map((m) => m[1]);
  const testNames = [...text.matchAll(/\btest_[a-z0-9_]+\b/gi)].map((m) => m[0]);
  const stackFiles = [...text.matchAll(/File "([^"]+\.py)", line (\d+)/g)].map((m) => ({
    file: normPath(m[1]),
    line: Number(m[2]) || null,
  }));
  const inFuncs = [...text.matchAll(/\bin ([A-Za-z_][\w]*)\b/g)].map((m) => m[1]);
  const asserts = [...text.matchAll(/AssertionError[^\n]{0,160}/g)].map((m) => m[0]);

  const symbols = [
    ...new Set([...tests, ...testNames, ...inFuncs].map(normToken).filter((s) => s.length >= 3)),
  ];
  const files = [...new Set(stackFiles.map((s) => s.file).filter(Boolean))];
  const file_lines = [
    ...new Set(stackFiles.filter((s) => s.file && s.line).map((s) => `${s.file}:${s.line}`)),
  ];

  return {
    failed_stage: failedStage,
    error_class: String(errorClass || "other"),
    anchors: {
      symbols,
      files,
      file_lines,
      assertion_snips: asserts.slice(0, 6),
    },
    source_fingerprint: fingerprintHash(text.slice(0, 8000)),
    evidenceTextPreview: text.slice(0, 2000),
  };
}

function parseLocus(locus) {
  const raw = String(locus || "").trim();
  if (!raw) return { file: null, line: null, symbol: null, ok: false };
  let file = null;
  let line = null;
  let symbol = null;
  const colonColon = raw.split("::");
  if (colonColon.length >= 2) {
    file = normPath(colonColon[0]);
    symbol = colonColon[colonColon.length - 1].replace(/\(.*$/, "").trim();
  } else {
    const m = raw.match(/^([^:]+?)(?::(\d+))?(?::([\w.]+))?$/);
    if (m) {
      file = normPath(m[1]);
      line = m[2] ? Number(m[2]) : null;
      symbol = m[3] || null;
    } else {
      file = normPath(raw);
    }
  }
  if (!file || !/\.\w+$/.test(file.split(":")[0])) {
    if (!/\.py$/i.test(raw) && !raw.includes("/")) {
      return { file: null, line: null, symbol: normToken(raw), ok: false };
    }
  }
  const fileOnly = file ? file.split(":")[0] : null;
  const base = fileOnly ? path.posix.basename(fileOnly).replace(/\.py$/i, "") : null;
  return {
    file: fileOnly,
    line,
    symbol: symbol ? normToken(symbol) : null,
    base: base ? normToken(base) : null,
    ok: Boolean(fileOnly && /\.\w+$/.test(fileOnly)),
  };
}

function stageMatch(claimed, actual) {
  const a = normToken(claimed);
  const b = normToken(actual);
  if (!b || b === "-" || b === "null" || b === "unknown") {
    return !a || a === "-" || a === "unknown" || a === "none";
  }
  if (!a) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function classMatch(claimed, actual) {
  const a = normToken(claimed).replace(/error_?class|failure_?class/g, "").trim();
  const b = normToken(actual);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function validatePatchBinding(record, evidence, opts = {}) {
  const errors = [];
  if (!evidence) {
    return { ok: false, code: "BINDING_MALFORMED", errors: ["no_open_evidence"] };
  }
  const evidenceId = String(record.evidence_id || record.evidenceId || "").trim();
  const failedStage = record.failed_stage || record.failedStage;
  const errorClass = record.error_class || record.errorClass || record.failure_class;
  const intendedLocus = record.intended_locus || record.intendedLocus || "";
  const supersedes = String(record.supersedes_prior || record.supersedesPrior || "").trim();
  const depEdge = String(record.dependency_edge || record.dependencyEdge || "")
    .trim()
    .toLowerCase();

  if (!evidenceId || evidenceId !== evidence.evidence_id) {
    errors.push("evidence_id_mismatch");
  }
  if (!stageMatch(failedStage, evidence.failed_stage)) {
    errors.push("failed_stage_mismatch");
  }
  if (!classMatch(errorClass, evidence.error_class)) {
    errors.push("error_class_mismatch");
  }
  const locus = parseLocus(intendedLocus);
  if (!locus.ok) {
    errors.push("intended_locus_not_path_shaped");
  }
  if (opts.requireSupersede) {
    const norm = normToken(supersedes);
    if (!norm) errors.push("supersedes_prior_required");
    else if (opts.prevSupersedeNorm && norm === opts.prevSupersedeNorm) {
      errors.push("supersedes_prior_unchanged");
    }
  }
  if (depEdge && !["caller", "callee", "import", "helper"].includes(depEdge)) {
    errors.push("dependency_edge_invalid");
  }

  return {
    ok: errors.length === 0,
    code: errors.length === 0 ? "BINDING_VALID" : "BINDING_MALFORMED",
    errors,
    locus,
    fields: {
      evidence_id: evidenceId,
      failed_stage: failedStage || null,
      error_class: errorClass || null,
      intended_locus: String(intendedLocus),
      supersedes_prior: supersedes,
      dependency_edge: depEdge || null,
    },
  };
}

function noteVerifyFailureForBind(state, evidenceText, meta = {}) {
  if (!state?.enabled) return null;
  state.pending = true;
  state.validOpen = false;
  state.lastBinding = null;
  state.evidenceSeq += 1;
  const extracted = extractEvidenceObject(evidenceText, meta);
  const evidence = {
    evidence_id: `ev_${state.evidenceSeq}_${extracted.source_fingerprint}`,
    seq: state.evidenceSeq,
    at: new Date().toISOString(),
    ...extracted,
  };
  state.openEvidence = evidence;
  state.evidences.push(evidence);
  writeEvidenceArtifact(state, evidence);
  return evidence;
}

function noteApplyAttempt(state, { afterFail }) {
  if (!state?.enabled) return;
  if (afterFail) state.applyCountAfterFail += 1;
  else state.applyCountBeforeFail += 1;
}

function epbBlocksApply(state) {
  return Boolean(state?.enabled && state.pending && state.openEvidence && !state.validOpen);
}

function checkApplyBindingGate(state) {
  if (!state?.enabled) return { allow: true, code: null };
  if (!state.pending || !state.openEvidence) return { allow: true, code: null };
  state.gatedApplyAttempts += 1;
  if (!state.validOpen || !state.lastBinding) {
    state.bindingMissing += 1;
    const entry = {
      at: new Date().toISOString(),
      code: "BINDING_MISSING",
      evidence_id: state.openEvidence.evidence_id,
    };
    state.rejectLog.push(entry);
    writeRejects(state);
    return {
      allow: false,
      code: "BINDING_MISSING",
      error:
        "BINDING_MISSING: call record_patch_binding with evidence_id/failed_stage/error_class/intended_locus before apply_patch.",
    };
  }
  return { allow: true, code: "BINDING_VALID" };
}

function submitPatchBinding(state, record) {
  if (!state?.enabled) {
    return { ok: false, code: "BINDING_MALFORMED", error: "evidence_patch_bind_disabled" };
  }
  if (!state.pending || !state.openEvidence) {
    return {
      ok: false,
      code: "BINDING_MALFORMED",
      error: "no_open_evidence — verify failure required before record_patch_binding",
    };
  }
  const requireSupersede = state.applyCountAfterFail > 0;
  const checked = validatePatchBinding(record, state.openEvidence, {
    requireSupersede,
    prevSupersedeNorm: state.lastIntendedNorm,
  });
  state.bindingSeq += 1;
  const entry = {
    seq: state.bindingSeq,
    at: new Date().toISOString(),
    code: checked.code,
    ok: checked.ok,
    errors: checked.errors,
    fields: checked.fields,
    locus: checked.locus,
    evidence_id: state.openEvidence.evidence_id,
    DB1: checked.ok,
    DB2: null,
    DB2_level: null,
    DB3: requireSupersede ? Boolean(checked.fields?.supersedes_prior) && checked.ok : null,
    DB4: null,
  };

  if (!checked.ok) {
    state.bindingMalformed += 1;
    state.validOpen = false;
    state.rejectLog.push({
      seq: state.bindingSeq,
      code: "BINDING_MALFORMED",
      errors: checked.errors,
      at: entry.at,
    });
    writeBindingArtifact(state, entry);
    writeRejects(state);
    return {
      ok: false,
      code: "BINDING_MALFORMED",
      error: `BINDING_MALFORMED: ${checked.errors.join(",")}`,
      entry,
    };
  }

  state.bindingValid += 1;
  state.validOpen = true;
  state.lastBinding = entry;
  state.lastIntendedNorm = normToken(
    checked.fields.supersedes_prior || checked.fields.intended_locus
  );
  state.bindings.push(entry);
  writeBindingArtifact(state, entry);
  return { ok: true, code: "BINDING_VALID", entry };
}

function scoreDb2(binding, evidence, patchFiles = []) {
  if (!binding?.locus || !evidence?.anchors) {
    return { pass: false, level: null };
  }
  const locus = binding.locus;
  const syms = new Set((evidence.anchors.symbols || []).map(normToken));
  const files = new Set((evidence.anchors.files || []).map(normPath));
  const patchNorm = (patchFiles || []).map(normPath);
  const raw = normToken(binding.fields?.intended_locus || "");

  const locusSyms = [locus.symbol, locus.base].filter(Boolean).map(normToken);
  if (locusSyms.some((s) => s && syms.has(s))) {
    return { pass: true, level: 1 };
  }
  for (const s of syms) {
    if (s.length >= 4 && raw.includes(s)) return { pass: true, level: 1 };
  }

  const locusFile = locus.file ? normPath(locus.file) : null;
  if (
    locusFile &&
    [...files].some((f) => f === locusFile || f.endsWith(locusFile) || locusFile.endsWith(f))
  ) {
    return { pass: true, level: 2 };
  }
  for (const pf of patchNorm) {
    if ([...files].some((f) => f === pf || f.endsWith(pf) || pf.endsWith(f))) {
      return { pass: true, level: 2 };
    }
  }

  const edge = binding.fields?.dependency_edge;
  const evMain = [...files][0] || null;
  const changeFile = locusFile || patchNorm[0] || null;
  if (edge && evMain && changeFile) {
    const same =
      normPath(evMain) === normPath(changeFile) ||
      normPath(evMain).endsWith(normPath(changeFile)) ||
      normPath(changeFile).endsWith(normPath(evMain));
    if (!same) {
      const parentEv = path.posix.dirname(normPath(evMain));
      const parentCh = path.posix.dirname(normPath(changeFile));
      const sameParent = parentEv && parentCh && parentEv === parentCh;
      const relatedHit =
        raw.includes(normToken(evMain)) || raw.includes(normToken(path.posix.basename(evMain)));
      if (sameParent || relatedHit) {
        return { pass: true, level: 3 };
      }
    }
  }

  return { pass: false, level: null };
}

function notePatchAfterBinding(state, patchText, files) {
  if (!state?.enabled || !state.lastBinding || !state.openEvidence) return null;
  const db2 = scoreDb2(state.lastBinding, state.openEvidence, files);
  state.lastBinding.DB2 = db2.pass;
  state.lastBinding.DB2_level = db2.level;
  state.lastBinding.DB4 = state.applyCountAfterFail >= 1;
  state.lastBinding.patch_files = Array.isArray(files) ? files : [];
  state.lastBinding.patch_preview = String(patchText || "").slice(0, 500);
  state.validUsedOnApply += 1;
  state.cycles.push({ ...state.lastBinding });
  writeBindingArtifact(state, state.lastBinding);

  state.pending = false;
  state.validOpen = false;
  return state.lastBinding;
}

function writeEvidenceArtifact(state, evidence) {
  if (!state.artifactDir) return;
  ensureDir(state.artifactDir);
  const name = `evidence_${String(evidence.seq).padStart(2, "0")}.json`;
  fs.writeFileSync(path.join(state.artifactDir, name), JSON.stringify(evidence, null, 2), "utf8");
}

function writeBindingArtifact(state, entry) {
  if (!state.artifactDir || !entry) return;
  ensureDir(state.artifactDir);
  const name = `binding_${String(entry.seq).padStart(2, "0")}.json`;
  fs.writeFileSync(path.join(state.artifactDir, name), JSON.stringify(entry, null, 2), "utf8");
}

function writeRejects(state) {
  if (!state.artifactDir) return;
  ensureDir(state.artifactDir);
  fs.writeFileSync(
    path.join(state.artifactDir, "gate_rejects.jsonl"),
    state.rejectLog.map((r) => JSON.stringify(r)).join("\n") +
      (state.rejectLog.length ? "\n" : ""),
    "utf8"
  );
}

function db0Rate(state) {
  const denom = state.gatedApplyAttempts || 0;
  if (!denom) return null;
  return state.validUsedOnApply / denom;
}

function evidencePatchBindSummary(state) {
  if (!state) return null;
  const cycles = state.cycles || [];
  return {
    enabled: Boolean(state.enabled),
    pending: Boolean(state.pending),
    validOpen: Boolean(state.validOpen),
    openEvidenceId: state.openEvidence?.evidence_id || null,
    gated_apply_attempts: state.gatedApplyAttempts,
    binding_missing: state.bindingMissing,
    binding_malformed: state.bindingMalformed,
    binding_valid: state.bindingValid,
    valid_used_on_apply: state.validUsedOnApply,
    apply_before_fail: state.applyCountBeforeFail,
    apply_after_fail: state.applyCountAfterFail,
    second_apply_after_fail: state.applyCountAfterFail >= 1,
    DB0: db0Rate(state),
    DB1_any: cycles.some((c) => c.DB1 === true) || state.bindingValid > 0,
    DB2_any: cycles.some((c) => c.DB2 === true),
    DB3_any: cycles.some((c) => c.DB3 === true),
    DB4_any: cycles.some((c) => c.DB4 === true),
    cycles,
    rejectLog: state.rejectLog.slice(-30),
    artifactDir: state.artifactDir || null,
  };
}

function buildEpbGateUserMessage(state) {
  if (!state?.enabled || !state.pending || !state.openEvidence) return "";
  const ev = state.openEvidence;
  const needSuper = state.applyCountAfterFail > 0;
  return [
    "[Evidence-to-Patch Binding gate]",
    "Before apply_patch: call record_patch_binding with:",
    `- evidence_id=${ev.evidence_id}`,
    `- failed_stage=${ev.failed_stage || "-"} (must match)`,
    `- error_class=${ev.error_class || "-"} (must match)`,
    "- intended_locus (path-shaped: file.py or file.py:line or file.py::symbol)",
    needSuper
      ? "- supersedes_prior (required: why abandoning prior fail-path apply)"
      : "- supersedes_prior (optional on first post-fail apply)",
    "- dependency_edge optional: caller|callee|import|helper",
    ev.anchors?.files?.length ? `Evidence files: ${ev.anchors.files.slice(0, 4).join(", ")}` : "",
    ev.anchors?.symbols?.length
      ? `Evidence symbols: ${ev.anchors.symbols.slice(0, 6).join(", ")}`
      : "",
    "No binding → BINDING_MISSING (apply blocked). Invalid fields → BINDING_MALFORMED.",
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  isEvidencePatchBindEnabled,
  createEvidencePatchBindState,
  extractEvidenceObject,
  parseLocus,
  validatePatchBinding,
  noteVerifyFailureForBind,
  noteApplyAttempt,
  epbBlocksApply,
  checkApplyBindingGate,
  submitPatchBinding,
  scoreDb2,
  notePatchAfterBinding,
  evidencePatchBindSummary,
  buildEpbGateUserMessage,
  stageMatch,
  classMatch,
};
