const path = require("path");
const fs = require("fs-extra");
const { spawn, execFile } = require("child_process");
const axios = require("axios");
const { shell } = require("electron");
const { findComfyUiCandidates, applyComfyUiToPai } = require("./env-scan");

const OLLAMA_SETUP_URL = "https://ollama.com/download/OllamaSetup.exe";
const DEFAULT_COMFY_GUIDE_URL =
  "https://github.com/comfyanonymous/ComfyUI?tab=readme-ov-file#installing";
const DEFAULT_PAI_RUNTIME_URL =
  process.env.PAI_RUNTIME_URL ||
  "https://github.com/ly136148277-netizen/PAI/archive/refs/heads/master.zip";
const FFMPEG_GUIDE_URL = "https://www.gyan.dev/ffmpeg/builds/";
const FFMPEG_WINGET_ID = "Gyan.FFmpeg";
const { resolveFfmpeg, ensureFfmpeg } = require("./ffmpeg-tools");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: options.shell !== false,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      options.onData?.(chunk.toString());
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      options.onData?.(chunk.toString());
    });
    child.on("error", (error) => {
      resolve({ ok: false, code: -1, stdout, stderr: error.message });
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function probeOllama() {
  try {
    const response = await axios.get("http://127.0.0.1:11434/api/tags", { timeout: 2000 });
    return { installed: true, running: response.status === 200 };
  } catch {
    return { installed: false, running: false };
  }
}

async function hasWinget() {
  const result = await runCommand("where", ["winget"], { shell: true });
  return result.ok;
}

async function probeFfmpeg() {
  return resolveFfmpeg();
}

async function installFfmpeg({ onProgress } = {}) {
  onProgress?.({ phase: "start", message: "正在准备 FFmpeg…" });
  // 优先下载到软件目录（换电脑也可复用同一逻辑）
  const downloaded = await ensureFfmpeg({ onProgress });
  if (downloaded.ok && downloaded.installed) {
    return downloaded;
  }

  if (await hasWinget()) {
    onProgress?.({ phase: "winget", message: "便携版失败，改用 winget 安装 FFmpeg…" });
    const result = await runCommand(
      "winget",
      [
        "install",
        "-e",
        "--id",
        FFMPEG_WINGET_ID,
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity",
      ],
      {
        onData: (text) => onProgress?.({ phase: "winget", message: text.slice(-220) }),
      }
    );
    if (result.ok) {
      for (let i = 0; i < 10; i += 1) {
        const probe = await probeFfmpeg();
        if (probe.installed) {
          return { ok: true, method: "winget", ...probe };
        }
        await sleep(1000);
      }
      return {
        ok: true,
        method: "winget",
        installed: true,
        message: "已安装。若状态仍显示未检测到，请关闭 MOGU AI 后重新打开。",
      };
    }
  }

  onProgress?.({ phase: "guide", message: "自动安装失败，打开官方下载页…" });
  await shell.openExternal(FFMPEG_GUIDE_URL);
  return {
    ok: false,
    method: "guide",
    url: FFMPEG_GUIDE_URL,
    needsManualFinish: true,
    error: downloaded.error || "FFmpeg 未就绪",
    message: downloaded.message || "请联网后重试，或到下载页手动安装。",
  };
}

async function downloadFile(url, destPath, onProgress) {
  await fs.ensureDir(path.dirname(destPath));
  const response = await axios.get(url, { responseType: "stream", timeout: 600_000 });
  const total = Number(response.headers["content-length"] || 0);
  let received = 0;
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.on("data", (chunk) => {
      received += chunk.length;
      if (total) {
        onProgress?.({ phase: "download", received, total, percent: Math.round((received / total) * 100) });
      }
    });
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });
  return destPath;
}

async function installOllama({ onProgress } = {}) {
  onProgress?.({ phase: "start", message: "正在安装 Ollama…" });
  if (await hasWinget()) {
    onProgress?.({ phase: "winget", message: "使用 winget 安装 Ollama…" });
    const result = await runCommand(
      "winget",
      [
        "install",
        "-e",
        "--id",
        "Ollama.Ollama",
        "--accept-package-agreements",
        "--accept-source-agreements",
      ],
      {
        onData: (text) => onProgress?.({ phase: "winget", message: text.slice(-200) }),
      }
    );
    if (result.ok) {
      for (let i = 0; i < 20; i += 1) {
        const probe = await probeOllama();
        if (probe.running) {
          return { ok: true, method: "winget", running: true };
        }
        await sleep(1500);
      }
      return { ok: true, method: "winget", running: false, message: "已安装，请点击启动 Ollama" };
    }
    onProgress?.({ phase: "fallback", message: "winget 失败，改为下载安装包…" });
  }

  const dest = path.join(require("os").tmpdir(), "OllamaSetup.exe");
  onProgress?.({ phase: "download", message: "下载 OllamaSetup.exe…" });
  await downloadFile(OLLAMA_SETUP_URL, dest, onProgress);
  onProgress?.({ phase: "launch", message: "已打开安装程序，请完成安装后回到本页刷新" });
  await shell.openPath(dest);
  return { ok: true, method: "installer", path: dest, needsManualFinish: true };
}

