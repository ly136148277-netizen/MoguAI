"use strict";

const { EventEmitter } = require("node:events");
const { RemoteInbox } = require("./RemoteInbox");
const { RemoteOutbox } = require("./RemoteOutbox");
const { RemoteSessionStore } = require("./RemoteSession");
const { RemoteGateway } = require("./RemoteGateway");
const { RemoteTaskQueue } = require("./RemoteTaskQueue");
const { RemoteTaskSource } = require("./RemoteTaskSource");
const { RemotePermission } = require("./permission/RemotePermission");
const { NotificationService } = require("./notification/NotificationService");
const { TelegramAdapter } = require("./adapters/TelegramAdapter");
const { QQAdapter } = require("./adapters/QQAdapter");
const { WeChatAdapter } = require("./adapters/WeChatAdapter");
const { isRemoteChannelEnabled } = require("./remote-policy");

class RemoteManager extends EventEmitter {
  /**
   * @param {{
   *   getSettings: () => Promise<object>,
   *   permissionProxy: any,
   *   taskStore: any,
   *   skillRuntime?: any,
   *   agentRunService?: any,
   *   resolveSecret?: (id:string)=>Promise<string|null>,
   *   adminResponder?: Function,
   *   getWorkstationStatus?: Function,
   * }} deps
   */
  constructor(deps = {}) {
    super();
    this.deps = deps;
    this.running = false;
    this.inbox = new RemoteInbox();
    this.outbox = new RemoteOutbox();
    this.sessions = new RemoteSessionStore();
    this.permission = new RemotePermission({
      permissionProxy: deps.permissionProxy,
      adminResponder: deps.adminResponder,
    });
    this.adapters = new Map();

    this.queue = new RemoteTaskQueue({
      taskStore: deps.taskStore,
      execute: (taskRequest, ctx) => this._execute(taskRequest, ctx),
      cancelHook: async ({ moguTaskId }) => {
        if (deps.agentRunService?.abort) {
          return deps.agentRunService.abort({ moguTaskId });
        }
        return { ok: true };
      },
    });

    this.notifications = new NotificationService({
      outbox: this.outbox,
      send: (delivery) => this._deliver(delivery),
    });

    this.permission.on("approval-required", (payload) => {
      this.notifications.approvalPrompt(payload).catch(() => {});
      this.emit("approval-required", payload);
    });

    this.queue.on("progress", (progress) => {
      const session = [...this.sessions.list()].find((item) => item.lastTask === progress.moguTaskId);
      if (!session) return;
      this.notifications
        .taskProgress({
          channel: session.channel,
          userId: session.userId,
          conversationId: session.conversationId,
          moguTaskId: progress.moguTaskId,
          percent: progress.percent,
          phase: progress.phase,
          skillId: progress.skillId,
          elapsedMs: progress.elapsedMs,
        })
        .catch(() => {});
    });

    this.gateway = new RemoteGateway({
      sessions: this.sessions,
      permission: this.permission,
      queue: this.queue,
      notifications: this.notifications,
      inbox: this.inbox,
      getSettings: deps.getSettings,
      getWorkstationStatus: async () => {
        if (typeof deps.getWorkstationStatus === "function") {
          return deps.getWorkstationStatus({
            running: this.running,
            queue: this.queue,
            taskStore: deps.taskStore,
          });
        }
        return {
          gpu: "unknown",
          task: "idle",
          model: "unknown",
          queue: 0,
          remoteRunning: this.running,
        };
      },
    });
    this.taskSource = new RemoteTaskSource(this.gateway);
  }

  async start() {
    const settings = await this.deps.getSettings();
    const remote = settings.remote || {};
    if (remote.enabled !== true) {
      this.running = false;
      return { ok: true, enabled: false, reason: "remote_disabled" };
    }
    await this.stop();
    this.permission.configure(remote);

    if (isRemoteChannelEnabled(remote, "telegram")) {
      let botToken = "";
      if (typeof this.deps.resolveSecret === "function") {
        botToken = (await this.deps.resolveSecret("telegramBotToken")) || "";
      }
      this._registerAdapter(new TelegramAdapter({ botToken, simulate: !botToken }));
    }
    if (isRemoteChannelEnabled(remote, "qq")) {
      this._registerAdapter(new QQAdapter({ simulate: true }));
    }
    if (isRemoteChannelEnabled(remote, "wechat")) {
      this._registerAdapter(new WeChatAdapter({ simulate: true }));
    }

    for (const adapter of this.adapters.values()) {
      await adapter.start();
    }
    this.running = true;
    this.emit("started", { channels: [...this.adapters.keys()] });
    return { ok: true, enabled: true, channels: [...this.adapters.keys()] };
  }

