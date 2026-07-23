/**
 * MOGU AI coding runtime launcher.
 *
 * Product contract: the app only starts moguai-owned entrypoints
 * (settings path, PATH cli, or MOGUAI_RUNTIME_ROOT/<runtimeDir>/<cli>).
 * How those binaries are built/reviewed is outside this module.
 */

const { spawn, spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  ENGINE_A,
  ENGINE_B,
  normalizeEngineKey,
  engineMeta,
} = require("../../../shared/moguai-coding");

/** Fallback when app userData is unknown (unit tests / bare node). */
const FALLBACK_RUNTIME_ROOT = path.join(os.homedir(), ".moguai", "runtimes");
const activeJobs = new Map();

/**
 * End-user default: <userData>/moguai-runtimes (created by the app).
 * Dev override: settings.moguaiRuntimeRoot / codingVendorRoot / MOGUAI_RUNTIME_ROOT.
 */
function resolveRuntimeRoot(settings = {}) {
  const explicit = String(
    settings.moguaiRuntimeRoot ||
      settings.codingVendorRoot ||
      process.env.MOGUAI_RUNTIME_ROOT ||
      process.env.MOGU_CODING_VENDOR ||
      ""
  ).trim();
  if (explicit) return explicit;
  const userData = String(settings.userDataPath || settings._userDataPath || "").trim();
  if (userData) return path.join(userData, "moguai-runtimes");
  return FALLBACK_RUNTIME_ROOT;
}

