const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  BrainAdapterError,
  ERROR_CODES,
  createEvaluationConfigHash,
  createOpenAiCompatibleAdapter,
  normalizeToolSchema,
  validateEndpoint,
} = require("../src/main/brain/openai-compatible-adapter");
const { runBrainAgent } = require("../src/main/agent-brain");
const { SettingsStore } = require("../src/main/settings");

function config(overrides = {}) {
  return {
    provider: "fixture-provider",
    endpoint: "https://fixture.invalid/v1",
    modelId: "fixture-exact-model",
    capabilities: { tools: true },
    sampling: { temperature: 0.2, seed: 7 },
    limits: {
      timeoutMs: 1000,
      maxSteps: 3,
      maxOutputTokens: 1000,
      maxRequestBytes: 4096,
      maxResponseBytes: 4096,
      maxToolArgumentsBytes: 1024,
      maxCostUsd: 1,
    },
    ...overrides,
  };
}

function jsonResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status || 200,
    headers: { "content-type": "application/json", "x-request-id": "req-fixture", ...(options.headers || {}) },
  });
}

test("missing exact model and missing key produce typed BLOCKED outcomes", async () => {
  assert.throws(
    () => createOpenAiCompatibleAdapter(config({ modelId: "" }), { keyResolver: async () => "unused" }),
    (error) => error instanceof BrainAdapterError && error.code === ERROR_CODES.BLOCKED
  );

  const adapter = createOpenAiCompatibleAdapter(config(), {
    keyResolver: async () => "",
    fetchImpl: async () => assert.fail("fetch must not run without a key"),
  });
  await assert.rejects(
    () => adapter.complete({ messages: [] }),
    (error) => error instanceof BrainAdapterError && error.code === ERROR_CODES.BLOCKED
  );
});

test("enabled adapter never falls back to legacy API configuration", async () => {
  const result = await runBrainAgent({
    settings: {
      agentBrainChannel: "api",
      v21Gpt56Adapter: true,
      v21Gpt56AdapterConfig: { provider: "selected", endpoint: "https://fixture.invalid/v1", modelId: "" },
      agentApiBaseUrl: "https://legacy.invalid/v1",
      agentApiModel: "legacy-model",
      agentApiKey: "legacy-key",
    },
    keyResolver: async () => "",
    userText: "test",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.code, "BLOCKED");
  assert.equal(result.provider, null);
});

test("keys are resolved per request and are never persisted or logged", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-adapter-settings-"));
  const file = path.join(dir, "settings.json");
  const store = new SettingsStore(file);
  await store.update({
    v21Gpt56AdapterConfig: {
      ...config(),
      apiKey: "persisted-secret",
      headers: { Authorization: "Bearer persisted-secret" },
    },
  });
  const persisted = await fs.readFile(file, "utf8");
  assert.equal(persisted.includes("persisted-secret"), false);

  let resolutions = 0;
  const logs = [];
  const adapter = createOpenAiCompatibleAdapter(config(), {
    keyResolver: async () => {
      resolutions += 1;
      return "runtime-secret";
    },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, "Bearer runtime-secret");
      return jsonResponse({ model: "fixture-exact-model", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    },
  });
  await adapter.complete({ messages: [] });
  await adapter.complete({ messages: [] });
  assert.equal(resolutions, 2);
  assert.equal(JSON.stringify(logs).includes("runtime-secret"), false);
  assert.equal(JSON.stringify(adapter).includes("runtime-secret"), false);
});

