const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  NeuralRoutingService,
  BudgetLedger,
} = require("../src/main/moguai/neural");
const {
  BrainAdapterError,
  ERROR_CODES,
} = require("../src/main/brain/openai-compatible-adapter");
const { runBrainAgent } = require("../src/main/agent-brain");
const coding = require("../src/main/skills/handlers/coding");
const { TaskStore } = require("../src/main/task-store");
const { RunEventStore } = require("../src/main/moguai/runtime/run-event-store");
const { AgentRunService } = require("../src/main/openclaw/agent-run");

function profile(id, overrides = {}) {
  return {
    id,
    label: id,
    provider: `provider-${id}`,
    endpoint: "https://fixture.invalid/v1",
    modelId: `model-${id}`,
    secretId: `secret-${id}`,
    enabled: true,
    capabilities: ["text", "tools", "code"],
    qualityTier: "high",
    costTier: "medium",
    latencyTier: "fast",
    reliabilityTier: "high",
    contextWindowTokens: 32000,
    maxOutputTokens: 2048,
    pricing: { currency: "USD", inputPerMillion: 2, outputPerMillion: 8 },
    ...overrides,
  };
}

function settings(overrides = {}) {
  return {
    agentBrainChannel: "api",
    v22NeuralLayer: true,
    v22ModelRouting: true,
    v22DecisionTrace: true,
    v22Config: {
      modelProfiles: [profile("primary"), profile("backup")],
      taskPolicies: [
        {
          id: "chat",
          taskClass: "chat",
          enabled: true,
          modelProfileId: "primary",
          profileOrder: ["primary", "backup"],
        },
        {
          id: "coding",
          taskClass: "coding",
          enabled: true,
          modelProfileId: "primary",
          profileOrder: ["primary", "backup"],
        },
      ],
      budget: {
        maxInputTokens: 10000,
        maxOutputTokens: 4000,
        maxToolCalls: 20,
        maxSteps: 4,
        maxRepairIterations: 2,
        maxWallTimeMs: 90000,
        maxCostUsd: 1,
      },
      allowModelFallback: true,
    },
    ...overrides,
  };
}

test("Brain uses v22 facade and never reaches legacy API settings", async () => {
  let routed = 0;
  const result = await runBrainAgent({
    settings: {
      ...settings(),
      agentApiBaseUrl: "https://legacy.invalid/v1",
      agentApiModel: "legacy-model",
      agentApiKey: "legacy-secret",
    },
    neuralRoutingService: {
      complete: async (request) => {
        routed += 1;
        assert.equal(request.taskClass, "chat");
        return {
          ok: true,
          content: "routed",
          toolCalls: [],
          provider: "provider-primary",
          model: "model-primary",
          routing: { profileId: "primary" },
        };
      },
    },
    userText: "hello",
  });
  assert.equal(routed, 1);
  assert.equal(result.content, "routed");
  assert.equal(result.model, "model-primary");
});

test("Brain and Coding preserve flag-off behavior", async () => {
  const brain = await runBrainAgent({
    settings: { agentBrainChannel: "builtin", v22NeuralLayer: false, v22ModelRouting: false },
    userText: "hello",
  });
  assert.equal(brain.mode, "passthrough");

  let routed = false;
  const result = await coding.run({
    deps: {
      settings: { v22NeuralLayer: false, v22ModelRouting: false },
      neuralRoutingService: { execute: async () => { routed = true; } },
    },
    args: { prompt: "fix it" },
  });
  assert.equal(result.code, "workspace_missing");
  assert.equal(routed, false);
});

test("Coding dispatch resolves exact routed model before legacy configuration", async () => {
  let request;
  const result = await coding.run({
    deps: {
      settings: settings({
        codingModel: "legacy-coding-model",
        codingProvider: "legacy-provider",
        agentApiModel: "legacy-api-model",
      }),
      neuralRoutingService: {
        execute: async (input, invoke) => {
          request = input;
          return invoke({
            profile: profile("primary"),
            modelId: "model-primary",
            model: "model-primary",
            provider: "provider-primary",
            endpoint: "https://fixture.invalid/v1",
            apiKey: "runtime-only-secret",
            decision: { profileId: "primary" },
          });
        },
      },
    },
    args: { prompt: "fix it" },
  });
  assert.equal(request.taskClass, "coding");
  assert.equal(result.code, "workspace_missing");
  assert.equal(JSON.stringify(result).includes("runtime-only-secret"), false);
});

