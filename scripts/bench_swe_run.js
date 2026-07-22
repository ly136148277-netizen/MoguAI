#!/usr/bin/env node
/**
 * Run MOGU coding on cached SWE-bench Lite tasks → predictions.jsonl + metrics.
 * For testing accuracy only (public dataset). Does not use gold patches.
 */
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  ROOT,
  BENCH_ROOT,
  parseArgs,
  loadTasks,
  buildAgentPrompt,
  ensureRepoAtCommit,
  collectModelPatch,
  buildSweTestPlan,
  predictionLine,
  resolveSweEvalImage,
} = require("./bench_swe_lib");

async function resolveApiKey(settings = {}) {
  const cloud = String(
    process.env.MOGU_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || ""
  ).trim();
  if (cloud) return cloud;
  if (settings.codingUseOllama || settings.agentApiPreset === "ollama" || process.env.MOGU_USE_OLLAMA === "1") {
    return "ollama";
  }
  return "";
}

function resolveBenchSettings(userDataPath, args) {
  const hasCloudKey = Boolean(
    String(process.env.MOGU_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "").trim()
  );
  const wantOllama =
    Boolean(args.ollama) ||
    process.env.MOGU_USE_OLLAMA === "1" ||
    !hasCloudKey;
  const model =
    args.model ||
    process.env.MOGU_BENCH_MODEL ||
    (wantOllama ? process.env.OLLAMA_MODEL || "qwen3:8b" : process.env.OPENAI_MODEL || "gpt-4o");
  const cloudBase =
    String(process.env.OPENAI_BASE_URL || process.env.MOGU_API_BASE || "").trim() ||
    "https://api.openai.com/v1";
  return {
    userDataPath,
    codingUseOllama: wantOllama,
    codingUnattended: true,
    // Always ignore ~/.codex/config.toml in bench — local proxies (e.g. wecodex) hijack cloud runs.
    codingIgnoreUserConfig: true,
    agentApiPreset: wantOllama ? "ollama" : "openai",
    agentApiBaseUrl: wantOllama ? "http://127.0.0.1:11434/v1" : cloudBase,
    codingModel: model,
    agentApiModel: model,
    codingDefaultEngine: String(args.engine || process.env.MOGU_BENCH_ENGINE || "moguai_a"),
  };
}

