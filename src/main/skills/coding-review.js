/**
 * Git review surface for coding tasks: changed files, diff preview, confirm commit, optional verify.
 */

const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const path = require("path");

function runGit(workspace, args, timeoutMs = 30_000) {
  const result = spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error?.message || null,
  };
}

function isGitRepo(workspace) {
  if (!workspace || !fs.pathExistsSync(workspace)) return false;
  const r = runGit(workspace, ["rev-parse", "--is-inside-work-tree"]);
  return r.ok && /true/i.test(r.stdout.trim());
}

function parsePorcelain(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      let filePath = line.slice(3).trim();
      // rename: "R  old -> new"
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop().trim();
      }
      return { status: status.trim() || status, path: filePath };
    })
    .filter((f) => f.path);
}

function extractPathsFromText(text, limit = 40) {
  const raw = String(text || "");
  const hits = new Set();
  const patterns = [
    /(?:^|\s)((?:[A-Za-z]:)?[^\s:*?"<>|]+\.[A-Za-z0-9]{1,8})/g,
    /(?:modified|changed|wrote|updated|created|edited)[:\s]+([^\s,]+)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(raw)) && hits.size < limit) {
      const p = String(m[1] || "").replace(/^[`'"]+|[`'"]+$/g, "");
      if (p.includes("/") || p.includes("\\") || /\.[A-Za-z0-9]+$/.test(p)) {
        hits.add(p.replace(/\\/g, "/"));
      }
    }
  }
  return [...hits].slice(0, limit);
}

/**
 * Collect review payload for a workspace after a coding run.
 */
function collectGitReview(workspace, { log = "", trajectorySummary = "", maxDiffChars = 16000 } = {}) {
  const ws = String(workspace || "").trim();
  if (!ws || !fs.pathExistsSync(ws)) {
    return { ok: false, error: "工作区不存在", code: "workspace_missing", files: [], diff: "" };
  }

  if (!isGitRepo(ws)) {
    const guessed = extractPathsFromText(`${log}\n${trajectorySummary}`);
    return {
      ok: true,
      git: false,
      workspace: ws,
      files: guessed.map((p) => ({ status: "?", path: p })),
      fileCount: guessed.length,
      diff: "",
      summary:
        guessed.length > 0
          ? `非 Git 仓库；从日志猜测 ${guessed.length} 个路径（无法生成 diff / 提交）`
          : "非 Git 仓库；无文件列表与 diff。可在工作区初始化 git 后使用审阅提交。",
      canCommit: false,
    };
  }

  const status = runGit(ws, ["status", "--porcelain"]);
  const files = parsePorcelain(status.stdout);
  const unstaged = runGit(ws, ["diff", "--no-color"]);
  const staged = runGit(ws, ["diff", "--cached", "--no-color"]);
  let diff = [staged.stdout, unstaged.stdout].filter((s) => String(s).trim()).join("\n\n");
  if (!diff.trim() && files.length) {
    // untracked: show names only
    diff = files.map((f) => `${f.status} ${f.path}`).join("\n");
  }
  if (diff.length > maxDiffChars) {
    diff = `${diff.slice(0, maxDiffChars)}\n…（diff 已截断）`;
  }

  const fileList = files.map((f) => `${f.status} ${f.path}`).join("\n");
  return {
    ok: true,
    git: true,
    workspace: ws,
    files,
    fileCount: files.length,
    diff,
    summary:
      files.length > 0
        ? `改动 ${files.length} 个文件：\n${fileList}`
        : "工作区干净（无未提交改动）。引擎可能未改文件，或改动已提交。",
    canCommit: files.length > 0,
  };
}

function suggestCommitMessage({ prompt = "", files = [] } = {}) {
  const base = String(prompt || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 72);
  if (base) return base.startsWith("fix") || base.startsWith("feat") ? base : `chore: ${base}`;
  if (files.length === 1) return `chore: update ${files[0].path}`;
  if (files.length > 1) return `chore: update ${files.length} files`;
  return "chore: coding agent changes";
}

function commitWorkspace(workspace, message, { addAll = true } = {}) {
  const ws = String(workspace || "").trim();
  const msg = String(message || "").trim();
  if (!ws || !fs.pathExistsSync(ws)) {
    return { ok: false, error: "工作区不存在", code: "workspace_missing" };
  }
  if (!msg) return { ok: false, error: "缺少提交说明", code: "message_empty" };
  if (!isGitRepo(ws)) {
    return { ok: false, error: "不是 Git 仓库，无法提交", code: "not_a_git_repo" };
  }
  if (addAll) {
    const add = runGit(ws, ["add", "-A"]);
    if (!add.ok) {
      return { ok: false, error: add.stderr || add.error || "git add 失败", code: "git_add_failed" };
    }
  }
  const commit = runGit(ws, ["commit", "-m", msg]);
  if (!commit.ok) {
    const err = commit.stderr || commit.stdout || commit.error || "git commit 失败";
    if (/nothing to commit/i.test(err)) {
      return { ok: false, error: "没有可提交的改动", code: "nothing_to_commit" };
    }
    return { ok: false, error: err.slice(0, 500), code: "git_commit_failed" };
  }
  const head = runGit(ws, ["rev-parse", "--short", "HEAD"]);
  return {
    ok: true,
    workspace: ws,
    message: msg,
    commit: head.stdout.trim() || null,
    log: commit.stdout.slice(0, 500),
  };
}

function runVerify(workspace, command) {
  const ws = String(workspace || "").trim();
  const cmd = String(command || "").trim();
  if (!ws || !fs.pathExistsSync(ws)) {
    return { ok: false, error: "工作区不存在", code: "workspace_missing" };
  }
  if (!cmd) return { ok: false, error: "缺少 verify 命令", code: "command_empty" };

  const isWin = process.platform === "win32";
  const result = spawnSync(isWin ? "cmd" : "sh", isWin ? ["/c", cmd] : ["-c", cmd], {
    cwd: ws,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
    env: process.env,
  });
  const log = `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(0, 8000);
  return {
    ok: result.status === 0,
    exitCode: result.status,
    command: cmd,
    workspace: ws,
    log,
    error: result.status === 0 ? null : `验证命令退出码 ${result.status}`,
  };
}

function installFixHints(engineProbe = {}) {
  const hints = [];
  const copyCommands = [];
  const codex = engineProbe.codex || engineProbe;
  const trae = engineProbe.trae;

  if (codex && codex.installed === false) {
    hints.push(codex.message || "Codex 未就绪");
    copyCommands.push("npm i -g @openai/codex");
    copyCommands.push("codex --version");
    if (codex.vendorRepo) {
      hints.push(`已检测到源码旁路：${codex.vendorRepo}（可设置 codingCodexPath 指向其 CLI）`);
    }
  } else if (codex?.installed && codex.message && codex.message !== "就绪") {
    hints.push(`Codex：${codex.message}`);
  }

  if (trae && trae.installed === false) {
    hints.push(trae.message || "trae-agent 未就绪");
    const vendor = trae.vendorRepo || path.join("D:", "Project", "vendor", "trae-agent");
    copyCommands.push(`cd /d ${vendor}`);
    copyCommands.push("uv sync");
    copyCommands.push("uv run trae-cli --help");
  } else if (trae?.installed && trae.message && trae.message !== "就绪") {
    hints.push(`trae：${trae.message}`);
  }

  return {
    hints,
    copyCommands: [...new Set(copyCommands)],
    fixText: [...hints, "", "可复制命令：", ...copyCommands.map((c) => `  ${c}`)].join("\n").trim(),
  };
}

module.exports = {
  runGit,
  isGitRepo,
  parsePorcelain,
  extractPathsFromText,
  collectGitReview,
  suggestCommitMessage,
  commitWorkspace,
  runVerify,
  installFixHints,
};
