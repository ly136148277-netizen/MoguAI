const { getComfyUiStatus, cancelComfyUiJob, getProgressSnapshot } = require("../../comfyui-bridge");

async function preflight({ deps }) {
  const { paiBridge, settings } = deps;
  const paiRoot = paiBridge.resolvePaiRoot(settings);
  const paiOk = await paiBridge.ping(settings);
  const comfy = await getComfyUiStatus(paiRoot).catch(() => null);
  const issues = [];
  if (!paiOk) issues.push({ code: "pai_offline", message: "PAI 服务未运行" });
  if (!comfy?.running) issues.push({ code: "comfy_offline", message: "ComfyUI 未运行或未配置" });
  return {
    ok: issues.length === 0,
    issues,
    env: {
      pai: Boolean(paiOk),
      comfyui: Boolean(comfy?.running),
      comfyPath: comfy?.path || null,
      comfyVersion: comfy?.version || null,
    },
  };
}

async function list({ deps }) {
  const catalog = await deps.paiBridge.fetchCatalog(deps.settings);
  return { ok: true, catalog };
}

async function status({ deps, args }) {
  const paiRoot = deps.paiBridge.resolvePaiRoot(deps.settings);
  const snap = await getProgressSnapshot(paiRoot, {
    promptId: args?.promptId || null,
    startedAt: args?.startedAt || Date.now(),
  });
  return { ok: true, ...snap };
}

async function run({ deps, args, gate, task }) {
  const command = String(args?.command || "").trim();
  if (!command) {
    return { ok: false, error: "command 不能为空（例如：列出工作流 / 确认出片 …）" };
  }
  const level = Math.max(Number(args?.level) || 2, gate?.requiredLevel || 2);
  const result = await deps.paiBridge.run(deps.settings, gate?.confirmedCommand || command, level);
  const promptId = result?.prompt_id || result?.promptId || args?.promptId || null;
  if (task?.moguTaskId && promptId) {
    await deps.taskStore.update(task.moguTaskId, { promptId, status: result?.ok === false ? "failed" : "running" });
  }
  return {
    ok: result?.ok !== false,
    result,
    promptId,
    outputPaths: result?.path ? [result.path] : [],
  };
}

async function cancel({ deps, args, task }) {
  const promptId = args?.promptId || task?.promptId || null;
  if (!promptId) {
    return {
      ok: false,
      needsConfirmation: true,
      error: "缺少 prompt_id，无法精确取消（禁止猜测全局清队列）",
    };
  }
  const paiRoot = deps.paiBridge.resolvePaiRoot(deps.settings);
  const outcome = await cancelComfyUiJob({ paiRoot, promptId });
  return {
    ok: outcome?.ok === true,
    ...outcome,
    promptId,
  };
}

module.exports = {
  id: "mogu.comfy",
  preflight,
  list,
  status,
  run,
  cancel,
};
