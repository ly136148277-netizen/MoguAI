#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { classifyTask } = require("../src/main/moguai/neural/task-classifier");
const { ModelRouter } = require("../src/main/moguai/neural/model-router");
const { ModelRegistry } = require("../src/main/moguai/neural/model-registry");
const { BudgetLedger } = require("../src/main/moguai/neural/budget-ledger");
const { assembleContext } = require("../src/main/moguai/neural/context-budget");
const { createToolChain } = require("../src/main/moguai/neural/tool-chain");
const { DecisionTrace } = require("../src/main/moguai/neural/decision-trace");
const { ClosedLoopExecutor } = require("../src/main/moguai/neural/closed-loop");
const { NeuralPlanner } = require("../src/main/moguai/neural/planner");
const { RunEventStore } = require("../src/main/moguai/runtime/run-event-store");
const { createEvaluationConfigHash } = require("../src/main/brain/openai-compatible-adapter");

const ROOT = path.join(__dirname, "..");
const RESULT_ROOT = path.join(ROOT, "benchmarks", "v2.2", "results");

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeReport(name, value) {
  fs.mkdirSync(RESULT_ROOT, { recursive: true });
  const file = path.join(RESULT_ROOT, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function profile(id, overrides = {}) {
  return {
    id,
    label: id,
    provider: "openai-compatible",
    endpoint: "https://api.example.com/v1",
    modelId: `${id}-model`,
    secretId: `${id}-secret`,
    enabled: true,
    capabilities: ["text", "code", "tools"],
    qualityTier: "high",
    costTier: "medium",
    latencyTier: "fast",
    reliabilityTier: "high",
    contextWindowTokens: 128000,
    maxOutputTokens: 16000,
    pricing: { currency: "USD", inputPerMillion: 2, outputPerMillion: 8 },
    ...overrides,
  };
}

function providerPreflight() {
  const appData = process.env.APPDATA || "";
  const settingsPath = path.join(appData, "ai-model-manager", "settings.json");
  const secretsPath = path.join(appData, "ai-model-manager", "secrets.json");
  const settings = readJson(settingsPath);
  const config = settings.v22Config || {};
  const profiles = Array.isArray(config.modelProfiles) ? config.modelProfiles : [];
  const enabled = profiles.filter((item) => item?.enabled === true && item.modelId && item.endpoint);
  const expectedModelId = String(process.env.MOGU_V22_EXPECTED_MODEL_ID || "").trim();
  const secretBag = readJson(secretsPath);
  const secretPresent = enabled.some((item) => {
    const entry = secretBag[String(item.secretId || "")];
    return entry?.encoding === "safeStorage" && Boolean(entry?.data);
  });
  const checks = {
    neuralExplicitlyEnabled: settings.v22NeuralLayer === true && settings.v22ModelRouting === true,
    profileConfigured: enabled.length > 0,
    exactModelConfigured: enabled.some((item) => Boolean(String(item.modelId || "").trim())),
    expectedModelLocked:
      Boolean(expectedModelId) && enabled.some((item) => item.modelId === expectedModelId),
    encryptedSecretMetadataPresent: secretPresent,
  };
  const ready = Object.values(checks).every(Boolean);
  let configHash = null;
  if (checks.profileConfigured) {
    try {
      const primary = enabled.find((item) => item.modelId === expectedModelId) || enabled[0];
      configHash = createEvaluationConfigHash({
        provider: primary.provider,
        endpoint: primary.endpoint,
        modelId: primary.modelId,
        sampling: { temperature: 0.3 },
        limits: config.budget || {},
      });
    } catch {
      configHash = null;
    }
  }
  return {
    schemaVersion: 1,
    kind: "mogu-v2.2-gpt56-ab-preflight",
    status: ready ? "READY_NOT_RUN" : "BLOCKED",
    checkedAt: new Date().toISOString(),
    checks,
    configHash,
    secretValueRead: false,
    fallbackAllowed: false,
    blocker: ready
      ? "Explicit execution command and registered development task set required"
      : "Exact owner-approved GPT-5.6 / model-profile configuration is not available",
  };
}

async function offlineMechanismRun() {
  const started = Date.now();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-v22-mech-"));
  const checks = [];
  const record = (id, ok, detail = {}) => checks.push({ id, ok: Boolean(ok), detail });
  try {
    const classification = classifyTask({
      text: "Refactor this JavaScript API and run tests to fix the TypeError",
    });
    record(
      "task-classifier-coding",
      classification.taskClass === "coding" && classification.requiredCapabilities.includes("code"),
      classification
    );

    const config = {
      modelProfiles: [profile("strong")],
      taskPolicies: [
        {
          id: "coding-default",
          taskClass: "coding",
          modelProfileId: "strong",
          enabled: true,
          requiredCapabilities: ["text", "code", "tools"],
        },
      ],
      allowModelFallback: false,
    };
    const registry = new ModelRegistry(config);
    const router = new ModelRouter(registry, config);
    const decision = router.route(classification, {
      requiredCapabilities: ["text", "code", "tools"],
    });
    record(
      "model-router-exact",
      decision.status === "SELECTED" &&
        decision.primaryProfile?.id === "strong" &&
        decision.allowModelFallback === false,
      { status: decision.status, primary: decision.primaryProfile?.id }
    );

    const ledger = new BudgetLedger({
      root: tempRoot,
      file: "budget.json",
      limits: {
        perRun: { maxRequests: 2, maxInputTokens: 1000 },
        perDay: { maxRequests: 10 },
      },
    });
    const reserved = await ledger.reserve("run-1", "event-1", {
      requests: 1,
      inputTokens: 100,
      outputTokens: 50,
    });
    const committed = await ledger.commit(reserved.reservationId, "commit-1", {
      requests: 1,
      inputTokens: 80,
      outputTokens: 40,
    });
    record(
      "budget-ledger-reserve-commit",
      reserved.status === "RESERVED" && committed.status === "COMMITTED",
      { reservationId: reserved.reservationId, commit: committed.status }
    );

    const context = assembleContext(
      [
        { id: "goal", type: "user-goal", priority: 100, required: true, content: "fix the bug" },
        { id: "secret", type: "history", priority: 10, content: { apiKey: "sk-should-redact" } },
      ],
      { maxBytes: 4096, maxEstimatedTokens: 1024 }
    );
    record(
      "context-budget-redact",
      context.ok === true && JSON.stringify(context.selected).includes("[REDACTED]"),
      { bytes: context.bytes, estimatedTokens: context.estimatedTokens }
    );

    const chain = createToolChain({
      kind: "coding",
      tools: ["grep", "set_plan", "apply_patch", "run_tests", "git_diff"].map((name) => ({
        type: "function",
        function: { name },
      })),
      maxCalls: 8,
    });
    const moved = chain.transition("investigate");
    const blockedPatch = chain.validateCall("apply_patch");
    const allowedGrep = chain.prepareCall("grep");
    record(
      "tool-chain-phase-gate",
      moved.ok === true &&
        blockedPatch.code === "TOOL_NOT_ALLOWED_IN_PHASE" &&
        allowedGrep.ok === true,
      { phase: chain.phase, blocked: blockedPatch.code }
    );

    const store = new RunEventStore(path.join(tempRoot, "events"));
    const trace = new DecisionTrace(store);
    await trace.branch("task-1", { reason: "mechanism", selected: "strong" }, { eventId: "branch-1" });
    const replay = await trace.replay("task-1");
    record("decision-trace-replay", replay.summary.eventCount === 1, replay.summary);

    const planner = new NeuralPlanner({
      eventStore: store,
      settings: {
        v22NeuralLayer: true,
        v22Planner: true,
        v22DecisionTrace: true,
      },
    });
    const plan = await planner.create({
      workspace: ROOT,
      prompt: "Locate normalizeVerifyStages definition and prepare verification",
      taskId: "eval-plan",
      maxFiles: 2000,
    });
    record(
      "neural-plan-real-repo",
      Array.isArray(plan?.hypotheses) && plan.hypotheses.length >= 1 && plan.enabled !== false,
      { hypotheses: plan?.hypotheses?.length, lsp: plan?.lsp?.status, status: plan?.status }
    );

    let attempts = 0;
    const closed = new ClosedLoopExecutor({
      budget: { maxRepairIterations: 2 },
      execute: async () => {
        attempts += 1;
        return { ok: true, dirty: true, steps: 1 };
      },
      verify: async () =>
        attempts === 1
          ? { ok: false, output: "[FAIL_TO_PASS] ok=false" }
          : { ok: true, output: "[FAIL_TO_PASS] ok=true" },
      replan: async () => ({ ok: true, plan: { repaired: true } }),
      checkpoint: async () => {},
      permissionCheck: async () => ({ allowed: true }),
      decisionTrace: trace,
    });
    const loop = await closed.run({ moguTaskId: "task-loop", requestAcceptedByGateway: false });
    record(
      "closed-loop-repair",
      loop.status === "SUCCEEDED" && attempts === 2,
      { status: loop.status, attempts }
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return {
    schemaVersion: 1,
    kind: "mogu-v2.2-offline-mechanism-evaluation",
    status: checks.every((item) => item.ok) ? "PASS" : "FAIL",
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    branch: "capability/2.2",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    providerUsed: false,
    checks,
  };
}

async function main() {
  const preflight = providerPreflight();
  const offline = await offlineMechanismRun();
  const ab = {
    schemaVersion: 1,
    kind: "mogu-v2.2-gpt56-ab",
    status: preflight.status === "READY_NOT_RUN" ? "NOT_RUN" : "BLOCKED",
    protocol: "docs/V2.2_AB_PROTOCOL.md",
    baselineRuns: 0,
    treatmentRuns: 0,
    fallbackUsed: false,
    blocker: preflight.blocker,
  };
  const holdout = {
    schemaVersion: 1,
    kind: "mogu-v2.2-holdout-evaluation",
    status: "NOT_OPENED",
    freezer: "scripts/freeze_v22_holdout.js",
    disjointFrom: "benchmarks/swe-bench/holdout/manifest.json",
    outcomesViewed: false,
    blocker:
      "Two qualifying same-model development A/B runs are required before freezing/opening a v2.2 holdout",
  };
  const files = [
    writeReport("gpt56-ab-preflight.json", preflight),
    writeReport("offline-mechanism.json", offline),
    writeReport("gpt56-ab.json", ab),
    writeReport("holdout-status.json", holdout),
  ];
  console.log(JSON.stringify({ ok: offline.status === "PASS", files, preflight: preflight.status }, null, 2));
  process.exit(offline.status === "PASS" ? 0 : 1);
}

main().catch((error) => {
  console.error(`[v2.2:evaluate] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
