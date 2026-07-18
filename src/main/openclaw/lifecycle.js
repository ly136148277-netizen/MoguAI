const { spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const http = require("http");

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

/**
 * Start Gateway via external CLI only — never embeds OpenClaw runtime.
 */
async function startGateway({ command = null, cwd = null, logger = null } = {}) {
  if (managedChild && !managedChild.killed) {
    return { ok: true, alreadyRunning: true, pid: managedChild.pid };
  }

  const cmd = command || process.env.OPENCLAW_GATEWAY_CMD || "openclaw";
  const args = command ? [] : ["gateway", "run"];
  try {
    managedChild = spawn(cmd, args, {
      cwd: cwd || undefined,
      shell: true,
      windowsHide: true,
      stdio: "ignore",
      detached: false,
    });
    managedChild.on("exit", () => {
      managedChild = null;
    });
    managedChild.on("error", (error) => {
      logger?.warn?.("openclaw start failed", { message: error.message });
      managedChild = null;
    });
    return { ok: true, pid: managedChild.pid, command: cmd, external: true };
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
      "在本机启动 Gateway 后，于 MOGU 设置中填写地址并连接。",
      "Gateway token 仅保存在主进程安全存储；渲染层不可读。",
    ],
    installDocsUrl: PINNED_COMPAT.installDocsUrl,
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
};
