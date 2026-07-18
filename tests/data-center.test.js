const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  measurePath,
  scanDataCenter,
  exportDiagnosticPack,
  planCleanup,
  executeCleanup,
} = require("../src/main/data-center");
const { classifyLifecycle, PINNED_COMPAT, getInstallGuide } = require("../src/main/openclaw/lifecycle");

test("measurePath skips secret-looking names and reports bytes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-dc-"));
  await fs.writeFile(path.join(dir, "a.txt"), "hello");
  await fs.writeFile(path.join(dir, "github.token"), "SECRET");
  const measured = await measurePath(dir, { maxDepth: 2 });
  assert.equal(measured.exists, true);
  assert.ok(measured.bytes >= 5);
  assert.ok(measured.files >= 1);
});

test("exportDiagnosticPack excludes secrets.json style names", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-ud-"));
  await fs.writeJson(path.join(userData, "tasks.json"), {
    schemaVersion: 2,
    tasks: [{ moguTaskId: "t1", source: "studio", status: "succeeded" }],
  });
  await fs.writeJson(path.join(userData, "secrets.json"), { openclawGatewayToken: "nope" });
  await fs.ensureDir(path.join(userData, "logs"));
  await fs.writeFile(path.join(userData, "logs", "app.log"), "ok");

  const out = path.join(userData, "diag-out");
  const result = await exportDiagnosticPack({
    userData,
    settingsPublic: { openclawGatewayToken: "", paiRoot: null },
    destDir: out,
  });
  assert.equal(result.ok, true);
  assert.equal(await fs.pathExists(path.join(out, "tasks.json")), true);
  assert.equal(await fs.pathExists(path.join(out, "secrets.json")), false);
  const settings = await fs.readJson(path.join(out, "settings.public.json"));
  assert.equal(settings.openclawGatewayToken, "");
});

test("cleanup execute requires confirm token", async () => {
  const denied = await executeCleanup({ actions: [], confirmToken: "nope" });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "needs_confirmation");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-clean-"));
  const logs = path.join(dir, "logs");
  await fs.ensureDir(logs);
  await fs.writeFile(path.join(logs, "x.log"), "1");
  const plan = await planCleanup({ userData: dir });
  assert.equal(plan.dryRun, true);
  const done = await executeCleanup({ actions: plan.actions, confirmToken: "CONFIRM_DELETE" });
  assert.equal(done.ok, true);
});

test("scanDataCenter returns roots and task summary", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-scan-"));
  await fs.writeJson(path.join(userData, "tasks.json"), {
    schemaVersion: 2,
    tasks: [
      { moguTaskId: "a", source: "openclaw", status: "running" },
      { moguTaskId: "b", source: "studio", status: "failed" },
    ],
  });
  const scan = await scanDataCenter({ userData, settings: {}, storageDir: userData });
  assert.equal(scan.ok, true);
  assert.ok(scan.roots.length >= 1);
  assert.equal(scan.tasksSummary.total, 2);
});

test("lifecycle classify covers offline and connected", () => {
  const offline = classifyLifecycle({
    enabled: true,
    probe: { reachable: false },
    bridgeStatus: { state: "disconnected", connected: false },
  });
  assert.equal(offline.lifecycle, "not_running");

  const connected = classifyLifecycle({
    enabled: true,
    probe: { reachable: true },
    bridgeStatus: { state: "ready", connected: true, hello: { serverVersion: "mock" } },
  });
  assert.equal(connected.lifecycle, "connected");

  const guide = getInstallGuide();
  assert.equal(guide.pinned.protocol, PINNED_COMPAT.protocol);
  assert.ok(guide.installDocsUrl);
});
