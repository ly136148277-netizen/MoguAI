const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  assembleContext,
  budgetMessages,
  contentHash,
  redactSecrets,
} = require("../src/main/moguai/neural/context-budget");
const {
  createToolChain,
} = require("../src/main/moguai/neural/tool-chain");
const {
  DecisionTrace,
  EVENT_TYPES,
} = require("../src/main/moguai/neural/decision-trace");
const { RunEventStore } = require("../src/main/moguai/runtime/run-event-store");

test("context budget orders, dedupes, redacts and hashes deterministically", () => {
  const input = [
    { id: "low", type: "history", priority: 1, content: "same" },
    { id: "high", type: "memory", priority: 20, content: "same" },
    {
      id: "goal",
      type: "user-goal",
      priority: 100,
      required: true,
      content: { request: "fix", authorization: "Bearer should-not-survive" },
    },
  ];
  const first = assembleContext(input, { maxBytes: 4096, maxEstimatedTokens: 4096 });
  const second = assembleContext(input, { maxBytes: 4096, maxEstimatedTokens: 4096 });
  assert.equal(first.status, "OK");
  assert.equal(first.hash, second.hash);
  assert.equal(first.selected[0].id, "goal");
  assert.equal(first.selected.filter((item) => item.content === "same").length, 1);
  assert.ok(first.evicted.some((item) => item.reason === "DUPLICATE"));
  assert.equal(JSON.stringify(first).includes("should-not-survive"), false);
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
});

test("context budget blocks required overflow and adheres to conservative budgets", () => {
  const blocked = assembleContext(
    [{ id: "goal", type: "user-goal", required: true, content: "x".repeat(100) }],
    { maxBytes: 20, maxEstimatedTokens: 100 }
  );
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.code, "REQUIRED_CONTEXT_OVERFLOW");

  const budgeted = budgetMessages(
    [
      { role: "system", content: "rules" },
      { role: "assistant", content: "old".repeat(100) },
      { role: "user", content: "goal" },
    ],
    { maxBytes: 100, maxEstimatedTokens: 100 }
  );
  assert.equal(budgeted.ok, true);
  assert.ok(budgeted.bytes <= 100);
  assert.ok(budgeted.estimatedTokens <= 100);
  assert.equal(budgeted.tokenEstimate, "conservative");
});

test("recursive redaction removes key and embedded secret values", () => {
  const redacted = redactSecrets({
    nested: [{ apiKey: "raw" }, "Bearer abcdefghijklmnop"],
    url: "https://x.invalid/?token=super-secret-value",
  });
  const text = JSON.stringify(redacted);
  assert.equal(text.includes("raw"), false);
  assert.equal(text.includes("abcdefghijklmnop"), false);
  assert.equal(text.includes("super-secret-value"), false);
});

test("tool chain enforces phase allowlists, transitions and call limits", () => {
  const defs = ["grep", "set_plan", "apply_patch", "run_tests", "git_diff"].map((name) => ({
    type: "function",
    function: { name },
  }));
  const chain = createToolChain({ kind: "coding", tools: defs, maxCalls: 4, maxSteps: 3 });
  assert.equal(chain.transition("investigate").ok, true);
  assert.deepEqual(chain.filterTools(defs).map((item) => item.function.name), ["grep"]);
  assert.equal(chain.validateCall("apply_patch").code, "TOOL_NOT_ALLOWED_IN_PHASE");
  assert.equal(chain.prepareCall("grep").ok, true);
  assert.equal(chain.transition("plan").ok, true);
  assert.equal(chain.prepareCall("set_plan").ok, true);
  assert.equal(chain.transition("execute", { planReady: true }).ok, true);
  assert.equal(chain.prepareCall("apply_patch", { planReady: true }).ok, true);
  assert.equal(chain.transition("verify").ok, true);
  assert.equal(chain.prepareCall("run_tests", { planReady: true }).ok, true);
  assert.equal(chain.validateCall("run_tests").code, "MAX_CALLS_EXCEEDED");
  assert.equal(chain.phase, "blocked");
});

test("tool chain cannot advertise or execute model-added tools", () => {
  const defs = [{ type: "function", function: { name: "grep" } }];
  const chain = createToolChain({ kind: "coding", tools: defs });
  chain.transition("investigate");
  assert.equal(chain.validateCall("shell_superuser").code, "TOOL_NOT_ADVERTISED");
  assert.deepEqual(chain.filterTools([...defs, { type: "function", function: { name: "apply_patch" } }]).map((d) => d.function.name), ["grep"]);
});

test("decision trace supports typed dedupe, redaction and replay", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-trace-"));
  try {
    const store = new RunEventStore(root);
    const trace = new DecisionTrace(store, { maxSummaryBytes: 2048 });
    assert.ok(EVENT_TYPES.includes("neural.plan"));
    const one = await trace.toolSelected(
      "task-1",
      { tool: "grep", password: "do-not-store", note: "Bearer abcdefghijklmnop" },
      { eventId: "stable-selection" }
    );
    const duplicate = await trace.toolSelected(
      "task-1",
      { tool: "different" },
      { eventId: "stable-selection" }
    );
    assert.equal(one.deduped, false);
    assert.equal(duplicate.deduped, true);
    await trace.verificationResult("task-1", { ok: true });
    const replay = await trace.replay("task-1");
    assert.equal(replay.events.length, 2);
    assert.equal(replay.summary.counts["tool.selected"], 1);
    assert.equal(JSON.stringify(replay).includes("do-not-store"), false);
    assert.equal(JSON.stringify(replay).includes("abcdefghijklmnop"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("decision trace append fails closed", async () => {
  const trace = new DecisionTrace({
    read: async () => ({ events: [], corruption: null }),
    append: async () => {
      throw new Error("disk denied");
    },
  });
  await assert.rejects(
    trace.branch("task-1", { branch: "blocked" }),
    (error) => error.code === "TRACE_APPEND_FAILED"
  );
});
