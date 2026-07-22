const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyVerifyFailure,
  createD2State,
  tryOpenD2Cycle,
  evaluateD2Tool,
  applyD2Advance,
  buildGateUserMessage,
  isStructuredRetryEnabled,
  structuredRetryMaxCycles,
} = require("../src/main/skills/coding-d2-retry");

test("classifyVerifyFailure labels f2p / p2p / other", () => {
  assert.equal(
    classifyVerifyFailure(
      "ok=false failedStage=FAIL_TO_PASS\n[FAIL_TO_PASS] ok=false\nAssertionError"
    ).class,
    "f2p_miss"
  );
  assert.equal(
    classifyVerifyFailure(
      "ok=false failedStage=PASS_TO_PASS\n[FAIL_TO_PASS] ok=true\n[PASS_TO_PASS] ok=false"
    ).class,
    "p2p_regression"
  );
  assert.equal(classifyVerifyFailure("NO_VERIFY: none").class, "other");
});

test("structured retry defaults off; env/opts enable; max cycles capped at 2", () => {
  const prev = process.env.MOGU_D2_STRUCTURED_RETRY;
  const prevMax = process.env.MOGU_D2_MAX_CYCLES;
  try {
    delete process.env.MOGU_D2_STRUCTURED_RETRY;
    assert.equal(isStructuredRetryEnabled({}), false);
    assert.equal(isStructuredRetryEnabled({ structuredRetry: true }), true);
    process.env.MOGU_D2_STRUCTURED_RETRY = "1";
    assert.equal(isStructuredRetryEnabled({}), true);
    assert.equal(structuredRetryMaxCycles({ structuredRetryMaxCycles: 9 }), 2);
    assert.equal(structuredRetryMaxCycles({ structuredRetryMaxCycles: 1 }), 1);
  } finally {
    if (prev === undefined) delete process.env.MOGU_D2_STRUCTURED_RETRY;
    else process.env.MOGU_D2_STRUCTURED_RETRY = prev;
    if (prevMax === undefined) delete process.env.MOGU_D2_MAX_CYCLES;
    else process.env.MOGU_D2_MAX_CYCLES = prevMax;
  }
});

test("D2 gate enforces plan → patch → verify and blocks shortcuts", () => {
  const state = createD2State({ structuredRetry: true, structuredRetryMaxCycles: 2 });
  const opened = tryOpenD2Cycle(
    state,
    { class: "f2p_miss", failedStage: "FAIL_TO_PASS", detail: "t" },
    "old hypothesis about widget"
  );
  assert.equal(opened, true);
  assert.equal(state.active.phase, "need_plan");

  const blockRt = evaluateD2Tool(state.active, "run_tests", {});
  assert.equal(blockRt.allow, false);

  const blockSame = evaluateD2Tool(state.active, "set_plan", {
    hypothesis: "old hypothesis about widget",
  });
  assert.equal(blockSame.allow, false);

  const planOk = evaluateD2Tool(state.active, "set_plan", {
    hypothesis: "different hypothesis: fix ordering",
  });
  assert.equal(planOk.allow, true);
  assert.equal(planOk.advance, "need_patch");
  applyD2Advance(state, planOk.advance, { hypothesis: "different hypothesis: fix ordering" });
  assert.equal(state.active.phase, "need_patch");
  assert.equal(state.forcedPlanCount, 1);

  const blockRt2 = evaluateD2Tool(state.active, "run_tests", {});
  assert.equal(blockRt2.allow, false);

  const patchOk = evaluateD2Tool(state.active, "apply_patch", { applyOk: true });
  assert.equal(patchOk.advance, "need_verify");
  applyD2Advance(state, patchOk.advance);
  assert.equal(state.active.phase, "need_verify");
  assert.equal(state.forcedPatchCount, 1);

  const failClose = evaluateD2Tool(state.active, "run_tests", { verifyOk: false });
  assert.equal(failClose.advance, "cycle_failed");
  applyD2Advance(state, failClose.advance);
  assert.equal(state.active, null);
  assert.equal(state.cyclesCompleted, 1);

  // second cycle then stop forcing
  assert.equal(
    tryOpenD2Cycle(state, { class: "other", failedStage: null, detail: "x" }, "h2"),
    true
  );
  state.active.phase = "need_verify";
  applyD2Advance(state, "cycle_failed");
  assert.equal(state.cyclesCompleted, 2);
  assert.equal(
    tryOpenD2Cycle(state, { class: "other", failedStage: null, detail: "x" }, "h3"),
    false
  );
});

test("buildGateUserMessage mentions failure class and phase", () => {
  const msg = buildGateUserMessage({
    cycle: 1,
    maxCycles: 2,
    phase: "need_plan",
    classification: { class: "p2p_regression", failedStage: "PASS_TO_PASS", detail: "x" },
  });
  assert.match(msg, /B2-D2/);
  assert.match(msg, /p2p_regression/);
  assert.match(msg, /need_plan/);
});
