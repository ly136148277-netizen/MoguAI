const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");

function createSessionId() {
  return crypto.randomUUID();
}

function deriveTitle(firstMessage) {
  const text = (firstMessage || "新对话").trim().replace(/\s+/g, " ");
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

class ChatSessionStore {
  constructor(sessionsDir) {
    this.sessionsDir = sessionsDir;
  }

  async initialize() {
    await fs.ensureDir(this.sessionsDir);
  }

  sessionPath(sessionId) {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  async list(modelId = null) {
    await this.initialize();
    const files = await fs.readdir(this.sessionsDir);
    const sessions = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const session = await fs.readJson(path.join(this.sessionsDir, file));
      if (modelId && session.modelId !== modelId) {
        continue;
      }
      sessions.push(this._summarize(session));
    }

    return sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  async search(query, modelId = null) {
    const keyword = (query || "").trim().toLowerCase();
    const sessions = await this.list(modelId);
    if (!keyword) {
      return sessions;
    }

    return sessions.filter((session) => {
      const haystack = [session.title, ...(session.preview || [])].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }

  async create(payload) {
    await this.initialize();
    const now = new Date().toISOString();
    const session = {
      id: createSessionId(),
      title: payload.title || "新对话",
      modelId: payload.modelId,
      modelName: payload.modelName,
      ollamaName: payload.ollamaName,
      systemPrompt: payload.systemPrompt || "",
      messages: payload.messages || [],
      createdAt: now,
      updatedAt: now,
    };

    await this.save(session);
    return this._summarize(session);
  }

  async get(sessionId) {
    const filePath = this.sessionPath(sessionId);
    if (!(await fs.pathExists(filePath))) {
      throw new Error("会话不存在");
    }
    return fs.readJson(filePath);
  }

  async save(session) {
    session.updatedAt = new Date().toISOString();
    await fs.writeJson(this.sessionPath(session.id), session, { spaces: 2 });
    return session;
  }

  async rename(sessionId, title) {
    const session = await this.get(sessionId);
    session.title = (title || "").trim() || session.title;
    await this.save(session);
    return this._summarize(session);
  }

  async delete(sessionId) {
    const filePath = this.sessionPath(sessionId);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    return { deleted: true, sessionId };
  }

  async appendMessage(sessionId, message) {
    const session = await this.get(sessionId);
    session.messages.push(message);
    if (message.role === "user" && session.messages.filter((item) => item.role === "user").length === 1) {
      session.title = deriveTitle(message.content);
    }
    await this.save(session);
    return session;
  }

  async setMessages(sessionId, messages) {
    const session = await this.get(sessionId);
    session.messages = messages;
    await this.save(session);
    return session;
  }

  async updateSystemPrompt(sessionId, systemPrompt) {
    const session = await this.get(sessionId);
    session.systemPrompt = systemPrompt || "";
    await this.save(session);
    return session;
  }

  _summarize(session) {
    const lastMessages = session.messages.slice(-2).map((item) => item.content);
    return {
      id: session.id,
      title: session.title,
      modelId: session.modelId,
      modelName: session.modelName,
      ollamaName: session.ollamaName,
      messageCount: session.messages.length,
      preview: lastMessages,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
    };
  }
}

function exportSessionToMarkdown(session) {
  const lines = [
    `# ${session.title || "对话"}`,
    "",
    `- 模型：${session.modelName || session.modelId || "未知"}`,
    `- 导出时间：${new Date().toLocaleString()}`,
    "",
  ];

  if (session.systemPrompt?.trim()) {
    lines.push("## System", "", session.systemPrompt.trim(), "");
  }

  for (const message of session.messages || []) {
    const roleLabel =
      message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : message.role;
    lines.push(`## ${roleLabel}`, "", message.content || "", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

module.exports = { ChatSessionStore, deriveTitle, createSessionId, exportSessionToMarkdown };
