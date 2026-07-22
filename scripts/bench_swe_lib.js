/**
 * Shared helpers for SWE-bench Lite public benchmark.
 */

const fs = require("fs-extra");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const BENCH_ROOT = path.join(ROOT, "benchmarks", "swe-bench");
const CACHE_DIR = path.join(BENCH_ROOT, "cache");
const TASKS_PATH = path.join(CACHE_DIR, "tasks.json");
const DEFAULT_DATASET = "SWE-bench/SWE-bench_Lite";
const HF_ROWS = "https://datasets-server.huggingface.co/rows";
const SAMPLE_PATH = path.join(BENCH_ROOT, "sample_tasks.json");

function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(a);
  }
  return out;
}

function runGit(cwd, args, timeoutMs = 120_000) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || ""),
    error: r.error?.message || null,
  };
}

function stripGoldFields(task) {
  // Keep agent inputs + official test_patch (harness applies this before FAIL_TO_PASS).
  // Never feed the gold solution `patch` into the run.
  return {
    instance_id: task.instance_id,
    repo: task.repo,
    base_commit: task.base_commit,
    problem_statement: task.problem_statement,
    hints_text: task.hints_text || "",
    version: task.version,
    FAIL_TO_PASS: task.FAIL_TO_PASS,
    PASS_TO_PASS: task.PASS_TO_PASS,
    test_patch: task.test_patch || "",
  };
}

/** Django FAIL_TO_PASS labels look like: "test_foo (pkg.tests.Class)" → pkg.tests.Class.test_foo */
function toDjangoRuntestsLabel(raw) {
  const s = String(raw || "").trim();
  const m = /^([A-Za-z_][\w]*)\s+\(([^)]+)\)$/.exec(s);
  if (m) return `${m[2].trim()}.${m[1]}`;
  return s;
}

function applySweTestPatch(repoDir, task) {
  // Do NOT trim: unified diffs often end with a significant " \n" context line.
  let body = String(task?.test_patch || "").replace(/\r\n/g, "\n");
  if (!body.trim()) return { ok: true, applied: false };
  if (!body.endsWith("\n")) body += "\n";
  const patchPath = path.join(repoDir, ".mogu_test_patch.diff");
  fs.writeFileSync(patchPath, body, "utf8");
  const applied = runGit(repoDir, ["apply", "--whitespace=nowarn", patchPath], 60_000);
  try {
    fs.removeSync(patchPath);
  } catch {
    /* ignore */
  }
  if (!applied.ok) {
    return {
      ok: false,
      applied: false,
      error: applied.stderr || applied.error || "git apply test_patch failed",
    };
  }
  // Commit so collectModelPatch excludes test harness edits from the prediction.
  runGit(repoDir, ["add", "-A"]);
  const commit = runGit(
    repoDir,
    [
      "-c",
      "user.email=mogu-bench@local",
      "-c",
      "user.name=mogu-bench",
      "commit",
      "-m",
      "mogu: apply SWE test_patch (not part of model prediction)",
      "--allow-empty",
    ],
    60_000
  );
  return {
    ok: commit.ok,
    applied: true,
    error: commit.ok ? null : commit.stderr || commit.error,
  };
}

async function loadSampleTasks({ limit = 5 } = {}) {
  const sample = await fs.readJson(SAMPLE_PATH);
  const n = Math.max(1, Math.min(50, Number(limit) || 5));
  const tasks = (sample.tasks || []).slice(0, n).map(stripGoldFields);
  const payload = {
    dataset: sample.dataset || DEFAULT_DATASET,
    source: "sample",
    fetchedAt: new Date().toISOString(),
    offset: 0,
    limit: n,
    count: tasks.length,
    note: sample.note || "bundled sample for offline self-test",
    tasks,
  };
  await fs.ensureDir(CACHE_DIR);
  await fs.writeJson(TASKS_PATH, payload, { spaces: 2 });
  return payload;
}