async function runOne({ task, workRoot, dryRun, engine, settings, debugPrintEnv = false }) {
  const started = Date.now();
  const scopeMode = process.env.MOGU_SWE_SCOPE_MODE || "warn";
  const repoDir = ensureRepoAtCommit(workRoot, task);
  const testPlan = buildSweTestPlan(task);
  const prompt = buildAgentPrompt(task, {
    slim: Boolean(settings.codingUseOllama),
    testPlan,
  });

  if (debugPrintEnv || process.env.MOGU_BENCH_DEBUG === "1") {
    const fsSync = require("fs");
    let testAssert = "(missing)";
    try {
      const body = fsSync.readFileSync(path.join(repoDir, "tests/test_utils/tests.py"), "utf8");
      const m = /assert(?:Equal|IsNone)\(default_storage\.file_permissions_mode[^)]*\)/.exec(body);
      testAssert = m ? m[0] : "(no assert line)";
    } catch {
      /* non-django or no file */
    }
    let settingsLine = "(n/a)";
    try {
      const gs = fsSync.readFileSync(path.join(repoDir, "django/conf/global_settings.py"), "utf8");
      const m = /^FILE_UPLOAD_PERMISSIONS\s*=\s*.+$/m.exec(gs);
      settingsLine = m ? m[0].trim() : "(no setting)";
    } catch {
      /* n/a */
    }
    const logMsg = [
      `[bench:swe:debug] instance=${task.instance_id}`,
      `  scopeMode=${scopeMode}`,
      `  test_patch_bytes=${Buffer.byteLength(String(task.test_patch || ""), "utf8")}`,
      `  failCmd=${testPlan.failCommand || "(none)"}`,
      `  workspace_test_assert=${testAssert}`,
      `  workspace_FILE_UPLOAD_PERMISSIONS=${settingsLine}`,
      `  find_refs=${process.env.MOGU_FIND_REFS !== "0" ? "on" : "off"}`,
    ].join("\n");
    console.log(logMsg);
  }

  if (dryRun) {
    return {
      prediction: predictionLine({
        instanceId: task.instance_id,
        modelName: "moguai-dry-run",
        patch: "",
      }),
      metric: {
        instance_id: task.instance_id,
        dryRun: true,
        ok: true,
        elapsedMs: Date.now() - started,
        workspace: repoDir,
        note: "dry-run：已 checkout，未调用引擎",
        verifyStages: testPlan.stages.map((s) => s.name),
      },
    };
  }

  const coding = require("../src/main/skills/handlers/coding");
  // Phase-1: official SWE image in-loop verify (real stacks). Set MOGU_SWE_DOCKER_VERIFY=0 to disable.
  const sweDockerOn = process.env.MOGU_SWE_DOCKER_VERIFY !== "0";
  const dockerImage = sweDockerOn ? resolveSweEvalImage(task.instance_id) : "";
  const artifactRoot = String(process.env.MOGU_D2_CYCLE_ARTIFACT_DIR || "").trim();
  const cycleArtifactDir = artifactRoot
    ? path.join(artifactRoot, String(task.instance_id || "instance").replace(/[^\w.-]+/g, "_"))
    : "";
  const feedbackRoot = String(process.env.MOGU_FEEDBACK_PACK_DIR || "").trim();
  const feedbackPackDir = feedbackRoot
    ? path.join(feedbackRoot, String(task.instance_id || "instance").replace(/[^\w.-]+/g, "_"))
    : "";
  const consumeRoot = String(process.env.MOGU_FEEDBACK_CONSUME_DIR || "").trim();
  const feedbackConsumeDir = consumeRoot
    ? path.join(consumeRoot, String(task.instance_id || "instance").replace(/[^\w.-]+/g, "_"))
    : "";
  const epbRoot = String(process.env.MOGU_EVIDENCE_PATCH_BIND_DIR || "").trim();
  const evidencePatchBindDir = epbRoot
    ? path.join(epbRoot, String(task.instance_id || "instance").replace(/[^\w.-]+/g, "_"))
    : "";
  const result = await coding.dispatch({
    deps: {
      settings: {
        ...settings,
        codingWorkspace: repoDir,
        codingDefaultEngine: engine,
      },
      userDataPath: settings.userDataPath,
      getAgentApiKey: async () => resolveApiKey(settings),
    },
    args: {
      workspace: repoDir,
      prompt,
      engine,
      model: settings.codingModel,
      provider: settings.codingUseOllama ? "openai" : undefined,
      // Outer npm-style verify usually N/A; staged FAIL_TO_PASS / PASS_TO_PASS in agent/patch loop.
      autoVerify: false,
      skipVerify: true,
      patchVerifyCommand: testPlan.failCommand || undefined,
      patchVerifyStages: testPlan.stages.length ? testPlan.stages : undefined,
      dockerVerifyImage: dockerImage || undefined,
      dockerVerifyStrict: Boolean(dockerImage),
      dockerVerifySwe: Boolean(dockerImage),
      maxFixRounds: 3,
      maxPatchAttempts: testPlan.stages.length ? 5 : 4,
      maxAgentSteps: Number(process.env.MOGU_CODING_AGENT_STEPS || 24) || 24,
      // SWE: editPlan targets are often wrong (symbol heuristics). Trimming
      // discards correct production fixes (e.g. django global_settings) after
      // in-loop verify already passed → empty official patch. Warn only.
      scopeEnforce: true,
      scopeMode,
      moguTaskId: `swe-${task.instance_id}`.replace(/[^\w.-]+/g, "_").slice(0, 80),
      instanceId: task.instance_id,
      cycleArtifactDir: cycleArtifactDir || undefined,
      feedbackPackDir: feedbackPackDir || undefined,
      feedbackConsumeDir: feedbackConsumeDir || undefined,
      evidencePatchBindDir: evidencePatchBindDir || undefined,
      // Cloud bench: coding agent tool loop (search/read/patch/test). Set MOGU_CODING_AGENT=0 to fall back.
      codingAgent:
        !settings.codingUseOllama && process.env.MOGU_CODING_AGENT !== "0"
          ? true
          : undefined,
      localPatch:
        !settings.codingUseOllama &&
        process.env.MOGU_CLOUD_PATCH !== "0" &&
        process.env.MOGU_CODING_AGENT === "0"
          ? true
          : undefined,
    },
  });

  const patch = collectModelPatch(repoDir);
  return {
    prediction: predictionLine({
      instanceId: task.instance_id,
      modelName: `moguai-${engine}`,
      patch,
    }),
    metric: {
      instance_id: task.instance_id,
      ok: Boolean(result?.ok),
      error: result?.error || null,
      elapsedMs: Date.now() - started,
      fileCount: result?.review?.fileCount ?? null,
      patchBytes: Buffer.byteLength(patch || "", "utf8"),
      scopeLocked: Boolean(result?.scope?.locked),
      scopeTrimmed: result?.scope?.enforcement?.trimmed || [],
      targets: result?.editPlan?.targetPaths || [],
      contentWarning: result?.content?.warning || null,
      locationReason: result?.editPlan?.locationReason || null,
      engineUsed: result?.engine || null,
      focusPaths: result?.focusPaths || null,
      failToPassOk: result?.failToPassOk ?? null,
      passToPassOk: result?.passToPassOk ?? null,
      verifyOk: result?.verifyOk ?? null,
      verifySkipped: result?.verifySkipped ?? null,
      verifyStages: result?.verifyStages || testPlan.stages.map((s) => ({ name: s.name })),
      agentSteps: result?.agentSteps ?? null,
      toolsUsed: result?.toolsUsed || null,
      stackAnchorUsed: result?.stackAnchorUsed ?? null,
      findRefsUsed: result?.findRefsUsed ?? null,
      emptyPatchBoostUsed: result?.emptyPatchBoostUsed ?? null,
      genHintUsed: result?.genHintUsed ?? null,
      d2Retry: result?.d2Retry || null,
      d2Diversity: result?.d2Diversity || null,
      feedbackPack: result?.feedbackPack || null,
      feedbackConsume: result?.feedbackConsume || null,
      evidencePatchBind: result?.evidencePatchBind || null,
      scopeMode,
      dockerVerifyImage: dockerImage || null,
      workspace: repoDir,
    },
  };
}

