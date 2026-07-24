#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { RepoIndex } = require("../src/main/moguai/intelligence/repo-index");
const { discoverTests } = require("../src/main/moguai/intelligence/test-discovery");
const { TerminalSessionManager } = require("../src/main/moguai/terminal/session-manager");
const { WorktreeManager } = require("../src/main/moguai/worktree/worktree-manager");
const { RunEventStore } = require("../src/main/moguai/runtime/run-event-store");
const { PermissionGrants } = require("../src/main/permission-grants");
const { createEvaluationConfigHash } = require("../src/main/brain/openai-compatible-adapter");

const ROOT = path.join(__dirname, "..");
const RESULT_ROOT = path.join(ROOT, "benchmarks", "v2.1", "results");

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

function providerPreflight() {
  const appData = process.env.APPDATA || "";
  const settingsPath = path.join(appData, "ai-model-manager", "settings.json");
  const secretsPath = path.join(appData, "ai-model-manager", "secrets.json");
  const settings = readJson(settingsPath);
  const config = settings.v21Gpt56AdapterConfig || {};
  const secretBag = readJson(secretsPath);
  const expectedModelId = String(process.env.MOGU_V21_EXPECTED_MODEL_ID || "").trim();
  const secret = secretBag[String(config.secretId || "")];
  const checks = {
    adapterExplicitlyEnabled: settings.v21Gpt56Adapter === true,
    providerConfigured: Boolean(String(config.provider || "").trim()),
    endpointConfigured: Boolean(String(config.endpoint || "").trim()),
    exactModelConfigured: Boolean(String(config.modelId || "").trim()),
    expectedModelLocked: Boolean(expectedModelId) && expectedModelId === String(config.modelId || "").trim(),
    encryptedSecretMetadataPresent: secret?.encoding === "safeStorage" && Boolean(secret?.data),
  };
  const ready = Object.values(checks).every(Boolean);
  let configHash = null;
  if (checks.providerConfigured && checks.endpointConfigured && checks.exactModelConfigured) {
    try {
      configHash = createEvaluationConfigHash(config);
    } catch {
      configHash = null;
    }
  }
  return {
    schemaVersion: 1,
    kind: "mogu-v2.1-gpt56-ab-preflight",
    status: ready ? "READY_NOT_RUN" : "BLOCKED",
    checkedAt: new Date().toISOString(),
    checks,
    configHash,
    secretValueRead: false,
    fallbackAllowed: false,
    blocker: ready
      ? "Explicit execution command and registered development task set required"
      : "Exact owner-approved GPT-5.6 provider/model/budget configuration is not available",
  };
}

