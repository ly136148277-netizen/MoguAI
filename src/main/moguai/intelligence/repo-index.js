const fs = require("node:fs");
const path = require("node:path");
const { listRepoFiles, normalizeRel } = require("../../skills/coding-scope");
const {
  buildLightIndex,
  extractFromSource,
  resolveImport,
} = require("../../skills/coding-accuracy");

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs",
]);
const MAX_FILE_BYTES = 512 * 1024;

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function canonicalRoot(workspace) {
  const raw = String(workspace || "").trim();
  if (!raw) {
    const error = new Error("workspace is required");
    error.code = "workspace_missing";
    throw error;
  }
  const root = fs.realpathSync(path.resolve(raw));
  if (!fs.statSync(root).isDirectory()) throw new Error("workspace is not a directory");
  return root;
}

function safeFile(root, relative) {
  const rel = normalizeRel(relative);
  if (!rel || path.isAbsolute(rel) || rel === ".." || rel.startsWith("../")) {
    const error = new Error("path escapes workspace");
    error.code = "path_escape";
    throw error;
  }
  const candidate = path.resolve(root, rel);
  if (!isInside(root, candidate)) {
    const error = new Error("path escapes workspace");
    error.code = "path_escape";
    throw error;
  }
  const real = fs.realpathSync(candidate);
  if (!isInside(root, real)) {
    const error = new Error("path escapes workspace");
    error.code = "path_escape";
    throw error;
  }
  return { rel, abs: real };
}

function definitionKind(line) {
  if (/\bclass\s+/.test(line)) return "class";
  if (/\b(?:function|def|fn)\s+/.test(line)) return "function";
  return "variable";
}

function parseDetails(rel, text) {
  const basic = extractFromSource(rel, text);
  const definitions = [];
  const references = new Map();
  const calls = [];
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let current = null;
  let braceDepth = 0;
  let pythonIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    const def =
      line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) ||
      line.match(/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/) ||
      line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/) ||
      line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/) ||
      line.match(/^\s*class\s+([A-Za-z_]\w*)\s*[:(]/) ||
      line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/) ||
      line.match(/^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/);
    if (def) {
      const column = line.indexOf(def[1]) + 1;
      definitions.push({ name: def[1], file: rel, line: lineNo, column, kind: definitionKind(line) });
      if (/\b(function|def|func|fn)\b/.test(line)) {
        current = def[1];
        pythonIndent = line.match(/^\s*/)[0].length;
      }
    }

    const indent = line.match(/^\s*/)[0].length;
    if (current && pythonIndent >= 0 && index > 0 && line.trim() && indent <= pythonIndent && !def) {
      current = null;
      pythonIndent = -1;
    }
    if (current) {
      const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
      let match;
      while ((match = callRe.exec(line))) {
        const callee = match[1];
        const before = line.slice(0, match.index);
        if (
          (def && callee === def[1]) ||
          /(?:function|def|func|fn|class|if|for|while|switch|catch|new)\s*$/.test(before)
        ) continue;
        calls.push({ caller: current, callee, file: rel, line: lineNo });
      }
    }

    for (const token of line.match(/[A-Za-z_$][\w$]*/g) || []) {
      if (!references.has(token)) references.set(token, []);
      references.get(token).push({
        file: rel,
        line: lineNo,
        column: line.indexOf(token) + 1,
        text: line.trim().slice(0, 240),
      });
    }

    braceDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    if (current && pythonIndent < 0 && braceDepth <= 0) current = null;
  }
  return { ...basic, definitions, references, calls };
}

class RepoIndex {
  constructor(workspace, options = {}) {
    this.root = canonicalRoot(workspace);
    this.maxFiles = Math.min(10_000, Math.max(1, Number(options.maxFiles) || 2000));
    this.maxFileBytes = Math.min(2 * 1024 * 1024, Number(options.maxFileBytes) || MAX_FILE_BYTES);
    this.files = new Map();
    this.symbols = new Map();
    this.importers = new Map();
    this.callEdges = [];
    this.version = 0;
  }

