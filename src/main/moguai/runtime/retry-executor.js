const crypto = require("node:crypto");

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class RetryExecutor {
  constructor(options = {}) {
    if (!options.taskStore) throw new TypeError("taskStore is required");
    if (typeof options.executor !== "function") throw new TypeError("executor is required");
    if (typeof options.permissionCheck !== "function") throw new TypeError("permissionCheck is required");
    this.taskStore = options.taskStore;
    this.eventStore = options.eventStore || null;
    this.executor = options.executor;
    this.permissionCheck = options.permissionCheck;
    this.sleep = typeof options.sleep === "function" ? options.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this.maxAttempts = Math.max(1, Math.min(10, Number(options.maxAttempts) || 3));
    this.baseBackoffMs = Math.max(0, Math.min(60_000, Number(options.baseBackoffMs) || 250));
  }

  async _record(taskId, type, payload, eventId) {
    if (!this.eventStore) return null;
    const appended = await this.eventStore.append(taskId, {
      eventId: eventId || crypto.randomUUID(),
      type,
      source: "retry",
      payload,
    });
    await this.taskStore.update(taskId, {
      runtimeEventRef: appended.ref,
      runtimeEventSummary: {
        eventCount: appended.ref.eventCount,
        lastSequence: appended.ref.lastSequence,
        lastType: appended.ref.lastType,
        updatedAt: appended.ref.updatedAt,
      },
    });
    return appended.event;
  }

  async execute(moguTaskId, options = {}) {
    const parent = await this.taskStore.get(moguTaskId);
    if (!parent) return { ok: false, reason: "not_found" };
    if (!["failed", "cancelled", "timed_out", "succeeded"].includes(parent.status)) {
      return { ok: false, reason: "not_terminal" };
    }
    if (!parent.replay) return { ok: false, reason: "missing_replay" };
    if (parent.requestAcceptedByGateway || parent.acceptance === "accepted" || /^openclaw[._]/.test(parent.replay.kind)) {
      return { ok: false, reason: "gateway_accepted_no_resubmit" };
    }
    const idempotencyKey = String(options.idempotencyKey || `${parent.moguTaskId}:retry:${parent.retryCount + 1}`);
    const child = await this.taskStore.retry(parent.moguTaskId, { idempotencyKey });
    if (!child) return { ok: false, reason: "not_retryable" };
    if (child.status !== "queued") {
      return { ok: child.status === "succeeded", deduped: true, task: child };
    }

    const permission = await this.permissionCheck({
      parent,
      task: child,
      replay: child.replay,
      runId: child.moguTaskId,
      idempotencyKey,
    });
    if (!(permission === true || permission?.allowed === true)) {
      await this._record(child.moguTaskId, "retry.permission_denied", {
        reason: permission?.reason || "permission_denied",
      }, `${idempotencyKey}:permission-denied`);
      const denied = await this.taskStore.update(child.moguTaskId, {
        status: "failed",
        errorCode: "permission_denied",
        errorMessage: permission?.message || "Retry permission denied",
      });
      return { ok: false, reason: "permission_denied", task: denied };
    }

    await this.taskStore.update(child.moguTaskId, { status: "running" });
    let lastError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      // The durable checkpoint is written before every executor call (the side-effect boundary).
      await this._record(child.moguTaskId, "retry.checkpoint", {
        attempt,
        maxAttempts: this.maxAttempts,
        idempotencyKey,
        replayKind: child.replay.kind,
      }, `${idempotencyKey}:checkpoint:${attempt}`);
      try {
        const result = await this.executor({
          replay: child.replay,
          parent,
          task: child,
          attempt,
          idempotencyKey,
          permission,
        });
        if (result?.ok === false) {
          throw codedError(result.code || "executor_failed", result.error || result.message || "Retry executor failed");
        }
        await this._record(child.moguTaskId, "retry.succeeded", { attempt }, `${idempotencyKey}:succeeded`);
        const completed = await this.taskStore.update(child.moguTaskId, {
          status: "succeeded",
          outputPaths: result?.outputPaths || [],
          logSummary: result?.summary || result?.message || "",
        });
        return { ok: true, task: completed, result, attempts: attempt };
      } catch (error) {
        lastError = error;
        await this._record(child.moguTaskId, "retry.attempt_failed", {
          attempt,
          code: error.code || "executor_failed",
          message: error.message,
        }, `${idempotencyKey}:failed:${attempt}`);
        if (attempt < this.maxAttempts) {
          await this.sleep(this.baseBackoffMs * 2 ** (attempt - 1));
        }
      }
    }
    const failed = await this.taskStore.update(child.moguTaskId, {
      status: "failed",
      errorCode: lastError?.code || "retry_attempts_exhausted",
      errorMessage: lastError?.message || "Retry attempts exhausted",
    });
    return { ok: false, reason: "attempts_exhausted", task: failed, attempts: this.maxAttempts };
  }
}

module.exports = { RetryExecutor };
