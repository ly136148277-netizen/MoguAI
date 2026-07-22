const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  probeAll,
  runEngine,
  cancelJob,
  summarizeTrajectory,
  buildBrainEnv,
  ENGINE_A,
  ENGINE_B,
  normalizeEngineKey,
} = require("../../moguai/coding");
const { otherEngineKey } = require("../../../shared/moguai-coding");
const {
  collectGitReview,
  suggestCommitMessage,
  commitWorkspace,
  discardWorkspaceChanges,
  acceptWorkspaceChanges,
  runVerify,
  installFixHints,
  isGitRepo,
} = require("../coding-review");
const {
  loadProjectContext,
  enrichPrompt,
  listHunks,
  rejectHunk,
  acceptHunk,
  assessChangeQuality,
  scoreEngineTrial,
  savePatch,
  resetHardClean,
  applyPatchFile,
} = require("../coding-power");
const {
  planChangeScope,
  enforceScope,
  enrichPromptWithScope,
  normalizeScopeMode,
  checkScopeViolation,
  parseAllowPaths,
} = require("../coding-scope");
const {
  planEditAccuracy,
  enrichPromptWithAccuracy,
  assessContentAccuracy,
  buildContentFixPrompt,
} = require("../coding-accuracy");
const { runLocalPatch, shouldUseLocalPatch } = require("../coding-local-patch");
const { runCodingAgentLoop, shouldUseCodingAgent } = require("../coding-agent-loop");

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
  return otherEngineKey(engine);
}

/** Default `npm test` only when package.json has a test script; custom commands always run. */
function hasVerifiableCommand(workspace, command) {
  const cmd = String(command || "").trim();
  if (!cmd) return false;
  if (!/^npm(\s+run)?\s+test\b/i.test(cmd) && cmd !== "npm test") return true;
  try {
    const pkg = fs.readJsonSync(path.join(workspace, "package.json"));
    return Boolean(pkg?.scripts?.test);
  } catch {
    return false;
  }
}

/** Merge app userData so runtime folders land under the install user’s profile. */
function settingsWithUserData(deps = {}) {
  return {
    ...(deps.settings || {}),
    userDataPath: deps.userDataPath || deps.settings?.userDataPath || "",
  };
}

async function status({ deps }) {
  const settings = settingsWithUserData(deps);
  const probed = probeAll(settings);
  const fix = installFixHints(probed.engines);
  return {
    ok: true,
    ...probed,
    defaultEngine: normalizeEngineKey(settings.codingDefaultEngine || ENGINE_A),
    workspace: settings.codingWorkspace || "",
    fixHints: fix.hints,
    copyCommands: fix.copyCommands,
    fixText: fix.fixText,
    canInstallRuntime: Boolean(fix.canInstallRuntime),
    upgradeEngine: fix.upgradeEngine || "all",
    ctaMessage: fix.canInstallRuntime
      ? "编程引擎未就绪，可一键安装适配版"
      : "双引擎探测完成",
  };
}

async function preflight({ deps, args }) {
  const settings = settingsWithUserData(deps);
  const probed = probeAll(settings);
  const engKey = normalizeEngineKey(args?.engine || settings.codingDefaultEngine || ENGINE_A);
  const issues = [];
  if (!probed.engines[engKey]?.installed) {
    const fix = installFixHints({ [engKey]: probed.engines[engKey] });
    issues.push({
      code: "engine_missing",
      message: probed.engines[engKey]?.message || `${engKey} 未就绪`,
      fixCommands: probed.engines[engKey]?.fixCommands || fix.copyCommands,
      fixText: fix.fixText,
      canInstallRuntime: true,
      upgradeEngine: engKey,
    });
  }
  const workspace = resolveWorkspace(settings, args);
  if (args?.requireWorkspace !== false && (args?.prompt || args?.op === "run")) {
    if (!workspace) {
      issues.push({ code: "workspace_missing", message: "未设置工作区（codingWorkspace / args.workspace）" });
    } else if (!(await fs.pathExists(workspace))) {
      issues.push({ code: "workspace_missing", message: `工作区不存在：${workspace}` });
    }
  }
  const missingEngine = issues.some((i) => i.code === "engine_missing");
  return {
    ok: issues.length === 0,
    issues,
    engines: probed.engines,
    workspace,
    engine: engKey,
    canInstallRuntime: missingEngine,
    upgradeEngine: missingEngine ? engKey : null,
    ctaMessage: missingEngine ? "引擎未就绪，可一键安装适配版" : null,
  };
}

async function resolveBrain(deps, settings) {
  let apiKey = "";
  try {
    if (typeof deps.getAgentApiKey === "function") {
      apiKey = String((await deps.getAgentApiKey()) || "").trim();
    }
  } catch {
    apiKey = "";
  }
  return buildBrainEnv(settings, apiKey);
}

