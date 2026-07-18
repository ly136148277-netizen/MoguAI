const { spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const http = require("http");
const os = require("os");

/** Pinned compatible Gateway protocol / docs version for MOGU Bridge. */
const PINNED_COMPAT = Object.freeze({
  protocol: 4,
  label: "OpenClaw Gateway protocol 4",
  installDocsUrl: "https://github.com/openclaw/openclaw",
  minServerHint: "0.1.0",
});

let managedChild = null;

function classifyLifecycle({ probe = null, bridgeStatus = null, enabled = false } = {}) {
  const state = bridgeStatus?.state || "disconnected";
  const connected = bridgeStatus?.connected === true || state === "ready";
  const reachable = probe?.reachable === true || probe?.ok === true;
  const serverVersion = bridgeStatus?.hello?.serverVersion || null;

  let lifecycle = "unknown";
  let message = "";

  if (!enabled) {
    lifecycle = "disabled";
    message = "OpenClaw 未启用（可在设置中打开）。";
  } else if (connected) {
    lifecycle = "connected";
    message = serverVersion ? `已连接 · ${serverVersion}` : "已连接 Gateway";
  } else if (state === "auth_failed") {
    lifecycle = "auth_failed";
    message = "认证失败，请检查 Gateway token。";
  } else if (state === "connecting" || state === "authenticating" || state === "reconnecting") {
    lifecycle = "connecting";
    message = `连接中（${state}）`;
  } else if (!reachable) {
    lifecycle = "not_running";
    message = "未检测到本机 Gateway（未安装或未运行）。";
  } else {
    lifecycle = "reachable_disconnected";
    message = "Gateway 可探测但未建立认证会话。";
  }

  return {
    lifecycle,
    message,
    enabled: Boolean(enabled),
    connected,
    reachable: Boolean(reachable),
    bridgeState: state,
    serverVersion,
    protocol: bridgeStatus?.hello?.protocol ?? null,
    pinned: PINNED_COMPAT,
    managedProcess: Boolean(managedChild && !managedChild.killed),
  };
}

function httpReachable(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    try {
      const target = new URL(url);
      const req = http.request(
        {
          hostname: target.hostname,
          port: target.port || 80,
          path: target.pathname || "/",
          method: "GET",
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          resolve({ ok: true, statusCode: res.statusCode || 0 });
        }
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, error: "timeout" });
      });
      req.on("error", (error) => resolve({ ok: false, error: error.message }));
      req.end();
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

async function healthCheck(gatewayUrl) {
  const text = String(gatewayUrl || "ws://127.0.0.1:18789");
  const httpUrl = text.replace(/^ws/i, "http");
  const result = await httpReachable(httpUrl);
  return {
    ok: result.ok,
    url: text,
    httpUrl,
    statusCode: result.statusCode || null,
    error: result.error || null,
  };
}

function resolveOpenclawCliEntry() {
  const candidates = [
    process.env.OPENCLAW_CLI_ENTRY,
    path.join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      "openclaw",
      "openclaw.mjs"
    ),
    path.join(
      process.env.APPDATA || "",
      "npm",
      "node_modules",
      "openclaw",
      "dist",
      "index.js"
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.pathExistsSync(candidate)) return candidate;
  }
  return null;
}

function resolveNodeBinary() {
  const candidates = [
    process.env.OPENCLAW_NODE_BIN,
    process.env.npm_node_execpath,
    path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.pathExistsSync(candidate)) return candidate;
  }
  // Last resort: rely on PATH (must not use process.execPath — in Electron that is MOGU.exe).
  return process.platform === "win32" ? "node.exe" : "node";
}

/**
 * Read Gateway token from local OpenClaw config (main process only).
 * Never expose this value to the renderer.
 */