async function localCapabilityRun() {
  const started = Date.now();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-v21-real-"));
  const checks = [];
  const record = (id, ok, detail = {}) => checks.push({ id, ok: Boolean(ok), detail });
  let managedWorktree = null;
  let manager = null;
  try {
    const index = new RepoIndex(ROOT, { maxFiles: 5000 });
    const stats = index.update();
    const definitions = index.findDefinitions("normalizeVerifyStages");
    const references = index.findReferences("normalizeVerifyStages", { limit: 20 });
    record("repo-index-real-repo", stats.files > 100 && definitions.length >= 1 && references.length >= 1, {
      files: stats.files,
      symbols: stats.symbols,
      definitions: definitions.length,
      references: references.length,
      callEdges: stats.callEdges,
    });

    const discovery = discoverTests(ROOT, { maxFiles: 10_000 });
    record(
      "test-discovery-real-repo",
      discovery.tests.length >= 10 && discovery.verifyStages.some((stage) => stage.command === "npm test"),
      { tests: discovery.tests.length, frameworks: discovery.frameworks, stages: discovery.verifyStages.length }
    );

    const terminalAudit = [];
    const terminal = new TerminalSessionManager({
      allowedRoots: [ROOT],
      authorize: async (request) => ({ allowed: request.riskLevel === 3 }),
      audit: (event) => terminalAudit.push(event.event),
      maxDurationMs: 20_000,
    });
    const session = await terminal.start({
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/c", "echo MOGU_V21_TERMINAL_OK"],
      cwd: ROOT,
      sourceEnv: { PATH: process.env.PATH, OPENAI_API_KEY: "must-not-inherit" },
      env: {},
      permission: { channel: "evaluation", runId: "v21-local-real-task" },
    });
    const terminalResult = await terminal.wait(session.id);
    record(
      "controlled-terminal-real-process",
      terminalResult?.exitCode === 0 &&
        terminalResult.output.includes("MOGU_V21_TERMINAL_OK") &&
        terminalAudit.includes("terminal.started") &&
        terminalAudit.includes("terminal.finished"),
      { status: terminalResult?.status, exitCode: terminalResult?.exitCode, audited: terminalAudit.length }
    );

    const baseline = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    manager = new WorktreeManager({
      repoRoot: ROOT,
      tempRoot: path.join(tempRoot, "worktrees"),
      baselineCommit: baseline,
      maxActive: 2,
      authorize: async () => ({ allowed: true }),
    });
    await manager.ready;
    managedWorktree = await manager.add({ permission: { runId: "v21-local-real-task" } });
    const listed = await manager.list();
    record(
      "managed-worktree-real-git",
      listed.length === 1 &&
        listed[0].readOnly === true &&
        listed[0].baselineCommit === baseline &&
        listed[0].capabilities.write === false,
      { count: listed.length, baselineBound: listed[0]?.baselineCommit === baseline }
    );
    await manager.remove(managedWorktree.id, { permission: { runId: "v21-local-real-task" } });
    managedWorktree = null;

    const events = new RunEventStore(path.join(tempRoot, "events"));
    await events.append("real-task", {
      eventId: "real-task-start",
      type: "evaluation.started",
      source: "v21-local",
      payload: { apiKey: "must-redact", phase: "integration" },
    });
    const replay = await events.read("real-task");
    record(
      "event-store-real-replay",
      replay.corruption === null &&
        replay.events.length === 1 &&
        replay.events[0].payload.apiKey === "[REDACTED]",
      { events: replay.events.length, corruption: replay.corruption }
    );

    const grants = new PermissionGrants(path.join(tempRoot, "grants.json"));
    const issued = await grants.issueLease({
      runId: "v21-local-real-task",
      tool: "mogu.repo",
      scopes: ["repo.read"],
      maxRiskLevel: 2,
      ttlMs: 60_000,
      maxUses: 1,
    });
    const consumed = await grants.consumeLease({
      leaseId: issued.lease.id,
      runId: "v21-local-real-task",
      tool: "mogu.repo",
      scopes: ["repo.read"],
      riskLevel: 2,
    });
    const exhausted = await grants.checkLease({
      leaseId: issued.lease.id,
      runId: "v21-local-real-task",
      tool: "mogu.repo",
      scopes: ["repo.read"],
      riskLevel: 2,
    });
    record("permission-lease-real-budget", consumed.allowed === true && exhausted.reason === "budget_exhausted", {
      consumed: consumed.reason,
      after: exhausted.reason,
    });
  } finally {
    if (manager && managedWorktree) {
      await manager.remove(managedWorktree.id, { permission: { runId: "cleanup" } }).catch(() => {});
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return {
    schemaVersion: 1,
    kind: "mogu-v2.1-local-real-task-evaluation",
    status: checks.every((item) => item.ok) ? "PASS" : "FAIL",
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    branch: "capability/2.1",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    dirtyTreeExpected: true,
    providerUsed: false,
    checks,
  };
}

async function main() {
  const preflight = providerPreflight();
  const local = await localCapabilityRun();
  const ab = {
    schemaVersion: 1,
    kind: "mogu-v2.1-gpt56-ab",
    status: preflight.status === "READY_NOT_RUN" ? "NOT_RUN" : "BLOCKED",
    protocol: "docs/V2.1_AB_PROTOCOL.md",
    baselineRuns: 0,
    treatmentRuns: 0,
    fallbackUsed: false,
    blocker: preflight.blocker,
  };
  const holdout = {
    schemaVersion: 1,
    kind: "mogu-v2.1-holdout-evaluation",
    status: "NOT_OPENED",
    manifest: "benchmarks/swe-bench/holdout/manifest.json",
    taskCount: 20,
    outcomesViewed: false,
    blocker: "Two qualifying GPT-5.6 development A/B runs are required before holdout",
  };
  const files = [
    writeReport("gpt56-ab-preflight.json", preflight),
    writeReport("local-real-tasks.json", local),
    writeReport("gpt56-ab.json", ab),
    writeReport("holdout-status.json", holdout),
  ];
  console.log(JSON.stringify({ ok: local.status === "PASS", files, preflight: preflight.status }, null, 2));
  process.exit(local.status === "PASS" ? 0 : 1);
}

main().catch((error) => {
  console.error(`[v2.1:evaluate] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
