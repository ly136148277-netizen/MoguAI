const crypto = require("node:crypto");

const STATUS = Object.freeze({ OK: "OK", BLOCKED: "BLOCKED" });
const DEFAULT_MAX_BYTES = 128 * 1024;
const DEFAULT_MAX_TOKENS = 24_000;
const SECRET_KEY = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|credential)/i;
const SECRET_VALUE = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi,
  /([?&](?:token|key|secret|password)=)[^&#\s]+/gi,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}\b/gi,
];

function stableValue(value, seen = new WeakSet()) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => stableValue(item, seen));
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key], seen)])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function contentHash(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function redactString(value) {
  let text = String(value);
  for (const pattern of SECRET_VALUE) {
    text = text.replace(pattern, (match, prefix) =>
      prefix ? `${prefix}[REDACTED]` : "[REDACTED]"
    );
  }
  return text;
}

function redactSecrets(value, depth = 0, seen = new WeakSet()) {
  if (depth > 24) return "[DEPTH_LIMIT]";
  if (typeof value === "string") return redactString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1, seen));
  }
  const output = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = SECRET_KEY.test(key)
      ? "[REDACTED]"
      : redactSecrets(value[key], depth + 1, seen);
  }
  return output;
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : stableStringify(value), "utf8");
}

// This is deliberately conservative metadata, not a provider-tokenizer count.
function estimateTokens(value, bytesPerToken = 3) {
  return Math.ceil(byteLength(value) / Math.max(1, Number(bytesPerToken) || 3));
}

function normalizeSection(section, index) {
  const content = redactSecrets(section?.content ?? section?.value ?? "");
  const type = String(section?.type || section?.kind || "evidence");
  const id = String(section?.id || `${type}:${index}`);
  return {
    id,
    type,
    priority: Number.isFinite(Number(section?.priority)) ? Number(section.priority) : 0,
    required: section?.required === true,
    content,
    hash: contentHash(content),
    originalIndex: index,
  };
}

function truncateContent(content, maxBytes) {
  if (maxBytes <= 0) return null;
  if (byteLength(content) <= maxBytes) return content;
  const marker = "\n[TRUNCATED]";
  const markerBytes = byteLength(marker);
  if (maxBytes <= markerBytes) return null;
  const source = typeof content === "string" ? content : stableStringify(content);
  let low = 0;
  let high = source.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength(source.slice(0, mid)) + markerBytes <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return `${source.slice(0, low)}${marker}`;
}

