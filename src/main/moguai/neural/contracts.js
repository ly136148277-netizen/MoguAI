const crypto = require("node:crypto");

const TASK_CLASSES = Object.freeze([
  "chat",
  "coding",
  "research",
  "creative-media",
  "pc-automation",
  "safety-sensitive",
]);
const COMPLEXITIES = Object.freeze(["low", "medium", "high"]);
const OUTCOMES = Object.freeze({
  SELECTED: "SELECTED",
  NEXT_CANDIDATE: "NEXT_CANDIDATE",
  BLOCKED: "BLOCKED",
  EXHAUSTED: "EXHAUSTED",
  NO_FALLBACK: "NO_FALLBACK",
});
const REASONS = Object.freeze({
  INVALID_PROFILE: "INVALID_PROFILE",
  DUPLICATE_PROFILE_ID: "DUPLICATE_PROFILE_ID",
  PROFILE_DISABLED: "PROFILE_DISABLED",
  UNSAFE_ENDPOINT: "UNSAFE_ENDPOINT",
  SECRET_VALUE_FORBIDDEN: "SECRET_VALUE_FORBIDDEN",
  MISSING_SECRET_REFERENCE: "MISSING_SECRET_REFERENCE",
  MISSING_CAPABILITY: "MISSING_CAPABILITY",
  MODEL_MISMATCH: "MODEL_MISMATCH",
  NOT_OWNER_ORDERED: "NOT_OWNER_ORDERED",
  POLICY_NOT_FOUND: "POLICY_NOT_FOUND",
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  FALLBACK_DISABLED: "FALLBACK_DISABLED",
  FALLBACK_EXHAUSTED: "FALLBACK_EXHAUSTED",
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  UNKNOWN_PRICE: "UNKNOWN_PRICE",
  LEDGER_CORRUPT: "LEDGER_CORRUPT",
  PATH_UNSAFE: "PATH_UNSAFE",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function configHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function reason(code, message, details = {}) {
  return deepFreeze({ code, message, ...details });
}

function blocked(code, message, details = {}) {
  return deepFreeze({
    status: OUTCOMES.BLOCKED,
    reason: reason(code, message, details),
  });
}

module.exports = {
  TASK_CLASSES,
  COMPLEXITIES,
  OUTCOMES,
  REASONS,
  isPlainObject,
  deepFreeze,
  canonicalize,
  configHash,
  reason,
  blocked,
};
