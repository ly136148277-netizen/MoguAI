const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { OUTCOMES, REASONS, deepFreeze, reason, blocked, isPlainObject } = require("./contracts");

const METRICS = Object.freeze([
  "requests",
  "inputTokens",
  "outputTokens",
  "tokens",
  "toolCalls",
  "wallTimeMs",
  "estimatedCostUsd",
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function emptyCounters() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokens: 0,
    toolCalls: 0,
    wallTimeMs: 0,
    estimatedCostUsd: 0,
    unknownCostEvents: 0,
  };
}

function publicCounters(counters = emptyCounters()) {
  return deepFreeze({
    requests: counters.requests,
    inputTokens: counters.inputTokens,
    outputTokens: counters.outputTokens,
    tokens: counters.tokens,
    toolCalls: counters.toolCalls,
    wallTimeMs: counters.wallTimeMs,
    estimatedCostUsd: counters.unknownCostEvents > 0 ? null : counters.estimatedCostUsd,
  });
}

function numeric(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeUsage(value = {}) {
  const inputTokens = numeric(value.inputTokens ?? value.input, 0);
  const outputTokens = numeric(value.outputTokens ?? value.output, 0);
  const rawCost = value.estimatedCostUsd ?? value.costUsd;
  const knownCost = typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0;
  return {
    requests: numeric(value.requests ?? value.requestCount, 0),
    inputTokens,
    outputTokens,
    tokens: numeric(value.tokens ?? value.totalTokens, inputTokens + outputTokens),
    toolCalls: numeric(value.toolCalls ?? value.toolCallCount, 0),
    wallTimeMs: numeric(value.wallTimeMs, 0),
    estimatedCostUsd: knownCost ? rawCost : 0,
    unknownCostEvents: knownCost ? 0 : 1,
  };
}

function applyUsage(target, usage, direction = 1) {
  for (const metric of [...METRICS, "unknownCostEvents"]) {
    target[metric] = Math.max(0, numeric(target[metric]) + direction * numeric(usage[metric]));
  }
}

function normalizedLimits(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const result = {};
  const aliases = {
    requests: ["requests", "maxRequests"],
    inputTokens: ["inputTokens", "maxInputTokens"],
    outputTokens: ["outputTokens", "maxOutputTokens"],
    tokens: ["tokens", "maxTokens", "maxTotalTokens"],
    toolCalls: ["toolCalls", "maxToolCalls"],
    wallTimeMs: ["wallTimeMs", "maxWallTimeMs"],
    estimatedCostUsd: ["estimatedCostUsd", "maxEstimatedCostUsd", "maxCostUsd"],
  };
  for (const [metric, names] of Object.entries(aliases)) {
    const found = names.map((name) => source[name]).find((item) => typeof item === "number");
    if (typeof found === "number" && Number.isFinite(found) && found >= 0) result[metric] = found;
  }
  return result;
}

function mergeLimits(base, override) {
  const baseRun = base?.perRun || base?.run || base;
  const overrideRun = override?.perRun || override?.run || override;
  return {
    perRun: { ...normalizedLimits(baseRun), ...normalizedLimits(overrideRun) },
    perDay: { ...normalizedLimits(base?.perDay || base?.day), ...normalizedLimits(override?.perDay || override?.day) },
  };
}

function checkLimits(current, addition, limits, scope) {
  for (const metric of METRICS) {
    const limit = limits[metric];
    if (limit === undefined) continue;
    if (metric === "estimatedCostUsd" && addition.unknownCostEvents > 0) {
      return reason(REASONS.UNKNOWN_PRICE, "Unknown price cannot satisfy a cost-denominated budget", {
        scope,
        metric,
        limit,
      });
    }
    if (numeric(current[metric]) + numeric(addition[metric]) > limit) {
      return reason(REASONS.BUDGET_EXHAUSTED, `${scope} ${metric} budget is exhausted`, {
        scope,
        metric,
        used: numeric(current[metric]),
        requested: numeric(addition[metric]),
        limit,
      });
    }
  }
  return null;
}

function defaultState() {
  return { schemaVersion: 1, runs: {}, days: {}, reservations: {}, events: {} };
}

function validState(state) {
  return (
    isPlainObject(state) &&
    state.schemaVersion === 1 &&
    isPlainObject(state.runs) &&
    isPlainObject(state.days) &&
    isPlainObject(state.reservations) &&
    isPlainObject(state.events)
  );
}

class BudgetLedger {
  constructor(rootOrOptions, fileOrOptions = {}, maybeOptions = {}) {
    const config = isPlainObject(rootOrOptions)
      ? rootOrOptions
      : typeof fileOrOptions === "string"
        ? { ...maybeOptions, root: rootOrOptions, file: fileOrOptions }
        : { ...fileOrOptions, root: rootOrOptions };
    this.root = path.resolve(String(config.root || ""));
    const configuredFile = config.file || config.filePath || "budget-ledger.json";
    this.filePath = path.resolve(this.root, String(configuredFile));
    this.clock = typeof config.clock === "function" ? config.clock : () => new Date();
    this.limits = mergeLimits(config.limits || config, null);
    this.singleProcessOnly = true;
    this.multiProcessSafe = false;
    this._chain = Promise.resolve();
    const relative = path.relative(this.root, this.filePath);
    this._pathError =
      !config.root ||
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
        ? reason(REASONS.PATH_UNSAFE, "Ledger file must be a child of its injected root")
        : null;
  }

  _dayKey() {
    const value = this.clock();
    return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
  }

  _enqueue(operation) {
    const next = this._chain.then(operation, operation);
    this._chain = next.catch(() => {});
    return next;
  }

  async _ensureSafePath() {
    if (this._pathError) return this._pathError;
    await fsp.mkdir(this.root, { recursive: true });
    const canonicalRoot = await fsp.realpath(this.root);
    const parent = path.dirname(this.filePath);
    await fsp.mkdir(parent, { recursive: true });
    const canonicalParent = await fsp.realpath(parent);
    const relative = path.relative(canonicalRoot, canonicalParent);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return reason(REASONS.PATH_UNSAFE, "Ledger parent resolves outside its canonical root");
    }
    try {
      const stat = await fsp.lstat(this.filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return reason(REASONS.PATH_UNSAFE, "Ledger path must be a regular file");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return null;
  }

  async _readState() {
    const pathReason = await this._ensureSafePath();
    if (pathReason) return { blocked: pathReason };
    let text;
    try {
      text = await fsp.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { state: defaultState() };
      throw error;
    }
    try {
      const state = JSON.parse(text);
      if (!validState(state)) throw new Error("invalid ledger schema");
      return { state };
    } catch (error) {
      return {
        blocked: reason(REASONS.LEDGER_CORRUPT, "Budget ledger is corrupt", {
          message: error.message,
        }),
      };
    }
  }

  async _writeState(state) {
    const parent = path.dirname(this.filePath);
    const temporary = path.join(
      parent,
      `.${path.basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    let handle;
    try {
      handle = await fsp.open(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      await handle.writeFile(JSON.stringify(state, null, 2), "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fsp.rename(temporary, this.filePath);
    } finally {
      await handle?.close().catch(() => {});
      await fsp.unlink(temporary).catch(() => {});
    }
  }

  _parseReserveArgs(runOrRequest, eventId, usage, options) {
    if (isPlainObject(runOrRequest)) {
      return {
        runId: runOrRequest.runId,
        eventId: runOrRequest.eventId,
        usage: runOrRequest.usage || runOrRequest.amount || {},
        limits: runOrRequest.limits || {},
      };
    }
    return { runId: runOrRequest, eventId, usage: usage || {}, limits: options?.limits || options || {} };
  }

  async reserve(runOrRequest, eventId, usage, options = {}) {
    const request = this._parseReserveArgs(runOrRequest, eventId, usage, options);
    return this._enqueue(async () => {
      if (!ID_RE.test(String(request.runId || "")) || !ID_RE.test(String(request.eventId || ""))) {
        return blocked("INVALID_EVENT_ID", "Safe runId and idempotency eventId are required");
      }
      const loaded = await this._readState();
      if (loaded.blocked) return deepFreeze({ status: OUTCOMES.BLOCKED, reason: loaded.blocked });
      const { state } = loaded;
      if (state.events[request.eventId]) {
        return deepFreeze({ ...state.events[request.eventId].result, deduped: true });
      }
      const day = this._dayKey();
      const runCounters = state.runs[request.runId] || emptyCounters();
      const dayCounters = state.days[day] || emptyCounters();
      const normalized = normalizeUsage(request.usage);
      const limits = mergeLimits(this.limits, request.limits);
      const runFailure = checkLimits(runCounters, normalized, limits.perRun, "run");
      const dayFailure = checkLimits(dayCounters, normalized, limits.perDay, "day");
      if (runFailure || dayFailure) {
        return deepFreeze({ status: OUTCOMES.BLOCKED, reason: runFailure || dayFailure });
      }
      const reservationId = crypto
        .createHash("sha256")
        .update(`${request.runId}\0${request.eventId}`)
        .digest("hex");
      applyUsage(runCounters, normalized);
      applyUsage(dayCounters, normalized);
      state.runs[request.runId] = runCounters;
      state.days[day] = dayCounters;
      state.reservations[reservationId] = {
        reservationId,
        runId: request.runId,
        day,
        usage: normalized,
        limits,
        status: "reserved",
      };
      const result = {
        status: "RESERVED",
        reservationId,
        runId: request.runId,
        day,
        usage: publicCounters(normalized),
        run: publicCounters(runCounters),
        daily: publicCounters(dayCounters),
        deduped: false,
      };
      state.events[request.eventId] = { operation: "reserve", result };
      await this._writeState(state);
      return deepFreeze(result);
    });
  }

  async commit(reservationOrRequest, eventId, actualUsage) {
    const request = isPlainObject(reservationOrRequest)
      ? {
          ...reservationOrRequest,
          usage: reservationOrRequest.usage ?? reservationOrRequest.actualUsage,
        }
      : { reservationId: reservationOrRequest, eventId, usage: actualUsage };
    return this._settle("commit", request);
  }

  async release(reservationOrRequest, eventId) {
    const request = isPlainObject(reservationOrRequest)
      ? reservationOrRequest
      : { reservationId: reservationOrRequest, eventId };
    return this._settle("release", request);
  }

  async _settle(operation, request) {
    return this._enqueue(async () => {
      if (!ID_RE.test(String(request.eventId || ""))) {
        return blocked("INVALID_EVENT_ID", "An idempotency eventId is required");
      }
      const loaded = await this._readState();
      if (loaded.blocked) return deepFreeze({ status: OUTCOMES.BLOCKED, reason: loaded.blocked });
      const { state } = loaded;
      if (state.events[request.eventId]) {
        return deepFreeze({ ...state.events[request.eventId].result, deduped: true });
      }
      const reservation = state.reservations[request.reservationId];
      if (!reservation || reservation.status !== "reserved") {
        return blocked("RESERVATION_NOT_ACTIVE", "Reservation does not exist or is already settled");
      }
      const runCounters = state.runs[reservation.runId];
      const dayCounters = state.days[reservation.day];
      applyUsage(runCounters, reservation.usage, -1);
      applyUsage(dayCounters, reservation.usage, -1);
      let finalUsage = null;
      if (operation === "commit") {
        finalUsage = request.usage === undefined ? reservation.usage : normalizeUsage(request.usage);
        const effectiveLimits = reservation.limits || this.limits;
        const runFailure = checkLimits(runCounters, finalUsage, effectiveLimits.perRun, "run");
        const dayFailure = checkLimits(dayCounters, finalUsage, effectiveLimits.perDay, "day");
        if (runFailure || dayFailure) {
          applyUsage(runCounters, reservation.usage);
          applyUsage(dayCounters, reservation.usage);
          return deepFreeze({ status: OUTCOMES.BLOCKED, reason: runFailure || dayFailure });
        }
        applyUsage(runCounters, finalUsage);
        applyUsage(dayCounters, finalUsage);
      }
      reservation.status = operation === "commit" ? "committed" : "released";
      reservation.finalUsage = finalUsage;
      const result = {
        status: operation === "commit" ? "COMMITTED" : "RELEASED",
        reservationId: reservation.reservationId,
        runId: reservation.runId,
        run: publicCounters(runCounters),
        daily: publicCounters(dayCounters),
        usage: finalUsage ? publicCounters(finalUsage) : null,
        deduped: false,
      };
      state.events[request.eventId] = { operation, result };
      await this._writeState(state);
      return deepFreeze(result);
    });
  }

  async snapshot(runId) {
    return this._enqueue(async () => {
      const loaded = await this._readState();
      if (loaded.blocked) return deepFreeze({ status: OUTCOMES.BLOCKED, reason: loaded.blocked });
      const day = this._dayKey();
      return deepFreeze({
        status: "OK",
        runId: runId || null,
        day,
        run: publicCounters(loaded.state.runs[runId] || emptyCounters()),
        daily: publicCounters(loaded.state.days[day] || emptyCounters()),
        singleProcessOnly: true,
      });
    });
  }

  getSnapshot(runId) {
    return this.snapshot(runId);
  }
}

module.exports = {
  BudgetLedger,
  normalizeUsage,
  normalizedLimits,
  emptyCounters,
};