function assembleContext(input = {}, options = {}) {
  const configuredSections = Array.isArray(input)
    ? input
    : Array.isArray(input.sections)
      ? input.sections
      : [
          { type: "user-goal", content: input.userGoal, priority: 1000, required: true },
          { type: "recent-history", content: input.recentHistory, priority: 850 },
          { type: "digested-history", content: input.digestedHistory, priority: 700 },
          { type: "memory", content: input.memory, priority: 750 },
          { type: "project-rules", content: input.projectRules, priority: 950, required: true },
          { type: "neural-plan", content: input.neuralPlan, priority: 900 },
          { type: "repo-evidence", content: input.repoEvidence, priority: 800 },
          { type: "lsp-evidence", content: input.lspEvidence, priority: 790 },
          { type: "tool-result", content: input.toolResults, priority: 780 },
        ].filter((section) => section.content != null && section.content !== "");
  const maxBytes = Math.max(1, Number(options.maxBytes ?? input.maxBytes) || DEFAULT_MAX_BYTES);
  const maxEstimatedTokens = Math.max(
    1,
    Number(options.maxEstimatedTokens ?? input.maxEstimatedTokens) || DEFAULT_MAX_TOKENS
  );
  const bytesPerToken = Math.max(1, Number(options.bytesPerToken ?? input.bytesPerToken) || 3);
  const tokenByteCap = maxEstimatedTokens * bytesPerToken;
  const hardCap = Math.min(maxBytes, tokenByteCap);
  const normalized = configuredSections
    .map(normalizeSection)
    .filter((section) => section.content != null && section.content !== "");
  const seen = new Set();
  const unique = [];
  const evicted = [];
  for (const section of normalized) {
    if (seen.has(section.hash)) {
      evicted.push({ ...section, reason: "DUPLICATE" });
    } else {
      seen.add(section.hash);
      unique.push(section);
    }
  }
  unique.sort(
    (a, b) =>
      Number(b.required) - Number(a.required) ||
      b.priority - a.priority ||
      a.originalIndex - b.originalIndex
  );

  const selected = [];
  let usedBytes = 0;
  for (const section of unique) {
    const fullBytes = byteLength(section.content);
    const available = hardCap - usedBytes;
    if (fullBytes <= available) {
      selected.push({ ...section, bytes: fullBytes, truncated: false });
      usedBytes += fullBytes;
      continue;
    }
    if (section.required) {
      evicted.push({ ...section, reason: "REQUIRED_OVERFLOW" });
      return {
        status: STATUS.BLOCKED,
        ok: false,
        code: "REQUIRED_CONTEXT_OVERFLOW",
        reason: {
          code: "REQUIRED_CONTEXT_OVERFLOW",
          message: `Required context section ${section.id} cannot fit the configured budget`,
          sectionId: section.id,
          sectionHash: section.hash,
        },
        selected,
        evicted,
        bytes: usedBytes,
        maxBytes,
        estimatedTokens: Math.ceil(usedBytes / bytesPerToken),
        tokenEstimate: "conservative",
      };
    }
    const truncated = truncateContent(section.content, available);
    if (truncated != null && byteLength(truncated) > 0) {
      const bytes = byteLength(truncated);
      selected.push({
        ...section,
        content: truncated,
        bytes,
        truncated: true,
        reason: "BUDGET_TRUNCATED",
        originalHash: section.hash,
        hash: contentHash(truncated),
      });
      evicted.push({ ...section, reason: "PARTIALLY_TRUNCATED", retainedBytes: bytes });
      usedBytes += bytes;
      continue;
    }
    evicted.push({ ...section, reason: "BUDGET_EVICTED" });
  }
  return {
    status: STATUS.OK,
    ok: true,
    selected,
    evicted,
    bytes: usedBytes,
    maxBytes,
    estimatedTokens: Math.ceil(usedBytes / bytesPerToken),
    maxEstimatedTokens,
    tokenEstimate: "conservative",
    hash: contentHash(selected.map(({ type, content, priority, required }) => ({
      type,
      content,
      priority,
      required,
    }))),
  };
}

function budgetMessages(messages, options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const lastUser = list.reduce((found, message, index) => message?.role === "user" ? index : found, -1);
  const sections = list.map((message, index) => ({
    id: `message:${index}`,
    type:
      message?.role === "system"
        ? "system"
        : index === lastUser
          ? "user-goal"
          : message?.role === "tool"
            ? "tool-result"
            : "history",
    priority:
      message?.role === "system" ? 1000 : index === lastUser ? 990 : 100 + index,
    required: message?.role === "system" || index === lastUser,
    content: message,
  }));
  const result = assembleContext(sections, options);
  return {
    ...result,
    messages: result.status === STATUS.OK
      ? result.selected
          .sort((a, b) => a.originalIndex - b.originalIndex)
          .map((section) => section.content)
      : null,
  };
}

class ContextBudget {
  constructor(options = {}) {
    this.options = { ...options };
  }
  assemble(input, options = {}) {
    return assembleContext(input, { ...this.options, ...options });
  }
  messages(input, options = {}) {
    return budgetMessages(input, { ...this.options, ...options });
  }
}

module.exports = {
  STATUS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_TOKENS,
  ContextBudget,
  assembleContext,
  assemble: assembleContext,
  budgetMessages,
  redactSecrets,
  stableStringify,
  contentHash,
  estimateTokens,
  byteLength,
};