function resolveDefaultPaiRoot(userDataPath) {
  return path.join(userDataPath, "pai");
}

async function findExistingPaiRoots() {
  const candidates = [
    "E:\\projects\\PAI",
    "D:\\projects\\PAI",
    "C:\\projects\\PAI",
    path.join(process.env.USERPROFILE || "", "projects", "PAI"),
    path.join(process.env.LOCALAPPDATA || "", "ai-model-manager", "pai"),
    path.join(process.env.LOCALAPPDATA || "", "MoguAI", "pai"),
  ];
  const found = [];
  for (const root of candidates) {
    if (!root) continue;
    const python = path.join(root, ".venv", "Scripts", "python.exe");
    if (await fs.pathExists(python)) {
      found.push(root);
    } else if (await fs.pathExists(path.join(root, "gateway", "cli.py"))) {
      found.push(root);
    }
  }
  return found;
}

async function findPythonExecutable() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python310", "python.exe"),
    "py",
    "python",
  ];
  for (const candidate of candidates) {
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (await fs.pathExists(candidate)) return candidate;
      continue;
    }
    const which = await runCommand("where", [candidate], { shell: true });
    if (which.ok && which.stdout.trim()) {
      return which.stdout.split(/\r?\n/)[0].trim();
    }
  }
  return null;
}

async function extractZip(zipPath, destDir, onProgress) {
  await fs.ensureDir(destDir);
  onProgress?.({ phase: "extract", message: `解压到 ${destDir}` });
  // PowerShell Expand-Archive
  const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(
    /'/g,
    "''"
  )}' -Force`;
  const result = await runCommand("powershell", ["-NoProfile", "-Command", ps], { shell: true });
  if (!result.ok) {
    throw new Error(`解压失败：${result.stderr || result.stdout}`);
  }
}

async function installPaiRuntime({ userDataPath, runtimeUrl, onProgress } = {}) {
  onProgress?.({ phase: "scan", message: "扫描本机已有 PAI…" });
  const existing = await findExistingPaiRoots();
  if (existing.length) {
    const root = existing[0];
    onProgress?.({ phase: "found", message: `发现已有 PAI：${root}` });
    const python = path.join(root, ".venv", "Scripts", "python.exe");
    if (!(await fs.pathExists(python))) {
      await createPaiVenv(root, onProgress);
    }
    return { ok: true, paiRoot: root, method: "detected" };
  }

  const target = resolveDefaultPaiRoot(userDataPath);
  const url = runtimeUrl || DEFAULT_PAI_RUNTIME_URL;
  onProgress?.({ phase: "download", message: `下载 PAI 运行时…\n${url}` });

  const zipPath = path.join(require("os").tmpdir(), `pai-runtime-${Date.now()}.zip`);
  try {
    await downloadFile(url, zipPath, onProgress);
  } catch (error) {
    return {
      ok: false,
      error: `无法下载 PAI 运行时：${error.message}。请改用「选择已有 PAI 文件夹」，或设置 paiRuntimeUrl。`,
      needsPickFolder: true,
    };
  }

  const extractRoot = path.join(require("os").tmpdir(), `pai-extract-${Date.now()}`);
  await extractZip(zipPath, extractRoot, onProgress);

  // GitHub zip nests as PAI-master/
  const entries = await fs.readdir(extractRoot);
  let source = extractRoot;
  if (entries.length === 1) {
    const nested = path.join(extractRoot, entries[0]);
    if ((await fs.stat(nested)).isDirectory()) source = nested;
  }

  await fs.remove(target).catch(() => {});
  await fs.copy(source, target);
  onProgress?.({ phase: "venv", message: "创建 Python 虚拟环境…" });
  await createPaiVenv(target, onProgress);

  return { ok: true, paiRoot: target, method: "download" };
}

async function createPaiVenv(paiRoot, onProgress) {
  const python = await findPythonExecutable();
  if (!python) {
    throw new Error("未找到 Python。请先安装 Python 3.11+ 并勾选 Add to PATH。");
  }
  const venvPython = path.join(paiRoot, ".venv", "Scripts", "python.exe");
  if (!(await fs.pathExists(venvPython))) {
    const created = await runCommand(python, ["-m", "venv", path.join(paiRoot, ".venv")], {
      cwd: paiRoot,
      shell: false,
      onData: (t) => onProgress?.({ phase: "venv", message: t.slice(-160) }),
    });
    // py launcher needs different invocation
    if (!created.ok && python === "py") {
      const retry = await runCommand("py", ["-3", "-m", "venv", ".venv"], {
        cwd: paiRoot,
        shell: true,
      });
      if (!retry.ok) {
        throw new Error(`创建 venv 失败：${retry.stderr || created.stderr}`);
      }
    } else if (!created.ok) {
      throw new Error(`创建 venv 失败：${created.stderr || created.stdout}`);
    }
  }

  const pipPython = path.join(paiRoot, ".venv", "Scripts", "python.exe");
  const req = path.join(paiRoot, "requirements.txt");
  if (await fs.pathExists(req)) {
    onProgress?.({ phase: "pip", message: "安装 PAI 依赖…" });
    const pip = await runCommand(pipPython, ["-m", "pip", "install", "-r", "requirements.txt"], {
      cwd: paiRoot,
      shell: false,
      onData: (t) => onProgress?.({ phase: "pip", message: t.slice(-200) }),
    });
    if (!pip.ok) {
      throw new Error(`pip install 失败：${pip.stderr || pip.stdout}`);
    }
  }
}

