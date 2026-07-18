/**
 * Renderer-safe TaskStore payloads (never leak tokens / secrets).
 */

const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|cookie|deviceToken)/i;

function stripSecrets(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => stripSecrets(item, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = stripSecrets(item, depth + 1);
  }
  return out;
}

function toPublicTask(task) {
  if (!task || typeof task !== "object") return null;
  return stripSecrets(task);
}

function toPublicTaskPage(page) {
  return {
    ok: true,
    schemaVersion: page?.schemaVersion ?? null,
    tasks: Array.isArray(page?.tasks) ? page.tasks.map(toPublicTask) : [],
    nextCursor: page?.nextCursor || null,
    hasMore: Boolean(page?.hasMore),
    total: Number(page?.total) || 0,
    limit: Number(page?.limit) || 0,
  };
}

module.exports = {
  toPublicTask,
  toPublicTaskPage,
  stripSecrets,
};
