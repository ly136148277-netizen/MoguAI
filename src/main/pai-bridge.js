const axios = require("axios");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs-extra");

const DEFAULT_PAI_ROOT = "E:\\projects\\PAI";
const DEFAULT_API_URL = "http://127.0.0.1:8765";

class PaiBridge {
  constructor() {
    this._process = null;
    this._startedByApp = false;
  }

  resolvePaiRoot(settings) {
    return settings.paiRoot || process.env.PAI_ROOT || DEFAULT_PAI_ROOT;
  }

  resolveApiUrl(settings) {
    return (settings.paiApiUrl || DEFAULT_API_URL).replace(/\/$/, "");
  }

  async ping(settings) {
    try {
      const response = await axios.get(`${this.resolveApiUrl(settings)}/health`, { timeout: 2500 });
      return response.data?.ok === true;
    } catch {
      return false;
    }
  }

  async getStatus(settings) {
    const apiUrl = this.resolveApiUrl(settings);
    const paiRoot = this.resolvePaiRoot(settings);
    const pythonPath = path.join(paiRoot, ".venv", "Scripts", "python.exe");
    const installed = await fs.pathExists(pythonPath);
    const running = await this.ping(settings);

    return {
      installed,
      running,
      paiRoot,
      apiUrl,
      pythonPath,
      startedByApp: this._startedByApp,
    };
  }

  async ensureRunning(settings, logger) {
    if (await this.ping(settings)) {
      return { running: true, started: false };
    }

    const paiRoot = this.resolvePaiRoot(settings);
    const pythonPath = path.join(paiRoot, ".venv", "Scripts", "python.exe");
    if (!(await fs.pathExists(pythonPath))) {
      throw new Error(`未找到 PAI 环境：${pythonPath}`);
    }

    if (this._process && !this._process.killed) {
      await sleep(1500);
      if (await this.ping(settings)) {
        return { running: true, started: false };
      }
    }

    const apiUrl = new URL(this.resolveApiUrl(settings));
    const port = apiUrl.port || "8765";

    this._process = spawn(pythonPath, ["-m", "gateway.cli", "serve", "--port", port], {
      cwd: paiRoot,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, PAI_ROOT: paiRoot },
    });

    this._startedByApp = true;
    this._process.on("exit", () => {
      this._process = null;
      this._startedByApp = false;
    });

    logger?.info("已启动 PAI HTTP 服务", { paiRoot, port });

    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(500);
      if (await this.ping(settings)) {
        return { running: true, started: true };
      }
    }

    throw new Error(
      `PAI 服务启动超时。请确认路径正确、venv 存在，且端口 ${port} 未被占用。`
    );
  }

  async run(settings, command, level) {
    const apiUrl = this.resolveApiUrl(settings);
    const sessionLevel = level ?? settings.paiDefaultLevel ?? 1;

    try {
      const response = await axios.post(
        `${apiUrl}/run`,
        { command, level: sessionLevel },
        { timeout: 3_600_000 }
      );
      return response.data;
    } catch (error) {
      if (error.response?.data) {
        const body = error.response.data;
        if (body.needs_confirm) {
          return { ok: false, ...body };
        }
        const wrapped = new Error(body.error || body.reason || `PAI 请求失败 (${error.response.status})`);
        wrapped.response = error.response;
        throw wrapped;
      }
      if (error.code === "ECONNREFUSED") {
        throw new Error(`无法连接 PAI（${apiUrl}）。请检查 PAI 是否启动，或端口 8765 是否被占用。`);
      }
      throw error;
    }
  }

  async doctor(settings) {
    const apiUrl = this.resolveApiUrl(settings);
    const response = await axios.get(`${apiUrl}/doctor`, { timeout: 30_000 });
    return response.data;
  }

  async fetchCatalog(settings) {
    const apiUrl = this.resolveApiUrl(settings);
    const response = await axios.get(`${apiUrl}/workflows/catalog`, { timeout: 60_000 });
    return response.data;
  }

  async fetchPresets(settings) {
    const apiUrl = this.resolveApiUrl(settings);
    const response = await axios.get(`${apiUrl}/workflows/presets`, { timeout: 15_000 });
    return response.data;
  }

  async fetchCapabilities(settings) {
    const apiUrl = this.resolveApiUrl(settings);
    const response = await axios.get(`${apiUrl}/capabilities`, { timeout: 15_000 });
    return response.data;
  }

  shutdown() {
    if (this._process && !this._process.killed) {
      this._process.kill();
      this._process = null;
      this._startedByApp = false;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { PaiBridge, DEFAULT_PAI_ROOT, DEFAULT_API_URL };
