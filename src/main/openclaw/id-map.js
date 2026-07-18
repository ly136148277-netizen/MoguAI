/**
 * In-memory + TaskStore-backed ID mapping helpers.
 * Never guess another job's IDs.
 */

function createEmptyMapping(moguTaskId, source = "openclaw") {
  return {
    moguTaskId: String(moguTaskId),
    source,
    sessionKey: null,
    sessionId: null,
    runId: null,
    taskId: null,
    promptId: null,
  };
}

function applyIds(mapping, patch = {}) {
  const next = { ...mapping };
  for (const key of ["sessionKey", "sessionId", "runId", "taskId", "promptId", "source"]) {
    if (patch[key] != null && patch[key] !== "") {
      next[key] = String(patch[key]);
    }
  }
  return next;
}

/**
 * Resolve cancel target strictly from explicit IDs or a single known mapping.
 * @returns {{ ok: true, mapping } | { ok: false, needsConfirmation: true, reason: string }}
 */
function resolveCancelMapping({ mapping = null, promptId = null, runId = null, taskId = null, sessionKey = null } = {}) {
  if (mapping?.moguTaskId) {
    const hasAny =
      mapping.runId ||
      mapping.taskId ||
      mapping.promptId ||
      mapping.sessionKey ||
      mapping.sessionId;
    if (!hasAny) {
      return {
        ok: false,
        needsConfirmation: true,
        reason: "missing_precise_id",
        message: "任务尚无精确 ID，无法安全取消。",
      };
    }
    return { ok: true, mapping };
  }

  if (promptId || runId || taskId || sessionKey) {
    return {
      ok: true,
      mapping: applyIds(createEmptyMapping("adhoc"), {
        promptId,
        runId,
        taskId,
        sessionKey,
      }),
    };
  }

  return {
    ok: false,
    needsConfirmation: true,
    reason: "missing_precise_id",
    message: "未绑定任务 ID。若继续全局取消，可能影响其他任务。",
  };
}

module.exports = {
  createEmptyMapping,
  applyIds,
  resolveCancelMapping,
};