test("normalizes planner schema, response, usage and trace fields", async () => {
  let posted;
  const adapter = createOpenAiCompatibleAdapter(config(), {
    keyResolver: async () => "secret",
    fetchImpl: async (_url, init) => {
      posted = JSON.parse(init.body);
      return jsonResponse(
        {
          id: "provider-body-id",
          model: "fixture-exact-model",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: [{ type: "text", text: "working" }],
                tool_calls: [{ id: "call-1", function: { name: "mogu_test", arguments: '{"op":"run"}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        },
        { headers: { "x-trace-id": "trace-fixture" } }
      );
    },
  });
  const result = await adapter.complete({
    messages: [{ role: "user", content: "go" }],
    tools: [{ name: "mogu_test", description: "test", parameters: { type: "object", properties: {} } }],
  });
  assert.deepEqual(posted.tools, normalizeToolSchema([{ name: "mogu_test", description: "test", parameters: { type: "object", properties: {} } }]));
  assert.equal(posted.model, "fixture-exact-model");
  assert.equal(result.text, "working");
  assert.equal(result.toolCalls[0].function.name, "mogu_test");
  assert.deepEqual(result.usage, { promptTokens: 11, completionTokens: 7, totalTokens: 18 });
  assert.equal(result.finishReason, "tool_calls");
  assert.equal(result.requestId, "req-fixture");
  assert.equal(result.traceId, "trace-fixture");
  assert.equal(result.modelId, "fixture-exact-model");
  assert.ok(result.latencyMs >= 0);
});

test("bounds timeout, external abort, request/response and tool argument sizes", async () => {
  const hangingFetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      if (init.signal.aborted) {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        return;
      }
      init.signal.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        { once: true }
      );
    });
  const timed = createOpenAiCompatibleAdapter(config({ limits: { ...config().limits, timeoutMs: 100 } }), {
    keyResolver: async () => "secret",
    fetchImpl: hangingFetch,
  });
  await assert.rejects(
    () => timed.complete({ messages: [] }),
    (error) => error.code === ERROR_CODES.TIMEOUT
  );

  const controller = new AbortController();
  const aborted = createOpenAiCompatibleAdapter(config(), {
    keyResolver: async () => "secret",
    fetchImpl: hangingFetch,
  });
  const pending = aborted.complete({ messages: [], signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === ERROR_CODES.ABORTED);

  const requestBound = createOpenAiCompatibleAdapter(
    config({ limits: { ...config().limits, maxRequestBytes: 1024 } }),
    { keyResolver: async () => "secret", fetchImpl: async () => assert.fail("oversized request must not fetch") }
  );
  await assert.rejects(
    () => requestBound.complete({ messages: [{ role: "user", content: "x".repeat(2000) }] }),
    (error) => error.code === ERROR_CODES.REQUEST_TOO_LARGE
  );

  const responseBound = createOpenAiCompatibleAdapter(
    config({ limits: { ...config().limits, maxResponseBytes: 1024 } }),
    {
      keyResolver: async () => "secret",
      fetchImpl: async () =>
        jsonResponse({ choices: [{ message: { content: "x".repeat(2000) }, finish_reason: "stop" }] }),
    }
  );
  await assert.rejects(
    () => responseBound.complete({ messages: [] }),
    (error) => error.code === ERROR_CODES.RESPONSE_TOO_LARGE
  );

  const argsBound = createOpenAiCompatibleAdapter(
    config({ limits: { ...config().limits, maxToolArgumentsBytes: 128 } }),
    {
      keyResolver: async () => "secret",
      fetchImpl: async () =>
        jsonResponse({
          choices: [
            {
              message: { tool_calls: [{ function: { name: "tool", arguments: JSON.stringify({ x: "a".repeat(200) }) } }] },
            },
          ],
        }),
    }
  );
  await assert.rejects(
    () => argsBound.complete({ messages: [] }),
    (error) => error.code === ERROR_CODES.TOOL_ARGUMENTS_TOO_LARGE
  );
});

test("evaluation hash is stable, secret-free and budget-sensitive", () => {
  const a = createEvaluationConfigHash({ ...config(), apiKey: "secret-a" });
  const reordered = {
    apiKey: "secret-b",
    limits: { ...config().limits },
    capabilities: { tools: true },
    modelId: "fixture-exact-model",
    endpoint: "https://fixture.invalid/v1",
    sampling: { seed: 7, temperature: 0.2 },
    provider: "fixture-provider",
  };
  assert.equal(a, createEvaluationConfigHash(reordered));
  assert.notEqual(a, createEvaluationConfigHash(config({ limits: { ...config().limits, maxSteps: 4 } })));
  assert.notEqual(a, createEvaluationConfigHash(config({ modelId: "different-exact-model" })));
});

test("endpoint validation rejects credentials and unsafe protocols", () => {
  assert.throws(() => validateEndpoint("file:///tmp/provider"), /HTTPS/);
  assert.throws(() => validateEndpoint("https://user:pass@example.com/v1"), /credentials/);
  assert.throws(() => validateEndpoint("http://127.0.0.1:9999/v1"), /HTTPS|opt-in/);
  assert.equal(
    validateEndpoint("http://127.0.0.1:9999/v1", { allowPrivateNetwork: true, allowInsecureLocalhost: true }),
    "http://127.0.0.1:9999/v1"
  );
});
