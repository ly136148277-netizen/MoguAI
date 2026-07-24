"use strict";

const { EventEmitter } = require("node:events");
const { boundedString, makeId, normalizeChannel } = require("./RemoteTypes");

class RemoteInbox extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxSize = Math.max(16, Number(options.maxSize) || 500);
    this._items = [];
  }

  enqueue(message = {}) {
    const item = {
      inboxId: makeId("inbox"),
      receivedAt: new Date().toISOString(),
      channel: normalizeChannel(message.channel) || "mock",
      userId: boundedString(message.userId || "anonymous", 200),
      conversationId: boundedString(message.conversationId || message.chatId || "", 200) || null,
      messageId: boundedString(message.messageId || "", 200) || null,
      text: boundedString(message.text || "", 12_000),
      command: boundedString(message.command || "", 80) || null,
      attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 20) : [],
      raw: message.raw && typeof message.raw === "object" ? message.raw : null,
    };
    this._items.push(item);
    if (this._items.length > this.maxSize) this._items.splice(0, this._items.length - this.maxSize);
    this.emit("message", item);
    return item;
  }

  list(limit = 50) {
    return this._items.slice(-Math.max(1, Number(limit) || 50));
  }

  clear() {
    this._items = [];
  }
}

module.exports = { RemoteInbox };
