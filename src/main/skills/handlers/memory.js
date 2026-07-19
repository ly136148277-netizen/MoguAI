/**
 * mogu.memory — 分层本地记忆（preference / project / session）
 */

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

const LAYERS = Object.freeze(["preference", "project", "session"]);

function memoryPath(deps) {
  const root = deps.userDataPath || path.join(process.cwd(), ".mogu-userdata");
  return path.join(root, "memory", "facts.json");
}

function normalizeLayer(layer) {
  const l = String(layer || "project").toLowerCase();
  return LAYERS.includes(l) ? l : "project";
}

async function loadStore(deps) {
  const file = memoryPath(deps);
  if (!(await fs.pathExists(file))) {
    return { schemaVersion: 2, facts: [] };
  }
  try {
    const data = await fs.readJson(file);
    if (!Array.isArray(data.facts)) data.facts = [];
    data.schemaVersion = 2;
    for (const f of data.facts) {
      if (!f.layer) f.layer = "project";
    }
    return data;
  } catch {
    return { schemaVersion: 2, facts: [] };
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
  const hay = `${fact.key || ""} ${fact.value || ""} ${(fact.tags || []).join(" ")} ${fact.layer || ""}`.toLowerCase();
  if (hay.includes(q)) return 10;
  const parts = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const p of parts) {
    if (hay.includes(p)) score += 2;
  }
  // Prefer stable layers slightly when ranking
  if (fact.layer === "preference") score += 1;
  return score;
}

async function status({ deps }) {
  const store = await loadStore(deps);
  const byLayer = { preference: 0, project: 0, session: 0 };
  for (const f of store.facts) {
    const layer = normalizeLayer(f.layer);
    byLayer[layer] = (byLayer[layer] || 0) + 1;
  }
  return {
    ok: true,
    count: store.facts.length,
    byLayer,
    layers: LAYERS,
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
  const layer = normalizeLayer(args?.layer);
  const store = await loadStore(deps);
  const id = String(args?.id || crypto.randomBytes(6).toString("hex"));
  const now = new Date().toISOString();
  const tags = Array.isArray(args?.tags)
    ? args.tags.map(String)
    : String(args?.tags || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  if (!tags.includes(layer)) tags.push(layer);
  const existingIdx = key
    ? store.facts.findIndex((f) => f.key === key && normalizeLayer(f.layer) === layer)
    : -1;
  const fact = {
    id: existingIdx >= 0 ? store.facts[existingIdx].id : id,
    key: key || `note-${id}`,
    value,
    layer,
    tags,
    updatedAt: now,
    createdAt: existingIdx >= 0 ? store.facts[existingIdx].createdAt || now : now,
  };
  if (existingIdx >= 0) store.facts[existingIdx] = fact;
  else store.facts.push(fact);

  // Cap per layer + total
  const caps = { preference: 80, project: 200, session: 120 };
  for (const L of LAYERS) {
    const ofLayer = store.facts.filter((f) => normalizeLayer(f.layer) === L);
    if (ofLayer.length > caps[L]) {
      const drop = new Set(ofLayer.slice(0, ofLayer.length - caps[L]).map((f) => f.id));
      store.facts = store.facts.filter((f) => !drop.has(f.id));
    }
  }
  if (store.facts.length > 500) store.facts = store.facts.slice(-500);

  await saveStore(deps, store);
  return { ok: true, fact, count: store.facts.length };
}

async function recall({ deps, args }) {
  const query = String(args?.query || args?.q || args?.text || args?.key || "").trim();
  const limit = Math.min(20, Math.max(1, Number(args?.limit) || 5));
  const layerFilter = args?.layer ? normalizeLayer(args.layer) : null;
  const store = await loadStore(deps);
  const ranked = store.facts
    .filter((f) => (layerFilter ? normalizeLayer(f.layer) === layerFilter : true))
    .map((f) => ({ fact: f, score: scoreFact(f, query) }))
    .filter((x) => (query ? x.score > 0 : true))
    .sort((a, b) => b.score - a.score || String(b.fact.updatedAt).localeCompare(String(a.fact.updatedAt)))
    .slice(0, limit)
    .map((x) => x.fact);
  return {
    ok: true,
    query,
    layer: layerFilter,
    facts: ranked,
    answer: ranked.map((f) => `[${f.layer || "project"}] ${f.key}: ${f.value}`).join("\n"),
  };
}

async function list({ deps, args }) {
  const store = await loadStore(deps);
  const limit = Math.min(100, Math.max(1, Number(args?.limit) || 50));
  const layerFilter = args?.layer ? normalizeLayer(args.layer) : null;
  let facts = store.facts;
  if (layerFilter) facts = facts.filter((f) => normalizeLayer(f.layer) === layerFilter);
  facts = facts.slice(-limit).reverse();
  return { ok: true, facts, count: store.facts.length, layer: layerFilter };
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

/**
 * Heuristic extractors for auto-remember (no LLM required).
 */
function extractHighValueFacts(userText, steps = [], settings = {}) {
  const text = String(userText || "").trim();
  const out = [];
  const push = (key, value, layer, tags = []) => {
    const v = String(value || "").trim();
    if (!v || v.length > 400) return;
    if (out.some((f) => f.key === key && f.value === v)) return;
    out.push({ key, value: v, layer, tags });
  };

  // Explicit remember
  const rememberMatch = text.match(/(?:请?记住|记一下|记下)[:：\s]+(.+)$/i);
  if (rememberMatch) {
    push("user_note", rememberMatch[1].trim(), "preference", ["explicit"]);
  }

  // Preference phrases
  const prefer = text.match(/(?:我喜欢|偏好|默认用|以后都用)\s*([^\n。！?]{2,40})/);
  if (prefer) push("preference", prefer[1].trim(), "preference", ["prefer"]);

  // Windows / Unix paths as project facts
  const pathRe = /(?:[A-Za-z]:\\[^\s"'，。]{3,120}|\/(?:Users|home|projects|var)[^\s"'，。]{3,120})/g;
  let m;
  while ((m = pathRe.exec(text)) && out.length < 8) {
    const p = m[0].replace(/[，。；]+$/, "");
    if (/codingWorkspace|工作区|项目|仓库|在/.test(text) || /\.(git|json|py|js|ts)$/i.test(p) === false) {
      push("project_path", p, "project", ["path"]);
    }
  }

  // From coding step workspace
  for (const step of steps || []) {
    if (step.skillId === "mogu.coding" && step.workspace && step.ok !== false) {
      push("coding_workspace", step.workspace, "project", ["coding", "auto"]);
    }
    if (step.tool === "mogu_coding" && step.workspace && step.ok !== false) {
      push("coding_workspace", step.workspace, "project", ["coding", "auto"]);
    }
  }

  // Settings default workspace if user mentioned coding
  if (/编程|改代码|工作区/.test(text) && settings.codingWorkspace) {
    push("coding_workspace", settings.codingWorkspace, "project", ["coding", "settings"]);
  }

  return out.slice(0, 6);
}

module.exports = {
  id: "mogu.memory",
  LAYERS,
  status,
  preflight,
  remember,
  recall,
  list,
  forget,
  run: remember,
  memoryPath,
  extractHighValueFacts,
  normalizeLayer,
};
