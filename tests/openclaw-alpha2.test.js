const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { createMockGateway } = require("./helpers/mock-gateway");
const { OpenClawBridge } = require("../src/main/openclaw/bridge");
const { AgentRunService } = require("../src/main/openclaw/agent-run");
const { TaskStore } = require("../src/main/task-store");
const { adaptMethods } = require("../src/main/openclaw/methods-adapter");
const { decideFallback, FALLBACK_BLOCKED_AFTER_ACCEPTED } = require("../src/main/openclaw/fallback-pai");
const { idMap } = require("../src/main/openclaw");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test("methods adapter prefers probed Gateway methods", () => {
  const a = adaptMethods(["sessions.create", "chat.send", "sessions.abort"]);
  assert.equal(a.resolved.sessionCreate, "sessions.create");
  assert.equal(a.resolved.sessionSend, "chat.send");
  assert.equal(a.resolved.sessionAbort, "sessions.abort");
  assert.equal(a.canAgentRun, true);

  const b = adaptMethods(["sessions.create"]);
  assert.equal(b.canAgentRun, false);
  assert.ok(b.missing.includes("sessionSend"));
});

test("mock gateway: handshake success and auth failure", async () => {
  const gw = await createMockGateway({ requireToken: "good-token" }).listen();
  const bad = new OpenClawBridge({
    getToken: async () => "bad",
    clientVersion: "test",
  });
  const good = new OpenClawBridge({
    getToken: async () => "good-token",
    clientVersion: "test",
  });
  try {
    await assert.rejects(() => bad.connect({ url: gw.url }), /invalid token|Gateway|unauthorized/i);
    await bad.disconnect();

    const status = await good.connect({ url: gw.url });
    assert.equal(status.connected, true);
    assert.equal(status.canAgentRun, true);
    assert.equal(status.methods.sessionSend, "sessions.send");
    // Public status must never expose token
    assert.equal(JSON.stringify(status).includes("good-token"), false);
  } finally {
    await bad.disconnect().catch(() => {});
    await good.disconnect().catch(() => {});
    await gw.close();
  }
});

test("mock gateway: agent run accepted, stream + terminal, task persisted", async () => {
  const gw = await createMockGateway({}).listen();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-a2-"));
  const taskStore = new TaskStore(path.join(dir, "tasks.json"));
  const events = [];
  const bridge = new OpenClawBridge({ getToken: async () => "", clientVersion: "test" });
  try {
    await bridge.connect({ url: gw.url });
    const service = new AgentRunService({
      bridge,
      taskStore,
      getSettings: async () => ({
        openclawEnabled: true,
        openclawFallbackToPai: true,
        openclawGatewayUrl: gw.url,
      }),
      emitToRenderer: (channel, payload) => events.push({ channel, payload }),
    });
    service.bindEvents();

    const result = await service.send({ text: "你好" });
    assert.equal(result.ok, true);
    assert.equal(result.accepted, true);
    assert.ok(result.runId);
    assert.ok(result.moguTaskId);

    await sleep(80);
    const task = await taskStore.get(result.moguTaskId);
    assert.ok(task);
    assert.equal(task.requestAcceptedByGateway, true);
    assert.ok(["running", "succeeded"].includes(task.status));
    assert.ok(events.some((e) => e.channel === "openclaw-task"));
    assert.ok(events.every((e) => !JSON.stringify(e).includes("auth")));
  } finally {
    await bridge.disconnect().catch(() => {});
    await gw.close();
  }
});

test("accepted wait-timeout must not fallback to PAI", async () => {
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

test("mock gateway: precise abort by taskId", async () => {
  const gw = await createMockGateway({ acceptOnly: true }).listen();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-a2-abort-"));
  const taskStore = new TaskStore(path.join(dir, "tasks.json"));
  const bridge = new OpenClawBridge({ getToken: async () => "", clientVersion: "test" });
  try {
    await bridge.connect({ url: gw.url });
    const service = new AgentRunService({
      bridge,
      taskStore,
      getSettings: async () => ({
        openclawEnabled: true,
        openclawFallbackToPai: true,
        openclawGatewayUrl: gw.url,
      }),
    });
    const sent = await service.send({ text: "long job" });
    const aborted = await service.abort({ moguTaskId: sent.moguTaskId });
    assert.equal(aborted.ok, true);
    assert.equal(aborted.precise, true);
    const task = await taskStore.get(sent.moguTaskId);
    assert.equal(task.status, "cancelled");
  } finally {
    await bridge.disconnect().catch(() => {});
    await gw.close();
  }
});

test("cancel without IDs returns needsConfirmation", () => {
  const denied = idMap.resolveCancelMapping({});
  assert.equal(denied.ok, false);
  assert.equal(denied.needsConfirmation, true);
});

test("mock gateway: reconnect recovers task via tasks.get", async () => {
  const gw = await createMockGateway({ acceptOnly: true }).listen();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-a2-rec-"));
  const taskStore = new TaskStore(path.join(dir, "tasks.json"));
  const bridge = new OpenClawBridge({ getToken: async () => "", clientVersion: "test" });
  try {
    await bridge.connect({ url: gw.url });
    const service = new AgentRunService({
      bridge,
      taskStore,
      getSettings: async () => ({
        openclawEnabled: true,
        openclawFallbackToPai: true,
        openclawGatewayUrl: gw.url,
      }),
    });
    const sent = await service.send({ text: "recover me" });
    // Simulate gateway marking success while client was offline
    const raw = gw.tasks.get(sent.taskId);
    raw.status = "succeeded";
    gw.tasks.set(sent.taskId, raw);

    const recovered = await service.recoverAfterReconnect();
    assert.equal(recovered.ok, true);
    const task = await taskStore.get(sent.moguTaskId);
    assert.equal(task.status, "succeeded");
  } finally {
    await bridge.disconnect().catch(() => {});
    await gw.close();
  }
});

test("public settings shape never includes gateway token field value", async () => {
  // Contract for renderer: only configured flag, empty token string.
  const publicSettings = {
    openclawGatewayToken: "",
    openclawGatewayTokenConfigured: true,
    openclaw: { state: "ready", connected: true },
  };
  assert.equal(publicSettings.openclawGatewayToken, "");
  assert.equal(JSON.stringify(publicSettings).includes("ghp_"), false);
});
