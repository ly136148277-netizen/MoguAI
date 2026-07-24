#!/usr/bin/env node
/**
 * MOGU 2.3 closure verification (offline + live-preflight).
 * Does not enable production defaults. Live Telegram without token → BLOCKED.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_SETTINGS,
  sanitizeRemoteSettings,
  sanitizeRemoteOwner,
} = require("../src/main/settings");
const { TaskStore } = require("../src/main/task-store");
const { RemoteManager, isRemoteChannelEnabled } = require("../src/main/remote");
const { QQAdapter } = require("../src/main/remote/adapters/QQAdapter");
const { WeChatAdapter } = require("../src/main/remote/adapters/WeChatAdapter");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "benchmarks", "v2.3", "results");

function write(name, value) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function createManager(remoteOverrides, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mogu-v23-close-"));
  const taskStore = new TaskStore(path.join(root, "tasks.json"));
  const audit = [];
  const ownerId = extra.ownerId || "phone-user";
  const manager = new RemoteManager({
    getSettings: async () => ({
      ...DEFAULT_SETTINGS,
      remote: sanitizeRemoteSettings({
        enabled: true,
        telegram: { enabled: true },
        qq: { enabled: false },
        wechat: { enabled: false },
        requireApproval: true,
        allowAutoExecute: false,
        ...remoteOverrides,
      }),
      remoteOwner: sanitizeRemoteOwner({
        telegramUserId: ownerId,
        ...(extra.remoteOwner || {}),
      }),
    }),
    permissionProxy: {
      async requestPermission(req = {}) {
        audit.push({ type: "permission", ...req, at: new Date().toISOString() });
        return {
          ok: true,
          allowed: true,
          reason: "closure_allow",
          requestId: `perm-${audit.length}`,
          riskLevel: req.riskLevel || 1,
        };
      },
    },
    taskStore,
    adminResponder: extra.adminResponder,
    skillRuntime: {
      async invoke(skillId, op, args) {
        audit.push({ type: "skill", skillId, op, text: args?.text, at: new Date().toISOString() });
        if (extra.delayMs) await new Promise((r) => setTimeout(r, extra.delayMs));
        return {
          ok: true,
          text: `报告就绪\nSkill=${skillId}\n输入=${args?.text || ""}\n修改: 无（只读验证）`,
        };
      },
    },
  });
  return { root, taskStore, manager, audit };
}

async function telegramPipeline() {
  const { root, manager, audit, taskStore } = createManager({});
  try {
    await manager.start();
    const started = Date.now();
    const result = await manager.inject({
      channel: "telegram",
      userId: "phone-user",
      conversationId: "tg-chat",
      command: "/task",
      text: "帮我检查项目状态",
    });
    const task = result.task ? await taskStore.get(result.task.moguTaskId) : null;
    const outbox = manager.outbox.list(20);
    return {
      kind: "mogu-v2.3-telegram-pipeline",
      status: result.ok && task?.moguTaskId && outbox.length ? "PASS" : "FAIL",
      mode: "simulated-telegram",
      moguTaskId: task?.moguTaskId || null,
      taskStatus: task?.status || null,
      reply: result.result?.markdown || null,
      durationMs: Date.now() - started,
      permissionEvents: audit.filter((a) => a.type === "permission").length,
      skillEvents: audit.filter((a) => a.type === "skill").length,
      outboxKinds: outbox.map((item) => item.kind),
      logComplete: Boolean(result.result?.markdown && task?.moguTaskId && audit.length >= 2),
    };
  } finally {
    await manager.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function permissionLoop() {
  const denials = [];
  const { root, manager, audit } = createManager(
    { requireApproval: true, allowAutoExecute: false },
    {
      ownerId: "u",
      adminResponder: async (payload) => {
        denials.push(payload);
        return { decision: "NO" };
      },
    }
  );
  const allow = createManager(
    { requireApproval: true, allowAutoExecute: false },
    { ownerId: "u2", adminResponder: async () => ({ decision: "YES" }) }
  );
  try {
    await manager.start();
    const read = await manager.submitTask({
      channel: "telegram",
      userId: "u",
      conversationId: "c",
      text: "查看项目",
      capability: "READ",
    });
    const denied = await manager.submitTask({
      channel: "telegram",
      userId: "u",
      conversationId: "c",
      text: "删除文件",
      capability: "DELETE",
    });
    await allow.manager.start();
    const approved = await allow.manager.submitTask({
      channel: "telegram",
      userId: "u2",
      conversationId: "c2",
      text: "删除文件",
      capability: "DELETE",
    });
    return {
      kind: "mogu-v2.3-permission-loop",
      status:
        read.ok === true &&
        denied.ok === false &&
        denials.length >= 1 &&
        approved.ok === true
          ? "PASS"
          : "FAIL",
      readAllowed: read.ok === true,
      dangerousBlockedWithoutYes: denied.ok === false && denied.reason,
      approvalPromptCount: denials.length,
      approvedAfterYes: approved.ok === true,
      auditTrail: audit
        .concat(allow.audit)
        .map((item) => ({ type: item.type, tool: item.tool, riskLevel: item.riskLevel, text: item.text || item.action })),
    };
  } finally {
    await manager.stop();
    await allow.manager.stop();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(allow.root, { recursive: true, force: true });
  }
}

async function longTaskSimulated() {
  const { root, manager } = createManager(
    { requireApproval: false },
    { delayMs: 120, ownerId: "away-user" }
  );
  try {
    await manager.start();
    const started = Date.now();
    const result = await manager.submitTask({
      channel: "telegram",
      userId: "away-user",
      conversationId: "away-chat",
      text: "分析仓库 运行测试 生成报告",
      capability: "READ",
    });
    const elapsedMs = Date.now() - started;
    const outbox = manager.outbox.list(50);
    const finishedNote = outbox.find((item) => /任务结束|报告/.test(item.text || ""));
    return {
      kind: "mogu-v2.3-long-task",
      status: result.ok && finishedNote ? "PASS_SIMULATED" : "FAIL",
      note: "30-minute live soak is owner-operated; this run validates completion notification shape only",
      moguTaskId: result.task?.moguTaskId || null,
      elapsedMs,
      completionText: result.result?.markdown || null,
      notificationSample: finishedNote?.text || null,
    };
  } finally {
    await manager.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function qqWechatAdapterOnly() {
  const qq = new QQAdapter({ simulate: true });
  const wx = new WeChatAdapter({ simulate: true });
  await qq.start();
  await wx.start();
  const qqIn = await qq.receive({ text: "ping", userId: "qq1", conversationId: "g1" });
  const wxIn = await wx.receive({ text: "ping", userId: "wx1", conversationId: "w1" });
  const qqOut = await qq.send({ conversationId: "g1", userId: "qq1", text: "pong", kind: "status" });
  const wxOut = await wx.send({ conversationId: "w1", userId: "wx1", text: "pong", kind: "status" });
  await qq.stop();
  await wx.stop();
  return {
    kind: "mogu-v2.3-qq-wechat-adapter-only",
    status: qqIn && wxIn && qqOut.ok && wxOut.ok ? "PASS" : "FAIL",
    productionDefault: "OFF",
    qq: { connect: true, receive: Boolean(qqIn.channel === "qq"), send: qqOut.ok === true },
    wechat: { connect: true, receive: Boolean(wxIn.channel === "wechat"), send: wxOut.ok === true },
  };
}

function liveTelegramPreflight() {
  const appData = process.env.APPDATA || "";
  const settingsPath = path.join(appData, "ai-model-manager", "settings.json");
  const secretsPath = path.join(appData, "ai-model-manager", "secrets.json");
  let settings = {};
  let secrets = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    settings = {};
  }
  try {
    secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  } catch {
    secrets = {};
  }
  const remote = sanitizeRemoteSettings(settings.remote);
  const owner = sanitizeRemoteOwner(settings.remoteOwner);
  const tokenMeta = secrets.telegramBotToken;
  const tokenPresent =
    Boolean(tokenMeta?.encoding === "safeStorage" && tokenMeta?.data) ||
    Boolean(process.env.MOGU_TELEGRAM_BOT_TOKEN);
  const telegramOn = isRemoteChannelEnabled(remote, "telegram");
  const ownerSet = Boolean(owner.telegramUserId);
  const ready = tokenPresent && remote.enabled === true && telegramOn && ownerSet;
  return {
    kind: "mogu-v2.3-live-telegram-preflight",
    status: ready ? "READY_NOT_RUN" : "BLOCKED",
    settingsKeys: {
      "remote.enabled": remote.enabled,
      "remote.telegram.enabled": telegramOn,
      "remote.requireApproval": remote.requireApproval,
      "remote.allowAutoExecute": remote.allowAutoExecute,
      "remoteOwner.telegramUserId": ownerSet ? "[set]" : "",
    },
    expectedPersonalConfig: {
      "remote.enabled": true,
      "remote.telegram.enabled": true,
      "remote.qq.enabled": false,
      "remote.wechat.enabled": false,
      "remote.requireApproval": true,
      "remote.allowAutoExecute": false,
      "remoteOwner.telegramUserId": "<your telegram numeric id>",
    },
    secretValueRead: false,
    blocker: !tokenPresent
      ? "No telegramBotToken in SecretStore"
      : !ownerSet
        ? "remoteOwner.telegramUserId not bound"
        : !remote.enabled || !telegramOn
          ? "remote.enabled / telegram not enabled"
          : "Desktop app must be running for live phone soak",
  };
}

async function main() {
  const reports = {
    telegram: await telegramPipeline(),
    permission: await permissionLoop(),
    longTask: await longTaskSimulated(),
    adapters: await qqWechatAdapterOnly(),
    liveTelegram: liveTelegramPreflight(),
  };
  const files = [
    write("closure-telegram.json", reports.telegram),
    write("closure-permission.json", reports.permission),
    write("closure-long-task.json", reports.longTask),
    write("closure-qq-wechat-adapters.json", reports.adapters),
    write("closure-live-telegram-preflight.json", reports.liveTelegram),
  ];
  const offlinePass = ["telegram", "permission", "longTask", "adapters"].every(
    (key) => String(reports[key].status).startsWith("PASS")
  );
  const summary = {
    schemaVersion: 1,
    kind: "mogu-v2.3-closure-summary",
    status: offlinePass ? "PASS" : "FAIL",
    liveTelegram: reports.liveTelegram.status,
    recommendation: "keep-default-off · telegram personal soak next",
    files,
    completedAt: new Date().toISOString(),
  };
  write("closure-summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(offlinePass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
