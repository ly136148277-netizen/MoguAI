"use strict";

const { boundedString, makeId, normalizeChannel } = require("./RemoteTypes");

class RemoteSessionStore {
  constructor() {
    this._byKey = new Map();
    this._byId = new Map();
  }

  _key(channel, userId, conversationId) {
    return `${normalizeChannel(channel) || "mock"}:${boundedString(userId, 200)}:${boundedString(conversationId || "default", 200)}`;
  }

  getOrCreate({ channel, userId, conversationId } = {}) {
    const key = this._key(channel, userId, conversationId);
    let session = this._byKey.get(key);
    if (session) return session;
    session = {
      sessionId: makeId("rsess"),
      channel: normalizeChannel(channel) || "mock",
      userId: boundedString(userId || "anonymous", 200),
      conversationId: boundedString(conversationId || "default", 200),
      lastTask: null,
      lastReply: null,
      lastCommand: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._byKey.set(key, session);
    this._byId.set(session.sessionId, session);
    return session;
  }

  get(sessionId) {
    return this._byId.get(String(sessionId || "")) || null;
  }

  touch(sessionId, patch = {}) {
    const session = this.get(sessionId);
    if (!session) return null;
    if (patch.lastTask !== undefined) session.lastTask = patch.lastTask;
    if (patch.lastReply !== undefined) session.lastReply = patch.lastReply;
    if (patch.lastCommand !== undefined) session.lastCommand = patch.lastCommand;
    session.updatedAt = new Date().toISOString();
    return session;
  }

  list() {
    return [...this._byId.values()];
  }
}

module.exports = { RemoteSessionStore };