  async stop() {
    for (const adapter of this.adapters.values()) {
      adapter.removeAllListeners("message");
      await adapter.stop().catch(() => {});
    }
    this.adapters.clear();
    this.running = false;
    this.emit("stopped");
    return { ok: true };
  }

  _registerAdapter(adapter) {
    adapter.on("message", (message) => {
      this.taskSource.ingest(message).catch((error) => {
        this.emit("error", error);
      });
    });
    this.adapters.set(adapter.channel, adapter);
  }

  getAdapter(channel) {
    return this.adapters.get(channel) || null;
  }

  /** Test/helper: inject message without live network. */
  async inject(message) {
    return this.taskSource.ingest(message);
  }

  async submitTask(taskRequest) {
    return this.gateway.submitTask(taskRequest);
  }

  respondApproval(approvalId, decision) {
    return this.permission.respond(approvalId, decision);
  }

  status() {
    return {
      ok: true,
      running: this.running,
      channels: [...this.adapters.keys()],
      sessions: this.sessions.list().length,
      inbox: this.inbox.list(5).length,
      outbox: this.outbox.list(5).length,
    };
  }

  async _deliver(delivery) {
    const adapter = this.adapters.get(delivery.channel);
    if (!adapter) {
      // Still record outbox even when adapter not started (tests / disabled channel).
      return { ok: true, queuedOnly: true };
    }
    if (delivery.artifacts?.length) {
      for (const artifact of delivery.artifacts.slice(0, 10)) {
        await adapter.upload(artifact).catch(() => {});
      }
    }
    return adapter.send(delivery);
  }

  async _execute(taskRequest, ctx) {
    ctx.setProgress?.({ phase: "brain", percent: 20, skillId: taskRequest.skillId });
    const { skillRuntime, agentRunService } = this.deps;

    // Prefer SkillRuntime when available; never call handler modules directly from adapters.
    if (skillRuntime?.invoke) {
      ctx.setProgress?.({ phase: "skill", percent: 55, skillId: taskRequest.skillId });
      if (ctx.cancellationToken?.aborted) {
        const error = new Error("cancelled");
        error.code = "cancelled";
        throw error;
      }
      const invokePromise = skillRuntime.invoke(
        taskRequest.skillId || "mogu.memory",
        taskRequest.op || "recall",
        {
          ...(taskRequest.args || {}),
          text: taskRequest.text,
          remote: true,
          moguTaskId: ctx.moguTaskId,
        },
        { channel: `remote:${taskRequest.channel}` }
      );
      const result = await Promise.race([
        invokePromise,
        new Promise((_, reject) => {
          const timer = setInterval(() => {
            if (ctx.cancellationToken?.aborted) {
              clearInterval(timer);
              const error = new Error("cancelled");
              error.code = "cancelled";
              reject(error);
            }
          }, 20);
          invokePromise.finally(() => clearInterval(timer));
        }),
      ]);
      ctx.setProgress?.({ phase: "result", percent: 90, skillId: taskRequest.skillId });
      return {
        ok: result?.ok !== false,
        kind: "markdown",
        markdown: formatSkillResult(result),
        artifacts: collectArtifacts(result),
        error: result?.ok === false ? result?.error || result?.reason || "skill_failed" : null,
      };
    }

    if (agentRunService?.send) {
      ctx.setProgress?.({ phase: "brain", percent: 60, skillId: "openclaw" });
      const result = await agentRunService.send({
        text: taskRequest.text,
        sessionKey: taskRequest.sessionId,
        name: "remote-task",
      });
      return {
        ok: result?.ok !== false,
        kind: "markdown",
        markdown: String(result?.text || result?.message || "accepted"),
        artifacts: [],
        error: result?.ok === false ? result?.error || "brain_failed" : null,
      };
    }

    return {
      ok: true,
      kind: "markdown",
      markdown: `Remote task accepted (no executor wired): ${taskRequest.text}`,
      artifacts: [],
    };
  }
}

function formatSkillResult(result) {
  if (!result) return "No result";
  if (typeof result.markdown === "string") return result.markdown;
  if (typeof result.text === "string") return result.text;
  if (typeof result.message === "string") return result.message;
  try {
    return JSON.stringify(result).slice(0, 4000);
  } catch {
    return "OK";
  }
}

function collectArtifacts(result) {
  if (!result) return [];
  if (Array.isArray(result.artifacts)) return result.artifacts;
  if (Array.isArray(result.outputs)) {
    return result.outputs.map((item) =>
      typeof item === "string" ? { kind: "file", path: item } : item
    );
  }
  return [];
}

module.exports = { RemoteManager };
