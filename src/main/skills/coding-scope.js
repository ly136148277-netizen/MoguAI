/**
 * Change-scope lock: plan allowed files before edit, detect/enforce out-of-scope after.
 */

const fs = require("fs-extra");
const path = require("path");
const { runGit, isGitRepo, discardWorkspaceChanges } = require("./coding-review");

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "__pycache__",
]);

function normalizeRel(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .trim();
}

function listRepoFiles(workspace, { max = 5000 } = {}) {
  const ws = String(workspace || "").trim();
  if (!ws || !fs.pathExistsSync(ws)) return [];
  if (isGitRepo(ws)) {
    const listed = runGit(ws, ["ls-files"]);
    if (listed.ok) {
      return String(listed.stdout || "")
        .split(/\r?\n/)
        .map(normalizeRel)
        .filter(Boolean)
        .slice(0, max);
    }
  }
  const out = [];
  const walk = (dir, relBase = "") => {
    if (out.length >= max) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) break;
      if (ent.name.startsWith(".") && ent.name !== ".moguai") continue;
      if (SKIP_DIR.has(ent.name)) continue;
      const rel = normalizeRel(relBase ? `${relBase}/${ent.name}` : ent.name);
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  walk(ws);
  return out;
}

function extractPathHints(prompt) {
  const text = String(prompt || "");
  const hits = new Set();
  const re =
    /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8}|[\w.-]+\.[A-Za-z0-9]{1,8})/g;
  let m;
  while ((m = re.exec(text)) && hits.size < 30) {
    const p = normalizeRel(m[1]);
    if (p && !p.startsWith("http")) hits.add(p);
  }
  return [...hits];
}

function extractTokens(prompt) {
  const text = String(prompt || "");
  const tokens = new Set();
  for (const p of extractPathHints(text)) {
    tokens.add(p.toLowerCase());
    const base = path.posix.basename(p).replace(/\.[^.]+$/, "");
    if (base.length >= 2) tokens.add(base.toLowerCase());
  }
  const words = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  for (const w of words) {
    const t = w.toLowerCase();
    if (t.length < 3) continue;
    if (
      /^(the|and|for|with|from|that|this|fix|add|update|please|file|code|test|请|修复|添加|修改|文件)$/i.test(
        t
      )
    ) {
      continue;
    }
    tokens.add(t);
  }
  return [...tokens].slice(0, 40);
}

function scorePath(filePath, tokens) {
  const pl = filePath.toLowerCase();
  const base = path.posix.basename(pl);
  const stem = base.replace(/\.[^.]+$/, "");
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (pl === t || pl.endsWith(`/${t}`)) score += 50;
    else if (pl.includes(t)) score += t.includes("/") ? 30 : 12;
    if (stem === t) score += 20;
    else if (stem.includes(t) && t.length >= 4) score += 8;
  }
  if (/\.(md|lock|svg|png|jpg)$/i.test(pl)) score -= 5;
  return score;
}

function relatedTestPaths(filePath, allFiles) {
  const rel = normalizeRel(filePath);
  const dir = path.posix.dirname(rel);
  const stem = path.posix.basename(rel).replace(/\.[^.]+$/, "");
  const ext = path.posix.extname(rel);
  const candidates = [
    `${dir}/${stem}.test${ext}`,
    `${dir}/${stem}.spec${ext}`,
    `${dir}/__tests__/${stem}${ext}`,
    `${dir}/__tests__/${stem}.test${ext}`,
    `tests/${stem}.test${ext}`,
    `test/${stem}.test${ext}`,
  ].map(normalizeRel);
  const set = new Set(allFiles);
  return candidates.filter((c) => set.has(c));
}

function parseAllowPaths(raw) {
  if (Array.isArray(raw)) return raw.map(normalizeRel).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(/[,;\n]+/)
      .map(normalizeRel)
      .filter(Boolean);
  }
  return [];
}

/**
 * @returns {{
 *   locked: boolean,
 *   allowedPaths: string[],
 *   source: string,
 *   confidence: 'high'|'medium'|'low'|'none',
 *   reason: string,
 *   tokens: string[],
 * }}
 */
