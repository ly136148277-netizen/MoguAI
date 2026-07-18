const { adaptMethods, requireMethod } = require("./methods-adapter");
const { decideFallback } = require("./fallback-pai");

/**
 * High-level OpenClaw agent run orchestration (alpha.2).
 */
class AgentRunService {
  /**
   * @param {{
   *   bridge: import('./bridge').OpenClawBridge,
   *   taskStore: import('../task-store').TaskStore,
   *   getSettings: () => Promise<object>,
   *   logger?: any,
   *   emitToRenderer?: (channel: string, payload: any) => void,
   * }} opts
   */
  constructor(opts) {
    this.bridge = opts.bridge;
    this.taskStore = opts.taskStore;
    this.getSettings = opts.getSettings;
    this.logger = opts.logger || null;
    this.emitToRenderer = opts.emitToRenderer || (() => {});
    /** @type {Map<string, { moguTaskId: string, buffer: string }>} */
    this._activeByRunId = new Map();
    this._bound = false;
  }

  bindEvents() {
    if (this._bound) return;
    this._bound = true;
    this.bridge.on("event", (evt) => this._onBridgeEvent(evt));
  }

  getAdapter() {
    const methods = this.bridge.getAvailableMethods?.() || this.bridge._hello?.methods || [];
    return adaptMethods(methods);
  }

  async ensureReady() {
    const settings = await this.getSettings();
    if (this.bridge.state !== "ready") {
      await this.bridge.connect({
        url: settings.openclawGatewayUrl,
      });
    }
    if (this.bridge.state !== "ready") {
      throw new Error(`OpenClaw Bridge 未就绪（${this.bridge.state}）`);
    }
    const adapter = this.getAdapter();
    if (!adapter.canAgentRun) {
      throw new Error(
        `Gateway 能力不足，无法 Agent Run。缺少：${adapter.missing.filter((m) => ["sessionCreate", "sessionSend"].includes(m)).join(", ")}`
      );
    }
    return adapter;
  }

  async sessionCreate(opts = {}) {
    const adapter = await this.ensureReady();
    const method = requireMethod(adapter, "sessionCreate");
    const params = {
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(opts.key ? { key: opts.key } : {}),
    };
    const payload = await this.bridge.request(method, params);
    return {
      ok: true,
      sessionKey: payload?.key || payload?.sessionKey || payload?.id || null,
      sessionId: payload?.sessionId || payload?.id || null,
      raw: sanitizePayload(payload),
      method,
    };
  }

