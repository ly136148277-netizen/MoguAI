const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decideAgentRoute,
  resolveExecutorLabel,
  shouldShowBrainSetupBanner,
  normalizeChannel,
} = require("../src/shared/agent-routing");

test("normalizeChannel maps empty to unset (not builtin)", () => {
  assert.equal(normalizeChannel(""), "unset");
  assert.equal(normalizeChannel("builtin"), "builtin");
  assert.equal(normalizeChannel("API"), "api");
});

test("builtin + openclaw must use OpenClaw (not block on brain)", () => {
  const route = decideAgentRoute({
    brainChannel: "builtin",
    brainReady: false,
    runtimeMode: "openclaw",
  });
  assert.equal(route.action, "use");
  assert.equal(route.executor, "openclaw");
});

test("api brain not ready blocks with need_setup (no silent openclaw)", () => {
  const route = decideAgentRoute({
    brainChannel: "api",
    brainReady: false,
    brainReason: "缺少 Key",
    runtimeMode: "openclaw",
  });
  assert.equal(route.action, "need_setup");
  assert.equal(route.executor, "brain");
  assert.ok(route.choices.includes("configure_brain"));
});

test("api brain ready uses brain even if runtimeMode is openclaw", () => {
  const route = decideAgentRoute({
    brainChannel: "api",
    brainReady: true,
    runtimeMode: "openclaw",
  });
  assert.equal(route.action, "use");
  assert.equal(route.executor, "brain");
});

test("openclaw unavailable without auto-fallback stays unavailable", () => {
  const route = decideAgentRoute({
    brainChannel: "builtin",
    brainReady: false,
    runtimeMode: "openclaw",
    openclawAvailable: false,
    allowAutoFallback: false,
  });
  assert.equal(route.action, "unavailable");
  assert.equal(route.executor, "openclaw");
});

test("openclaw unavailable with allowAutoFallback may use pai", () => {
  const route = decideAgentRoute({
    brainChannel: "builtin",
    brainReady: false,
    runtimeMode: "openclaw",
    openclawAvailable: false,
    allowAutoFallback: true,
  });
  assert.equal(route.action, "use");
  assert.equal(route.executor, "pai");
  assert.equal(route.via, "auto_fallback");
});

test("unset runtime + unset brain → first_run", () => {
  const route = decideAgentRoute({
    brainChannel: "unset",
    brainReady: false,
    runtimeMode: "unset",
  });
  assert.equal(route.action, "first_run");
});

test("help with builtin → tutorial without blocking openclaw path for non-help", () => {
  const help = decideAgentRoute({
    brainChannel: "builtin",
    brainReady: false,
    runtimeMode: "openclaw",
    isHelpQuestion: true,
  });
  assert.equal(help.action, "tutorial");
});

test("resolveExecutorLabel and banner rules for public default", () => {
  assert.equal(
    resolveExecutorLabel({
      brainChannel: "builtin",
      brainReady: false,
      runtimeMode: "openclaw",
    }),
    "openclaw"
  );
  assert.equal(
    shouldShowBrainSetupBanner({
      brainChannel: "builtin",
      brainReady: false,
      runtimeMode: "openclaw",
    }),
    false
  );
  assert.equal(
    shouldShowBrainSetupBanner({
      brainChannel: "api",
      brainReady: false,
      runtimeMode: "openclaw",
    }),
    true
  );
});
