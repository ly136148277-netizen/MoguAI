const crypto = require("node:crypto");
const {
  DEFAULT_MAX_PAYLOAD_BYTES,
} = require("../runtime/run-event-store");
const { stableStringify, redactSecrets } = require("./context-budget");

const EVENT_TYPES = Object.freeze([
  "neural.plan",
  "context.selected",
  "context.evicted",
  "tool.selected",
  "tool.result",
  "tool.violation",
  "verification.result",
  "decision.branch",
]);
const EVENT_SET = new Set(EVENT_TYPES);

function boundedSummary(value, maxBytes = 16 * 1024) {
  const redacted = redactSecrets(value == null ? {} : value);
  const text = stableStringify(redacted);
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return redacted;
  const suffix = "…[TRUNCATED]";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid) + suffix, "utf8") <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return {
    truncated: true,
    summary: `${text.slice(0, low)}${suffix}`,
    originalSha256: crypto.createHash("sha256").update(text).digest("hex"),
  };
}

function deterministicEventId(type, supplied) {
  if (supplied != null && String(supplied).trim()) {
    return crypto
      .createHash("sha256")
      .update(`${type}\0${String(supplied)}`)
      .digest("hex");
  }
  return undefined;
}

class DecisionTrace {
  constructor(eventStore, options = {}) {
    if (!eventStore?.append || !eventStore?.read) {
      throw new TypeError("RunEventStore-compatible eventStore is required");
    }
    this.eventStore = eventStore;
    this.maxSummaryBytes = Math.min(
      DEFAULT_MAX_PAYLOAD_BYTES,
      Math.max(256, Number(options.maxSummaryBytes) || 16 * 1024)
    );
    this.source = String(options.source || "neural");
  }

  async append(moguTaskId, type, payload = {}, options = {}) {
    if (!EVENT_SET.has(type)) {
      const error = new Error(`Unsupported decision trace event type: ${type}`);
      error.code = "TRACE_EVENT_TYPE_INVALID";
      throw error;
    }
    if (!moguTaskId) {
      const error = new Error("moguTaskId is required");
      error.code = "TRACE_TASK_REQUIRED";
      throw error;
    }
    const eventId = deterministicEventId(type, options.eventId ?? options.dedupeKey);
    try {
      return await this.eventStore.append(moguTaskId, {
        ...(eventId ? { eventId } : {}),
        type,
        source: String(options.source || this.source),
        payload: boundedSummary(payload, this.maxSummaryBytes),
      });
    } catch (cause) {
      const error = new Error(`Decision trace append failed: ${cause.message}`);
      error.code = "TRACE_APPEND_FAILED";
      error.cause = cause;
      throw error;
    }
  }

  plan(taskId, payload, options) {
    return this.append(taskId, "neural.plan", payload, options);
  }
  contextSelected(taskId, payload, options) {
    return this.append(taskId, "context.selected", payload, options);
  }
  contextEvicted(taskId, payload, options) {
    return this.append(taskId, "context.evicted", payload, options);
  }
  toolSelected(taskId, payload, options) {
    return this.append(taskId, "tool.selected", payload, options);
  }
  toolResult(taskId, payload, options) {
    return this.append(taskId, "tool.result", payload, options);
  }
  toolViolation(taskId, payload, options) {
    return this.append(taskId, "tool.violation", payload, options);
  }
  verificationResult(taskId, payload, options) {
    return this.append(taskId, "verification.result", payload, options);
  }
  branch(taskId, payload, options) {
    return this.append(taskId, "decision.branch", payload, options);
  }

  async replay(moguTaskId, options = {}) {
    const read = await this.eventStore.read(moguTaskId, options);
    if (read.corruption) {
      const error = new Error(`Cannot replay corrupt decision trace at line ${read.corruption.line}`);
      error.code = "TRACE_CORRUPT";
      throw error;
    }
    const events = read.events.filter((event) => EVENT_SET.has(event.type));
    return {
      events,
      summary: {
        eventCount: events.length,
        firstSequence: events[0]?.sequence || null,
        lastSequence: events.at(-1)?.sequence || null,
        counts: Object.fromEntries(
          EVENT_TYPES.map((type) => [
            type,
            events.reduce((count, event) => count + Number(event.type === type), 0),
          ])
        ),
      },
    };
  }

  async summary(moguTaskId) {
    return (await this.replay(moguTaskId)).summary;
  }
}

module.exports = {
  EVENT_TYPES,
  DecisionTrace,
  boundedSummary,
  deterministicEventId,
};
