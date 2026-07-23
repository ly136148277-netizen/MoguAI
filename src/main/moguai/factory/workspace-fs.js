/**
 * MOGU AI 精密工厂 — workspace file IO (path-guarded).
 */
const fs = require("fs-extra");
const path = require("path");
const { isPathInside } = require("../../media-path");

const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "out",
  "build",
  ".next",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".moguai",
  ".cursor",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 2500;
const MAX_DEPTH = 8;

function normalizeWorkspace(workspace) {
  const ws = String(workspace || "").trim();
  if (!ws) {
    const err = new Error("工作区未设置");
    err.code = "workspace_missing";
    throw err;
  }
  return path.resolve(ws);
}

function assertInsideWorkspace(workspace, candidatePath) {
  const root = normalizeWorkspace(workspace);
  const abs = path.resolve(root, candidatePath || "");
  if (!isPathInside(root, abs)) {
    const err = new Error("路径超出工作区");
    err.code = "path_escape";
    throw err;
  }
  return { root, abs };
}

function toPosixRel(root, abs) {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}

async function listTree(workspace, options = {}) {
  const root = normalizeWorkspace(workspace);
  if (!(await fs.pathExists(root))) {
    const err = new Error(`工作区不存在：${root}`);
    err.code = "workspace_missing";
    throw err;
  }
  const ignore = options.ignore instanceof Set ? options.ignore : DEFAULT_IGNORE;
  const maxEntries = Number(options.maxEntries) || MAX_ENTRIES;
  const maxDepth = Number(options.maxDepth) || MAX_DEPTH;
  const entries = [];

  async function walk(dir, depth) {
    if (entries.length >= maxEntries || depth > maxDepth) return;
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    for (const name of names) {
      if (entries.length >= maxEntries) break;
      if (ignore.has(name)) continue;
      if (name.startsWith(".") && name !== ".env.example") continue;
      const abs = path.join(dir, name);
      let st;
      try {
        st = await fs.lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      const rel = toPosixRel(root, abs);
      if (st.isDirectory()) {
        entries.push({ type: "dir", path: rel, name });
        await walk(abs, depth + 1);
      } else if (st.isFile()) {
        entries.push({ type: "file", path: rel, name, size: st.size });
      }
    }
  }

  await walk(root, 0);
  return {
    ok: true,
    workspace: root,
    entries,
    truncated: entries.length >= maxEntries,
  };
}

async function readFileInWorkspace(workspace, relPath) {
  const { root, abs } = assertInsideWorkspace(workspace, relPath);
  if (!(await fs.pathExists(abs))) {
    const err = new Error(`文件不存在：${relPath}`);
    err.code = "not_found";
    throw err;
  }
  const st = await fs.stat(abs);
  if (!st.isFile()) {
    const err = new Error("不是文件");
    err.code = "not_file";
    throw err;
  }
  if (st.size > MAX_FILE_BYTES) {
    const err = new Error(`文件过大（上限 ${MAX_FILE_BYTES} 字节）`);
    err.code = "too_large";
    throw err;
  }
  const content = await fs.readFile(abs, "utf8");
  return {
    ok: true,
    workspace: root,
    path: toPosixRel(root, abs),
    content,
    size: st.size,
  };
}

/**
 * Search by filename and/or simple symbol/text in code files.
 */
async function searchWorkspace(workspace, query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return { ok: true, query: "", hits: [] };
  const root = normalizeWorkspace(workspace);
  const listed = await listTree(root, {
    maxEntries: options.maxEntries || 2000,
    maxDepth: options.maxDepth || MAX_DEPTH,
  });
  const needle = q.toLowerCase();
  const symbolRe = /^[A-Za-z_$][\w$]*$/.test(q)
    ? new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    : null;
  const codeExt = new Set(["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "json", "md", "css", "html"]);
  const hits = [];
  const maxHits = Number(options.maxHits) || 80;
  const maxContentFiles = Number(options.maxContentFiles) || 120;

  for (const entry of listed.entries || []) {
    if (hits.length >= maxHits) break;
    if (entry.type !== "file") continue;
    const nameHit = entry.name.toLowerCase().includes(needle) || entry.path.toLowerCase().includes(needle);
    if (nameHit) {
      hits.push({ kind: "file", path: entry.path, line: null, preview: entry.name });
      continue;
    }
  }

  let scanned = 0;
  for (const entry of listed.entries || []) {
    if (hits.length >= maxHits || scanned >= maxContentFiles) break;
    if (entry.type !== "file") continue;
    const ext = String(entry.name.split(".").pop() || "").toLowerCase();
    if (!codeExt.has(ext)) continue;
    if ((entry.size || 0) > 256 * 1024) continue;
    scanned += 1;
    let text;
    try {
      text = await fs.readFile(path.join(root, entry.path), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.length >= maxHits) break;
      const line = lines[i];
      const matched = symbolRe ? symbolRe.test(line) : line.toLowerCase().includes(needle);
      if (!matched) continue;
      hits.push({
        kind: "symbol",
        path: entry.path,
        line: i + 1,
        preview: line.trim().slice(0, 160),
      });
    }
  }

  return {
    ok: true,
    workspace: root,
    query: q,
    hits,
    truncated: hits.length >= maxHits,
  };
}

async function writeFileInWorkspace(workspace, relPath, content) {
  const { root, abs } = assertInsideWorkspace(workspace, relPath);
  const text = content == null ? "" : String(content);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_FILE_BYTES) {
    const err = new Error(`内容过大（上限 ${MAX_FILE_BYTES} 字节）`);
    err.code = "too_large";
    throw err;
  }
  await fs.ensureDir(path.dirname(abs));
  await fs.writeFile(abs, text, "utf8");
  return {
    ok: true,
    workspace: root,
    path: toPosixRel(root, abs),
    size: bytes,
  };
}

module.exports = {
  DEFAULT_IGNORE,
  MAX_FILE_BYTES,
  normalizeWorkspace,
  assertInsideWorkspace,
  listTree,
  searchWorkspace,
  readFileInWorkspace,
  writeFileInWorkspace,
  isPathInside,
};
