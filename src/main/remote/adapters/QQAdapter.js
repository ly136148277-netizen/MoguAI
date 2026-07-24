"use strict";

const { BaseAdapter } = require("./BaseAdapter");
const { boundedString } = require("../RemoteTypes");

/**
 * QQ channel adapter — transport interface only.
 * Swap implementation later without touching Remote Core.
 */
class QQAdapter extends BaseAdapter {
  constructor(options = {}) {
    super("qq");
    this.simulate = options.simulate !== false;
    this._sent = [];
  }

  async receive(message = {}) {
    const text = boundedString(message.text || "", 12_000);
    const commandMatch = text.match(/^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/);
    const normalized = {
      channel: "qq",
      userId: String(message.userId || message.from || "qq-user"),
      conversationId: String(message.conversationId || message.groupId || message.userId || "qq"),
      messageId: String(message.messageId || ""),
      text: commandMatch ? boundedString(commandMatch[2] || "", 12_000) : text,
      command: commandMatch ? `/${commandMatch[1].toLowerCase()}` : null,
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
      raw: message,
    };
    this.emit("message", normalized);
    return normalized;
  }

  async send(delivery = {}) {
    const item = {
      channel: "qq",
      to: delivery.conversationId || delivery.userId,
      text: boundedString(delivery.text || "", 4000),
      kind: delivery.kind,
      at: new Date().toISOString(),
    };
    this._sent.push(item);
    return { ok: true, simulate: this.simulate, item };
  }

  async upload(file = {}) {
    this._sent.push({ kind: "upload", file });
    return { ok: true, simulate: this.simulate, file };
  }

  async download(ref = {}) {
    return { ok: true, simulate: this.simulate, ref };
  }

  getSent() {
    return [...this._sent];
  }
}

module.exports = { QQAdapter };
