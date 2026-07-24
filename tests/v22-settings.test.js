const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_SETTINGS,
  SettingsStore,
  sanitizeV22Config,
} = require("../src/main/settings");

const V22_FLAGS = [
  "v22NeuralLayer",
  "v22ModelRouting",
  "v22Planner",
  "v22ContextBudget",
  "v22ToolChain",
  "v22DecisionTrace",
  "v22ClosedLoop",
];

test("v2.2 Neural Layer flags and fallback default off", () => {
  for (const flag of V22_FLAGS) {
    assert.equal(DEFAULT_SETTINGS[flag], false, `${flag} must default off`);
  }
  assert.deepEqual(DEFAULT_SETTINGS.v22Config.modelProfiles, []);
  assert.deepEqual(DEFAULT_SETTINGS.v22Config.taskPolicies, []);
  assert.equal(DEFAULT_SETTINGS.v22Config.allowModelFallback, false);
});

test("sanitizeV22Config preserves bounded routing metadata and explicit fallback opt-in", () => {
  const clean = sanitizeV22Config({
    modelProfiles: [
      {
        id: "primary",
        label: "Primary",
        provider: "fixture",
        endpoint: "https://fixture.invalid/v1",
        modelId: "fixture-model",
        enabled: true,
        secretId: "secret-store-profile-primary",
        capabilities: {
          tools: true,
          modalities: ["text", "image"],
          nested: { jsonMode: true, apiKey: "nested-capability-secret" },
        },
        costTier: "medium",
        latencyTier: "fast",
        reliabilityTier: "high",
        contextWindowTokens: 128000,
        maxOutputTokens: 16000,
        limits: { requestsPerMinute: 60, accessToken: "nested-limit-secret" },
        pricing: {
          currency: "USD",
          inputPerMillion: 2.5,
          outputPerMillion: 10,
          authorization: "nested-pricing-secret",
        },
        apiKey: "profile-secret",
        token: "profile-token",
        headers: { Authorization: "Bearer profile-secret" },
      },
    ],
    taskPolicies: [
      {
        id: "coding",
        taskClass: "coding",
        modelProfileId: "primary",
        enabled: true,
        requiredCapabilities: ["tools", { name: "json", password: "nested-policy-secret" }],
        allowedProfileIds: ["primary", "backup"],
        profileOrder: ["primary", "backup"],
        selectedProfileOrdering: [
          { profileId: "primary", priority: 1, cookie: "nested-order-secret" },
        ],
        maxQuality: "high",
        maxCost: { usd: 2, apiKey: "nested-cost-secret" },
        maxLatency: { milliseconds: 30000, authHeader: "nested-latency-secret" },
        key: "policy-secret",
      },
    ],
    budget: {
      maxInputTokens: 12000,
      maxOutputTokens: 4000,
      maxToolCalls: 20,
      maxSteps: 8,
      maxRepairIterations: 2,
      maxWallTimeMs: 90000,
      maxCostUsd: 1.5,
      apiKey: "budget-secret",
    },
    allowModelFallback: true,
    secretKey: "root-secret",
  });

  const profile = clean.modelProfiles[0];
  assert.equal(profile.secretId, "secret-store-profile-primary");
  assert.deepEqual(profile.capabilities, {
    tools: true,
    modalities: ["text", "image"],
    nested: { jsonMode: true },
  });
  assert.equal(profile.costTier, "medium");
  assert.equal(profile.latencyTier, "fast");
  assert.equal(profile.reliabilityTier, "high");
  assert.equal(profile.contextWindowTokens, 128000);
  assert.equal(profile.maxOutputTokens, 16000);
  assert.deepEqual(profile.limits, { requestsPerMinute: 60 });
  assert.deepEqual(profile.pricing, {
    currency: "USD",
    inputPerMillion: 2.5,
    outputPerMillion: 10,
  });

  const policy = clean.taskPolicies[0];
  assert.deepEqual(policy.requiredCapabilities, ["tools", { name: "json" }]);
  assert.deepEqual(policy.allowedProfileIds, ["primary", "backup"]);
  assert.deepEqual(policy.profileOrder, ["primary", "backup"]);
  assert.deepEqual(policy.selectedProfileOrdering, [{ profileId: "primary", priority: 1 }]);
  assert.equal(policy.maxQuality, "high");
  assert.deepEqual(policy.maxCost, { usd: 2 });
  assert.deepEqual(policy.maxLatency, { milliseconds: 30000 });
  assert.equal(clean.budget.maxSteps, 8);
  assert.equal(clean.allowModelFallback, true);
  const serialized = JSON.stringify(clean);
  for (const secret of [
    "nested-capability-secret",
    "nested-limit-secret",
    "nested-pricing-secret",
    "profile-secret",
    "profile-token",
    "nested-policy-secret",
    "nested-order-secret",
    "nested-cost-secret",
    "nested-latency-secret",
    "policy-secret",
    "root-secret",
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} must be removed`);
  }
});

test("sanitizeV22Config keeps fallback disabled without exact true opt-in", () => {
  assert.equal(sanitizeV22Config().allowModelFallback, false);
  assert.equal(sanitizeV22Config({ allowModelFallback: false }).allowModelFallback, false);
  assert.equal(sanitizeV22Config({ allowModelFallback: "true" }).allowModelFallback, false);
});

test("sanitizeV22Config bounds array-form capabilities", () => {
  const capabilities = Array.from({ length: 40 }, (_, index) =>
    index === 0 ? { name: "tools", accessToken: "nested-array-token" } : `capability-${index}`
  );
  const clean = sanitizeV22Config({
    modelProfiles: [{ id: "array-profile", capabilities }],
  });

  assert.equal(clean.modelProfiles[0].capabilities.length, 32);
  assert.deepEqual(clean.modelProfiles[0].capabilities[0], { name: "tools" });
  assert.equal(JSON.stringify(clean).includes("nested-array-token"), false);
});

test("SettingsStore never persists credential fields in v22Config", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-v22-settings-"));
  const settingsPath = path.join(dir, "settings.json");
  try {
    const store = new SettingsStore(settingsPath);
    await store.update({
      v22Config: {
        modelProfiles: [
          {
            id: "primary",
            provider: "fixture",
            modelId: "fixture-model",
            secretId: "safe-secret-reference",
            capabilities: {
              tools: true,
              nested: {
                apiKey: "nested-api-key",
                accessToken: "nested-access-token",
                password: "nested-password",
                authorization: "nested-authorization",
                cookie: "nested-cookie",
              },
            },
            pricing: {
              currency: "USD",
              credentials: {
                privateKey: "nested-private-key",
                refreshToken: "nested-refresh-token",
              },
            },
            apiKey: "persisted-api-key",
            key: "persisted-key",
            accessToken: "persisted-token",
            credentials: { clientSecret: "persisted-client-secret" },
          },
        ],
        taskPolicies: [
          {
            id: "coding",
            taskClass: "coding",
            requiredCapabilities: [{ name: "tools", authToken: "policy-auth-token" }],
            constraints: { quality: "high", password: "policy-password" },
            token: "policy-token",
          },
        ],
        budget: { maxSteps: 4, authorization: "Bearer persisted-token" },
        apiKey: "root-api-key",
        allowModelFallback: true,
      },
    });

    const persisted = await fs.readJson(settingsPath);
    const serialized = JSON.stringify(persisted.v22Config);
    for (const secret of [
      "persisted-api-key",
      "persisted-key",
      "persisted-token",
      "persisted-client-secret",
      "policy-token",
      "nested-api-key",
      "nested-access-token",
      "nested-password",
      "nested-authorization",
      "nested-cookie",
      "nested-private-key",
      "nested-refresh-token",
      "policy-auth-token",
      "policy-password",
    ]) {
      assert.equal(serialized.includes(secret), false, `${secret} must not persist`);
    }
    assert.equal(persisted.v22Config.modelProfiles[0].secretId, "safe-secret-reference");
    assert.deepEqual(persisted.v22Config.modelProfiles[0].capabilities, {
      tools: true,
      nested: {},
    });
    assert.equal(persisted.v22Config.allowModelFallback, true);
    assert.deepEqual(Object.keys(persisted.v22Config), [
      "modelProfiles",
      "taskPolicies",
      "budget",
      "allowModelFallback",
    ]);
  } finally {
    await fs.remove(dir);
  }
});
