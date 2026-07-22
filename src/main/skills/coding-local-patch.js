/**
 * Local-model coding path: ask Ollama for SEARCH/REPLACE (or unified diff), apply to workspace.
 * Used when small local models cannot drive full agent tool loops reliably.
 */

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { spawnSync } = require("node:child_process");

const OLLAMA_BASE = "http://127.0.0.1:11434";

function normalizeRel(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();
}

async function ollamaChat(model, messages, { timeoutMs = 300_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        // Qwen3+ thinking models otherwise burn tokens into message.thinking and return empty content.
        think: false,
        options: { temperature: 0.1, num_ctx: 16384, num_predict: 4096 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    return String(data?.message?.content || "");
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** OpenAI-compatible /v1/chat/completions (cloud relays). Retries transient 429/502/503. */
async function openaiCompatibleChat(model, messages, { baseUrl, apiKey, timeoutMs = 300_000 } = {}) {
  const root = String(baseUrl || process.env.OPENAI_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const key = String(apiKey || process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "").trim();
  if (!root) throw new Error("缺少 OPENAI_BASE_URL");
  if (!key) throw new Error("缺少 API Key");
  const maxTries = Math.max(1, Number(process.env.MOGU_RELAY_RETRIES || 8) || 8);
  let lastErr = null;
  for (let tryNo = 1; tryNo <= maxTries; tryNo += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${root}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`OpenAI-compat HTTP ${res.status}: ${body.slice(0, 300)}`);
        err.status = res.status;
        if ([429, 502, 503, 504].includes(res.status) && tryNo < maxTries) {
          lastErr = err;
          // Longer backoff for relay flaps (503 bursts lasted minutes in lite8 runs).
          await sleep(Math.min(60_000, 2500 * 2 ** (tryNo - 1)));
          continue;
        }
        throw err;
      }
      const data = await res.json();
      return String(data?.choices?.[0]?.message?.content || "");
    } catch (error) {
      lastErr = error;
      const transient =
        error?.name === "AbortError" ||
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(String(error?.message || error));
      if (transient && tryNo < maxTries) {
        await sleep(Math.min(60_000, 2500 * 2 ** (tryNo - 1)));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("OpenAI-compat failed");
}

async function modelChat(model, messages, opts = {}) {
  const baseUrl = String(opts.baseUrl || "").trim();
  const apiKey = String(opts.apiKey || "").trim();
  if (baseUrl && apiKey && !/11434/.test(baseUrl)) {
    return openaiCompatibleChat(model, messages, { ...opts, baseUrl, apiKey });
  }
  return ollamaChat(model, messages, opts);
}

function extractPromptIdentifiers(prompt) {
  const ids = String(prompt || "").match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
  return new Set(ids.map((s) => s.toLowerCase()));
}

function scorePathForPrompt(rel, prompt) {
  const p = normalizeRel(rel).toLowerCase();
  const base = path.posix.basename(p);
  const stem = base.replace(/\.[^.]+$/, "");
  const text = String(prompt || "").toLowerCase();
  const ids = extractPromptIdentifiers(prompt);
  let score = 0;
  if (text.includes(p)) score += 60;
  if (text.includes(base)) score += 45;
  if (ids.has(stem)) score += 80;
  else if (stem.length >= 5 && text.includes(stem)) score += 25;
  for (const part of p.split("/")) {
    if (part.length >= 5 && ids.has(part)) score += 20;
  }
  // Symbol↔filename affinity: separability_matrix ↔ separable.py
  for (const id of ids) {
    if (id.length >= 8 && stem.length >= 5 && id.includes(stem)) score += 40;
  }
  // Prefer source over tests / generic module names / data fixtures when tied
  if (/\/tests?\//.test(p) || /(^|\/)test_/.test(p)) score -= 80;
  // If prompt names a test file under pkg/tests/test_foo.py, boost pkg/foo.py
  for (const m of String(prompt || "").matchAll(/([\w./-]+)\/tests?\/test_([\w./-]+)\.py/gi)) {
    const pkg = String(m[1] || "").toLowerCase();
    const stem = String(m[2] || "").toLowerCase().replace(/\/+/g, "/");
    if (pkg && p.includes(pkg) && (p.includes(`/${stem}.py`) || p.endsWith(`/${stem}.py`))) score += 90;
  }
  // Explicit "Likely implementation files" lines in prompt
  for (const line of String(prompt || "").split("\n")) {
    const hit = line.match(/^\s*-\s*([\w./-]+\.(?:py|js|ts))\s*$/);
    if (hit && normalizeRel(hit[1]).toLowerCase() === p) score += 100;
  }
  if (/\/(models|utils|core|helpers|base|misc)\.py$/.test(p)) score -= 18;
  // Hard demote non-source fixtures (was picking .dat/.fits and failing SEARCH)
  if (/\.(dat|csv|xml|json|yml|yaml|md|txt|fits|fit|hdr|png|jpg|jpeg|gif|gz|zip|whl|egg)$/i.test(base)) {
    score -= 120;
  }
  if (/\/(data|fixtures|testdata|sampledata)\//i.test(p)) score -= 50;
  if (/\.(py|js|ts|tsx|jsx|go|rs|java|c|cc|cpp|h|hpp)$/i.test(base)) score += 15;
  return score;
}

function rankAllowPaths(allowPaths, prompt, limit = 2) {
  const uniq = [];
  const seen = new Set();
  for (const raw of allowPaths || []) {
    const rel = normalizeRel(raw);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    uniq.push(rel);
  }
  const ranked = uniq
    .map((rel) => ({ rel, score: scorePathForPrompt(rel, prompt) }))
    .sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  if (!ranked.length) return [];
  // Keep only clear winners to avoid flooding small models with noise.
  const top = ranked[0].score;
  const focused = ranked.filter((x, i) => i === 0 || (x.score >= top - 15 && x.score >= 20));
  return focused.slice(0, limit).map((x) => x.rel);
}

function readContextFiles(workspace, relPaths, { maxFiles = 3, maxChars = 12000 } = {}) {
  const chunks = [];
  let used = 0;
  for (const rel of relPaths.slice(0, maxFiles)) {
    const abs = path.join(workspace, rel);
    if (!fs.pathExistsSync(abs) || !fs.statSync(abs).isFile()) continue;
    let text = "";
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.length > 7000) text = `${text.slice(0, 7000)}\n…(truncated)`;
    const block = `### FILE: ${rel}\n\`\`\`\n${text}\n\`\`\`\n`;
    if (used + block.length > maxChars) break;
    chunks.push(block);
    used += block.length;
  }
  return chunks.join("\n");
}

function extractUnifiedDiff(text) {
  const raw = String(text || "");
  const fence = raw.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1] : raw;
  const idx = body.search(/^diff --git /m);
  if (idx >= 0) body = body.slice(idx);
  else {
    const idx2 = body.search(/^--- /m);
    if (idx2 >= 0) body = body.slice(idx2);
  }
  body = body.trim();
  if (!body.includes("@@") && !body.includes("diff --git")) return "";
  if (!body.endsWith("\n")) body += "\n";
  return body;
}

function sanitizeUnifiedDiff(diffText) {
  let body = String(diffText || "").replace(/\r\n/g, "\n");
  // Drop trailing spaces on hunk lines that often break apply
  body = body
    .split("\n")
    .map((line) => {
      if (/^[+\- ]/.test(line) || line.startsWith("@@")) return line.replace(/[ \t]+$/, "");
      return line;
    })
    .join("\n");
  if (!body.endsWith("\n")) body += "\n";
  return body;
}

function applyUnifiedDiff(workspace, diffText) {
  const tmp = path.join(os.tmpdir(), `moguai-local-${Date.now()}.patch`);
  const cleaned = sanitizeUnifiedDiff(diffText);
  fs.writeFileSync(tmp, cleaned, "utf8");
  try {
    let applied = spawnSync("git", ["apply", "--whitespace=nowarn", tmp], {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
    if (applied.status !== 0) {
      applied = spawnSync("git", ["apply", "--3way", "--whitespace=nowarn", tmp], {
        cwd: workspace,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      });
    }
    if (applied.status !== 0) {
      return {
        ok: false,
        error: applied.stderr || applied.stdout || "git apply 失败",
        log: `${applied.stdout || ""}\n${applied.stderr || ""}`.trim(),
      };
    }
    return { ok: true, log: "git apply ok", mode: "unified_diff" };
  } finally {
    fs.removeSync(tmp);
  }
}

/**
 * Parse Aider-style SEARCH/REPLACE blocks.
 * Accepts:
 *   path/to/file
 *   <<<<<<< SEARCH
 *   ...
 *   =======
 *   ...
 *   >>>>>>> REPLACE
 */
function extractSearchReplaceBlocks(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  const blocks = [];
  const re =
    /(?:^|\n)(?:\*\*\*\s*Update File:\s*)?([^\n]+?)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let file = normalizeRel(m[1].replace(/^[`"'*\s]+|[`"'*\s]+$/g, "").replace(/^FILE:\s*/i, ""));
    if (!file || file.startsWith("```")) continue;
    blocks.push({
      file,
      search: m[2].replace(/\n$/, ""),
      replace: m[3].replace(/\n$/, ""),
    });
  }
  return blocks;
}

function collapseLine(s) {
  return String(s || "")
    .replace(/[ \t]+$/g, "")
    .replace(/[ \t]+/g, " ")
    .trimEnd();
}

function lineSpanToOffsets(fileLines, startLine, endLine) {
  let start = 0;
  for (let i = 0; i < startLine; i += 1) start += fileLines[i].length + 1;
  let end = start;
  for (let i = startLine; i < endLine; i += 1) {
    end += fileLines[i].length;
    if (i < endLine - 1) end += 1;
  }
  // Include final newline between lines already; if block is mid-file, keep as line contents only.
  return { start, end };
}

function findDefSpanByName(normText, defName) {
  if (!defName) return null;
  const fileLines = normText.split("\n");
  const startLine = fileLines.findIndex((l) => new RegExp(`^\\s*def\\s+${defName}\\s*\\(`).test(l));
  if (startLine < 0) return null;
  const indent = (fileLines[startLine].match(/^\s*/) || [""])[0].length;
  let endLine = fileLines.length;
  for (let i = startLine + 1; i < fileLines.length; i += 1) {
    const line = fileLines[i];
    if (!line.trim()) continue;
    const ind = (line.match(/^\s*/) || [""])[0].length;
    if (ind <= indent && /^(def|class|async\s+def)\s+/.test(line.trim())) {
      endLine = i;
      break;
    }
  }
  // Include trailing blank lines belonging to the def block lightly
  while (endLine > startLine + 1 && !fileLines[endLine - 1].trim()) endLine -= 1;
  const { start, end } = lineSpanToOffsets(fileLines, startLine, endLine);
  return { start, end, mode: "def_name", defName };
}

function findSearchSpan(normText, search) {
  if (!search) return null;
  const idx = normText.indexOf(search);
  if (idx >= 0) return { start: idx, end: idx + search.length, mode: "exact" };

  const fileLines = normText.split("\n");
  const searchLines = search.split("\n");
  // Ignore leading indent differences for soft matching
  const softFile = fileLines.map((l) => collapseLine(l).trimStart());
  const softSearch = searchLines.map((l) => collapseLine(l).trimStart());

  for (let i = 0; i <= softFile.length - softSearch.length; i += 1) {
    let ok = true;
    for (let j = 0; j < softSearch.length; j += 1) {
      if (softFile[i + j] !== softSearch[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const { start, end } = lineSpanToOffsets(fileLines, i, i + softSearch.length);
      return { start, end, mode: "soft_ws" };
    }
  }

  const defLine = searchLines.find((l) => /^\s*def\s+\w+\s*\(/.test(l));
  const defName = defLine && (defLine.match(/^\s*def\s+(\w+)\s*\(/) || [])[1];
  if (defName) {
    const byName = findDefSpanByName(normText, defName);
    if (byName) return byName;
  }

  const first = searchLines.find((l) => l.trim()) || "";
  const last = [...searchLines].reverse().find((l) => l.trim()) || "";
  if (first) {
    const startLine = softFile.findIndex((l) => l === first.trim());
    if (startLine >= 0) {
      let endLine = Math.min(fileLines.length, startLine + Math.max(1, searchLines.length));
      if (last && searchLines.length > 1) {
        for (let k = startLine + 1; k < Math.min(fileLines.length, startLine + searchLines.length + 12); k += 1) {
          if (softFile[k] === last.trim()) {
            endLine = k + 1;
            break;
          }
        }
      }
      const { start, end } = lineSpanToOffsets(fileLines, startLine, endLine);
      return { start, end, mode: "anchor" };
    }
  }
  return null;
}

function applySearchReplaceBlocks(workspace, blocks) {
  if (!blocks.length) return { ok: false, error: "无 SEARCH/REPLACE 块", log: "" };
  const touched = [];
  const logs = [];
  for (const block of blocks) {
    const abs = path.join(workspace, block.file);
    if (!fs.pathExistsSync(abs)) {
      return { ok: false, error: `文件不存在: ${block.file}`, log: logs.join("\n") };
    }
    const original = fs.readFileSync(abs, "utf8");
    const nl = original.includes("\r\n") ? "\r\n" : "\n";
    const norm = original.replace(/\r\n/g, "\n");
    const search = block.search.replace(/\r\n/g, "\n");
    const replace = block.replace.replace(/\r\n/g, "\n");
    if (!search) {
      return { ok: false, error: `空 SEARCH: ${block.file}`, log: logs.join("\n") };
    }
    const span = findSearchSpan(norm, search);
    if (!span) {
      return {
        ok: false,
        error: `SEARCH 未命中: ${block.file}`,
        log: [...logs, `miss ${block.file} searchHead=${search.slice(0, 160)}`].join("\n"),
      };
    }
    let replacement = replace;
    // When matching a whole function by name, prefer REPLACE that also defines it;
    // if REPLACE is a partial body, keep SEARCH-sized replacement as-is.
    if (span.mode === "def_name" && span.defName) {
      if (!new RegExp(`^\\s*def\\s+${span.defName}\\s*\\(`, "m").test(replace)) {
        // Model gave body-only / wrong indent — still apply if non-empty
        replacement = replace.trimEnd();
      }
    }
    const next = norm.slice(0, span.start) + replacement + norm.slice(span.end);
    fs.writeFileSync(abs, next.split("\n").join(nl), "utf8");
    touched.push(block.file);
    logs.push(`replace ok ${block.file} (${span.mode})`);
  }
  return { ok: true, log: logs.join("\n"), mode: "search_replace", files: touched };
}

function buildSystemPrompt() {
  return [
    "You are a precise coding agent.",
    "Output ONLY one or more SEARCH/REPLACE edits. No prose. No unified diffs.",
    "Format exactly:",
    "path/relative/to/file.py",
    "<<<<<<< SEARCH",
    "exact lines from the file (copy verbatim)",
    "=======",
    "replacement lines",
    ">>>>>>> REPLACE",
    "Rules:",
    "- SEARCH must match the file exactly (including indentation).",
    "- Prefer the smallest change that fixes the issue.",
    "- Only edit allowed files listed by the user.",
    "- Fix production/library implementation code; do not weaken, delete, or skip tests.",
    "- Do not add new test files or monkey-patch unrelated modules.",
    "- Never edit .dat/.fits/.csv fixtures unless explicitly required.",
    "- If multiple edits needed, output multiple blocks.",
  ].join("\n");
}

function buildUserPrompt(prompt, paths, context, feedback = "") {
  return [
    "### Task",
    String(prompt || "").trim(),
    "",
    paths.length ? `### Allowed files\n${paths.map((p) => `- ${p}`).join("\n")}` : "",
    "",
    "### Current file contents",
    context || "(empty)",
    feedback
      ? `\n### Previous attempt failed\n${feedback}\nProduce corrected SEARCH/REPLACE using the current file contents above.\n`
      : "",
    "",
    "Output SEARCH/REPLACE blocks only.",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveBlockFile(file, allowPaths = []) {
  const rel = normalizeRel(file);
  if (!rel) return "";
  if (!allowPaths.length) return rel;
  if (allowPaths.includes(rel)) return rel;
  const base = path.posix.basename(rel);
  const byBase = allowPaths.find((p) => path.posix.basename(p) === base);
  if (byBase) return byBase;
  const bySuffix = allowPaths.find((p) => p.endsWith("/" + rel) || rel.endsWith("/" + p));
  if (bySuffix) return bySuffix;
  return "";
}

function filterBlocksToAllow(blocks, allowPaths = []) {
  if (!allowPaths.length) return blocks;
  const out = [];
  for (const b of blocks) {
    const file = resolveBlockFile(b.file, allowPaths);
    if (!file) continue;
    out.push({ ...b, file });
  }
  return out;
}

function gitPorcelainDirty(workspace) {
  const dirty = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  return String(dirty.stdout || "").trim().length > 0;
}

function classifyVerifyFailure(log) {
  const t = String(log || "");
  const hasTestFail = /\bFAILED\b|AssertionError|E\s+assert|Error:\s+\d+\s+failed/i.test(t);
  const hasEnv =
    /ModuleNotFoundError|ImportError|No module named|ImproperlyConfigured|collecting\s+\.\.\.\s+error|ERROR:\s+file or directory not found/i.test(
      t
    );
  if (hasEnv && !hasTestFail) return "env";
  return "test";
}

function runWorkspaceVerify(workspace, verifyCommand, { timeoutMs = 180_000, name = "verify" } = {}) {
  const cmd = String(verifyCommand || "").trim();
  if (!cmd) return null;
  const env = {
    ...process.env,
    PYTHONPATH: [workspace, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
    PYTHONDONTWRITEBYTECODE: "1",
  };
  const r =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", cmd], {
          cwd: workspace,
          encoding: "utf8",
          windowsHide: true,
          timeout: timeoutMs,
          env,
        })
      : spawnSync("sh", ["-c", cmd], {
          cwd: workspace,
          encoding: "utf8",
          timeout: timeoutMs,
          env,
        });
  const log = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  const ok = r.status === 0;
  return {
    ok,
    name,
    command: cmd,
    log: log.slice(-4000),
    error: ok ? null : `${name} exit ${r.status}`,
    kind: ok ? "ok" : classifyVerifyFailure(log),
  };
}

function normalizeVerifyStages(verifyCommand, verifyStages) {
  if (Array.isArray(verifyStages) && verifyStages.length) {
    return verifyStages
      .map((s) => ({
        name: String(s?.name || "verify").trim() || "verify",
        command: String(s?.command || "").trim(),
      }))
      .filter((s) => s.command);
  }
  const cmd = String(verifyCommand || "").trim();
  return cmd ? [{ name: "verify", command: cmd }] : [];
}

function runVerifyStages(workspace, stages, { timeoutMs = 180_000 } = {}) {
  const list = Array.isArray(stages) ? stages : [];
  if (!list.length) return { ok: true, skipped: true, results: [] };
  const results = [];
  for (const stage of list) {
    const one = runWorkspaceVerify(workspace, stage.command, {
      timeoutMs,
      name: stage.name || "verify",
    });
    results.push(one);
    if (!one.ok) {
      return {
        ok: false,
        skipped: false,
        failedStage: one.name,
        kind: one.kind,
        results,
        log: one.log,
        command: one.command,
        error: one.error,
      };
    }
  }
  return { ok: true, skipped: false, results, kind: "ok" };
}

function resetWorkspaceToHead(workspace) {
  spawnSync("git", ["checkout", "--", "."], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  spawnSync("git", ["clean", "-fd"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
}

/** Prefer SEARCH/REPLACE; strip accidental unified-diff fences that break apply. */
function preferSearchReplaceRaw(raw) {
  const text = String(raw || "");
  if (/<<<<<<< SEARCH/.test(text)) {
    // Drop leading/trailing prose and fenced diffs that confuse parsers.
    return text.replace(/```(?:diff|patch)[\s\S]*?```/gi, "");
  }
  return text;
}

/**
 * Multi-round patch loop: read → SEARCH/REPLACE → apply → staged verify → feedback.
 * @param {{
 *   workspace: string,
 *   prompt: string,
 *   model?: string,
 *   allowPaths?: string[],
 *   timeoutMs?: number,
 *   maxAttempts?: number,
 *   verifyCommand?: string,
 *   verifyStages?: Array<{ name?: string, command: string }>,
 *   baseUrl?: string,
 *   apiKey?: string,
 * }} opts
 */
async function runLocalPatch({
  workspace,
  prompt,
  model = "qwen3:8b",
  allowPaths = [],
  timeoutMs = 300_000,
  maxAttempts = 2,
  verifyCommand = "",
  verifyStages = null,
  dockerImage = "",
  dockerStrict = false,
  dockerSwe = false,
  baseUrl = "",
  apiKey = "",
} = {}) {
  const ws = String(workspace || "").trim();
  if (!ws || !fs.pathExistsSync(ws)) {
    return { ok: false, error: "工作区不存在", code: "workspace_missing", engine: "local_ollama_patch" };
  }

  const cloud =
    Boolean(String(baseUrl || process.env.OPENAI_BASE_URL || "").trim()) &&
    Boolean(String(apiKey || process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "").trim()) &&
    !/11434/.test(String(baseUrl || process.env.OPENAI_BASE_URL || ""));
  const engineName = cloud ? "cloud_openai_patch" : "local_ollama_patch";
  const { runVerifyWithOptionalDocker } = require("./coding-docker-verify");
  const image = String(dockerImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim();
  const strict =
    Boolean(dockerStrict) ||
    process.env.MOGU_DOCKER_VERIFY_STRICT === "1" ||
    process.env.MOGU_SWE_DOCKER_VERIFY === "1";
  const swe =
    Boolean(dockerSwe) ||
    process.env.MOGU_VERIFY_DOCKER_SWE === "1" ||
    /sweb\.eval\./i.test(image);

  const paths = rankAllowPaths(allowPaths, prompt, cloud ? 3 : 2);
  const stages = normalizeVerifyStages(verifyCommand, verifyStages);
  const system = buildSystemPrompt();
  let feedback = "";
  let lastRaw = "";
  let lastError = "";
  const attemptLogs = [];
  const defaultAttempts = cloud ? (stages.length ? 5 : 4) : 2;
  const attempts = Math.max(defaultAttempts, Number(maxAttempts) || defaultAttempts);
  let mode = "search_replace";
  let lastAppliedLog = "";
  let lastVerify = null;

  const finishOk = ({ appliedLog, patch, attempt, verify }) => {
    const softEnv = verify?.kind === "env" && !strict;
    return {
      ok: true,
      error: null,
      engine: engineName,
      command: `${cloud ? "openai" : "ollama"}:${model} → ${mode}`,
      log: [...attemptLogs, appliedLog, String(lastRaw).slice(0, 2000)].join("\n---\n"),
      patch,
      model,
      mode,
      attempts: attempt,
      focusPaths: paths,
      verifyOk: verify?.skipped ? null : softEnv ? null : Boolean(verify?.ok),
      verifySkipped: verify?.skipped ? true : softEnv ? "env" : null,
      failToPassOk:
        verify?.results?.find((r) => /FAIL_TO_PASS/i.test(r.name))?.ok ??
        (verify?.skipped || softEnv ? null : verify?.ok),
      passToPassOk: verify?.results?.find((r) => /PASS_TO_PASS/i.test(r.name))?.ok ?? null,
      verifyStages: (verify?.results || []).map((r) => ({
        name: r.name,
        ok: r.ok,
        kind: r.kind,
        command: r.command,
      })),
    };
  };

  const handleVerify = (attempt, appliedLog) => {
    const verify = runVerifyWithOptionalDocker(ws, stages, {
      timeoutMs: 300_000,
      dockerImage: image,
      dockerStrict: strict,
      dockerSwe: swe,
    });
    lastVerify = verify;
    if (verify.skipped || verify.ok) {
      return { done: true, verify };
    }
    if (verify.kind === "env" && !strict) {
      // Host env missing deps — soft skip only when not in Docker-strict mode.
      attemptLogs.push(`attempt ${attempt}: verify_env_skip stage=${verify.failedStage}`);
      return { done: true, verify: { ...verify, ok: true, kind: "env" } };
    }
    lastError = verify.error || "verify failed";
    feedback = [
      `Code changed but ${verify.failedStage || "verify"} failed (via=${verify.via || "host"}). Fix with minimal SEARCH/REPLACE.`,
      "Do not break previously passing tests. Prefer the smallest production-code fix.",
      `Command: ${verify.command}`,
      verify.log || "",
    ]
      .join("\n")
      .slice(0, 2400);
    attemptLogs.push(`attempt ${attempt}: verify_failed stage=${verify.failedStage} kind=${verify.kind}`);
    mode = "search_replace";
    return { done: false, verify };
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      resetWorkspaceToHead(ws);
    }
    const context = paths.length
      ? readContextFiles(ws, paths, { maxFiles: Math.min(3, paths.length), maxChars: cloud ? 18000 : 14000 })
      : "No file contents attached. Infer paths from the issue.";

    let raw = "";
    try {
      raw = await modelChat(
        model,
        [
          { role: "system", content: system },
          { role: "user", content: buildUserPrompt(prompt, paths, context, feedback) },
        ],
        { timeoutMs, baseUrl, apiKey }
      );
    } catch (error) {
      return {
        ok: false,
        error: error.message || String(error),
        code: "llm_failed",
        engine: engineName,
        log: attemptLogs.join("\n"),
      };
    }
    lastRaw = preferSearchReplaceRaw(raw);

    let blocks = filterBlocksToAllow(extractSearchReplaceBlocks(lastRaw), paths.length ? paths : allowPaths);
    if (blocks.length) {
      const applied = applySearchReplaceBlocks(ws, blocks);
      attemptLogs.push(`attempt ${attempt}: sr blocks=${blocks.length} ok=${applied.ok}`);
      lastAppliedLog = applied.log || "";
      if (applied.ok) {
        if (!gitPorcelainDirty(ws)) {
          lastError = "补丁已应用但工作区无改动（空改/未命中有效差异）";
          feedback = `${lastError}. Produce a real code change in SEARCH/REPLACE.`;
          attemptLogs.push(`attempt ${attempt}: noop_change`);
          continue;
        }
        mode = "search_replace";
        const outcome = handleVerify(attempt, applied.log);
        if (outcome.done) {
          return finishOk({
            appliedLog: applied.log,
            patch: blocks
              .map((b) => `${b.file}\n<<<<<<< SEARCH\n${b.search}\n=======\n${b.replace}\n>>>>>>> REPLACE`)
              .join("\n\n"),
            attempt,
            verify: outcome.verify,
          });
        }
        continue;
      }
      lastError = applied.error || "search_replace failed";
      const hintFile =
        blocks[0]?.file && paths.includes(normalizeRel(blocks[0].file))
          ? normalizeRel(blocks[0].file)
          : paths[0];
      let excerpt = "";
      if (hintFile) {
        try {
          const abs = path.join(ws, hintFile);
          const body = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
          const lines = body.split("\n");
          const hit = lines.findIndex((l) => {
            const def = (l.match(/def\s+(\w+)/) || l.match(/class\s+(\w+)/) || [])[1];
            return def && String(prompt).includes(def);
          });
          const start = hit >= 0 ? hit : 0;
          excerpt = lines.slice(start, start + 40).join("\n");
        } catch {
          excerpt = "";
        }
      }
      feedback = [
        applied.error,
        applied.log || "",
        excerpt ? `Copy SEARCH verbatim from this excerpt of ${hintFile}:\n${excerpt}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1800);
      continue;
    }

    // Fallback only if model emitted a unified diff and no SEARCH/REPLACE.
    const diff = extractUnifiedDiff(lastRaw);
    if (diff) {
      const applied = applyUnifiedDiff(ws, diff);
      attemptLogs.push(`attempt ${attempt}: unified_diff ok=${applied.ok}`);
      lastAppliedLog = applied.log || "";
      if (applied.ok && gitPorcelainDirty(ws)) {
        mode = "unified_diff";
        const outcome = handleVerify(attempt, applied.log);
        if (outcome.done) {
          return finishOk({
            appliedLog: applied.log,
            patch: sanitizeUnifiedDiff(diff),
            attempt,
            verify: outcome.verify,
          });
        }
        continue;
      }
      lastError = applied.error || "git apply failed";
      feedback = `git apply failed: ${lastError}\nProduce corrected SEARCH/REPLACE instead (no unified diff).`.slice(
        0,
        1200
      );
      continue;
    }

    lastError = "未产出 SEARCH/REPLACE 或 unified diff";
    feedback = "Output must be SEARCH/REPLACE blocks with exact file content in SEARCH.";
    attemptLogs.push(`attempt ${attempt}: no_parse`);
  }

  return {
    ok: false,
    error: lastError || "模型补丁失败",
    code: "apply_failed",
    engine: engineName,
    command: `${cloud ? "openai" : "ollama"}:${model} → multi_round_patch`,
    log: [...attemptLogs, lastAppliedLog, String(lastRaw).slice(0, 2500)].join("\n---\n"),
    model,
    focusPaths: paths,
    verifyOk: lastVerify ? Boolean(lastVerify.ok) : null,
    failToPassOk: lastVerify?.results?.find((r) => /FAIL_TO_PASS/i.test(r.name))?.ok ?? null,
    passToPassOk: lastVerify?.results?.find((r) => /PASS_TO_PASS/i.test(r.name))?.ok ?? null,
  };
}

/** Alias for autonomy docs / callers. */
const runMultiRoundPatch = runLocalPatch;

function shouldUseLocalPatch(settings = {}, args = {}) {
  if (args.localPatch === false || args.forceEngine === true) return false;
  if (args.localPatch === true) return true;
  if (process.env.MOGU_LOCAL_PATCH === "0") return false;
  // Cloud 中转：显式开启直出补丁（避开 Codex 工具环挂起）
  if (process.env.MOGU_CLOUD_PATCH === "1") return true;
  const ollama =
    settings.codingUseOllama === true ||
    String(settings.agentApiPreset || "").toLowerCase() === "ollama" ||
    process.env.MOGU_USE_OLLAMA === "1";
  return ollama;
}

module.exports = {
  runLocalPatch,
  runMultiRoundPatch,
  shouldUseLocalPatch,
  extractUnifiedDiff,
  extractSearchReplaceBlocks,
  applyUnifiedDiff,
  applySearchReplaceBlocks,
  sanitizeUnifiedDiff,
  rankAllowPaths,
  filterBlocksToAllow,
  ollamaChat,
  openaiCompatibleChat,
  modelChat,
  normalizeVerifyStages,
  runVerifyStages,
  classifyVerifyFailure,
  resetWorkspaceToHead,
};