async function readLocalGatewayToken() {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (!(await fs.pathExists(configPath))) return null;
  try {
    const cfg = await fs.readJson(configPath);
    const token = cfg?.gateway?.auth?.token;
    return token ? String(token).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Start Gateway via external CLI only — never embeds OpenClaw runtime.
 */
async function startGateway({ command = null, cwd = null, logger = null, port = 18789 } = {}) {
  if (managedChild && !managedChild.killed) {
    return { ok: true, alreadyRunning: true, pid: managedChild.pid };
  }

  const health = await healthCheck(`ws://127.0.0.1:${port}`);
  if (health.ok) {
    return { ok: true, alreadyRunning: true, external: true, message: "Gateway 已在监听。" };
  }

  try {
    if (command) {
      managedChild = spawn(command, {
        cwd: cwd || undefined,
        shell: true,
        windowsHide: true,
        stdio: "ignore",
        detached: false,
      });
    } else {
      const entry = resolveOpenclawCliEntry();
      if (!entry) {
        return {
          ok: false,
          message: "未找到本机 openclaw CLI。请先安装 OpenClaw，或手动执行：openclaw gateway run",
          installDocsUrl: PINNED_COMPAT.installDocsUrl,
        };
      }
      const nodeBin = resolveNodeBinary();
      managedChild = spawn(
        nodeBin,
        [entry, "gateway", "run", "--port", String(port), "--bind", "loopback"],
        {
          cwd: cwd || undefined,
          windowsHide: true,
          stdio: "ignore",
          detached: false,
          shell: false,
          env: { ...process.env, OPENCLAW_GATEWAY_PORT: String(port) },
        }
      );
    }
    managedChild.on("exit", () => {
      managedChild = null;
    });
    managedChild.on("error", (error) => {
      logger?.warn?.("openclaw start failed", { message: error.message });
      managedChild = null;
    });

    // Wait until Gateway is actually reachable (cold start can take several seconds).
    // Only then may openclaw:connect proceed to WS handshake.
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const again = await healthCheck(`ws://127.0.0.1:${port}`);
      if (again.ok) {
        return { ok: true, pid: managedChild?.pid || null, external: true, started: true };
      }
      if (!managedChild || managedChild.killed) {
        return {
          ok: false,
          message: "Gateway 进程已退出，自动启动失败。请检查本机 OpenClaw 安装与日志。",
          installDocsUrl: PINNED_COMPAT.installDocsUrl,
        };
      }
    }
    return {
      ok: false,
      pid: managedChild?.pid || null,
      external: true,
      message: "已尝试自动启动 Gateway，但超时仍未就绪。",
      installDocsUrl: PINNED_COMPAT.installDocsUrl,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      message: "无法启动外部 Gateway。请按官方文档安装后重试，或手动启动。",
      installDocsUrl: PINNED_COMPAT.installDocsUrl,
    };
  }
}

async function stopGateway() {
  if (!managedChild || managedChild.killed) {
    managedChild = null;
    return { ok: true, stopped: false, message: "没有由 MOGU 拉起的 Gateway 进程。" };
  }
  try {
    managedChild.kill();
  } catch (error) {
    return { ok: false, error: error.message };
  }
  managedChild = null;
  return { ok: true, stopped: true };
}

function getInstallGuide() {
  return {
    ok: true,
    pinned: PINNED_COMPAT,
    steps: [
      "从官方仓库安装 OpenClaw Gateway（不要使用第三方魔改包）。",
      `兼容协议：${PINNED_COMPAT.label}（MOGU Bridge 按 hello-ok 探测 methods）。`,
      "安装完成后，在 MOGU 点「连接」即可：未运行时会自动拉起 Gateway 再握手（无需先手动启动）。",
      "本机已配置过 OpenClaw 时，可自动读取 ~/.openclaw 中的 token（仅主进程，渲染层不可读）。",
      "若仍连不上：打开侧栏「OpenClaw」页查看状态，或点「官方安装文档」。",
    ],
    installDocsUrl: PINNED_COMPAT.installDocsUrl,
    installHint:
      "请先安装 OpenClaw Gateway。安装后回到 MOGU 点「连接」，将自动拉起并连接。",
  };
}

async function detectCliPresent() {
  // Best-effort: look for openclaw on PATH via `where`/`which` is heavy; expose pinned guide instead.
  const localHint = path.join(process.env.LOCALAPPDATA || "", "openclaw");
  const exists = localHint && (await fs.pathExists(localHint));
  return { localHint: exists ? localHint : null, pinned: PINNED_COMPAT };
}

module.exports = {
  PINNED_COMPAT,
  classifyLifecycle,
  healthCheck,
  startGateway,
  stopGateway,
  getInstallGuide,
  detectCliPresent,
  readLocalGatewayToken,
  resolveOpenclawCliEntry,
};
