const fs = require("fs-extra");
const path = require("path");

/**
 * Append-only permission audit log (JSONL). Never stores tokens.
 */
class PermissionAudit {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async append(entry = {}) {
    const row = {
      ts: new Date().toISOString(),
      requestId: entry.requestId || null,
      tool: entry.tool || null,
      action: entry.action ? String(entry.action).slice(0, 500) : null,
      riskLevel: Number(entry.riskLevel) || null,
      allowed: entry.allowed === true,
      reason: entry.reason || null,
      channel: entry.channel || "desktop",
      sessionKey: entry.sessionKey || null,
      runId: entry.runId || null,
      gatewayApproved: entry.gatewayApproved === true ? true : entry.gatewayApproved === false ? false : null,
      source: entry.source || "mogu",
    };
    await fs.ensureDir(path.dirname(this.filePath));
    await fs.appendFile(this.filePath, `${JSON.stringify(row)}\n`, "utf8");
    return row;
  }

  async list({ limit = 100 } = {}) {
    if (!(await fs.pathExists(this.filePath))) return [];
    const text = await fs.readFile(this.filePath, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const take = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 100)));
    return lines
      .slice(-take)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }
}

module.exports = { PermissionAudit };
