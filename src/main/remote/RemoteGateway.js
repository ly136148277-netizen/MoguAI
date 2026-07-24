"use strict";

const { createTaskRequest, createTaskResult, boundedString } = require("./RemoteTypes");

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
    this._lastBySession = new Map();
  }

  async handleInbound(message = {}) {
    const settings = await this.getSettings();
    const remote = settings.remote || {};
    if (remote.enabled !== true) {
      return { ok: false, reason: "remote_disabled" };
    }
    const channelFlag = message.channel;
    if (channelFlag && remote[channelFlag] !== true && channelFlag !== "mock") {
      return { ok: false, reason: "channel_disabled", channel: channelFlag };
    }

    const inbound = this.inbox.enqueue(message);
    const session = this.sessions.getOrCreate({
      channel: inbound.channel,
      userId: inbound.userId,
      conversationId: inbound.conversationId,
    });

    const command = String(inbound.command || "").toLowerCase();
    if (command === "/start" || command === "/help") {
      const text =
        command === "/start"
          ? "MOGU Remote Workspace ready. Commands: /help /status /task /cancel /retry /log"
          : [
              "MOGU Remote commands:",
              "/task <text> — submit task",
              "/status — progress",
              "/cancel — cancel last task",
              "/retry — retry last task",
              "/log — last reply",
            ].join("\n");
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "status",
        text,
      });
      this.sessions.touch(session.sessionId, { lastCommand: command, lastReply: text });
      return { ok: true, command, sessionId: session.sessionId };
    }

    if (command === "/status") {
      const last = this._lastBySession.get(session.sessionId);
      const progress = last?.moguTaskId ? this.queue.getProgress(last.moguTaskId) : null;
      const text = progress
        ? `Task:\n${progress.bar}\nRunning: ${progress.skillId || progress.phase}\nElapsed: ${Math.round(progress.elapsedMs / 1000)}s`
        : "No active remote task.";
      await this.notifications.notify({
        channel: session.channel,
        userId: session.userId,
        conversationId: session.conversationId,
        kind: "status",
        text,
        moguTaskId: last?.moguTaskId,
      });
      return { ok: true, command, progress };
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
      return { ok: true, command };
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
      return { ok: true, command, cancelled };
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

    // Admin YES/NO replies for pending approvals
    const yesNo = String(inbound.text || "").trim().toUpperCase();
    if (yesNo === "YES" || yesNo === "NO") {
      // Prefer explicit approvalId in raw; otherwise reject (fail-closed without id).
      const approvalId = inbound.raw?.approvalId || inbound.attachments?.[0]?.approvalId;
      if (approvalId) {
        const answered = this.permission.respond(approvalId, yesNo);
        return { ok: answered.ok, command: "approval", answered };
      }
    }

    const capability = inferCapability(inbound.text, inbound.command);
    return this.submitTask({
      channel: session.channel,
      userId: session.userId,
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      text: inbound.text || inbound.command || "",
      command: inbound.command,
      capability,
      skillId: capability === "READ" ? "mogu.memory" : "mogu.memory",
      op: "recall",
      args: { text: inbound.text },
      attachments: inbound.attachments,
    });
  }

  async submitTask(input = {}) {
    const settings = await this.getSettings();
    const remote = settings.remote || {};
    if (remote.enabled !== true) {
      return { ok: false, reason: "remote_disabled" };
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
    };
  }
}

function inferCapability(text, command) {
  const value = `${command || ""} ${text || ""}`.toLowerCase();
  if (/(delete|\brm\b|remove|删除|卸载)/i.test(value)) return "DELETE";
  if (/(shutdown|reboot|\badmin\b|系统)/i.test(value)) return "SYSTEM";
  if (/(\brun\b|\bexec\b|terminal|执行|运行)/i.test(value)) return "RUN";
  if (/(write|edit|patch|commit|push|修改|写入|提交)/i.test(value)) return "WRITE";
  return "READ";
}

module.exports = { RemoteGateway, inferCapability };
