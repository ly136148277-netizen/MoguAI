/**
 * MOGU AI 精密工厂 — Node.js inspect debug session (CDP over WebSocket).
 */
const { spawn } = require("node:child_process");
const path = require("path");
const WebSocket = require("ws");
const { assertInsideWorkspace } = require("./workspace-fs");

let active = null;
let msgId = 0;
const pending = new Map();
let eventSink = null;

function setEventSink(fn) {
  eventSink = typeof fn === "function" ? fn : null;
}

function emit(kind, payload = {}) {
  eventSink?.({ kind, ...payload, at: Date.now() });
}

function isActive() {
  return Boolean(active?.ws && active.ws.readyState === WebSocket.OPEN);
}

function getStatus() {
  if (!active) return { ok: true, running: false, paused: false };
  return {
    ok: true,
    running: true,
    paused: Boolean(active.paused),
    file: active.file,
    workspace: active.workspace,
    port: active.port || null,
    pid: active.child?.pid || null,
  };
}

function pathToFileUrl(absPath) {
  const normalized = path.resolve(absPath).replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) return `file:///${normalized}`;
  return `file://${normalized}`;
}

function send(method, params = {}) {
  if (!isActive()) {
    return Promise.reject(Object.assign(new Error("调试未启动"), { code: "debug_inactive" }));
  }
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`调试超时：${method}`), { code: "debug_timeout" }));
    }, 15_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    active.ws.send(JSON.stringify({ id, method, params }));
  });
}

function onWsMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (msg.id != null && pending.has(msg.id)) {
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      entry.reject(Object.assign(new Error(msg.error.message || "CDP error"), { code: "cdp_error" }));
    } else {
      entry.resolve(msg.result);
    }
    return;
  }
  if (!msg.method) return;
  if (msg.method === "Debugger.paused") {
    if (active) {
      active.paused = true;
      active.lastCallFrames = msg.params?.callFrames || [];
      active.lastScopes = active.lastCallFrames[0]?.scopeChain || [];
    }
    emit("paused", {
      reason: msg.params?.reason,
      callFrames: (msg.params?.callFrames || []).slice(0, 8).map((frame) => ({
        callFrameId: frame.callFrameId,
        functionName: frame.functionName || "(anonymous)",
        url: frame.url,
        lineNumber: (frame.location?.lineNumber ?? 0) + 1,
        columnNumber: (frame.location?.columnNumber ?? 0) + 1,
      })),
    });
  } else if (msg.method === "Debugger.resumed") {
    if (active) active.paused = false;
    emit("resumed", {});
  } else if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params?.args || [])
      .map((a) => (a.value != null ? String(a.value) : a.description || ""))
      .join(" ");
    emit("console", { level: msg.params?.type || "log", text });
  } else if (msg.method === "Runtime.exceptionThrown") {
    emit("exception", {
      text:
        msg.params?.exceptionDetails?.text ||
        msg.params?.exceptionDetails?.exception?.description ||
        "exception",
    });
  }
}

function waitForWsUrl(child, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(Object.assign(new Error("未检测到调试端口"), { code: "inspect_timeout" }));
    }, timeoutMs);
    const onData = (chunk) => {
      buf += String(chunk || "");
      const m = buf.match(/Debugger listening on (ws:\/\/[^\s]+)/);
      if (m) {
        cleanup();
        resolve(m[1]);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.stdout?.off("data", onData);
    };
    child.stderr?.on("data", onData);
    child.stdout?.on("data", onData);
  });
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(Object.assign(new Error("连接调试器超时"), { code: "ws_timeout" }));
    }, 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function spawnNodeInspect(abs, cwd) {
  return spawn("node", ["--inspect-brk=0", abs], {
    cwd,
    env: { ...process.env },
    windowsHide: true,
    shell: process.platform === "win32",
  });
}

async function startDebug({ workspace, relPath, breakpoints = [] } = {}) {
  if (active) await stopDebug().catch(() => {});
  const { root, abs } = assertInsideWorkspace(workspace, relPath);
  const ext = path.extname(abs).toLowerCase();
  if (![".js", ".mjs", ".cjs"].includes(ext)) {
    const err = new Error("当前仅支持调试 .js / .mjs / .cjs");
    err.code = "unsupported_lang";
    throw err;
  }

  const child = spawnNodeInspect(abs, root);
  let wsUrl;
  try {
    wsUrl = await waitForWsUrl(child);
  } catch (error) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    throw error;
  }

  const ws = await connectWs(wsUrl);
  const portMatch = String(wsUrl).match(/:(\d+)/);
  active = {
    child,
    ws,
    file: path.relative(root, abs).split(path.sep).join("/"),
    absFile: abs,
    workspace: root,
    port: portMatch ? Number(portMatch[1]) : null,
    paused: true,
    lastCallFrames: [],
    lastScopes: [],
  };
  msgId = 0;
  pending.clear();
  ws.on("message", onWsMessage);
  ws.on("close", () => {
    emit("terminated", {});
    if (active?.ws === ws) active = null;
  });
  child.on("exit", () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    if (active?.child === child) active = null;
    emit("terminated", {});
  });

  await send("Debugger.enable");
  await send("Runtime.enable");
  await send("Debugger.setPauseOnExceptions", { state: "none" });

  active.breakpointIds = new Map(); // line -> breakpointId
  for (const bp of breakpoints || []) {
    const line = Number(bp.lineNumber || bp.line || 0);
    if (line < 1) continue;
    try {
      const params = {
        lineNumber: line - 1,
        url: pathToFileUrl(abs),
      };
      const cond = String(bp.condition || "").trim();
      if (cond) params.condition = cond;
      const result = await send("Debugger.setBreakpointByUrl", params);
      const id = result?.breakpointId;
      if (id) active.breakpointIds.set(line, id);
    } catch {
      /* ignore */
    }
  }

  emit("started", { file: active.file, port: active.port });
  return getStatus();
}

