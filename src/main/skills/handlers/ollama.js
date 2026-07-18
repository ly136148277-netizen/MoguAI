async function preflight({ deps }) {
  const status = await deps.ollama.getStatus();
  const issues = [];
  if (!status?.installed) issues.push({ code: "ollama_missing", message: "未安装 Ollama" });
  else if (!status?.running) issues.push({ code: "ollama_stopped", message: "Ollama 未运行" });
  return {
    ok: issues.length === 0,
    issues,
    env: {
      ollama: Boolean(status?.running),
      installed: Boolean(status?.installed),
      models: Array.isArray(status?.models) ? status.models.length : status?.modelCount || 0,
    },
  };
}

async function status({ deps }) {
  const st = await deps.ollama.getStatus();
  return { ok: true, status: st };
}

async function list({ deps }) {
  const models = await deps.ollama.listModels();
  return { ok: true, models };
}

async function importModel({ deps, args, task }) {
  const filePath = String(args?.path || args?.filePath || args?.ggufPath || "").trim();
  const name = String(args?.name || args?.modelName || args?.id || "").trim();
  if (!filePath) return { ok: false, error: "path 不能为空" };
  if (!name) return { ok: false, error: "name/model id 不能为空" };

  try {
    const result = await deps.ollama.importModel(
      { id: name, name, filename: name },
      filePath,
      args?.modelfilesDir,
      args?.onProgress || null,
      { force: args?.force === true }
    );
    if (task?.moguTaskId) {
      await deps.taskStore.update(task.moguTaskId, {
        status: "succeeded",
        name: `ollama import ${result?.ollamaName || name}`,
      });
    }
    return { ok: true, result };
  } catch (error) {
    if (task?.moguTaskId) {
      await deps.taskStore.update(task.moguTaskId, {
        status: "failed",
        errorMessage: error.message,
      });
    }
    return { ok: false, error: error.message };
  }
}

module.exports = {
  id: "mogu.ollama",
  preflight,
  status,
  list,
  import: importModel,
  run: importModel,
};
