const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { canonicalRoot } = require("./repo-index");

const DEFAULT_ENV_ALLOWLIST = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "WINDIR",
  "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "LANG", "LC_ALL",
];

function buildAllowlistedEnv(source = process.env, configured = {}, allowlist = DEFAULT_ENV_ALLOWLIST) {
  const allowed = new Set((allowlist || []).map(String));
  const env = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(configured, key)) {
      env[key] = String(configured[key]);
    } else if (Object.prototype.hasOwnProperty.call(source, key)) {
      env[key] = String(source[key]);
    }
  }
  return env;
}

class LspFramer {
  constructor({ maxMessageBytes = 4 * 1024 * 1024, onMessage, onError } = {}) {
    this.maxMessageBytes = maxMessageBytes;
    this.onMessage = onMessage || (() => {});
    this.onError = onError || (() => {});
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > this.maxMessageBytes + 8192) {
      return this.fail("LSP input buffer exceeded limit");
    }
    while (this.buffer.length) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i.exec(header);
      if (!match) return this.fail("LSP message missing Content-Length");
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > this.maxMessageBytes) {
        return this.fail("LSP message exceeds limit");
      }
      const end = headerEnd + 4 + length;
      if (this.buffer.length < end) return;
      const body = this.buffer.subarray(headerEnd + 4, end).toString("utf8");
      this.buffer = this.buffer.subarray(end);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        return this.fail("Invalid LSP JSON payload");
      }
    }
  }

  fail(message) {
    this.buffer = Buffer.alloc(0);
    this.onError(new Error(message));
  }
}

class LspManager extends EventEmitter {
  constructor(config = {}, options = {}) {
    super();
    const command = String(config.command || "").trim();
    if (!command) throw new Error("configured LSP command is required");
    if (config.args != null && !Array.isArray(config.args)) throw new Error("LSP args must be an array");
    this.config = {
      command,
      args: (config.args || []).map(String),
      env: config.env && typeof config.env === "object" ? config.env : {},
    };
    this.root = canonicalRoot(config.workspace || options.workspace);
    this.requestTimeoutMs = Math.min(120_000, Math.max(10, Number(options.requestTimeoutMs) || 10_000));
    this.initializeTimeoutMs = Math.min(
      120_000,
      Math.max(this.requestTimeoutMs, Number(options.initializeTimeoutMs) || 10_000)
    );
    this.shutdownTimeoutMs = Math.min(10_000, Math.max(50, Number(options.shutdownTimeoutMs) || 1500));
    this.maxMessageBytes = Math.min(16 * 1024 * 1024, Math.max(1024, Number(options.maxMessageBytes) || 4 * 1024 * 1024));
    this.maxOutputBytes = Math.min(4 * 1024 * 1024, Math.max(1024, Number(options.maxOutputBytes) || 256 * 1024));
    this.envAllowlist = options.envAllowlist || DEFAULT_ENV_ALLOWLIST;
    this.spawn = options.spawn || spawn;
    this.child = null;
    this.state = "stopped";
    this.nextId = 1;
    this.pending = new Map();
    this.stderrBytes = 0;
    this.restartUsed = false;
    this.stopping = false;
    this.lastCrash = null;
  }