async function fetchViaCurl(url, outFile) {
  await fs.ensureDir(path.dirname(outFile));
  const r = spawnSync(
    "curl.exe",
    ["-L", "--connect-timeout", "60", "--max-time", "180", "-A", "moguai-swe-bench/1.0", url, "-o", outFile],
    { encoding: "utf8", windowsHide: true }
  );
  if (r.status !== 0 || !fs.pathExistsSync(outFile)) {
    const r2 = spawnSync(
      "curl",
      ["-L", "--connect-timeout", "60", "--max-time", "180", "-A", "moguai-swe-bench/1.0", url, "-o", outFile],
      { encoding: "utf8", windowsHide: true }
    );
    if (r2.status !== 0 || !fs.pathExistsSync(outFile)) {
      throw new Error(r.stderr || r2.stderr || r.error?.message || "curl 拉题失败");
    }
  }
  return fs.readJson(outFile);
}

async function fetchLiteTasks({
  limit = 5,
  offset = 0,
  dataset = DEFAULT_DATASET,
  useSample = false,
} = {}) {
  if (useSample) return loadSampleTasks({ limit });

  const n = Math.max(1, Math.min(50, Number(limit) || 5));
  const off = Math.max(0, Number(offset) || 0);
  const url = `${HF_ROWS}?dataset=${encodeURIComponent(dataset)}&config=default&split=test&offset=${off}&length=${n}`;
  let data;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "moguai-swe-bench/1.0" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    data = await res.json();
  } catch (err) {
    const cause = err?.cause?.message || err.message;
    console.warn(`[bench:swe] fetch 失败（${cause}），改用 curl…`);
    const tmp = path.join(CACHE_DIR, "hf_rows.json");
    data = await fetchViaCurl(url, tmp);
  }
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const tasks = rows.map((row) => stripGoldFields(row.row || row));
  await fs.ensureDir(CACHE_DIR);
  const payload = {
    dataset,
    source: "huggingface",
    fetchedAt: new Date().toISOString(),
    offset: off,
    limit: n,
    count: tasks.length,
    tasks,
  };
  await fs.writeJson(TASKS_PATH, payload, { spaces: 2 });
  // Refresh bundled sample for offline reuse (no gold patches).
  if (tasks.length >= 2) {
    await fs.writeJson(
      SAMPLE_PATH,
      {
        dataset,
        note: "Public SWE-bench Lite sample for offline self-test; no gold patches.",
        count: tasks.length,
        tasks,
      },
      { spaces: 2 }
    );
  }
  return payload;
}

async function loadTasks() {
  if (!(await fs.pathExists(TASKS_PATH))) {
    throw new Error(`没有缓存题目。请先运行: npm run bench:swe:fetch`);
  }
  return fs.readJson(TASKS_PATH);
}

function parseTestList(raw) {
  let tests = raw;
  if (typeof tests === "string") {
    try {
      tests = JSON.parse(tests);
    } catch {
      tests = [tests];
    }
  }
  if (!Array.isArray(tests)) return [];
  return tests.map((t) => String(t).trim()).filter(Boolean);
}

