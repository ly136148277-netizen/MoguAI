const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_MAX_EVENT_BYTES = 256 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES = 192 * 1024;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function defaultRedact(value, depth = 0) {
  if (value == null || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => defaultRedact(item, depth + 1));
  if (typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /(token|secret|password|passwd|api[-_]?key|authorization|cookie)/i.test(key)
      ? "[REDACTED]"
      : defaultRedact(item, depth + 1);
  }
  return result;
}

class RunEventStore {
  constructor(root, options = {}) {
    if (!root) throw codedError("root_required", "Run event root is required");
    this.root = path.resolve(String(root));
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.redact = typeof options.redact === "function" ? options.redact : defaultRedact;
    this.maxEventBytes = Math.max(1024, Number(options.maxEventBytes) || DEFAULT_MAX_EVENT_BYTES);
    this.maxPayloadBytes = Math.max(256, Number(options.maxPayloadBytes) || DEFAULT_MAX_PAYLOAD_BYTES);
    this._chains = new Map();
  }

  _now() {
    const value = this.clock();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }

  _taskPath(moguTaskId) {
    const id = String(moguTaskId || "");
    if (!TASK_ID_RE.test(id) || id === "." || id === "..") {
      throw codedError("invalid_task_id", "Invalid moguTaskId");
    }
    const taskDir = path.resolve(this.root, id);
    const relative = path.relative(this.root, taskDir);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw codedError("path_escape", "Run event path escapes configured root");
    }
    return { id, taskDir, filePath: path.join(taskDir, "events.jsonl") };
  }

  async _ensureOwnedPath(target) {
    await fsp.mkdir(this.root, { recursive: true });
    const canonicalRoot = await fsp.realpath(this.root);
    await fsp.mkdir(target.taskDir, { recursive: true });
    const canonicalTask = await fsp.realpath(target.taskDir);
    const relative = path.relative(canonicalRoot, canonicalTask);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw codedError("path_escape", "Run event directory resolves outside configured root");
    }
    try {
      const stat = await fsp.lstat(target.filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw codedError("unsafe_event_file", "Run event file must be a regular file");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  _enqueue(id, operation) {
    const previous = this._chains.get(id) || Promise.resolve();
    const next = previous.then(operation, operation);
    const cleanup = () => {
      if (this._chains.get(id) === tracked) this._chains.delete(id);
    };
    const tracked = next.then(cleanup, cleanup);
    this._chains.set(id, tracked);
    return next;
  }

  async read(moguTaskId, options = {}) {
    const target = this._taskPath(moguTaskId);
    await this._ensureOwnedPath(target);
    const limit = Math.max(1, Math.min(100_000, Number(options.limit) || 10_000));
    let text;
    try {
      text = await fsp.readFile(target.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { events: [], corruption: null, lastSequence: 0 };
      throw error;
    }
    const events = [];
    const ids = new Set();
    let corruption = null;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (
          !event ||
          !Number.isSafeInteger(event.sequence) ||
          event.sequence !== events.length + 1 ||
          typeof event.eventId !== "string" ||
          ids.has(event.eventId)
        ) {
          throw new Error("invalid event schema or sequence");
        }
        ids.add(event.eventId);
        events.push(event);
      } catch (error) {
        corruption = { line: index + 1, message: error.message };
        break;
      }
      if (events.length >= limit) break;
    }
    return {
      events,
      corruption,
      lastSequence: events.length ? events[events.length - 1].sequence : 0,
    };
  }

  async append(moguTaskId, input = {}) {
    const target = this._taskPath(moguTaskId);
    return this._enqueue(target.id, async () => {
      await this._ensureOwnedPath(target);
      const current = await this.read(target.id);
      if (current.corruption) {
        throw codedError("event_log_corrupt", `Cannot append after corrupt line ${current.corruption.line}`);
      }
      const eventId = String(input.eventId || crypto.randomUUID()).slice(0, 200);
      const duplicate = current.events.find((event) => event.eventId === eventId);
      if (duplicate) return { event: duplicate, deduped: true, ref: this.reference(target.id, current) };
      const payload = this.redact(input.payload == null ? {} : input.payload);
      if (byteLength(payload) > this.maxPayloadBytes) {
        throw codedError("payload_too_large", "Run event payload exceeds configured bound");
      }
      const event = {
        sequence: current.lastSequence + 1,
        eventId,
        timestamp: this._now(),
        type: String(input.type || "runtime.event").slice(0, 100),
        source: String(input.source || "runtime").slice(0, 100),
        payload,
      };
      const line = `${JSON.stringify(event)}\n`;
      if (Buffer.byteLength(line, "utf8") > this.maxEventBytes) {
        throw codedError("event_too_large", "Run event exceeds configured bound");
      }
      let handle;
      try {
        handle = await fsp.open(target.filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
        await handle.write(line, null, "utf8");
        await handle.sync();
      } catch (error) {
        throw codedError("append_failed", `Run event append failed: ${error.message}`);
      } finally {
        await handle?.close().catch(() => {});
      }
      const summary = { ...current, events: [...current.events, event], lastSequence: event.sequence };
      return { event, deduped: false, ref: this.reference(target.id, summary) };
    });
  }

  reference(moguTaskId, readResult = {}) {
    const target = this._taskPath(moguTaskId);
    const events = readResult.events || [];
    const last = events[events.length - 1] || null;
    return {
      kind: "run-event-jsonl",
      relativePath: path.relative(this.root, target.filePath).replace(/\\/g, "/"),
      eventCount: events.length,
      lastSequence: readResult.lastSequence || 0,
      lastType: last?.type || null,
      updatedAt: last?.timestamp || null,
      corrupt: Boolean(readResult.corruption),
    };
  }

  async replay(moguTaskId, reducer, initialValue) {
    if (typeof reducer !== "function") throw new TypeError("reducer is required");
    const result = await this.read(moguTaskId);
    if (result.corruption) throw codedError("event_log_corrupt", "Cannot replay a corrupt event log");
    let state = initialValue;
    for (const event of result.events) state = await reducer(state, event);
    return { state, summary: this.reference(moguTaskId, result) };
  }

  openClaw(moguTaskId, event) {
    return this.append(moguTaskId, { ...event, source: "openclaw" });
  }

  codingTrace(moguTaskId, event) {
    return this.append(moguTaskId, { ...event, source: "coding" });
  }

  permissionDecision(moguTaskId, event) {
    return this.append(moguTaskId, { ...event, type: event?.type || "permission.decision", source: "permission" });
  }

  verificationResult(moguTaskId, event) {
    return this.append(moguTaskId, { ...event, type: event?.type || "verification.result", source: "verification" });
  }
}

module.exports = {
  RunEventStore,
  defaultRedact,
  DEFAULT_MAX_EVENT_BYTES,
  DEFAULT_MAX_PAYLOAD_BYTES,
};
