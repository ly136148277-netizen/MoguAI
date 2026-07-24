"use strict";

const { createTaskRequest, createTaskResult, boundedString } = require("./RemoteTypes");
const {
  assertRemoteOwner,
  isLevel1Command,
  isRemoteChannelEnabled,
} = require("./remote-policy");

/**
 * Unified remote entry. All adapters call submitTask() — never Brain/Skill directly.
 */
class RemoteGateway {
  constructor(options = {}) {
    this.sessions = options.sessions;
    this.permission = options.permission;
    this.queue = options.queue;
    this.notifications = options.notifications;
    this.inbox = options.inbox;
    this.getSettings = options.getSettings || (async () => ({ remote: { enabled: false } }));
    this.getWorkstationStatus =
      typeof options.getWorkstationStatus === "function"
        ? options.getWorkstationStatus
        : async () => ({});
    this._lastBySession = new Map();
  }

  async handleInbound(message = {}) {
    const settings = await this.getSettings();
    const remote = settings.remote || {};
    if (remote.enabled !== true) {
      return { ok: false, reason: "remote_disabled" };
    }
    if (!isRemoteChannelEnabled(remote, message.channel) && message.channel !== "mock") {
      return { ok: false, reason: "channel_disabled", channel: message.channel };
    }

    const owner = assertRemoteOwner(settings, message);
    if (!owner.ok) {
      await this.notifications.notify({
        channel: message.channel,
        userId: message.userId,
        conversationId: message.conversationId,
        kind: "error",
        text:
          owner.reason === "owner_not_configured"
            ? "Remote owner 未绑定。请在 settings.remoteOwner 配置你的频道用户 ID。"
            : "拒绝：非绑定主人账号。",
      });
      return { ok: false, reason: owner.reason };
    }

    const inbound = this.inbox.enqueue(message);
    const session = this.sessions.getOrCreate({
      channel: inbound.channel,
      userId: inbound.userId,
      conversationId: inbound.conversationId,
    });

    let command = String(inbound.command || "").toLowerCase();
    const textBody = String(inbound.text || "").trim();
    if (!command && /^\/mogu\s+status\b/i.test(textBody)) {
      command = "/status";
    }
    if (!command && textBody.toLowerCase() === "/mogu status") {
      command = "/status";
    }
    if (command === "/mogu" && /^status\b/i.test(textBody)) {
      command = "/status";
    }

    if (command === "/start" || command === "/help") {
      const text =
        command === "/start"
          ? "MOGU Remote Agent ready.\nCommands: /help /status /task /cancel /retry /log\nOnly the bound owner is accepted."
          : [
              "MOGU Remote commands:",
              "/status — workstation + queue",
              "/task <text> — submit Level-2 task",
              "/cancel — cancel last task",
              "/retry — retry last task",
              "/log — last reply",
              "Dangerous ops require YES / NO",
            ].join("\n");
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "status",
        text,
      });
      this.sessions.touch(session.sessionId, { lastCommand: command, lastReply: text });
      return { ok: true, command, sessionId: session.sessionId, level: 1 };
    }

    if (command === "/status") {
      const text = await this._formatStatus(session);
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "status",
        text,
      });
      this.sessions.touch(session.sessionId, { lastCommand: "/status", lastReply: text });
      return { ok: true, command: "/status", level: 1, text };
    }

    if (command === "/log") {
      const text = boundedString(session.lastReply || "No log yet.", 4000);
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "log",
        text,
      });
      return { ok: true, command, level: 1 };
    }

    if (command === "/cancel") {
      const last = this._lastBySession.get(session.sessionId);
      if (!last?.moguTaskId) {
        return { ok: false, reason: "no_task" };
      }
      const cancelled = await this.queue.cancel(last.moguTaskId, "remote_cancel");
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "status",
        text: `Cancelled ${last.moguTaskId}`,
        moguTaskId: last.moguTaskId,
      });
      return { ok: true, command, cancelled, level: 1 };
    }

    if (command === "/retry") {
      const last = this._lastBySession.get(session.sessionId);
      if (!last?.taskRequest) {
        return { ok: false, reason: "no_task" };
      }
      return this.submitTask({
        ...last.taskRequest,
        requestId: undefined,
        sessionId: session.sessionId,
      });
    }

    const yesNo = String(inbound.text || "").trim().toUpperCase();
    if (yesNo === "YES" || yesNo === "NO") {
      const approvalId = inbound.raw?.approvalId || inbound.attachments?.[0]?.approvalId;
      const answered = approvalId
        ? this.permission.respond(approvalId, yesNo)
        : this.permission.respondForUser(session.userId, yesNo, session.channel);
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "status",
        text: answered.ok
          ? `审批已记录: ${yesNo}`
          : `审批失败: ${answered.reason || "unknown"}`,
      });
      return { ok: answered.ok, command: "approval", answered, level: 1 };
    }

    // Plain text without /task still becomes a Level-2 task for the owner.
    const capability = inferCapability(inbound.text, inbound.command);
    return this.submitTask({
      channel: session.channel,
      userId: session.userId,
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      text: inbound.text || inbound.command || "",
      command: inbound.command || "/task",
      capability,
      skillId: "mogu.memory",
      op: "recall",
      args: { text: inbound.text },
      attachments: inbound.attachments,
    });
  }

  async _formatStatus(session) {
    const last = this._lastBySession.get(session.sessionId);
    const progress = last?.moguTaskId ? this.queue.getProgress(last.moguTaskId) : null;
    const workstation = await this.getWorkstationStatus().catch(() => ({}));
    const lines = [
      "MOGU Remote Status",
      `GPU: ${workstation.gpu || "unknown"}`,
      `Task: ${progress ? progress.phase : workstation.task || "idle"}`,
      `Model: ${workstation.model || "adapter status unknown"}`,
      `Queue: ${workstation.queue ?? 0}`,
      `Remote: ${workstation.remoteRunning ? "running" : "ready"}`,
    ];
    if (progress) {
      lines.push(`Active: ${last.moguTaskId}`, progress.bar, `Skill: ${progress.skillId || "-"}`);
    }
    return lines.join("\n");
  }

  async submitTask(input = {}) {
    const settings = await this.getSettings();
    const remote = settings.remote || {};
    if (remote.enabled !== true) {
      return { ok: false, reason: "remote_disabled" };
    }
    if (!isRemoteChannelEnabled(remote, input.channel) && input.channel !== "mock") {
      return { ok: false, reason: "channel_disabled", channel: input.channel };
    }
    const owner = assertRemoteOwner(settings, input);
    if (!owner.ok) {
      return { ok: false, reason: owner.reason };
    }

    const session =
      (input.sessionId && this.sessions.get(input.sessionId)) ||
      this.sessions.getOrCreate(input);

    const taskRequest = createTaskRequest({
      ...input,
      sessionId: session.sessionId,
      channel: session.channel,
      userId: session.userId,
      conversationId: session.conversationId,
    });

    this.permission.configure(remote);
    const auth = await this.permission.authorize(taskRequest);
    if (!auth.allowed) {
      const result = createTaskResult({
        status: "blocked",
        kind: "error",
        markdown: `Permission denied: ${auth.reason}`,
        error: auth.reason,
      });
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "error",
        text: result.markdown,
      });
      return { ok: false, reason: auth.reason, auth, result };
    }

    const queued = await this.queue.enqueue(taskRequest, auth);
    if (!queued.ok) {
      return queued;
    }
    if (queued.task?.moguTaskId) {
      this._lastBySession.set(session.sessionId, {
        moguTaskId: queued.task.moguTaskId,
        taskRequest,
      });
      this.sessions.touch(session.sessionId, {
        lastTask: queued.task.moguTaskId,
        lastCommand: taskRequest.command || "/task",
      });
      await this.notifications.taskStarted({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        moguTaskId: queued.task.moguTaskId,
        skillId: taskRequest.skillId,
      });
    }
    const finished = queued.done ? await queued.done : queued;
    if (finished.result) {
      this.sessions.touch(session.sessionId, { lastReply: finished.result.markdown });
      await this.notifications.taskFinished(
        {
          channel: session.channel,
          userId: session.userId,
          conversationId: session.conversationId,
          moguTaskId: finished.task?.moguTaskId || queued.task?.moguTaskId,
        },
        finished.result
      );
    }
    return {
      ok: finished.ok !== false && finished.result?.status === "succeeded",
      task: finished.task || queued.task,
      result: finished.result || null,
      cancelled: finished.cancelled === true,
      taskRequest,
      level: isLevel1Command(taskRequest.command, taskRequest.text) ? 1 : 2,
    };
  }
}

function inferCapability(text, command) {
  const value = `${command || ""} ${text || ""}`.toLowerCase();
  if (/(delete|\brm\b|remove|删除|卸载)/i.test(value)) return "DELETE";
  if (/(shutdown|reboot|\badmin\b|系统)/i.test(value)) return "SYSTEM";
  if (/(\brun\b|\bexec\b|terminal|执行|运行)/i.test(value)) return "RUN";
  if (/(write|edit|patch|commit|push|修改|写入|提交|git\s*push|安装|付款|邮件)/i.test(value)) {
    return "WRITE";
  }
  return "READ";
}

module.exports = { RemoteGateway, inferCapability };