test("facade falls back in owner order, accounts actual usage, and persists safe evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-neural-integration-"));
  try {
    const eventStore = new RunEventStore(path.join(root, "events"));
    const taskStore = new TaskStore(path.join(root, "tasks.json"), { eventStore });
    const ledger = new BudgetLedger({ root: path.join(root, "ledger") });
    const calls = [];
    const service = new NeuralRoutingService({
      getSettings: async () => settings(),
      keyResolver: async (secretId) => `runtime-value-${secretId}`,
      taskStore,
      eventStore,
      ledger,
      adapterFactory: (config) => ({
        complete: async () => {
          calls.push(config.modelId);
          if (config.modelId === "model-primary") {
            throw Object.assign(new Error("temporary outage"), { code: "TIMEOUT" });
          }
          return {
            ok: true,
            content: "ok",
            toolCalls: [],
            model: config.modelId,
            modelId: config.modelId,
            provider: config.provider,
            usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
            latencyMs: 5,
          };
        },
      }),
    });
    const result = await service.complete({
      taskClass: "chat",
      text: "hello",
      messages: [{ role: "user", content: "hello" }],
      requiredCapabilities: ["text"],
    });
    assert.deepEqual(calls, ["model-primary", "model-backup"]);
    assert.equal(result.ok, true);
    assert.equal(result.routing.profileId, "backup");
    assert.deepEqual(result.routing.attempts.map((item) => item.status), ["FAILED", "COMPLETED"]);

    const task = await taskStore.get(result.moguTaskId);
    assert.equal(task.routing.profileId, "backup");
    assert.equal(typeof task.routingConfigHash, "string");
    assert.equal(task.routingBudgetSnapshot.run.inputTokens, 100);
    const events = await eventStore.read(result.moguTaskId);
    assert.ok(events.events.some((event) => event.type === "routing.decision"));
    assert.equal(events.events.filter((event) => event.type === "routing.attempt").length, 4);
    assert.ok(events.events.some((event) => event.type === "routing.usage"));

    const persisted = await fs.readFile(path.join(root, "tasks.json"), "utf8");
    assert.equal(persisted.includes("runtime-value-"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("provider model mismatch is blocked without fallback", async () => {
  const calls = [];
  const service = new NeuralRoutingService({
    getSettings: async () => settings(),
    keyResolver: async () => "runtime-secret",
    adapterFactory: (config) => ({
      complete: async () => {
        calls.push(config.modelId);
        throw new BrainAdapterError(ERROR_CODES.MODEL_MISMATCH, "mismatch");
      },
    }),
  });
  const result = await service.complete({
    taskClass: "chat",
    text: "hello",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "MODEL_MISMATCH");
  assert.deepEqual(calls, ["model-primary"]);
});

test("OpenClaw only claims model enforcement when Gateway proves it", async () => {
  class Bridge extends EventEmitter {
    constructor(payload) {
      super();
      this.payload = payload;
      this.state = "ready";
    }
    getAvailableMethods() {
      return ["sessions.create", "sessions.send"];
    }
    async request(method) {
      assert.equal(method, "sessions.create");
      return this.payload;
    }
  }
  const unverified = new AgentRunService({
    bridge: new Bridge({ key: "session-1" }),
    taskStore: {},
    getSettings: async () => ({}),
  });
  assert.deepEqual(
    (await unverified.sessionCreate({ model: "model-primary" })).modelRouting,
    {
      requestedModel: "model-primary",
      acceptedModel: null,
      status: "UNVERIFIED",
      enforced: false,
    }
  );

  const enforced = new AgentRunService({
    bridge: new Bridge({ key: "session-2", metadata: { model: "model-primary" } }),
    taskStore: {},
    getSettings: async () => ({}),
  });
  assert.equal((await enforced.sessionCreate({ model: "model-primary" })).modelRouting.enforced, true);
});