function planChangeScope(workspace, prompt, { allowPaths, maxFiles = 16 } = {}) {
  const explicit = parseAllowPaths(allowPaths);
  if (explicit.length) {
    return {
      locked: true,
      allowedPaths: [...new Set(explicit)].slice(0, 40),
      source: "explicit",
      confidence: "high",
      reason: "使用调用方声明的文件集",
      tokens: [],
    };
  }

  const allFiles = listRepoFiles(workspace);
  const pathHints = extractPathHints(prompt);
  const tokens = extractTokens(prompt);
  const allowed = new Set();

  for (const hint of pathHints) {
    const hit = allFiles.find(
      (f) => f === hint || f.endsWith(`/${hint}`) || path.posix.basename(f) === path.posix.basename(hint)
    );
    if (hit) {
      allowed.add(hit);
      for (const t of relatedTestPaths(hit, allFiles)) allowed.add(t);
    } else if (hint.includes("/")) {
      allowed.add(hint); // may be new file
    }
  }

  const ranked = allFiles
    .map((f) => ({ f, s: scorePath(f, tokens) }))
    .filter((x) => x.s >= 12)
    .sort((a, b) => b.s - a.s);

  for (const { f } of ranked) {
    if (allowed.size >= maxFiles) break;
    allowed.add(f);
    for (const t of relatedTestPaths(f, allFiles)) {
      if (allowed.size >= maxFiles) break;
      allowed.add(t);
    }
  }

  const allowedPaths = [...allowed].slice(0, maxFiles);
  if (allowedPaths.length === 0) {
    return {
      locked: false,
      allowedPaths: [],
      source: "open",
      confidence: "none",
      reason: "无法从任务推断文件集，未锁定（避免误拦）",
      tokens,
    };
  }

  const topScore = ranked[0]?.s || (pathHints.length ? 40 : 0);
  const confidence = pathHints.length || topScore >= 30 ? "high" : topScore >= 16 ? "medium" : "low";
  const locked = confidence !== "low";

  return {
    locked,
    allowedPaths,
    source: "inferred",
    confidence,
    reason: locked
      ? `已推断并锁定 ${allowedPaths.length} 个文件（置信度 ${confidence}）`
      : `推断较弱，仅作提示不强制拦截（${allowedPaths.length} 个候选）`,
    tokens,
  };
}

function pathInScope(filePath, allowedPaths) {
  const rel = normalizeRel(filePath);
  if (!rel) return false;
  for (const a of allowedPaths) {
    const allow = normalizeRel(a);
    if (!allow) continue;
    if (rel === allow) return true;
    if (allow.endsWith("/") && rel.startsWith(allow)) return true;
    if (!allow.includes(".") && !allow.includes("/") && path.posix.basename(rel) === allow) {
      return true;
    }
    // directory allow: "src/auth" locks subtree
    if (!/\.[A-Za-z0-9]+$/.test(allow) && (rel === allow || rel.startsWith(`${allow}/`))) {
      return true;
    }
  }
  return false;
}

function checkScopeViolation(review, scope) {
  if (!scope || scope.locked === false) {
    return {
      ok: true,
      skipped: true,
      inScope: [],
      outOfScope: [],
      violation: false,
    };
  }
  const allowed = scope.allowedPaths || [];
  if (!allowed.length) {
    return { ok: true, skipped: true, inScope: [], outOfScope: [], violation: false };
  }
  const changed = (review?.files || [])
    .map((f) => normalizeRel(typeof f === "string" ? f : f?.path))
    .filter(Boolean);
  const inScope = [];
  const outOfScope = [];
  for (const p of changed) {
    if (pathInScope(p, allowed)) inScope.push(p);
    else outOfScope.push(p);
  }
  return {
    ok: outOfScope.length === 0,
    skipped: false,
    inScope,
    outOfScope,
    violation: outOfScope.length > 0,
    message:
      outOfScope.length === 0
        ? null
        : `越界 ${outOfScope.length} 个文件：${outOfScope.slice(0, 8).join(", ")}`,
  };
}

function enforceScope(workspace, review, scope, { mode = "trim" } = {}) {
  const checked = checkScopeViolation(review, scope);
  if (!checked.violation || mode === "off" || mode === "warn") {
    return {
      ...checked,
      enforced: false,
      trimmed: [],
      mode,
      review,
    };
  }
  if (mode === "trim" || mode === "strict") {
    const discarded = discardWorkspaceChanges(workspace, { paths: checked.outOfScope });
    return {
      ...checked,
      enforced: true,
      trimmed: discarded.discarded || [],
      mode,
      discard: discarded,
      review: discarded.review || review,
      message: `已拦截并回滚越界改动 ${ (discarded.discarded || []).length } 个：${(
        discarded.discarded || []
      )
        .slice(0, 8)
        .join(", ")}`,
    };
  }
  return { ...checked, enforced: false, trimmed: [], mode, review };
}

function enrichPromptWithScope(userPrompt, scope) {
  const base = String(userPrompt || "").trim();
  if (!scope?.allowedPaths?.length) return base;
  const list = scope.allowedPaths.map((p) => `- ${p}`).join("\n");
  if (scope.locked) {
    return [
      base,
      "",
      "【文件集锁定 — 硬约束】",
      "只允许修改下列文件（可新建列表中的路径）。禁止改动列表外任何文件；越界会被系统回滚。",
      list,
    ].join("\n");
  }
  return [
    base,
    "",
    "【建议改动范围 — 优先遵守】",
    "请优先只改这些文件，扩大范围前需有充分理由：",
    list,
  ].join("\n");
}

function normalizeScopeMode(raw, { enforce = true } = {}) {
  const m = String(raw || "").trim().toLowerCase();
  if (m === "off" || m === "none" || enforce === false) return "off";
  if (m === "warn") return "warn";
  if (m === "strict") return "strict";
  if (m === "trim" || m === "intercept" || m === "lock") return "trim";
  return enforce === false ? "off" : "trim";
}

module.exports = {
  normalizeRel,
  listRepoFiles,
  extractPathHints,
  extractTokens,
  scorePath,
  relatedTestPaths,
  planChangeScope,
  pathInScope,
  checkScopeViolation,
  enforceScope,
  enrichPromptWithScope,
  normalizeScopeMode,
  parseAllowPaths,
};
