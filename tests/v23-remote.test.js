const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_SETTINGS,
  sanitizeRemoteSettings,
  sanitizeRemoteOwner,
} = require("../src/main/settings");
const { TaskStore } = require("../src/main/task-store");
const {
  RemoteManager,
  inferCapability,
  assertRemoteOwner,
  isRemoteChannelEnabled,
} = require("../src/main/remote");
const { progressBar } = require("../src/main/remote/RemoteTaskQueue");

test("remote settings default off and accept nested channel objects", () => {
  assert.equal(DEFAULT_SETTINGS.remote.enabled, false);
  assert.equal(DEFAULT_SETTINGS.remote.telegram.enabled, false);
  assert.equal(DEFAULT_SETTINGS.remote.allowAutoExecute, false);
  assert.equal(DEFAULT_SETTINGS.remoteOwner.telegramUserId, "");
  const nested = sanitizeRemoteSettings({
    enabled: true,
    telegram: { enabled: true },
    qq: { enabled: false },
    wechat: false,
  });
  assert.equal(nested.enabled, true);
  assert.equal(nested.telegram.enabled, true);
  assert.equal(isRemoteChannelEnabled(nested, "telegram"), true);
  assert.equal(isRemoteChannelEnabled(nested, "qq"), false);
  const flat = sanitizeRemoteSettings({ telegram: true });
  assert.equal(flat.telegram.enabled, true);
  const dirty = sanitizeRemoteSettings({
    enabled: "true",
    telegram: 1,
    allowAutoExecute: "yes",
    requireApproval: false,
  });
  assert.equal(dirty.enabled, false);
  assert.equal(dirty.telegram.enabled, false);
  assert.equal(dirty.allowAutoExecute, false);
  assert.equal(dirty.requireApproval, false);
  assert.equal(sanitizeRemoteOwner({ telegramUserId: " 123 " }).telegramUserId, "123");
});

test("owner binding rejects strangers and unconfigured owners", () => {
  const settings = {
    remoteOwner: sanitizeRemoteOwner({ telegramUserId: "111" }),
  };
  assert.equal(assertRemoteOwner(settings, { channel: "telegram", userId: "111" }).ok, true);
  assert.equal(assertRemoteOwner(settings, { channel: "telegram", userId: "222" }).reason, "owner_mismatch");
  assert.equal(
    assertRemoteOwner({ remoteOwner: {} }, { channel: "telegram", userId: "111" }).reason,
    "owner_not_configured"
  );
  assert.equal(assertRemoteOwner(settings, { channel: "mock", userId: "x" }).ok, true);
});

test("adapters never expose brain/skill methods", () => {
  const { TelegramAdapter, QQAdapter, WeChatAdapter } = require("../src/main/remote");
  for (const Adapter of [TelegramAdapter, QQAdapter, WeChatAdapter]) {
    const adapter = new Adapter({ simulate: true });
    assert.equal(typeof adapter.receive, "function");
    assert.equal(typeof adapter.send, "function");
    assert.equal(typeof adapter.upload, "function");
    assert.equal(typeof adapter.download, "function");
    assert.equal(adapter.invoke, undefined);
    assert.equal(adapter.submitTask, undefined);
  }
});

test("remote pipeline uses permission + task store + skill runtime only", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-v23-unit-"));
  const taskStore = new TaskStore(path.join(root, "tasks.json"));
  const gates = [];
  const skills = [];
  const manager = new RemoteManager({
    getSettings: async () => ({
      remote: sanitizeRemoteSettings({
        enabled: true,
        telegram: { enabled: true },
        requireApproval: false,
      }),
      remoteOwner: sanitizeRemoteOwner({ telegramUserId: "u1" }),
    }),
    permissionProxy: {
      async requestPermission(req) {
        gates.push(req);
        return { ok: true, allowed: true, reason: "ok", requestId: "p1", riskLevel: 1 };
      },
    },
    taskStore,
    skillRuntime: {
      async invoke(skillId, op, args) {
        skills.push({ skillId, op, args });
        return { ok: true, text: "unit-ok" };
      },
    },
  });
  try {
    await manager.start();
    const denied = await manager.submitTask({
      channel: "telegram",
      userId: "stranger",
      conversationId: "c0",
      text: "hello",
      capability: "READ",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "owner_mismatch");
    const result = await manager.submitTask({
      channel: "telegram",
      userId: "u1",
      conversationId: "c1",
      text: "hello remote",
      capability: "READ",
    });
    assert.equal(result.ok, true);
    assert.equal(gates.length, 1);
    assert.match(String(gates[0].channel), /^remote:/);
    assert.equal(skills.length, 1);
    assert.equal(result.result.status, "succeeded");
    const status = await manager.inject({
      channel: "telegram",
      userId: "u1",
      conversationId: "c1",
      command: "/status",
      text: "",
    });
    assert.equal(status.ok, true);
    assert.match(status.text, /MOGU Remote Status/);
  } finally {
    await manager.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("capability inference and progress bar", () => {
  assert.equal(inferCapability("删除文件", ""), "DELETE");
  assert.equal(inferCapability("修改并提交", ""), "WRITE");
  assert.equal(inferCapability("运行测试", ""), "RUN");
  assert.equal(inferCapability("查一下状态", ""), "READ");
  assert.match(progressBar(72), /72%/);
});
