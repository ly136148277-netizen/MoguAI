/**
 * OpenClaw Gateway WS framing helpers (MOGU side).
 * Upstream: https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md
 */

const DEFAULT_PROTOCOL = 4;
const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

function makeReqId() {
  return `mogu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function encodeRequest(method, params = {}, id = makeReqId()) {
  return JSON.stringify({
    type: "req",
    id,
    method,
    params: params || {},
  });
}

function parseFrame(raw) {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    return { ok: false, error: `invalid_json: ${error.message}` };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "invalid_frame" };
  }
  const type = data.type;
  if (type !== "req" && type !== "res" && type !== "event") {
    return { ok: false, error: `unknown_type:${type}` };
  }
  return { ok: true, frame: data };
}

/**
 * OpenClaw ConnectParams enums (gateway-protocol):
 * - client.id: openclaw-android|cli|openclaw-control-ui|fingerprint|gateway-client|
 *   openclaw-ios|openclaw-macos|node-host|openclaw-probe|test|openclaw-tui|webchat|webchat-ui
 * - client.mode: backend|cli|node|probe|test|ui|webchat
 *
 * MOGU uses the reserved loopback helper path: gateway-client + backend
 * (token auth, no device pairing required on local Gateway).
 */
function buildConnectParams({
  token,
  clientVersion = "1.6.0-alpha.1",
  locale = "zh-CN",
  minProtocol = DEFAULT_PROTOCOL,
  maxProtocol = DEFAULT_PROTOCOL,
} = {}) {
  const params = {
    minProtocol,
    maxProtocol,
    client: {
      id: "gateway-client",
      displayName: "MOGU AI",
      version: String(clientVersion),
      platform: process.platform,
      mode: "backend",
    },
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    caps: [],
    commands: [],
    permissions: {},
    locale,
    userAgent: `MOGU-AI/${clientVersion}`,
  };
  if (token) {
    params.auth = { token: String(token) };
  }
  return params;
}

function summarizeHelloOk(payload = {}) {
  return {
    protocol: payload.protocol ?? null,
    serverVersion: payload.server?.version || null,
    connId: payload.server?.connId || null,
    methods: Array.isArray(payload.features?.methods) ? payload.features.methods : [],
    events: Array.isArray(payload.features?.events) ? payload.features.events : [],
    role: payload.auth?.role || null,
    scopes: Array.isArray(payload.auth?.scopes) ? payload.auth.scopes : [],
    policy: payload.policy || null,
  };
}

/** Normalize Gateway events for the renderer (never include tokens). */
function normalizeGatewayEvent(frame) {
  const event = frame?.event || "unknown";
  const payload = frame?.payload && typeof frame.payload === "object" ? frame.payload : {};
  return {
    kind: mapEventKind(event, payload),
    event,
    sessionKey: payload.sessionKey || payload.key || null,
    sessionId: payload.sessionId || null,
    runId: payload.runId || payload.run_id || null,
    taskId: payload.taskId || payload.task_id || null,
    status: payload.status || null,
    text: typeof payload.text === "string" ? payload.text : payload.message || null,
    toolName: payload.toolName || payload.tool || null,
    progress: payload.progress ?? null,
    error: payload.error || payload.errorMessage || null,
    seq: frame?.seq ?? null,
    ts: Date.now(),
  };
}

function mapEventKind(event, payload) {
  const name = String(event || "").toLowerCase();
  if (name.includes("tool")) {
    if (String(payload.status || "").includes("end") || payload.done) return "tool_end";
    return "tool_start";
  }
  if (name.includes("error") || payload.error) return "error";
  if (name.includes("agent") || name.includes("chat") || name.includes("delta")) return "agent_delta";
  if (["succeeded", "failed", "cancelled", "timed_out", "completed"].includes(payload.status)) {
    return "terminal";
  }
  return "status";
}

module.exports = {
  DEFAULT_PROTOCOL,
  DEFAULT_GATEWAY_URL,
  makeReqId,
  encodeRequest,
  parseFrame,
  buildConnectParams,
  summarizeHelloOk,
  normalizeGatewayEvent,
};