function writeSummary(runDir, metrics, predictions) {
  const resolvedGuess = metrics.filter((m) => m.ok && m.patchBytes > 0).length;
  const lines = [
    `# SWE-bench Lite run`,
    "",
    `- tasks: ${metrics.length}`,
    `- engine ok: ${metrics.filter((m) => m.ok).length}`,
    `- non-empty patches: ${predictions.filter((p) => p.model_patch).length}`,
    `- (process only; official Resolved %% needs bench:swe:eval)`,
    "",
    "| instance | ok | patch | files | ms |",
    "|---|---|---|---|---|",
    ...metrics.map(
      (m) =>
        `| ${m.instance_id} | ${m.ok} | ${m.patchBytes ?? 0} | ${m.fileCount ?? "-"} | ${m.elapsedMs} |`
    ),
    "",
    `non-empty ok ≈ ${resolvedGuess}/${metrics.length}（非正式分）`,
  ];
  return fs.writeFile(path.join(runDir, "summary.md"), lines.join("\n"), "utf8");
}

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"] || args.dryRun);
  const limit = args.limit != null ? Number(args.limit) : null;
  const engine = String(args.engine || process.env.MOGU_BENCH_ENGINE || "moguai_a");
  const runId = String(args["run-id"] || args.runId || `mogu-${Date.now()}`);
  const workRoot = path.resolve(
    String(args.workdir || process.env.MOGU_BENCH_WORKDIR || path.join(BENCH_ROOT, "work"))
  );
  const userDataPath =
    process.env.MOGU_USER_DATA || path.join(os.homedir(), "AppData", "Roaming", "ai-model-manager");
  const settings = resolveBenchSettings(userDataPath, { ...args, engine, ollama: args.ollama });

  const cached = await loadTasks();
  let tasks = cached.tasks || [];
  const onlyRaw = String(args.only || args.instances || process.env.MOGU_BENCH_ONLY || "").trim();
  if (onlyRaw) {
    const want = new Set(
      onlyRaw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    tasks = tasks.filter((t) => want.has(String(t.instance_id || "")));
  }
  if (limit != null && Number.isFinite(limit)) tasks = tasks.slice(0, Math.max(0, limit));
  if (!tasks.length) throw new Error("缓存里没有题目，先 bench:swe:fetch（或 --only 未命中）");

  const runDir = path.join(BENCH_ROOT, "runs", runId);
  await fs.ensureDir(runDir);
  await fs.ensureDir(workRoot);

  console.log(
    `[bench:swe:run] runId=${runId} engine=${engine} dryRun=${dryRun} tasks=${tasks.length}`
  );
  console.log(
    `[bench:swe:run] llm=${settings.codingUseOllama ? "ollama" : "cloud"} model=${settings.codingModel || "(default)"}`
  );
  console.log(`[bench:swe:run] work=${workRoot}`);
  console.log(`[bench:swe:run] out=${runDir}`);
  const debugPrintEnv =
    Boolean(args["debug-print-env"] || args.debugPrintEnv) || process.env.MOGU_BENCH_DEBUG === "1";
  const scopeMode = process.env.MOGU_SWE_SCOPE_MODE || "warn";
  console.log(
    `[bench:swe:run] scopeMode=${scopeMode} find_refs=${process.env.MOGU_FIND_REFS !== "0" ? "on" : "off"} debug=${debugPrintEnv}`
  );

  const predictions = [];
  const metrics = [];

  const instanceRetries = Math.max(1, Number(process.env.MOGU_BENCH_INSTANCE_RETRIES || 3) || 3);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    console.log(`\n[${i + 1}/${tasks.length}] ${task.instance_id}`);
    let prediction = null;
    let metric = null;
    for (let attempt = 1; attempt <= instanceRetries; attempt += 1) {
      try {
        // Per-run cycle / feedback-pack artifacts root (instance subdir added inside runOne).
        if (!process.env.MOGU_D2_CYCLE_ARTIFACT_DIR) {
          process.env.MOGU_D2_CYCLE_ARTIFACT_DIR = path.join(runDir, "d2_cycles");
        }
        if (!process.env.MOGU_FEEDBACK_PACK_DIR) {
          process.env.MOGU_FEEDBACK_PACK_DIR = path.join(runDir, "feedback_pack");
        }
        if (!process.env.MOGU_FEEDBACK_CONSUME_DIR) {
          process.env.MOGU_FEEDBACK_CONSUME_DIR = path.join(runDir, "feedback_consume");
        }
        if (!process.env.MOGU_EVIDENCE_PATCH_BIND_DIR) {
          process.env.MOGU_EVIDENCE_PATCH_BIND_DIR = path.join(runDir, "evidence_patch_bind");
        }
        ({ prediction, metric } = await runOne({
          task,
          workRoot,
          dryRun,
          engine,
          settings,
          debugPrintEnv,
        }));
        const errText = String(metric?.error || "");
        const transient =
          /HTTP 429|HTTP 502|HTTP 503|HTTP 504|ECONNRESET|ETIMEDOUT|Service temporarily unavailable/i.test(
            errText
          );
        if (transient && attempt < instanceRetries && !(metric?.patchBytes > 0)) {
          console.log(
            `  → relay flake attempt ${attempt}/${instanceRetries}: ${errText.slice(0, 100)}; backoff…`
          );
          await sleep(Math.min(90_000, 8000 * attempt));
          continue;
        }
        break;
      } catch (err) {
        const msg = err.message || String(err);
        const transient = /HTTP 429|HTTP 502|HTTP 503|HTTP 504|ECONNRESET|ETIMEDOUT/i.test(msg);
        if (transient && attempt < instanceRetries) {
          console.log(`  → FAIL flake attempt ${attempt}/${instanceRetries}: ${msg.slice(0, 100)}; backoff…`);
          await sleep(Math.min(90_000, 8000 * attempt));
          continue;
        }
        console.error(`  → FAIL ${msg}`);
        prediction = predictionLine({
          instanceId: task.instance_id,
          modelName: `moguai-${engine}`,
          patch: "",
        });
        metric = {
          instance_id: task.instance_id,
          ok: false,
          error: msg,
          elapsedMs: 0,
          patchBytes: 0,
        };
        break;
      }
    }
    predictions.push(prediction);
    metrics.push(metric);
    console.log(
      `  → ok=${metric.ok} patch=${metric.patchBytes ?? 0}B files=${metric.fileCount ?? "-"} ${metric.note || ""}${
        metric.error ? ` err=${String(metric.error).slice(0, 120)}` : ""
      }`
    );
  }

  const predPath = path.join(runDir, "predictions.jsonl");
  await fs.writeFile(predPath, predictions.map((p) => JSON.stringify(p)).join("\n") + "\n", "utf8");
  await fs.writeJson(path.join(runDir, "metrics.json"), { runId, engine, dryRun, metrics }, { spaces: 2 });
  await writeSummary(runDir, metrics, predictions);

  console.log(`\n[bench:swe:run] done`);
  console.log(`  predictions: ${predPath}`);
  console.log(`  next: npm run bench:swe:eval -- --run-id ${runId}`);
}

main().catch((err) => {
  console.error(`[bench:swe:run] FAIL ${err.message}`);
  process.exit(1);
});
