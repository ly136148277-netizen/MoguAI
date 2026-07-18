const fs = require("fs-extra");
const { getComfyUiStatus } = require("../../comfyui-bridge");

async function preflight({ deps, args }) {
  const { paiBridge, settings, studioStore } = deps;
  const issues = [];
  const paiOk = await paiBridge.ping(settings);
  if (!paiOk) issues.push({ code: "pai_offline", message: "PAI 服务未运行" });

  const paiRoot = paiBridge.resolvePaiRoot(settings);
  const comfy = await getComfyUiStatus(paiRoot).catch(() => null);
  if (!comfy?.running) issues.push({ code: "comfy_offline", message: "ComfyUI 未运行" });

  const pipeline = studioStore ? await studioStore.load() : {};
  const t2i = args?.t2i_workflow || pipeline.t2iWorkflow || null;
  const i2v = args?.i2v_workflow || pipeline.i2vWorkflow || null;
  if (!t2i && !i2v) {
    issues.push({ code: "workflow_missing", message: "未选择 T2I / I2V 工作流" });
  }

  const photo = args?.photo_path || args?.image || pipeline.photoPath || null;
  if (photo && !(await fs.pathExists(photo))) {
    issues.push({ code: "path_missing", message: `参考图不存在：${photo}` });
  }

  return {
    ok: issues.length === 0,
    issues,
    env: {
      pai: Boolean(paiOk),
      comfyui: Boolean(comfy?.running),
      t2i_workflow: t2i,
      i2v_workflow: i2v,
    },
  };
}

async function run({ deps, args, task }) {
  const check = await preflight({ deps, args });
  if (!check.ok) {
    return { ok: false, error: "预检失败", preflight: check, code: "preflight_failed" };
  }

  const startedAt = Date.now();
  const payload = {
    t2i_workflow: args?.t2i_workflow || check.env.t2i_workflow,
    i2v_workflow: args?.i2v_workflow || check.env.i2v_workflow,
    character: args?.character || "",
    action: args?.action || "",
    size: args?.size || "",
    quality: args?.quality || "",
    duration: args?.duration || "",
    photo_path: args?.photo_path || args?.image || null,
    tool: args?.tool || "none",
    level: args?.level ?? 2,
  };

  const result = await deps.paiBridge.runStudio(deps.settings, payload);
  const elapsedMs = Date.now() - startedAt;
  const outputPaths = result?.path ? [String(result.path)] : [];
  const provenance = {
    workflow: payload.t2i_workflow || payload.i2v_workflow || null,
    params: {
      size: payload.size || null,
      quality: payload.quality || null,
      duration: payload.duration || null,
    },
    elapsedMs,
    moguTaskId: task?.moguTaskId || null,
    promptId: result?.prompt_id || result?.promptId || null,
    modelHint: result?.model || null,
  };

  if (task?.moguTaskId) {
    await deps.taskStore.update(task.moguTaskId, {
      status: result?.ok === false ? "failed" : "succeeded",
      promptId: provenance.promptId,
      outputPaths,
      logTail: JSON.stringify(provenance).slice(0, 3500),
      errorMessage: result?.ok === false ? result?.error || result?.message || "studio failed" : null,
      replay: {
        kind: "skill.mogu.studio.run",
        payload,
      },
    });
  }

  return {
    ok: result?.ok !== false,
    result,
    outputPaths,
    provenance,
    promptId: provenance.promptId,
  };
}

async function retry({ deps, args, task }) {
  const replay = args?.replay || task?.replay?.payload || null;
  if (!replay || typeof replay !== "object") {
    return { ok: false, error: "无同参 replay，无法重试" };
  }
  return run({ deps, args: { ...replay, ...args }, task });
}

module.exports = {
  id: "mogu.studio",
  preflight,
  run,
  retry,
};
