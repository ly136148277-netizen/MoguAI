/**
 * MOGU PermissionProxy — sole gate for high-risk mogu.* / PAI / Studio actions.
 * Desktop offline / no confirm UI / timeout → deny. Gateway approval never replaces MOGU.
 */

const DEFAULT_TIMEOUT_MS = 60_000;

class PermissionProxy {
  /**
   * @param {{
   *   isDesktopOnline?: () => boolean,
   *   hasConfirmUi?: () => boolean,
   *   askUser?: (req: object) => Promise<void>|void,
   *   audit?: { append: (entry: object) => Promise<any> },
   *   logger?: any,
   *   timeoutMs?: number,
   * }} opts
   */
  constructor(opts = {}) {
    this.isDesktopOnline = typeof opts.isDesktopOnline === "function" ? opts.isDesktopOnline : () => true;
    this.hasConfirmUi = typeof opts.hasConfirmUi === "function" ? opts.hasConfirmUi : () => Boolean(opts.askUser);
    this.askUser = typeof opts.askUser === "function" ? opts.askUser : null;
    this.audit = opts.audit || null;
    this.logger = opts.logger || null;
    this.timeoutMs = Number.isFinite(Number(opts.timeoutMs))
      ? Math.max(50, Number(opts.timeoutMs))
      : DEFAULT_TIMEOUT_MS;
    /** @type {Map<string, { resolve: Function, timer: NodeJS.Timeout, req: object }>} */
    this._pending = new Map();
  }

  /**
   * @param {{
   *   tool: string,
   *   action?: string,
   *   riskLevel?: number,
   *   sessionKey?: string,
   *   runId?: string,
   *   channel?: string,
   *   argsDigest?: string,
   *   requireGatewayApproval?: boolean,
   *   gatewayApproved?: boolean,
   * }} req
   */
  async requestPermission(req = {}) {
    const tool = String(req.tool || "unknown");
    const riskLevel = clampRisk(req.riskLevel);
    const requestId = `perm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const base = {
      requestId,
      tool,
      action: req.action || "",
      riskLevel,
      sessionKey: req.sessionKey || null,
      runId: req.runId || null,
      channel: req.channel || "desktop",
      argsDigest: req.argsDigest || null,
      requireGatewayApproval: req.requireGatewayApproval === true,
      gatewayApproved: req.gatewayApproved === true,
    };

    if (!this.isDesktopOnline()) {
      return this._finish(base, false, "desktop_offline", "桌面端不在线，高风险操作已拒绝（不可绕过确认）。");
    }

    // L1 read-only: auto-allow + audit. L2/L3 always need MOGU UI confirm.
    if (riskLevel <= 1) {
      return this._finish(base, true, "l1_auto", "L1 只读已放行");
    }

    if (!this.askUser || !this.hasConfirmUi()) {
      return this._finish(base, false, "no_ui", "权限确认 UI 未就绪，已拒绝执行。");
    }

    const userDecision = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        resolve({
          ok: false,
          allowed: false,
          requestId,
          reason: "timeout_deny",
          message: "权限确认超时，已拒绝执行。",
        });
      }, this.timeoutMs);

      this._pending.set(requestId, { resolve, timer, req: base });
      Promise.resolve(
        this.askUser({
          ...base,
          title: riskLevel >= 3 ? "L3 危险操作确认" : "L2 操作确认",
        })
      ).catch((error) => {
        this.respond(requestId, false, `ask_failed:${error.message}`);
      });
    });

    if (!userDecision?.allowed) {
      return this._finish(base, false, userDecision?.reason || "denied", userDecision?.message || "已拒绝");
    }

    // Dual gate: Gateway approval cannot replace MOGU; when required, both must pass.
    if (base.requireGatewayApproval && !base.gatewayApproved) {
      return this._finish(
        base,
        false,
        "gateway_approval_required",
        "MOGU 已批准，但仍需 Gateway approval；双重校验未通过。"
      );
    }

    return this._finish(base, true, "approved", "已批准");
  }

  respond(requestId, allowed, reason = "") {
    const pending = this._pending.get(String(requestId || ""));
    if (!pending) return false;
    clearTimeout(pending.timer);
    this._pending.delete(String(requestId));
    pending.resolve({
      ok: Boolean(allowed),
      allowed: Boolean(allowed),
      requestId: String(requestId),
      reason: reason || (allowed ? "approved" : "denied"),
      message: allowed ? "已批准" : "已拒绝",
    });
    return true;
  }

  pendingCount() {
    return this._pending.size;
  }

  async _finish(base, allowed, reason, message) {
    const result = {
      ok: allowed,
      allowed,
      requestId: base.requestId,
      reason,
      message,
      riskLevel: base.riskLevel,
      tool: base.tool,
      gatewayApproved: base.gatewayApproved,
    };
    try {
      await this.audit?.append?.({
        ...base,
        allowed,
        reason,
        source: "mogu",
      });
    } catch (error) {
      this.logger?.warn?.("permission audit failed", { message: error.message });
    }
    if (!allowed) {
      this.logger?.warn?.("permission denied", { tool: base.tool, reason, requestId: base.requestId });
    }
    return result;
  }
}

function clampRisk(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(3, Math.floor(n)));
}

module.exports = { PermissionProxy, DEFAULT_TIMEOUT_MS, clampRisk };
