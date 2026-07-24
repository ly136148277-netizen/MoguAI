#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_SETTINGS, sanitizeRemoteSettings } = require("../src/main/settings");
const { TaskStore } = require("../src/main/task-store");
const { RemoteManager } = require("../src/main/remote");

const ROOT = path.join(__dirname, "..");
const RESULT_DIR = path.join(ROOT, "benchmarks", "v2.3", "results");
const checks = [];

function check(id, condition, detail = "") {
  const ok = Boolean(condition);
  checks.push({ id, ok, detail: String(detail || "") });
  const line = `[${ok ? "PASS" : "FAIL"}] ${id}${detail ? ` — ${detail}` : ""}`;
  (ok ? console.log : console.error)(line);
}

function hasFile(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

function createHarness(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-v23-"));
  const taskStore = new TaskStore(path.join(root, "tasks.json"));
  const decisions = [];
  const permissionProxy = {
    async requestPermission(req = {}) {
      decisions.push(req);
      return {
        ok: true,
        allowed: true,
        reason: "test_allow",
        requestId: `perm-${decisions.length}`,
        riskLevel: req.riskLevel || 1,
      };
    },
    respond() {
      return true;
    },
  };
  let settings = {
    ...DEFAULT_SETTINGS,
    remote: sanitizeRemoteSettings({
      enabled: true,
      telegram: { enabled: true },
      qq: { enabled: true },
      wechat: { enabled: true },
      requireApproval: true,
      allowAutoExecute: false,
      ...overrides.remote,
    }),
    remoteOwner: {
      telegramUserId: "telegram-user",
      qqUserId: "qq-user",
      wechatUserId: "wechat-user",
      ...(overrides.remoteOwner || {}),
    },
  };
  const skillCalls = [];
  const manager = new RemoteManager({
    getSettings: async () => settings,
    permissionProxy,
    taskStore,
    adminResponder: overrides.adminResponder || (async () => ({ decision: "YES" })),
    skillRuntime: {
      async invoke(skillId, op, args, meta) {
        skillCalls.push({ skillId, op, args, meta });
        if (overrides.slowMs) {
          await new Promise((resolve) => setTimeout(resolve, overrides.slowMs));
        }
        return { ok: true, text: `executed:${skillId}:${op}:${args?.text || ""}` };
      },
    },
  });
  return {
    root,
    taskStore,
    manager,
    skillCalls,
    decisions,
    setSettings(next) {
      settings = {
        ...settings,
        ...next,
        remote: sanitizeRemoteSettings(next.remote || settings.remote),
        remoteOwner: { ...settings.remoteOwner, ...(next.remoteOwner || {}) },
      };
    },
    async cleanup() {
      await manager.stop();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function runPipeline(channel) {
  const harness = createHarness();
  try {
    await harness.manager.start();
    const adapter = harness.manager.getAdapter(channel);
    check(`${channel}:adapter-started`, Boolean(adapter), channel);
    await adapter.receive({
      text: "/task 分析这段代码的结构",
      from: { id: `${channel}-user` },
      chat: { id: `${channel}-chat` },
      message_id: 1,
      userId: `${channel}-user`,
      conversationId: `${channel}-chat`,
    });
    const submitted = await harness.manager.inject({
      channel,
      userId: `${channel}-user`,
      conversationId: `${channel}-chat`,
      command: "/task",
      text: "分析这段代码的结构",
    });
    check(`${channel}:submit`, submitted.ok === true && submitted.task?.moguTaskId, submitted.reason || "");
    check(
      `${channel}:permission`,
      harness.decisions.some((item) => String(item.channel || "").startsWith("remote:")),
      "remote channel gate"
    );
    check(`${channel}:skill`, harness.skillCalls.length >= 1, `calls=${harness.skillCalls.length}`);
    check(
      `${channel}:result`,
      submitted.result?.status === "succeeded" && /executed:/.test(submitted.result?.markdown || ""),
      submitted.result?.status
    );
    const sent = adapter.getSent?.() || [];
    check(`${channel}:outbox`, sent.length >= 1 || harness.manager.outbox.list().length >= 1, `sent=${sent.length}`);
    return submitted;
  } finally {
    await harness.cleanup();
  }
}

async function runCancel() {
  const harness = createHarness({
    remote: { requireApproval: false },
    remoteOwner: { telegramUserId: "u-cancel", qqUserId: "qq-user", wechatUserId: "wechat-user" },
    slowMs: 200,
  });
  try {
    await harness.manager.start();
    const pending = harness.manager.submitTask({
      channel: "telegram",
      userId: "u-cancel",
      conversationId: "c-cancel",
      text: "长期任务",
      capability: "READ",
      skillId: "mogu.memory",
      op: "recall",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const cancel = await harness.manager.inject({
      channel: "telegram",
      userId: "u-cancel",
      conversationId: "c-cancel",
      command: "/cancel",
      text: "",
    });
    const finished = await pending;
    check("cancel:command", cancel.ok === true, cancel.reason || "");
    check(
      "cancel:terminal",
      finished.cancelled === true || finished.result?.status === "cancelled",
      finished.result?.status || ""
    );
  } finally {
    await harness.cleanup();
  }
}

async function runApproval() {
  let sawPrompt = false;
  const harness = createHarness({
    remote: { requireApproval: true, allowAutoExecute: false },
    remoteOwner: { telegramUserId: "admin-user", qqUserId: "qq-user", wechatUserId: "wechat-user" },
    adminResponder: async () => {
      sawPrompt = true;
      return { decision: "YES" };
    },
  });
  try {
    await harness.manager.start();
    const submitted = await harness.manager.submitTask({
      channel: "telegram",
      userId: "admin-user",
      conversationId: "admin-chat",
      text: "修改并提交补丁",
      capability: "WRITE",
      skillId: "mogu.memory",
      op: "recall",
    });
    check("approval:prompt", sawPrompt === true);
    check("approval:pass", submitted.ok === true && submitted.result?.status === "succeeded", submitted.reason || "");
  } finally {
    await harness.cleanup();
  }
}

async function runRecoveryAndLog() {
  const harness = createHarness({
    remote: { requireApproval: false },
    remoteOwner: { telegramUserId: "telegram-user", qqUserId: "u-log", wechatUserId: "wechat-user" },
  });
  try {
    await harness.manager.start();
    const first = await harness.manager.inject({
      channel: "qq",
      userId: "u-log",
      conversationId: "c-log",
      command: "/task",
      text: "第一次任务",
      capability: "READ",
    });
    const retry = await harness.manager.inject({
      channel: "qq",
      userId: "u-log",
      conversationId: "c-log",
      command: "/retry",
      text: "",
    });
    const log = await harness.manager.inject({
      channel: "qq",
      userId: "u-log",
      conversationId: "c-log",
      command: "/log",
      text: "",
    });
    const status = await harness.manager.inject({
      channel: "qq",
      userId: "u-log",
      conversationId: "c-log",
      command: "/status",
      text: "",
    });
    check("recover:retry", retry.ok === true && retry.task?.moguTaskId, retry.reason || "");
    check("log:command", log.ok === true);
    check("log:status", status.ok === true);
    check("recover:first", first.ok === true);
  } finally {
    await harness.cleanup();
  }
}

function verifyFilesAndDefaults() {
  for (const relative of [
    "src/main/remote/RemoteManager.js",
    "src/main/remote/RemoteGateway.js",
    "src/main/remote/RemoteInbox.js",
    "src/main/remote/RemoteOutbox.js",
    "src/main/remote/RemoteSession.js",
    "src/main/remote/RemoteTypes.js",
    "src/main/remote/RemoteTaskQueue.js",
    "src/main/remote/RemoteTaskSource.js",
    "src/main/remote/adapters/TelegramAdapter.js",
    "src/main/remote/adapters/QQAdapter.js",
    "src/main/remote/adapters/WeChatAdapter.js",
    "src/main/remote/permission/RemotePermission.js",
    "src/main/remote/notification/NotificationService.js",
    "src/main/remote/remote-policy.js",
    "docs/V2.3_REMOTE_WORKSPACE.md",
    "docs/V2.3_DECISION_PACKAGE.md",
    "docs/V2.3_REMOTE_FIELD_REPORT.md",
  ]) {
    check(`file:${relative}`, hasFile(relative));
  }
  const remote = DEFAULT_SETTINGS.remote;
  check("default-off:enabled", remote?.enabled === false);
  check("default-off:telegram", remote?.telegram?.enabled === false);
  check("default-off:qq", remote?.qq?.enabled === false);
  check("default-off:wechat", remote?.wechat?.enabled === false);
  check("default-off:allowAutoExecute", remote?.allowAutoExecute === false);
  check("default-on:requireApproval", remote?.requireApproval === true);
  check("default-off:owner", DEFAULT_SETTINGS.remoteOwner?.telegramUserId === "");
}

async function main() {
  verifyFilesAndDefaults();
  await runPipeline("telegram");
  await runPipeline("qq");
  await runPipeline("wechat");
  await runCancel();
  await runApproval();
  await runRecoveryAndLog();

  const passed = checks.filter((item) => item.ok).length;
  const report = {
    schemaVersion: 1,
    kind: "mogu-v2.3-acceptance",
    status: passed === checks.length ? "PASS" : "FAIL",
    passed,
    total: checks.length,
    checks,
    completedAt: new Date().toISOString(),
  };
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULT_DIR, "acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nMOGU 2.3 acceptance: ${passed}/${checks.length} passed`);
  process.exit(report.status === "PASS" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