async function executeEngineOnce({
  deps,
  settings,
  engine,
  workspace,
  prompt,
  moguTaskId,
  brain,
  model,
  provider,
  jobSuffix = "",
  allowPaths = [],
  patchPrompt = "",
  args = {},
}) {
  const trajDir = path.join(os.tmpdir(), "moguai-coding-traj");
  await fs.ensureDir(trajDir);
  const jobId = `${moguTaskId}${jobSuffix}`;
  const trajectoryFile = engine === ENGINE_B ? path.join(trajDir, `${jobId}.json`) : null;

  let result;
  const useAgent = shouldUseCodingAgent(settings, args);
  if (useAgent) {
    deps.emitProgress?.({
      moguTaskId,
      source: "coding",
      kind: "coding_agent",
      message: "编程工人工具环（搜→读→改→验）",
    });
    const agent = await runCodingAgentLoop({
      workspace,
      // Raw task text — accuracy preamble confuses tool selection.
      prompt: String(patchPrompt || prompt || "").trim(),
      model: model || settings.codingModel || process.env.OLLAMA_MODEL || "gpt-5.6-sol",
      // Do not hard-lock discovery; outer scope trim still applies after.
      allowPaths: args.lockAgentPaths ? allowPaths : [],
      timeoutMs: Number(args.timeoutMs || settings.codingTimeoutMs || 480_000),
      maxSteps: Number(args.maxAgentSteps || process.env.MOGU_CODING_AGENT_STEPS || 24) || 24,
      verifyCommand: String(args.patchVerifyCommand || "").trim(),
      verifyStages: Array.isArray(args.patchVerifyStages) ? args.patchVerifyStages : undefined,
      dockerImage: String(args.dockerVerifyImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim(),
      dockerStrict:
        args.dockerVerifyStrict === true ||
        process.env.MOGU_DOCKER_VERIFY_STRICT === "1" ||
        process.env.MOGU_SWE_DOCKER_VERIFY === "1",
      dockerSwe:
        args.dockerVerifySwe === true ||
        process.env.MOGU_VERIFY_DOCKER_SWE === "1" ||
        /sweb\.eval\./i.test(String(args.dockerVerifyImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "")),
      baseUrl: settings.agentApiBaseUrl || process.env.OPENAI_BASE_URL || "",
      apiKey: brain?.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "",
      instanceId: String(args.instanceId || args.instance_id || "").trim(),
      structuredRetry:
        args.structuredRetry === true ||
        args.structuredRetry === false
          ? Boolean(args.structuredRetry)
          : undefined,
      structuredRetryMaxCycles:
        args.structuredRetryMaxCycles != null
          ? Number(args.structuredRetryMaxCycles)
          : undefined,
      hypothesisDiversity:
        args.hypothesisDiversity === true ||
        args.hypothesisDiversity === false
          ? Boolean(args.hypothesisDiversity)
          : undefined,
      diversityJaccardMax:
        args.diversityJaccardMax != null
          ? Number(args.diversityJaccardMax)
          : undefined,
      cycleArtifactDir: String(args.cycleArtifactDir || "").trim() || undefined,
      feedbackPack:
        args.feedbackPack === true || args.feedbackPack === false
          ? Boolean(args.feedbackPack)
          : undefined,
      feedbackPackDir: String(args.feedbackPackDir || "").trim() || undefined,
      feedbackConsume:
        args.feedbackConsume === true || args.feedbackConsume === false
          ? Boolean(args.feedbackConsume)
          : undefined,
      feedbackConsumeDir: String(args.feedbackConsumeDir || "").trim() || undefined,
      evidencePatchBind:
        args.evidencePatchBind === true || args.evidencePatchBind === false
          ? Boolean(args.evidencePatchBind)
          : undefined,
      evidencePatchBindDir: String(args.evidencePatchBindDir || "").trim() || undefined,
    });
    result = {
      ...agent,
      trajectoryFile: null,
      engine: agent.engine || "coding_agent",
    };
    if (deps.taskStore?.update && moguTaskId) {
      await deps.taskStore.update(moguTaskId, {
        logSummary: String(agent.log || agent.error || "").slice(-4000),
      });
    }
  } else if (shouldUseLocalPatch(settings, args)) {
    deps.emitProgress?.({
      moguTaskId,
      source: "coding",
      kind: "coding_local_patch",
      message: "直出补丁模式（本地/云端 OpenAI 兼容）",
    });
    const local = await runLocalPatch({
      workspace,
      // Prefer raw task text — accuracy preamble confuses small local models.
      prompt: String(patchPrompt || prompt || "").trim(),
      model: model || settings.codingModel || process.env.OLLAMA_MODEL || "qwen3:8b",
      allowPaths,
      timeoutMs: Number(args.timeoutMs || settings.codingTimeoutMs || 300_000),
      maxAttempts: Number(args.maxPatchAttempts || args.maxFixRounds || 0) || undefined,
      verifyCommand: String(args.patchVerifyCommand || "").trim(),
      verifyStages: Array.isArray(args.patchVerifyStages) ? args.patchVerifyStages : undefined,
      dockerImage: String(args.dockerVerifyImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "").trim(),
      dockerStrict:
        args.dockerVerifyStrict === true ||
        process.env.MOGU_DOCKER_VERIFY_STRICT === "1" ||
        process.env.MOGU_SWE_DOCKER_VERIFY === "1",
      dockerSwe:
        args.dockerVerifySwe === true ||
        process.env.MOGU_VERIFY_DOCKER_SWE === "1" ||
        /sweb\.eval\./i.test(String(args.dockerVerifyImage || process.env.MOGU_VERIFY_DOCKER_IMAGE || "")),
      baseUrl: settings.agentApiBaseUrl || process.env.OPENAI_BASE_URL || "",
      apiKey: brain?.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "",
    });
    result = {
      ...local,
      trajectoryFile: null,
      engine: local.engine || "local_ollama_patch",
    };
    if (deps.taskStore?.update && moguTaskId) {
      await deps.taskStore.update(moguTaskId, {
        logSummary: String(local.log || local.error || "").slice(-4000),
      });
    }
  } else {
    result = await runEngine({
      engine,
      settings,
      workspace,
      prompt,
      model,
      provider,
      sandbox: settings.codingSandbox || undefined,
      trajectoryFile,
      jobId,
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
          /* ignore */
        }
      },
    });
  }

  let trajectorySummary = null;
  if (result.trajectoryFile) {
    const traj = await summarizeTrajectory(result.trajectoryFile);
    if (traj.ok) trajectorySummary = traj.summary;
  }
  const review = collectGitReview(workspace, {
    log: result.log || "",
    trajectorySummary: trajectorySummary || "",
  });
  return { result, review, trajectorySummary, trajectoryFile: result.trajectoryFile };
}

