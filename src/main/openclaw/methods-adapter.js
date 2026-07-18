/**
 * Resolve OpenClaw Gateway RPC method names from hello-ok.features.methods.
 * Never hard-pick sessions.send vs chat.send without probing.
 */

const METHOD_CANDIDATES = Object.freeze({
  sessionCreate: ["sessions.create"],
  sessionSend: ["sessions.send", "chat.send"],
  sessionAbort: ["sessions.abort", "chat.abort"],
  sessionList: ["sessions.list", "chat.sessions.list"],
  taskCancel: ["tasks.cancel"],
  taskGet: ["tasks.get"],
  taskList: ["tasks.list"],
  sessionsSubscribe: ["sessions.subscribe"],
  messagesSubscribe: ["sessions.messages.subscribe"],
});

/**
 * @param {string[]|Set<string>|null} availableMethods
 * @returns {{
 *   available: string[],
 *   resolved: Record<string, string|null>,
 *   missing: string[],
 *   canAgentRun: boolean,
 *   canAbort: boolean,
 * }}
 */
function adaptMethods(availableMethods) {
  const available = [...(availableMethods instanceof Set ? availableMethods : availableMethods || [])]
    .map(String)
    .filter(Boolean);
  const set = new Set(available);
  const resolved = {};
  const missing = [];

  for (const [logical, candidates] of Object.entries(METHOD_CANDIDATES)) {
    const hit = candidates.find((name) => set.has(name)) || null;
    resolved[logical] = hit;
    if (!hit) missing.push(logical);
  }

  const canAgentRun = Boolean(resolved.sessionCreate && resolved.sessionSend);
  const canAbort = Boolean(resolved.sessionAbort || resolved.taskCancel);

  return {
    available,
    resolved,
    missing,
    canAgentRun,
    canAbort,
  };
}

function requireMethod(adapter, logicalName) {
  const method = adapter?.resolved?.[logicalName];
  if (!method) {
    const err = new Error(
      `当前 Gateway 未提供 ${logicalName}（已探测 methods，无可用候选：${(METHOD_CANDIDATES[logicalName] || []).join(" / ")}）`
    );
    err.code = "method_unavailable";
    err.logicalName = logicalName;
    throw err;
  }
  return method;
}

module.exports = {
  METHOD_CANDIDATES,
  adaptMethods,
  requireMethod,
};
