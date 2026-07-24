const fs = require("fs-extra");
const path = require("path");

const SCHEMA_VERSION = 2;
const MAX_LEASE_TTL_MS = 24 * 60 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso(clock) {
  const value = clock();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function normalizeScopes(value) {
  const scopes = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(scopes.map((scope) => String(scope || "").trim()).filter(Boolean))].slice(0, 50);
}

function scopeAllows(granted, requested) {
  if (granted === "*") return true;
  if (granted.endsWith(".*")) {
    const prefix = granted.slice(0, -1);
    return requested === granted.slice(0, -2) || requested.startsWith(prefix);
  }
  return granted === requested;
}

/**
 * Persistent permission grants (tool + maxRisk). Revocable from Permission Center.
 */
class PermissionGrants {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this._cache = null;
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this._leaseChain = Promise.resolve();
  }

  async load() {
    if (this._cache) return this._cache;
    if (await fs.pathExists(this.filePath)) {
      try {
        this._cache = await fs.readJson(this.filePath);
      } catch {
        this._cache = { schemaVersion: SCHEMA_VERSION, grants: [], leases: [] };
      }
    } else {
      this._cache = { schemaVersion: SCHEMA_VERSION, grants: [], leases: [] };
    }
    if (!Array.isArray(this._cache.grants)) this._cache.grants = [];
    if (!Array.isArray(this._cache.leases)) this._cache.leases = [];
    if (Number(this._cache.schemaVersion) < SCHEMA_VERSION) {
      this._cache.schemaVersion = SCHEMA_VERSION;
      await this.save();
    }
    return this._cache;
  }

  async save() {
    await fs.ensureDir(path.dirname(this.filePath));
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeJson(tmp, this._cache || { schemaVersion: SCHEMA_VERSION, grants: [], leases: [] }, { spaces: 2 });
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
    // Legacy grants remain compatible, but can never bypass mandatory L3 confirmation.
    if ((Number(riskLevel) || 2) >= 3) return false;
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
    const id = String(grantId || "");
    const row = data.grants.find((g) => g.id === id) || data.leases.find((lease) => lease.id === id);
    if (!row) return { ok: false, error: "grant_not_found" };
    row.revoked = true;
    row.updatedAt = nowIso(this.clock);
    row.revokedAt = row.updatedAt;
    await this.save();
    return { ok: true, grant: row, lease: data.leases.includes(row) ? clone(row) : undefined };
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

  async issue(options = {}) {
    const data = await this.load();
    const runId = String(options.runId || "").trim();
    const scopes = normalizeScopes(options.scopes || options.scope);
    const level = Math.max(1, Math.min(3, Number(options.maxRiskLevel ?? options.riskLevel) || 1));
    if (!runId) return { ok: false, error: "run_id_required" };
    if (!scopes.length) return { ok: false, error: "scope_required" };
    if (level >= 3) return { ok: false, error: "l3_confirmation_required" };
    const requestedTtl = Number(options.ttlMs);
    const ttlMs = Math.min(MAX_LEASE_TTL_MS, Math.max(1, Number.isFinite(requestedTtl) ? requestedTtl : 15 * 60 * 1000));
    const issued = new Date(nowIso(this.clock));
    const maxUses = Math.max(1, Math.min(100_000, Math.floor(Number(options.maxUses ?? options.budget?.uses) || 1)));
    const maxCost = Math.max(0, Number(options.maxCost ?? options.budget?.cost) || 0);
    const lease = {
      id: `lease-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      template: String(options.template || "").toLowerCase() === "sovereign" ? "sovereign" : null,
      runId,
      tool: String(options.tool || "*").trim() || "*",
      scopes,
      maxRiskLevel: level,
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.getTime() + ttlMs).toISOString(),
      budget: { maxUses, used: 0, maxCost, costUsed: 0 },
      revoked: false,
      updatedAt: issued.toISOString(),
    };
    data.leases.push(lease);
    await this.save();
    return { ok: true, lease: clone(lease) };
  }

  async issueLease(options = {}) {
    return this.issue(options);
  }

  async check(options = {}) {
    const data = await this.load();
    const id = String(options.leaseId || options.id || "");
    const lease = data.leases.find((row) => row.id === id);
    if (!lease) return { allowed: false, reason: "lease_not_found" };
    if (lease.revoked) return { allowed: false, reason: "lease_revoked", lease: clone(lease) };
    if (Date.parse(lease.expiresAt) <= new Date(nowIso(this.clock)).getTime()) {
      return { allowed: false, reason: "lease_expired", lease: clone(lease) };
    }
    const riskLevel = Math.max(1, Math.min(3, Number(options.riskLevel) || 1));
    if (riskLevel >= 3) return { allowed: false, reason: "l3_confirmation_required", lease: clone(lease) };
    if (riskLevel > Number(lease.maxRiskLevel)) return { allowed: false, reason: "risk_exceeded", lease: clone(lease) };
    if (String(options.runId || "") !== lease.runId) return { allowed: false, reason: "run_mismatch", lease: clone(lease) };
    const tool = String(options.tool || lease.tool);
    if (lease.tool !== "*" && tool !== lease.tool) return { allowed: false, reason: "tool_mismatch", lease: clone(lease) };
    const requestedScopes = normalizeScopes(options.scopes || options.scope);
    if (!requestedScopes.length || !requestedScopes.every((scope) => lease.scopes.some((granted) => scopeAllows(granted, scope)))) {
      return { allowed: false, reason: "scope_denied", lease: clone(lease) };
    }
    const cost = Math.max(0, Number(options.cost) || 0);
    if (lease.budget.used >= lease.budget.maxUses) return { allowed: false, reason: "budget_exhausted", lease: clone(lease) };
    if (lease.budget.maxCost > 0 && lease.budget.costUsed + cost > lease.budget.maxCost) {
      return { allowed: false, reason: "budget_exhausted", lease: clone(lease) };
    }
    return { allowed: true, reason: "lease_allowed", lease: clone(lease) };
  }

  async checkLease(options = {}) {
    return this.check(options);
  }

  async consume(options = {}) {
    const operation = () => this._consume(options);
    const next = this._leaseChain.then(operation, operation);
    this._leaseChain = next.then(() => undefined, () => undefined);
    return next;
  }

  async _consume(options = {}) {
    const decision = await this.check(options);
    if (!decision.allowed) return decision;
    const data = await this.load();
    const lease = data.leases.find((row) => row.id === decision.lease.id);
    lease.budget.used += 1;
    lease.budget.costUsed += Math.max(0, Number(options.cost) || 0);
    lease.updatedAt = nowIso(this.clock);
    await this.save();
    return { allowed: true, reason: "lease_consumed", lease: clone(lease) };
  }

  async consumeLease(options = {}) {
    return this.consume(options);
  }

  async listLeases(options = {}) {
    const data = await this.load();
    const includeInactive = options.includeInactive === true;
    const now = new Date(nowIso(this.clock)).getTime();
    return data.leases
      .filter((lease) => includeInactive || (!lease.revoked && Date.parse(lease.expiresAt) > now))
      .slice()
      .sort((a, b) => String(b.updatedAt || b.issuedAt).localeCompare(String(a.updatedAt || a.issuedAt)))
      .map(clone);
  }

  async prune() {
    const data = await this.load();
    const now = new Date(nowIso(this.clock)).getTime();
    const before = data.leases.length;
    data.leases = data.leases.filter((lease) => !lease.revoked && Date.parse(lease.expiresAt) > now);
    const pruned = before - data.leases.length;
    if (pruned) await this.save();
    return { ok: true, pruned };
  }
}

module.exports = { PermissionGrants, SCHEMA_VERSION, MAX_LEASE_TTL_MS, scopeAllows };
