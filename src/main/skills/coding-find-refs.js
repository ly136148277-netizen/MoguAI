/**
 * Lightweight find_references (Phase 2): jedi usages first, then grep -w fallback.
 * Repo-root only — never returns site-packages / dist-packages hits.
 */
const path = require("path");
const fs = require("fs-extra");
const { spawnSync } = require("node:child_process");

const SITE_RE = /(?:^|[/\\])(?:site-packages|dist-packages)(?:[/\\]|$)/i;

function isOutsideRepo(absPath, workspace) {
  const abs = path.resolve(String(absPath || ""));
  const root = path.resolve(String(workspace || ""));
  if (!root) return true;
  const rel = path.relative(root, abs);
  return !rel || rel.startsWith("..") || path.isAbsolute(rel);
}

function isIgnoredPath(p, workspace) {
  const s = String(p || "").replace(/\\/g, "/");
  if (SITE_RE.test(s)) return true;
  if (/\/(?:\.venv|venv|node_modules)\//i.test(s)) return true;
  if (workspace && isOutsideRepo(p, workspace)) return true;
  return false;
}

function toRepoRel(absOrRel, workspace) {
  const raw = String(absOrRel || "").replace(/\\/g, "/").trim();
  if (!raw) return "";
  if (!path.isAbsolute(raw) && !/^[A-Za-z]:\//.test(raw)) {
    return raw.replace(/^\.\//, "");
  }
  if (isOutsideRepo(raw, workspace)) return "";
  return path.relative(workspace, raw).replace(/\\/g, "/");
}

function isTestPath(rel) {
  const s = String(rel || "").replace(/\\/g, "/");
  return /(^|\/)tests?\//.test(s) || /(^|\/)test_/.test(s) || /_test\.py$/.test(s);
}

function readLine(abs, line) {
  try {
    const lines = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n");
    return lines[Math.max(0, line - 1)] || "";
  } catch {
    return "";
  }
}

function inferSymbol(lineText, symbolName) {
  const named = String(symbolName || "").trim();
  if (named) {
    const idx = lineText.indexOf(named);
    return { name: named, col: idx >= 0 ? idx : 0 };
  }
  const patterns = [
    /^\s*(?:async\s+)?def\s+(\w+)/,
    /^\s*class\s+(\w+)/,
    /^\s*(\w+)\s*=/,
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
    /\b([A-Za-z_][A-Za-z0-9_]*)\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(lineText);
    if (m) {
      const name = m[1];
      const col = lineText.indexOf(name);
      return { name, col: col >= 0 ? col : 0 };
    }
  }
  return { name: "", col: 0 };
}

function rankRefs(refs, originRel) {
  return [...refs].sort((a, b) => {
    const aSame = a.file === originRel ? 0 : 1;
    const bSame = b.file === originRel ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    const aTest = isTestPath(a.file) ? 1 : 0;
    const bTest = isTestPath(b.file) ? 1 : 0;
    if (aTest !== bTest) return aTest - bTest;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

function dedupeRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const r of refs) {
    const key = `${r.file}:${r.line}:${r.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function findRefsViaJedi({ absPath, line, col, workspace, symbolName }) {
  // Keep Python self-contained; path filtering also re-applied in JS.
  const py = [
    "import json,sys,os",
    "try:",
    " import jedi",
    "except Exception as e:",
    " print(json.dumps({'ok':False,'engine':'jedi','error':'import_failed:'+str(e),'refs':[]})); raise SystemExit(0)",
    "path,line,col,workspace=sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),sys.argv[4]",
    "try:",
    " script=jedi.Script(path=path)",
    " refs=script.get_references(line,col,include_builtins=False)",
    "except Exception as e:",
    " print(json.dumps({'ok':False,'engine':'jedi','error':str(e),'refs':[]})); raise SystemExit(0)",
    "out=[]; ws=os.path.normcase(os.path.abspath(workspace))",
    "for r in refs:",
    " mp=getattr(r,'module_path',None)",
    " if not mp: continue",
    " fp=os.path.abspath(str(mp)); low=fp.replace('\\\\','/').lower()",
    " if 'site-packages' in low or 'dist-packages' in low: continue",
    " nfp=os.path.normcase(fp)",
    " if not (nfp==ws or nfp.startswith(ws+os.sep)): continue",
    " try: text=(r.get_line_code() or '').strip()",
    " except Exception: text=''",
    " out.append({'file':fp,'line':int(r.line or 0),'text':text[:240]})",
    "print(json.dumps({'ok':True,'engine':'jedi','refs':out}))",
  ].join("\n");
  const r = spawnSync("python", ["-c", py, absPath, String(line), String(col), workspace], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 45_000,
  });
  if (r.status !== 0 && !String(r.stdout || "").trim()) {
    return {
      ok: false,
      engine: "jedi",
      error: String(r.stderr || r.error || "jedi spawn failed").slice(0, 300),
      refs: [],
    };
  }
  try {
    const parsed = JSON.parse(String(r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}");
    const refs = [];
    for (const item of parsed.refs || []) {
      const rel = toRepoRel(item.file, workspace);
      if (!rel || isIgnoredPath(item.file, workspace)) continue;
      if (!item.line || item.line < 1) continue;
      refs.push({
        file: rel,
        line: item.line,
        text: String(item.text || readLine(path.join(workspace, rel), item.line)).trim().slice(0, 240),
      });
    }
    return {
      ok: Boolean(parsed.ok) && refs.length > 0,
      engine: "jedi",
      error: parsed.error || null,
      refs,
      symbol: symbolName || "",
    };
  } catch (error) {
    return {
      ok: false,
      engine: "jedi",
      error: error.message || String(error),
      refs: [],
    };
  }
}

function listTrackedPy(workspace) {
  const r = spawnSync("git", ["ls-files", "*.py"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (r.status !== 0) return [];
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter(Boolean)
    .filter((rel) => !isIgnoredPath(path.join(workspace, rel), workspace));
}

function listTrackedJs(workspace) {
  const r = spawnSync("git", ["ls-files", "*.js", "*.ts", "*.tsx", "*.jsx"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (r.status !== 0) return [];
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function findRefsViaGrep({ workspace, symbolName, globs = ["*.py"] }) {
  const name = String(symbolName || "").trim();
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { ok: false, engine: "grep", error: "need_symbol_name", refs: [] };
  }
  const files =
    globs.includes("*.py") && globs.length === 1
      ? listTrackedPy(workspace)
      : globs.some((g) => /\.js|\.ts/.test(g))
        ? listTrackedJs(workspace)
        : listTrackedPy(workspace);
  const refs = [];
  const wordRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  for (const rel of files) {
    if (refs.length >= 80) break;
    const abs = path.join(workspace, rel);
    let text;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 512 * 1024) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    let perFile = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (perFile >= 8 || refs.length >= 80) break;
      if (!wordRe.test(lines[i])) continue;
      refs.push({
        file: rel,
        line: i + 1,
        text: lines[i].trim().slice(0, 240),
      });
      perFile += 1;
    }
  }
  return { ok: refs.length > 0, engine: "grep", refs, symbol: name };
}

/**
 * @param {{
 *   workspace: string,
 *   file_path: string,
 *   line: number,
 *   symbol_name?: string,
 *   maxRefs?: number,
 * }} opts
 * @returns {{ ok: boolean, engine: string, symbol: string, refs: Array<{file:string,line:number,text:string}>, error?: string }}
 */
function findReferences(opts = {}) {
  const workspace = path.resolve(String(opts.workspace || "").trim());
  const maxRefs = Math.min(24, Math.max(1, Number(opts.maxRefs) || 12));
  let filePath = String(opts.file_path || opts.filePath || "").trim();
  const line = Number(opts.line) || 0;
  if (!workspace || !filePath || line < 1) {
    return { ok: false, engine: "none", symbol: "", refs: [], error: "need file_path + line" };
  }
  if (!path.isAbsolute(filePath)) {
    filePath = path.join(workspace, filePath);
  }
  filePath = path.resolve(filePath);
  if (isIgnoredPath(filePath, workspace) || isOutsideRepo(filePath, workspace)) {
    return { ok: false, engine: "none", symbol: "", refs: [], error: "path outside repo" };
  }
  const originRel = toRepoRel(filePath, workspace);
  const lineText = readLine(filePath, line);
  const inferred = inferSymbol(lineText, opts.symbol_name || opts.symbolName);
  const ext = path.extname(filePath).toLowerCase();

  let result;
  if (ext === ".py") {
    result = findRefsViaJedi({
      absPath: filePath,
      line,
      col: inferred.col,
      workspace,
      symbolName: inferred.name,
    });
    if (!result.ok || !result.refs.length) {
      const grepped = findRefsViaGrep({
        workspace,
        symbolName: inferred.name,
        globs: ["*.py"],
      });
      if (grepped.refs.length) {
        result = {
          ...grepped,
          engine: result.engine === "jedi" ? "jedi+grep" : "grep",
          error: result.error || grepped.error,
        };
      }
    }
  } else if (/\.(js|ts|tsx|jsx)$/.test(ext)) {
    result = findRefsViaGrep({
      workspace,
      symbolName: inferred.name,
      globs: ["*.js", "*.ts", "*.tsx", "*.jsx"],
    });
    result.engine = "grep-js";
  } else {
    result = findRefsViaGrep({ workspace, symbolName: inferred.name, globs: ["*.py"] });
  }

  const refs = rankRefs(dedupeRefs(result.refs || []), originRel).slice(0, maxRefs);
  return {
    ok: refs.length > 0,
    engine: result.engine || "none",
    symbol: inferred.name || result.symbol || "",
    refs,
    error: refs.length ? null : result.error || "no_refs",
    origin: { file: originRel, line },
  };
}

function formatRefsList(refs) {
  if (!refs?.length) return "(none)";
  return refs.map((r, i) => `${i + 1}. ${r.file}:${r.line}: ${r.text}`).join("\n");
}

/**
 * Prompt block inserted before the next patch after first verify failure.
 */
function buildRefsInjection({ file_path, line, result }) {
  const list = formatRefsList(result?.refs || []);
  return [
    `[引用分析] 报错发生在 ${file_path}:${line}。以下是该行符号的所有调用位置（调用者列表）：`,
    `symbol=${result?.symbol || "?"} engine=${result?.engine || "?"} count=${(result?.refs || []).length}`,
    list,
    "请确保你的补丁同时适配这些调用者，不破坏已有引用关系。",
  ].join("\n");
}

/**
 * Empty-patch escalation: inject up to maxBodies caller function slices (±pad lines).
 */
function buildCallerBodyInjection(workspace, refs, { maxBodies = 3, pad = 30 } = {}) {
  const bodies = [];
  const seen = new Set();
  for (const r of refs || []) {
    if (bodies.length >= maxBodies) break;
    const key = r.file;
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = path.join(workspace, r.file);
    let lines;
    try {
      lines = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n");
    } catch {
      continue;
    }
    const start = Math.max(1, r.line - pad);
    const end = Math.min(lines.length, r.line + pad);
    const slice = lines
      .slice(start - 1, end)
      .map((l, i) => `${start + i}|${l}`)
      .join("\n");
    bodies.push(`### caller context ${r.file}:${r.line}\n${slice}`);
  }
  if (!bodies.length) return "";
  return [
    "[空补丁加码] verify 失败且工作区无有效补丁。下列为引用调用者附近代码（各 ±30 行，已截断）：",
    "你必须基于这些位置给出非空 SEARCH/REPLACE，不能再输出空补丁。",
    "",
    ...bodies,
  ].join("\n");
}

module.exports = {
  findReferences,
  buildRefsInjection,
  buildCallerBodyInjection,
  inferSymbol,
  isIgnoredPath,
  toRepoRel,
  formatRefsList,
};
