/**
 * v1.6 beta soak — automated gates that must stay green before stable.
 * Covers: Gateway round-trip, task recover/cancel, permission fail-closed, public safety.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { createMockGateway } = require("./helpers/mock-gateway");
const { OpenClawBridge } = require("../src/main/openclaw/bridge");
const { AgentRunService } = require("../src/main/openclaw/agent-run");
const { TaskStore } = require("../src/main/task-store");
const { PermissionProxy } = require("../src/main/openclaw/permissions");
const { PermissionAudit } = require("../src/main/openclaw/permission-audit");
const { gateCommand } = require("../src/main/permission-gate");
const { decideFallback, FALLBACK_BLOCKED_AFTER_ACCEPTED } = require("../src/main/openclaw/fallback-pai");
const { toPublicTask } = require("../src/main/task-public");
const { exportDiagnosticPack } = require("../src/main/data-center");
const { classifyLifecycle } = require("../src/main/openclaw/lifecycle");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test("beta: OpenClaw chat round-trip persists terminal task", async () => {
  const gw = await createMockGateway({}).listen();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-beta-rt-"));
  const taskStore = new TaskStore(path.join(dir, "tasks.json"));
  const events = [];
  const bridge = new OpenClawBridge({ getToken: async () => "", clientVersion: "beta" });
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

    const sent = await service.send({ text: "beta round-trip" });
    assert.equal(sent.accepted, true);
    assert.ok(sent.moguTaskId);
    assert.ok(sent.runId);

    await sleep(120);
    const task = await taskStore.get(sent.moguTaskId);
    assert.equal(task.requestAcceptedByGateway, true);
    assert.ok(["running", "succeeded"].includes(task.status));
    assert.ok(task.replay?.kind === "openclaw.send");
    assert.ok(events.some((e) => e.channel === "openclaw-task"));
    assert.ok(events.every((e) => !JSON.stringify(e).includes("token")));
  } finally {
    await bridge.disconnect().catch(() => {});
    await gw.close();
  }
});

test("beta: disconnect then recoverAfterReconnect syncs terminal status", async () => {
  const gw = await createMockGateway({ acceptOnly: true }).listen();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-beta-rec-"));
  const file = path.join(dir, "tasks.json");
  const bridge = new OpenClawBridge({ getToken: async () => "", clientVersion: "beta" });
  try {
    await bridge.connect({ url: gw.url });
    const store = new TaskStore(file);
    const service = new AgentRunService({
      bridge,
      taskStore: store,
      getSettings: async () => ({
        openclawEnabled: true,
        openclawFallbackToPai: true,
        openclawGatewayUrl: gw.url,
      }),
    });
    const sent = await service.send({ text: "recover beta" });
    const raw = gw.tasks.get(sent.taskId);
    raw.status = "succeeded";
    gw.tasks.set(sent.taskId, raw);

    // Simulate app restart: new store + same gateway session data
    const store2 = new TaskStore(file);
    const service2 = new AgentRunService({
      bridge,
      taskStore: store2,
      getSettings: async () => ({
        openclawEnabled: true,
        openclawGatewayUrl: gw.url,
      }),
    });
    const recovered = await service2.recoverAfterReconnect();
    assert.equal(recovered.ok, true);
    const task = await store2.get(sent.moguTaskId);
    assert.equal(task.status, "succeeded");
  } finally {
    await bridge.disconnect().catch(() => {});
    await gw.close();
  }
});

test("beta: precise cancel by taskId after accept", async () => {
  const gw = await createMockGateway({ acceptOnly: true }).listen();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-beta-cancel-"));
  const bridge = new OpenClawBridge({ getToken: async () => "", clientVersion: "beta" });
  try {
    await bridge.connect({ url: gw.url });
    const store = new TaskStore(path.join(dir, "tasks.json"));
    const service = new AgentRunService({
      bridge,
      taskStore: store,
      getSettings: async () => ({
        openclawEnabled: true,
        openclawGatewayUrl: gw.url,
      }),
    });
    const sent = await service.send({ text: "cancel me" });
    const aborted = await service.abort({ moguTaskId: sent.moguTaskId });
    assert.equal(aborted.ok, true);
    assert.equal(aborted.precise, true);
    const task = await store.get(sent.moguTaskId);
    assert.equal(task.status, "cancelled");
  } finally {
    await bridge.disconnect().catch(() => {});
    await gw.close();
  }
});

test("beta: accepted wait-timeout never falls back to PAI", () => {
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

test("beta: L3 permission fail-closed without UI; allow only after respond", async () => {
  const noUi = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => false,
  });
  const blocked = await gateCommand(noUi, "删除文件 important.txt");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requiredLevel, 3);

  const proxy = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    timeoutMs: 2000,
    askUser: ({ requestId }) => proxy.respond(requestId, true),
  });
  const allowed = await gateCommand(proxy, "删除文件 important.txt");
  assert.equal(allowed.allowed, true);
});

test("beta: multi-source task list + public payload scrub", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-beta-list-"));
  const store = new TaskStore(path.join(dir, "tasks.json"));
  await store.create({ source: "openclaw", name: "oc", status: "running", runId: "r1" });
  await store.create({ source: "studio", name: "st", status: "failed", promptId: "p1", replay: { kind: "studio.run" } });
  await store.create({ source: "pai", name: "pai", status: "succeeded" });
  await store.create({ source: "comfy", name: "cf", status: "queued", promptId: "p2" });

  const page = await store.listPage({ limit: 50 });
  assert.equal(page.total, 4);
  const sources = new Set(page.tasks.map((t) => t.source));
  assert.ok(sources.has("openclaw") && sources.has("studio") && sources.has("pai") && sources.has("comfy"));

  const dirty = toPublicTask({
    ...page.tasks[0],
    token: "leak",
    auth: { token: "x" },
  });
  assert.equal(JSON.stringify(dirty).includes("leak"), false);
});

test("beta: diagnostic export never ships secrets.json or token fields", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-beta-diag-"));
  await fs.writeJson(path.join(userData, "secrets.json"), { openclawGatewayToken: "SECRET" });
  await fs.writeJson(path.join(userData, "tasks.json"), { schemaVersion: 2, tasks: [] });
  const out = path.join(userData, "out");
  const pack = await exportDiagnosticPack({
    userData,
    settingsPublic: { openclawGatewayToken: "", openclawGatewayTokenConfigured: true },
    destDir: out,
  });
  assert.equal(pack.ok, true);
  assert.equal(await fs.pathExists(path.join(out, "secrets.json")), false);
  const pub = await fs.readJson(path.join(out, "settings.public.json"));
  assert.equal(pub.openclawGatewayToken, "");
});

test("beta: lifecycle disabled vs connected classification", () => {
  const disabled = classifyLifecycle({
    enabled: false,
    probe: { reachable: true },
    bridgeStatus: { state: "ready", connected: true },
  });
  assert.equal(disabled.lifecycle, "disabled");

  const connected = classifyLifecycle({
    enabled: true,
    probe: { reachable: true },
    bridgeStatus: { state: "ready", connected: true, hello: { serverVersion: "1.0.0" } },
  });
  assert.equal(connected.lifecycle, "connected");
});

test("beta: permission audit records high-risk deny", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-beta-audit-"));
  const audit = new PermissionAudit(path.join(dir, "permission-audit.jsonl"));
  const proxy = new PermissionProxy({
    isDesktopOnline: () => false,
    audit,
  });
  await proxy.requestPermission({ tool: "pai.command", action: "删除文件 x", riskLevel: 3 });
  const rows = await audit.list({ limit: 5 });
  assert.equal(rows[0].allowed, false);
  assert.equal(rows[0].reason, "desktop_offline");
});
