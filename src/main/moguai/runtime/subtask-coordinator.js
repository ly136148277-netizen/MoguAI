const crypto = require("node:crypto");

const FORBIDDEN_CAPABILITIES = new Set(["write", "commit", "push", "install"]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeSubtask(input, index) {
  const subtask = input && typeof input === "object" ? input : {};
  const capabilities = [...new Set((subtask.capabilities || ["read", "search"]).map((item) => String(item).toLowerCase()))];
  const forbidden = capabilities.find((capability) => FORBIDDEN_CAPABILITIES.has(capability));
  if (forbidden) throw codedError("read_only", `Forbidden exploration capability: ${forbidden}`);
  return {
    id: String(subtask.id || `subtask-${index + 1}`).slice(0, 100),
    description: String(subtask.description || "").slice(0, 2_000),
    payload: subtask.payload == null ? {} : subtask.payload,
    capabilities,
  };
}

class SubtaskCoordinator {
  constructor(options = {}) {
    if (!options.worktreeManager) throw new TypeError("worktreeManager is required");
    if (!options.eventStore) throw new TypeError("eventStore is required");
    if (typeof options.executor !== "function") throw new TypeError("executor is required");
    this.worktreeManager = options.worktreeManager;
    this.eventStore = options.eventStore;
    this.executor = options.executor;
    this.maxParallel = Math.max(1, Math.min(2, Number(options.maxParallel) || 2));
  }

  async _checkpoint(taskId, type, payload, eventId) {
    return this.eventStore.append(taskId, {
      type,
      source: "subtask-coordinator",
      payload,
      eventId: eventId || crypto.randomUUID(),
    });
  }

  _validate(subtasks) {
    if (!Array.isArray(subtasks) || !subtasks.length) {
      throw codedError("subtasks_required", "At least one exploration subtask is required");
    }
    if (subtasks.length > this.maxParallel) {
      throw codedError("parallel_limit", `At most ${this.maxParallel} exploration subtasks are allowed`);
    }
    const normalized = subtasks.map(sanitizeSubtask);
    if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
      throw codedError("duplicate_subtask", "Exploration subtask IDs must be unique");
    }
    return normalized;
  }

  async join(moguTaskId, subtasks, options = {}) {
    const normalized = this._validate(subtasks);
    const joinId = String(options.joinId || crypto.randomUUID());
    await this._checkpoint(moguTaskId, "subtasks.join.checkpoint", {
      joinId,
      subtasks: normalized,
      maxParallel: this.maxParallel,
    }, `${joinId}:join`);

    const results = await Promise.all(normalized.map(async (subtask) => {
      let worktree = null;
      try {
        worktree = await this.worktreeManager.add({ permission: options.permission || {} });
        for (const capability of subtask.capabilities) this.worktreeManager.assertCapability(capability);
        await this._checkpoint(moguTaskId, "subtask.started", {
          joinId,
          subtask,
          worktreeId: worktree.id,
        }, `${joinId}:${subtask.id}:started`);
        const value = await this.executor({
          moguTaskId,
          joinId,
          subtask,
          worktree,
          readOnly: true,
        });
        await this._checkpoint(moguTaskId, "subtask.completed", {
          joinId,
          subtaskId: subtask.id,
          ok: value?.ok !== false,
          result: value,
        }, `${joinId}:${subtask.id}:completed`);
        return { id: subtask.id, ok: value?.ok !== false, result: value };
      } catch (error) {
        await this._checkpoint(moguTaskId, "subtask.failed", {
          joinId,
          subtaskId: subtask.id,
          code: error.code || "subtask_failed",
          message: error.message,
        }, `${joinId}:${subtask.id}:failed`);
        return { id: subtask.id, ok: false, error: error.message, code: error.code || "subtask_failed" };
      } finally {
        if (worktree) await this.worktreeManager.remove(worktree.id, { permission: options.permission || {} });
      }
    }));

    await this._checkpoint(moguTaskId, "subtasks.joined", {
      joinId,
      ok: results.every((result) => result.ok),
      results,
    }, `${joinId}:joined`);
    return { ok: results.every((result) => result.ok), joinId, results };
  }

  async recover(moguTaskId, options = {}) {
    const read = await this.eventStore.read(moguTaskId);
    if (read.corruption) throw codedError("event_log_corrupt", "Cannot recover subtasks from corrupt event log");
    const joins = new Map();
    for (const event of read.events) {
      const joinId = event.payload?.joinId;
      if (!joinId) continue;
      if (event.type === "subtasks.join.checkpoint") {
        joins.set(joinId, { joinId, subtasks: event.payload.subtasks || [], joined: false });
      } else if (event.type === "subtasks.joined" && joins.has(joinId)) {
        joins.get(joinId).joined = true;
      }
    }
    const pending = [...joins.values()].filter((join) => !join.joined);
    if (options.resume !== true) return { ok: true, pending };
    const resumed = [];
    for (const join of pending) {
      resumed.push(await this.join(moguTaskId, join.subtasks, {
        ...options,
        joinId: join.joinId,
      }));
    }
    return { ok: true, pending, resumed };
  }
}

module.exports = { SubtaskCoordinator, FORBIDDEN_CAPABILITIES, sanitizeSubtask };
