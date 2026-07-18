const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { PermissionProxy } = require("../src/main/openclaw/permissions");
const { PermissionGrants } = require("../src/main/permission-grants");
const { exportBackupPack, importBackupPack } = require("../src/main/data-center");
const { SkillRuntime } = require("../src/main/skills/runtime");
const { DEFAULT_SETTINGS } = require("../src/main/settings");
const { METHOD_CANDIDATES } = require("../src/main/openclaw/methods-adapter");

test("v2 defaults: OpenClaw runtime + enabled", () => {
  assert.equal(DEFAULT_SETTINGS.agentRuntimeMode, "openclaw");
  assert.equal(DEFAULT_SETTINGS.openclawEnabled, true);
});

test("v2 chat is default home in app.js + index.html", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  assert.match(appJs, /let currentPage = "chat"/);
  assert.match(html, /id="view-chat"[^>]*class="view is-active"/);
  assert.match(html, /data-nav="chat"[^>]*is-active|is-active"[^>]*data-nav="chat"/);
  assert.ok(html.includes("概览"));
  assert.ok(html.includes('id="view-permissions"'));
  assert.ok(html.includes('id="view-channels"'));
  assert.ok(html.includes("data-backup-btn") || html.includes('id="data-backup-btn"'));
});

test("methods-adapter includes sessions.list candidates", () => {
  assert.ok(Array.isArray(METHOD_CANDIDATES.sessionList));
  assert.ok(METHOD_CANDIDATES.sessionList.includes("sessions.list"));
});

test("L2 grant remembers; L3 always reconfirms; revoke works", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-grants-"));
  const grants = new PermissionGrants(path.join(dir, "permission-grants.json"));
  let askCount = 0;
  const proxy = new PermissionProxy({
    isDesktopOnline: () => true,
    hasConfirmUi: () => true,
    grants,
    timeoutMs: 2000,
    askUser: ({ requestId }) => {
      askCount += 1;
      setTimeout(() => proxy.respond(requestId, true, "ok"), 0);
    },
  });

  const first = await proxy.requestPermission({ tool: "mogu.pc.open", action: "打开", riskLevel: 2 });
  assert.equal(first.allowed, true);
  assert.equal(first.reason, "approved");
  assert.equal(askCount, 1);

  const second = await proxy.requestPermission({ tool: "mogu.pc.open", action: "打开", riskLevel: 2 });
  assert.equal(second.allowed, true);
  assert.equal(second.reason, "grant_remembered");
  assert.equal(askCount, 1);

  const listed = await grants.list();
  assert.ok(listed.some((g) => g.tool === "mogu.pc.open" && !g.revoked));
  await grants.revoke(listed[0].id);

  const third = await proxy.requestPermission({ tool: "mogu.pc.open", action: "打开", riskLevel: 2 });
  assert.equal(third.reason, "approved");
  assert.equal(askCount, 2);

  // Even with a high grant on disk, L3 must ask again
  await grants.grant({ tool: "mogu.pc.delete", riskLevel: 3, action: "delete" });
  const l3 = await proxy.requestPermission({
    tool: "mogu.pc.delete",
    action: "删除文件 x",
    riskLevel: 3,
  });
  assert.equal(l3.allowed, true);
  assert.equal(l3.reason, "approved");
  assert.equal(askCount, 3);
});

test("backup pack round-trip excludes secrets and tokens", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-bak-ud-"));
  await fs.writeJson(path.join(userData, "tasks.json"), {
    schemaVersion: 2,
    tasks: [{ moguTaskId: "t1", status: "succeeded" }],
  });
  await fs.writeJson(path.join(userData, "permission-grants.json"), {
    schemaVersion: 1,
    grants: [{ id: "g1", tool: "x", maxRiskLevel: 2, revoked: false }],
  });
  await fs.writeJson(path.join(userData, "secrets.json"), {
    openclawGatewayToken: "SECRET_TOKEN_VALUE",
    agentApiKey: "SECRET_KEY",
  });
  await fs.ensureDir(path.join(userData, "chat-sessions"));
  await fs.writeJson(path.join(userData, "chat-sessions", "s1.json"), { id: "s1", messages: [] });

  const out = path.join(userData, "backup-out");
  const exported = await exportBackupPack({
    userData,
    settingsPublic: {
      agentRuntimeMode: "openclaw",
      openclawGatewayToken: "SHOULD_STRIP",
      agentApiKey: "SHOULD_STRIP",
      skillsEnabled: { "mogu.comfy": true },
    },
    destDir: out,
  });
  assert.equal(exported.ok, true);
  assert.equal(await fs.pathExists(path.join(out, "secrets.json")), false);
  assert.equal(await fs.pathExists(path.join(out, "tasks.json")), true);
  assert.equal(await fs.pathExists(path.join(out, "permission-grants.json")), true);
  const pub = await fs.readJson(path.join(out, "settings.public.json"));
  assert.equal(pub.openclawGatewayToken, undefined);
  assert.equal(pub.agentApiKey, undefined);
  assert.equal(pub.skillsEnabled["mogu.comfy"], true);
  const dump = JSON.stringify(await fs.readJson(path.join(out, "manifest.json")));
  assert.equal(dump.includes("SECRET_TOKEN"), false);

  const restoreUd = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-bak-restore-"));
  await fs.writeJson(path.join(restoreUd, "settings.json"), {
    agentApiKey: "keep-local",
    openclawGatewayToken: "keep-local-token",
  });
  const imported = await importBackupPack({ backupDir: out, userData: restoreUd });
  assert.equal(imported.ok, true);
  assert.equal(await fs.pathExists(path.join(restoreUd, "tasks.json")), true);
  assert.equal(await fs.pathExists(path.join(restoreUd, "secrets.json")), false);
  const restoredSettings = await fs.readJson(path.join(restoreUd, "settings.json"));
  assert.equal(restoredSettings.agentApiKey, "");
  assert.equal(restoredSettings.openclawGatewayToken, undefined);
  assert.equal(restoredSettings.agentRuntimeMode, "openclaw");
});

test("skills whitelist list + install enables skill", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mogu-wl-"));
  const settings = { skillsEnabled: {} };
  const runtime = new SkillRuntime({
    userDataPath: dir,
    getSettings: async () => settings,
    updateSettings: async (partial) => Object.assign(settings, partial),
    taskStore: { create: async () => ({}), update: async () => ({}) },
    permissionProxy: null,
    paiBridge: {},
    ollama: {},
  });
  const listed = await runtime.listWhitelist();
  assert.equal(listed.ok, true);
  assert.ok(listed.skills.some((s) => s.id === "mogu.comfy"));

  const bad = await runtime.installFromWhitelist("evil.skill");
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "not_in_whitelist");

  const ok = await runtime.installFromWhitelist("mogu.comfy");
  assert.equal(ok.ok, true);
  assert.equal(settings.skillsEnabled["mogu.comfy"], true);
  assert.equal(await fs.pathExists(path.join(dir, "skills-ext", "mogu.comfy", "SKILL.md")), true);
});
