const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_SYSTEM_PROMPT = "你是一个乐于助人的助手。";
const OLLAMA_API_BASE = "http://127.0.0.1:11434";
const OLLAMA_INSTALL_URL = "https://ollama.com/download";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeModelPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, "/");
}

function resolveOllamaName(model) {
  if (model.ollama?.name) {
    return model.ollama.name;
  }
  return model.id.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}

function buildModelfileContent(model, ggufPath) {
  const ollamaConfig = model.ollama || {};
  const lines = [`FROM ${normalizeModelPath(ggufPath)}`, ""];

  const systemPrompt = ollamaConfig.system || DEFAULT_SYSTEM_PROMPT;
  lines.push(`SYSTEM """${systemPrompt}"""`, "");

  if (ollamaConfig.template) {
    lines.push(`TEMPLATE """${ollamaConfig.template}"""`, "");
  }

  const parameters = {
    temperature: 0.7,
    top_p: 0.9,
    ...(ollamaConfig.parameters || {}),
  };

  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push(`PARAMETER ${key} ${JSON.stringify(String(item))}`);
      }
    } else {
      lines.push(`PARAMETER ${key} ${value}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

class OllamaService {
  constructor(options = {}) {
    this.binary = options.binary || "ollama";
    this.apiBase = options.apiBase || OLLAMA_API_BASE;
    this._available = null;
    this._activeChats = new Map();
    this._serveProcess = null;
  }

  abortChat(chatId) {
    const controller = this._activeChats.get(chatId);
    if (controller) {
      controller.abort();
      this._activeChats.delete(chatId);
      return true;
    }
    return false;
  }

  async pingApi(timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.apiBase}/api/tags`, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async isCliInstalled() {
    try {
      await this._runCommand(["--version"]);
      return true;
    } catch (error) {
      if (error.message?.includes("未找到 ollama")) {
        return false;
      }
      return false;
    }
  }

  async getCliVersion() {
    const result = await this._runCommand(["--version"]);
    return result.stdout.trim().split("\n")[0] || "unknown";
  }

  async getStatus() {
    const installed = await this.isCliInstalled();
    if (!installed) {
      this._available = false;
      return {
        state: "not_installed",
        installed: false,
        running: false,
        available: false,
        modelCount: 0,
        error: "未检测到 Ollama，请先安装",
      };
    }

    let version = "unknown";
    try {
      version = await this.getCliVersion();
    } catch {
      version = "unknown";
    }

    const running = await this.pingApi();
    if (running) {
      let modelCount = 0;
      try {
        const result = await this._runCommand(["list"]);
        modelCount = this._parseListOutput(result.stdout).length;
      } catch {
        modelCount = 0;
      }
      this._available = true;
      return {
        state: "running",
        installed: true,
        running: true,
        available: true,
        version,
        modelCount,
      };
    }

    this._available = false;
    return {
      state: "installed_stopped",
      installed: true,
      running: false,
      available: false,
      version,
      modelCount: 0,
      error: "Ollama 已安装但未运行",
    };
  }

  async checkAvailable() {
    const status = await this.getStatus();
    return {
      available: status.available,
      installed: status.installed,
      running: status.running,
      state: status.state,
      version: status.version,
      modelCount: status.modelCount,
      error: status.error,
    };
  }

  async startServe(options = {}) {
    const status = await this.getStatus();
    if (status.state === "not_installed") {
      throw new Error("未安装 Ollama，请先下载安装");
    }
    if (status.running) {
      return { started: false, alreadyRunning: true, ...status };
    }

    const child = spawn(this.binary, ["serve"], {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });

    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });

    child.unref();
    this._serveProcess = child;

    const timeoutMs = options.timeoutMs || 15000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(500);
      if (await this.pingApi(2000)) {
        return { started: true, ...(await this.getStatus()) };
      }
    }

    throw new Error("Ollama 启动超时，请稍后重试或手动运行 ollama serve");
  }

  async listModels() {
    await this._ensureAvailable();
    const result = await this._runCommand(["list"]);
    return this._parseListOutput(result.stdout);
  }

  async isModelImported(ollamaName) {
    const models = await this.listModels();
    return models.some((item) => item.name === ollamaName || item.name.startsWith(`${ollamaName}:`));
  }

  async generateModelfile(model, ggufPath, modelfilesDir) {
    await fs.ensureDir(modelfilesDir);
    const modelfilePath = path.join(modelfilesDir, `${model.id}.Modelfile`);
    const content = buildModelfileContent(model, ggufPath);
    await fs.writeFile(modelfilePath, content, "utf-8");
    return { modelfilePath, content };
  }

  async createModel(ollamaName, modelfilePath, onProgress) {
    await this._ensureAvailable();

    if (onProgress) {
      onProgress({ stage: "creating", message: `正在执行 ollama create ${ollamaName}...` });
    }

    const result = await this._runCommand(["create", ollamaName, "-f", modelfilePath], {
      onStdout: (chunk) => {
        if (onProgress && chunk.trim()) {
          onProgress({ stage: "creating", message: chunk.trim() });
        }
      },
    });

    if (onProgress) {
      onProgress({ stage: "completed", message: `模型 ${ollamaName} 已导入 Ollama` });
    }

    return {
      ollamaName,
      modelfilePath,
      output: result.stdout.trim(),
    };
  }

  async removeModel(ollamaName, options = {}) {
    await this._ensureAvailable();
    const imported = await this.isModelImported(ollamaName);
    if (!imported) {
      if (options.ignoreMissing) {
        return { removed: false, skipped: true, ollamaName };
      }
      throw new Error(`Ollama 中未找到模型：${ollamaName}`);
    }
    await this._runCommand(["rm", ollamaName]);
    return { removed: true, ollamaName };
  }

  async importModel(model, ggufPath, modelfilesDir, onProgress, options = {}) {
    if (!(await fs.pathExists(ggufPath))) {
      throw new Error(`GGUF 文件不存在: ${ggufPath}`);
    }

    const ollamaName = resolveOllamaName(model);

    if (onProgress) {
      onProgress({ stage: "modelfile", message: "正在生成 Modelfile..." });
    }

    const { modelfilePath } = await this.generateModelfile(model, ggufPath, modelfilesDir);

    if (onProgress) {
      onProgress({ stage: "modelfile", message: `Modelfile 已保存: ${modelfilePath}` });
    }

    if (!options.force) {
      const alreadyImported = await this.isModelImported(ollamaName);
      if (alreadyImported) {
        if (onProgress) {
          onProgress({ stage: "skipped", message: `模型 ${ollamaName} 已在 Ollama 中，跳过创建` });
        }
        return {
          ollamaName,
          modelfilePath,
          skipped: true,
        };
      }
    }

    return this.createModel(ollamaName, modelfilePath, onProgress);
  }

  async chat(modelName, messages, onChunk, options = {}) {
    const chatId = options.chatId || "default";
    const controller = new AbortController();
    this._activeChats.set(chatId, controller);

    try {
      const response = await fetch(`${this.apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: Boolean(onChunk),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Ollama API 请求失败 (${response.status})`);
      }

      if (!onChunk) {
        const payload = await response.json();
        return this._normalizeChatResult(payload);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let stats = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.trim()) {
            continue;
          }
          try {
            const payload = JSON.parse(line);
            if (payload.message?.content) {
              fullContent += payload.message.content;
              onChunk(payload.message.content, payload);
            }
            if (payload.done) {
              stats = {
                promptTokens: payload.prompt_eval_count || 0,
                completionTokens: payload.eval_count || 0,
                totalTokens: (payload.prompt_eval_count || 0) + (payload.eval_count || 0),
              };
            }
          } catch {
            // ignore malformed stream chunks
          }
        }
      }

      return {
        message: { role: "assistant", content: fullContent },
        ...stats,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("生成已停止");
      }
      throw error;
    } finally {
      this._activeChats.delete(chatId);
    }
  }

  _normalizeChatResult(payload) {
    return {
      message: payload.message,
      promptTokens: payload.prompt_eval_count || 0,
      completionTokens: payload.eval_count || 0,
      totalTokens: (payload.prompt_eval_count || 0) + (payload.eval_count || 0),
    };
  }

  _parseListOutput(stdout) {
    const lines = stdout.trim().split("\n").slice(1);
    return lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        return {
          name: parts[0] || "",
          id: parts[1] || "",
          size: parts[2] || "",
          modified: parts.slice(3).join(" ") || "",
        };
      });
  }

  async _ensureAvailable() {
    if (await this.pingApi()) {
      this._available = true;
      return;
    }

    const installed = await this.isCliInstalled();
    if (!installed) {
      throw new Error("未找到 ollama 命令，请确认 Ollama 已安装并在 PATH 中");
    }
    throw new Error("Ollama 未运行，请先启动 Ollama");
  }

  _runCommand(args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        windowsHide: true,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        if (options.onStdout) {
          options.onStdout(text);
        }
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        if (error.code === "ENOENT") {
          reject(new Error("未找到 ollama 命令，请确认 Ollama 已安装并在 PATH 中"));
          return;
        }
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(stderr.trim() || stdout.trim() || `ollama ${args.join(" ")} 失败 (code ${code})`));
      });
    });
  }
}

module.exports = {
  OllamaService,
  buildModelfileContent,
  resolveOllamaName,
  normalizeModelPath,
  DEFAULT_SYSTEM_PROMPT,
  OLLAMA_INSTALL_URL,
};
