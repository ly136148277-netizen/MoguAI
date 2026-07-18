/**
 * MOGU permission proxy stub (v1.6-alpha.1).
 * High-risk mogu.* tools must call requestPermission — desktop offline → deny.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

class PermissionProxy {
  constructor({ isDesktopOnline, askUser, logger } = {}) {
    this.isDesktopOnline = typeof isDesktopOnline === "function" ? isDesktopOnline : () => true;
    this.askUser = typeof askUser === "function" ? askUser : null;
    this.logger = logger || null;
    /** @type {Map<string, { resolve: Function, timer: NodeJS.Timeout }>} */
    this._pending = new Map();
  }

  /**
   * @param {{ tool: string, action?: string, riskLevel?: number, sessionKey?: string, runId?: string, channel?: string, argsDigest?: string }} req
   */
  async requestPermission(req = {}) {
    const tool = String(req.tool || "unknown");
    const riskLevel = Number(req.riskLevel) || 2;
    const requestId = `perm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    if (!this.isDesktopOnline()) {
      this.logger?.warn?.("permission denied: desktop offline", { tool, requestId });
      return {
        ok: false,
        allowed: false,
        requestId,
        reason: "desktop_offline",
        message: "桌面端不在线，高风险操作已拒绝（不可绕过确认）。",
      };
    }

    if (riskLevel <= 1) {
      return { ok: true, allowed: true, requestId, reason: "l1_auto" };
    }

    if (!this.askUser) {
      return {
        ok: false,
        allowed: false,
        requestId,
        reason: "no_ui",
        message: "权限确认 UI 未就绪，已拒绝执行。",
      };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        resolve({
          ok: false,
          allowed: false,
          requestId,
          reason: "timeout_deny",
          message: "权限确认超时，已拒绝执行。",
        });
      }, DEFAULT_TIMEOUT_MS);

      this._pending.set(requestId, { resolve, timer });
      Promise.resolve(
        this.askUser({
          requestId,
          tool,
          action: req.action || "",
          riskLevel,
          sessionKey: req.sessionKey || null,
          runId: req.runId || null,
          channel: req.channel || "desktop",
          argsDigest: req.argsDigest || null,
        })
      ).catch((error) => {
        this.respond(requestId, false, `ask_failed:${error.message}`);
      });
    });
  }

  respond(requestId, allowed, reason = "") {
    const pending = this._pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this._pending.delete(requestId);
    pending.resolve({
      ok: Boolean(allowed),
      allowed: Boolean(allowed),
      requestId,
      reason: reason || (allowed ? "approved" : "denied"),
      message: allowed ? "已批准" : "已拒绝",
    });
    return true;
  }
}

module.exports = { PermissionProxy, DEFAULT_TIMEOUT_MS };
