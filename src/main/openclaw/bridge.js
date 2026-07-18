const http = require("http");
const https = require("https");
const { EventEmitter } = require("events");
const {
  DEFAULT_GATEWAY_URL,
  encodeRequest,
  parseFrame,
  buildConnectParams,
  summarizeHelloOk,
  normalizeGatewayEvent,
  makeReqId,
} = require("./protocol");
const { adaptMethods } = require("./methods-adapter");

const STATES = Object.freeze({
  disconnected: "disconnected",
  probing: "probing",
  connecting: "connecting",
  authenticating: "authenticating",
  ready: "ready",
  reconnecting: "reconnecting",
  degraded: "degraded",
  auth_failed: "auth_failed",
});

class OpenClawBridge extends EventEmitter {
  /**
   * @param {{ getToken: () => Promise<string>, logger?: any, clientVersion?: string }} opts
   */
  constructor(opts = {}) {
    super();
    this.getToken = opts.getToken || (async () => "");
    this.logger = opts.logger || null;
    this.clientVersion = opts.clientVersion || "1.6.0-alpha.2";
    this.url = DEFAULT_GATEWAY_URL;
    this.state = STATES.disconnected;
    this._ws = null;
    this._pending = new Map();
    this._hello = null;
    this._methodsAdapter = adaptMethods([]);
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._manualClose = false;
    this._suppressReconnect = false;
    this._requestTimeoutMs = 30_000;
    this._connectTimeoutMs = 12_000;
  }

  getAvailableMethods() {
    return this._methodsAdapter?.available || [];
  }

  getMethodsAdapter() {
    return this._methodsAdapter || adaptMethods([]);
  }