  update() {
    const discovered = listRepoFiles(this.root, { max: this.maxFiles });
    // Reuse the established light index on bootstrap; later updates read changed files only.
    const light = this.version === 0
      ? buildLightIndex(this.root, { maxFiles: this.maxFiles })
      : { allSet: new Set(discovered) };
    const wanted = new Set(discovered.map(normalizeRel).filter(Boolean));
    let changed = 0;
    let removed = 0;

    for (const rel of this.files.keys()) {
      if (!wanted.has(rel)) {
        this.files.delete(rel);
        removed += 1;
      }
    }
    for (const rel of wanted) {
      const ext = path.posix.extname(rel).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      let safe;
      let stat;
      try {
        safe = safeFile(this.root, rel);
        stat = fs.statSync(safe.abs);
      } catch {
        if (this.files.delete(rel)) removed += 1;
        continue;
      }
      if (!stat.isFile() || stat.size > this.maxFileBytes) {
        if (this.files.delete(rel)) removed += 1;
        continue;
      }
      const signature = `${stat.size}:${stat.mtimeMs}`;
      if (this.files.get(rel)?.signature === signature) continue;
      const text = fs.readFileSync(safe.abs, "utf8");
      this.files.set(rel, {
        path: rel,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        signature,
        ...parseDetails(rel, text),
      });
      changed += 1;
    }
    this._rebuildDerived(light);
    this.version += 1;
    return this.stats({ changed, removed });
  }

  _rebuildDerived(light) {
    this.symbols.clear();
    this.importers.clear();
    const allSet = new Set([...light.allSet, ...this.files.keys()]);
    for (const [rel, meta] of this.files) {
      meta.importPaths = meta.imports
        .map((spec) => resolveImport(rel, spec, allSet))
        .filter(Boolean);
      for (const definition of meta.definitions) {
        if (!this.symbols.has(definition.name)) this.symbols.set(definition.name, []);
        this.symbols.get(definition.name).push(definition);
      }
      for (const imported of meta.importPaths) {
        if (!this.importers.has(imported)) this.importers.set(imported, new Set());
        this.importers.get(imported).add(rel);
      }
    }
    const known = new Set(this.symbols.keys());
    this.callEdges = [];
    for (const meta of this.files.values()) {
      for (const edge of meta.calls) {
        if (known.has(edge.callee)) this.callEdges.push(edge);
      }
    }
  }

  ensureIndexed() {
    if (this.version === 0) this.update();
    return this;
  }

  stats(delta = {}) {
    return {
      ok: true,
      workspace: this.root,
      version: this.version,
      files: this.files.size,
      symbols: this.symbols.size,
      callEdges: this.callEdges.length,
      ...delta,
    };
  }

  listFiles() {
    this.ensureIndexed();
    return [...this.files.keys()].sort();
  }

  getSymbols(file) {
    this.ensureIndexed();
    if (file) return [...(this.files.get(normalizeRel(file))?.definitions || [])];
    return [...this.symbols.values()].flat();
  }

  getImports(file) {
    this.ensureIndexed();
    const meta = this.files.get(normalizeRel(file));
    return meta ? { specs: [...meta.imports], paths: [...meta.importPaths] } : { specs: [], paths: [] };
  }

  getImporters(file) {
    this.ensureIndexed();
    return [...(this.importers.get(normalizeRel(file)) || [])].sort();
  }

  findDefinitions(symbol) {
    this.ensureIndexed();
    return [...(this.symbols.get(String(symbol || "")) || [])];
  }

  findReferences(symbol, options = {}) {
    this.ensureIndexed();
    const name = String(symbol || "").trim();
    const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
    const out = [];
    for (const meta of this.files.values()) {
      for (const ref of meta.references.get(name) || []) {
        out.push(ref);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  getCallEdges(symbol) {
    this.ensureIndexed();
    const name = String(symbol || "").trim();
    return this.callEdges.filter((edge) => !name || edge.caller === name || edge.callee === name);
  }

  resolvePath(relative) {
    return safeFile(this.root, relative).abs;
  }
}

module.exports = {
  RepoIndex,
  createRepoIndex: (workspace, options) => new RepoIndex(workspace, options),
  canonicalRoot,
  safeFile,
  parseDetails,
};
