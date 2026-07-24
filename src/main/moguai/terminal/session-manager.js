const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEFAULT_ENV_ALLOWLIST = new Set([
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATH",
  "PATHEXT",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "LANG",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
  "NODE_ENV",
  "PYTHONPATH",
  "PYTHONDONTWRITEBYTECODE",
  "PYTHONUNBUFFERED",
]);
const SECRET_ENV_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH|COOKIE)/i;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalExisting(input) {
  const resolved = path.resolve(String(input || "").trim());
  if (!resolved || !fs.existsSync(resolved)) {
    throw codedError("path_missing", `Path does not exist: ${resolved}`);
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!fs.statSync(canonical).isDirectory()) {
    throw codedError("not_directory", `Path is not a directory: ${canonical}`);
  }
  return canonical;
}

function pathInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function samePath(a, b) {
  return process.platform === "win32"
    ? String(a).toLowerCase() === String(b).toLowerCase()
    : String(a) === String(b);
}

function buildControlledEnv({
  requested = {},
  source = process.env,
  allowlist = DEFAULT_ENV_ALLOWLIST,
  inherit = DEFAULT_ENV_ALLOWLIST,
} = {}) {
  const allowed = new Set([...allowlist].map(String));
  const inherited = new Set([...inherit].map(String));
  const out = {};
  for (const key of inherited) {
    if (!allowed.has(key) || SECRET_ENV_RE.test(key)) continue;
    if (source[key] != null) out[key] = String(source[key]);
  }
  for (const [key, value] of Object.entries(requested || {})) {
    if (!allowed.has(key) || SECRET_ENV_RE.test(key) || value == null) continue;
    out[key] = String(value);
  }
  return out;
}

function publicSession(session) {
  return {
    id: session.id,
    executable: session.executable,
    args: [...session.args],
    cwd: session.cwd,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt || null,
    exitCode: session.exitCode ?? null,
    signal: session.signal ?? null,
    reason: session.reason || null,
    output: session.output,
    outputTruncated: session.outputTruncated,
  };
}

class TerminalSessionManager {
  constructor(options = {}) {
    if (typeof options.authorize !== "function") {
      throw codedError("authorization_required", "Terminal manager requires an authorization callback");
    }
    const roots = Array.isArray(options.allowedRoots) ? options.allowedRoots : [];
    if (!roots.length) throw codedError("allowed_roots_required", "At least one allowed root is required");
    this.allowedRoots = roots.map(canonicalExisting);
    this.authorize = options.authorize;
    this.audit = typeof options.audit === "function" ? options.audit : () => {};
    this.pty = options.pty || require("node-pty");
    this.execFile = options.execFile || execFileAsync;
    this.maxConcurrent = Math.max(1, Math.min(8, Number(options.maxConcurrent) || 2));
    this.maxOutputBytes = Math.max(256, Math.min(4 * 1024 * 1024, Number(options.maxOutputBytes) || 256 * 1024));
    this.maxDurationMs = Math.max(10, Math.min(60 * 60_000, Number(options.maxDurationMs) || 5 * 60_000));
    this.envAllowlist = new Set(options.envAllowlist || DEFAULT_ENV_ALLOWLIST);
    this.inheritEnv = new Set(options.inheritEnv || DEFAULT_ENV_ALLOWLIST);
    this.sessions = new Map();
    this.completed = new Map();
    this.sequence = 0;
    this.pendingStarts = 0;
  }

  _audit(event, payload = {}) {
    Promise.resolve(this.audit({ event, at: new Date().toISOString(), ...payload })).catch(() => {});
  }

  _canonicalCwd(cwd) {
    const candidate = canonicalExisting(cwd);
    const allowed = this.allowedRoots.some((root) => pathInside(root, candidate));
    if (!allowed) throw codedError("cwd_not_allowed", "Working directory is outside configured roots");
    const requested = path.resolve(String(cwd || ""));
    if (!samePath(candidate, requested) && !this.allowedRoots.some((root) => samePath(candidate, root))) {
      // realpath is the authority; this check primarily makes junction/symlink traversal explicit.
      const requestedInside = this.allowedRoots.some((root) => pathInside(root, requested));
      if (!requestedInside) throw codedError("cwd_not_allowed", "Working directory escapes configured roots");
    }
    return candidate;
  }

  async start(request = {}) {
    if (this.sessions.size + this.pendingStarts >= this.maxConcurrent) {
      throw codedError("session_limit", `Maximum concurrent terminal sessions reached (${this.maxConcurrent})`);
    }
    this.pendingStarts += 1;
    try {
      return await this._startAuthorized(request);
    } finally {
      this.pendingStarts -= 1;
    }
  }

