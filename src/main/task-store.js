const fs = require("fs-extra");
const path = require("path");
const { EventEmitter } = require("events");
const { applyIds, createEmptyMapping } = require("./openclaw/id-map");

const SCHEMA_VERSION = 4;
const MAX_EVENT_IDS = 64;
const MAX_NAME_LENGTH = 200;
const MAX_TEXT_LENGTH = 12_000;
const MAX_LOG_LENGTH = 4_000;
const MAX_OUTPUTS = 100;

const SOURCES = new Set(["openclaw", "pai", "studio", "comfy", "coding", "brain", "routing", "unknown"]);
const STATUSES = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

function nowIso() {
  return new Date().toISOString();
}

function makeTaskId() {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function capText(value, max = MAX_TEXT_LENGTH) {
  if (value == null) return null;
  return String(value).slice(0, max);
}

function normalizeSource(value, fallback = "unknown") {
  const source = String(value || fallback).trim().toLowerCase();
  return SOURCES.has(source) ? source : fallback;
}

function normalizeStatus(value, fallback = "queued") {
  const status = String(value || fallback).trim().toLowerCase();
  if (status === "completed") return "succeeded";
  if (status === "canceled") return "cancelled";
  return STATUSES.has(status) ? status : fallback;
}

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

function normalizeIso(value, fallback) {
  if (value == null || value === "") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function normalizeNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeProgress(value) {
  const number = normalizeNumber(value);
  if (number == null) return null;
  return Math.max(0, Math.min(100, number));
}

function normalizeOutputs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, MAX_OUTPUTS);
}

function normalizeEventIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(-MAX_EVENT_IDS);
}

function scrubReplayValue(value, depth = 0) {
  if (depth > 4 || value == null) return value == null ? value : String(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => scrubReplayValue(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : value;

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/(token|secret|password|passwd|api[-_]?key|authorization|cookie|nonce)/i.test(key)) continue;
    result[key] = scrubReplayValue(item, depth + 1);
  }
  return result;
}

function normalizeReplay(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scrubbed = scrubReplayValue(value);
  const allowed = {};
  for (const key of ["kind", "text", "command", "level", "sessionKey", "payload", "operationId"]) {
    if (scrubbed[key] != null) allowed[key] = scrubbed[key];
  }
  return Object.keys(allowed).length ? allowed : null;
}

function normalizeRoutingEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scrubbed = scrubRoutingValue(value);
  const serialized = JSON.stringify(scrubbed);
  if (serialized.length > MAX_TEXT_LENGTH) return null;
  return scrubbed;
}

function scrubRoutingValue(value, depth = 0) {
  if (depth > 6 || value == null) return value == null ? value : String(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => scrubRoutingValue(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : value;
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const tokenMetric = /^(?:max)?(?:input|output|total)?tokens$/.test(normalized);
    if (!tokenMetric && /(token|secret|password|passwd|api[-_]?key|authorization|cookie|nonce)/i.test(key)) continue;
    result[key] = scrubRoutingValue(item, depth + 1);
  }
  return result;
}

function normalizeLastEvent(value) {
  if (!value || typeof value !== "object") return null;
  const event = {};
  if (value.eventId != null && String(value.eventId).trim()) event.eventId = String(value.eventId).trim();
  if (value.connId != null && String(value.connId).trim()) event.connId = String(value.connId).trim();
  const seq = normalizeNumber(value.seq);
  if (seq != null) event.seq = seq;
  return Object.keys(event).length ? event : null;
}

function normalizeRuntimeEventRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const relativePath = String(value.relativePath || "").replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..")) return null;
  return {
    kind: "run-event-jsonl",
    relativePath: relativePath.slice(0, 300),
    eventCount: Math.max(0, Math.floor(normalizeNumber(value.eventCount, 0))),
    lastSequence: Math.max(0, Math.floor(normalizeNumber(value.lastSequence, 0))),
    lastType: value.lastType == null ? null : capText(value.lastType, 100),
    updatedAt: normalizeIso(value.updatedAt, null),
    corrupt: value.corrupt === true,
  };
}

function normalizeRuntimeEventSummary(value) {
  const ref = normalizeRuntimeEventRef({ ...(value || {}), relativePath: "summary" });
  if (!ref) return null;
  delete ref.kind;
  delete ref.relativePath;
  delete ref.corrupt;
  return ref;
}

