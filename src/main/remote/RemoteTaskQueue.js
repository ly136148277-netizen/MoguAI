"use strict";

const { EventEmitter } = require("node:events");
const { createTaskResult, makeId } = require("./RemoteTypes");

/**
 * Remote-facing TaskQueue facade.
 * Persists via existing TaskStore and executes via injected runner.
 * Does not replace or rewrite TaskStore schema.
 */
class RemoteTaskQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.taskStore = options.taskStore || null;
    this.execute =
      typeof options.execute === "function"
        ? options.execute
        : async () => ({ ok: false, error: "no_executor" });
    this.cancelHook =
      typeof options.cancelHook === "function" ? options.cancelHook : async () => ({ ok: false });
    this._tokens = new Map();
    this._progress = new Map();
    this._inflight = new Map();
  }

  async enqueue(taskRequest, auth = {}) {
    if (!auth?.allowed) {
      return {
        ok: false,
        status: "blocked",
        reason: auth?.reason || "permission_denied",
      };
    }
    if (!this.taskStore?.create) {
      return { ok: false, status: "blocked", reason: "no_task_store" };
    }

    const cancellationToken = {
      id: makeId("rcancel"),
      aborted: false,
      reason: null,
      abort(reason = "cancelled") {
        this.aborted = true;
        this.reason = reason;
      },
    };

    const task = await this.taskStore.create({
      source: "unknown",
      kind: "remote",
      executor: `remote:${taskRequest.channel}`,
      name: String(taskRequest.text || "remote-task").slice(0, 200),
      status: "queued",
      channel: `remote:${taskRequest.channel}`,
      sessionKey: taskRequest.sessionId || null,
      progress: 0,
      replay: {
        skillId: taskRequest.skillId,
        op: taskRequest.op,
        payload: {
          text: taskRequest.text,
          args: taskRequest.args,
          remoteRequestId: taskRequest.requestId,
          capability: taskRequest.capability,
          userId: taskRequest.userId,
          conversationId: taskRequest.conversationId,
        },
      },
    });

    this._tokens.set(task.moguTaskId, cancellationToken);
    this._progress.set(task.moguTaskId, {
      moguTaskId: task.moguTaskId,
      phase: "queued",
      percent: 0,
      skillId: taskRequest.skillId,
      startedAt: Date.now(),
      elapsedMs: 0,
    });
    this.emit("queued", { task, taskRequest });

    const done = this._run(task, taskRequest, cancellationToken);
    this._inflight.set(task.moguTaskId, done);
    done.finally(() => {
      this._inflight.delete(task.moguTaskId);
      this._tokens.delete(task.moguTaskId);
    });

    return { ok: true, task, done, taskRequest };
  }

  async _run(task, taskRequest, cancellationToken) {
    await this.taskStore.update(task.moguTaskId, { status: "running", progress: 5 });
    this._setProgress(task.moguTaskId, { phase: "running", percent: 5, skillId: taskRequest.skillId });
    try {
      if (cancellationToken.aborted) {
        throw Object.assign(new Error("cancelled"), { code: "cancelled" });
      }
      const execResult = await this.execute(taskRequest, {
        moguTaskId: task.moguTaskId,
        cancellationToken,
        setProgress: (patch) => this._setProgress(task.moguTaskId, patch),
      });
      if (cancellationToken.aborted) {
        throw Object.assign(new Error("cancelled"), { code: "cancelled" });
      }
      const ok = execResult?.ok !== false && !execResult?.error;
      const result = createTaskResult({
        moguTaskId: task.moguTaskId,
        status: ok ? "succeeded" : "failed",
        kind: execResult?.kind || "markdown",
        markdown: execResult?.markdown || execResult?.text || (ok ? "OK" : execResult?.error || "failed"),
        artifacts: execResult?.artifacts || [],
        error: ok ? null : execResult?.error || "failed",
        progress: this.getProgress(task.moguTaskId),
      });
      await this.taskStore.update(task.moguTaskId, {
        status: result.status,
        progress: ok ? 100 : this.getProgress(task.moguTaskId)?.percent || 0,
        error: result.error,
        outputs: result.artifacts.map((item) => item.path || item.url || item.name).filter(Boolean),
      });
      this._setProgress(task.moguTaskId, {
        phase: result.status,
        percent: ok ? 100 : this.getProgress(task.moguTaskId)?.percent || 0,
      });
      this.emit("finished", { task, result });
      return { ok, task, result };
    } catch (error) {
      const cancelled = error?.code === "cancelled" || cancellationToken.aborted;
      if (cancelled) {
        await this.cancelHook({ moguTaskId: task.moguTaskId, taskRequest, cancellationToken }).catch(
          () => ({})
        );
        await this.taskStore.update(task.moguTaskId, {
          status: "cancelled",
          error: cancellationToken.reason || "cancelled",
        });
        const result = createTaskResult({
          moguTaskId: task.moguTaskId,
          status: "cancelled",
          kind: "status",
          markdown: "Task cancelled",
          error: "cancelled",
        });
        this.emit("cancelled", { task, result });
        return { ok: false, task, result, cancelled: true };
      }
      await this.taskStore.update(task.moguTaskId, {
        status: "failed",
        error: String(error.message || error).slice(0, 2000),
      });
      const result = createTaskResult({
        moguTaskId: task.moguTaskId,
        status: "failed",
        kind: "error",
        markdown: String(error.message || error),
        error: String(error.message || error),
      });
      this.emit("finished", { task, result });
      return { ok: false, task, result };
    }
  }

  async cancel(moguTaskId, reason = "cancel") {
    const token = this._tokens.get(String(moguTaskId || ""));
    if (token) token.abort(reason);
    if (this.taskStore?.update) {
      const existing = await this.taskStore.get(moguTaskId).catch(() => null);
      if (existing && !["succeeded", "failed", "cancelled", "timed_out"].includes(existing.status)) {
        await this.taskStore.update(moguTaskId, { status: "cancelled", error: reason });
      }
    }
    await this.cancelHook({ moguTaskId, reason, cancellationToken: token }).catch(() => ({}));
    const inflight = this._inflight.get(String(moguTaskId || ""));
    if (inflight) await inflight.catch(() => ({}));
    return { ok: true, moguTaskId, reason };
  }

  _setProgress(moguTaskId, patch = {}) {
    const prev = this._progress.get(moguTaskId) || {
      moguTaskId,
      phase: "unknown",
      percent: 0,
      skillId: null,
      startedAt: Date.now(),
      elapsedMs: 0,
    };
    const next = {
      ...prev,
      ...patch,
      percent: Math.max(0, Math.min(100, Number(patch.percent ?? prev.percent) || 0)),
      elapsedMs: Date.now() - (prev.startedAt || Date.now()),
    };
    this._progress.set(moguTaskId, next);
    this.emit("progress", next);
    return next;
  }

  getProgress(moguTaskId) {
    const value = this._progress.get(String(moguTaskId || ""));
    if (!value) return null;
    return {
      ...value,
      elapsedMs: Date.now() - (value.startedAt || Date.now()),
      bar: progressBar(value.percent),
    };
  }
}

function progressBar(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round(p / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${p}%`;
}

module.exports = { RemoteTaskQueue, progressBar };
