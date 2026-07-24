"use strict";

const { EventEmitter } = require("node:events");
const { boundedString, makeId, normalizeChannel } = require("./RemoteTypes");

class RemoteOutbox extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxSize = Math.max(16, Number(options.maxSize) || 500);
    this._items = [];
  }

  enqueue(delivery = {}) {
    const item = {
      outboxId: makeId("outbox"),
      createdAt: new Date().toISOString(),
      channel: normalizeChannel(delivery.channel) || "mock",
      userId: boundedString(delivery.userId || "", 200) || null,
      conversationId: boundedString(delivery.conversationId || "", 200) || null,
      kind: boundedString(delivery.kind || "status", 40),
      text: boundedString(delivery.text || delivery.markdown || "", 20_000),
      artifacts: Array.isArray(delivery.artifacts) ? delivery.artifacts.slice(0, 50) : [],
      moguTaskId: boundedString(delivery.moguTaskId || "", 160) || null,
      meta: delivery.meta && typeof delivery.meta === "object" ? { ...delivery.meta } : {},
    };
    this._items.push(item);
    if (this._items.length > this.maxSize) this._items.splice(0, this._items.length - this.maxSize);
    this.emit("delivery", item);
    return item;
  }

  list(limit = 50) {
    return this._items.slice(-Math.max(1, Number(limit) || 50));
  }

  clear() {
    this._items = [];
  }
}

module.exports = { RemoteOutbox };