async function stopDebug() {
  const cur = active;
  active = null;
  for (const [, p] of pending) {
    p.reject(Object.assign(new Error("调试已停止"), { code: "debug_stopped" }));
  }
  pending.clear();
  if (cur?.ws) {
    try {
      cur.ws.close();
    } catch {
      /* ignore */
    }
  }
  if (cur?.child?.pid) {
    try {
      cur.child.kill();
    } catch {
      /* ignore */
    }
  }
  emit("stopped", {});
  return { ok: true, running: false };
}

async function debugCommand(command, params = {}) {
  const cmd = String(command || "").toLowerCase();
  if (cmd === "continue" || cmd === "resume") {
    await send("Debugger.resume");
    return { ok: true };
  }
  if (cmd === "pause") {
    await send("Debugger.pause");
    return { ok: true };
  }
  if (cmd === "stepover") {
    await send("Debugger.stepOver");
    return { ok: true };
  }
  if (cmd === "stepinto") {
    await send("Debugger.stepInto");
    return { ok: true };
  }
  if (cmd === "stepout") {
    await send("Debugger.stepOut");
    return { ok: true };
  }
  if (cmd === "breakpoint" || cmd === "setbreakpoint") {
    const line = Number(params.lineNumber || params.line || 0);
    if (!active?.absFile || line < 1) return { ok: false, error: "无效断点" };
    const remove = params.remove === true || params.clear === true;
    if (remove) {
      const id = active.breakpointIds?.get(line);
      if (id) {
        await send("Debugger.removeBreakpoint", { breakpointId: id }).catch(() => {});
        active.breakpointIds.delete(line);
      }
      return { ok: true, removed: true, line };
    }
    const payload = {
      lineNumber: line - 1,
      url: pathToFileUrl(active.absFile),
    };
    const cond = String(params.condition || "").trim();
    if (cond) payload.condition = cond;
    // replace existing
    const oldId = active.breakpointIds?.get(line);
    if (oldId) {
      await send("Debugger.removeBreakpoint", { breakpointId: oldId }).catch(() => {});
    }
    const result = await send("Debugger.setBreakpointByUrl", payload);
    if (!active.breakpointIds) active.breakpointIds = new Map();
    if (result?.breakpointId) active.breakpointIds.set(line, result.breakpointId);
    return { ok: true, result, line, condition: cond || null };
  }
  if (cmd === "selectframe") {
    const callFrameId = params.callFrameId;
    const frames = active?.lastCallFrames || [];
    const frame = frames.find((f) => f.callFrameId === callFrameId) || frames[Number(params.index) || 0];
    if (!frame) return { ok: false, error: "无效调用帧" };
    active.lastScopes = frame.scopeChain || [];
    active.selectedFrameId = frame.callFrameId;
    return {
      ok: true,
      callFrame: {
        callFrameId: frame.callFrameId,
        functionName: frame.functionName || "(anonymous)",
        lineNumber: (frame.location?.lineNumber ?? 0) + 1,
        url: frame.url,
      },
    };
  }
  if (cmd === "evaluate") {
    const expression = String(params.expression || "").trim();
    if (!expression) return { ok: false, error: "表达式为空" };
    const callFrameId = params.callFrameId || active?.lastCallFrames?.[0]?.callFrameId;
    if (callFrameId) {
      const result = await send("Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression,
        returnByValue: true,
        includeCommandLineAPI: true,
      });
      return { ok: true, result };
    }
    const result = await send("Runtime.evaluate", {
      expression,
      includeCommandLineAPI: true,
      awaitPromise: true,
      returnByValue: true,
    });
    return { ok: true, result };
  }
  return { ok: false, error: `未知调试命令：${cmd}` };
}

async function getPausedLocals() {
  if (!isActive() || !active?.paused) {
    return { ok: true, variables: [], callFrames: [] };
  }
  const rawFrames = active.lastCallFrames || [];
  const selected =
    rawFrames.find((f) => f.callFrameId === active.selectedFrameId) || rawFrames[0] || null;
  if (selected) active.lastScopes = selected.scopeChain || [];
  const callFrames = rawFrames.slice(0, 12).map((frame) => ({
    callFrameId: frame.callFrameId,
    functionName: frame.functionName || "(anonymous)",
    url: frame.url,
    lineNumber: (frame.location?.lineNumber ?? 0) + 1,
    selected: Boolean(selected && frame.callFrameId === selected.callFrameId),
  }));
  const variables = [];
  for (const scope of (active.lastScopes || []).slice(0, 3)) {
    const objectId = scope?.object?.objectId;
    if (!objectId) continue;
    const props = await send("Runtime.getProperties", {
      objectId,
      ownProperties: true,
    }).catch(() => null);
    for (const p of props?.result || []) {
      if (!p?.name || p.name.startsWith("__")) continue;
      variables.push({
        scope: scope.type || scope.name || "local",
        name: p.name,
        value:
          p.value?.value != null
            ? String(p.value.value)
            : p.value?.description || p.value?.type || "…",
      });
      if (variables.length >= 80) break;
    }
    if (variables.length >= 80) break;
  }
  return { ok: true, variables, callFrames };
}

module.exports = {
  setEventSink,
  getStatus,
  startDebug,
  stopDebug,
  debugCommand,
  getPausedLocals,
  isActive,
  pathToFileUrl,
  waitForWsUrl,
};
