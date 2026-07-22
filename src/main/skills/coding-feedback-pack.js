/**
 * Feedback-B: P1–P3 failure feedback packaging (presentation quality only).
 * Enable with MOGU_FEEDBACK_PACK=1 or opts.feedbackPack=true.
 *
 * Does NOT expand verify coverage, force retry (D2), or hypothesis diversity (D2′).
 * Boundary: tests information presentation quality, not information availability.
 */

const fs = require("fs");
const path = require("path");
const { classifyVerifyFailure, normalizeHypothesis } = require("./coding-d2-retry");
const { jaccardPatch, sameFileSet } = require("./coding-d2-diversity");

const HEAD_CHARS = 2500;
const TAIL_CHARS = 2500;
const MAX_VISIBLE = 7000;

const TEMPLATES = Object.freeze({
  test_failure: "test_failure",
  action_error: "action_error",
  infra_failure: "infra_failure",
});

function isFeedbackPackEnabled(opts = {}) {
  if (opts.feedbackPack === true) return true;
  if (opts.feedbackPack === false) return false;
  const v = String(process.env.MOGU_FEEDBACK_PACK || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function createFeedbackPackState(opts = {}) {
  const enabled = isFeedbackPackEnabled(opts);
  const artifactDir = String(
    opts.feedbackPackDir || process.env.MOGU_FEEDBACK_PACK_DIR || ""
  ).trim();
  return {
    enabled,
    artifactDir,
    packCount: 0,
    lastPack: null,
    events: [],
    fullLogReads: 0,
    hypothesisCitesFeedback: null,
    hypothesisTextChanged: null,
    lastHypothesisNorm: null,
    jaccardVsPrev: null,
    fileSetChanged: null,
    lastPatch: null,
    lastFiles: null,
    stackAnchorChanged: null,
    lastAnchorKey: null,
    hasStatusPrefix: false,
    hasElideMarker: false,
    lastFailureClass: null,
    lastTemplate: null,
    lastFullLogPath: null,
  };
}

/**
 * P3 template: test failure / action error / infra failure.
 * @param {string} raw
 * @param {{ toolName?: string }} [ctx]
 */
function classifyFeedbackTemplate(raw, ctx = {}) {
  const text = String(raw || "");
  const tool = String(ctx.toolName || "").trim();
  if (
    text.startsWith("NO_VERIFY") ||
    /\bkind=env\b/i.test(text) ||
    /host env missing deps/i.test(text) ||
    /strict docker verify requires/i.test(text) ||
    /docker.*(missing|pull|not found)/i.test(text)
  ) {
    return TEMPLATES.infra_failure;
  }
  if (
    tool === "apply_patch" ||
    tool === "set_plan" ||
    text.startsWith("ERROR:") ||
    /B2-D2 gate/i.test(text) ||
    /补丁已应用但工作区无改动|noop|empty patch/i.test(text)
  ) {
    return TEMPLATES.action_error;
  }
  return TEMPLATES.test_failure;
}

function extractReturncode(text) {
  const m =
    /returncode[=:\s]+(-?\d+)/i.exec(text) ||
    /exit(?:\s*code)?[=:\s]+(-?\d+)/i.exec(text) ||
    /Process exited with code\s+(-?\d+)/i.exec(text);
  if (m) return Number(m[1]);
  if (/\bok=true\b/.test(text)) return 0;
  if (/\bok=false\b/.test(text) || text.startsWith("ERROR:") || text.startsWith("NO_VERIFY")) {
    return 1;
  }
  return null;
}

function extractOk(text) {
  if (text.startsWith("NO_VERIFY")) return false;
  if (text.startsWith("ERROR:")) return false;
  if (/\bok=true\b/.test(text)) return true;
  if (/\bok=false\b/.test(text)) return false;
  return null;
}

/**
 * P2: keep head + tail; insert explicit elide marker (never silent truncate).
 */
function headTailWithElide(text, head = HEAD_CHARS, tail = TAIL_CHARS) {
  const s = String(text || "");
  if (s.length <= head + tail) {
    return { body: s, elided: 0, headTail: false };
  }
  const elided = s.length - head - tail;
  const marker = `\n...[elided ${elided} chars; full log on disk if path given]...\n`;
  return {
    body: `${s.slice(0, head)}${marker}${s.slice(-tail)}`,
    elided,
    headTail: true,
  };
}

function templateGuidance(template, failureClass) {
  switch (template) {
    case TEMPLATES.infra_failure:
      return [
        "NEXT: this is infrastructure / verify availability — do not invent a code fix from missing deps.",
        "Prefer confirming Docker/SWE verify; avoid treating NO_VERIFY or soft env skip as test pass.",
      ].join("\n");
    case TEMPLATES.action_error:
      return [
        "NEXT: tool/action error (not a test assertion). Fix the tool call or plan targets, then retry the action.",
        "Do not assume the previous patch landed unless dirty=true / apply ok is explicit.",
      ].join("\n");
    default:
      return [
        `NEXT: test failure (class=${failureClass || "other"}). Read failedStage + assertion/stack (esp. tail).`,
        "Update set_plan hypothesis from this evidence, then apply_patch, then run_tests.",
      ].join("\n");
  }
}

/**
 * Build model-visible Feedback Pack from raw tool output.
 * @returns {{ visible: string, fullText: string, meta: object }}
 */
function formatFeedbackPack(rawOut, opts = {}) {
  const fullText = String(rawOut || "");
  const template = classifyFeedbackTemplate(fullText, { toolName: opts.toolName });
  const classified = classifyVerifyFailure(fullText);
  const failureClass =
    template === TEMPLATES.action_error && classified.class === "other"
      ? /noop|empty patch|无改动/i.test(fullText)
        ? "apply_noop"
        : "action_error"
      : template === TEMPLATES.infra_failure
        ? "infra"
        : classified.class;
  const ok = extractOk(fullText);
  const failedStage =
    (/failedStage=([^\s]+)/.exec(fullText) || [])[1] || classified.failedStage || "-";
  const returncode = extractReturncode(fullText);
  const seq = Number(opts.seq) > 0 ? Number(opts.seq) : 1;
  const fullLogPath = String(opts.fullLogPath || "").trim() || null;

  const { body, elided, headTail } = headTailWithElide(fullText);
  const statusLines = [
    "FEEDBACK_PACK",
    `ok=${ok === null ? "unknown" : ok}`,
    `failedStage=${failedStage}`,
    `returncode=${returncode === null ? "unknown" : returncode}`,
    `failure_class=${failureClass}`,
    `template=${template}`,
    fullLogPath ? `full_log_path=${fullLogPath}` : "full_log_path=-",
    elided > 0 ? `elided_chars=${elided}` : "elided_chars=0",
  ];

  let visible = [
    statusLines.join("\n"),
    "",
    "### Evidence",
    body,
    "",
    "### Guidance",
    templateGuidance(template, failureClass),
  ].join("\n");

  if (visible.length > MAX_VISIBLE) {
    const keep = MAX_VISIBLE - 80;
    const half = Math.floor(keep / 2);
    visible = `${visible.slice(0, half)}\n...[elided ${visible.length - keep} chars in pack]...\n${visible.slice(-half)}`;
  }

  const meta = {
    enabled: true,
    seq,
    ok,
    failedStage: failedStage === "-" ? null : failedStage,
    returncode,
    failure_class: failureClass,
    template,
    has_status_prefix: visible.startsWith("FEEDBACK_PACK"),
    has_elide_marker: /\[elided \d+ chars/.test(visible),
    head_tail: headTail || /\[elided \d+ chars/.test(visible),
    elided_chars: elided,
    full_log_path: fullLogPath,
    toolName: opts.toolName || null,
  };

  return { visible, fullText, meta };
}

function ensureDir(dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

function writeFeedbackArtifacts(state, pack) {
  if (!state?.enabled || !state.artifactDir || !pack) return null;
  ensureDir(state.artifactDir);
  const lastPath = path.join(state.artifactDir, "last_verify.txt");
  const fullPath = path.join(state.artifactDir, "full_log.txt");
  const metaPath = path.join(state.artifactDir, "meta.json");
  fs.writeFileSync(lastPath, pack.visible, "utf8");
  fs.writeFileSync(fullPath, pack.fullText, "utf8");
  fs.writeFileSync(metaPath, JSON.stringify(pack.meta, null, 2), "utf8");
  const seqDir = path.join(state.artifactDir, `pack_${String(pack.meta.seq).padStart(2, "0")}`);
  ensureDir(seqDir);
  fs.writeFileSync(path.join(seqDir, "last_verify.txt"), pack.visible, "utf8");
  fs.writeFileSync(path.join(seqDir, "full_log.txt"), pack.fullText, "utf8");
  fs.writeFileSync(path.join(seqDir, "meta.json"), JSON.stringify(pack.meta, null, 2), "utf8");
  return { lastPath, fullPath, metaPath, seqDir };
}

/**
 * Package raw tool output; update state; optionally rewrite full_log_path into pack.
 */
function applyFeedbackPack(state, rawOut, opts = {}) {
  if (!state?.enabled) {
    return { out: String(rawOut || ""), pack: null };
  }
  state.packCount += 1;
  const seq = state.packCount;
  const fullLogPath = state.artifactDir
    ? path.join(state.artifactDir, "full_log.txt")
    : null;
  const pack = formatFeedbackPack(rawOut, {
    toolName: opts.toolName,
    seq,
    fullLogPath,
  });
  writeFeedbackArtifacts(state, pack);
  state.lastPack = pack;
  state.hasStatusPrefix = Boolean(pack.meta.has_status_prefix);
  state.hasElideMarker = Boolean(pack.meta.has_elide_marker);
  state.lastFailureClass = pack.meta.failure_class;
  state.lastTemplate = pack.meta.template;
  state.lastFullLogPath = pack.meta.full_log_path;
  state.events.push({
    seq,
    toolName: opts.toolName || null,
    failure_class: pack.meta.failure_class,
    template: pack.meta.template,
    failedStage: pack.meta.failedStage,
    has_status_prefix: pack.meta.has_status_prefix,
    has_elide_marker: pack.meta.has_elide_marker,
    full_log_path: pack.meta.full_log_path,
  });
  return { out: pack.visible, pack };
}

function pathsMatchFeedbackLog(readPath, fullLogPath, artifactDir) {
  if (!readPath) return false;
  const a = path.resolve(String(readPath)).replace(/\\/g, "/").toLowerCase();
  if (fullLogPath) {
    const b = path.resolve(String(fullLogPath)).replace(/\\/g, "/").toLowerCase();
    if (a === b) return true;
  }
  if (artifactDir) {
    const root = path.resolve(String(artifactDir)).replace(/\\/g, "/").toLowerCase();
    if (a.startsWith(root.endsWith("/") ? root : `${root}/`) && a.endsWith("/full_log.txt")) {
      return true;
    }
  }
  return false;
}

function noteReadOfFullLog(state, readPath) {
  if (!state?.enabled || !state.lastFullLogPath) return false;
  if (!pathsMatchFeedbackLog(readPath, state.lastFullLogPath, state.artifactDir)) return false;
  state.fullLogReads += 1;
  return true;
}

function hypothesisCitesPack(plan, packMeta) {
  if (!plan || !packMeta) return false;
  const blob = normalizeHypothesis(
    [plan.hypothesis, plan.approach, ...(plan.target_files || [])].filter(Boolean).join(" ")
  );
  if (!blob) return false;
  const tokens = [];
  if (packMeta.failedStage) tokens.push(String(packMeta.failedStage).toLowerCase());
  if (packMeta.failure_class) tokens.push(String(packMeta.failure_class).toLowerCase());
  if (packMeta.template) tokens.push(String(packMeta.template).toLowerCase());
  tokens.push("fail_to_pass", "pass_to_pass", "assertionerror", "failedstage");
  return tokens.some((t) => {
    if (!t || t === "-") return false;
    return blob.includes(t) || blob.includes(t.replace(/_/g, " "));
  });
}

function notePlanAfterFeedback(state, plan) {
  if (!state?.enabled || !state.lastPack) return;
  const norm = normalizeHypothesis(plan?.hypothesis || "");
  const cites = hypothesisCitesPack(plan, state.lastPack.meta);
  state.hypothesisCitesFeedback =
    state.hypothesisCitesFeedback == null ? cites : state.hypothesisCitesFeedback || cites;
  if (state.lastHypothesisNorm != null && norm) {
    const changed = norm !== state.lastHypothesisNorm;
    state.hypothesisTextChanged =
      state.hypothesisTextChanged == null
        ? changed
        : state.hypothesisTextChanged || changed;
  }
  if (norm) state.lastHypothesisNorm = norm;
}

function notePatchAfterFeedback(state, patchText, files) {
  if (!state?.enabled) return;
  const patch = String(patchText || "");
  const fileList = Array.isArray(files) ? files : [];
  if (state.lastPatch != null) {
    state.jaccardVsPrev = jaccardPatch(patch, state.lastPatch);
    state.fileSetChanged =
      state.lastFiles != null ? !sameFileSet(fileList, state.lastFiles) : null;
  }
  state.lastPatch = patch;
  state.lastFiles = fileList;
}

function noteStackAnchor(state, anchor) {
  if (!state?.enabled || !anchor) return;
  const key = `${anchor.path || ""}:${anchor.line || ""}`;
  if (state.lastAnchorKey != null) {
    state.stackAnchorChanged =
      state.stackAnchorChanged == null
        ? key !== state.lastAnchorKey
        : state.stackAnchorChanged || key !== state.lastAnchorKey;
  }
  state.lastAnchorKey = key;
}

function feedbackPackSummary(state) {
  if (!state) return null;
  const last = state.lastPack?.meta || null;
  return {
    enabled: Boolean(state.enabled),
    packCount: state.packCount,
    has_status_prefix: Boolean(state.hasStatusPrefix || last?.has_status_prefix),
    has_elide_marker: Boolean(state.hasElideMarker || last?.has_elide_marker),
    head_tail: Boolean(last?.head_tail),
    failure_class: state.lastFailureClass || last?.failure_class || null,
    template: state.lastTemplate || last?.template || null,
    full_log_path: state.lastFullLogPath || last?.full_log_path || null,
    artifactDir: state.artifactDir || null,
    fullLogReads: state.fullLogReads,
    tools_read_full_log: state.fullLogReads > 0,
    hypothesis_cites_feedback: state.hypothesisCitesFeedback,
    hypothesis_text_changed: state.hypothesisTextChanged,
    jaccard_patch: state.jaccardVsPrev,
    file_set_changed: state.fileSetChanged,
    stack_anchor_changed: state.stackAnchorChanged,
    events: state.events.slice(-12),
  };
}

module.exports = {
  TEMPLATES,
  HEAD_CHARS,
  TAIL_CHARS,
  isFeedbackPackEnabled,
  createFeedbackPackState,
  classifyFeedbackTemplate,
  extractReturncode,
  headTailWithElide,
  formatFeedbackPack,
  writeFeedbackArtifacts,
  applyFeedbackPack,
  noteReadOfFullLog,
  notePlanAfterFeedback,
  notePatchAfterFeedback,
  noteStackAnchor,
  feedbackPackSummary,
  pathsMatchFeedbackLog,
  hypothesisCitesPack,
};
