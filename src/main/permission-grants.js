const fs = require("fs-extra");
const path = require("path");

/**
 * Persistent permission grants (tool + maxRisk). Revocable from Permission Center.
 */
class PermissionGrants {
  constructor(filePath) {
    this.filePath = filePath;
    this._cache = null;
  }

  async load() {
    if (this._cache) return this._cache;
    if (await fs.pathExists(this.filePath)) {
      try {
        this._cache = await fs.readJson(this.filePath);
      } catch {
        this._cache = { schemaVersion: 1, grants: [] };
      }
    } else {
      this._cache = { schemaVersion: 1, grants: [] };
    }
    if (!Array.isArray(this._cache.grants)) this._cache.grants = [];
    return this._cache;
  }

  async save() {
    await fs.ensureDir(path.dirname(this.filePath));
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeJson(tmp, this._cache || { schemaVersion: 1, grants: [] }, { spaces: 2 });
    await fs.move(tmp, this.filePath, { overwrite: true });
  }

  grantKey(tool, riskLevel) {
    return `${String(tool || "unknown")}@L${Number(riskLevel) || 2}`;
  }

  async list() {
    const data = await this.load();
    return data.grants.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async hasGrant(tool, riskLevel) {
    const data = await this.load();
    const level = Number(riskLevel) || 2;
    const toolName = String(tool || "unknown");
    return data.grants.some(
      (g) => g.tool === toolName && Number(g.maxRiskLevel) >= level && g.revoked !== true
    );
  }

  async grant({ tool, riskLevel, action = "", remember = true } = {}) {
    if (!remember) return { ok: true, skipped: true };
    const data = await this.load();
    const toolName = String(tool || "unknown");
    const level = Math.max(1, Math.min(3, Number(riskLevel) || 2));
    const now = new Date().toISOString();
    const existing = data.grants.find((g) => g.tool === toolName && g.revoked !== true);
    if (existing) {
      existing.maxRiskLevel = Math.max(Number(existing.maxRiskLevel) || 1, level);
      existing.action = String(action || existing.action || "").slice(0, 500);
      existing.updatedAt = now;
      existing.revoked = false;
    } else {
      data.grants.push({
        id: `grant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        tool: toolName,
        maxRiskLevel: level,
        action: String(action || "").slice(0, 500),
        createdAt: now,
        updatedAt: now,
        revoked: false,
      });
    }
    await this.save();
    return { ok: true };
  }

  async revoke(grantId) {
    const data = await this.load();
    const row = data.grants.find((g) => g.id === String(grantId || ""));
    if (!row) return { ok: false, error: "grant_not_found" };
    row.revoked = true;
    row.updatedAt = new Date().toISOString();
    await this.save();
    return { ok: true, grant: row };
  }

  async revokeTool(tool) {
    const data = await this.load();
    const toolName = String(tool || "");
    let count = 0;
    for (const row of data.grants) {
      if (row.tool === toolName && !row.revoked) {
        row.revoked = true;
        row.updatedAt = new Date().toISOString();
        count += 1;
      }
    }
    await this.save();
    return { ok: true, revoked: count };
  }
}

module.exports = { PermissionGrants };
