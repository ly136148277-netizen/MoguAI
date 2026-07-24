"use strict";

const { EventEmitter } = require("node:events");
const {
  boundedString,
  capabilityToRiskLevel,
  makeId,
  normalizeCapability,
} = require("../RemoteTypes");
const { gateCommand } = require("../../permission-gate");

/**
 * Remote Permission Layer — calls existing PermissionProxy via gateCommand.
 * Elevated remote capabilities also require an explicit admin YES/NO when requireApproval.
 * Does not modify Trust Plane internals.
 */
class RemotePermission extends EventEmitter {
  constructor(options = {}) {
    super();
    this.permissionProxy = options.permissionProxy || null;
    this.requireApproval = options.requireApproval !== false;
    this.allowAutoExecute = options.allowAutoExecute === true;
    this._pending = new Map();
    this.adminResponder =
      typeof options.adminResponder === "function" ? options.adminResponder : null;
  }

  configure(settings = {}) {
    this.requireApproval = settings.requireApproval !== false;
    this.allowAutoExecute = settings.allowAutoExecute === true;
  }

  async authorize(taskRequest, context = {}) {
    const capability = normalizeCapability(taskRequest.capability);
    const riskLevel = capabilityToRiskLevel(capability);
    const tool = `remote.${taskRequest.channel || "mock"}`;
    const action = boundedString(
      taskRequest.text || `${capability} via ${taskRequest.channel}`,
      500
    );

    if (!this.permissionProxy) {
      return {
        allowed: false,
        reason: "no_proxy",
        capability,
        riskLevel,
      };
    }

    const gate = await gateCommand(this.permissionProxy, action, {
      tool,
      riskLevel,
      channel: `remote:${taskRequest.channel || "mock"}`,
      sessionKey: taskRequest.sessionId || null,
      runId: taskRequest.requestId || null,
      argsDigest: context.argsDigest || null,
    });

    if (!gate.allowed) {
      return {
        allowed: false,
        reason: gate.reason || "permission_denied",
        capability,
        riskLevel,
        gate,
      };
    }

    const needsRemoteApproval =
      this.requireApproval && capability !== "READ" && !this.allowAutoExecute;

    if (!needsRemoteApproval) {
      return { allowed: true, reason: "ok", capability, riskLevel, gate, remoteApproval: null };
    }

    const approval = await this._requestAdminApproval(taskRequest, { capability, riskLevel });
    if (!approval.allowed) {
      return {
        allowed: false,
        reason: approval.reason || "admin_denied",
        capability,
        riskLevel,
        gate,
        remoteApproval: approval,
      };
    }
    return {
      allowed: true,
      reason: "admin_approved",
      capability,
      riskLevel,
      gate,
      remoteApproval: approval,
    };
  }

  async _requestAdminApproval(taskRequest, meta = {}) {
    const approvalId = makeId("rappr");
    const payload = {
      approvalId,
      channel: taskRequest.channel,
      userId: taskRequest.userId,
      text: taskRequest.text,
      capability: meta.capability,
      riskLevel: meta.riskLevel,
      prompt: "需要管理员批准：回复 YES 或 NO",
    };
    this.emit("approval-required", payload);

    if (typeof this.adminResponder === "function") {
      const answer = await this.adminResponder(payload);
      const allowed =
        String(answer?.decision || answer || "")
          .trim()
          .toUpperCase() === "YES";
      return {
        allowed,
        approvalId,
        reason: allowed ? "yes" : "no",
        decision: allowed ? "YES" : "NO",
      };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this._pending.has(approvalId)) return;
        this._pending.delete(approvalId);
        resolve({ allowed: false, approvalId, reason: "approval_timeout", decision: "NO" });
      }, Number(taskRequest.approvalTimeoutMs) || 120_000);
      this._pending.set(approvalId, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      });
    });
  }

  respond(approvalId, decision) {
    const pending = this._pending.get(String(approvalId || ""));
    if (!pending) return { ok: false, reason: "unknown_approval" };
    this._pending.delete(String(approvalId));
    const allowed = String(decision || "").trim().toUpperCase() === "YES";
    pending.resolve({
      allowed,
      approvalId: String(approvalId),
      reason: allowed ? "yes" : "no",
      decision: allowed ? "YES" : "NO",
    });
    return { ok: true, allowed };
  }
}

module.exports = { RemotePermission };
