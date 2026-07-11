const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");

const COMFYUI_FOLDER_NAMES = [
  "ComfyUI",
  "ComfyUI_windows_portable",
  "ComfyUI_windows_portable_nvidia_or_amd_nvidia",
  "comfyui",
];

const COMFYUI_API_PORTS = [8189, 8188, 8180];
const OLLAMA_API = "http://127.0.0.1:11434";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listWindowsDrives() {
  if (process.platform !== "win32") {
    return [];
  }
  const drives = [];
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      await fs.access(drive);
      drives.push(drive);
    } catch {
      // skip
    }
  }
  return drives;
}

async function isComfyUiRoot(dirPath) {
  if (!(await fs.pathExists(dirPath))) {
    return false;
  }

  const markers = [
    "run_nvidia_gpu.bat",
    "run_cpu.bat",
    path.join("ComfyUI", "main.py"),
    path.join("ComfyUI", "server.py"),
    "main.py",
  ];

  for (const marker of markers) {
    if (await fs.pathExists(path.join(dirPath, marker))) {
      return true;
    }
  }
  return false;
}

async function probeComfyUiApi(baseUrl) {
  try {
    const response = await axios.get(`${baseUrl.replace(/\/$/, "")}/system_stats`, {
      timeout: 2000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function analyzeComfyUiRoot(dirPath) {
  const normalized = path.resolve(dirPath);
  const portable = await fs.pathExists(path.join(normalized, "python_embeded"));
  const codePath = (await fs.pathExists(path.join(normalized, "ComfyUI", "main.py")))
    ? path.join(normalized, "ComfyUI")
    : normalized;

  let startScript = null;
  for (const name of ["run_nvidia_gpu.bat", "run_cpu.bat", "run.bat"]) {
    const candidate = path.join(normalized, name);
    if (await fs.pathExists(candidate)) {
      startScript = candidate;
      break;
    }
  }

  let running = false;
  let apiUrl = null;
  for (const port of COMFYUI_API_PORTS) {
    const url = `http://127.0.0.1:${port}`;
    if (await probeComfyUiApi(url)) {
      running = true;
      apiUrl = url;
      break;
    }
  }

  return {
    path: normalized,
    codePath,
    portable,
    startScript,
    running,
    apiUrl: apiUrl || "http://127.0.0.1:8189",
  };
}

async function findComfyUiCandidates(logger) {
  const seen = new Set();
  const candidates = [];

  async function addCandidate(dirPath) {
    const key = path.resolve(dirPath).toLowerCase();
    if (seen.has(key)) {
      return;
    }
    if (!(await isComfyUiRoot(dirPath))) {
      return;
    }
    seen.add(key);
    candidates.push(await analyzeComfyUiRoot(dirPath));
  }

  const drives = await listWindowsDrives();
  const searchRoots = new Set();

  for (const drive of drives) {
    searchRoots.add(drive);
    for (const name of COMFYUI_FOLDER_NAMES) {
      searchRoots.add(path.join(drive, name));
    }
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME;
  if (userProfile) {
    searchRoots.add(path.join(userProfile, "ComfyUI"));
    searchRoots.add(path.join(userProfile, "Desktop", "ComfyUI"));
    searchRoots.add(path.join(userProfile, "Downloads", "ComfyUI"));
  }

  searchRoots.add("C:\\Program Files\\ComfyUI");
  searchRoots.add("D:\\ComfyUI");
  searchRoots.add("E:\\ComfyUI");
  searchRoots.add("F:\\ComfyUI");

  for (const root of searchRoots) {
    try {
      await addCandidate(root);
      if (await fs.pathExists(root)) {
        const entries = await fs.readdir(root);
        for (const entry of entries) {
          if (COMFYUI_FOLDER_NAMES.some((name) => name.toLowerCase() === entry.toLowerCase())) {
            await addCandidate(path.join(root, entry));
          }
        }
      }
    } catch (error) {
      logger?.warn("ComfyUI 扫描跳过", { root, message: error.message });
    }
  }

  candidates.sort((a, b) => {
    if (a.running !== b.running) {
      return a.running ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });

  return candidates;
}

async function detectOllama(ollamaService) {
  const status = await ollamaService.getStatus();
  const home = process.env.OLLAMA_HOME || path.join(process.env.USERPROFILE || "", ".ollama");
  const modelsPath = process.env.OLLAMA_MODELS || "";

  return {
    installed: Boolean(status.installed),
    running: Boolean(status.running),
    available: Boolean(status.available),
    version: status.version || null,
    modelCount: status.modelCount ?? 0,
    apiUrl: OLLAMA_API,
    home: (await fs.pathExists(home)) ? home : null,
    modelsPath: modelsPath || null,
    error: status.error || null,
  };
}

async function runPaiScanApps(paiRoot, logger) {
  const pythonPath = path.join(paiRoot, ".venv", "Scripts", "python.exe");
  const scriptPath = path.join(paiRoot, "tools", "scan_local_apps.py");

  if (!(await fs.pathExists(pythonPath)) || !(await fs.pathExists(scriptPath))) {
    return { ok: false, skipped: true, reason: "PAI 或 scan 脚本不存在" };
  }

  return new Promise((resolve) => {
    const child = spawn(pythonPath, [scriptPath], {
      cwd: paiRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, reason: "扫描本机软件超时（120s）" });
    }, 120_000);

    child.on("exit", async (code) => {
      clearTimeout(timer);
      const appsYaml = path.join(paiRoot, "config", "apps.local.yaml");
      let appCount = 0;
      let comfyuiApps = [];

      if (await fs.pathExists(appsYaml)) {
        const text = await fs.readFile(appsYaml, "utf8");
        appCount = (text.match(/^\s+\w+:/gm) || []).length;
        comfyuiApps = text
          .split("\n")
          .filter((line) => /comfyui/i.test(line))
          .map((line) => line.trim())
          .slice(0, 5);
      }

      resolve({
        ok: code === 0,
        exitCode: code,
        appCount,
        comfyuiApps,
        stdout: stdout.slice(-500),
        stderr: stderr.slice(-300),
      });
    });
  });
}

function readConfiguredComfyUi(paiRoot) {
  const yamlPath = path.join(paiRoot, "config", "pai.yaml");
  if (!fs.pathExistsSync(yamlPath)) {
    return null;
  }
  const text = fs.readFileSync(yamlPath, "utf8");
  const pathMatch = text.match(/^\s*path:\s*"(.*?)"/m);
  const apiMatch = text.match(/^\s*api:\s*"(.*?)"/m);
  const enabledMatch = text.match(/^\s*enabled:\s*(true|false)/m);

  const section = text.split(/^comfyui:/m)[1]?.split(/^[^\s]/m)[0] || text;
  const sectionPath = section.match(/^\s*path:\s*"(.*?)"/m);
  const sectionApi = section.match(/^\s*api:\s*"(.*?)"/m);

  return {
    enabled: enabledMatch ? enabledMatch[1] === "true" : true,
    path: sectionPath?.[1] || pathMatch?.[1] || null,
    api: sectionApi?.[1] || apiMatch?.[1] || null,
  };
}

function patchPaiYamlComfyUi(paiRoot, comfyui) {
  const yamlPath = path.join(paiRoot, "config", "pai.yaml");
  if (!fs.pathExistsSync(yamlPath)) {
    throw new Error(`未找到 PAI 配置：${yamlPath}`);
  }

  let content = fs.readFileSync(yamlPath, "utf8");
  const normalizedPath = comfyui.path.replace(/\\/g, "/");
  const codePath = (comfyui.codePath || path.join(comfyui.path, "ComfyUI")).replace(/\\/g, "/");
  const apiUrl = comfyui.apiUrl || "http://127.0.0.1:8189";
  const startCommand = comfyui.startScript
    ? comfyui.startScript.replace(/\\/g, "/")
    : `${normalizedPath}/run_nvidia_gpu.bat`;

  const inComfyui = (line) => /^comfyui:/.test(line);
  const lines = content.split("\n");
  let sectionStart = lines.findIndex(inComfyui);
  if (sectionStart < 0) {
    throw new Error("pai.yaml 中未找到 comfyui 配置段");
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^[a-zA-Z_][\w-]*:/.test(lines[i]) && !/^\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  const setField = (key, value) => {
    const pattern = new RegExp(`^(\\s*${key}:\\s*).*$`);
    for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
      if (pattern.test(lines[i])) {
        lines[i] = `${lines[i].match(pattern)[1]}"${value}"`;
        return;
      }
    }
  };

  setField("path", normalizedPath);
  setField("code_path", codePath);
  setField("api", apiUrl);
  setField("start_command", startCommand);

  content = lines.join("\n");
  content = ensureWhitelistPath(content, normalizedPath);

  fs.writeFileSync(yamlPath, content, "utf8");
  return { yamlPath, path: normalizedPath, api: apiUrl };
}

function ensureWhitelistPath(content, normalizedPath) {
  const yamlLines = content.split("\n");
  const wlIndex = yamlLines.findIndex((line) => /^\s*whitelist:\s*$/.test(line));
  if (wlIndex < 0) {
    return content;
  }

  let insertAt = wlIndex + 1;
  for (let i = wlIndex + 1; i < yamlLines.length; i += 1) {
    if (/^\s*- "/.test(yamlLines[i])) {
      if (yamlLines[i].includes(`"${normalizedPath}"`)) {
        return content;
      }
      insertAt = i + 1;
      continue;
    }
    if (yamlLines[i].trim() === "") {
      continue;
    }
    break;
  }

  yamlLines.splice(insertAt, 0, `    - "${normalizedPath}"`);
  return yamlLines.join("\n");
}

async function scanLocalEnvironment(options = {}) {
  const {
    paiBridge,
    ollamaService,
    settings,
    logger,
    includeAppScan = true,
    includeDoctor = true,
  } = options;

  const drives = await listWindowsDrives();
  const ollama = await detectOllama(ollamaService);
  const comfyuiCandidates = await findComfyUiCandidates(logger);
  const bestComfyui = comfyuiCandidates[0] || null;

  const paiRoot = paiBridge.resolvePaiRoot(settings);
  const paiStatus = await paiBridge.getStatus(settings);
  const configuredComfyui = readConfiguredComfyUi(paiRoot);

  let doctor = null;
  if (includeDoctor && paiStatus.installed) {
    try {
      if (!paiStatus.running) {
        await paiBridge.ensureRunning(settings, logger);
      }
      doctor = await paiBridge.doctor(settings);
    } catch (error) {
      doctor = { error: error.message };
    }
  }

  let appScan = null;
  if (includeAppScan && paiStatus.installed) {
    appScan = await runPaiScanApps(paiRoot, logger);
  }

  const issues = [];
  if (!ollama.installed) {
    issues.push("未安装 Ollama — AI 聊天问答不可用");
  } else if (!ollama.running) {
    issues.push("Ollama 未运行 — 可在设置中开启启动时自动拉起");
  }

  if (!paiStatus.installed) {
    issues.push(`未找到 PAI 环境 — 请在设置中配置 PAI 路径（当前：${paiRoot}）`);
  } else if (!paiStatus.running) {
    issues.push("PAI 管家服务未运行 — 点击「连接 PAI」");
  }

  if (!bestComfyui) {
    issues.push("未在本机常见位置找到 ComfyUI 安装目录");
  } else if (!bestComfyui.running) {
    issues.push(`已找到 ComfyUI（${bestComfyui.path}），但 API 未运行 — 可说「打开 ComfyUI」`);
  }

  if (configuredComfyui?.path && bestComfyui) {
    const cfgNorm = configuredComfyui.path.replace(/\\/g, "/").toLowerCase();
    const foundNorm = bestComfyui.path.replace(/\\/g, "/").toLowerCase();
    if (cfgNorm !== foundNorm) {
      issues.push(`PAI 配置的 ComfyUI 路径与扫描结果不一致 — 可一键写入配置`);
    }
  }

  const readyForChat = ollama.installed && ollama.running;
  const readyForButler = paiStatus.installed && paiStatus.running;
  const readyForComfyui = Boolean(bestComfyui?.running);

  return {
    scannedAt: new Date().toISOString(),
    drives,
    ollama,
    comfyui: {
      candidates: comfyuiCandidates,
      best: bestComfyui,
      configured: configuredComfyui,
    },
    pai: {
      ...paiStatus,
      configuredComfyui,
    },
    doctor,
    appScan,
    summary: {
      readyForChat,
      readyForButler,
      readyForComfyui,
      issues,
    },
  };
}

module.exports = {
  scanLocalEnvironment,
  applyComfyUiToPai: patchPaiYamlComfyUi,
  findComfyUiCandidates,
  listWindowsDrives,
};
