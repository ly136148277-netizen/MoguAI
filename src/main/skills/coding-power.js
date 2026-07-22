/**
 * Coding power layer: project rules, hunk accept/reject, verify-fix loop helpers, dual-engine compare scoring.
 */

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { spawnSync } = require("node:child_process");
const {
  runGit,
  isGitRepo,
  collectGitReview,
  runVerify,
} = require("./coding-review");

const RULE_FILES = [
  ".moguai/rules.md",
  "MOGUAI.md",
  "AGENTS.md",
  ".cursorrules",
  ".moguai/AGENTS.md",
];

function runGitCapture(workspace, args, timeoutMs = 60_000) {
  return runGit(workspace, args, timeoutMs);
}

async function loadProjectContext(workspace, { maxRuleChars = 6000 } = {}) {
  const ws = String(workspace || "").trim();
  const rules = [];
  const sources = [];
  if (!ws || !(await fs.pathExists(ws))) {
    return { ok: false, preamble: "", rules: [], sources: [], indexSummary: "" };
  }
  for (const rel of RULE_FILES) {
    const abs = path.join(ws, rel);
    if (!(await fs.pathExists(abs))) continue;
    try {
      const text = String(await fs.readFile(abs, "utf8")).trim();
      if (!text) continue;
      sources.push(rel);
      rules.push(`### ${rel}\n${text.slice(0, maxRuleChars)}`);
    } catch {
      /* ignore */
    }
  }
  let indexSummary = "";
  try {
    const names = await fs.readdir(ws);
    const top = names
      .filter((n) => !n.startsWith(".") && n !== "node_modules")
      .slice(0, 24);
    const pkgPath = path.join(ws, "package.json");
    let pkgLine = "";
    if (await fs.pathExists(pkgPath)) {
      const pkg = await fs.readJson(pkgPath).catch(() => null);
      if (pkg?.name) pkgLine = `package: ${pkg.name}${pkg.version ? `@${pkg.version}` : ""}`;
    }
    indexSummary = [pkgLine, top.length ? `顶层：${top.join(", ")}` : ""].filter(Boolean).join("\n");
  } catch {
    indexSummary = "";
  }
  const preamble = [
    "【项目约定 — 必须遵守】",
    rules.length ? rules.join("\n\n") : "（未找到 .moguai/rules.md / AGENTS.md 等约定文件）",
    indexSummary ? `\n【仓库速览】\n${indexSummary}` : "",
    "【改码约束】只改完成任务所需的最小文件集；不要无关重构；保持现有风格。",
  ]
    .filter(Boolean)
    .join("\n");
  return { ok: true, preamble, rules, sources, indexSummary };
}

function enrichPrompt(userPrompt, projectContext) {
  const base = String(userPrompt || "").trim();
  const pre = String(projectContext?.preamble || "").trim();
  if (!pre) return base;
  return `${pre}\n\n【用户任务】\n${base}`;
}

/**
 * Parse unified diff into hunks.
 * Each hunk: { id, file, header, body, text }
 */
function parseDiffHunks(diffText) {
  const lines = String(diffText || "").split(/\r?\n/);
  const hunks = [];
  let file = null;
  let i = 0;
  let hunkIndex = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      const m = line.match(/b\/(.+)$/);
      file = m ? m[1] : null;
      i += 1;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      if (p !== "/dev/null") file = p.replace(/^b\//, "");
      i += 1;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const header = line;
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("@@ ") && !lines[i].startsWith("diff --git ")) {
        body.push(lines[i]);
        i += 1;
      }
      const id = `${file || "unknown"}#${hunkIndex}`;
      hunks.push({
        id,
        index: hunkIndex,
        file: file || "unknown",
        header,
        body,
        text: [header, ...body].join("\n"),
      });
      hunkIndex += 1;
      continue;
    }
    i += 1;
  }
  return hunks;
}

function reverseHunkBody(bodyLines) {
  return bodyLines.map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) return `-${line.slice(1)}`;
    if (line.startsWith("-") && !line.startsWith("---")) return `+${line.slice(1)}`;
    return line;
  });
}

function reverseHunkHeader(header) {
  // @@ -a,b +c,d @@  → @@ -c,d +a,b @@
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@(.*)$/);
  if (!m) return header;
  const oldStart = m[1];
  const oldCount = m[2] || "1";
  const newStart = m[3];
  const newCount = m[4] || "1";
  const rest = m[5] || "";
  return `@@ -${newStart},${newCount} +${oldStart},${oldCount} @@${rest}`;
}

function buildReversePatchForHunk(hunk) {
  const file = hunk.file;
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    reverseHunkHeader(hunk.header),
    ...reverseHunkBody(hunk.body),
    "",
  ].join("\n");
}

function listHunks(workspace) {
  const review = collectGitReview(workspace);
  if (!review.ok || review.git === false) {
    return { ok: false, error: review.error || "无法列出 hunk（需要 Git diff）", hunks: [], review };
  }
  const hunks = parseDiffHunks(review.diff || "");
  return { ok: true, hunks, review, count: hunks.length };
}

