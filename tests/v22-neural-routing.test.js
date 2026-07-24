const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { classifyTask } = require("../src/main/moguai/neural/task-classifier");
const { ModelRegistry } = require("../src/main/moguai/neural/model-registry");
const { ModelRouter } = require("../src/main/moguai/neural/model-router");
const { BudgetLedger } = require("../src/main/moguai/neural/budget-ledger");

function profile(id, overrides = {}) {
  return {
    id,
    label: id,
    provider: "fixture",
    endpoint: "https://models.invalid/v1",
    modelId: `${id}-model`,
    secretId: `${id}-secret`,
    enabled: true,
    capabilities: ["text", "code", "tools", "research"],
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

function routerConfig(overrides = {}) {
  return {
    modelProfiles: [profile("primary"), profile("backup", { qualityTier: "medium" })],
    taskPolicies: [
      {
        id: "coding-policy",
        taskClass: "coding",
        enabled: true,
        modelProfileId: "primary",
        profileOrder: ["primary", "backup"],
        allowedProfileIds: ["primary", "backup"],
        requiredCapabilities: ["code"],
      },
    ],
    allowModelFallback: false,
    ...overrides,
  };
}

test("task classification is deterministic, explicit about heuristics, and capability-bearing", () => {
  const input = { text: "Refactor this JavaScript API and run tests", requiredCapabilities: ["json"] };
  const first = classifyTask(input);
  const second = classifyTask(input);
  assert.deepEqual(first, second);
  assert.equal(first.taskClass, "coding");
  assert.equal(first.confidence.isModelCertainty, false);
  assert.deepEqual(first.requiredCapabilities, ["code", "json", "text", "tools"]);
  assert.equal(Object.isFrozen(first), true);

  const safety = classifyTask({ text: "hello", hints: { taskClass: "research", safetySensitive: true } });
  assert.equal(safety.taskClass, "safety-sensitive");
});

test("registry rejects unsafe endpoints, secret values, duplicates, and disabled profiles are not active", () => {
  const config = {
    modelProfiles: [
      profile("valid", { endpoint: "http://127.0.0.1:11434/v1" }),
      profile("remote-http", { endpoint: "http://example.com/v1" }),
      profile("leaky", { apiKey: "do-not-store" }),
      profile("valid"),
      profile("off", { enabled: false }),
    ],
  };
  const registry = new ModelRegistry(config);
  assert.deepEqual(registry.list().map((item) => item.id), ["valid"]);
  assert.deepEqual(registry.list({ includeDisabled: true }).map((item) => item.id), ["valid", "off"]);
  assert.deepEqual(
    registry.invalidProfiles().map((item) => item.reason.code),
    ["UNSAFE_ENDPOINT", "SECRET_VALUE_FORBIDDEN", "DUPLICATE_PROFILE_ID"]
  );
  assert.equal(JSON.stringify(registry.snapshot()).includes("do-not-store"), false);
});

test("config hashes are stable across object key order", () => {
  const original = routerConfig();
  const reordered = {
    allowModelFallback: false,
    taskPolicies: original.taskPolicies.map((item) => ({
      requiredCapabilities: item.requiredCapabilities,
      allowedProfileIds: item.allowedProfileIds,
      profileOrder: item.profileOrder,
      modelProfileId: item.modelProfileId,
      enabled: item.enabled,
      taskClass: item.taskClass,
      id: item.id,
    })),
    modelProfiles: original.modelProfiles.map((item) =>
      Object.fromEntries(Object.entries(item).reverse())
    ),
  };
  const first = new ModelRouter(new ModelRegistry(original), original);
  const second = new ModelRouter(new ModelRegistry(reordered), reordered);
  assert.equal(first._configHash, second._configHash);
});

test("router filters capabilities and returns immutable ranked explanations", () => {
  const config = routerConfig({
    modelProfiles: [
      profile("primary", { capabilities: ["text"] }),
      profile("backup"),
    ],
  });
  const router = new ModelRouter(new ModelRegistry(config), config);
  const decision = router.route(classifyTask("Fix this code"), {
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
  });
  assert.equal(decision.status, "SELECTED");
  assert.equal(decision.primaryProfile.id, "backup");
  assert.equal(decision.policyId, "coding-policy");
  assert.equal(decision.rejectedCandidates[0].reason.code, "MISSING_CAPABILITY");
  assert.match(decision.primary.explanation.join(" "), /owner order 2/);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(typeof decision.configHash, "string");
});

test("fallback requires exact opt-in and remains owner-ordered and explicit", () => {
  const disabled = routerConfig();
  const noFallback = new ModelRouter(new ModelRegistry(disabled), disabled);
  const firstDecision = noFallback.route(classifyTask("Fix code"));
  assert.equal(noFallback.nextCandidate(firstDecision, { code: "TIMEOUT" }).status, "NO_FALLBACK");

  const enabled = routerConfig({ allowModelFallback: true });
  const withFallback = new ModelRouter(new ModelRegistry(enabled), enabled);
  const decision = withFallback.route(classifyTask("Fix code"));
  const next = withFallback.nextCandidate(decision, { code: "TIMEOUT", profileId: "primary" });
  assert.equal(next.status, "NEXT_CANDIDATE");
  assert.equal(next.profile.id, "backup");
  assert.equal(next.audit.explicit, true);
  assert.equal(
    withFallback.nextCandidate(decision, { code: "MODEL_MISMATCH", profileId: "primary" }).status,
    "BLOCKED"
  );
  assert.equal(
    withFallback.nextCandidate(decision, { code: "MISSING_KEY", profileId: "primary" }).status,
    "BLOCKED"
  );
});

test("unknown pricing cannot satisfy a cost-denominated route", () => {
  const config = routerConfig({
    modelProfiles: [profile("primary", { pricing: undefined })],
    taskPolicies: [
      {
        id: "coding-policy",
        taskClass: "coding",
        enabled: true,
        modelProfileId: "primary",
        profileOrder: ["primary"],
      },
    ],
  });
  const decision = new ModelRouter(new ModelRegistry(config), config).route(
    classifyTask("Fix code"),
    { maxCostUsd: 1, estimatedInputTokens: 100 }
  );
  assert.equal(decision.status, "BLOCKED");
  assert.equal(decision.rejectedCandidates[0].reason.code, "UNKNOWN_PRICE");
});

test("budget ledger enforces run/day limits and serializes idempotent updates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-budget-"));
  try {
    const ledger = new BudgetLedger({
      root,
      file: "ledger.json",
      clock: () => new Date("2026-07-24T03:00:00.000Z"),
      limits: {
        perRun: { maxRequests: 2, maxInputTokens: 10 },
        perDay: { maxRequests: 3 },
      },
    });
    const usage = { requests: 1, inputTokens: 4, outputTokens: 1, estimatedCostUsd: 0.01 };
    const first = await ledger.reserve("run-a", "event-1", usage);
    const duplicate = await ledger.reserve("run-a", "event-1", usage);
    assert.equal(first.status, "RESERVED");
    assert.equal(duplicate.deduped, true);
    assert.equal(duplicate.run.requests, 1);

    const [second, otherRun] = await Promise.all([
      ledger.reserve("run-a", "event-2", usage),
      ledger.reserve("run-b", "event-3", usage),
    ]);
    assert.equal(second.status, "RESERVED");
    assert.equal(otherRun.status, "RESERVED");
    assert.equal((await ledger.reserve("run-a", "event-4", usage)).reason.code, "BUDGET_EXHAUSTED");
    assert.equal((await ledger.reserve("run-c", "event-5", usage)).reason.code, "BUDGET_EXHAUSTED");

    const committed = await ledger.commit(first.reservationId, "commit-1", {
      requests: 1,
      inputTokens: 3,
      outputTokens: 1,
      estimatedCostUsd: 0.005,
    });
    assert.equal(committed.status, "COMMITTED");
    assert.equal((await ledger.commit(first.reservationId, "commit-1")).deduped, true);
    assert.equal((await ledger.release(second.reservationId, "release-1")).status, "RELEASED");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("budget ledger blocks unknown cost, corruption, and unsafe paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-budget-safe-"));
  try {
    const priced = new BudgetLedger({
      root,
      limits: { perRun: { maxCostUsd: 1 } },
    });
    const unknown = await priced.reserve("run", "unknown-price", { requests: 1 });
    assert.equal(unknown.status, "BLOCKED");
    assert.equal(unknown.reason.code, "UNKNOWN_PRICE");

    await fs.writeFile(path.join(root, "corrupt.json"), "{bad json", "utf8");
    const corrupt = new BudgetLedger({ root, file: "corrupt.json" });
    assert.equal((await corrupt.snapshot("run")).reason.code, "LEDGER_CORRUPT");

    const unsafe = new BudgetLedger({ root, file: path.join(root, "..", "escape.json") });
    assert.equal((await unsafe.snapshot("run")).reason.code, "PATH_UNSAFE");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