  /**
   * Send a user message and track a TaskStore row.
   * Marks requestAcceptedByGateway as soon as Gateway accepts the RPC.
   */
  async send({ text, sessionKey = null, name = null } = {}) {
    const message = String(text || "").trim();
    if (!message) throw new Error("消息不能为空");

    const settings = await this.getSettings();
    const adapter = await this.ensureReady();
    const sendMethod = requireMethod(adapter, "sessionSend");

    let key = sessionKey;
    let sessionId = null;
    if (!key) {
      const created = await this.sessionCreate({});
      key = created.sessionKey;
      sessionId = created.sessionId;
      if (!key) throw new Error("sessions.create 未返回 sessionKey");
    }

    const task = await this.taskStore.create({
      source: "openclaw",
      name: name || message.slice(0, 48),
      status: "queued",
      sessionKey: key,
      sessionId,
    });

    this.emitToRenderer("openclaw-task", {
      moguTaskId: task.moguTaskId,
      status: "queued",
      sessionKey: key,
      bridgeState: this.bridge.state,
    });

    let accepted = false;
    try {
      const params = buildSendParams(sendMethod, key, message);
      const payload = await this.bridge.request(sendMethod, params, { timeoutMs: 45_000 });
      accepted = true;
      const runId = payload?.runId || payload?.run_id || null;
      const taskId = payload?.taskId || payload?.task_id || null;
      await this.taskStore.update(task.moguTaskId, {
        status: "running",
        runId,
        taskId,
        sessionKey: key,
        sessionId: sessionId || payload?.sessionId || null,
        requestAcceptedByGateway: true,
        logSummary: "Gateway 已接受 Agent Run",
      });
      if (runId) {
        this._activeByRunId.set(String(runId), { moguTaskId: task.moguTaskId, buffer: "" });
      }
      this.emitToRenderer("openclaw-task", {
        moguTaskId: task.moguTaskId,
        status: "running",
        runId,
        taskId,
        sessionKey: key,
        bridgeState: this.bridge.state,
        requestAcceptedByGateway: true,
      });
      return {
        ok: true,
        accepted: true,
        moguTaskId: task.moguTaskId,
        sessionKey: key,
        sessionId,
        runId,
        taskId,
        method: sendMethod,
      };
    } catch (error) {
      const timedOut = error.code === "gateway_timeout" || /超时/.test(error.message || "");
      const wasAccepted = accepted || error.accepted === true;
      if (wasAccepted && timedOut) {
        await this.taskStore.update(task.moguTaskId, {
          status: "timed_out",
          requestAcceptedByGateway: true,
          errorCode: FALLBACK_BLOCKED,
          errorMessage: "等待超时（请求已被 Gateway 接受，未降级重发）",
        });
        const decision = decideFallback({
          openclawEnabled: settings.openclawEnabled !== false,
          fallbackToPai: settings.openclawFallbackToPai !== false,
          bridgeState: this.bridge.state,
          requestAcceptedByGateway: true,
          waitTimedOut: true,
        });
        this.emitToRenderer("openclaw-task", {
          moguTaskId: task.moguTaskId,
          status: "timed_out",
          requestAcceptedByGateway: true,
          fallback: decision,
          error: error.message,
        });
        const wrapped = new Error(decision.message);
        wrapped.code = decision.reason;
        wrapped.moguTaskId = task.moguTaskId;
        wrapped.accepted = true;
        wrapped.fallback = decision;
        throw wrapped;
      }

      await this.taskStore.update(task.moguTaskId, {
        status: "failed",
        requestAcceptedByGateway: wasAccepted,
        errorCode: error.code || "send_failed",
        errorMessage: error.message,
      });
      this.emitToRenderer("openclaw-task", {
        moguTaskId: task.moguTaskId,
        status: "failed",
        error: error.message,
        requestAcceptedByGateway: wasAccepted,
      });
      error.moguTaskId = task.moguTaskId;
      error.accepted = wasAccepted;
      throw error;
    }
  }

  async abort({ moguTaskId = null, runId = null, taskId = null, sessionKey = null } = {}) {
    const adapter = this.getAdapter();
    let mapping = null;
    if (moguTaskId) {
      mapping = await this.taskStore.getMapping(moguTaskId);
    }
    const resolved = {
      runId: runId || mapping?.runId || null,
      taskId: taskId || mapping?.taskId || null,
      sessionKey: sessionKey || mapping?.sessionKey || null,
      moguTaskId: moguTaskId || mapping?.moguTaskId || null,
    };

    if (!resolved.runId && !resolved.taskId && !resolved.sessionKey) {
      return {
        ok: false,
        needsConfirmation: true,
        reason: "missing_precise_id",
        message: "没有可用于精确取消的 runId/taskId/sessionKey。",
      };
    }

    await this.ensureReady();

    if (resolved.taskId && adapter.resolved.taskCancel) {
      await this.bridge.request(adapter.resolved.taskCancel, {
        taskId: resolved.taskId,
        reason: "cancelled_by_mogu",
      });
    } else if (adapter.resolved.sessionAbort) {
      await this.bridge.request(adapter.resolved.sessionAbort, {
        key: resolved.sessionKey || undefined,
        runId: resolved.runId || undefined,
      });
    } else {
      throw new Error("Gateway 不支持精确取消（无 sessions.abort / tasks.cancel）");
    }

    if (resolved.moguTaskId) {
      await this.taskStore.update(resolved.moguTaskId, { status: "cancelled" });
      this.emitToRenderer("openclaw-task", {
        moguTaskId: resolved.moguTaskId,
        status: "cancelled",
        runId: resolved.runId,
        taskId: resolved.taskId,
      });
    }
    return { ok: true, precise: true, ...resolved };
  }