  getPublicStatus() {
    return {
      state: this.state,
      url: this.url,
      connected: this.state === STATES.ready,
      hello: this._hello
        ? {
            protocol: this._hello.protocol,
            serverVersion: this._hello.serverVersion,
            connId: this._hello.connId,
            methodCount: this._hello.methods?.length || 0,
            eventCount: this._hello.events?.length || 0,
            role: this._hello.role,
            scopes: this._hello.scopes || [],
          }
        : null,
      methods: this._methodsAdapter?.resolved || {},
      canAgentRun: Boolean(this._methodsAdapter?.canAgentRun),
      canAbort: Boolean(this._methodsAdapter?.canAbort),
      reconnectAttempt: this._reconnectAttempt,
    };
  }

  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.emit("state", this.getPublicStatus());
  }

  /**
   * Probe local Gateway without full auth (TCP/HTTP upgrade reachability).
   */
  async probe(url = this.url) {
    this._setState(STATES.probing);
    const target = normalizeWsUrl(url || DEFAULT_GATEWAY_URL);
    this.url = target;
    const httpUrl = target.replace(/^ws/i, "http");

    try {
      const result = await httpHeadOrGet(httpUrl, 4000);
      this._setState(STATES.disconnected);
      return {
        ok: true,
        reachable: result.statusCode > 0 && result.statusCode < 500,
        url: target,
        httpStatus: result.statusCode,
        error: null,
      };
    } catch (error) {
      this._setState(STATES.disconnected);
      return {
        ok: false,
        reachable: false,
        url: target,
        httpStatus: null,
        error: error.message,
      };
    }
  }

  async connect({ url, token } = {}) {
    this._manualClose = false;
    this._suppressReconnect = false;
    if (url) this.url = normalizeWsUrl(url);
    const authToken = token != null ? String(token) : await this.getToken();

    if (this._ws && (this.state === STATES.ready || this.state === STATES.connecting)) {
      return this.getPublicStatus();
    }

    this._setState(STATES.connecting);
    await this._openSocket(authToken);
    return this.getPublicStatus();
  }

  async disconnect() {
    this._manualClose = true;
    this._suppressReconnect = true;
    this._clearReconnect();
    this._rejectAllPending("disconnected");
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        // ignore
      }
      this._ws = null;
    }
    this._hello = null;
    this._setState(STATES.disconnected);
    return this.getPublicStatus();
  }

  async request(method, params = {}, { timeoutMs } = {}) {
    if (this.state !== STATES.ready || !this._ws) {
      throw new Error(`Bridge 未就绪（${this.state}）`);
    }
    const id = makeReqId();
    const payload = encodeRequest(method, params, id);
    const waitMs = timeoutMs || this._requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        const err = new Error(`Gateway 请求超时：${method}`);
        err.code = "gateway_timeout";
        err.accepted = true; // request was written to socket
        reject(err);
      }, waitMs);

      this._pending.set(id, { resolve, reject, timer, method });
      try {
        this._ws.send(payload);
      } catch (error) {
        clearTimeout(timer);
        this._pending.delete(id);
        error.accepted = false;
        reject(error);
      }
    });
  }

  async _openSocket(token) {
    const WebSocketImpl = globalThis.WebSocket;
    if (typeof WebSocketImpl !== "function") {
      this._setState(STATES.degraded);
      throw new Error("当前运行时不支持 WebSocket");
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocketImpl(this.url);
      this._ws = ws;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        this._setState(STATES.degraded);
        reject(new Error("连接 Gateway 超时"));
      }, this._connectTimeoutMs);

      ws.addEventListener("open", () => {
        this._setState(STATES.authenticating);
        const connectId = makeReqId();
        const params = buildConnectParams({
          token,
          clientVersion: this.clientVersion,
        });
        const pendingConnect = {
          resolve: (payload) => {
            if (settled) return;
            settled = true;
            clearTimeout(connectTimer);
            this._hello = summarizeHelloOk(payload);
            this._methodsAdapter = adaptMethods(this._hello.methods || []);
            this._reconnectAttempt = 0;
            this._setState(STATES.ready);
            this.emit("ready", this.getPublicStatus());
            resolve(this.getPublicStatus());
          },
          reject: (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(connectTimer);
            const msg = String(error?.message || error || "");
            if (/auth|token|unauthorized|forbidden/i.test(msg)) {
              this._suppressReconnect = true;
              this._setState(STATES.auth_failed);
            } else {
              this._setState(STATES.degraded);
            }
            try {
              ws.close();
            } catch {
              // ignore
            }
            reject(error);
          },
          timer: null,
          method: "connect",
        };
        pendingConnect.timer = setTimeout(() => {
          this._pending.delete(connectId);
          pendingConnect.reject(new Error("Gateway 握手超时"));
        }, this._connectTimeoutMs);
        this._pending.set(connectId, pendingConnect);
        ws.send(encodeRequest("connect", params, connectId));
      });

      ws.addEventListener("message", (ev) => {
        this._onMessage(ev.data);
      });

      ws.addEventListener("error", () => {
        // close handler will decide reconnect
      });

      ws.addEventListener("close", () => {
        this._ws = null;
        this._hello = null;
        this._rejectAllPending("socket_closed");
        if (this._manualClose || this._suppressReconnect || this.state === STATES.auth_failed) {
          if (this.state !== STATES.auth_failed) this._setState(STATES.disconnected);
          return;
        }
        this._setState(STATES.reconnecting);
        this._scheduleReconnect(token);
      });
    });
  }

  _onMessage(raw) {
    const parsed = parseFrame(typeof raw === "string" ? raw : String(raw));
    if (!parsed.ok) {
      this.logger?.warn?.("openclaw bad frame", { error: parsed.error });
      return;
    }
    const frame = parsed.frame;

    if (frame.type === "res") {
      const pending = this._pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this._pending.delete(frame.id);
      if (frame.ok === false) {
        const err = new Error(frame.error?.message || frame.error || "Gateway 返回错误");
        err.code = frame.error?.code || "gateway_error";
        err.payload = frame.error;
        pending.reject(err);
        return;
      }
      pending.resolve(frame.payload);
      return;
    }

    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        // Challenge is informational; connect request already includes auth.
        this.emit("challenge", frame.payload || {});
        return;
      }
      const normalized = normalizeGatewayEvent(frame);
      this.emit("event", normalized);
    }
  }

  _scheduleReconnect(token) {
    this._clearReconnect();
    this._reconnectAttempt += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this._reconnectAttempt, 5));
    this._reconnectTimer = setTimeout(() => {
      this.connect({ token }).catch((error) => {
        this.logger?.warn?.("openclaw reconnect failed", { message: error.message });
        this._setState(STATES.reconnecting);
        this._scheduleReconnect(token);
      });
    }, delay);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _rejectAllPending(reason) {
    for (const [id, pending] of this._pending.entries()) {
      clearTimeout(pending.timer);
      const err = new Error(reason);
      err.code = reason;
      err.accepted = pending.method !== "connect";
      pending.reject(err);
      this._pending.delete(id);
    }
  }
}

function normalizeWsUrl(url) {
  const text = String(url || DEFAULT_GATEWAY_URL).trim();
  if (!text) return DEFAULT_GATEWAY_URL;
  if (text.startsWith("http://")) return `ws://${text.slice("http://".length)}`;
  if (text.startsWith("https://")) return `wss://${text.slice("https://".length)}`;
  if (!/^wss?:\/\//i.test(text)) return `ws://${text}`;
  return text;
}

function httpHeadOrGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.request(url, { method: "GET", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode || 0 });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("probe timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

module.exports = {
  OpenClawBridge,
  STATES,
  normalizeWsUrl,
  DEFAULT_GATEWAY_URL,
};
