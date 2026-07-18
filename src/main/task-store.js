const fs = require("fs-extra");
const path = require("path");
const { applyIds, createEmptyMapping } = require("./openclaw/id-map");

const SCHEMA_VERSION = 1;

const STATUSES = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function nowIso() {
  return new Date().toISOString();
}

function makeTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class TaskStore {
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Map<string, object>} */
    this._tasks = new Map();
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    if (await fs.pathExists(this.filePath)) {
      try {
        const data = await fs.readJson(this.filePath);
        const list = Array.isArray(data.tasks) ? data.tasks : [];
        this._tasks.clear();
        for (const row of list) {
          if (row?.moguTaskId) this._tasks.set(row.moguTaskId, row);
        }
      } catch {
        this._tasks.clear();
      }
    }
    this._loaded = true;
  }

  async _persist() {
    await fs.ensureDir(path.dirname(this.filePath));
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    const tasks = [...this._tasks.values()].sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    );
    await fs.writeJson(
      tmp,
      { schemaVersion: SCHEMA_VERSION, updatedAt: nowIso(), tasks },
      { spaces: 2 }
    );
    await fs.move(tmp, this.filePath, { overwrite: true });
  }

  async create(partial = {}) {
    await this.load();
    const moguTaskId = partial.moguTaskId || makeTaskId();
    const mapping = createEmptyMapping(moguTaskId, partial.source || "openclaw");
    const row = {
      ...mapping,
      ...applyIds(mapping, partial),
      name: partial.name || partial.title || "未命名任务",
      status: STATUSES.has(partial.status) ? partial.status : "queued",
      createdAt: partial.createdAt || nowIso(),
      updatedAt: nowIso(),
      terminalAt: null,
      errorCode: null,
      errorMessage: null,
      outputPaths: Array.isArray(partial.outputPaths) ? partial.outputPaths : [],
      logSummary: partial.logSummary || "",
      requestAcceptedByGateway: false,
    };
    this._tasks.set(moguTaskId, row);
    await this._persist();
    return row;
  }

  async update(moguTaskId, patch = {}) {
    await this.load();
    const current = this._tasks.get(moguTaskId);
    if (!current) return null;
    const next = {
      ...current,
      ...applyIds(current, patch),
      updatedAt: nowIso(),
    };
    if (patch.name != null) next.name = String(patch.name);
    if (patch.status && STATUSES.has(patch.status)) next.status = patch.status;
    if (patch.errorCode != null) next.errorCode = patch.errorCode;
    if (patch.errorMessage != null) next.errorMessage = String(patch.errorMessage);
    if (patch.logSummary != null) next.logSummary = String(patch.logSummary);
    if (Array.isArray(patch.outputPaths)) next.outputPaths = patch.outputPaths;
    if (patch.requestAcceptedByGateway != null) {
      next.requestAcceptedByGateway = Boolean(patch.requestAcceptedByGateway);
    }
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(next.status)) {
      next.terminalAt = next.terminalAt || nowIso();
    }
    this._tasks.set(moguTaskId, next);
    await this._persist();
    return next;
  }

  async get(moguTaskId) {
    await this.load();
    return this._tasks.get(moguTaskId) || null;
  }

  async list({ limit = 100, source = null } = {}) {
    await this.load();
    let rows = [...this._tasks.values()];
    if (source) rows = rows.filter((r) => r.source === source);
    rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return rows.slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  async getMapping(moguTaskId) {
    const row = await this.get(moguTaskId);
    if (!row) return null;
    return {
      moguTaskId: row.moguTaskId,
      source: row.source,
      sessionKey: row.sessionKey,
      sessionId: row.sessionId,
      runId: row.runId,
      taskId: row.taskId,
      promptId: row.promptId,
    };
  }
}

module.exports = {
  TaskStore,
  SCHEMA_VERSION,
  STATUSES,
  makeTaskId,
};
