const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  ClosedLoopExecutor,
  TERMINAL,
  STOP_REASONS,
  closedLoopEnabled,
  getClosedLoopStatus,
  resetClosedLoopStatusForTests,
} = require("../src/main/moguai/neural/closed-loop");
const { DecisionTrace } = require("../src/main/moguai/neural/decision-trace");
const { RunEventStore } = require("../src/main/moguai/runtime/run-event-store");
const coding = require("../src/main/skills/handlers/coding");

function fakeClock(sequence) {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

test("closedLoopEnabled requires both neural layer and closed-loop flags", () => {
  assert.equal(closedLoopEnabled({ v22NeuralLayer: true, v22ClosedLoop: true }), true);
  assert.equal(closedLoopEnabled({ v22NeuralLayer: true, v22ClosedLoop: false }), false);
  assert.equal(closedLoopEnabled({ v22NeuralLayer: false, v22ClosedLoop: true }), false);
});

test("success path: checkpoint → execute → verify ok → review → succeeded", async () => {
  resetClosedLoopStatusForTests();
  const events = [];
  const executor = new ClosedLoopExecutor({
    budget: { maxRepairIterations: 2 },
    checkpoint: async (ctx) => {
      events.push(`checkpoint:${ctx.attempt}`);
    },
    execute: async () => {
      events.push("execute");
      return { ok: true, steps: 1 };
    },
    verify: async () => {
      events.push("verify");
      return { ok: true, output: "ok=true" };
    },
    review: async () => {
      events.push("review");
      return { reviewed: true };
    },
    replan: async () => {
      events.push("replan");
      return { ok: true };
    },
  });

  const result = await executor.run({ moguTaskId: "t-success" });
  assert.equal(result.status, TERMINAL.SUCCEEDED);
  assert.equal(result.reason, STOP_REASONS.VERIFIED);
  assert.deepEqual(events, ["checkpoint:0", "execute", "verify", "review"]);
  assert.equal(getClosedLoopStatus().lastOutcome.status, TERMINAL.SUCCEEDED);
});

test("verify fail → replan → retry → succeed within budget", async () => {
  let attempts = 0;
  const branches = [];
  const executor = new ClosedLoopExecutor({
    budget: { maxRepairIterations: 2 },
    execute: async () => {
      attempts += 1;
      return { ok: true, steps: 1 };
    },
    verify: async () => {
      if (attempts === 1) return { ok: false, output: "[FAIL_TO_PASS] ok=false" };
      return { ok: true, output: "[FAIL_TO_PASS] ok=true" };
    },
    replan: async (_ctx, failure) => {
      assert.equal(failure.kind, "f2p_miss");
      return { ok: true, plan: { repaired: true } };
    },
    decisionTrace: {
      branch: async (_id, payload) => {
        branches.push(payload.branch);
      },
      verificationResult: async () => {},
      plan: async () => {},
    },
  });

  const result = await executor.run({ moguTaskId: "t-repair" });
  assert.equal(result.status, TERMINAL.SUCCEEDED);
  assert.equal(result.attempts, 2);
  assert.equal(result.repairIterations, 1);
  assert.ok(branches.includes("replan"));
  assert.ok(branches.includes("repair_retry"));
  assert.ok(branches.includes("succeeded"));
});

test("budget exhaustion after maxRepairIterations", async () => {
  let executes = 0;
  const executor = new ClosedLoopExecutor({
    budget: { maxRepairIterations: 1 },
    execute: async () => {
      executes += 1;
      return { ok: true };
    },
    verify: async () => ({ ok: false, output: "FAILED test" }),
    replan: async () => ({ ok: true }),
  });
  const result = await executor.run({ moguTaskId: "t-exhaust" });
  assert.equal(result.status, TERMINAL.EXHAUSTED);
  assert.equal(result.code, STOP_REASONS.BUDGET_REPAIR_EXHAUSTED);
  assert.equal(executes, 2); // initial + one repair
  assert.equal(result.repairIterations, 1);
});

test("wall-time exhaustion", async () => {
  const executor = new ClosedLoopExecutor({
    budget: { maxRepairIterations: 5, maxWallTimeMs: 100 },
    now: fakeClock([0, 0, 150]),
    execute: async () => ({ ok: true }),
    verify: async () => ({ ok: false, output: "fail" }),
    replan: async () => ({ ok: true }),
  });
  const result = await executor.run({ moguTaskId: "t-wall" });
  assert.equal(result.status, TERMINAL.EXHAUSTED);
  assert.equal(result.code, STOP_REASONS.BUDGET_WALL_TIME);
});

test("permission denied stops without retry", async () => {
  let executes = 0;
  const executor = new ClosedLoopExecutor({
    budget: { maxRepairIterations: 3 },
    permissionCheck: async () => ({ allowed: false, reason: "l3_denied" }),
    execute: async () => {
      executes += 1;
      return { ok: true };
    },
    verify: async () => ({ ok: true }),
  });
  const result = await executor.run({ moguTaskId: "t-perm" });
  assert.equal(result.status, TERMINAL.BLOCKED);
  assert.equal(result.code, STOP_REASONS.PERMISSION_DENIED);
  assert.equal(executes, 0);
});

test("gateway_accepted_no_resubmit fails closed", async () => {
  let executes = 0;
  const executor = new ClosedLoopExecutor({
    budget: { maxRepairIterations: 2 },
    execute: async () => {
      executes += 1;
      return { ok: true };
    },
    verify: async () => ({ ok: true }),
  });
  const result = await executor.run({
    moguTaskId: "t-gw",
    requestAcceptedByGateway: true,
  });
  assert.equal(result.status, TERMINAL.BLOCKED);
  assert.equal(result.reason, STOP_REASONS.GATEWAY_ACCEPTED_NO_RESUBMIT);
  assert.equal(executes, 0);

  const openclaw = await executor.run({
    moguTaskId: "t-oc",
    replayKind: "openclaw.agent",
  });
  assert.equal(openclaw.reason, STOP_REASONS.GATEWAY_ACCEPTED_NO_RESUBMIT);
});

test("cost-unknown blocks cost budget", async () => {
  let executes = 0;
  const executor = new ClosedLoopExecutor({
    budget: { maxRepairIterations: 1, maxCostUsd: 0.5 },
    execute: async () => {
      executes += 1;
      return { ok: true };
    },
    verify: async () => ({ ok: true }),
  });
  const result = await executor.run({ moguTaskId: "t-cost" });
  assert.equal(result.status, TERMINAL.BLOCKED);
  assert.equal(result.code, STOP_REASONS.COST_UNKNOWN);
  assert.equal(executes, 0);
});

test("decision.branch and verification.result recorded", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-closed-loop-trace-"));
  try {
    const store = new RunEventStore(root);
    const trace = new DecisionTrace(store, { source: "closed-loop-test" });
    const executor = new ClosedLoopExecutor({
      budget: { maxRepairIterations: 1 },
      decisionTrace: trace,
      execute: async () => ({ ok: true, steps: 1 }),
      verify: async (_ctx, _result) => {
        // succeed on first try
        return { ok: true, output: "ok" };
      },
    });
    const result = await executor.run({ moguTaskId: "trace-task" });
    assert.equal(result.status, TERMINAL.SUCCEEDED);
    const replay = await trace.replay("trace-task");
    assert.ok(replay.summary.counts["decision.branch"] >= 2);
    assert.equal(replay.summary.counts["verification.result"], 1);
    assert.equal(JSON.stringify(replay).includes("sk-secret"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("flag-off coding path unchanged", async () => {
  let routed = false;
  const result = await coding.run({
    deps: {
      settings: { v22NeuralLayer: false, v22ClosedLoop: false, v22ModelRouting: false },
      neuralRoutingService: {
        execute: async () => {
          routed = true;
        },
      },
    },
    args: { prompt: "fix it" },
  });
  assert.equal(result.code, "workspace_missing");
  assert.equal(routed, false);
  assert.equal(result.closedLoop, undefined);
});