function normalizeTask(row = {}, { defaultSource = "unknown", now = nowIso() } = {}) {
  const raw = row && typeof row === "object" ? row : {};
  const moguTaskId = String(raw.moguTaskId || makeTaskId());
  const source = normalizeSource(raw.source, defaultSource);
  const mapping = createEmptyMapping(moguTaskId, source);
  const ids = applyIds(mapping, { ...raw, source });
  const status = normalizeStatus(raw.status);
  const createdAt = normalizeIso(raw.createdAt, now);
  const updatedAt = normalizeIso(raw.updatedAt, createdAt);
  const terminalAt = isTerminal(status) ? normalizeIso(raw.terminalAt, updatedAt) : null;
  const requestAccepted = raw.requestAcceptedByGateway === true;
  const acceptance = ["unknown", "accepted", "rejected"].includes(String(raw.acceptance || ""))
    ? String(raw.acceptance)
    : requestAccepted
      ? "accepted"
      : "unknown";

  return {
    ...ids,
    kind: String(raw.kind || source).slice(0, 64),
    executor: String(raw.executor || source).slice(0, 64),
    name: capText(raw.name || raw.title || "未命名任务", MAX_NAME_LENGTH),
    status,
    attempt: Math.max(1, Math.floor(normalizeNumber(raw.attempt, 1))),
    revision: Math.max(0, Math.floor(normalizeNumber(raw.revision, 0))),
    createdAt,
    startedAt: normalizeIso(raw.startedAt, null),
    updatedAt,
    terminalAt,
    errorCode: raw.errorCode == null ? null : capText(raw.errorCode, 200),
    errorMessage: raw.errorMessage == null ? null : capText(raw.errorMessage),
    outputPaths: normalizeOutputs(raw.outputPaths),
    logSummary: capText(raw.logSummary || "", MAX_LOG_LENGTH) || "",
    progress: normalizeProgress(raw.progress),
    requestAcceptedByGateway: requestAccepted,
    acceptance,
    requestText: capText(raw.requestText || raw.request?.text, MAX_TEXT_LENGTH),
    replay: normalizeReplay(raw.replay || raw.replayDescriptor),
    retryOf: raw.retryOf ? String(raw.retryOf) : null,
    retryCount: Math.max(0, Math.floor(normalizeNumber(raw.retryCount, 0))),
    idempotencyKey: raw.idempotencyKey ? capText(raw.idempotencyKey, 200) : null,
    eventIds: normalizeEventIds(raw.eventIds),
    lastEvent: normalizeLastEvent(raw.lastEvent),
    runtimeEventRef: normalizeRuntimeEventRef(raw.runtimeEventRef),
    runtimeEventSummary: normalizeRuntimeEventSummary(raw.runtimeEventSummary),
    routing: normalizeRoutingEvidence(raw.routing),
    routingConfigHash: raw.routingConfigHash == null ? null : capText(raw.routingConfigHash, 128),
    routingBudgetSnapshot: normalizeRoutingEvidence(raw.routingBudgetSnapshot),
  };
}

function compareTasks(a, b) {
  const updated = String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  if (updated !== 0) return updated;
  return String(b.moguTaskId || "").localeCompare(String(a.moguTaskId || ""));
}