function rejectHunk(workspace, hunkId) {
  const listed = listHunks(workspace);
  if (!listed.ok) return listed;
  const hunk = listed.hunks.find((h) => h.id === hunkId || String(h.index) === String(hunkId));
  if (!hunk) return { ok: false, error: `未找到 hunk：${hunkId}`, hunks: listed.hunks };
  const patch = buildReversePatchForHunk(hunk);
  const tmp = path.join(os.tmpdir(), `moguai-hunk-${Date.now()}.patch`);
  fs.writeFileSync(tmp, patch, "utf8");
  try {
    const applied = spawnSync("git", ["apply", "--verbose", tmp], {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    if (applied.status !== 0) {
      const retry = spawnSync("git", ["apply", "--reject", "--verbose", tmp], {
        cwd: workspace,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
      });
      if (retry.status !== 0) {
        return {
          ok: false,
          error: applied.stderr || retry.stderr || "git apply 拒绝 hunk 失败",
          hunk,
        };
      }
    }
    const review = collectGitReview(workspace);
    const hunks = parseDiffHunks(review.diff || "");
    return { ok: true, rejected: hunk.id, message: `已拒绝 ${hunk.id}`, review, hunks };
  } finally {
    fs.removeSync(tmp);
  }
}

function acceptHunk(workspace, hunkId) {
  // Accept = keep hunk; we only re-list. Staging single hunk needs add -p; keep semantic "mark kept".
  const listed = listHunks(workspace);
  if (!listed.ok) return listed;
  const hunk = listed.hunks.find((h) => h.id === hunkId || String(h.index) === String(hunkId));
  if (!hunk) return { ok: false, error: `未找到 hunk：${hunkId}`, hunks: listed.hunks };
  return {
    ok: true,
    accepted: hunk.id,
    message: `保留 ${hunk.id}（未拒绝即接受；确认提交前可继续拒其它 hunk）`,
    hunks: listed.hunks,
    review: listed.review,
  };
}

function assessChangeQuality(review, prompt = "") {
  const files = review?.files || [];
  const paths = files.map((f) => f.path);
  const flags = [];
  if (paths.length >= 15) flags.push(`改动文件偏多（${paths.length}），可能有误伤`);
  const promptLower = String(prompt || "").toLowerCase();
  const tokens = promptLower
    .split(/[^a-z0-9_./\\-]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 20);
  if (tokens.length && paths.length) {
    const unrelated = paths.filter((p) => {
      const pl = p.toLowerCase();
      return !tokens.some((t) => pl.includes(t));
    });
    if (unrelated.length >= 5 && unrelated.length > paths.length * 0.6) {
      flags.push(`多份改动与任务关键词关联弱：${unrelated.slice(0, 5).join(", ")}`);
    }
  }
  const lockfiles = paths.filter((p) => /package-lock|pnpm-lock|yarn\.lock|uv\.lock/i.test(p));
  if (lockfiles.length && paths.length > lockfiles.length + 2) {
    flags.push("含锁文件改动，请确认是否必要");
  }
  return {
    ok: flags.length === 0,
    flags,
    fileCount: paths.length,
    warning: flags.length ? flags.join("；") : null,
  };
}

function scoreEngineTrial({ verify, review, quality }) {
  let score = 0;
  if (verify?.ok) score += 100;
  else if (verify) score += 10;
  if (review?.canCommit) score += 20;
  const n = review?.fileCount || review?.files?.length || 0;
  if (n > 0 && n <= 8) score += 15;
  else if (n > 8 && n <= 20) score += 5;
  else if (n > 20) score -= 10;
  if (quality?.ok) score += 15;
  else if (quality?.flags?.length) score -= quality.flags.length * 5;
  return score;
}

function savePatch(workspace, label) {
  const diff = runGitCapture(workspace, ["diff", "--binary"]);
  const untracked = runGitCapture(workspace, ["ls-files", "--others", "--exclude-standard"]);
  const patchPath = path.join(os.tmpdir(), `moguai-${label}-${Date.now()}.patch`);
  fs.writeFileSync(patchPath, diff.stdout || "", "utf8");
  return {
    patchPath,
    hasDiff: Boolean(String(diff.stdout || "").trim()),
    untracked: String(untracked.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

function resetHardClean(workspace) {
  runGitCapture(workspace, ["reset", "--hard", "HEAD"]);
  runGitCapture(workspace, ["clean", "-fd"]);
}

function applyPatchFile(workspace, patchPath) {
  if (!patchPath || !fs.pathExistsSync(patchPath)) {
    return { ok: false, error: "补丁不存在" };
  }
  const body = fs.readFileSync(patchPath, "utf8");
  if (!String(body).trim()) return { ok: true, empty: true };
  const applied = spawnSync("git", ["apply", "--whitespace=nowarn", patchPath], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  if (applied.status !== 0) {
    return { ok: false, error: applied.stderr || applied.stdout || "git apply 失败" };
  }
  return { ok: true };
}

module.exports = {
  RULE_FILES,
  loadProjectContext,
  enrichPrompt,
  parseDiffHunks,
  listHunks,
  rejectHunk,
  acceptHunk,
  assessChangeQuality,
  scoreEngineTrial,
  savePatch,
  resetHardClean,
  applyPatchFile,
  runVerify,
};
