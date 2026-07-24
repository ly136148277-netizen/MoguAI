"use strict";

const { boundedString } = require("../RemoteTypes");
const { progressBar } = require("../RemoteTaskQueue");

class NotificationService {
  constructor({ outbox, send } = {}) {
    this.outbox = outbox;
    this.send = typeof send === "function" ? send : async () => ({ ok: false });
  }

  async notify(event) {
    const delivery = this.outbox.enqueue(event);
    const sent = await this.send(delivery);
    return { delivery, sent };
  }

  taskStarted(ctx = {}) {
    return this.notify({
      channel: ctx.channel,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      moguTaskId: ctx.moguTaskId,
      kind: "status",
      text: `任务开始\nTask: ${ctx.moguTaskId}\nSkill: ${ctx.skillId || "-"}`,
    });
  }

  taskProgress(ctx = {}) {
    const percent = Number(ctx.percent) || 0;
    return this.notify({
      channel: ctx.channel,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      moguTaskId: ctx.moguTaskId,
      kind: "status",
      text: [
        "Task:",
        progressBar(percent),
        `Running: ${ctx.skillId || ctx.phase || "-"}`,
        `Elapsed: ${Math.round((ctx.elapsedMs || 0) / 1000)}s`,
      ].join("\n"),
      meta: { percent, phase: ctx.phase },
    });
  }

  taskFinished(ctx = {}, result = {}) {
    return this.notify({
      channel: ctx.channel,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      moguTaskId: result.moguTaskId || ctx.moguTaskId,
      kind: result.kind || "markdown",
      text:
        result.status === "succeeded"
          ? `任务结束\n${result.markdown || "OK"}`
          : `任务失败\n${result.error || result.markdown || "failed"}`,
      artifacts: result.artifacts || [],
    });
  }

  approvalPrompt(payload = {}) {
    return this.notify({
      channel: payload.channel,
      userId: payload.userId,
      conversationId: payload.conversationId,
      kind: "status",
      text: boundedString(
        `${payload.prompt || "需要管理员批准：YES / NO"}\nCapability: ${payload.capability}\n${payload.text || ""}`,
        4000
      ),
      meta: { approvalId: payload.approvalId },
    });
  }

  log(ctx = {}, line = "") {
    return this.notify({
      channel: ctx.channel,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      moguTaskId: ctx.moguTaskId,
      kind: "log",
      text: boundedString(line, 4000),
    });
  }
}

module.exports = { NotificationService };