function encodeCursor(task) {
  return Buffer.from(JSON.stringify({ updatedAt: task.updatedAt, moguTaskId: task.moguTaskId }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (!value?.updatedAt || !value?.moguTaskId) return null;
    return { updatedAt: String(value.updatedAt), moguTaskId: String(value.moguTaskId) };
  } catch {
    return null;
  }
}

class TaskStore extends EventEmitter {
  constructor(filePath, options = {}) {
    super();
    this.filePath = filePath;
    this._tasks = new Map();
    this._loaded = false;
    this._readOnly = false;
    this._loadError = null;
    this._writeChain = Promise.resolve();
    this._tmpCounter = 0;
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.eventStore = options.eventStore || null;
    if (typeof options.onChange === "function") this.on("change", options.onChange);
  }

  _now() {
    const value = this.clock();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  async load() {
    if (this._loaded) return;
    let data = { schemaVersion: SCHEMA_VERSION, tasks: [] };
    let migrated = false;
    if (await fs.pathExists(this.filePath)) {
      try {
        data = await fs.readJson(this.filePath);
      } catch (error) {
        this._loadError = error;
        const quarantine = `${this.filePath}.corrupt-${Date.now()}`;
        try {
          await fs.copy(this.filePath, quarantine, { overwrite: false });
        } catch {
          // Preserve the original failure without hiding it behind quarantine errors.
        }
        data = { schemaVersion: SCHEMA_VERSION, tasks: [] };
      }
    }

    const version = Number(data?.schemaVersion || 1);
    if (version > SCHEMA_VERSION) this._readOnly = true;
    const rows = Array.isArray(data?.tasks) ? data.tasks : [];
    this._tasks.clear();
    for (const row of rows) {
      const normalized = normalizeTask(row, { now: this._now() });
      const previous = this._tasks.get(normalized.moguTaskId);
      if (!previous || compareTasks(normalized, previous) < 0) {
        this._tasks.set(normalized.moguTaskId, normalized);
      }
    }
    this._loaded = true;
    migrated = version !== SCHEMA_VERSION || rows.some((row) => !row?.revision || !row?.eventIds);
    if (migrated && !this._readOnly) await this._persist();
  }

  _assertWritable() {
    if (this._readOnly) {
      throw new Error(`任务数据 schema ${SCHEMA_VERSION + 1} 或更高版本，当前版本只读`);
    }
  }

  _snapshot() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: this._now(),
      tasks: [...this._tasks.values()].sort(compareTasks).map(clone),
    };
  }

  _persist() {
    const snapshot = this._snapshot();
    const tmp = `${this.filePath}.${process.pid}.${++this._tmpCounter}.tmp`;
    const write = async () => {
      await fs.ensureDir(path.dirname(this.filePath));
      await fs.writeJson(tmp, snapshot, { spaces: 2 });
      await fs.move(tmp, this.filePath, { overwrite: true });
    };
    const next = this._writeChain.then(write, write);
    this._writeChain = next;
    return next;
  }

  _emitChange(type, task, extra = {}) {
    const payload = { type, task: clone(task), schemaVersion: SCHEMA_VERSION, ...extra };
    try {
      this.emit("change", payload);
    } catch {
      // A renderer notification must never make a successful mutation fail.
    }
  }

  _findByIdempotencyKey(key) {
    if (!key) return null;
    for (const task of this._tasks.values()) {
      if (task.idempotencyKey === key) return task;
    }
    return null;
  }

  async create(partial = {}) {
    await this.load();
    this._assertWritable();
    const raw = partial && typeof partial === "object" ? partial : {};
    const idempotencyKey = raw.idempotencyKey ? capText(raw.idempotencyKey, 200) : null;
    const byKey = this._findByIdempotencyKey(idempotencyKey);
    if (byKey) return clone(byKey);

    const requestedId = raw.moguTaskId ? String(raw.moguTaskId) : null;
    if (requestedId && this._tasks.has(requestedId)) return clone(this._tasks.get(requestedId));

    const now = this._now();
    const source =
      raw.source != null && String(raw.source).trim()
        ? normalizeSource(raw.source, "unknown")
        : "openclaw";
    const task = normalizeTask(
      {
        ...raw,
        moguTaskId: requestedId || makeTaskId(),
        source,
        idempotencyKey,
        createdAt: raw.createdAt || now,
        updatedAt: now,
        startedAt: raw.startedAt || (normalizeStatus(raw.status) === "running" ? now : null),
      },
      { defaultSource: source, now }
    );
    this._tasks.set(task.moguTaskId, task);
    await this._persist();
    this._emitChange("created", task);
    return clone(task);
  }

  async update(moguTaskId, patch = {}) {
    await this.load();
    this._assertWritable();
    const id = String(moguTaskId || "");
    const current = this._tasks.get(id);
    if (!current) return null;
    const raw = patch && typeof patch === "object" ? patch : {};
    const eventId = raw.eventId ? String(raw.eventId).trim() : null;
    if (eventId && current.eventIds.includes(eventId)) return clone(current);

    const eventSeq = normalizeNumber(raw.eventSeq ?? raw.seq);
    if (eventSeq != null && current.lastEvent?.seq != null && eventSeq <= current.lastEvent.seq) {
      return clone(current);
    }

    const next = { ...current };
    const idPatch = applyIds(current, raw);
    for (const key of ["sessionKey", "sessionId", "runId", "taskId", "promptId"]) next[key] = idPatch[key];
    if (raw.name != null || raw.title != null) next.name = capText(raw.name ?? raw.title, MAX_NAME_LENGTH);
    if (raw.status != null) {
      const proposed = normalizeStatus(raw.status, current.status);
      if (!(isTerminal(current.status) && proposed !== current.status && raw.force !== true)) {
        next.status = proposed;
      }
    }
    for (const key of ["errorCode", "errorMessage", "logSummary", "requestText"]) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        next[key] = raw[key] == null ? null : capText(raw[key], key === "logSummary" ? MAX_LOG_LENGTH : MAX_TEXT_LENGTH);
      }
    }
    if (Object.prototype.hasOwnProperty.call(raw, "outputPaths")) next.outputPaths = normalizeOutputs(raw.outputPaths);
    if (Object.prototype.hasOwnProperty.call(raw, "progress")) next.progress = normalizeProgress(raw.progress);
    if (Object.prototype.hasOwnProperty.call(raw, "requestAcceptedByGateway")) {
      next.requestAcceptedByGateway = raw.requestAcceptedByGateway === true;
      next.acceptance = next.requestAcceptedByGateway ? "accepted" : next.acceptance;
    }
    if (Object.prototype.hasOwnProperty.call(raw, "acceptance") && ["unknown", "accepted", "rejected"].includes(String(raw.acceptance))) {
      next.acceptance = String(raw.acceptance);
    }
    if (Object.prototype.hasOwnProperty.call(raw, "startedAt")) next.startedAt = normalizeIso(raw.startedAt, null);
    if (Object.prototype.hasOwnProperty.call(raw, "replay")) next.replay = normalizeReplay(raw.replay);
    if (Object.prototype.hasOwnProperty.call(raw, "retryOf")) next.retryOf = raw.retryOf ? String(raw.retryOf) : null;
    if (Object.prototype.hasOwnProperty.call(raw, "retryCount")) next.retryCount = Math.max(0, Math.floor(normalizeNumber(raw.retryCount, 0)));
    if (Object.prototype.hasOwnProperty.call(raw, "runtimeEventRef")) next.runtimeEventRef = normalizeRuntimeEventRef(raw.runtimeEventRef);
    if (Object.prototype.hasOwnProperty.call(raw, "runtimeEventSummary")) next.runtimeEventSummary = normalizeRuntimeEventSummary(raw.runtimeEventSummary);
    if (Object.prototype.hasOwnProperty.call(raw, "routing")) next.routing = normalizeRoutingEvidence(raw.routing);
    if (Object.prototype.hasOwnProperty.call(raw, "routingConfigHash")) {
      next.routingConfigHash = raw.routingConfigHash == null ? null : capText(raw.routingConfigHash, 128);
    }
    if (Object.prototype.hasOwnProperty.call(raw, "routingBudgetSnapshot")) {
      next.routingBudgetSnapshot = normalizeRoutingEvidence(raw.routingBudgetSnapshot);
    }
    if (eventId) next.eventIds = normalizeEventIds([...current.eventIds, eventId]);
    if (eventId || eventSeq != null || raw.connId) {
      next.lastEvent = normalizeLastEvent({ eventId, seq: eventSeq, connId: raw.connId || current.lastEvent?.connId });
    }

    const proposedStatus = next.status;
    if (proposedStatus === "running" && !next.startedAt) next.startedAt = this._now();
    if (isTerminal(proposedStatus)) next.terminalAt = next.terminalAt || this._now();
    else if (raw.force === true) next.terminalAt = null;

    const before = JSON.stringify(current);
    next.updatedAt = this._now();
    next.revision = current.revision + 1;
    const normalized = normalizeTask(next, { defaultSource: current.source, now: next.updatedAt });
    if (JSON.stringify(normalized) === before) return clone(current);
    this._tasks.set(id, normalized);
    await this._persist();
    this._emitChange("updated", normalized, { eventId, eventSeq });
    return clone(normalized);
  }

  async retry(moguTaskId, overrides = {}) {
    await this.load();
    this._assertWritable();
    const current = this._tasks.get(String(moguTaskId || ""));
    if (!current || !isTerminal(current.status)) return null;
    if (!current.replay) return null;
    const retryCount = current.retryCount + 1;
    return this.create({
      source: current.source,
      kind: current.kind,
      executor: current.executor,
      name: current.name,
      status: "queued",
      sessionKey: current.source === "openclaw" ? current.sessionKey : null,
      requestText: current.requestText,
      replay: current.replay,
      retryOf: current.moguTaskId,
      retryCount,
      attempt: current.attempt + 1,
      idempotencyKey: overrides.idempotencyKey || `${current.moguTaskId}:retry:${retryCount}`,
    });
  }

  async get(moguTaskId) {
    await this.load();
    return clone(this._tasks.get(String(moguTaskId || "")) || null);
  }

  async listPage(options = {}) {
    await this.load();
    const query = options && typeof options === "object" ? options : {};
    const sources = new Set(
      (Array.isArray(query.sources) ? query.sources : query.source ? [query.source] : [])
        .map((value) => normalizeSource(value, "__invalid__"))
    );
    const statuses = new Set(
      (Array.isArray(query.statuses) ? query.statuses : query.status ? [query.status] : [])
        .map((value) => normalizeStatus(value, "__invalid__"))
    );
    const text = String(query.query || "").trim().toLowerCase();
    const updatedAfter = query.updatedAfter || query.from ? new Date(query.updatedAfter || query.from).getTime() : null;
    const updatedBefore = query.updatedBefore || query.to ? new Date(query.updatedBefore || query.to).getTime() : null;
    let rows = [...this._tasks.values()].filter((task) => {
      if (sources.size && !sources.has(task.source)) return false;
      if (statuses.size && !statuses.has(task.status)) return false;
      const updated = new Date(task.updatedAt).getTime();
      if (Number.isFinite(updatedAfter) && updated < updatedAfter) return false;
      if (Number.isFinite(updatedBefore) && updated > updatedBefore) return false;
      if (text && ![task.name, task.moguTaskId, task.errorMessage, task.logSummary, task.source].some((value) => String(value || "").toLowerCase().includes(text))) return false;
      return true;
    });
    rows.sort(compareTasks);

    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      rows = rows.filter((task) => task.updatedAt < cursor.updatedAt || (task.updatedAt === cursor.updatedAt && task.moguTaskId < cursor.moguTaskId));
    }
    const limit = Math.max(1, Math.min(500, Math.floor(normalizeNumber(query.limit, 100))));
    const offset = cursor ? 0 : Math.max(0, Math.floor(normalizeNumber(query.offset, 0)));
    const page = rows.slice(offset, offset + limit).map(clone);
    const hasMore = offset + limit < rows.length;
    return {
      tasks: page,
      nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
      hasMore,
      total: rows.length,
      limit,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  // Kept as an array-returning compatibility API for alpha.1/alpha.2 callers.
  async list(options = {}) {
    const page = await this.listPage(options);
    return page.tasks;
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

  async checkpoint(moguTaskId, event = {}) {
    if (!this.eventStore) throw new Error("run event store is not configured");
    const task = await this.get(moguTaskId);
    if (!task) return null;
    const appended = await this.eventStore.append(task.moguTaskId, {
      ...event,
      type: event.type || "task.checkpoint",
      source: event.source || task.source,
    });
    await this.update(task.moguTaskId, {
      runtimeEventRef: appended.ref,
      runtimeEventSummary: appended.ref,
    });
    return clone(appended);
  }

  async replayEvents(moguTaskId, reducer, initialValue) {
    if (!this.eventStore) throw new Error("run event store is not configured");
    const task = await this.get(moguTaskId);
    if (!task) return null;
    return this.eventStore.replay(task.moguTaskId, reducer, initialValue);
  }

  async recover(moguTaskId) {
    if (!this.eventStore) throw new Error("run event store is not configured");
    const task = await this.get(moguTaskId);
    if (!task) return null;
    const read = await this.eventStore.read(task.moguTaskId);
    const ref = this.eventStore.reference(task.moguTaskId, read);
    const updated = await this.update(task.moguTaskId, {
      runtimeEventRef: ref,
      runtimeEventSummary: ref,
    });
    return { task: updated, events: read.events, corruption: read.corruption, summary: ref };
  }
}

module.exports = {
  TaskStore,
  SCHEMA_VERSION,
  SOURCES,
  STATUSES,
  TERMINAL_STATUSES,
  makeTaskId,
  normalizeTask,
};
