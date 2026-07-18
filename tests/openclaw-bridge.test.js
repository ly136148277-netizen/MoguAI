const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseFrame,
  encodeRequest,
  buildConnectParams,
  summarizeHelloOk,
  normalizeGatewayEvent,
} = require("../src/main/openclaw/protocol");
const { resolveCancelMapping, applyIds, createEmptyMapping } = require("../src/main/openclaw/id-map");
const { decideFallback, FALLBACK_BLOCKED_AFTER_ACCEPTED } = require("../src/main/openclaw/fallback-pai");
const { TaskStore } = require("../src/main/task-store");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

test("protocol encode/parse roundtrip", () => {
  const raw = encodeRequest("sessions.list", { limit: 1 }, "id-1");
  const parsed = parseFrame(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.frame.type, "req");
  assert.equal(parsed.frame.method, "sessions.list");
});

test("buildConnectParams includes operator scopes and optional token", () => {
  const withToken = buildConnectParams({ token: "secret", clientVersion: "1.6.0-alpha.1" });
  assert.equal(withToken.role, "operator");
  assert.deepEqual(withToken.scopes, ["operator.read", "operator.write"]);
  assert.equal(withToken.auth.token, "secret");
  // Must match OpenClaw gateway-protocol enums (not free-form "mogu-ai" / "operator").
  assert.equal(withToken.client.id, "gateway-client");
  assert.equal(withToken.client.mode, "backend");
  const noToken = buildConnectParams({});
  assert.equal(noToken.auth, undefined);
});

test("summarizeHelloOk strips to public fields", () => {
  const hello = summarizeHelloOk({
    protocol: 4,
    server: { version: "2026.1.0", connId: "c1" },
    features: { methods: ["a"], events: ["b"] },
    auth: { role: "operator", scopes: ["operator.read"] },
  });
  assert.equal(hello.serverVersion, "2026.1.0");
  assert.equal(hello.methods.length, 1);
});

test("normalizeGatewayEvent never requires token fields", () => {
  const ev = normalizeGatewayEvent({
    type: "event",
    event: "agent",
    payload: { runId: "r1", text: "hi", auth: { token: "nope" } },
  });
  assert.equal(ev.runId, "r1");
  assert.equal(ev.text, "hi");
  assert.equal(ev.kind, "agent_delta");
});

test("resolveCancelMapping refuses guessing without IDs", () => {
  const denied = resolveCancelMapping({});
  assert.equal(denied.ok, false);
  assert.equal(denied.needsConfirmation, true);

  const mapping = applyIds(createEmptyMapping("t1"), { runId: "r1" });
  const ok = resolveCancelMapping({ mapping });
  assert.equal(ok.ok, true);
  assert.equal(ok.mapping.runId, "r1");
});

test("decideFallback blocks PAI resubmit after Gateway accept + wait timeout", () => {
  const decision = decideFallback({
    openclawEnabled: true,
    fallbackToPai: true,
    bridgeState: "ready",
    requestAcceptedByGateway: true,
    waitTimedOut: true,
  });
  assert.equal(decision.usePai, false);
  assert.equal(decision.reason, FALLBACK_BLOCKED_AFTER_ACCEPTED);
});

test("decideFallback allows PAI when bridge disconnected and not accepted", () => {
  const decision = decideFallback({
    openclawEnabled: true,
    fallbackToPai: true,
    bridgeState: "disconnected",
    requestAcceptedByGateway: false,
  });
  assert.equal(decision.usePai, true);
});

test("TaskStore persists unified task model", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-tasks-"));
  const store = new TaskStore(path.join(dir, "tasks.json"));
  const created = await store.create({
    source: "studio",
    name: "出片",
    promptId: "p1",
    status: "running",
  });
  assert.ok(created.moguTaskId);
  const listed = await store.list();
  assert.equal(listed.length, 1);
  const updated = await store.update(created.moguTaskId, {
    status: "succeeded",
    runId: "r9",
    outputPaths: ["C:\\out\\a.mp4"],
  });
  assert.equal(updated.status, "succeeded");
  assert.equal(updated.runId, "r9");
  assert.ok(updated.terminalAt);

  const store2 = new TaskStore(path.join(dir, "tasks.json"));
  const again = await store2.get(created.moguTaskId);
  assert.equal(again.promptId, "p1");
  assert.equal(again.outputPaths[0], "C:\\out\\a.mp4");
});