  async _startAuthorized(request = {}) {
    const executable = String(request.executable || "").trim();
    if (!executable || executable.includes("\0")) throw codedError("invalid_executable", "Executable is required");
    if (!Array.isArray(request.args)) throw codedError("invalid_args", "args must be an array");
    const args = request.args.map((arg) => {
      const value = String(arg);
      if (value.includes("\0") || value.length > 32_768) throw codedError("invalid_arg", "Invalid command argument");
      return value;
    });
    const cwd = this._canonicalCwd(request.cwd);
    const durationMs = Math.max(10, Math.min(this.maxDurationMs, Number(request.durationMs) || this.maxDurationMs));
    const permissionPayload = {
      tool: "mogu.terminal.start",
      action: "start",
      // Arbitrary process creation is always L3 so remembered L2 grants cannot
      // become a blanket terminal authorization.
      riskLevel: 3,
      executable,
      args,
      cwd,
      channel: request.permission?.channel || "desktop",
      runId: request.permission?.runId || null,
      sessionKey: request.permission?.sessionKey || null,
      requireGatewayApproval: request.permission?.requireGatewayApproval === true,
      gatewayApproved: request.permission?.gatewayApproved === true,
    };
    const decision = await this.authorize(permissionPayload);
    if (!(decision === true || decision?.allowed === true)) {
      this._audit("terminal.denied", {
        executable,
        args,
        cwd,
        reason: decision?.reason || "authorization_denied",
      });
      throw codedError("authorization_denied", decision?.message || "Terminal start was not authorized");
    }

    const env = buildControlledEnv({
      requested: request.env,
      source: request.sourceEnv || process.env,
      allowlist: this.envAllowlist,
      inherit: this.inheritEnv,
    });
    const id = `term-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    let processHandle;
    try {
      processHandle = this.pty.spawn(executable, args, {
        name: String(request.name || "xterm-256color"),
        cols: Math.max(20, Math.min(500, Number(request.cols) || 120)),
        rows: Math.max(5, Math.min(200, Number(request.rows) || 30)),
        cwd,
        env,
        useConpty: process.platform === "win32",
      });
    } catch (error) {
      this._audit("terminal.spawn_failed", { id, executable, args, cwd, reason: error.message });
      throw codedError("spawn_failed", error.message || "Failed to start terminal");
    }

    let complete;
    const completion = new Promise((resolve) => {
      complete = resolve;
    });
    const session = {
      id,
      executable,
      args,
      cwd,
      process: processHandle,
      status: "running",
      output: "",
      outputTruncated: false,
      startedAt: new Date().toISOString(),
      endedAt: null,
      completion,
      complete,
      timer: null,
      disposables: [],
    };
    const append = (chunk) => {
      const combined = Buffer.from(session.output + String(chunk || ""), "utf8");
      if (combined.length > this.maxOutputBytes) {
        session.output = combined.subarray(combined.length - this.maxOutputBytes).toString("utf8");
        session.outputTruncated = true;
      } else {
        session.output = combined.toString("utf8");
      }
      const eventData = Buffer.from(String(chunk || ""), "utf8")
        .subarray(-this.maxOutputBytes)
        .toString("utf8");
      request.onData?.({ id, data: eventData, truncated: eventData !== String(chunk || "") });
    };
    this.sessions.set(id, session);
    session.disposables.push(processHandle.onData(append));
    session.disposables.push(
      processHandle.onExit(({ exitCode, signal }) => this._finish(session, { exitCode, signal }))
    );
    session.timer = setTimeout(() => {
      this.cancel(id, "timeout").catch(() => {});
    }, durationMs);
    session.timer.unref?.();
    this._audit("terminal.started", { id, executable, args, cwd, durationMs });
    return publicSession(session);
  }

  _finish(session, { exitCode = null, signal = null } = {}) {
    if (session.status !== "running" && session.status !== "cancelling") return;
    clearTimeout(session.timer);
    session.status = session.reason === "timeout" ? "timed_out" : session.reason ? "cancelled" : "exited";
    session.exitCode = exitCode;
    session.signal = signal;
    session.endedAt = new Date().toISOString();
    for (const disposable of session.disposables) disposable?.dispose?.();
    this.sessions.delete(session.id);
    this.completed.set(session.id, session);
    if (this.completed.size > 100) this.completed.delete(this.completed.keys().next().value);
    const result = publicSession(session);
    this._audit("terminal.finished", result);
    session.complete(result);
  }

  async cancel(id, reason = "cancelled") {
    const session = this.sessions.get(String(id || ""));
    if (!session) return { ok: false, code: "session_not_found" };
    if (session.status !== "running") return { ok: false, code: "session_not_running" };
    session.status = "cancelling";
    session.reason = String(reason || "cancelled");
    clearTimeout(session.timer);
    if (process.platform === "win32" && Number.isFinite(Number(session.process.pid))) {
      try {
        await this.execFile("taskkill.exe", ["/PID", String(session.process.pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 10_000,
        });
      } catch {
        // node-pty kill remains the fallback when taskkill races with process exit.
      }
    }
    try {
      session.process.kill();
    } catch {
      this._finish(session, { exitCode: null, signal: 9 });
    }
    this._audit("terminal.cancel_requested", { id: session.id, reason: session.reason });
    return { ok: true, id: session.id, reason: session.reason };
  }

  get(id) {
    const session = this.sessions.get(String(id || "")) || this.completed.get(String(id || ""));
    return session ? publicSession(session) : null;
  }

  list() {
    return [...this.sessions.values()].map(publicSession);
  }

  wait(id) {
    const active = this.sessions.get(String(id || ""));
    if (active) return active.completion;
    const done = this.completed.get(String(id || ""));
    return Promise.resolve(done ? publicSession(done) : null);
  }
}

module.exports = {
  TerminalSessionManager,
  DEFAULT_ENV_ALLOWLIST,
  SECRET_ENV_RE,
  buildControlledEnv,
  canonicalExisting,
  pathInside,
};