async function run({ deps, args, task }) {
  const settings = settingsWithUserData(deps);
  const engine = normalizeEngineKey(args?.engine || settings.codingDefaultEngine || ENGINE_A);
  const workspace = resolveWorkspace(settings, args);
  const prompt = String(args?.prompt || args?.text || args?.message || "").trim();
  if (!prompt) return { ok: false, error: "缺少 prompt", code: "prompt_empty" };
  if (!workspace) return { ok: false, error: "缺少工作区", code: "workspace_missing" };

  // Dual-engine compare mode
  if (args?.compare === true || args?.mode === "compare") {
    return compare({ deps, args: { ...args, prompt, workspace }, task });
  }

  const pf = await preflight({ deps, args: { ...args, prompt, workspace, engine } });
  if (!pf.ok) {
    const fixText = pf.issues.map((i) => i.fixText || i.message).filter(Boolean).join("\n\n");
    return {
      ok: false,
      code: pf.canInstallRuntime ? "engine_missing" : "preflight_failed",
      error: pf.ctaMessage || pf.issues.map((i) => i.message).join("; "),
      issues: pf.issues,
      fixText,
      copyCommands: pf.issues.flatMap((i) => i.fixCommands || []),
      canInstallRuntime: Boolean(pf.canInstallRuntime),
      upgradeEngine: pf.upgradeEngine || engine,
      ctaMessage: pf.ctaMessage,
      workspace,
      engine,
    };
  }

  const moguTaskId = task?.moguTaskId || args?.moguTaskId || `coding-${Date.now()}`;
  const project = await loadProjectContext(workspace);
  const scopeMode = normalizeScopeMode(args?.scopeMode, {
    enforce: args?.scopeEnforce !== false && args?.lockScope !== false,
  });
  const explicitPaths = parseAllowPaths(args?.allowPaths || args?.scopePaths || args?.paths);
  const editPlan = planEditAccuracy(workspace, prompt, {
    allowPaths: explicitPaths,
  });
  const scope = planChangeScope(workspace, prompt, {
    allowPaths: explicitPaths.length
      ? explicitPaths
      : editPlan.targetPaths.length
        ? editPlan.targetPaths
        : undefined,
  });
  // Prefer accuracy confidence when we supplied inferred targets
  if (!explicitPaths.length && editPlan.targetPaths.length) {
    scope.source = "accuracy";
    scope.confidence = editPlan.locationConfidence;
    scope.locked = editPlan.locked && scopeMode !== "off";
    scope.reason = editPlan.locationReason;
  }
  const scopeForPrompt =
    scopeMode === "off"
      ? { ...scope, locked: false }
      : scopeMode === "warn"
        ? { ...scope, locked: false, allowedPaths: scope.allowedPaths }
        : scope;
  let taskPrompt = enrichPromptWithScope(
    enrichPromptWithAccuracy(prompt, editPlan),
    scopeForPrompt
  );
  let effectivePrompt = enrichPrompt(taskPrompt, project);
  let scopeEnforcement = null;
  let contentAssessment = null;
  let contentFixUsed = false;

  if (deps.taskStore && moguTaskId) {
    await deps.taskStore.update?.(moguTaskId, {
      status: "running",
      requestText: prompt.slice(0, 2000),
      logSummary: [
        `[${engine}] 启动于 ${workspace}`,
        `规则：${(project.sources || []).join(", ") || "无"}`,
        editPlan.locationReason || scope.reason,
        scope.locked
          ? `锁定：${scope.allowedPaths.slice(0, 12).join(", ")}`
          : "",
        "",
      ]
        .filter(Boolean)
        .join("\n"),
      name: `MOGU AI 编程:${engine}`,
    });
  }

  const brain = await resolveBrain(deps, settings);
  const model = args?.model || settings.codingModel || settings.agentApiModel || undefined;
  const provider = args?.provider || settings.codingProvider || brain.providerHint || undefined;

  const verifyCommand =
    String(args?.verifyCommand || args?.command || settings.codingVerifyCommand || "").trim() ||
    "npm test";
  const wantAutoVerify = args?.autoVerify !== false && args?.skipVerify !== true;
  const autoVerify = wantAutoVerify && hasVerifiableCommand(workspace, verifyCommand);
  const maxFixRounds = Math.min(4, Math.max(0, Number(args?.maxFixRounds ?? 2)));
  const rounds = [];
  let last = null;

  for (let round = 0; round <= maxFixRounds; round += 1) {
    deps.emitProgress?.({
      moguTaskId,
      source: "coding",
      kind: "coding_round",
      round,
      message:
        round === 0
          ? "派工执行中"
          : contentFixUsed && !autoVerify
            ? `内容纠偏第 ${round} 轮`
            : `自动再修第 ${round} 轮`,
    });
    last = await executeEngineOnce({
      deps,
      settings,
      engine,
      workspace,
      prompt: effectivePrompt,
      patchPrompt: prompt,
      moguTaskId,
      brain,
      model,
      provider,
      jobSuffix: round ? `-r${round}` : "",
      allowPaths: scope.allowedPaths || editPlan.targetPaths || [],
      args,
    });

    if (scope.locked && scopeMode !== "off") {
      scopeEnforcement = enforceScope(workspace, last.review, scope, { mode: scopeMode });
      if (scopeEnforcement.enforced) {
        last.review = scopeEnforcement.review || last.review;
      }
    } else if (scope.allowedPaths?.length && scopeMode === "warn") {
      scopeEnforcement = checkScopeViolation(last.review, { ...scope, locked: true });
    }

    contentAssessment = assessContentAccuracy(last.review, prompt, editPlan);
    const quality = assessChangeQuality(last.review, prompt);
    if (contentAssessment.warning) {
      quality.flags = [...(quality.flags || []), ...contentAssessment.flags];
      quality.warning = [quality.warning, contentAssessment.warning].filter(Boolean).join("；");
      quality.ok = quality.flags.length === 0;
    }

    let verify = null;
    if (autoVerify) {
      verify = runVerify(workspace, verifyCommand);
    }
    rounds.push({
      round,
      engine,
      ok: last.result.ok,
      verifyOk: verify ? verify.ok : null,
      quality,
      contentOk: contentAssessment.ok,
      fileCount: last.review?.fileCount || 0,
      scopeTrimmed: scopeEnforcement?.trimmed?.length || 0,
      error: last.result.error || null,
    });

    const verifyFailed = autoVerify && verify && !verify.ok;
    const contentFailed = contentAssessment.needsContentFix && !contentFixUsed;
    if (!verifyFailed && !contentFailed) break;
    if (round >= maxFixRounds) break;

    if (contentFailed) {
      contentFixUsed = true;
      taskPrompt = enrichPromptWithScope(
        enrichPromptWithAccuracy(buildContentFixPrompt(prompt, contentAssessment, editPlan), editPlan),
        scopeForPrompt
      );
      effectivePrompt = enrichPrompt(taskPrompt, project);
      continue;
    }

    const failLog = String(verify?.log || verify?.error || "").slice(-2500);
    taskPrompt = enrichPromptWithScope(
      enrichPromptWithAccuracy(
        [
          prompt,
          "",
          "【自动再修】上轮改动后验证失败，请最小改动修复，不要扩大范围。",
          `验证命令：${verify?.command || "npm test"}`,
          failLog ? `失败输出：\n${failLog}` : "",
          scopeEnforcement?.trimmed?.length
            ? `说明：上轮越界文件已被回滚：${scopeEnforcement.trimmed.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        editPlan
      ),
      scopeForPrompt
    );
    effectivePrompt = enrichPrompt(taskPrompt, project);
  }

  let review = last.review;
  if (scope.locked && scopeMode !== "off" && scopeMode !== "warn") {
    scopeEnforcement = enforceScope(workspace, review, scope, { mode: scopeMode });
    if (scopeEnforcement.enforced) review = scopeEnforcement.review || review;
  }

  const result = last.result;
  contentAssessment = assessContentAccuracy(review, prompt, editPlan);
  const quality = assessChangeQuality(review, prompt);
  if (contentAssessment?.warning) {
    quality.flags = [...(quality.flags || []), ...contentAssessment.flags];
    quality.warning = [quality.warning, contentAssessment.warning].filter(Boolean).join("；");
    quality.ok = quality.flags.length === 0;
  }
  const hunks = listHunks(workspace);
  const suggestedCommitMessage = suggestCommitMessage({
    prompt,
    files: review.files || [],
  });
  const lastVerify = rounds.length ? rounds[rounds.length - 1] : null;
  const verifyOk = lastVerify?.verifyOk;
  const scopeBlocked =
    scopeMode === "strict" &&
    scope.locked &&
    scopeEnforcement?.violation &&
    !(scopeEnforcement.trimmed || []).length;
  const landed = (review?.fileCount || 0) > 0;
  const ok =
    Boolean(result.ok) &&
    landed &&
    (autoVerify ? verifyOk === true || verifyOk == null : true) &&
    !scopeBlocked;

  const scopeHint = scopeEnforcement?.message || editPlan.locationReason || scope.reason;
  if (deps.taskStore && moguTaskId) {
    const reviewSummary = String(review?.summary || "").slice(0, 800);
    const changedPaths = (review?.files || [])
      .map((f) => (typeof f === "string" ? f : f?.path))
      .filter(Boolean)
      .slice(0, 40);
    await deps.taskStore.update(moguTaskId, {
      status: ok ? "succeeded" : "failed",
      errorMessage:
        result.error ||
        (verifyOk === false ? "验证未通过" : null) ||
        (scopeBlocked ? "存在未清除的越界改动" : null),
      logSummary: [
        reviewSummary,
        quality.warning ? `质量：${quality.warning}` : "",
        scopeHint ? `定位：${scopeHint}` : "",
        contentAssessment?.warning ? `内容：${contentAssessment.warning}` : "",
        `轮次：${rounds.length} 验证：${verifyOk === true ? "通过" : verifyOk === false ? "失败" : "跳过"}`,
        changedPaths.length ? `改动：${changedPaths.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000),
      outputPaths: result.trajectoryFile ? [result.trajectoryFile] : [],
      replay: {
        kind: "skill.mogu.coding.run",
        payload: {
          engine,
          workspace,
          prompt: prompt.slice(0, 2000),
          suggestedCommitMessage,
          reviewSummary,
          changedFiles: changedPaths,
          fileCount: review?.fileCount || changedPaths.length,
          rounds: rounds.length,
          verifyOk,
          targets: editPlan.targetPaths,
          scope: {
            locked: scope.locked,
            allowedPaths: scope.allowedPaths,
            trimmed: scopeEnforcement?.trimmed || [],
          },
        },
      },
    });
  }

  return {
    ok,
    provenance: true,
    engine: result.engine || engine,
    workspace,
    command: result.command,
    log: result.log,
    focusPaths: result.focusPaths || null,
    mode: result.mode || null,
    trajectoryFile: result.trajectoryFile,
    trajectorySummary: last.trajectorySummary,
    review,
    suggestedCommitMessage,
    canCommit: Boolean(review?.canCommit),
    error: ok
      ? null
      : result.error ||
        (verifyOk === false ? "验证未通过，见 rounds / 可再派工" : null) ||
        (scopeBlocked ? scopeEnforcement?.message || "越界改动未清除" : null),
    code: result.code || (scopeBlocked ? "scope_violation" : undefined),
    altEngine: otherEngine(engine),
    moguTaskId,
    canRetryOtherEngine: !ok,
    canContinue: !ok,
    hint: !ok
      ? "可再派工、换引擎，或打开精密工厂按 hunk 接受/拒绝后继续。"
      : scopeEnforcement?.trimmed?.length
        ? `已完成；${scopeEnforcement.message}`
        : contentAssessment?.warning
          ? `已完成，但内容需留意：${contentAssessment.warning}`
          : quality.warning
            ? `已完成，但请注意：${quality.warning}`
            : null,
    brainKeyInjected: brain.hasKey,
    projectRules: project.sources || [],
    quality,
    content: contentAssessment,
    editPlan: {
      targets: editPlan.targets,
      targetPaths: editPlan.targetPaths,
      mustTouch: editPlan.mustTouch,
      locationConfidence: editPlan.locationConfidence,
      locationReason: editPlan.locationReason,
      indexStats: editPlan.indexStats,
    },
    rounds,
    autoVerify,
    verifyOk:
      result.verifyOk != null
        ? Boolean(result.verifyOk)
        : verifyOk === true
          ? true
          : verifyOk === false
            ? false
            : null,
    failToPassOk: result.failToPassOk ?? null,
    passToPassOk: result.passToPassOk ?? null,
    verifySkipped: result.verifySkipped ?? null,
    verifyStages: result.verifyStages || null,
    agentSteps: result.agentSteps ?? null,
    toolsUsed: result.toolsUsed || null,
    stackAnchorUsed: result.stackAnchorUsed ?? null,
    findRefsUsed: result.findRefsUsed ?? null,
    emptyPatchBoostUsed: result.emptyPatchBoostUsed ?? null,
    genHintUsed: result.genHintUsed ?? null,
    d2Retry: result.d2Retry || null,
    d2Diversity: result.d2Diversity || null,
    feedbackPack: result.feedbackPack || null,
    feedbackConsume: result.feedbackConsume || null,
    evidencePatchBind: result.evidencePatchBind || null,
    hunks: hunks.ok ? hunks.hunks : [],
    hunkCount: hunks.count || 0,
    scope: {
      ...scope,
      mode: scopeMode,
      enforcement: scopeEnforcement
        ? {
            violation: Boolean(scopeEnforcement.violation),
            outOfScope: scopeEnforcement.outOfScope || [],
            inScope: scopeEnforcement.inScope || [],
            trimmed: scopeEnforcement.trimmed || [],
            message: scopeEnforcement.message || null,
          }
        : null,
    },
  };
}

/**
 * Convey-only entry: Cursor / factory / tasks call this with { workspace, prompt }.
 * Unattended defaults — MOGU owns edit → verify → fix rounds.
 */
async function dispatch({ deps, args, task }) {
  const settings = settingsWithUserData(deps);
  const cloudPatch =
    process.env.MOGU_CLOUD_PATCH === "1" ||
    (Boolean(String(settings.agentApiBaseUrl || process.env.OPENAI_BASE_URL || "").trim()) &&
      !/11434/.test(String(settings.agentApiBaseUrl || process.env.OPENAI_BASE_URL || "")) &&
      Boolean(
        String(process.env.OPENAI_API_KEY || process.env.MOGU_API_KEY || "").trim() ||
          settings.agentApiKey
      ));
  const merged = {
    ...args,
    autoVerify: args?.autoVerify !== false && args?.skipVerify !== true,
    skipVerify: args?.skipVerify === true,
    maxFixRounds: Math.min(4, Math.max(1, Number(args?.maxFixRounds ?? 3))),
    maxPatchAttempts: Number(args?.maxPatchAttempts || args?.maxFixRounds || 4),
    scopeEnforce: args?.scopeEnforce !== false && args?.lockScope !== false,
    scopeMode: args?.scopeMode || "trim",
    // Cloud unattended: prefer coding agent tool loop over one-shot patch.
    codingAgent:
      args?.codingAgent === false
        ? false
        : args?.codingAgent === true || cloudPatch || process.env.MOGU_CODING_AGENT === "1" || undefined,
    localPatch: args?.localPatch === false ? false : args?.localPatch === true || cloudPatch || undefined,
  };
  const result = await run({ deps, args: merged, task });
  const files = (result.review?.files || [])
    .map((f) => (typeof f === "string" ? f : f?.path))
    .filter(Boolean);
  return {
    ...result,
    op: "dispatch",
    files,
    diffSummary: String(result.review?.summary || "").slice(0, 2000),
    unattended: true,
  };
}

async function compare({ deps, args, task }) {
  const settings = settingsWithUserData(deps);
  const workspace = resolveWorkspace(settings, args);
  const prompt = String(args?.prompt || args?.text || "").trim();
  if (!prompt) return { ok: false, error: "缺少 prompt", code: "prompt_empty" };
  if (!workspace) return { ok: false, error: "缺少工作区", code: "workspace_missing" };
  if (!isGitRepo(workspace)) {
    return { ok: false, error: "双引擎对比需要 Git 工作区", code: "not_a_git_repo" };
  }

  const probed = probeAll(settings);
  if (!probed.engines[ENGINE_A]?.installed || !probed.engines[ENGINE_B]?.installed) {
    return {
      ok: false,
      code: "engine_missing",
      canInstallRuntime: true,
      upgradeEngine: "all",
      error: "双引擎对比需要 A/B 均已安装",
      ctaMessage: "请先安装双引擎适配版",
    };
  }

  const dirty = collectGitReview(workspace);
  if (dirty.fileCount > 0) {
    return {
      ok: false,
      code: "workspace_dirty",
      error: "工作区有未提交改动。请先提交/拒绝干净后再双引擎对比，以免互相覆盖。",
      review: dirty,
    };
  }

  const moguTaskId = task?.moguTaskId || args?.moguTaskId || `coding-compare-${Date.now()}`;
  const project = await loadProjectContext(workspace);
  const scopeMode = normalizeScopeMode(args?.scopeMode, {
    enforce: args?.scopeEnforce !== false && args?.lockScope !== false,
  });
  const explicitPaths = parseAllowPaths(args?.allowPaths || args?.scopePaths || args?.paths);
  const editPlan = planEditAccuracy(workspace, prompt, { allowPaths: explicitPaths });
  const scope = planChangeScope(workspace, prompt, {
    allowPaths: explicitPaths.length
      ? explicitPaths
      : editPlan.targetPaths.length
        ? editPlan.targetPaths
        : undefined,
  });
  if (!explicitPaths.length && editPlan.targetPaths.length) {
    scope.source = "accuracy";
    scope.confidence = editPlan.locationConfidence;
    scope.locked = editPlan.locked && scopeMode !== "off";
    scope.reason = editPlan.locationReason;
  }
  const scopeForPrompt =
    scopeMode === "off"
      ? { ...scope, locked: false }
      : scopeMode === "warn"
        ? { ...scope, locked: false }
        : scope;
  const effectivePrompt = enrichPrompt(
    enrichPromptWithScope(enrichPromptWithAccuracy(prompt, editPlan), scopeForPrompt),
    project
  );
  const brain = await resolveBrain(deps, settings);
  const model = args?.model || settings.codingModel || settings.agentApiModel || undefined;
  const provider = args?.provider || settings.codingProvider || brain.providerHint || undefined;
  const verifyCmd =
    String(args?.verifyCommand || args?.command || settings.codingVerifyCommand || "").trim() ||
    "npm test";
  const doVerify =
    args?.autoVerify !== false &&
    args?.skipVerify !== true &&
    hasVerifiableCommand(workspace, verifyCmd);

  if (deps.taskStore) {
    await deps.taskStore.update?.(moguTaskId, {
      status: "running",
      name: "MOGU AI 编程:双引擎对比",
      requestText: prompt.slice(0, 2000),
      logSummary: "双引擎对比开始…\n",
    });
  }

  const trials = {};
  for (const eng of [ENGINE_A, ENGINE_B]) {
    deps.emitProgress?.({
      moguTaskId,
      source: "coding",
      kind: "coding_compare",
      engine: eng,
      message: `对比：运行 ${eng}`,
    });
    resetHardClean(workspace);
    const executed = await executeEngineOnce({
      deps,
      settings,
      engine: eng,
      workspace,
      prompt: effectivePrompt,
      patchPrompt: prompt,
      moguTaskId,
      brain,
      model,
      provider: eng === ENGINE_B ? provider : undefined,
      jobSuffix: `-${eng}`,
      allowPaths: scope.allowedPaths || editPlan.targetPaths || [],
      args,
    });
    let review = executed.review;
    let scopeEnforcement = null;
    if (scope.locked && scopeMode !== "off" && scopeMode !== "warn") {
      scopeEnforcement = enforceScope(workspace, review, scope, { mode: scopeMode });
      if (scopeEnforcement.enforced) review = scopeEnforcement.review || review;
    }
    const patch = savePatch(workspace, eng);
    const verify = doVerify ? runVerify(workspace, verifyCmd) : null;
    const content = assessContentAccuracy(review, prompt, editPlan);
    const quality = assessChangeQuality(review, prompt);
    let score = scoreEngineTrial({ verify, review, quality });
    if (scopeEnforcement?.trimmed?.length) score -= scopeEnforcement.trimmed.length * 8;
    if (scopeEnforcement?.violation && scopeMode === "warn") score -= 15;
    if (content.needsContentFix) score -= 25;
    else if (content.ok) score += 10;
    trials[eng] = {
      engine: eng,
      ok: executed.result.ok,
      score,
      review,
      verify,
      quality,
      content,
      patchPath: patch.patchPath,
      hasDiff: patch.hasDiff,
      error: executed.result.error,
      log: String(executed.result.log || "").slice(-2000),
      scopeTrimmed: scopeEnforcement?.trimmed || [],
    };
  }

  resetHardClean(workspace);
  const scoreA = trials[ENGINE_A].score;
  const scoreB = trials[ENGINE_B].score;
  let winner = scoreA >= scoreB ? ENGINE_A : ENGINE_B;
  if (scoreA === scoreB) {
    winner = (trials[ENGINE_A].review?.fileCount || 99) <= (trials[ENGINE_B].review?.fileCount || 99)
      ? ENGINE_A
      : ENGINE_B;
  }
  const applied = applyPatchFile(workspace, trials[winner].patchPath);
  let finalReview = collectGitReview(workspace);
  let finalScope = null;
  if (applied.ok && scope.locked && scopeMode !== "off" && scopeMode !== "warn") {
    finalScope = enforceScope(workspace, finalReview, scope, { mode: scopeMode });
    if (finalScope.enforced) finalReview = finalScope.review || finalReview;
  }
  const suggestedCommitMessage = suggestCommitMessage({
    prompt,
    files: finalReview.files || [],
  });

  if (deps.taskStore) {
    await deps.taskStore.update(moguTaskId, {
      status: applied.ok ? "succeeded" : "failed",
      logSummary: `对比完成 胜者=${winner} A=${scoreA} B=${scoreB}\n${finalReview.summary || ""}`.slice(0, 4000),
      replay: {
        kind: "skill.mogu.coding.compare",
        payload: { prompt: prompt.slice(0, 2000), workspace, winner, scoreA, scoreB, scope: scope.allowedPaths },
      },
    });
  }

  return {
    ok: applied.ok,
    provenance: true,
    mode: "compare",
    workspace,
    moguTaskId,
    winner,
    scores: { [ENGINE_A]: scoreA, [ENGINE_B]: scoreB },
    trials: {
      [ENGINE_A]: {
        score: scoreA,
        verifyOk: trials[ENGINE_A].verify?.ok ?? null,
        fileCount: trials[ENGINE_A].review?.fileCount || 0,
        quality: trials[ENGINE_A].quality,
        error: trials[ENGINE_A].error,
        scopeTrimmed: trials[ENGINE_A].scopeTrimmed,
      },
      [ENGINE_B]: {
        score: scoreB,
        verifyOk: trials[ENGINE_B].verify?.ok ?? null,
        fileCount: trials[ENGINE_B].review?.fileCount || 0,
        quality: trials[ENGINE_B].quality,
        error: trials[ENGINE_B].error,
        scopeTrimmed: trials[ENGINE_B].scopeTrimmed,
      },
    },
    review: finalReview,
    suggestedCommitMessage,
    canCommit: Boolean(finalReview.canCommit),
    hunks: listHunks(workspace).hunks || [],
    projectRules: project.sources || [],
    scope: {
      ...scope,
      mode: scopeMode,
      enforcement: finalScope
        ? {
            violation: Boolean(finalScope.violation),
            trimmed: finalScope.trimmed || [],
            outOfScope: finalScope.outOfScope || [],
            message: finalScope.message || null,
          }
        : null,
    },
    editPlan: {
      targets: editPlan.targets,
      targetPaths: editPlan.targetPaths,
      mustTouch: editPlan.mustTouch,
      locationConfidence: editPlan.locationConfidence,
      locationReason: editPlan.locationReason,
    },
    content: assessContentAccuracy(finalReview, prompt, editPlan),
    error: applied.ok ? null : applied.error,
    hint: [
      `已应用胜者 ${winner === ENGINE_A ? "引擎A" : "引擎B"} 的改动。`,
      finalScope?.trimmed?.length ? finalScope.message : "可按 hunk 继续微调。",
    ]
      .filter(Boolean)
      .join(" "),
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
  const failedEngine = normalizeEngineKey(args?.engine || args?.fromEngine || ENGINE_A);
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

async function discard({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const paths = Array.isArray(args?.paths)
    ? args.paths
    : args?.path
      ? [args.path]
      : [];
  return {
    ...discardWorkspaceChanges(workspace, { paths }),
    provenance: true,
    workspace,
  };
}

async function accept({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const paths = Array.isArray(args?.paths)
    ? args.paths
    : args?.path
      ? [args.path]
      : [];
  return {
    ...acceptWorkspaceChanges(workspace, { paths }),
    provenance: true,
    workspace,
  };
}

async function hunks({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  return { ...listHunks(workspace), provenance: true, workspace };
}

async function rejectHunkOp({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const id = args?.hunkId || args?.id || args?.hunk;
  if (id == null || id === "") return { ok: false, error: "缺少 hunkId" };
  return { ...rejectHunk(workspace, id), provenance: true, workspace };
}

async function acceptHunkOp({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const id = args?.hunkId || args?.id || args?.hunk;
  if (id == null || id === "") return { ok: false, error: "缺少 hunkId" };
  return { ...acceptHunk(workspace, id), provenance: true, workspace };
}

async function projectContext({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const ctx = await loadProjectContext(workspace);
  return { ...ctx, workspace, provenance: true };
}

async function planScope({ deps, args }) {
  const workspace = resolveWorkspace(deps.settings, args);
  const prompt = String(args?.prompt || args?.text || "").trim();
  if (!workspace) return { ok: false, error: "缺少工作区", code: "workspace_missing" };
  const explicitPaths = parseAllowPaths(args?.allowPaths || args?.scopePaths || args?.paths);
  const editPlan = planEditAccuracy(workspace, prompt, { allowPaths: explicitPaths });
  const scope = planChangeScope(workspace, prompt, {
    allowPaths: explicitPaths.length
      ? explicitPaths
      : editPlan.targetPaths.length
        ? editPlan.targetPaths
        : undefined,
  });
  return {
    ok: true,
    provenance: true,
    workspace,
    prompt: prompt.slice(0, 500),
    ...scope,
    editPlan: {
      targets: editPlan.targets,
      targetPaths: editPlan.targetPaths,
      mustTouch: editPlan.mustTouch,
      locationConfidence: editPlan.locationConfidence,
      locationReason: editPlan.locationReason,
      indexStats: editPlan.indexStats,
      seeds: editPlan.seeds,
    },
    mode: normalizeScopeMode(args?.scopeMode, {
      enforce: args?.scopeEnforce !== false,
    }),
  };
}

module.exports = {
  id: "mogu.coding",
  status,
  preflight,
  run,
  dispatch,
  compare,
  cancel,
  retry,
  trajectory,
  review,
  commit,
  discard,
  accept,
  hunks,
  rejectHunk: rejectHunkOp,
  acceptHunk: acceptHunkOp,
  projectContext,
  planScope,
  verify,
  resolveWorkspace,
  otherEngine,
  ENGINE_A,
  ENGINE_B,
};