function quoteShellArg(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

function testNodeToFile(node) {
  const s = String(node || "");
  if (s.includes("::")) return s.split("::")[0].trim();
  if (/\.py$/.test(s)) return s;
  return "";
}

/** Map astropy/.../tests/test_foo.py → likely implementation paths. */
function inferSourcePathsFromTests(testFiles = []) {
  const out = [];
  for (const raw of testFiles) {
    const file = String(raw || "").replace(/\\/g, "/");
    const m = file.match(/^(.*\/)?tests?\/test_([A-Za-z0-9_]+)\.py$/i);
    if (!m) continue;
    const pkg = (m[1] || "").replace(/\/$/, "");
    const stem = m[2];
    if (pkg) {
      out.push(`${pkg}/${stem}.py`);
      // common nesting: io/ascii/tests/test_qdp.py → io/ascii/qdp.py
      out.push(`${pkg}/${stem}/${stem}.py`);
    }
  }
  return [...new Set(out)];
}

/** Build FAIL_TO_PASS / PASS_TO_PASS local verify plan (no gold patch). */
function buildSweTestPlan(task) {
  const fail = parseTestList(task?.FAIL_TO_PASS);
  const pass = parseTestList(task?.PASS_TO_PASS);
  const repo = String(task?.repo || "");
  const testPaths = [
    ...new Set(fail.map(testNodeToFile).filter((p) => p.endsWith(".py"))),
  ].slice(0, 8);
  const sourceHintPaths = inferSourcePathsFromTests(testPaths).slice(0, 8);
  const hintPaths = [...new Set([...sourceHintPaths, ...testPaths])].slice(0, 12);

  let failCommand = "";
  let passCommand = "";

  if (/astropy\//i.test(repo)) {
    if (fail.length) {
      failCommand = `python -m pytest ${fail.slice(0, 6).map(quoteShellArg).join(" ")} -q --tb=short --no-header -x`;
    }
    const failFiles = new Set(fail.map(testNodeToFile).filter(Boolean));
    const relatedPass = pass
      .filter((t) => failFiles.has(testNodeToFile(t)))
      .slice(0, 8);
    if (relatedPass.length) {
      passCommand = `python -m pytest ${relatedPass.map(quoteShellArg).join(" ")} -q --tb=line --no-header`;
    } else if (failFiles.size) {
      passCommand = `python -m pytest ${[...failFiles].slice(0, 3).map(quoteShellArg).join(" ")} -q --tb=line --no-header`;
    }
  } else if (/django\//i.test(repo)) {
    const failLabels = fail.slice(0, 4).map(toDjangoRuntestsLabel);
    if (failLabels.length) {
      failCommand = `python tests/runtests.py ${failLabels.map(quoteShellArg).join(" ")} --verbosity=1 --parallel=1`;
    }
    // Module prefix from "pkg.tests.Class.test" or legacy "test (pkg.tests.Class)"
    const modules = new Set(
      fail
        .map((t) => {
          const label = toDjangoRuntestsLabel(t);
          const parts = label.split(".");
          return parts.length >= 2 ? parts.slice(0, 2).join(".") : parts[0];
        })
        .filter(Boolean)
    );
    const relatedPass = pass
      .map(toDjangoRuntestsLabel)
      .filter((t) => {
        const parts = t.split(".");
        const mod = parts.length >= 2 ? parts.slice(0, 2).join(".") : parts[0];
        return modules.has(mod);
      })
      .slice(0, 6);
    if (relatedPass.length) {
      passCommand = `python tests/runtests.py ${relatedPass.map(quoteShellArg).join(" ")} --verbosity=1 --parallel=1`;
    }
  }

  const stages = [];
  if (failCommand) stages.push({ name: "FAIL_TO_PASS", command: failCommand });
  if (passCommand) stages.push({ name: "PASS_TO_PASS", command: passCommand });

  return {
    failToPass: fail,
    passToPass: pass,
    testPaths,
    sourceHintPaths,
    hintPaths,
    failCommand,
    passCommand,
    stages,
    verifyCommand: failCommand,
  };
}

function buildAgentPrompt(task, { slim = false, testPlan = null } = {}) {
  const hints = String(task.hints_text || "").trim();
  const issue = String(task.problem_statement || "").trim();
  const plan = testPlan || buildSweTestPlan(task);
  const failList = (plan.failToPass || []).slice(0, 8);
  const sourceHints = (plan.sourceHintPaths || []).slice(0, 6);
  const failHint = failList.length
    ? [
        "",
        "### Failing tests (must pass after your fix; do not delete/weaken them)",
        ...failList.map((t) => `- ${t}`),
        "Edit production/library implementation code — NOT the test files.",
        "Keep unrelated PASS_TO_PASS behavior intact.",
      ].join("\n")
    : "";
  const sourceHint = sourceHints.length
    ? ["", "### Likely implementation files", ...sourceHints.map((p) => `- ${p}`)].join("\n")
    : "";
  if (slim) {
    return [
      `Fix GitHub issue ${task.instance_id} in ${task.repo}.`,
      "Output/apply a minimal correct code change only. Do not add tests or monkey-patch unrelated modules.",
      "Prefer editing implementation modules, not test_*.py.",
      "",
      issue.slice(0, 6000),
      hints ? `\nHints:\n${hints.slice(0, 1500)}` : "",
      sourceHint,
      failHint,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "You are fixing a real GitHub issue. Produce a minimal correct patch.",
    "Only modify files required to resolve the issue. Do not refactor unrelated code.",
    "Do not add new test files. Do not edit test_*.py unless the issue is about the test harness itself.",
    "Do not break existing passing tests.",
    "",
    `Repository: ${task.repo}`,
    `Instance: ${task.instance_id}`,
    "",
    "### Issue",
    issue,
    hints ? `\n### Hints\n${hints}` : "",
    sourceHint,
    failHint,
    "",
    "Implement the fix in this workspace (already checked out at the base commit).",
    "Do not invent unrelated files. Prefer existing style and tests.",
  ]
    .filter(Boolean)
    .join("\n");
}

function ensureRepoAtCommit(workRoot, task) {
  const safeId = String(task.instance_id || "task").replace(/[^\w.-]+/g, "_");
  const repoDir = path.join(workRoot, safeId);
  const url = `https://github.com/${task.repo}.git`;
  fs.ensureDirSync(workRoot);

  if (!fs.pathExistsSync(path.join(repoDir, ".git"))) {
    fs.removeSync(repoDir);
    const clone = runGit(workRoot, ["clone", "--filter=blob:none", url, safeId], 600_000);
    if (!clone.ok) {
      throw new Error(`git clone 失败 ${task.repo}: ${clone.stderr || clone.error}`);
    }
  }

  runGit(repoDir, ["fetch", "--all", "--tags"], 300_000);
  const co = runGit(repoDir, ["checkout", "-f", task.base_commit], 120_000);
  if (!co.ok) {
    const fetchCommit = runGit(repoDir, ["fetch", "origin", task.base_commit], 300_000);
    const retry = runGit(repoDir, ["checkout", "-f", task.base_commit], 120_000);
    if (!retry.ok) {
      throw new Error(
        `checkout ${task.base_commit} 失败: ${retry.stderr || co.stderr || fetchCommit.stderr}`
      );
    }
  }
  runGit(repoDir, ["reset", "--hard", "HEAD"]);
  runGit(repoDir, ["clean", "-fd"]);
  const tp = applySweTestPatch(repoDir, task);
  if (!tp.ok) {
    throw new Error(`apply test_patch failed for ${task.instance_id}: ${tp.error}`);
  }
  return repoDir;
}

function normalizeModelPatch(patch) {
  let body = String(patch || "")
    .replace(/\r\n/g, "\n")
    .replace(/\0/g, "");
  // Drop accidental markdown fences
  body = body.replace(/^```(?:diff|patch)?\n/i, "").replace(/\n```$/i, "");
  if (!body.trim()) return "";
  if (!body.endsWith("\n")) body += "\n";
  // Reject obviously malformed patches that break SWE eval apply
  const hasHunk = /^@@ /m.test(body) || /^diff --git /m.test(body);
  if (!hasHunk) return "";
  return body;
}

function collectModelPatch(repoDir) {
  // Stage everything (incl. untracked) so one cached diff works on Windows too.
  runGit(repoDir, ["add", "-A"]);
  const staged = runGit(repoDir, ["diff", "--cached"]);
  runGit(repoDir, ["reset", "HEAD"]);
  return normalizeModelPatch(staged.stdout || "");
}

/** Best-effort local verify from FAIL_TO_PASS (no gold patch). */
function buildSweVerifyCommand(task) {
  return buildSweTestPlan(task).failCommand || "";
}

function predictionLine({ instanceId, modelName, patch }) {
  return {
    instance_id: instanceId,
    model_name_or_path: modelName,
    model_patch: patch || "",
  };
}

const { resolveSweEvalImage } = require("../src/main/skills/coding-swe-image");

module.exports = {
  ROOT,
  BENCH_ROOT,
  CACHE_DIR,
  TASKS_PATH,
  SAMPLE_PATH,
  DEFAULT_DATASET,
  parseArgs,
  runGit,
  fetchLiteTasks,
  loadSampleTasks,
  loadTasks,
  buildAgentPrompt,
  ensureRepoAtCommit,
  collectModelPatch,
  normalizeModelPatch,
  parseTestList,
  inferSourcePathsFromTests,
  buildSweTestPlan,
  buildSweVerifyCommand,
  predictionLine,
  stripGoldFields,
  toDjangoRuntestsLabel,
  applySweTestPatch,
  resolveSweEvalImage,
};
