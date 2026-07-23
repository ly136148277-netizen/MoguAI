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

function normalizeRelPath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

function resolveSafePath(workspace, relPath) {
  const rel = normalizeRelPath(relPath);
  if (!rel || rel.includes("..")) return null;
  const abs = path.resolve(workspace, rel);
  const root = path.resolve(workspace);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return { abs, rel };
}

/**
 * Reject worker changes: restore tracked files / delete untracked.
 * Empty paths → discard all local changes in the repo.
 */
function discardWorkspaceChanges(workspace, { paths = [] } = {}) {
  const ws = String(workspace || "").trim();
  if (!ws || !fs.pathExistsSync(ws)) {
    return { ok: false, error: "工作区不存在", code: "workspace_missing" };
  }
  if (!isGitRepo(ws)) {
    return { ok: false, error: "不是 Git 仓库，无法按文件拒绝改动", code: "not_a_git_repo" };
  }

  const status = runGit(ws, ["status", "--porcelain"]);
  const all = parsePorcelain(status.stdout);
  const wanted = (Array.isArray(paths) ? paths : []).map(normalizeRelPath).filter(Boolean);
  const targets = wanted.length
    ? all.filter((f) => wanted.includes(normalizeRelPath(f.path)))
    : all;

  if (!targets.length) {
    return {
      ok: true,
      discarded: [],
      message: "没有可拒绝的改动",
      review: collectGitReview(ws),
    };
  }

  const discarded = [];
  const errors = [];
  for (const file of targets) {
    const safe = resolveSafePath(ws, file.path);
    if (!safe) {
      errors.push(`路径非法：${file.path}`);
      continue;
    }
    const st = String(file.status || "");
    // untracked (??) — delete file
    if (/\?/.test(st)) {
      try {
        if (fs.pathExistsSync(safe.abs)) fs.removeSync(safe.abs);
        discarded.push(safe.rel);
      } catch (error) {
        errors.push(`${safe.rel}: ${error.message}`);
      }
      continue;
    }
    // unstage if needed then restore worktree
    runGit(ws, ["restore", "--staged", "--", safe.rel]);
    const restored = runGit(ws, ["restore", "--worktree", "--", safe.rel]);
    if (!restored.ok) {
      const fallback = runGit(ws, ["checkout", "--", safe.rel]);
      if (!fallback.ok) {
        errors.push(`${safe.rel}: ${restored.stderr || fallback.stderr || "restore 失败"}`);
        continue;
      }
    }
    discarded.push(safe.rel);
  }

  return {
    ok: errors.length === 0,
    discarded,
    errors,
    message:
      errors.length === 0
        ? `已拒绝 ${discarded.length} 个文件的改动`
        : `拒绝完成 ${discarded.length} 个，失败 ${errors.length} 个`,
    review: collectGitReview(ws),
    error: errors.length ? errors.slice(0, 5).join("; ") : null,
  };
}

/**
 * Accept = stage selected files (or all) for commit.
 */
function acceptWorkspaceChanges(workspace, { paths = [] } = {}) {
  const ws = String(workspace || "").trim();
  if (!ws || !fs.pathExistsSync(ws)) {
    return { ok: false, error: "工作区不存在", code: "workspace_missing" };
  }
  if (!isGitRepo(ws)) {
    return { ok: false, error: "不是 Git 仓库，无法暂存接受", code: "not_a_git_repo" };
  }

  const wanted = (Array.isArray(paths) ? paths : []).map(normalizeRelPath).filter(Boolean);
  let add;
  if (wanted.length) {
    for (const rel of wanted) {
      if (!resolveSafePath(ws, rel)) {
        return { ok: false, error: `路径非法：${rel}`, code: "path_escape" };
      }
    }
    add = runGit(ws, ["add", "--", ...wanted]);
  } else {
    add = runGit(ws, ["add", "-A"]);
  }
  if (!add.ok) {
    return { ok: false, error: add.stderr || add.error || "git add 失败", code: "git_add_failed" };
  }
  const review = collectGitReview(ws);
  return {
    ok: true,
    accepted: wanted.length ? wanted : (review.files || []).map((f) => f.path),
    message: wanted.length ? `已接受并暂存 ${wanted.length} 个文件` : "已接受并暂存全部改动",
    review,
    canCommit: Boolean(review.canCommit),
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
  const engineA = engineProbe.moguai_a || engineProbe.engine_a || engineProbe;
  const engineB = engineProbe.moguai_b || engineProbe.engine_b;
  let canInstallRuntime = false;
  let upgradeEngine = null;

  if (engineA && engineA.installed === false) {
    canInstallRuntime = true;
    upgradeEngine = "moguai_a";
    hints.push(engineA.message || "引擎 A 未就绪");
  } else if (engineA?.installed && engineA.message && engineA.message !== "就绪") {
    hints.push(`引擎 A：${engineA.message}`);
  }

  if (engineB && engineB.installed === false) {
    canInstallRuntime = true;
    upgradeEngine = upgradeEngine ? "all" : "moguai_b";
    hints.push(engineB.message || "引擎 B 未就绪");
  } else if (engineB?.installed && engineB.message && engineB.message !== "就绪") {
    hints.push(`引擎 B：${engineB.message}`);
  }

  if (canInstallRuntime) {
    hints.unshift("点「安装编程引擎」一键拉取应用已适配的官方版（设置里也可装）");
    copyCommands.push("设置 → MOGU AI 编程 → 安装/升级");
  }

  return {
    hints,
    copyCommands: [...new Set(copyCommands)],
    canInstallRuntime,
    upgradeEngine: upgradeEngine || "all",
    fixText: hints.join("\n").trim(),
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
  discardWorkspaceChanges,
  acceptWorkspaceChanges,
  runVerify,
  installFixHints,
};
