/**
 * Minimal MCP stdio client — list/call tools from configured servers for the brain.
 * Protocol: JSON-RPC 2.0 over newline-delimited stdout/stdin (MCP stdio transport).
 */

const { spawn } = require("child_process");
const EventEmitter = require("events");

class McpSession extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.tools = [];
    this.ready = false;
  }

  start() {
    if (this.proc) return;
    const command = String(this.server.command || "").trim();
    if (!command) throw new Error(`MCP server ${this.server.id} 缺少 command`);
    const args = Array.isArray(this.server.args) ? this.server.args.map(String) : [];
    const env = { ...process.env, ...(this.server.env || {}) };
    this.proc = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: Boolean(this.server.shell),
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.on("data", (chunk) => {
      this.emit("stderr", String(chunk));
    });
    this.proc.on("exit", (code) => {
      this.ready = false;
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP 进程退出 code=${code}`));
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }
  }

  request(method, params = {}, timeoutMs = 20000) {
    this.start();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.proc.stdin.write(`${payload}\n`);
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mogu-ai", version: "2.1.0" },
    });
    try {
      this.proc.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
      );
    } catch {
      /* ignore */
    }
    this.ready = true;
    return this;
  }

  async listTools() {
    if (!this.ready) await this.initialize();
    const result = await this.request("tools/list", {});
    this.tools = Array.isArray(result?.tools) ? result.tools : [];
    return this.tools;
  }

  async callTool(name, args = {}) {
    if (!this.ready) await this.initialize();
    return this.request("tools/call", { name, arguments: args || {} }, 60000);
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
    this.ready = false;
  }
}

class McpManager {
  constructor() {
    this.sessions = new Map();
  }

  normalizeServers(settings = {}) {
    const list = Array.isArray(settings.mcpServers) ? settings.mcpServers : [];
    return list
      .filter((s) => s && s.enabled !== false && String(s.command || "").trim())
      .map((s) => ({
        id: String(s.id || s.name || "mcp").trim(),
        label: String(s.label || s.name || s.id || "mcp"),
        command: String(s.command || "").trim(),
        args: Array.isArray(s.args) ? s.args : [],
        env: s.env && typeof s.env === "object" ? s.env : {},
        shell: s.shell === true,
        enabled: s.enabled !== false,
      }));
  }

  async getSession(server) {
    const key = server.id;
    let session = this.sessions.get(key);
    if (!session) {
      session = new McpSession(server);
      this.sessions.set(key, session);
    }
    if (!session.ready) {
      try {
        await session.initialize();
      } catch (error) {
        session.stop();
        this.sessions.delete(key);
        throw error;
      }
    }
    return session;
  }

  async listAllTools(settings) {
    const servers = this.normalizeServers(settings);
    const tools = [];
    const errors = [];
    for (const server of servers) {
      try {
        const session = await this.getSession(server);
        const listed = await session.listTools();
        for (const t of listed) {
          const name = `mcp__${server.id}__${t.name}`;
          tools.push({
            type: "function",
            function: {
              name,
              description: `[MCP:${server.label}] ${t.description || t.name}`,
              parameters: t.inputSchema || { type: "object", properties: {} },
            },
            _mcp: { serverId: server.id, toolName: t.name },
          });
        }
      } catch (error) {
        errors.push({ serverId: server.id, error: error.message });
      }
    }
    return { tools, errors, servers: servers.map((s) => s.id) };
  }

  async call(settings, toolName, args = {}) {
    const m = String(toolName || "").match(/^mcp__([^_]+)__(.+)$/);
    // allow ids with underscores: mcp__my_server__tool_name
    const m2 = String(toolName || "").match(/^mcp__(.+?)__(.+)$/);
    const match = m2 || m;
    if (!match) return { ok: false, error: `非法 MCP 工具名：${toolName}` };
    const serverId = match[1];
    const remoteName = match[2];
    const server = this.normalizeServers(settings).find((s) => s.id === serverId);
    if (!server) return { ok: false, error: `未配置 MCP server：${serverId}` };
    try {
      const session = await this.getSession(server);
      const result = await session.callTool(remoteName, args);
      return { ok: true, serverId, tool: remoteName, result };
    } catch (error) {
      return { ok: false, serverId, tool: remoteName, error: error.message };
    }
  }

  async status(settings) {
    const servers = this.normalizeServers(settings);
    return {
      ok: true,
      count: servers.length,
      servers: servers.map((s) => ({
        id: s.id,
        label: s.label,
        command: s.command,
        connected: this.sessions.get(s.id)?.ready === true,
      })),
    };
  }

  stopAll() {
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
  }
}

const mcpManager = new McpManager();

module.exports = {
  McpSession,
  McpManager,
  mcpManager,
};
