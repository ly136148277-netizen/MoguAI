"use strict";

const { BaseAdapter } = require("./BaseAdapter");
const { boundedString } = require("../RemoteTypes");

function resolveFetchImpl(explicit) {
  if (typeof explicit === "function") return explicit;
  try {
    const { net } = require("electron");
    if (typeof net?.fetch === "function") return net.fetch.bind(net);
  } catch {
    /* unit tests / non-electron */
  }
  return globalThis.fetch;
}

/**
 * Telegram Bot API adapter (transport only).
 * Commands: /start /help /status /task /cancel /retry /log
 * Supports text, image, and file payloads as attachments metadata.
 */
class TelegramAdapter extends BaseAdapter {
  constructor(options = {}) {
    super("telegram");
    this.botToken = options.botToken || "";
    this.apiBase = options.apiBase || "https://api.telegram.org";
    this.fetchImpl = resolveFetchImpl(options.fetchImpl);
    this.pollMs = Math.max(500, Number(options.pollMs) || 2000);
    this._offset = 0;
    this._pollTimer = null;
    this._polling = false;
    this._sent = [];
    this.simulate = options.simulate === true || !this.botToken;
  }

  async start() {
    await super.start();
    if (!this.simulate && typeof this.fetchImpl === "function") {
      this._schedulePoll(0);
    }
    return { ok: true, channel: this.channel, simulate: this.simulate };
  }

  async stop() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
    this.running = false;
    return super.stop();
  }

  _schedulePoll(delayMs) {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => {
      this._poll()
        .catch(() => {})
        .finally(() => {
          if (this.running && !this.simulate) this._schedulePoll(this.pollMs);
        });
    }, Math.max(0, delayMs));
  }

  /**
   * Inject an inbound update (tests / local simulate).
   */
  async receive(update = {}) {
    const message = update.message || update;
    const text = boundedString(message.text || message.caption || "", 12_000);
    const commandMatch = text.match(/^\/([a-zA-Z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
    const attachments = [];
    if (message.photo) attachments.push({ type: "image", ref: message.photo });
    if (message.document) attachments.push({ type: "file", ref: message.document });
    const normalized = {
      channel: "telegram",
      userId: String(message.from?.id || message.chat?.id || "unknown"),
      conversationId: String(message.chat?.id || message.from?.id || "unknown"),
      messageId: String(message.message_id || ""),
      text: commandMatch ? boundedString(commandMatch[2] || "", 12_000) : text,
      command: commandMatch ? `/${commandMatch[1].toLowerCase()}` : null,
      attachments,
      raw: update,
    };
    this.emit("message", normalized);
    return normalized;
  }

  async send(delivery = {}) {
    const payload = {
      chat_id: delivery.conversationId || delivery.userId,
      text: boundedString(delivery.text || "", 4000),
    };
    this._sent.push({ ...payload, kind: delivery.kind, at: new Date().toISOString() });
    if (this.simulate || !this.botToken || typeof this.fetchImpl !== "function") {
      return { ok: true, simulate: true, payload };
    }
    const url = `${this.apiBase}/bot${this.botToken}/sendMessage`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: Boolean(data.ok), data };
  }

  async upload(file = {}) {
    this._sent.push({ kind: "upload", file, at: new Date().toISOString() });
    return { ok: true, simulate: this.simulate, file };
  }

  async download(ref = {}) {
    return { ok: true, simulate: this.simulate, ref };
  }

  async _poll() {
    if (!this.botToken || typeof this.fetchImpl !== "function") return;
    const url = `${this.apiBase}/bot${this.botToken}/getUpdates?timeout=0&offset=${this._offset}`;
    const response = await this.fetchImpl(url);
    const data = await response.json().catch(() => ({}));
    for (const update of data.result || []) {
      this._offset = Math.max(this._offset, Number(update.update_id || 0) + 1);
      await this.receive(update);
    }
  }

  getSent() {
    return [...this._sent];
  }
}

module.exports = { TelegramAdapter };
