/**
 * mogu.memory — 轻量本地记忆（JSON），跨会话偏好/事实；不绑死 Mem0/Letta 运行时
 */

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

function memoryPath(deps) {
  const root = deps.userDataPath || path.join(process.cwd(), ".mogu-userdata");
  return path.join(root, "memory", "facts.json");
}

async function loadStore(deps) {
  const file = memoryPath(deps);
  if (!(await fs.pathExists(file))) {
    return { schemaVersion: 1, facts: [] };
  }
  try {
    const data = await fs.readJson(file);
    if (!Array.isArray(data.facts)) data.facts = [];
    return data;
  } catch {
    return { schemaVersion: 1, facts: [] };
  }
}

async function saveStore(deps, store) {
  const file = memoryPath(deps);
  await fs.ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeJson(tmp, store, { spaces: 2 });
  await fs.move(tmp, file, { overwrite: true });
}

function scoreFact(fact, query) {
  const q = String(query || "")
    .toLowerCase()
    .trim();
  if (!q) return 1;
  const hay = `${fact.key || ""} ${fact.value || ""} ${(fact.tags || []).join(" ")}`.toLowerCase();
  if (hay.includes(q)) return 10;
  const parts = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const p of parts) {
    if (hay.includes(p)) score += 2;
  }
  return score;
}

async function status({ deps }) {
  const store = await loadStore(deps);
  return {
    ok: true,
    count: store.facts.length,
    path: memoryPath(deps),
    backend: "local_json",
  };
}

async function preflight({ deps }) {
  try {
    await fs.ensureDir(path.dirname(memoryPath(deps)));
    return { ok: true, issues: [], path: memoryPath(deps) };
  } catch (error) {
    return { ok: false, issues: [{ code: "memory_path", message: error.message }] };
  }
}

async function remember({ deps, args }) {
  const key = String(args?.key || args?.topic || "").trim();
  const value = String(args?.value || args?.text || args?.content || "").trim();
  if (!value) return { ok: false, error: "缺少 value", code: "value_empty" };
  const store = await loadStore(deps);
  const id = String(args?.id || crypto.randomBytes(6).toString("hex"));
  const now = new Date().toISOString();
  const tags = Array.isArray(args?.tags)
    ? args.tags.map(String)
    : String(args?.tags || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const existingIdx = key ? store.facts.findIndex((f) => f.key === key) : -1;
  const fact = {
    id: existingIdx >= 0 ? store.facts[existingIdx].id : id,
    key: key || `note-${id}`,
    value,
    tags,
    updatedAt: now,
    createdAt: existingIdx >= 0 ? store.facts[existingIdx].createdAt || now : now,
  };
  if (existingIdx >= 0) store.facts[existingIdx] = fact;
  else store.facts.push(fact);
  // Cap store size
  if (store.facts.length > 500) {
    store.facts = store.facts.slice(-500);
  }
  await saveStore(deps, store);
  return { ok: true, fact, count: store.facts.length };
}

async function recall({ deps, args }) {
  const query = String(args?.query || args?.q || args?.text || args?.key || "").trim();
  const limit = Math.min(20, Math.max(1, Number(args?.limit) || 5));
  const store = await loadStore(deps);
  const ranked = store.facts
    .map((f) => ({ fact: f, score: scoreFact(f, query) }))
    .filter((x) => (query ? x.score > 0 : true))
    .sort((a, b) => b.score - a.score || String(b.fact.updatedAt).localeCompare(String(a.fact.updatedAt)))
    .slice(0, limit)
    .map((x) => x.fact);
  return {
    ok: true,
    query,
    facts: ranked,
    answer: ranked.map((f) => `${f.key}: ${f.value}`).join("\n"),
  };
}

async function list({ deps, args }) {
  const store = await loadStore(deps);
  const limit = Math.min(100, Math.max(1, Number(args?.limit) || 50));
  const facts = store.facts.slice(-limit).reverse();
  return { ok: true, facts, count: store.facts.length };
}

async function forget({ deps, args }) {
  const id = String(args?.id || "").trim();
  const key = String(args?.key || "").trim();
  if (!id && !key) return { ok: false, error: "缺少 id 或 key", code: "id_missing" };
  const store = await loadStore(deps);
  const before = store.facts.length;
  store.facts = store.facts.filter((f) => {
    if (id && f.id === id) return false;
    if (key && f.key === key) return false;
    return true;
  });
  await saveStore(deps, store);
  return { ok: true, removed: before - store.facts.length, count: store.facts.length };
}

module.exports = {
  id: "mogu.memory",
  status,
  preflight,
  remember,
  recall,
  list,
  forget,
  run: remember,
  memoryPath,
};
