const { spawn, spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const DEFAULT_VENDOR_ROOT = process.platform === "win32" ? "D:\\Project\\vendor" : path.join(os.homedir(), "mogu-vendor");
const activeJobs = new Map();

function whichSync(cmd) {
  const isWin = process.platform === "win32";
  const checker = isWin ? "where" : "which";
  const result = spawnSync(checker, [cmd], { encoding: "utf8", shell: false });
  if (result.status !== 0) return null;
  const line = String(result.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line || null;
}

function runCapture(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: opts.shell === true,
    timeout: opts.timeoutMs || 15_000,
    windowsHide: true,
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || undefined,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error?.message || null,
  };
}

function resolveVendorRoots(settings = {}) {
  const root = settings.codingVendorRoot || process.env.MOGU_CODING_VENDOR || DEFAULT_VENDOR_ROOT;
  return {
    root,
    codexRepo: path.join(root, "openai-codex"),
    traeRepo: path.join(root, "trae-agent"),
  };
}

function resolveCodexLaunch(settings = {}) {
  const custom = String(settings.codingCodexPath || "").trim();
  if (custom) {
    if (custom.toLowerCase().endsWith(".js") || custom.toLowerCase().endsWith(".mjs")) {
      return { command: process.execPath, argsPrefix: [custom], label: custom };
    }
    return { command: custom, argsPrefix: [], label: custom };
  }
  const onPath = whichSync("codex");
  if (onPath) return { command: onPath, argsPrefix: [], label: onPath };
  const npx = whichSync("npx");
  if (npx) return { command: npx, argsPrefix: ["--yes", "@openai/codex"], label: "npx @openai/codex" };
  return null;
}

function resolveTraeLaunch(settings = {}) {
  const custom = String(settings.codingTraePath || "").trim();
  if (custom) {
    return { command: custom, argsPrefix: [], label: custom, cwd: undefined };
  }
  const onPath = whichSync("trae-cli");
  if (onPath) return { command: onPath, argsPrefix: [], label: onPath, cwd: undefined };

  const { traeRepo } = resolveVendorRoots(settings);
  const uv = whichSync("uv");
  if (uv && fs.pathExistsSync(traeRepo)) {
    return {
      command: uv,
      argsPrefix: ["run", "trae-cli"],
      label: `uv run trae-cli (${traeRepo})`,
      cwd: traeRepo,
    };
  }
  const py = whichSync("python") || whichSync("python3");
  if (py && fs.pathExistsSync(path.join(traeRepo, "trae_agent"))) {
    return {
      command: py,
      argsPrefix: ["-m", "trae_agent.cli"],
      label: `python -m trae_agent.cli (${traeRepo})`,
      cwd: traeRepo,
    };
  }
  return null;
}

function probeCodex(settings = {}) {
  const launch = resolveCodexLaunch(settings);
  const vendor = resolveVendorRoots(settings);
  if (!launch) {
    return {
      engine: "codex",
      installed: false,
      version: null,
      path: null,
      vendorRepo: fs.pathExistsSync(vendor.codexRepo) ? vendor.codexRepo : null,
      message: "未找到 Codex CLI。可安装：npm i -g @openai/codex，或设置 codingCodexPath。",
    };
  }
  const probed = runCapture(launch.command, [...launch.argsPrefix, "--version"], {
    shell: false,
    timeoutMs: 20_000,
  });
  const versionLine =
    probed.stdout.split(/\r?\n/).find((l) => /codex|version|\d+\.\d+/i.test(l)) ||
    probed.stdout ||
    probed.stderr ||
    null;
  return {
    engine: "codex",
    installed: probed.ok || Boolean(versionLine),
    version: versionLine,
    path: launch.label,
    vendorRepo: fs.pathExistsSync(vendor.codexRepo) ? vendor.codexRepo : null,
    message: probed.ok || versionLine ? "就绪" : probed.stderr || probed.error || "探测失败",
  };
}

function probeTrae(settings = {}) {
  const launch = resolveTraeLaunch(settings);
  const vendor = resolveVendorRoots(settings);
  if (!launch) {
    return {
      engine: "trae",
      installed: false,
      version: null,
      path: null,
      vendorRepo: fs.pathExistsSync(vendor.traeRepo) ? vendor.traeRepo : null,
      message:
        "未找到 trae-cli。请在 D:\\Project\\vendor\\trae-agent 执行 uv sync，或设置 codingTraePath。",
    };
  }
  const probed = runCapture(launch.command, [...launch.argsPrefix, "--help"], {
    shell: false,
    timeoutMs: 25_000,
    cwd: launch.cwd,
  });
  const ok = probed.ok || /trae|Usage|run/i.test(probed.stdout + probed.stderr);
  return {
    engine: "trae",
    installed: ok,
    version: ok ? "trae-agent (CLI)" : null,
    path: launch.label,
    vendorRepo: fs.pathExistsSync(vendor.traeRepo) ? vendor.traeRepo : null,
    message: ok ? "就绪" : probed.stderr || probed.error || "探测失败（可能未 uv sync）",
  };
}

function probeAll(settings = {}) {
  return {
    ok: true,
    vendor: resolveVendorRoots(settings),
    engines: {
      codex: probeCodex(settings),
      trae: probeTrae(settings),
    },
  };
}

/**
 * One brain key in MOGU → env for coding tool subprocesses.
 * Does not duplicate billing by itself; engines call the same provider API.
 */
function buildBrainEnv(settings = {}, apiKey = "") {
  const key = String(apiKey || settings.agentApiKey || process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = String(settings.agentApiBaseUrl || "").trim();
  const preset = String(settings.agentApiPreset || "openai").toLowerCase();
  const env = {};
  if (!key) {
    return { env, hasKey: false, providerHint: mapPresetToTraeProvider(preset, baseUrl) };
  }
  env.OPENAI_API_KEY = key;
  // OpenAI-compatible providers (DeepSeek / Qwen / Moonshot / custom)
  if (baseUrl) {
    env.OPENAI_BASE_URL = baseUrl.replace(/\/$/, "");
  }
  if (preset === "anthropic") {
    env.ANTHROPIC_API_KEY = key;
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl.replace(/\/$/, "");
  }
  if (preset === "google" || preset === "gemini") {
    env.GOOGLE_API_KEY = key;
    if (baseUrl) env.GOOGLE_BASE_URL = baseUrl.replace(/\/$/, "");
  }
  return {
    env,
    hasKey: true,
    providerHint: mapPresetToTraeProvider(preset, baseUrl),
  };
}

function mapPresetToTraeProvider(preset, baseUrl) {
  const p = String(preset || "").toLowerCase();
  if (p === "anthropic") return "anthropic";
  if (p === "google" || p === "gemini") return "google";
  if (p === "ollama") return "ollama";
  // deepseek / qwen / moonshot / openai / custom → OpenAI-compatible
  if (baseUrl || ["deepseek", "qwen", "moonshot", "openai", "custom"].includes(p)) {
    return "openai";
  }
  return "openai";
}

function buildCodexArgs({ workspace, prompt, model, sandbox }) {
  const args = ["exec", "-C", workspace, "--skip-git-repo-check"];
  if (model) args.push("-m", String(model));
  if (sandbox) args.push("-s", String(sandbox));
  args.push(String(prompt));
  return args;
}

function buildTraeArgs({ workspace, prompt, model, provider, trajectoryFile }) {
  const args = ["run", String(prompt), "--working-dir", workspace];
  if (provider) args.push("--provider", String(provider));
  if (model) args.push("--model", String(model));
  if (trajectoryFile) args.push("--trajectory-file", trajectoryFile);
  return args;
}

/**
 * Spawn a coding engine; streams stdout/stderr via onChunk; returns Promise result.
 */
function runEngine({
  engine,
  settings,
  workspace,
  prompt,
  model,
  provider,
  sandbox,
  trajectoryFile,
  jobId,
  onChunk,
  env = {},
} = {}) {
  const eng = String(engine || settings.codingDefaultEngine || "codex").toLowerCase();
  if (!workspace || !fs.pathExistsSync(workspace)) {
    return Promise.resolve({ ok: false, error: "工作区不存在", code: "workspace_missing" });
  }
  if (!prompt || !String(prompt).trim()) {
    return Promise.resolve({ ok: false, error: "prompt 不能为空", code: "prompt_empty" });
  }

  let launch;
  let cliArgs;
  if (eng === "trae" || eng === "trae-agent") {
    launch = resolveTraeLaunch(settings);
    if (!launch) {
      return Promise.resolve({ ok: false, error: "trae-agent 未安装", code: "engine_missing" });
    }
    cliArgs = [...launch.argsPrefix, ...buildTraeArgs({ workspace, prompt, model, provider, trajectoryFile })];
  } else {
    launch = resolveCodexLaunch(settings);
    if (!launch) {
      return Promise.resolve({ ok: false, error: "Codex CLI 未安装", code: "engine_missing" });
    }
    cliArgs = [...launch.argsPrefix, ...buildCodexArgs({ workspace, prompt, model, sandbox })];
  }

  return new Promise((resolve) => {
    const child = spawn(launch.command, cliArgs, {
      cwd: launch.cwd || workspace,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
    });
    const key = String(jobId || child.pid);
    activeJobs.set(key, { child, engine: eng, startedAt: Date.now(), workspace });

    let log = "";
    const append = (chunk, stream) => {
      const text = String(chunk || "");
      if (!text) return;
      log = (log + text).slice(-12_000);
      onChunk?.({ text, stream, log });
    };
    child.stdout?.on("data", (buf) => append(buf, "stdout"));
    child.stderr?.on("data", (buf) => append(buf, "stderr"));
    child.on("error", (error) => {
      activeJobs.delete(key);
      resolve({
        ok: false,
        error: error.message,
        code: "spawn_failed",
        engine: eng,
        command: launch.label,
        log,
      });
    });
    child.on("close", (code, signal) => {
      activeJobs.delete(key);
      resolve({
        ok: code === 0,
        exitCode: code,
        signal,
        engine: eng,
        command: launch.label,
        args: cliArgs,
        log,
        trajectoryFile: trajectoryFile || null,
        error: code === 0 ? null : `引擎退出码 ${code}${signal ? ` signal=${signal}` : ""}`,
      });
    });
  });
}

function cancelJob(jobId) {
  const key = String(jobId || "");
  const job = activeJobs.get(key);
  if (!job?.child) return { ok: false, error: "job_not_found" };
  try {
    job.child.kill();
    if (process.platform === "win32" && job.child.pid) {
      spawnSync("taskkill", ["/pid", String(job.child.pid), "/t", "/f"], { windowsHide: true });
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
  activeJobs.delete(key);
  return { ok: true, cancelled: true };
}

function listActiveJobs() {
  return [...activeJobs.entries()].map(([id, job]) => ({
    id,
    engine: job.engine,
    workspace: job.workspace,
    startedAt: job.startedAt,
    pid: job.child?.pid || null,
  }));
}

async function summarizeTrajectory(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) {
    return { ok: false, summary: null };
  }
  try {
    const raw = await fs.readJson(filePath);
    const steps = Array.isArray(raw?.steps)
      ? raw.steps
      : Array.isArray(raw?.trajectory)
        ? raw.trajectory
        : Array.isArray(raw)
          ? raw
          : [];
    const lines = steps.slice(-20).map((step, i) => {
      if (typeof step === "string") return `${i + 1}. ${step.slice(0, 200)}`;
      const action = step.action || step.tool || step.type || step.name || "step";
      const detail = step.content || step.input || step.observation || step.message || "";
      return `${i + 1}. ${action}: ${String(detail).slice(0, 160)}`;
    });
    return {
      ok: true,
      summary: lines.join("\n") || JSON.stringify(raw).slice(0, 2000),
      stepCount: steps.length,
    };
  } catch (error) {
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    return { ok: Boolean(text), summary: String(text).slice(0, 2000), error: error.message };
  }
}

module.exports = {
  DEFAULT_VENDOR_ROOT,
  resolveVendorRoots,
  resolveCodexLaunch,
  resolveTraeLaunch,
  probeCodex,
  probeTrae,
  probeAll,
  runEngine,
  cancelJob,
  listActiveJobs,
  summarizeTrajectory,
  buildCodexArgs,
  buildTraeArgs,
  buildBrainEnv,
  mapPresetToTraeProvider,
  whichSync,
};
