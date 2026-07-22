/**
 * Edit accuracy: light symbol/import index → right files; post-diff content check → right changes.
 */

const fs = require("fs-extra");
const path = require("path");
const {
  listRepoFiles,
  extractPathHints,
  extractTokens,
  normalizeRel,
  relatedTestPaths,
  scorePath,
} = require("./coding-scope");

const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py"]);
const MAX_INDEX_FILES = 800;
const MAX_FILE_BYTES = 120_000;

function isCodeFile(rel) {
  return CODE_EXT.has(path.posix.extname(normalizeRel(rel)).toLowerCase());
}

function resolveImport(fromFile, spec, allSet) {
  const s = String(spec || "").replace(/\\/g, "/");
  if (!s.startsWith(".") && !s.startsWith("/")) return null;
  const fromDir = path.posix.dirname(normalizeRel(fromFile));
  const joined = normalizeRel(path.posix.normalize(`${fromDir}/${s}`));
  const candidates = [
    joined,
    `${joined}.js`,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.jsx`,
    `${joined}.mjs`,
    `${joined}.cjs`,
    `${joined}.py`,
    `${joined}/index.js`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
  ];
  for (const c of candidates) {
    if (allSet.has(c)) return c;
  }
  return null;
}

function extractFromSource(rel, text) {
  const symbols = new Set();
  const imports = [];
  const lines = String(text || "").split(/\r?\n/).slice(0, 4000);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    let m =
      trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) ||
      trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/) ||
      trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/) ||
      trimmed.match(/^def\s+([A-Za-z_][\w]*)\s*\(/) ||
      trimmed.match(/^class\s+([A-Za-z_][\w]*)\s*[:\(]/);
    if (m) symbols.add(m[1]);

    const exportAs = trimmed.match(/^export\s+\{\s*([^}]+)\s*\}/);
    if (exportAs) {
      for (const part of exportAs[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/i)[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) symbols.add(name);
      }
    }

    const req = trimmed.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (req) imports.push(req[1]);
    const imp = trimmed.match(/from\s+['"]([^'"]+)['"]/);
    if (imp) imports.push(imp[1]);
    const impSide = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
    if (impSide) imports.push(impSide[1]);
    const pyImp = trimmed.match(/^(?:from\s+(\.?[\w.]+)\s+import|import\s+(\.?[\w.]+))/);
    if (pyImp) imports.push((pyImp[1] || pyImp[2] || "").replace(/\./g, "/"));
  }

  return { symbols: [...symbols], imports };
}

function buildLightIndex(workspace, { maxFiles = MAX_INDEX_FILES } = {}) {
  const allFiles = listRepoFiles(workspace, { max: 8000 });
  const allSet = new Set(allFiles);
  const codeFiles = allFiles.filter(isCodeFile).slice(0, maxFiles);
  /** @type {Map<string, { symbols: string[], imports: string[], importPaths: string[] }>} */
  const byFile = new Map();
  /** @type {Map<string, Set<string>>} */
  const symbolToFiles = new Map();
  /** @type {Map<string, Set<string>>} */
  const importersOf = new Map();

  for (const rel of codeFiles) {
    const abs = path.join(workspace, rel);
    let text = "";
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const { symbols, imports } = extractFromSource(rel, text);
    const importPaths = [];
    for (const spec of imports) {
      const resolved = resolveImport(rel, spec, allSet);
      if (resolved) {
        importPaths.push(resolved);
        if (!importersOf.has(resolved)) importersOf.set(resolved, new Set());
        importersOf.get(resolved).add(rel);
      }
    }
    byFile.set(rel, { symbols, imports, importPaths });
    for (const sym of symbols) {
      const key = sym.toLowerCase();
      if (!symbolToFiles.has(key)) symbolToFiles.set(key, new Set());
      symbolToFiles.get(key).add(rel);
    }
  }

  return { allFiles, allSet, byFile, symbolToFiles, importersOf, codeFileCount: codeFiles.length };
}

function findSymbolMentionsInPrompt(prompt, index) {
  const tokens = extractTokens(prompt);
  const hits = [];
  for (const t of tokens) {
    if (t.length < 3) continue;
    const files = index.symbolToFiles.get(t.toLowerCase());
    if (files?.size) {
      hits.push({ token: t, files: [...files].slice(0, 8) });
    }
  }
  return hits;
}

/**
 * Plan where to edit and what content must stay on-task.
 */
function planEditAccuracy(workspace, prompt, { allowPaths, maxTargets = 14 } = {}) {
  const explicit = Array.isArray(allowPaths)
    ? allowPaths.map(normalizeRel).filter(Boolean)
    : [];
  const index = buildLightIndex(workspace);
  const pathHints = extractPathHints(prompt);
  const tokens = extractTokens(prompt);
  const symbolHits = findSymbolMentionsInPrompt(prompt, index);

  /** @type {Map<string, { score: number, reasons: string[] }>} */
  const scored = new Map();
  const bump = (file, score, reason) => {
    const rel = normalizeRel(file);
    if (!rel) return;
    const cur = scored.get(rel) || { score: 0, reasons: [] };
    cur.score += score;
    if (reason && !cur.reasons.includes(reason)) cur.reasons.push(reason);
    scored.set(rel, cur);
  };

  for (const p of explicit) bump(p, 100, "显式指定");

  for (const hint of pathHints) {
    const hit =
      index.allFiles.find(
        (f) =>
          f === hint ||
          f.endsWith(`/${hint}`) ||
          path.posix.basename(f) === path.posix.basename(hint)
      ) || (hint.includes("/") ? hint : null);
    if (hit) bump(hit, 80, `路径提及 ${hint}`);
  }

  for (const hit of symbolHits) {
    for (const f of hit.files) bump(f, 45, `符号 ${hit.token}`);
  }

  for (const f of index.allFiles) {
    const s = scorePath(f, tokens);
    if (s >= 12) bump(f, s, "路径关键词");
  }

  // Expand one hop: imports + importers + tests
  const seeds = [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 8)
    .map(([f]) => f);

  for (const seed of seeds) {
    const meta = index.byFile.get(seed);
    if (meta) {
      for (const imp of meta.importPaths.slice(0, 6)) {
        bump(imp, 18, `被 ${path.posix.basename(seed)} 引用`);
      }
    }
    const importers = index.importersOf.get(seed);
    if (importers) {
      for (const imp of [...importers].slice(0, 4)) {
        bump(imp, 14, `引用了 ${path.posix.basename(seed)}`);
      }
    }
    for (const t of relatedTestPaths(seed, index.allFiles)) {
      bump(t, 22, "关联测试");
    }
  }

  const ranked = [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, maxTargets);

  const targets = ranked.map(([file, info]) => ({
    path: file,
    score: info.score,
    reason: info.reasons[0] || "相关",
    reasons: info.reasons,
  }));
  const targetPaths = targets.map((t) => t.path);

  const mustTouch = [
    ...new Set([
      ...symbolHits.map((h) => h.token),
      ...tokens.filter((t) => t.length >= 4 && !t.includes("/")).slice(0, 12),
    ]),
  ].slice(0, 16);

  const top = ranked[0]?.[1]?.score || 0;
  const locationConfidence =
    explicit.length || pathHints.length || top >= 70
      ? "high"
      : top >= 35 || symbolHits.length
        ? "medium"
        : targetPaths.length
          ? "low"
          : "none";

  const locked = locationConfidence === "high" || locationConfidence === "medium";

  return {
    ok: true,
    indexStats: {
      files: index.allFiles.length,
      codeFiles: index.codeFileCount,
      symbols: index.symbolToFiles.size,
    },
    seeds: seeds.map((p) => ({
      path: p,
      score: scored.get(p)?.score || 0,
      reason: scored.get(p)?.reasons?.[0] || "",
    })),
    targets,
    targetPaths,
    mustTouch,
    tokens,
    symbolHits: symbolHits.map((h) => ({ token: h.token, files: h.files })),
    locationConfidence,
    locked,
    locationReason: targetPaths.length
      ? `定位 ${targetPaths.length} 个目标文件（${locationConfidence}）；符号命中 ${symbolHits.length}`
      : "未能定位目标文件",
  };
}

function enrichPromptWithAccuracy(userPrompt, editPlan) {
  const base = String(userPrompt || "").trim();
  if (!editPlan?.targetPaths?.length) return base;
  const locLines = editPlan.targets
    .slice(0, 12)
    .map((t) => `- ${t.path}（${t.reason}）`)
    .join("\n");
  const must = (editPlan.mustTouch || []).slice(0, 10).join("、");
  return [
    base,
    "",
    "【改对位置 — 执行计划】",
    "优先只改下列文件；改其它文件必须与任务直接相关：",
    locLines,
    "",
    "【改对内容 — 硬约束】",
    "1. 只做完成用户任务所需的最小改动，禁止顺手重构、格式化无关文件、改无关注释。",
    "2. 行为与命名保持仓库现有风格；不要引入未要求的依赖。",
    must ? `3. 改动应切实覆盖任务要点（关键词/符号）：${must}` : "3. 每处改动都要能对应任务描述中的具体意图。",
    "4. 若需改测试，只改与上述行为直接相关的断言。",
  ].join("\n");
}

function collectDiffAddedText(diffText) {
  return String(diffText || "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

function collectDiffRemovedText(diffText) {
  return String(diffText || "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("-") && !l.startsWith("---"))
    .map((l) => l.slice(1))
    .join("\n");
}

/**
 * After edit: did the diff actually touch task-relevant content?
 */
function assessContentAccuracy(review, prompt, editPlan = {}) {
  const files = (review?.files || [])
    .map((f) => normalizeRel(typeof f === "string" ? f : f?.path))
    .filter(Boolean);
  const diff = String(review?.diff || "");
  const added = collectDiffAddedText(diff);
  const removed = collectDiffRemovedText(diff);
  const changedText = `${added}\n${removed}`.toLowerCase();
  const flags = [];
  const mustTouch = (editPlan.mustTouch || extractTokens(prompt)).map((t) => String(t).toLowerCase());
  const targets = new Set((editPlan.targetPaths || []).map(normalizeRel));

  if (!files.length) {
    return {
      ok: false,
      needsContentFix: true,
      flags: ["未检测到文件改动"],
      warning: "未检测到文件改动，任务可能未落地",
      hitCount: 0,
      mustTouch,
    };
  }

  const offTarget = targets.size
    ? files.filter((f) => ![...targets].some((t) => f === t || f.startsWith(`${t}/`) || pathInDirAllow(f, t)))
    : [];
  if (offTarget.length && offTarget.length === files.length) {
    flags.push(`改动文件均不在定位目标内：${offTarget.slice(0, 4).join(", ")}`);
  } else if (offTarget.length >= 2) {
    flags.push(`多项改动不在定位目标内：${offTarget.slice(0, 4).join(", ")}`);
  }

  let hitCount = 0;
  for (const t of mustTouch) {
    if (t.length < 3) continue;
    if (changedText.includes(t) || files.some((f) => f.toLowerCase().includes(t))) hitCount += 1;
  }

  const meaningfulMust = mustTouch.filter((t) => t.length >= 4);
  if (meaningfulMust.length >= 2 && hitCount === 0 && (added.length > 20 || removed.length > 20 || diff.length > 60)) {
    flags.push("diff 未触及任务关键词/符号，内容可能跑偏");
  }

  const addLines = added.split(/\n/).filter((l) => l.trim());
  const trivial =
    addLines.length > 0 &&
    addLines.every((l) => !l.trim() || /^[{};,\s]*$/.test(l) || /^\s*\/\//.test(l) || /^\s*#/.test(l));
  if (trivial && files.length && meaningfulMust.length) {
    flags.push("改动几乎只有空白/注释，可能未改到实质逻辑");
  }

  // Large delete with tiny add on a non-target — suspicious
  if (removed.length > 500 && added.length < 40 && meaningfulMust.length) {
    flags.push("大段删除但几乎无新增，请确认是否误删");
  }

  const needsContentFix = flags.some((f) => /跑偏|未落地|实质逻辑|误删|不在定位/.test(f));

  return {
    ok: flags.length === 0,
    needsContentFix,
    flags,
    warning: flags.length ? flags.join("；") : null,
    hitCount,
    mustTouch,
    offTarget,
  };
}

function pathInDirAllow(file, allow) {
  const a = normalizeRel(allow);
  if (!/\.[A-Za-z0-9]+$/.test(a)) return file === a || file.startsWith(`${a}/`);
  return false;
}

function buildContentFixPrompt(userPrompt, contentAssessment, editPlan) {
  return [
    userPrompt,
    "",
    "【内容纠偏】上轮改动可能未对准任务，请在锁定文件内重做最小正确改动。",
    contentAssessment?.warning ? `问题：${contentAssessment.warning}` : "",
    editPlan?.targetPaths?.length
      ? `只改：${editPlan.targetPaths.slice(0, 10).join(", ")}`
      : "",
    editPlan?.mustTouch?.length
      ? `必须切实处理：${editPlan.mustTouch.slice(0, 10).join("、")}`
      : "",
    "不要重构，不要改无关文件。",
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = {
  buildLightIndex,
  planEditAccuracy,
  enrichPromptWithAccuracy,
  assessContentAccuracy,
  buildContentFixPrompt,
  extractFromSource,
  resolveImport,
};
