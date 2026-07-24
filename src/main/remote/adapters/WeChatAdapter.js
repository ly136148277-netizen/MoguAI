"use strict";

const { BaseAdapter } = require("./BaseAdapter");
const { boundedString } = require("../RemoteTypes");

/**
 * WeChat channel adapter — transport only; no business logic.
 */
class WeChatAdapter extends BaseAdapter {
  constructor(options = {}) {
    super("wechat");
    this.simulate = options.simulate !== false;
    this._sent = [];
  }

  async receive(message = {}) {
    const text = boundedString(message.text || "", 12_000);
    const commandMatch = text.match(/^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/);
    const normalized = {
      channel: "wechat",
      userId: String(message.userId || message.from || "wechat-user"),
      conversationId: String(message.conversationId || message.userId || "wechat"),
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
      channel: "wechat",
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

module.exports = { WeChatAdapter };