function whichSync(cmd) {
  const checker = process.platform === "win32" ? "where" : "which";
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

function resolveRuntimeRoots(settings = {}) {
  const root = resolveRuntimeRoot(settings);
  const metaA = engineMeta(ENGINE_A);
  const metaB = engineMeta(ENGINE_B);
  return {
    root,
    engineARepo: path.join(root, metaA.runtimeDir),
    engineBRepo: path.join(root, metaB.runtimeDir),
  };
}

/**
 * Create per-user runtime folders on first use.
 * Does NOT invent a working engine binary — only the product-owned layout.
 */
function ensureRuntimeLayout(settings = {}) {
  const roots = resolveRuntimeRoots(settings);
  fs.ensureDirSync(roots.root);
  fs.ensureDirSync(roots.engineARepo);
  fs.ensureDirSync(roots.engineBRepo);

  const readme = [
    "MOGU AI 编程运行时目录（本机自动创建）",
    "",
    "把已构建的 moguai 引擎放入对应子目录，并保证入口文件存在：",
    `  ${path.basename(roots.engineARepo)}/${engineMeta(ENGINE_A).cliName}`,
    `  ${path.basename(roots.engineBRepo)}/${engineMeta(ENGINE_B).cliName}`,
    "",
    "未放入引擎时：仅「编程」不可用，对话 / 出片 / 联网等其它功能不受影响。",
    "也可在设置 → MOGU AI 编程 中直接填写引擎路径。",
    "",
  ].join(os.EOL);

  const readmePath = path.join(roots.root, "README.txt");
  if (!fs.pathExistsSync(readmePath)) {
    fs.writeFileSync(readmePath, readme, "utf8");
  }
  return {
    ...roots,
    ensured: true,
    readmePath,
  };
}

function resolveCustomLaunch(customPath) {
  const custom = String(customPath || "").trim();
  if (!custom) return null;
  if (custom.toLowerCase().endsWith(".js") || custom.toLowerCase().endsWith(".mjs")) {
    return { command: process.execPath, argsPrefix: [], label: custom, argsFile: custom };
  }
  return { command: custom, argsPrefix: [], label: custom };
}

function resolveRuntimeEntry(runtimeDir, cliName) {
  if (!runtimeDir || !fs.pathExistsSync(runtimeDir)) return null;

  // Prefer direct node entry for engine A (avoids Windows .cmd + shell:false EINVAL).
  const nodeScript = path.join(runtimeDir, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (String(cliName).includes("coding-a") && fs.pathExistsSync(nodeScript)) {
    return {
      command: process.execPath,
      argsPrefix: [nodeScript],
      label: nodeScript,
      cwd: runtimeDir,
      shell: false,
    };
  }

  const candidates = [
    path.join(runtimeDir, `${cliName}.cmd`),
    path.join(runtimeDir, `${cliName}.exe`),
    path.join(runtimeDir, cliName),
    path.join(runtimeDir, "bin", `${cliName}.cmd`),
    path.join(runtimeDir, "bin", `${cliName}.exe`),
    path.join(runtimeDir, "bin", cliName),
  ];
  for (const candidate of candidates) {
    if (fs.pathExistsSync(candidate)) {
      const isCmd = /\.cmd$/i.test(candidate) || /\.bat$/i.test(candidate);
      return {
        command: candidate,
        argsPrefix: [],
        label: candidate,
        cwd: runtimeDir,
        shell: isCmd,
      };
    }
  }
  return null;
}

function resolveEngineLaunch(engineKey, settings = {}) {
  const meta = engineMeta(engineKey);
  const pathKey = engineKey === ENGINE_B ? "codingEngineBPath" : "codingEngineAPath";
  const custom = resolveCustomLaunch(settings[pathKey]);
  if (custom) {
    if (custom.argsFile) {
      return {
        command: process.execPath,
        argsPrefix: [custom.argsFile],
        label: custom.label,
        cwd: undefined,
      };
    }
    return { ...custom, cwd: undefined };
  }

  const onPath = whichSync(meta.cliName);
  if (onPath) return { command: onPath, argsPrefix: [], label: onPath, cwd: undefined };

  const roots = resolveRuntimeRoots(settings);
  const runtimeDir = engineKey === ENGINE_B ? roots.engineBRepo : roots.engineARepo;
  return resolveRuntimeEntry(runtimeDir, meta.cliName);
}

function probeEngine(engineKey, settings = {}) {
  const meta = engineMeta(engineKey);
  const launch = resolveEngineLaunch(engineKey, settings);
  const roots = resolveRuntimeRoots(settings);
  const runtimeDir = engineKey === ENGINE_B ? roots.engineBRepo : roots.engineARepo;
  const versionFlag = engineKey === ENGINE_B ? "--help" : "--version";

  if (!launch) {
    return {
      engine: engineKey,
      installed: false,
      version: null,
      path: null,
      vendorRepo: fs.pathExistsSync(runtimeDir) ? runtimeDir : null,
      layoutReady: fs.pathExistsSync(runtimeDir),
      message: `${meta.short} 未就绪。可一键安装适配版；其它功能不受影响。`,
      fixCommands: [
        "点「安装编程引擎」或：设置 → MOGU AI 编程 → 安装/升级",
        `本机目录：${runtimeDir}`,
      ],
    };
  }

  const probed = runCapture(launch.command, [...launch.argsPrefix, versionFlag], {
    shell: launch.shell === true,
    timeoutMs: 20_000,
    cwd: launch.cwd,
  });
  const blob = `${probed.stdout}\n${probed.stderr}`;
  const ok =
    probed.ok ||
    /version|\d+\.\d+|Usage|usage|help|run/i.test(blob);
  const versionLine =
    probed.stdout.split(/\r?\n/).find((l) => /version|\d+\.\d+/i.test(l)) ||
    (ok ? `${meta.short} 运行时` : null);

  return {
    engine: engineKey,
    installed: ok,
    version: versionLine,
    path: launch.label,
    vendorRepo: fs.pathExistsSync(runtimeDir) ? runtimeDir : null,
    message: ok ? "就绪" : probed.stderr || probed.error || "探测失败",
    fixCommands: ok
      ? []
      : [
          `检查入口：${meta.cliName}`,
          `运行时目录：${runtimeDir}`,
          "或在设置中填写可用的引擎路径",
        ],
  };
}

function probeAll(settings = {}) {
  const layout = ensureRuntimeLayout(settings);
  return {
    ok: true,
    layoutReady: true,
    vendor: layout,
    runtimeRoot: layout.root,
    engines: {
      [ENGINE_A]: probeEngine(ENGINE_A, settings),
      [ENGINE_B]: probeEngine(ENGINE_B, settings),
    },
    note: "编程运行时目录由应用在本机自动创建；引擎程序需单独放入或填写路径。其它功能不依赖此项。",
  };
}

function buildBrainEnv(settings = {}, apiKey = "") {
  const preset = String(settings.agentApiPreset || settings.codingProvider || "openai").toLowerCase();
  let baseUrl = String(settings.agentApiBaseUrl || settings.codingBaseUrl || "").trim();
  // Public Release: only MOGU-injected keys count — do not silently inherit host OPENAI_API_KEY.
  // Opt-in for local/dev: MOGU_ALLOW_HOST_API_KEY=1.
  const hostKey =
    process.env.MOGU_ALLOW_HOST_API_KEY === "1"
      ? String(process.env.OPENAI_API_KEY || "").trim()
      : "";
  let key = String(apiKey || settings.agentApiKey || hostKey || "").trim();

  // Local Ollama OpenAI-compatible endpoint — no cloud key required.
  const useOllama =
    preset === "ollama" ||
    settings.codingUseOllama === true ||
    /11434/.test(baseUrl) ||
    process.env.MOGU_USE_OLLAMA === "1";
  if (useOllama) {
    if (!baseUrl) baseUrl = "http://127.0.0.1:11434/v1";
    if (!key) key = "ollama";
  }

  const env = {};
  if (!key) {
    return { env, hasKey: false, providerHint: mapPresetToEngineProvider(preset, baseUrl) };
  }
  env.OPENAI_API_KEY = key;
  if (baseUrl) env.OPENAI_BASE_URL = baseUrl.replace(/\/$/, "");
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
    providerHint: useOllama ? "openai" : mapPresetToEngineProvider(preset, baseUrl),
  };
}

function mapPresetToEngineProvider(preset, baseUrl) {
  const p = String(preset || "").toLowerCase();
  if (p === "anthropic") return "anthropic";
  if (p === "google" || p === "gemini") return "google";
  if (p === "ollama") return "ollama";
  if (baseUrl || ["deepseek", "qwen", "moonshot", "openai", "custom"].includes(p)) {
    return "openai";
  }
  return "openai";
}

/** Engine A protocol: exec in workspace. */
function buildEngineAArgs({
  workspace,
  prompt,
  model,
  sandbox,
  useOllama = false,
  unattended = false,
  ignoreUserConfig = false,
} = {}) {
  const args = ["exec", "-C", workspace, "--skip-git-repo-check"];
  // Avoid ~/.codex/config.toml cloud proxy overriding local Ollama.
  if (useOllama || ignoreUserConfig) {
    args.push("--ignore-user-config");
  }
  if (useOllama) {
    args.push("--oss", "--local-provider", "ollama");
  }
  if (model) args.push("-m", String(model));
  if (sandbox) args.push("-s", String(sandbox));
  // Non-interactive bench / automation: skip approval prompts.
  if (unattended || useOllama) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  args.push(String(prompt));
  return args;
}

/** Engine B protocol: run with working-dir + trajectory. */
function buildEngineBArgs({ workspace, prompt, model, provider, trajectoryFile }) {
  const args = ["run", String(prompt), "--working-dir", workspace];
  if (provider) args.push("--provider", String(provider));
  if (model) args.push("--model", String(model));
  if (trajectoryFile) args.push("--trajectory-file", trajectoryFile);
  return args;
}

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
  const eng = normalizeEngineKey(engine || settings.codingDefaultEngine || ENGINE_A);
  if (!workspace || !fs.pathExistsSync(workspace)) {
    return Promise.resolve({ ok: false, error: "工作区不存在", code: "workspace_missing" });
  }
  if (!prompt || !String(prompt).trim()) {
    return Promise.resolve({ ok: false, error: "prompt 不能为空", code: "prompt_empty" });
  }

  const launch = resolveEngineLaunch(eng, settings);
  if (!launch) {
    return Promise.resolve({
      ok: false,
      error: `${engineMeta(eng).label} 运行时未就绪`,
      code: "engine_missing",
    });
  }

  const useOllama =
    settings?.codingUseOllama === true ||
    String(settings?.agentApiPreset || "").toLowerCase() === "ollama" ||
    process.env.MOGU_USE_OLLAMA === "1" ||
    /11434/.test(String(settings?.agentApiBaseUrl || env.OPENAI_BASE_URL || ""));

  const cliArgs =
    eng === ENGINE_B
      ? [
          ...launch.argsPrefix,
          ...buildEngineBArgs({
            workspace,
            prompt,
            model,
            provider: provider || (useOllama ? "ollama" : undefined),
            trajectoryFile,
          }),
        ]
      : [
          ...launch.argsPrefix,
          ...buildEngineAArgs({
            workspace,
            prompt,
            model,
            sandbox,
            useOllama,
            unattended: settings?.codingUnattended === true || process.env.MOGU_BENCH_UNATTENDED === "1",
            ignoreUserConfig: settings?.codingIgnoreUserConfig === true || useOllama,
          }),
        ];

  return new Promise((resolve) => {
    const child = spawn(launch.command, cliArgs, {
      cwd: launch.cwd || workspace,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: launch.shell === true,
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
      const tail = String(log || "")
        .trim()
        .split(/\r?\n/)
        .slice(-8)
        .join("\n");
      const errBase = `引擎退出码 ${code}${signal ? ` signal=${signal}` : ""}`;
      resolve({
        ok: code === 0,
        exitCode: code,
        signal,
        engine: eng,
        command: launch.label,
        args: cliArgs,
        log,
        trajectoryFile: trajectoryFile || null,
        error: code === 0 ? null : tail ? `${errBase}\n---\n${tail}` : errBase,
        canContinue: code !== 0,
        hint:
          code === 0
            ? null
            : "可点「再派工」用同一说明重试，或打开精密工厂手改后再派。任务卡可取消进行中的任务。",
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
  DEFAULT_VENDOR_ROOT: FALLBACK_RUNTIME_ROOT,
  DEFAULT_RUNTIME_ROOT: FALLBACK_RUNTIME_ROOT,
  FALLBACK_RUNTIME_ROOT,
  ENGINE_A,
  ENGINE_B,
  resolveRuntimeRoot,
  resolveVendorRoots: resolveRuntimeRoots,
  resolveRuntimeRoots,
  ensureRuntimeLayout,
  resolveEngineALaunch: (settings) => resolveEngineLaunch(ENGINE_A, settings),
  resolveEngineBLaunch: (settings) => resolveEngineLaunch(ENGINE_B, settings),
  probeEngine,
  probeEngineA: (settings) => probeEngine(ENGINE_A, settings),
  probeEngineB: (settings) => probeEngine(ENGINE_B, settings),
  probeAll,
  runEngine,
  cancelJob,
  listActiveJobs,
  summarizeTrajectory,
  buildEngineAArgs,
  buildEngineBArgs,
  buildBrainEnv,
  mapPresetToEngineProvider,
  whichSync,
  normalizeEngineKey,
};
