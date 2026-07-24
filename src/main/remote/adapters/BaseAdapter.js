"use strict";

const { EventEmitter } = require("node:events");

/**
 * Channel adapters only receive/send/upload/download.
 * No Brain/Skill/business logic.
 */
class BaseAdapter extends EventEmitter {
  constructor(channel) {
    super();
    this.channel = channel;
    this.running = false;
  }

  async start() {
    this.running = true;
    return { ok: true, channel: this.channel };
  }

  async stop() {
    this.running = false;
    return { ok: true, channel: this.channel };
  }

  async receive(_message) {
    throw new Error("receive() not implemented");
  }

  async send(_delivery) {
    throw new Error("send() not implemented");
  }

  async upload(_file) {
    throw new Error("upload() not implemented");
  }

  async download(_ref) {
    throw new Error("download() not implemented");
  }
}

module.exports = { BaseAdapter };