  async start() {
    if (this.child) throw new Error("LSP server is already running");
    this.stopping = false;
    this.stderrBytes = 0;
    this.state = "starting";
    const child = this.spawn(this.config.command, this.config.args, {
      cwd: this.root,
      env: buildAllowlistedEnv(process.env, this.config.env, this.envAllowlist),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    const framer = new LspFramer({
      maxMessageBytes: this.maxMessageBytes,
      onMessage: (message) => this._handleMessage(message),
      onError: (error) => this._protocolFailure(error),
    });
    child.stdout.on("data", (chunk) => framer.push(chunk));
    child.stderr.on("data", (chunk) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > this.maxOutputBytes) {
        this._protocolFailure(new Error("LSP stderr exceeded limit"));
        return;
      }
      this.emit("output", String(chunk));
    });
    child.once("error", (error) => this._handleCrash(error));
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (!this.stopping) {
        const error = new Error(`LSP server exited (${code ?? signal ?? "unknown"})`);
        error.code = "lsp_crash";
        this._handleCrash(error, { code, signal });
      } else {
        this.state = "stopped";
      }
    });

    try {
      const result = await this.request("initialize", {
        processId: process.pid,
        rootUri: new URL(`file://${this.root.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1:")}`).href,
        capabilities: {},
        workspaceFolders: null,
      }, { timeoutMs: this.initializeTimeoutMs });
      this.notify("initialized", {});
      this.state = "running";
      this.emit("initialized", result);
      return result;
    } catch (error) {
      if (this.child === child) child.kill();
      this.child = null;
      this.state = "stopped";
      throw error;
    }
  }

  _write(message) {
    if (!this.child?.stdin?.writable) throw new Error("LSP server is not running");
    const body = Buffer.from(JSON.stringify(message), "utf8");
    if (body.length > this.maxMessageBytes) throw new Error("LSP outbound message exceeds limit");
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  notify(method, params) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  request(method, params, options = {}) {
    if (!this.child) return Promise.reject(new Error("LSP server is not running"));
    const id = this.nextId++;
    const timeoutMs = Math.min(120_000, Math.max(10, Number(options.timeoutMs) || this.requestTimeoutMs));
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.signal?.removeEventListener("abort", pending.onAbort);
        this.pending.delete(id);
        if (error) reject(error);
        else resolve(result);
      };
      const cancel = (code, message) => {
        try {
          this.notify("$/cancelRequest", { id });
        } catch {
          // The process may already be gone.
        }
        const error = new Error(message);
        error.code = code;
        finish(error);
      };
      const timer = setTimeout(() => cancel("request_timeout", `LSP request timed out: ${method}`), timeoutMs);
      const signal = options.signal;
      const onAbort = () => cancel("request_cancelled", `LSP request cancelled: ${method}`);
      this.pending.set(id, { resolve, reject, timer, signal, onAbort, finish });
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        finish(error);
      }
    });
  }

  _handleMessage(message) {
    if (message && Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.error) {
        const error = new Error(message.error.message || "LSP request failed");
        error.code = message.error.code;
        pending.finish(error);
      } else {
        pending.finish(null, message.result);
      }
      return;
    }
    this.emit("notification", message);
  }

  _protocolFailure(error) {
    if (this.child) this.child.kill();
    this._handleCrash(error);
  }

  _handleCrash(error, detail = {}) {
    if (this.stopping || this.state === "crashed") return;
    this.state = "crashed";
    this.lastCrash = {
      at: new Date().toISOString(),
      message: error.message || String(error),
      ...detail,
    };
    for (const pending of this.pending.values()) pending.finish(error);
    this.emit("crash", this.lastCrash);
  }

  async stop() {
    const child = this.child;
    if (!child) {
      this.state = "stopped";
      return;
    }
    this.stopping = true;
    try {
      await this.request("shutdown", null, { timeoutMs: this.shutdownTimeoutMs });
      this.notify("exit");
    } catch {
      // Continue with bounded termination.
    }
    if (this.child === child) child.kill();
    this.child = null;
    this.state = "stopped";
    for (const pending of this.pending.values()) {
      const error = new Error("LSP server stopped");
      error.code = "lsp_stopped";
      pending.finish(error);
    }
  }

  async restartOnce() {
    if (this.restartUsed) {
      const error = new Error("LSP restart already used");
      error.code = "restart_exhausted";
      throw error;
    }
    this.restartUsed = true;
    await this.stop();
    return this.start();
  }
}

module.exports = {
  LspManager,
  LspFramer,
  buildAllowlistedEnv,
  DEFAULT_ENV_ALLOWLIST,
};