async function bindPaiRoot(paiRoot) {
  const python = path.join(paiRoot, ".venv", "Scripts", "python.exe");
  const cli = path.join(paiRoot, "gateway", "cli.py");
  if (!(await fs.pathExists(cli))) {
    throw new Error(`不是有效的 PAI 目录（缺少 gateway/cli.py）：${paiRoot}`);
  }
  if (!(await fs.pathExists(python))) {
    await createPaiVenv(paiRoot);
  }
  return { ok: true, paiRoot };
}

async function openComfyGuide(url) {
  const target = url || DEFAULT_COMFY_GUIDE_URL;
  await shell.openExternal(target);
  return { ok: true, url: target };
}

async function scanAndApplyComfyUi(paiRoot, logger) {
  const candidates = await findComfyUiCandidates(logger);
  if (!candidates.length) {
    return { ok: false, error: "未找到 ComfyUI，请先下载便携包解压后再扫描" };
  }
  const best = candidates[0];
  const result = applyComfyUiToPai(paiRoot, best);
  return {
    ok: true,
    ...result,
    running: Boolean(best.running),
    candidates: candidates.map((c) => ({ path: c.path, running: c.running, apiUrl: c.apiUrl })),
  };
}

async function getSetupStatus({ paiBridge, ollamaService, settings, userDataPath, logger }) {
  const ollamaStatus = await ollamaService.getStatus();
  let ollamaProbe = { running: Boolean(ollamaStatus.running) };
  if (!ollamaStatus.running) {
    ollamaProbe = await probeOllama();
  }

  const paiRoot = paiBridge.resolvePaiRoot(settings);
  const paiStatus = await paiBridge.getStatus(settings);
  const existingPai = await findExistingPaiRoots();

  let comfyui = { found: false, running: false, configured: null };
  try {
    const { getComfyUiStatus } = require("./comfyui-bridge");
    const status = await getComfyUiStatus(paiRoot);
    comfyui = {
      found: Boolean(status.path || status.configured?.path),
      running: Boolean(status.running),
      api: status.api || status.configured?.api || null,
      path: status.path || status.configured?.path || null,
      configured: status.configured || null,
    };
  } catch (error) {
    comfyui.error = error.message;
  }

  if (!comfyui.found) {
    const candidates = await findComfyUiCandidates(logger);
    if (candidates[0]) {
      comfyui.found = true;
      comfyui.running = candidates[0].running;
      comfyui.path = candidates[0].path;
      comfyui.api = candidates[0].apiUrl;
      comfyui.pendingWrite = true;
    }
  }

  const ffmpeg = await probeFfmpeg();

  const ready = {
    ollama: Boolean(ollamaStatus.installed || ollamaProbe.running) && Boolean(ollamaStatus.running || ollamaProbe.running),
    pai: Boolean(paiStatus.running),
    comfyui: Boolean(comfyui.running),
    ffmpeg: Boolean(ffmpeg.installed),
  };

  return {
    ok: true,
    ollama: {
      installed: Boolean(ollamaStatus.installed || ollamaProbe.running),
      running: Boolean(ollamaStatus.running || ollamaProbe.running),
      state: ollamaStatus.state || (ollamaProbe.running ? "running" : "not_installed"),
    },
    pai: {
      installed: Boolean(paiStatus.installed),
      running: Boolean(paiStatus.running),
      paiRoot,
      defaultInstallDir: resolveDefaultPaiRoot(userDataPath),
      detectable: existingPai,
    },
    comfyui,
    ffmpeg,
    ready,
    // 核心三件套齐全即可创作；FFmpeg 为视频后期可选依赖
    allReady: ready.ollama && ready.pai && ready.comfyui,
  };
}

module.exports = {
  getSetupStatus,
  installOllama,
  installPaiRuntime,
  installFfmpeg,
  probeFfmpeg,
  bindPaiRoot,
  openComfyGuide,
  scanAndApplyComfyUi,
  findExistingPaiRoots,
  resolveDefaultPaiRoot,
  DEFAULT_COMFY_GUIDE_URL,
  DEFAULT_PAI_RUNTIME_URL,
  OLLAMA_SETUP_URL,
  FFMPEG_GUIDE_URL,
};