  async recoverAfterReconnect() {
    const adapter = this.getAdapter();
    const running = (await this.taskStore.list({ limit: 50 })).filter(
      (t) => t.source === "openclaw" && ["queued", "running"].includes(t.status)
    );
    const recovered = [];
    for (const task of running) {
      if (!task.taskId || !adapter.resolved.taskGet) {
        recovered.push({ moguTaskId: task.moguTaskId, status: task.status, recovered: false });
        continue;
      }
      try {
        const payload = await this.bridge.request(adapter.resolved.taskGet, { taskId: task.taskId });
        const status = mapGatewayTaskStatus(payload?.task?.status || payload?.status);
        await this.taskStore.update(task.moguTaskId, {
          status,
          runId: payload?.task?.runId || task.runId,
          logSummary: `重连后同步：${status}`,
        });
        this.emitToRenderer("openclaw-task", {
          moguTaskId: task.moguTaskId,
          status,
          recovered: true,
        });
        recovered.push({ moguTaskId: task.moguTaskId, status, recovered: true });
      } catch (error) {
        this.logger?.warn?.("recover task failed", { id: task.moguTaskId, message: error.message });
        recovered.push({ moguTaskId: task.moguTaskId, status: task.status, recovered: false, error: error.message });
      }
    }
    return { ok: true, recovered };
  }

  async _onBridgeEvent(evt) {
    const runId = evt?.runId ? String(evt.runId) : null;
    let active = runId ? this._activeByRunId.get(runId) : null;
    if (!active && runId) {
      // Try match TaskStore by runId
      const list = await this.taskStore.list({ limit: 30 });
      const hit = list.find((t) => t.runId === runId);
      if (hit) {
        active = { moguTaskId: hit.moguTaskId, buffer: "" };
        this._activeByRunId.set(runId, active);
      }
    }
    if (!active) {
      this.emitToRenderer("openclaw-event", evt);
      return;
    }

    if (evt.kind === "agent_delta" && evt.text) {
      active.buffer = `${active.buffer || ""}${evt.text}`;
      await this.taskStore.update(active.moguTaskId, {
        status: "running",
        logSummary: active.buffer.slice(-240),
      });
    }

    if (evt.kind === "terminal" || ["succeeded", "failed", "cancelled", "timed_out"].includes(evt.status)) {
      const status = mapGatewayTaskStatus(evt.status || "succeeded");
      await this.taskStore.update(active.moguTaskId, {
        status,
        errorMessage: evt.error || null,
        logSummary: active.buffer?.slice(-500) || evt.text || status,
      });
      this._activeByRunId.delete(runId);
    }

    this.emitToRenderer("openclaw-event", { ...evt, moguTaskId: active.moguTaskId });
    this.emitToRenderer("openclaw-task", {
      moguTaskId: active.moguTaskId,
      status: evt.status || (evt.kind === "terminal" ? "succeeded" : "running"),
      runId,
      streamText: active.buffer,
      kind: evt.kind,
      error: evt.error || null,
    });
  }
}

const FALLBACK_BLOCKED = "gateway_accepted_no_auto_fallback";

function buildSendParams(method, sessionKey, message) {
  if (method === "chat.send") {
    return { sessionKey, message };
  }
  // sessions.send
  return { key: sessionKey, message };
}

function mapGatewayTaskStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["queued", "running", "succeeded", "failed", "cancelled", "timed_out", "completed", "canceled"].includes(s)) {
    if (s === "completed") return "succeeded";
    if (s === "canceled") return "cancelled";
    return s;
  }
  return "running";
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const clone = { ...payload };
  delete clone.auth;
  delete clone.token;
  delete clone.deviceToken;
  return clone;
}

module.exports = {
  AgentRunService,
  buildSendParams,
  mapGatewayTaskStatus,
};
