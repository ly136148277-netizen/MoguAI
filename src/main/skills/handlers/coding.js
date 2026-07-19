const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  probeAll,
  runEngine,
  cancelJob,
  summarizeTrajectory,
  buildBrainEnv,
} = require("../coding-engines");
const {
  collectGitReview,
  suggestCommitMessage,
  commitWorkspace,
  runVerify,
  installFixHints,
} = require("../coding-review");

function resolveWorkspace(settings, args = {}) {
  const ws =
    args.workspace ||
    args.cwd ||
    args.workingDir ||
    settings.codingWorkspace ||
    "";
  return String(ws || "").trim();
}

function otherEngine(engine) {
  const e = String(engine || "").toLowerCase();
  return e === "trae" || e === "trae-agent" ? "codex" : "trae";
}

async function status({ deps }) {
  const probed = probeAll(deps.settings || {});
  const fix = installFixHints(probed.engines);
  return {
    ok: true,
    ...probed,
    defaultEngine: deps.settings?.codingDefaultEngine || "codex",
    workspace: deps.settings?.codingWorkspace || "",
    fixHints: fix.hints,
    copyCommands: fix.copyCommands,
    fixText: fix.fixText,
  };
}

async function preflight({ deps, args }) {
  const probed = probeAll(deps.settings || {});
  const engine = String(args?.engine || deps.settings?.codingDefaultEngine || "codex").toLowerCase();
  const engKey = engine === "trae" || engine === "trae-agent" ? "trae" : "codex";
  const issues = [];
  if (!probed.engines[engKey]?.installed) {
    const fix = installFixHints({ [engKey]: probed.engines[engKey] });
    issues.push({
      code: "engine_missing",
      message: probed.engines[engKey]?.message || `${engKey} 未就绪`,
      fixCommands: probed.engines[engKey]?.fixCommands || fix.copyCommands,
      fixText: fix.fixText,
    });
  }
  const workspace = resolveWorkspace(deps.settings, args);
  if (args?.requireWorkspace !== false && (args?.prompt || args?.op === "run")) {
    if (!workspace) {
      issues.push({ code: "workspace_missing", message: "未设置工作区（codingWorkspace / args.workspace）" });
    } else if (!(await fs.pathExists(workspace))) {
      issues.push({ code: "workspace_missing", message: `工作区不存在：${workspace}` });
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    engines: probed.engines,
    workspace,
    engine: engKey,
  };
}

async function run({ deps, args, task }) {
  const settings = deps.settings || {};
  const engine = String(args?.engine || settings.codingDefaultEngine || "codex").toLowerCase();
  const workspace = resolveWorkspace(settings, args);
  const prompt = String(args?.prompt || args?.text || args?.message || "").trim();
  if (!prompt) return { ok: false, error: "缺少 prompt", code: "prompt_empty" };
  if (!workspace) return { ok: false, error: "缺少工作区", code: "workspace_missing" };

  const pf = await preflight({ deps, args: { ...args, prompt, workspace, engine } });
  if (!pf.ok) {
    const fixText = pf.issues.map((i) => i.fixText || i.message).filter(Boolean).join("\n\n");
    return {
      ok: false,
      code: "preflight_failed",
      error: pf.issues.map((i) => i.message).join("; "),
      issues: pf.issues,
      fixText,
      copyCommands: pf.issues.flatMap((i) => i.fixCommands || []),
    };
  }

  const moguTaskId = task?.moguTaskId || args?.moguTaskId || `coding-${Date.now()}`;
  const trajDir = path.join(os.tmpdir(), "mogu-coding-traj");
  await fs.ensureDir(trajDir);
  const trajectoryFile =
    engine === "trae" || engine === "trae-agent"
      ? path.join(trajDir, `${moguTaskId}.json`)
      : null;

  if (deps.taskStore && moguTaskId) {
    await deps.taskStore.update?.(moguTaskId, {
      status: "running",
      requestText: prompt.slice(0, 2000),
      logSummary: `[${engine}] 启动于 ${workspace}\n`,
      name: `编程:${engine}`,
    });
  }

  let apiKey = "";
  try {
    if (typeof deps.getAgentApiKey === "function") {
      apiKey = String((await deps.getAgentApiKey()) || "").trim();
    }
  } catch {
    apiKey = "";
  }
  const brain = buildBrainEnv(settings, apiKey);
  const model =
    args?.model || settings.codingModel || settings.agentApiModel || undefined;
  const provider =
    args?.provider ||
    settings.codingProvider ||
    brain.providerHint ||
    undefined;

  const result = await runEngine({
    engine,
    settings,
    workspace,
    prompt,
    model,
    provider,
    sandbox: args?.sandbox || settings.codingSandbox || undefined,
    trajectoryFile,
    jobId: moguTaskId,
    env: brain.env,
    onChunk: async ({ log }) => {
      if (!deps.taskStore?.update || !moguTaskId) return;
      try {
        await deps.taskStore.update(moguTaskId, {
          logSummary: log.slice(-4000),
          progress: null,
        });
        deps.emitProgress?.({
          moguTaskId,
          source: "coding",
          kind: "coding_delta",
          logSummary: log.slice(-800),
        });
      } catch {
        /* ignore stream update errors */
      }
    },
  });

  let trajectorySummary = null;
  if (result.trajectoryFile) {
    const traj = await summarizeTrajectory(result.trajectoryFile);
    if (traj.ok) trajectorySummary = traj.summary;
  }

  const review = collectGitReview(workspace, {
    log: result.log || "",
    trajectorySummary: trajectorySummary || "",
  });
  const suggestedCommitMessage = suggestCommitMessage({
    prompt,
    files: review.files || [],
  });

  if (deps.taskStore && moguTaskId) {
    await deps.taskStore.update(moguTaskId, {
      status: result.ok ? "succeeded" : "failed",
      errorMessage: result.error || null,
      logSummary: (result.log || "").slice(-4000),
      outputPaths: result.trajectoryFile ? [result.trajectoryFile] : [],
      replay: {
        kind: "skill.mogu.coding.run",
        payload: {
          engine,
          workspace,
          prompt: prompt.slice(0, 2000),
          suggestedCommitMessage,
        },
      },
    });
  }

  return {
    ok: result.ok,
    provenance: true,
    engine: result.engine || engine,
    workspace,
    command: result.command,
    log: result.log,
    trajectoryFile: result.trajectoryFile,
    trajectorySummary,
    review,
    suggestedCommitMessage,
    canCommit: Boolean(review?.canCommit),
    error: result.error,
    code: result.code,
    altEngine: otherEngine(engine),
    moguTaskId,
    canRetryOtherEngine: !result.ok,
    brainKeyInjected: brain.hasKey,
  };
}

async function cancel({ deps, args, task }) {
  const id = args?.moguTaskId || args?.jobId || task?.moguTaskId;
  if (!id) return { ok: false, error: "缺少 moguTaskId", needsConfirmation: true };
  const cancelled = cancelJob(id);
  if (deps.taskStore && id && cancelled.ok) {
    await deps.taskStore.update(id, {
      status: "cancelled",
      errorMessage: "用户取消编程任务",
    });
  }
  return { ...cancelled, provenance: true, moguTaskId: id };
}

async function retry({ deps, args, task }) {
  const failedEngine = String(args?.engine || args?.fromEngine || "").toLowerCase();
  const next = args?.toEngine || otherEngine(failedEngine || deps.settings?.codingDefaultEngine);
  return run({
    deps,
    args: {
      ...args,
      engine: next,
      prompt: args?.prompt || args?.text || task?.requestText || "",
      workspace: resolveWorkspace(deps.settings, args),
    },
    task,
  });
}

async function trajectory({ args }) {
  const file = args?.trajectoryFile || args?.path;
  const traj = await summarizeTrajectory(file);
  return { ok: traj.ok, summary: traj.summary, stepCount: traj.stepCount, error: traj.error };
}

async function review({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  if (!workspace) return { ok: false, error: "缺少工作区", code: "workspace_missing" };
  const payload = collectGitReview(workspace, {
    log: args?.log || "",
    trajectorySummary: args?.trajectorySummary || "",
  });
  return {
    ...payload,
    suggestedCommitMessage: suggestCommitMessage({
      prompt: args?.prompt || "",
      files: payload.files || [],
    }),
  };
}

async function commit({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const message =
    String(args?.message || args?.commitMessage || "").trim() ||
    suggestCommitMessage({ prompt: args?.prompt || "", files: [] });
  const result = commitWorkspace(workspace, message, { addAll: args?.addAll !== false });
  return { ...result, provenance: true };
}

async function verify({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const command =
    String(args?.command || args?.cmd || deps.settings?.codingVerifyCommand || "").trim() ||
    "npm test";
  return runVerify(workspace, command);
}

module.exports = {
  id: "mogu.coding",
  status,
  preflight,
  run,
  cancel,
  retry,
  trajectory,
  review,
  commit,
  verify,
  resolveWorkspace,
  otherEngine,
};
